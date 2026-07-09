import { randomUUID } from "node:crypto";
import type { ConnectedAccount, EmailDraft, EmailThreadMessage } from "@trailin/shared";
import { getDemoDraftStore, setDemoDraftStore, type DemoDraftRecord } from "../db/settings.js";
import { daysAgo } from "../demo/content.js";
import { MAILBOX, resolveThread } from "../demo/mailbox.js";
import { env } from "../env.js";
import { emitServerEvent } from "../events.js";
import { DraftsCache, registerDraftProvider, type DraftProvider } from "../email/providers.js";
import { proxyRequest } from "./connect.js";

/**
 * Gmail drafts via the Connect proxy (plain Gmail REST API). Pipedream's
 * prebuilt create-draft component requires a paid workspace (File Stash);
 * the proxy works on every plan and returns clean JSON.
 *
 * Registered as the "gmail" DraftProvider at the bottom of this file so
 * routes/tools reach it through ../email/providers.ts's registry. Both the
 * live agent (pipedream/mcp.ts's buildDraftTool) and demo mode
 * (demo/emailTools.ts, always Gmail) build their create-draft tool from
 * gmailDraftProvider rather than calling anything in this file directly.
 */

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

/**
 * Per-account cache for `listGmailDrafts`, so GET /api/drafts doesn't hit
 * Gmail on every poll/SSE-triggered refetch. Only the real (non-demo) path
 * is cached — demo mode already reads from a local settings blob, which is
 * cheap enough not to need it. Failed fetches are never cached (and never
 * overwrite a good entry), so a broken account retries live on the very next
 * request instead of serving stale data — or another account's data — for
 * the rest of the TTL.
 */
const draftsCache = new DraftsCache();

/** Drop a cached drafts list. Call before emitting "drafts" so the SSE-driven refetch is fresh. */
export function invalidateGmailDraftsCache(accountId: string): void {
  draftsCache.invalidate(accountId);
}

/**
 * Deep link that opens a specific draft in the Gmail web UI.
 *
 * `authuser=<email>` is what makes this survive multiple signed-in Google
 * accounts: Gmail resolves it to the right account regardless of login order.
 * We deliberately avoid the `/mail/u/<N>/` path form — `N` is a per-browser
 * login-order index (not stable), and putting the email there (URL-encoded,
 * so `@` becomes `%40`) 404s when more than one account is signed in.
 * `authuser` must sit before the `#` fragment or Gmail's server never sees it.
 */
export function gmailDraftUrl(accountName: string, messageId: string): string {
  const auth = accountName.includes("@")
    ? `?authuser=${encodeURIComponent(accountName)}`
    : "";
  return `https://mail.google.com/mail/${auth}#drafts?compose=${messageId}`;
}

interface DraftsListResponse {
  drafts?: { id: string; message: { id: string; threadId: string } }[];
}

interface DraftGetResponse {
  message?: {
    id: string;
    threadId: string;
    internalDate?: string;
    payload?: { headers?: { name: string; value: string }[] };
    snippet?: string;
  };
}

/**
 * Decode the common HTML entities Gmail escapes in `message.snippet`. Not a
 * full entity decoder — just enough for the handful Gmail actually emits.
 */
const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

function decodeHtmlEntities(text: string): string {
  return text.replace(
    /&amp;|&lt;|&gt;|&quot;|&#39;|&nbsp;/g,
    (match) => HTML_ENTITIES[match] ?? match,
  );
}

const SNIPPET_MAX_LENGTH = 140;

/** One-line preview for list rows: collapse whitespace, cap length. */
function snippetFromBody(body: string): string {
  const collapsed = body.replace(/\s+/g, " ").trim();
  if (collapsed.length <= SNIPPET_MAX_LENGTH) return collapsed;
  return `${collapsed.slice(0, SNIPPET_MAX_LENGTH)}…`;
}

export async function listGmailDrafts(
  account: ConnectedAccount,
  limit = 15,
  opts: { refresh?: boolean } = {},
): Promise<EmailDraft[]> {
  if (env.demoMode) {
    const store = await getDemoDraftStore();
    return (store[account.id] ?? [])
      .map(({ body, cc: _cc, bcc: _bcc, ...draft }) => {
        const snippet = snippetFromBody(body);
        return { ...draft, ...(snippet ? { snippet } : {}) };
      })
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, limit);
  }

  if (!opts.refresh) {
    const cached = draftsCache.get(account.id);
    if (cached) return cached;
  }

  const list = (await proxyRequest(account.id, "get", `${GMAIL_API}/drafts`, {
    params: { maxResults: String(limit) },
  })) as DraftsListResponse;

  // Fetch each draft's metadata in parallel — these are independent Gmail
  // round-trips, so serializing them made the Home page wait on the sum of
  // all of them instead of the slowest one.
  const settled = await Promise.all(
    (list.drafts ?? []).map(async (entry): Promise<EmailDraft | null> => {
      try {
        const full = (await proxyRequest(account.id, "get", `${GMAIL_API}/drafts/${entry.id}`, {
          params: { format: "metadata" },
        })) as DraftGetResponse;
        const headers = full.message?.payload?.headers ?? [];
        const header = (name: string) =>
          headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
        const snippet = decodeHtmlEntities(full.message?.snippet ?? "").trim();
        return {
          id: entry.id,
          messageId: entry.message.id,
          threadId: entry.message.threadId,
          subject: header("Subject") ?? "",
          to: header("To") ?? "",
          date: full.message?.internalDate
            ? new Date(Number(full.message.internalDate)).toISOString()
            : "",
          webUrl: gmailDraftUrl(account.name, entry.message.id),
          ...(snippet ? { snippet } : {}),
        };
      } catch {
        // Skip a single unreadable draft rather than failing the whole list.
        return null;
      }
    }),
  );
  // Newest first.
  const drafts = settled
    .filter((d): d is EmailDraft => d !== null)
    .sort((a, b) => b.date.localeCompare(a.date));
  draftsCache.set(account.id, drafts);
  return drafts;
}

interface MessagePart {
  mimeType?: string;
  body?: { data?: string };
  parts?: MessagePart[];
}

/** Depth-first search for the first part of the wanted MIME type. */
function findPart(part: MessagePart | undefined, mimeType: string): MessagePart | undefined {
  if (!part) return undefined;
  if (part.mimeType === mimeType && part.body?.data) return part;
  for (const child of part.parts ?? []) {
    const hit = findPart(child, mimeType);
    if (hit) return hit;
  }
  return undefined;
}

function decodeBody(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

/**
 * Plain-text body of one message payload: text/plain if present, else
 * text/html with tags stripped (crude but serviceable for display). Shared by
 * getGmailDraftDetail and getGmailThread so there's exactly one MIME walker.
 */
function plainTextBody(payload: MessagePart | undefined): string {
  const plain = findPart(payload, "text/plain");
  if (plain?.body?.data) return decodeBody(plain.body.data);
  const html = findPart(payload, "text/html");
  if (!html?.body?.data) return "";
  return decodeBody(html.body.data)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .trim();
}

type MessageHeaders = { headers?: { name: string; value: string }[] };

/** Case-insensitive header lookup, the way Gmail's `payload.headers` needs to be read. */
function headerLookup(payload: MessageHeaders | undefined) {
  const headers = payload?.headers ?? [];
  return (name: string) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

/** Full content of one draft, for the in-app viewer. */
export async function getGmailDraftDetail(
  account: ConnectedAccount,
  draftId: string,
): Promise<{ body: string; cc: string; bcc: string }> {
  if (env.demoMode) {
    const store = await getDemoDraftStore();
    const record = (store[account.id] ?? []).find((d) => d.id === draftId);
    if (!record) throw new Error("draft not found");
    return { body: record.body, cc: record.cc ?? "", bcc: record.bcc ?? "" };
  }

  const full = (await proxyRequest(account.id, "get", `${GMAIL_API}/drafts/${draftId}`, {
    params: { format: "full" },
  })) as {
    message?: { payload?: MessagePart & { headers?: { name: string; value: string }[] } };
  };
  const payload = full.message?.payload;
  const header = headerLookup(payload);
  return { body: plainTextBody(payload), cc: header("Cc"), bcc: header("Bcc") };
}

function splitAddressList(value: string): string[] {
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

interface ThreadGetResponse {
  messages?: {
    id?: string;
    internalDate?: string;
    payload?: MessagePart & { headers?: { name: string; value: string }[] };
  }[];
}

/**
 * Demo path for getGmailThread: reads the seeded MAILBOX exactly the way
 * demo/emailTools.ts's gmail-get-thread tool does (same resolveThread lookup,
 * same oldest-first message order), so a draft opened from the demo UI links
 * to the same thread content the agent would have read.
 */
function demoGmailThread(accountId: string, threadId: string): EmailThreadMessage[] {
  const threads = MAILBOX.filter((t) => t.accountId === accountId);
  const thread = resolveThread(threads, threadId);
  // A draft that starts a new conversation has a threadId no mailbox thread
  // matches — that is "no history", not an error. Seeded demo drafts are all
  // of this shape, so throwing here would break the demo drafts viewer.
  if (!thread) return [];
  return thread.messages.map((message) => ({
    from: message.from,
    to: message.to,
    ...(message.cc?.length ? { cc: message.cc } : {}),
    date: daysAgo(message.daysAgo, message.hour, message.minute ?? 0).toISOString(),
    body: message.body,
  }));
}

/**
 * The full thread a draft (or any message) belongs to, oldest message first.
 * `excludeMessageId` drops one message from the result: Gmail counts an unsent
 * reply draft as a message of its own thread, so a viewer showing the draft
 * alongside its history would otherwise print the draft body twice.
 */
export async function getGmailThread(
  account: ConnectedAccount,
  threadId: string,
  opts: { excludeMessageId?: string } = {},
): Promise<EmailThreadMessage[]> {
  if (env.demoMode) return demoGmailThread(account.id, threadId);

  const res = (await proxyRequest(account.id, "get", `${GMAIL_API}/threads/${threadId}`, {
    params: { format: "full" },
  })) as ThreadGetResponse;

  const messages = (res.messages ?? [])
    .filter((m) => !opts.excludeMessageId || m.id !== opts.excludeMessageId)
    .map((m): EmailThreadMessage => {
      const header = headerLookup(m.payload);
      const cc = splitAddressList(header("Cc"));
      return {
        from: header("From"),
        to: splitAddressList(header("To")),
        ...(cc.length ? { cc } : {}),
        date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : "",
        body: plainTextBody(m.payload),
      };
    });
  // Gmail already returns thread messages oldest-first; sort explicitly so a
  // future API quirk can't silently reorder the viewer.
  return messages.sort((a, b) => a.date.localeCompare(b.date));
}

export async function deleteGmailDraft(
  account: ConnectedAccount,
  draftId: string,
): Promise<void> {
  if (env.demoMode) {
    const store = await getDemoDraftStore();
    store[account.id] = (store[account.id] ?? []).filter((d) => d.id !== draftId);
    await setDemoDraftStore(store);
    invalidateGmailDraftsCache(account.id);
    emitServerEvent("drafts");
    return;
  }

  await proxyRequest(account.id, "delete", `${GMAIL_API}/drafts/${draftId}`);
  invalidateGmailDraftsCache(account.id);
  emitServerEvent("drafts");
}

/** RFC 2047 B-encoding — safe for any subject, including umlauts. */
function encodeHeaderWord(value: string): string {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/**
 * Build the RFC822 `raw` MIME message Gmail's drafts.create/drafts.update
 * both take. Recipients are already-joined header strings (not arrays) so a
 * caller preserving an existing draft's To/Cc/Bcc can pass the header value
 * straight through without a lossy split/rejoin round-trip.
 *
 * `extraHeaders` are emitted verbatim. drafts.update replaces the whole
 * message, so an updating caller must pass back every header it wants to
 * survive — see PRESERVED_HEADERS.
 */
function buildRawMessage(input: {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  extraHeaders?: string[];
}): string {
  const lines = [
    `To: ${input.to}`,
    ...(input.cc ? [`Cc: ${input.cc}`] : []),
    ...(input.bcc ? [`Bcc: ${input.bcc}`] : []),
    `Subject: ${encodeHeaderWord(input.subject)}`,
    ...(input.extraHeaders ?? []),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(input.body, "utf8").toString("base64"),
  ];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

/**
 * Headers an update must carry over from the existing draft. `In-Reply-To` and
 * `References` are what non-Gmail clients thread on (Gmail itself relies on
 * threadId); `From` and `Reply-To` carry the user's send-as alias, which would
 * silently fall back to their primary address if dropped.
 */
const PRESERVED_HEADERS = ["From", "Reply-To", "In-Reply-To", "References"] as const;

export interface CreateDraftInput {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  threadId?: string;
}

export async function createGmailDraft(
  account: ConnectedAccount,
  input: CreateDraftInput,
): Promise<{ draftId: string; messageId: string; threadId: string }> {
  if (env.demoMode) {
    const messageId = randomUUID().replace(/-/g, "");
    const threadId = input.threadId ?? randomUUID().replace(/-/g, "");
    const record: DemoDraftRecord = {
      id: randomUUID(),
      messageId,
      threadId,
      subject: input.subject,
      to: input.to.join(", "),
      ...(input.cc?.length ? { cc: input.cc.join(", ") } : {}),
      ...(input.bcc?.length ? { bcc: input.bcc.join(", ") } : {}),
      date: new Date().toISOString(),
      webUrl: gmailDraftUrl(account.name, messageId),
      body: input.body,
    };
    const store = await getDemoDraftStore();
    store[account.id] = [record, ...(store[account.id] ?? [])];
    await setDemoDraftStore(store);
    invalidateGmailDraftsCache(account.id);
    emitServerEvent("drafts");
    return { draftId: record.id, messageId, threadId };
  }

  const raw = buildRawMessage({
    to: input.to.join(", "),
    ...(input.cc?.length ? { cc: input.cc.join(", ") } : {}),
    ...(input.bcc?.length ? { bcc: input.bcc.join(", ") } : {}),
    subject: input.subject,
    body: input.body,
  });

  const res = (await proxyRequest(account.id, "post", `${GMAIL_API}/drafts`, {
    body: { message: { raw, ...(input.threadId ? { threadId: input.threadId } : {}) } },
  })) as { id: string; message: { id: string; threadId: string } };

  invalidateGmailDraftsCache(account.id);
  emitServerEvent("drafts");
  return { draftId: res.id, messageId: res.message.id, threadId: res.message.threadId };
}

/** Body of updateGmailDraft: only body/subject are overridable — everything else Gmail already has is preserved. */
export interface UpdateDraftInput {
  body?: string;
  subject?: string;
}

/**
 * Gmail's drafts.get (format=full), read for exactly the fields
 * updateGmailDraft needs to preserve when the caller doesn't override them.
 */
async function fetchGmailDraftFull(
  account: ConnectedAccount,
  draftId: string,
): Promise<{
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  threadId: string;
  extraHeaders: string[];
}> {
  const full = (await proxyRequest(account.id, "get", `${GMAIL_API}/drafts/${draftId}`, {
    params: { format: "full" },
  })) as {
    message?: { threadId?: string; payload?: MessagePart & { headers?: { name: string; value: string }[] } };
  };
  const payload = full.message?.payload;
  const header = headerLookup(payload);
  return {
    to: header("To"),
    cc: header("Cc"),
    bcc: header("Bcc"),
    subject: header("Subject"),
    body: plainTextBody(payload),
    threadId: full.message?.threadId ?? "",
    extraHeaders: PRESERVED_HEADERS.filter((name) => header(name)).map(
      (name) => `${name}: ${header(name)}`,
    ),
  };
}

/**
 * Save a draft's body/subject exactly as the caller passed them — no
 * humanizer, no signature (those are the create-draft tool's job, not this
 * endpoint's). Everything the caller doesn't override (to/cc/bcc/threadId,
 * PRESERVED_HEADERS) is fetched from the current draft first, since Gmail's
 * drafts.update replaces the whole message rather than patching headers.
 *
 * The rebuilt message is always text/plain. A draft composed in Gmail's own
 * web UI is text/html, so saving an edit to one converts it to the plain text
 * the editor showed — lossy for markup, but never for anything the user could
 * see or type here.
 */
export async function updateGmailDraft(
  account: ConnectedAccount,
  draftId: string,
  input: UpdateDraftInput,
): Promise<void> {
  if (env.demoMode) {
    const store = await getDemoDraftStore();
    const record = (store[account.id] ?? []).find((d) => d.id === draftId);
    if (!record) throw new Error("draft not found");
    if (input.body !== undefined) record.body = input.body;
    if (input.subject !== undefined) record.subject = input.subject;
    await setDemoDraftStore(store);
    invalidateGmailDraftsCache(account.id);
    emitServerEvent("drafts");
    return;
  }

  const current = await fetchGmailDraftFull(account, draftId);
  const raw = buildRawMessage({
    to: current.to,
    ...(current.cc ? { cc: current.cc } : {}),
    ...(current.bcc ? { bcc: current.bcc } : {}),
    subject: input.subject ?? current.subject,
    body: input.body ?? current.body,
    extraHeaders: current.extraHeaders,
  });

  await proxyRequest(account.id, "put", `${GMAIL_API}/drafts/${draftId}`, {
    body: { message: { raw, ...(current.threadId ? { threadId: current.threadId } : {}) } },
  });

  invalidateGmailDraftsCache(account.id);
  emitServerEvent("drafts");
}

/** This module's DraftProvider, for ../email/providers.ts's registry. */
export const gmailDraftProvider: DraftProvider = {
  listDrafts: listGmailDrafts,
  getDraftDetail: getGmailDraftDetail,
  async createDraft(account, input) {
    const result = await createGmailDraft(account, input);
    return { ...result, webUrl: gmailDraftUrl(account.name, result.messageId) };
  },
  deleteDraft: deleteGmailDraft,
  invalidateCache: invalidateGmailDraftsCache,
};

registerDraftProvider("gmail", gmailDraftProvider);
