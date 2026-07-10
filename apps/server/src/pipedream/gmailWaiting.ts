import type { ConnectedAccount, WaitingThread } from "@trailin/shared";
import { env } from "../env.js";
import { daysAgo } from "../demo/content.js";
import { registerWaitingProvider } from "../email/waitingProviders.js";
import { MAILBOX } from "../demo/mailbox.js";
import { proxyRequest } from "./connect.js";

/**
 * Gmail "waiting on others" threads: threads where the user sent the last
 * message and nobody has replied yet, for the Home page's pending-work
 * section. Mirrors gmailDrafts.ts's structure (demo branch, live branch via
 * the Connect proxy, a small per-account cache) but is read-only — there's
 * no create/delete counterpart, so there's nothing here to invalidate a
 * cache for.
 *
 * Registered as the "gmail" WaitingProvider at the bottom of this file so
 * routes/waiting.ts reaches it through ../email/waitingProviders.ts's
 * registry instead of hardcoding the "gmail" app slug.
 */

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

/** A counterpart address matching this looks automated, not a person waiting to reply. */
const NO_REPLY_RE = /no-?reply|noreply|newsletter|notification|mailer-daemon/i;

/** Below this age, whoever we're "waiting on" hasn't reasonably had time to reply yet. */
const MIN_WAIT_MS = 24 * 60 * 60 * 1000;

const MAX_ITEMS_PER_ACCOUNT = 10;

/**
 * Deep link that opens a thread in the Gmail web UI. Same rationale as
 * gmailDraftUrl in gmailDrafts.ts: `authuser=<email>` (URL-encoded, before
 * the `#` fragment) is what makes this survive multiple signed-in Google
 * accounts.
 */
export function gmailThreadUrl(accountName: string, threadId: string): string {
  const auth = accountName.includes("@") ? `?authuser=${encodeURIComponent(accountName)}` : "";
  return `https://mail.google.com/mail/${auth}#all/${threadId}`;
}

/**
 * Shared filters for both the demo and live paths: drop automated senders,
 * drop replies too fresh to reasonably be "waiting" yet, sort most-overdue
 * first, cap the list.
 */
function applyFilters(items: WaitingThread[]): WaitingThread[] {
  const now = Date.now();
  return items
    .filter((item) => !NO_REPLY_RE.test(item.counterpart))
    .filter((item) => now - new Date(item.lastSentAt).getTime() >= MIN_WAIT_MS)
    .sort((a, b) => a.lastSentAt.localeCompare(b.lastSentAt))
    .slice(0, MAX_ITEMS_PER_ACCOUNT);
}

function listDemoWaiting(account: ConnectedAccount): WaitingThread[] {
  const items: WaitingThread[] = [];
  for (const thread of MAILBOX) {
    if (thread.accountId !== account.id) continue;
    const last = thread.messages[thread.messages.length - 1];
    // `account.name` is the demo account's own address (see demo/accounts.ts) —
    // the thread only qualifies when the user sent (and nobody answered) the
    // last message.
    if (!last || !last.from.includes(account.name)) continue;
    items.push({
      threadId: thread.id,
      subject: thread.subject,
      counterpart: last.to[0] ?? "",
      lastSentAt: daysAgo(last.daysAgo, last.hour, last.minute ?? 0).toISOString(),
      webUrl: gmailThreadUrl(account.name, thread.id),
    });
  }
  return items;
}

/**
 * Per-account cache for `listGmailWaiting`'s live path — 5 minutes, longer
 * than the drafts cache since a pending reply doesn't change minute to
 * minute. Only the real (non-demo) path is cached, same reasoning as
 * gmailDrafts.ts's draftsCache: failed fetches are never cached, so a broken
 * account retries live on the next request instead of serving stale data for
 * the rest of the TTL.
 */
class WaitingCache {
  private readonly entries = new Map<string, { items: WaitingThread[]; expiresAt: number }>();

  constructor(private readonly ttlMs = 5 * 60_000) {}

  get(accountId: string): WaitingThread[] | undefined {
    const cached = this.entries.get(accountId);
    return cached && cached.expiresAt > Date.now() ? cached.items : undefined;
  }

  set(accountId: string, items: WaitingThread[]): void {
    this.entries.set(accountId, { items, expiresAt: Date.now() + this.ttlMs });
  }
}

const waitingCache = new WaitingCache();

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailMessage {
  id: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: { headers?: GmailHeader[] };
}

function messageHeader(message: GmailMessage | undefined, name: string): string | undefined {
  return message?.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())
    ?.value;
}

interface ThreadsListResponse {
  threads?: { id: string }[];
}

interface ThreadGetResponse {
  messages?: GmailMessage[];
}

async function listLiveWaiting(account: ConnectedAccount): Promise<WaitingThread[]> {
  const list = (await proxyRequest(account.id, "get", `${GMAIL_API}/threads`, {
    params: { q: "in:sent newer_than:14d", maxResults: "25" },
  })) as ThreadsListResponse;

  // One round-trip per thread to read its messages — run in parallel like
  // listGmailDrafts does, so this waits on the slowest thread, not the sum.
  const settled = await Promise.all(
    (list.threads ?? []).map(async (entry): Promise<WaitingThread | null> => {
      try {
        const full = (await proxyRequest(account.id, "get", `${GMAIL_API}/threads/${entry.id}`, {
          // `metadataHeaders` would need to repeat as an array param, which
          // proxyRequest's params (a flat string map) can't express — plain
          // `format=metadata` returns all headers instead, which is enough.
          params: { format: "metadata" },
        })) as ThreadGetResponse;
        const messages = full.messages ?? [];
        // Ignore drafts sitting in the thread; the thread only "counts" as
        // sent-and-unanswered if the last real message was actually sent.
        const nonDraft = messages.filter((m) => !(m.labelIds ?? []).includes("DRAFT"));
        const last = nonDraft[nonDraft.length - 1];
        if (!last || !(last.labelIds ?? []).includes("SENT")) return null;

        const dateHeader = messageHeader(last, "Date");
        const lastSentAt = last.internalDate
          ? new Date(Number(last.internalDate)).toISOString()
          : dateHeader
            ? new Date(dateHeader).toISOString()
            : null;
        if (!lastSentAt) return null;

        return {
          threadId: entry.id,
          subject: messageHeader(messages[0], "Subject") ?? messageHeader(last, "Subject") ?? "",
          counterpart: messageHeader(last, "To") ?? "",
          lastSentAt,
          webUrl: gmailThreadUrl(account.name, entry.id),
        };
      } catch {
        // Skip a single unreadable thread rather than failing the whole list.
        return null;
      }
    }),
  );

  return settled.filter((item): item is WaitingThread => item !== null);
}

export async function listGmailWaiting(
  account: ConnectedAccount,
  opts: { refresh?: boolean } = {},
): Promise<WaitingThread[]> {
  if (env.demoMode) {
    return applyFilters(listDemoWaiting(account));
  }

  if (!opts.refresh) {
    const cached = waitingCache.get(account.id);
    if (cached) return cached;
  }

  const items = applyFilters(await listLiveWaiting(account));
  waitingCache.set(account.id, items);
  return items;
}

registerWaitingProvider("gmail", { listWaiting: listGmailWaiting });
