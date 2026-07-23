import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AccountPermissions, AccountSignature, ConnectedAccount } from "@marlen/shared";
import type { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { moduleLogger } from "../core/logger.js";
import { getAccountPermissions, getAccountSignatures } from "../db/settings.js";
import { getAttachmentProvider } from "../email/attachmentProviders.js";
import { getDraftProvider } from "../email/providers.js";
import {
  type ConnectConfig,
  getConnectConfig,
  getPipedreamAccessToken,
  listAccounts,
} from "../integrations/pipedream/connect.js";
import {
  callWithRevival,
  connectForAccount,
  type McpSession,
  type McpSessionBox,
} from "../integrations/pipedream/mcpSession.js";
import { buildListAttachmentsTool, buildSaveAttachmentTool } from "./attachmentTool.js";
import { buildDraftTool, buildUpdateDraftTool } from "./draftTools.js";

const log = moduleLogger("emailToolset");

/** Tool names satisfy the LLM providers' [a-zA-Z0-9_-]{1,128} constraint. */
function sanitizeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 128);
}

/**
 * Which MCP tools get registered at all, decided per tool by the verb its
 * action name starts with (Pipedream names every tool `app-verb-object`).
 * Reads (find/get/list/search/…) are ALWAYS registered, regardless of any
 * grant. Every other verb needs the matching per-account grant: send verbs
 * need `send`, delete verbs need `delete`, and every remaining verb (create,
 * update, move, label, and any verb this policy has never seen) needs `write`,
 * so an unclassified verb always requires an explicit grant instead of
 * slipping through. `providerWrites: false` forces every grant off (unattended
 * runs). Pipedream's own create-draft is kept even on a read-only account
 * (drafts never dispatch mail) for apps without a DraftProvider. Download
 * verbs are never registered: raw attachment bytes would land base64 in model
 * context; attachments go through the local list/save-attachment tools.
 */
const READ_VERBS = /^(find|get|list|search|fetch|retrieve)(-|$)/;
const SEND_VERBS = /^(send|reply|forward|publish)(-|$)/;
const DELETE_VERBS = /^(delete|remove|trash|destroy|purge)(-|$)/;
const EXCLUDED_VERBS = /^download(-|$)/;
const DRAFT_ONLY = /^create-draft(-|$)/;

type ActionGrants = Omit<AccountPermissions, "accountId">;

const NO_GRANTS: ActionGrants = { write: false, send: false, delete: false };

type ActionCategory = "excluded" | "read" | "draft" | "send" | "delete" | "write";

function classifyAction(action: string): ActionCategory {
  if (EXCLUDED_VERBS.test(action)) return "excluded";
  if (DRAFT_ONLY.test(action)) return "draft";
  if (READ_VERBS.test(action)) return "read";
  if (SEND_VERBS.test(action)) return "send";
  if (DELETE_VERBS.test(action)) return "delete";
  return "write";
}

function actionOf(mcpToolName: string): string {
  return mcpToolName.replace(/^[a-z0-9_]+-/, "");
}

function accountSlug(account: ConnectedAccount): string {
  const local = account.name.split("@")[0] ?? account.name;
  const slug = local
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 24)
    .toLowerCase();
  return slug || account.id.replace(/[^a-zA-Z0-9]/g, "").slice(-6);
}

/**
 * Claim a unique name for one account's local (non-MCP) tool. Tries the
 * app-slug suffix first, falls back to the account id when two accounts of the
 * same app collide on it. Returns null (claiming nothing) only if even the
 * id-suffixed name is taken, so the caller skips the tool rather than letting
 * one account's draft tool act as another's.
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

type McpToolInfo = Awaited<ReturnType<McpClient["listTools"]>>["tools"][number];

/**
 * One account's outcome from the parallel connect+listTools phase. session:
 * null means connect failed; session set but mcpTools: null means listTools
 * failed. Both still get the account's non-MCP tools (draft/attachment).
 */
interface AccountConnectResult {
  account: ConnectedAccount;
  session: McpSession | null;
  mcpTools: McpToolInfo[] | null;
}

/**
 * Wrap one account's already-fetched MCP tool list as pi AgentTools, applying
 * the registration policy above. Takes `mcpTools` rather than fetching it: the
 * fetch runs in parallel across accounts, while this naming/dedup pass stays
 * synchronous and in account order, because which account wins a bare tool
 * name on a collision depends on processing order, so that order stays
 * deterministic.
 */
interface AccountTools {
  tools: AgentTool[];
  /** The read subset of `tools`, by reference: what delegate workers receive. */
  readTools: AgentTool[];
}

function buildAccountTools(
  mcpTools: McpToolInfo[],
  box: McpSessionBox,
  config: ConnectConfig,
  account: ConnectedAccount,
  needsSuffix: boolean,
  seenNames: Set<string>,
  granted: ActionGrants,
): AccountTools {
  const tools: AgentTool[] = [];
  const readTools: AgentTool[] = [];
  const suffix = needsSuffix ? `__${accountSlug(account)}` : "";
  // Tools dropped by the policy filter below — logged once after the loop so
  // the silent capability filtering is at least visible in debug logs.
  const skipped: string[] = [];

  for (const mcpTool of mcpTools) {
    // Pipedream's create-draft is gated behind a paid workspace on some apps
    // (Gmail needs File Stash); Marlen substitutes its own proxy-based tool
    // under the same slug for every app with a DraftProvider, so skip
    // Pipedream's version wherever ours takes over.
    if (getDraftProvider(account.app) && mcpTool.name === `${account.app}-create-draft`) continue;
    const category = classifyAction(actionOf(mcpTool.name));
    const isRead = category === "read";
    const allowed =
      isRead || category === "draft" || (category !== "excluded" && granted[category]);
    if (!allowed) {
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
      // MCP input schemas are plain JSON Schema, what TypeBox compiles to;
      // pass through as-is.
      parameters: mcpTool.inputSchema as AgentTool["parameters"],
      execute: async (_toolCallId, params, signal) => {
        // Reads are replayable across a transport failure; anything else
        // (draft/write verbs) isn't re-sent once its fate is unknown.
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

export interface EmailToolset {
  tools: AgentTool[];
  /** The MCP read tools only, the safe subset delegate workers receive; subset of `tools` by reference. */
  readTools: AgentTool[];
  close: () => Promise<void>;
}

export interface LoadEmailToolsOptions {
  /**
   * Whether any account's permission grants (write/send/delete) can arm MCP
   * tools beyond reads and drafts. Defaults to true. Pass false to gate every
   * account like a read-only one, no matter which grants are stored: reads and
   * drafts are unaffected (unattended runs still read mail, and a draft never
   * dispatches). Used for unattended automation runs, where a prompt-injected
   * email can't trigger a send.
   */
  providerWrites?: boolean;
  /**
   * Whether a human is reviewing this session live. Defaults to true.
   * Interactive create-draft proposes (a card the user keeps) instead of
   * writing a mailbox draft; unattended runs write real drafts, since nobody
   * is there to keep a proposal.
   */
  interactive?: boolean;
}

const EMPTY_TOOLSET: EmailToolset = { tools: [], readTools: [], close: async () => {} };

/**
 * Load the agent's per-account email tools: one pinned MCP session per
 * connected account, plus the local draft and attachment tools. Several
 * accounts of the same app get an account-suffixed tool name. Accounts that
 * fail to connect are skipped; the agent works with what's left.
 */
export async function loadEmailTools(options: LoadEmailToolsOptions = {}): Promise<EmailToolset> {
  const providerWrites = options.providerWrites ?? true;
  const interactive = options.interactive ?? true;
  const config = await getConnectConfig();
  if (!config) return EMPTY_TOOLSET;

  let accounts: ConnectedAccount[];
  let permissions: AccountPermissions[];
  let signatures: AccountSignature[];
  try {
    [accounts, , permissions, signatures] = await Promise.all([
      listAccounts(),
      // Warm/validate the token cache before opening N MCP sessions: bad
      // credentials fail here once instead of as N identical connect failures.
      // Each session's transport re-fetches per request (fetchWithFreshToken)
      // rather than reusing this snapshot.
      getPipedreamAccessToken(),
      getAccountPermissions(),
      getAccountSignatures(),
    ]);
  } catch (error) {
    log.warn({ err: error }, "listing Pipedream accounts failed");
    return EMPTY_TOOLSET;
  }
  if (accounts.length === 0) return EMPTY_TOOLSET;

  // Empty when providerWrites is false: every account then resolves to
  // NO_GRANTS below like a read-only account, regardless of stored grants.
  const grantsById = new Map(
    providerWrites ? permissions.map((p) => [p.accountId, p] as const) : [],
  );
  const grantsFor = (accountId: string): ActionGrants => grantsById.get(accountId) ?? NO_GRANTS;

  // The real send grant, independent of providerWrites: an armed account can
  // autosend a create-draft even from an unattended run, gated by the tool's
  // explicit send=true. providerWrites only governs the MCP verb tools.
  const sendArmedById = new Map(permissions.map((p) => [p.accountId, p.send] as const));

  // Signature presence only steers the tool descriptions; the html itself is
  // re-read at call time. Signature edits reset sessions, keeping these fresh.
  const signedIds = new Set(signatures.map((s) => s.accountId));

  const perApp = new Map<string, number>();
  for (const account of accounts) perApp.set(account.app, (perApp.get(account.app) ?? 0) + 1);

  // Connect + list tools for every account in parallel. Each attempt resolves
  // to a per-account result rather than rejecting, so one account's failure
  // can't drop or reorder the others. The naming/dedup pass that consumes
  // these stays a separate synchronous account-ordered loop (buildAccountTools)
  // so tool naming stays deterministic.
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
    // below: those go through the Connect proxy, not the MCP session.
    let box: McpSessionBox | undefined;
    if (session) {
      box = { current: session, closed: false };
      boxes.push(box);
    }
    const needsSuffix = (perApp.get(account.app) ?? 0) > 1;
    if (box && mcpTools) {
      // One account's tool assembly failing doesn't abort the accounts
      // after it in this loop.
      try {
        const accountTools = buildAccountTools(
          mcpTools,
          box,
          config,
          account,
          needsSuffix,
          seenNames,
          grantsFor(account.id),
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
      if (name)
        tools.push(
          buildDraftTool(
            account,
            name,
            draftProvider,
            sendArmedById.get(account.id) ?? false,
            signedIds.has(account.id),
            interactive,
          ),
        );
      if (draftProvider.updateDraft) {
        // Same footing as create-draft: rewrites an unsent draft, never
        // dispatches mail, so it stays available on read-only accounts.
        const updateName = claimLocalToolName(
          `${account.app}-update-draft`,
          suffix,
          account,
          seenNames,
        );
        if (updateName)
          tools.push(
            buildUpdateDraftTool(
              account,
              updateName,
              draftProvider.updateDraft,
              signedIds.has(account.id),
            ),
          );
      }
    }
    const attachmentProvider = getAttachmentProvider(account.app);
    if (attachmentProvider) {
      // Reads mail but writes only into the local document library, so it's
      // fine on a read-only account.
      const name = claimLocalToolName(`${account.app}-save-attachment`, suffix, account, seenNames);
      if (name) tools.push(buildSaveAttachmentTool(account, name, attachmentProvider));
      // Read-only: lists attachments and publishes the interactive card whose
      // rows open the viewer or save; no mailbox write.
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
