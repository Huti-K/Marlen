import type { ThreadTriage, ThreadUrgency } from "@trailin/shared";
import { lazyStatement } from "../../db/index.js";
import { buildFtsMatch } from "../../db/sql.js";
import {
  decodeStringArray,
  MAIL_MESSAGE_ROW_COLUMNS,
  type MailMessage,
  type MailMessageRow,
  toMailMessage,
} from "./rows.js";

/**
 * Read side of the mailbox mirror — every consumer that answers questions
 * from local mail (agent tools, search palette, routes) queries here.
 * Everything returns provider-native ids (providerMessageId /
 * providerThreadId) alongside mirror ids: provider ids are what draft
 * threading, attachment fetches and webmail deep links understand, so
 * they're the handles surfaced to the agent and the UI.
 */

export interface MailSearchHit {
  accountId: string;
  providerMessageId: string;
  providerThreadId: string;
  subject: string;
  from: string;
  to: string[];
  date: string;
  /** FTS-picked body context around the match. */
  snippet: string;
}

const searchSql = (accountFilter: boolean) => `
  SELECT m.account_id AS accountId,
         m.provider_message_id AS providerMessageId,
         m.provider_thread_id AS providerThreadId,
         m.subject,
         m.from_addr AS fromAddr,
         m.to_addrs AS toAddrs,
         m.date,
         snippet(mail_fts, 1, '', '', ' … ', 24) AS snippet
  FROM mail_fts
  JOIN mail_messages m ON m.id = mail_fts.message_id
  WHERE mail_fts MATCH ?
    ${accountFilter ? "AND m.account_id = ?" : ""}
  ORDER BY bm25(mail_fts)
  LIMIT ?
`;

const searchAllStmt = lazyStatement(searchSql(false));
const searchAccountStmt = lazyStatement(searchSql(true));

interface RawSearchRow {
  accountId: string;
  providerMessageId: string;
  providerThreadId: string;
  subject: string;
  fromAddr: string;
  toAddrs: string;
  date: string;
  snippet: string;
}

/** BM25 keyword search over subject/body/sender: all terms first, any term as the fallback. */
export function searchMail(
  query: string,
  opts: { accountId?: string; limit: number },
): MailSearchHit[] {
  const run = (match: string | null): RawSearchRow[] => {
    if (!match) return [];
    return opts.accountId
      ? (searchAccountStmt().all(match, opts.accountId, opts.limit) as RawSearchRow[])
      : (searchAllStmt().all(match, opts.limit) as RawSearchRow[]);
  };
  const rows = (() => {
    const strict = run(buildFtsMatch(query, "AND"));
    return strict.length > 0 ? strict : run(buildFtsMatch(query, "OR"));
  })();
  return rows.map((row) => ({
    accountId: row.accountId,
    providerMessageId: row.providerMessageId,
    providerThreadId: row.providerThreadId,
    subject: row.subject,
    from: row.fromAddr,
    to: decodeStringArray(row.toAddrs),
    date: row.date,
    snippet: row.snippet,
  }));
}

export interface ThreadOverview {
  accountId: string;
  providerThreadId: string;
  subject: string;
  participants: string[];
  messageCount: number;
  lastMessageAt: string;
  hasUnread: boolean;
  lastFromMe: boolean;
  /** Enrichment output; null until the pipeline has judged this thread. */
  gist: string | null;
  triage: ThreadTriage | null;
  urgency: ThreadUrgency | null;
  deadline: string | null;
}

export type ThreadFilter = "recent" | "unread" | "needs_attention";

const THREAD_FILTER_SQL: Record<ThreadFilter, string> = {
  recent: "1 = 1",
  unread: "t.has_unread = 1",
  // "The ball is with the user, or it's hot": enrichment triage/urgency.
  needs_attention: "(s.triage IN ('needs_reply', 'needs_action') OR s.urgency = 'high')",
};

const listSql = (filter: ThreadFilter, accountFilter: boolean) => `
  SELECT t.account_id AS accountId,
         t.provider_thread_id AS providerThreadId,
         t.subject,
         t.participants,
         t.message_count AS messageCount,
         t.last_message_at AS lastMessageAt,
         t.has_unread AS hasUnread,
         t.last_from_me AS lastFromMe,
         s.gist, s.triage, s.urgency, s.deadline
  FROM mail_threads t
  LEFT JOIN mail_thread_state s ON s.thread_id = t.id
  WHERE ${THREAD_FILTER_SQL[filter]}
    ${accountFilter ? "AND t.account_id = ?" : ""}
  ORDER BY t.last_message_at DESC
  LIMIT ?
`;

// One prepared statement per (filter, account-scoped) combination.
const listStmts = Object.fromEntries(
  (Object.keys(THREAD_FILTER_SQL) as ThreadFilter[]).flatMap((filter) => [
    [`${filter}:all`, lazyStatement(listSql(filter, false))],
    [`${filter}:account`, lazyStatement(listSql(filter, true))],
  ]),
) as Record<string, () => import("better-sqlite3").Statement>;

interface RawThreadRow {
  accountId: string;
  providerThreadId: string;
  subject: string;
  participants: string;
  messageCount: number;
  lastMessageAt: string;
  hasUnread: number;
  lastFromMe: number;
  gist: string | null;
  triage: string | null;
  urgency: string | null;
  deadline: string | null;
}

function toOverview(row: RawThreadRow): ThreadOverview {
  return {
    accountId: row.accountId,
    providerThreadId: row.providerThreadId,
    subject: row.subject,
    participants: decodeStringArray(row.participants),
    messageCount: row.messageCount,
    lastMessageAt: row.lastMessageAt,
    hasUnread: row.hasUnread === 1,
    lastFromMe: row.lastFromMe === 1,
    gist: row.gist,
    triage: row.triage as ThreadTriage | null,
    urgency: row.urgency as ThreadUrgency | null,
    deadline: row.deadline,
  };
}

export function listThreadOverviews(opts: {
  accountId?: string;
  filter?: ThreadFilter;
  limit: number;
}): ThreadOverview[] {
  const filter = opts.filter ?? "recent";
  const stmt = listStmts[`${filter}:${opts.accountId ? "account" : "all"}`];
  if (!stmt) return [];
  const rows = (
    opts.accountId ? stmt().all(opts.accountId, opts.limit) : stmt().all(opts.limit)
  ) as RawThreadRow[];
  return rows.map(toOverview);
}

/** One thread message, in ThreadDetail's domain terms — the shared mail_messages row shape. */
export type ThreadMessage = MailMessage;

export interface ThreadDetail {
  accountId: string;
  providerThreadId: string;
  subject: string;
  messages: ThreadMessage[];
}

const threadByProviderIdSql = (accountFilter: boolean) => `
  SELECT t.id AS threadId, t.account_id AS accountId,
         t.provider_thread_id AS providerThreadId, t.subject
  FROM mail_threads t
  WHERE t.provider_thread_id = ?
    ${accountFilter ? "AND t.account_id = ?" : ""}
  ORDER BY t.last_message_at DESC
`;

const threadAnyAccountStmt = lazyStatement(threadByProviderIdSql(false));
const threadOneAccountStmt = lazyStatement(threadByProviderIdSql(true));

const threadMessagesStmt = lazyStatement(`
  SELECT ${MAIL_MESSAGE_ROW_COLUMNS}
  FROM mail_messages
  WHERE thread_id = ?
  ORDER BY date ASC
`);

/**
 * Full local copy of one thread, looked up by its provider-native thread id.
 * `accountId` narrows the lookup when the caller knows the account; without
 * it, the newest-active thread wins on the (unlikely) cross-account id clash.
 */
export function getThreadDetail(providerThreadId: string, accountId?: string): ThreadDetail | null {
  const head = (
    accountId
      ? threadOneAccountStmt().get(providerThreadId, accountId)
      : threadAnyAccountStmt().get(providerThreadId)
  ) as
    | { threadId: string; accountId: string; providerThreadId: string; subject: string }
    | undefined;
  if (!head) return null;
  const rows = threadMessagesStmt().all(head.threadId) as MailMessageRow[];
  return {
    accountId: head.accountId,
    providerThreadId: head.providerThreadId,
    subject: head.subject,
    messages: rows.map(toMailMessage),
  };
}

export interface SentMessage {
  providerMessageId: string;
  providerThreadId: string;
  subject: string;
  to: string[];
  date: string;
  snippet: string;
}

const sentStmt = lazyStatement(`
  SELECT provider_message_id AS providerMessageId,
         provider_thread_id AS providerThreadId,
         subject, to_addrs AS toAddrs, date, snippet
  FROM mail_messages
  WHERE account_id = ? AND is_from_me = 1
  ORDER BY date DESC
  LIMIT ?
`);

/** The account's own newest sent messages (voice learning reads these). */
export function listSentMessages(accountId: string, limit: number): SentMessage[] {
  const rows = sentStmt().all(accountId, limit) as Array<{
    providerMessageId: string;
    providerThreadId: string;
    subject: string;
    toAddrs: string;
    date: string;
    snippet: string;
  }>;
  return rows.map((row) => ({
    providerMessageId: row.providerMessageId,
    providerThreadId: row.providerThreadId,
    subject: row.subject,
    to: decodeStringArray(row.toAddrs),
    date: row.date,
    snippet: row.snippet,
  }));
}
