import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import type { ConnectedAccount } from "@trailin/shared";
import { toCardAccount } from "../agent/card/common.js";
import { buildEmailDraftCard, CARD_KINDS } from "../agent/card/kinds.js";
import { composeDraftBody } from "../agent/composition.js";
import { defineTool, textResult } from "../agent/toolkit.js";
import { appendDraftVersion, createDraftSnapshot, getDraftCardDetails } from "../db/draftStore.js";
import { getWriteAccessAccounts } from "../db/settings.js";
import { isDemoAccount } from "../demo/accounts.js";
import "../email/registerProviders.js";
import "../email/registerAttachmentProviders.js";
import { getAttachmentProvider } from "../email/attachmentProviders.js";
import { buildListAttachmentsTool, buildSaveAttachmentTool } from "../email/attachmentTool.js";
import { type CreateDraftInput, type DraftProvider, getDraftProvider } from "../email/providers.js";
import { moduleLogger } from "../logger.js";
import {
  type ConnectConfig,
  getConnectConfig,
  getPipedreamAccessToken,
  listAccounts,
} from "./connect.js";
import {
  callWithRevival,
  connectForAccount,
  type McpSession,
  type McpSessionBox,
} from "./mcpSession.js";

const log = moduleLogger("mcp");

/** Tool names must satisfy the LLM providers' [a-zA-Z0-9_-]{1,128} constraint. */
function sanitizeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 128);
}

/**
 * Which MCP tools get registered at all. Reads (find/get/list/search/…) are
 * ALWAYS registered, regardless of write access — the agent's only mail read
 * path is live MCP; nothing is mirrored locally. Writes (send, reply, label,
 * move, delete) are gated per account by the write-access setting
 * (`account.writeAccess`), or off for every account regardless of that
 * setting when the caller passes `providerWrites: false` (unattended
 * automation runs, see loadEmailTools). Pipedream's own create-draft is kept
 * even on a read-only account (drafts never dispatch mail) for apps without
 * a DraftProvider. Download verbs are never registered: raw attachment bytes
 * would land base64 in model context — attachments go through the local
 * list/save-attachment tools instead.
 */
const READ_VERBS = /^(find|get|list|search|fetch|retrieve)(-|$)/;
const EXCLUDED_VERBS = /^download(-|$)/;
const DRAFT_ONLY = /^create-draft(-|$)/;

/** The MCP tool's action with the app-slug prefix stripped: "gmail-find-email" → "find-email". */
function actionOf(mcpToolName: string): string {
  return mcpToolName.replace(/^[a-z0-9_]+-/, "");
}

/** Short per-account tool-name suffix, e.g. "kadim" from kadim@gmail.com. */
function accountSlug(account: ConnectedAccount): string {
  const local = account.name.split("@")[0] ?? account.name;
  const slug = local
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 24)
    .toLowerCase();
  return slug || account.id.replace(/[^a-zA-Z0-9]/g, "").slice(-6);
}

/**
 * Claim a unique name for one account's local (non-MCP) tool. Mirrors the MCP
 * naming in buildAccountTools: try the app-slug suffix first, fall back to the
 * account id when two accounts of the same app share an address local-part and
 * the slug collides (e.g. john@gmail.com and a Workspace john@acme.com). Returns
 * null — claiming nothing — only if even the id-suffixed name is taken, so the
 * caller skips the tool rather than letting one account's draft tool act as
 * another's.
 */
function claimLocalToolName(
  base: string,
  suffix: string,
  account: ConnectedAccount,
  seenNames: Set<string>,
): string | null {
  let name = sanitizeToolName(`${base}${suffix}`);
  if (seenNames.has(name)) name = sanitizeToolName(`${base}__${account.id}`);
  if (seenNames.has(name)) return null;
  seenNames.add(name);
  return name;
}

function mcpContentToText(content: unknown): string {
  if (!Array.isArray(content)) return JSON.stringify(content ?? "");
  return content
    .map((block) => {
      if (block && typeof block === "object" && "type" in block) {
        const b = block as { type: string; text?: string };
        if (b.type === "text" && typeof b.text === "string") return b.text;
      }
      return JSON.stringify(block);
    })
    .join("\n");
}

/** Element type of session.client.listTools()'s `tools` array. */
type McpToolInfo = Awaited<ReturnType<McpClient["listTools"]>>["tools"][number];

/**
 * One account's outcome from the parallel connect+listTools phase in
 * loadEmailTools. `session: null` means the connect failed; `session` set
 * but `mcpTools: null` means the session opened but listTools failed. Both
 * still get the account's non-MCP tools (draft/attachment).
 */
interface AccountConnectResult {
  account: ConnectedAccount;
  session: McpSession | null;
  mcpTools: McpToolInfo[] | null;
}

/**
 * Wrap one account's already-fetched MCP tool list as pi AgentTools,
 * applying the read/write registration policy above.
 *
 * Takes `mcpTools` rather than fetching it itself: the network fetch runs in
 * parallel across accounts (see loadEmailTools), while this naming/dedup pass
 * stays synchronous and runs strictly in account order — which account "wins"
 * a bare tool name on a seenNames collision depends on processing order, so
 * that order must stay deterministic.
 */
interface AccountTools {
  tools: AgentTool[];
  /** The read subset of `tools`, by reference — what delegate workers receive. */
  readTools: AgentTool[];
}

function buildAccountTools(
  mcpTools: McpToolInfo[],
  box: McpSessionBox,
  config: ConnectConfig,
  account: ConnectedAccount,
  needsSuffix: boolean,
  seenNames: Set<string>,
  allowWrite: boolean,
): AccountTools {
  const tools: AgentTool[] = [];
  const readTools: AgentTool[] = [];
  const suffix = needsSuffix ? `__${accountSlug(account)}` : "";
  // Tools dropped by the policy filter below — logged once after the loop so
  // the silent capability filtering is at least visible in debug logs.
  const skipped: string[] = [];

  for (const mcpTool of mcpTools) {
    // Pipedream's create-draft components are gated behind a paid workspace
    // on some apps (Gmail's needs File Stash); Trailin substitutes its own
    // proxy-based tool under the same slug for every app with a
    // DraftProvider, so skip Pipedream's version wherever ours takes over.
    if (getDraftProvider(account.app) && mcpTool.name === `${account.app}-create-draft`) continue;
    const action = actionOf(mcpTool.name);
    const isDraft = DRAFT_ONLY.test(action);
    const isRead = READ_VERBS.test(action);
    if (EXCLUDED_VERBS.test(action) || (!isRead && !isDraft && !allowWrite)) {
      skipped.push(mcpTool.name);
      continue;
    }
    let name = sanitizeToolName(`${mcpTool.name}${suffix}`);
    if (seenNames.has(name)) name = sanitizeToolName(`${mcpTool.name}__${account.id}`);
    if (seenNames.has(name)) continue;
    seenNames.add(name);

    const wrapped: AgentTool = {
      name,
      label: mcpTool.title ?? mcpTool.name,
      description: `${mcpTool.description ?? mcpTool.name}\n\nActs as the connected account: ${account.name}.`,
      // MCP input schemas are plain JSON Schema, which is exactly what
      // TypeBox schemas compile to — pass through as-is.
      parameters: mcpTool.inputSchema as AgentTool["parameters"],
      execute: async (_toolCallId, params, signal) => {
        // Reads are replayable across a transport failure; anything else
        // (draft/write verbs) must not be re-sent once its fate is unknown.
        const result = await callWithRevival(
          box,
          account,
          config,
          mcpTool.name,
          (params ?? {}) as Record<string, unknown>,
          isRead,
          signal,
        );
        const text = mcpContentToText(result.content);
        if (result.isError) {
          throw new Error(text || `Tool ${mcpTool.name} failed`);
        }
        return { content: [{ type: "text", text }], details: undefined };
      },
    };
    tools.push(wrapped);
    if (isRead) readTools.push(wrapped);
  }
  log.debug(
    {
      app: account.app,
      account: account.name,
      reads: readTools.length,
      total: tools.length,
      ...(skipped.length > 0 ? { skipped } : {}),
    },
    "registered MCP tools",
  );
  return { tools, readTools };
}

/**
 * Trailin's own create-draft tool for one connected account, generalized
 * over any app with a DraftProvider. Replaces Pipedream's own component
 * with the same kind of tool, so prompts stay natural. Drafts never send
 * anything — allowed even on a read-only account.
 */
function buildDraftTool(
  account: ConnectedAccount,
  name: string,
  provider: DraftProvider,
): AgentTool {
  return defineTool({
    name,
    label: "Create email draft",
    description:
      `Create an unsent draft email in this account's Drafts folder — nothing is sent; the ` +
      `user reviews and sends it themselves. Pass threadId to attach the draft to an existing ` +
      `conversation (use the thread's id from find/list tools), where the connected provider ` +
      `supports it. The body goes through a humanizer pass before saving, which removes ` +
      `AI-sounding phrasing; the tool result reports the final saved text when it was adjusted. ` +
      `If this account has a signature configured in Settings, it is appended automatically — ` +
      `do not write a signature block yourself.\n\n` +
      `Acts as the connected account: ${account.name}.`,
    parameters: {
      type: "object",
      properties: {
        to: { type: "array", items: { type: "string" }, description: "Recipient email addresses." },
        cc: { type: "array", items: { type: "string" }, description: "Cc addresses." },
        bcc: { type: "array", items: { type: "string" }, description: "Bcc addresses." },
        subject: { type: "string", description: "Subject line." },
        body: { type: "string", description: "Plain-text body of the draft." },
        threadId: {
          type: "string",
          description: "Optional thread id to attach this draft to (for replies), when supported.",
        },
      },
      required: ["to", "subject", "body"],
    },
    execute: async (_toolCallId, params) => {
      const input = params as unknown as CreateDraftInput;
      // The compose pipeline (agent/composition.ts) runs before the body ever
      // reaches the provider, so every surface that saves a draft (chat,
      // automations) gets the same humanizer + signature treatment.
      const composed = await composeDraftBody(account.id, {
        body: input.body,
        subject: input.subject,
      });
      const finalBody = composed.body;

      const result = await provider.createDraft(account, {
        ...input,
        body: composed.htmlBody ?? finalBody,
        ...(composed.htmlBody ? { bodyFormat: "html" as const } : {}),
      });

      // Snapshot the plain-text semantic body for the learning loop. The
      // provider may save an HTML MIME body solely to preserve rich signature
      // formatting, but that markup should not become writing-style evidence.
      try {
        await createDraftSnapshot({
          accountId: account.id,
          providerDraftId: result.draftId,
          providerMessageId: result.messageId,
          threadId: input.threadId ?? (result.threadId || undefined),
          subject: input.subject,
          to: input.to,
          cc: input.cc,
          bcc: input.bcc,
          signature: composed.signature,
          body: finalBody,
        });
      } catch (error) {
        log.warn({ err: error, draftId: result.draftId }, "recording draft snapshot failed");
      }

      let text = `Draft created in ${account.name} (draft id ${result.draftId}). It is unsent.`;

      // Show the saved body once, whenever it differs from what the model
      // submitted — whether that's the humanizer, the signature, or both.
      if (finalBody !== input.body) {
        const reasons: string[] = [];
        if (composed.humanized) reasons.push("lightly edited by the humanizer pass");
        if (composed.signatureAppended) reasons.push("had the account's signature appended");
        const reasonText = reasons.length > 0 ? ` (${reasons.join(" and ")})` : "";
        text += `\n\nThe saved draft reads${reasonText}:\n\n${finalBody}`;
      }
      text += CARD_KINDS.email_draft.note;

      const card = buildEmailDraftCard({
        account: toCardAccount(account),
        draft: {
          draftId: result.draftId,
          threadId: result.threadId,
          subject: input.subject,
          to: input.to,
          ...(input.cc?.length ? { cc: input.cc } : {}),
          ...(input.bcc?.length ? { bcc: input.bcc } : {}),
          body: finalBody,
          webUrl: result.webUrl,
          signatureAppended: composed.signatureAppended,
        },
      });

      return textResult(text, card);
    },
  });
}

/**
 * Rewrite an existing draft in place — the tool a chat refinement uses so
 * "make it firmer" edits the SAME draft instead of creating a second one.
 * Runs the same compose pipeline as create (humanizer; signature appended
 * when missing, so it survives a full-body rewrite) and appends an
 * agent-authored version to the draft's snapshot history. Only built for
 * accounts whose provider implements updateDraft.
 */
function buildUpdateDraftTool(
  account: ConnectedAccount,
  name: string,
  provider: DraftProvider,
): AgentTool {
  return defineTool({
    name,
    label: "Update email draft",
    description:
      `Rewrite an existing unsent draft in this account's Drafts folder in place. Use this ` +
      `whenever the user asks to refine, shorten, or otherwise change a draft that already ` +
      `exists (you know its draft id from creating or listing it) — never create a second ` +
      `draft for a refinement. Nothing is sent. The new body goes through the same humanizer ` +
      `pass as draft creation, and the account's configured signature is preserved ` +
      `automatically — do not write one yourself. Recipients cannot be changed; if the user ` +
      `wants different recipients, discard and create a new draft instead.\n\n` +
      `Acts as the connected account: ${account.name}.`,
    parameters: {
      type: "object",
      properties: {
        draftId: { type: "string", description: "Id of the existing draft to rewrite." },
        body: { type: "string", description: "The full replacement plain-text body." },
        subject: { type: "string", description: "Replacement subject line, if it changes." },
      },
      required: ["draftId"],
    },
    execute: async (_toolCallId, params) => {
      const { draftId, body, subject } = params as {
        draftId: string;
        body?: string;
        subject?: string;
      };
      if (body === undefined && subject === undefined) {
        return textResult("Nothing to update: pass a new body and/or subject.");
      }

      let finalBody = body;
      let signatureAppended = false;
      if (body !== undefined) {
        const composed = await composeDraftBody(account.id, { body, subject });
        finalBody = composed.body;
        signatureAppended = composed.signatureAppended;
      }

      if (!provider.updateDraft) {
        return textResult("Updating drafts is not supported for this account.");
      }
      await provider.updateDraft(account, draftId, {
        ...(finalBody !== undefined ? { body: finalBody } : {}),
        ...(subject !== undefined ? { subject } : {}),
      });

      // Agent rewrites append to the snapshot's version history (author
      // "agent") so the learning loop diffs against the LAST agent version.
      // Best-effort: a draft without a snapshot just isn't tracked.
      await appendDraftVersion(account.id, draftId, "agent", {
        body: finalBody,
        subject,
      }).catch((error: unknown) =>
        log.warn({ err: error, draftId }, "appending agent draft version failed"),
      );

      // Re-render the draft card so the conversation shows the updated text —
      // the card from the create turn keeps its old body forever.
      const details = await getDraftCardDetails(account.id, draftId);
      if (details) {
        const card = buildEmailDraftCard({
          account: toCardAccount(account),
          draft: {
            draftId,
            ...(details.threadId ? { threadId: details.threadId } : {}),
            subject: subject ?? details.subject,
            to: details.to,
            ...(details.cc.length > 0 ? { cc: details.cc } : {}),
            ...(details.bcc.length > 0 ? { bcc: details.bcc } : {}),
            body: finalBody ?? details.body,
            signatureAppended,
          },
        });
        return textResult(
          `Draft ${draftId} updated in ${account.name}. It remains unsent.${CARD_KINDS.email_draft.note}`,
          card,
        );
      }

      // No snapshot (not agent-written): there are no recipients to build a
      // card from, so the saved text has to travel in the reply instead.
      let text = `Draft ${draftId} updated in ${account.name}. It remains unsent.`;
      if (finalBody !== undefined && finalBody !== body) {
        text += `\n\nThe saved body reads:\n\n${finalBody}`;
      }
      return textResult(text);
    },
  });
}

export interface EmailToolset {
  tools: AgentTool[];
  /** The MCP read tools only — the safe subset delegate workers receive. Subset of `tools` by reference. */
  readTools: AgentTool[];
  close: () => Promise<void>;
}

export interface LoadEmailToolsOptions {
  /**
   * Whether any account's write-access setting can grant MCP write tools
   * (send, reply, label, move, delete). Defaults to true. Pass false to run
   * every account through the same gating machinery as a read-only account —
   * no account contributes a write tool, no matter what's stored in
   * Settings → Permissions. Read and draft tools are unaffected either way:
   * unattended runs still need to read mail, and creating a draft never
   * dispatches any. Used for unattended automation runs, where a
   * prompt-injected email must not be able to trigger a send.
   */
  providerWrites?: boolean;
}

const EMPTY_TOOLSET: EmailToolset = { tools: [], readTools: [], close: async () => {} };

/**
 * Load the agent's per-account email READ and WRITE tools: one pinned MCP
 * session per connected account, plus the local draft and attachment tools.
 * With several accounts of the same app, tool names get an account suffix
 * (gmail-find-email__work vs gmail-find-email__personal). Accounts that fail
 * to connect are skipped — the agent works with what's left.
 */
export async function loadEmailTools(options: LoadEmailToolsOptions = {}): Promise<EmailToolset> {
  const providerWrites = options.providerWrites ?? true;
  const config = await getConnectConfig();
  if (!config) return EMPTY_TOOLSET;

  let accounts: ConnectedAccount[];
  let writeAccessIds: string[];
  try {
    [accounts, , writeAccessIds] = await Promise.all([
      listAccounts(),
      // Warm/validate the token cache before opening N MCP sessions below —
      // bad credentials fail here once instead of as N identical connect
      // failures. Each session's transport re-fetches through
      // getPipedreamAccessToken() per request (see fetchWithFreshToken)
      // rather than reusing this snapshot.
      getPipedreamAccessToken(),
      getWriteAccessAccounts(),
    ]);
  } catch (error) {
    log.warn({ err: error }, "listing Pipedream accounts failed");
    return EMPTY_TOOLSET;
  }
  // Demo mailboxes have no Pipedream account behind them — never open an MCP
  // session or build a provider tool for one (it would only fail).
  accounts = accounts.filter((account) => !isDemoAccount(account.id));
  if (accounts.length === 0) return EMPTY_TOOLSET;

  // Empty when providerWrites is false: every account then falls through the
  // same `writeAccess.has(account.id)` checks below as a read-only account,
  // regardless of what's stored under Settings → Permissions.
  const writeAccess = providerWrites ? new Set(writeAccessIds) : new Set<string>();

  const perApp = new Map<string, number>();
  for (const account of accounts) perApp.set(account.app, (perApp.get(account.app) ?? 0) + 1);

  // Connect + list tools for every account in parallel — two independent
  // network round-trips per account (a remote MCP handshake, then a
  // listTools call) that don't depend on any other account. Each attempt
  // resolves to a per-account result rather than rejecting, so one account's
  // failure can't drop or reorder the others, and every log line below still
  // carries its own account/app fields. The naming/dedup pass that consumes
  // these results stays a separate, synchronous, account-ordered loop (see
  // buildAccountTools) so tool naming stays deterministic.
  const connectResults = await Promise.all(
    accounts.map(async (account): Promise<AccountConnectResult> => {
      let session: McpSession;
      try {
        session = await connectForAccount(account, config);
      } catch (error) {
        log.warn(
          { err: error, app: account.app, account: account.name },
          "MCP session failed for account",
        );
        return { account, session: null, mcpTools: null };
      }
      try {
        const { tools: mcpTools } = await session.client.listTools();
        return { account, session, mcpTools };
      } catch (error) {
        log.warn(
          { err: error, app: account.app, account: account.name },
          "listing tools failed for account",
        );
        return { account, session, mcpTools: null };
      }
    }),
  );

  const boxes: McpSessionBox[] = [];
  const tools: AgentTool[] = [];
  const readTools: AgentTool[] = [];
  const seenNames = new Set<string>();

  for (const { account, session, mcpTools } of connectResults) {
    // A failed connect still gets the account's local draft/attachment tools
    // below — those go through the Connect proxy, not the MCP session.
    let box: McpSessionBox | undefined;
    if (session) {
      box = { current: session, closed: false };
      boxes.push(box);
    }
    const needsSuffix = (perApp.get(account.app) ?? 0) > 1;
    if (box && mcpTools) {
      // One account's tool assembly failing must not abort the accounts
      // after it in this loop.
      try {
        const accountTools = buildAccountTools(
          mcpTools,
          box,
          config,
          account,
          needsSuffix,
          seenNames,
          writeAccess.has(account.id),
        );
        tools.push(...accountTools.tools);
        readTools.push(...accountTools.readTools);
      } catch (error) {
        log.warn(
          { err: error, app: account.app, account: account.name },
          "building tools failed for account",
        );
      }
    }
    const suffix = needsSuffix ? `__${accountSlug(account)}` : "";
    const draftProvider = getDraftProvider(account.app);
    if (draftProvider) {
      // Never handed to background workers (delegate receives only the
      // readTools subset), so workers cannot create drafts.
      const name = claimLocalToolName(`${account.app}-create-draft`, suffix, account, seenNames);
      if (name) tools.push(buildDraftTool(account, name, draftProvider));
      if (draftProvider.updateDraft) {
        // Same footing as create-draft: rewrites an unsent draft, never
        // dispatches mail, so it stays available on read-only accounts.
        const updateName = claimLocalToolName(
          `${account.app}-update-draft`,
          suffix,
          account,
          seenNames,
        );
        if (updateName) tools.push(buildUpdateDraftTool(account, updateName, draftProvider));
      }
    }
    const attachmentProvider = getAttachmentProvider(account.app);
    if (attachmentProvider) {
      // Reads mail but writes only into the local document library, so it's
      // fine on a read-only account.
      const name = claimLocalToolName(`${account.app}-save-attachment`, suffix, account, seenNames);
      if (name) tools.push(buildSaveAttachmentTool(account, name, attachmentProvider));
      // Read-only: lists attachments and publishes the interactive card whose
      // rows open the viewer or save — no mailbox write.
      const listName = claimLocalToolName(
        `${account.app}-list-attachments`,
        suffix,
        account,
        seenNames,
      );
      if (listName) tools.push(buildListAttachmentsTool(account, listName, attachmentProvider));
    }
  }

  return {
    tools,
    readTools,
    close: async () => {
      // Pin every box shut before closing, so an in-flight reconnect can't
      // resurrect a connection past this point (see reconnectSession).
      await Promise.all(
        boxes.map(async (box) => {
          box.closed = true;
          await box.current.close();
        }),
      );
    },
  };
}
