import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { ConnectedAccount } from "@trailin/shared";
import { getContactContexts, searchContacts } from "../email/contacts/contactsStore.js";
import { listDraftsCached } from "../email/draftsService.js";
import { normalizeAddressSet } from "../email/learn/addressSubject.js";
import { getDraftProvider } from "../email/providers.js";
import {
  getThreadDetail,
  listSentMessages,
  listThreadOverviews,
  searchMail,
  type ThreadFilter,
  type ThreadMessage,
} from "../email/sync/mailQuery.js";
import { syncAccount } from "../email/sync/syncEngine.js";
import { mapWithConcurrency } from "../jobs.js";
import { errorMessage } from "../util.js";
import { toCardAccount } from "./card/common.js";
import { buildEmailHitsCard, buildEmailThreadCard, CARD_KINDS } from "./card/kinds.js";
import { clampLimit, limitParam, numberedList, refreshParam, textResult, tool } from "./toolkit.js";

/**
 * The agent's email READ tools, served entirely from the local mailbox
 * mirror (email/sync/) — no provider round-trips, so they're fast, work
 * offline, and cover every synced account in one call. All ids these tools
 * print are provider-native: threadId feeds create-draft replies and
 * read_thread, messageId feeds save-attachment. Writing (drafts, send,
 * labels) stays on the per-account provider tools.
 *
 * The mirror trails live mail by up to the sync interval (~3 minutes) and
 * reaches back SYNC_BACKFILL_DAYS (default 30); `refresh: true` pulls the
 * provider change feed first when the user asks about "right now".
 */

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/** Cap per-message body text handed to the model; full mail can be enormous. */
const MAX_BODY_CHARS = 6_000;

function truncateBody(body: string): string {
  return body.length > MAX_BODY_CHARS ? `${body.slice(0, MAX_BODY_CHARS)}\n…(truncated)` : body;
}

/**
 * Pull the provider change feed before reading, for "right now" questions.
 * The tool run's signal rides along so a cancelled chat turn or a timed-out
 * automation stops a sweep started on its behalf instead of letting it page
 * on server-side; failures stay best-effort — the mirror still answers.
 */
async function refreshMirror(
  account: ConnectedAccount | undefined,
  all: ConnectedAccount[],
  signal?: AbortSignal,
) {
  const targets = account ? [account] : all;
  await mapWithConcurrency(targets, 4, (a) => syncAccount(a, signal).catch(() => {}));
}

/** Contact-scoped memories quoted per participant in a read_thread block; keeps it compact. */
const MAX_CONTACT_MEMORIES = 5;

/**
 * Compact per-participant context appended after a full thread read, so
 * known-contact facts (relationship, tone, standing notes) reach drafting
 * automatically without a separate lookup — drafts usually follow a
 * read_thread call. Covers every distinct from/to/cc address across the
 * thread's messages; skips participants with no contacts row of kind
 * "person" (non-empty gist) and no contact-scoped memories. Returns "" when
 * nothing is known about anyone in the thread.
 */
async function buildParticipantContext(messages: ThreadMessage[]): Promise<string> {
  const addresses = [...normalizeAddressSet(messages.flatMap((m) => [m.from, ...m.to, ...m.cc]))];
  if (addresses.length === 0) return "";

  const contexts = getContactContexts(addresses);

  const lines: string[] = [];
  for (const { address, contact, memories } of contexts) {
    const gist = contact?.gist.trim();
    if (!gist && memories.length === 0) continue;
    const label = contact?.displayName ? `${contact.displayName} <${address}>` : address;
    const gistPart = gist ? ` — ${gist}.` : "";
    const notes =
      memories.length > 0
        ? ` Notes: ${memories
            .slice(0, MAX_CONTACT_MEMORIES)
            .map((m) => m.content)
            .join("; ")}.`
        : "";
    lines.push(`[Known contact: ${label}${gistPart}${notes}]`);
  }
  return lines.length > 0 ? `\n\n${lines.join("\n")}` : "";
}

function buildSearchMailTool(visibleCards: boolean): AgentTool {
  return tool({
    name: "search_mail",
    label: "Search mail",
    description:
      `Keyword search over the local mail index (subject, body, sender) across ALL connected ` +
      `email accounts, or one account via the account parameter (its address or id). Returns ` +
      `matches with their threadId (use with read_thread, and as the create-draft reply ` +
      `threadId) and messageId (use with save-attachment tools). The index mirrors roughly the ` +
      `last month of mail and can trail live mail by a few minutes — set refresh true only when ` +
      `the user asks about mail that may have just arrived.`,
    account: "optional",
    accountDescription: "Optional: search only this connected account (email address or id).",
    params: {
      query: Type.String({ description: "Keywords to search for." }),
      limit: limitParam(DEFAULT_LIMIT),
      refresh: refreshParam("searching"),
    },
    execute: async (
      { query, limit: limitRaw, refresh },
      { account, accounts, accountTag, signal },
    ) => {
      if (refresh === true) await refreshMirror(account, accounts, signal);

      const limit = clampLimit(limitRaw, DEFAULT_LIMIT, MAX_LIMIT);
      const hits = searchMail(query, { accountId: account?.id, limit });
      if (hits.length === 0) {
        return textResult(
          `No local mail matches "${query}"${account ? ` in ${account.name}` : ""}. ` +
            `The index covers roughly the last month of synced mail.`,
        );
      }

      const lines = numberedList(
        hits.map((hit) => ({
          head: `${hit.subject || "(no subject)"} — from ${hit.from}${accountTag(hit.accountId)}, ${hit.date}`,
          body: [
            hit.snippet,
            `threadId: ${hit.providerThreadId} | messageId: ${hit.providerMessageId}`,
          ],
        })),
      );

      const cardHits = hits.map((hit) => ({
        messageId: hit.providerMessageId,
        threadId: hit.providerThreadId,
        accountId: hit.accountId,
        subject: hit.subject,
        from: hit.from,
        to: hit.to,
        date: hit.date,
        snippet: hit.snippet,
      }));
      const card = buildEmailHitsCard({
        account: account ? toCardAccount(account) : undefined,
        query,
        hits: cardHits,
        truncated: hits.length === limit ? true : undefined,
      });
      const note = visibleCards ? CARD_KINDS.email_hits.note : "";
      return textResult(lines + note, card);
    },
  });
}

function buildReadThreadTool(visibleCards: boolean): AgentTool {
  return tool({
    name: "read_thread",
    label: "Read mail thread",
    description:
      `Read one email thread in full from the local mail index, oldest message first — always ` +
      `use this before summarizing a thread or drafting a reply. threadId is the provider ` +
      `thread id from search_mail, list_threads or list_waiting_threads results; pass account ` +
      `when you know which account the thread lives in.`,
    account: "optional",
    accountDescription: "Optional: the connected account (email address or id) the thread is in.",
    params: {
      threadId: Type.String({ description: "Provider thread id." }),
    },
    execute: async ({ threadId }, { account, accounts }) => {
      const detail = getThreadDetail(threadId, account?.id);
      if (!detail) {
        return textResult(
          `No thread ${threadId} in the local mail index` +
            `${account ? ` for ${account.name}` : ""}. Check the id against a search_mail or ` +
            `list_threads result; mail older than the sync window is not indexed.`,
        );
      }

      const owner = accounts.find((a) => a.id === detail.accountId);
      const header =
        `Thread "${detail.subject || "(no subject)"}" in ${owner?.name ?? detail.accountId} — ` +
        `${detail.messages.length} message(s), threadId: ${detail.providerThreadId}`;
      const blocks = detail.messages.map((m) => {
        const cc = m.cc.length > 0 ? `\nCc: ${m.cc.join(", ")}` : "";
        return (
          `From: ${m.from}\nTo: ${m.to.join(", ")}${cc}\nDate: ${m.date}` +
          `\nmessageId: ${m.providerMessageId}\n\n${truncateBody(m.bodyText)}`
        );
      });

      const card = buildEmailThreadCard({
        account: owner ? toCardAccount(owner) : undefined,
        threadId: detail.providerThreadId,
        subject: detail.subject,
        messages: detail.messages.map((m) => ({
          from: m.from,
          to: m.to,
          ...(m.cc.length > 0 ? { cc: m.cc } : {}),
          date: m.date,
          body: truncateBody(m.bodyText),
        })),
      });
      const participantContext = await buildParticipantContext(detail.messages);
      const note = visibleCards ? CARD_KINDS.email_thread.note : "";
      return textResult(
        `${header}\n\n${blocks.join("\n\n---\n\n")}${participantContext}${note}`,
        card,
      );
    },
  });
}

const listThreadsTool: AgentTool = tool({
  name: "list_threads",
  label: "List mail threads",
  description:
    `List recent email threads from the local mail index, newest first, across all connected ` +
    `accounts or one account. filter "unread" keeps threads with unread mail; ` +
    `"needs_attention" keeps threads the enrichment pipeline judged as needing a reply or ` +
    `action, or urgent. sinceDays bounds the list to threads whose last message is within that ` +
    `many days (e.g. sinceDays 7 for the last week). Each line carries the thread's one-line ` +
    `gist and triage when available — use this to scan an inbox before deciding what to read in ` +
    `full, and use the printed threadId with read_thread.`,
  account: "optional",
  accountDescription: "Optional: list only this connected account (email address or id).",
  params: {
    filter: Type.Optional(
      Type.Union(
        [Type.Literal("recent"), Type.Literal("unread"), Type.Literal("needs_attention")],
        { description: 'Which threads to list (default "recent").' },
      ),
    ),
    sinceDays: Type.Optional(
      Type.Number({
        description:
          "Only threads whose last message is within this many days; omit for no age bound.",
      }),
    ),
    limit: limitParam(DEFAULT_LIMIT, "threads"),
    refresh: refreshParam("listing"),
  },
  execute: async (
    { filter, sinceDays, limit: limitRaw, refresh },
    { account, accounts, accountTag, signal },
  ) => {
    if (refresh === true) await refreshMirror(account, accounts, signal);

    const effectiveFilter: ThreadFilter = filter ?? "recent";
    const threads = listThreadOverviews({
      accountId: account?.id,
      filter: effectiveFilter,
      sinceDays: typeof sinceDays === "number" && sinceDays > 0 ? sinceDays : undefined,
      limit: clampLimit(limitRaw, DEFAULT_LIMIT, MAX_LIMIT),
    });
    if (threads.length === 0) {
      return textResult(
        `No ${effectiveFilter === "recent" ? "" : `${effectiveFilter} `}threads in the local mail index` +
          `${account ? ` for ${account.name}` : ""}.`,
      );
    }

    const lines = numberedList(
      threads.map((t) => {
        const flags = [
          t.hasUnread ? "unread" : null,
          t.lastFromMe ? "last message from user" : null,
          t.triage ? `triage: ${t.triage}` : null,
          t.urgency && t.urgency !== "normal" ? `urgency: ${t.urgency}` : null,
          t.deadline ? `deadline: ${t.deadline}` : null,
        ].filter(Boolean);
        return {
          head:
            `${t.subject || "(no subject)"}${accountTag(t.accountId)} — ${t.messageCount} msg, ` +
            `last ${t.lastMessageAt}${flags.length > 0 ? ` (${flags.join(", ")})` : ""}`,
          body: [t.gist || undefined, `threadId: ${t.providerThreadId}`],
        };
      }),
    );
    return textResult(lines);
  },
});

const listSentTool: AgentTool = tool({
  name: "list_sent_messages",
  label: "List sent messages",
  description:
    `List the newest messages the user themselves sent, newest first, with each message's ` +
    `threadId for read_thread. Serves from the local mail index, across all connected ` +
    `accounts or one account via the account parameter. Use this (not search_mail) when the ` +
    `task is about the user's own outgoing mail — reviewing what they sent today, studying ` +
    `their writing.`,
  account: "optional",
  accountDescription: "Optional: list only this connected account (email address or id).",
  params: {
    limit: limitParam(DEFAULT_LIMIT, "messages"),
  },
  execute: async ({ limit: limitRaw }, { account, accounts, accountTag }) => {
    const limit = clampLimit(limitRaw, DEFAULT_LIMIT, MAX_LIMIT);
    const targets = account ? [account] : accounts;
    const rows = targets
      .flatMap((a) => listSentMessages(a.id, limit).map((m) => ({ ...m, accountId: a.id })))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, limit);
    if (rows.length === 0) {
      return textResult(
        `No sent messages${account ? ` for ${account.name}` : ""} in the local mail index — ` +
          `the mirror may still be syncing, or there is no recent sent mail.`,
      );
    }
    const lines = numberedList(
      rows.map((m) => ({
        head:
          `${m.subject || "(no subject)"} — to ${m.to.join(", ") || "(unknown)"}` +
          `${accountTag(m.accountId)}, ${m.date}`,
        body: [m.snippet, `threadId: ${m.providerThreadId}`],
      })),
    );
    return textResult(lines);
  },
});

const listDraftsTool: AgentTool = tool({
  name: "list_drafts",
  label: "List drafts",
  description:
    `List the unsent drafts currently sitting in each connected account's Drafts folder ` +
    `(live from the provider, briefly cached) — subject, recipients, date, snippet, and the ` +
    `draft's threadId when it replies to a conversation. Use it to review what is drafted ` +
    `but not sent; the user sends drafts themselves from their mail client or the Drafts page.`,
  account: "optional",
  accountDescription: "Optional: list only this connected account (email address or id).",
  params: {},
  execute: async (_params, { account, accounts }) => {
    const targets = (account ? [account] : accounts).filter(
      (a) => getDraftProvider(a.app) !== null,
    );
    if (targets.length === 0) {
      return textResult(
        account
          ? `${account.name} has no drafts support.`
          : "No connected account supports drafts.",
      );
    }

    const sections = await Promise.all(
      targets.map(async (a) => {
        try {
          const drafts = await listDraftsCached(a);
          if (drafts.length === 0) return `${a.name}: no drafts.`;
          const lines = numberedList(
            drafts.map((d) => ({
              head: `${d.subject || "(no subject)"} — to ${d.to || "(no recipients)"}, ${d.date}`,
              body: [
                d.snippet ?? "",
                `draftId: ${d.id}${d.threadId ? ` | threadId: ${d.threadId}` : ""}`,
              ],
            })),
          );
          return `${a.name}:\n${lines}`;
        } catch (error) {
          return `${a.name}: listing drafts failed (${errorMessage(error)}).`;
        }
      }),
    );
    return textResult(sections.join("\n\n"));
  },
});

const MAX_LOOKUP_RESULTS = 10;

const lookupContactTool: AgentTool = tool({
  name: "lookup_contact",
  label: "Look up contact",
  description:
    `Look up what's known locally about a correspondent by email address or name fragment — ` +
    `relationship category, one-line gist, message counts, and any contact-scoped memories. ` +
    `read_thread already surfaces this automatically for a thread's participants; use this ` +
    `tool to check someone outside a thread, or when that automatic context wasn't enough.`,
  params: {
    query: Type.String({
      description: "An email address (exact or partial) or a name fragment to search for.",
    }),
  },
  execute: async ({ query }) => {
    const trimmed = query.trim();
    if (!trimmed) return textResult("Provide an email address or name to look up.");

    const matches = searchContacts(trimmed, MAX_LOOKUP_RESULTS);
    if (matches.length === 0) return textResult(`No local contact matches "${trimmed}".`);

    const blocks = matches.map(({ contact: c, memories }) => {
      const label = c.displayName ? `${c.displayName} <${c.address}>` : c.address;
      const aggregates =
        `${c.messageCount} message(s), ${c.sentCount} sent, ` +
        `last contact ${c.lastContactAt || "unknown"}`;
      const notes =
        memories.length > 0
          ? `\n  Notes:\n${memories.map((m) => `  - ${m.content}`).join("\n")}`
          : "";
      return `${label} — ${c.kind}, ${c.category}${c.gist ? `\n  ${c.gist}` : ""}\n  ${aggregates}${notes}`;
    });
    return textResult(blocks.join("\n\n"));
  },
});

/**
 * The mirror-backed read tools every agent surface shares (main chat,
 * delegate workers, voice learning). visibleCards marks surfaces that render
 * tool cards to the user (chat and reopened automation transcripts): the
 * card-emitting tools then tell the model not to restate card contents.
 * One-shot workers leave it off — their cards render nowhere, so their
 * reports must carry the content.
 */
export function buildMailReadTools({
  visibleCards = false,
}: {
  visibleCards?: boolean;
} = {}): AgentTool[] {
  return [
    buildSearchMailTool(visibleCards),
    buildReadThreadTool(visibleCards),
    listThreadsTool,
    listSentTool,
    listDraftsTool,
    lookupContactTool,
  ];
}
