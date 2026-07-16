import { randomUUID } from "node:crypto";
import type { ConnectedAccount, EmailDraft } from "@trailin/shared";
import { moduleLogger } from "../../logger.js";
import { proxyRequest } from "../../pipedream/connect.js";
import { contentDisposition } from "../../routes/fileResponse.js";
import { draftsMutated } from "../draftsService.js";
import type {
  CreateDraftInput,
  DraftAttachment,
  DraftProvider,
  SendDraftResult,
  UpdateDraftPatch,
} from "../providers.js";
import { gmailDraftUrl } from "../webLinks.js";
import {
  decodeHtmlEntities,
  GMAIL_API,
  headerLookup,
  type MessagePart,
  plainTextBody,
  type ThreadGetResponse,
} from "./message.js";

/**
 * Gmail drafts via the Connect proxy (plain Gmail REST API). Pipedream's
 * prebuilt create-draft component requires a paid workspace (File Stash);
 * the proxy works on every plan and returns clean JSON.
 *
 * Registered as the "gmail" DraftProvider by ../registerProviders.ts;
 * gmailDraftProvider is this module's entire interface.
 *
 * `listDrafts` is a pure live fetch — no caching in here. Caching lives one
 * layer up in ../draftsService.ts, shared across every provider; every
 * mutation below ends with its `draftsMutated` epilogue (invalidate, then
 * emit "drafts") so the SSE-driven refetch isn't served the old list.
 */

const log = moduleLogger("gmail-drafts");

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

async function listGmailDrafts(account: ConnectedAccount, limit = 15): Promise<EmailDraft[]> {
  const list = (await proxyRequest(account.id, "get", `${GMAIL_API}/drafts`, {
    params: { maxResults: String(limit) },
  })) as DraftsListResponse;

  // Fetch each draft's metadata in parallel — independent Gmail round-trips;
  // the list should wait on the slowest one, not the sum of all of them.
  const settled = await Promise.all(
    (list.drafts ?? []).map(async (entry): Promise<EmailDraft | null> => {
      try {
        const full = (await proxyRequest(account.id, "get", `${GMAIL_API}/drafts/${entry.id}`, {
          params: { format: "metadata" },
        })) as DraftGetResponse;
        const header = headerLookup(full.message?.payload);
        const snippet = decodeHtmlEntities(full.message?.snippet ?? "").trim();
        return {
          id: entry.id,
          messageId: entry.message.id,
          threadId: entry.message.threadId,
          subject: header("Subject"),
          to: header("To"),
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
  return settled
    .filter((d): d is EmailDraft => d !== null)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Full content of one draft, for the in-app viewer. */
async function getGmailDraftDetail(
  account: ConnectedAccount,
  draftId: string,
): Promise<{ body: string; cc: string; bcc: string }> {
  const full = (await proxyRequest(account.id, "get", `${GMAIL_API}/drafts/${draftId}`, {
    params: { format: "full" },
  })) as {
    message?: { payload?: MessagePart & { headers?: { name: string; value: string }[] } };
  };
  const payload = full.message?.payload;
  const header = headerLookup(payload);
  return { body: plainTextBody(payload), cc: header("Cc"), bcc: header("Bcc") };
}

async function deleteGmailDraft(account: ConnectedAccount, draftId: string): Promise<void> {
  await proxyRequest(account.id, "delete", `${GMAIL_API}/drafts/${draftId}`);
  draftsMutated(account.id);
}

/** RFC 2047 B-encoding — safe for any subject, including umlauts. */
function encodeHeaderWord(value: string): string {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/**
 * To/Cc/Bcc reach buildRawMessage as raw strings interpolated straight into
 * an RFC822 header line, and ultimately trace back to LLM tool params
 * (mcp.ts's buildDraftTool passes model-supplied recipients through
 * unchanged) — a prompt-injected email could steer the agent into a
 * recipient value containing a CR/LF, smuggling an extra header (e.g. a
 * hidden `Bcc:`) into the message. Reject rather than silently strip, so the
 * caller sees a clear failure instead of a silently rewritten recipient list.
 */
function assertSafeHeaderValue(header: string, value: string): void {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matches CR/LF and other control characters to reject header-injection attempts (see comment above)
  if (/[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`Invalid ${header} header value: contains a line break or control character.`);
  }
}

/**
 * Body headers + base64 content of the text part every raw message carries —
 * emitted at the top level of a single-part message, or as the first part of
 * a multipart/mixed one, so a message without attachments keeps the exact
 * byte layout it always had.
 */
function textPartLines(body: string, bodyFormat?: "text" | "html"): string[] {
  return [
    `Content-Type: text/${bodyFormat === "html" ? "html" : "plain"}; charset=UTF-8`,
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(body, "utf8").toString("base64"),
  ];
}

/**
 * One attachment as MIME part lines (without boundary delimiters). The
 * Content-Disposition carries an ASCII `filename` fallback plus the exact
 * name via RFC 5987/6266 `filename*`, so names like "Exposé.pdf" survive.
 */
function attachmentPartLines(attachment: DraftAttachment): string[] {
  // Filenames trace back to library file names on disk; a CR/LF in one would
  // smuggle extra MIME headers, same as a recipient (see assertSafeHeaderValue).
  assertSafeHeaderValue("attachment filename", attachment.filename);
  const ascii = attachment.filename.replace(/[\\"]/g, "").replace(/[^\x20-\x7e]/g, "_");
  return [
    `Content-Type: ${attachment.mimeType}; name="${ascii}"`,
    `Content-Disposition: ${contentDisposition("attachment", attachment.filename)}`,
    "Content-Transfer-Encoding: base64",
    "",
    attachment.content.toString("base64"),
  ];
}

/**
 * Build the RFC822 `raw` MIME message Gmail's drafts.create/drafts.update
 * both take. Recipients are already-joined header strings (not arrays) so a
 * caller preserving an existing draft's To/Cc/Bcc can pass the header value
 * straight through without a lossy split/rejoin round-trip.
 *
 * `extraHeaders` are emitted verbatim, always at the top level (so
 * In-Reply-To/References keep threading intact whether or not the message is
 * multipart). drafts.update replaces the whole message, so an updating caller
 * must pass back every header it wants to survive — see PRESERVED_HEADERS.
 *
 * With attachments the message becomes multipart/mixed: the text body part
 * first, then one part per attachment. Without them the output is the same
 * single-part message as ever.
 */
function buildRawMessage(input: {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  extraHeaders?: string[];
  bodyFormat?: "text" | "html";
  attachments?: DraftAttachment[];
}): string {
  assertSafeHeaderValue("To", input.to);
  if (input.cc) assertSafeHeaderValue("Cc", input.cc);
  if (input.bcc) assertSafeHeaderValue("Bcc", input.bcc);

  const headerLines = [
    `To: ${input.to}`,
    ...(input.cc ? [`Cc: ${input.cc}`] : []),
    ...(input.bcc ? [`Bcc: ${input.bcc}`] : []),
    `Subject: ${encodeHeaderWord(input.subject)}`,
    ...(input.extraHeaders ?? []),
    "MIME-Version: 1.0",
  ];

  const lines =
    input.attachments && input.attachments.length > 0
      ? [...headerLines, ...multipartMixedLines(input.body, input.bodyFormat, input.attachments)]
      : [...headerLines, ...textPartLines(input.body, input.bodyFormat)];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

/** The multipart/mixed body: text part first, then one part per attachment. */
function multipartMixedLines(
  body: string,
  bodyFormat: "text" | "html" | undefined,
  attachments: DraftAttachment[],
): string[] {
  const boundary = `part-${randomUUID()}`;
  return [
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    ...textPartLines(body, bodyFormat),
    ...attachments.flatMap((attachment) => [`--${boundary}`, ...attachmentPartLines(attachment)]),
    `--${boundary}--`,
  ];
}

/**
 * Headers an update must carry over from the existing draft. `In-Reply-To` and
 * `References` are what non-Gmail clients thread on (Gmail itself relies on
 * threadId); `From` and `Reply-To` carry the user's send-as alias, which would
 * silently fall back to their primary address if dropped.
 */
const PRESERVED_HEADERS = ["From", "Reply-To", "In-Reply-To", "References"] as const;

/**
 * In-Reply-To/References for a reply draft, read from the thread's last
 * non-draft message — what non-Gmail clients thread on (Gmail itself relies
 * on the threadId createGmailDraft already sets). Drafts already sitting in
 * the thread (e.g. one started manually in Gmail) are skipped: they're
 * unsent and have no meaningful Message-ID to reply to. Returns undefined on
 * any failure, or if the thread has no usable message — createGmailDraft
 * falls back silently to its current threadId-only behavior rather than
 * blocking the draft on this lookup.
 */
async function lastMessageThreadingHeaders(
  account: ConnectedAccount,
  threadId: string,
): Promise<{ inReplyTo: string; references: string } | undefined> {
  try {
    const res = (await proxyRequest(account.id, "get", `${GMAIL_API}/threads/${threadId}`, {
      params: { format: "full" },
    })) as ThreadGetResponse;
    const messages = (res.messages ?? []).filter((m) => !m.labelIds?.includes("DRAFT"));
    const last = messages[messages.length - 1];
    if (!last) return undefined;
    const header = headerLookup(last.payload);
    const inReplyTo = header("Message-ID");
    if (!inReplyTo) return undefined;
    const references = [header("References"), inReplyTo].filter(Boolean).join(" ");
    return { inReplyTo, references };
  } catch (error) {
    log.warn(
      { err: error, accountId: account.id, threadId },
      "reply threading headers lookup failed",
    );
    return undefined;
  }
}

async function createGmailDraft(
  account: ConnectedAccount,
  input: CreateDraftInput,
): Promise<{ draftId: string; messageId: string; threadId: string }> {
  const threadingHeaders = input.threadId
    ? await lastMessageThreadingHeaders(account, input.threadId)
    : undefined;

  const raw = buildRawMessage({
    to: input.to.join(", "),
    ...(input.cc?.length ? { cc: input.cc.join(", ") } : {}),
    ...(input.bcc?.length ? { bcc: input.bcc.join(", ") } : {}),
    subject: input.subject,
    body: input.body,
    ...(input.bodyFormat ? { bodyFormat: input.bodyFormat } : {}),
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
    ...(threadingHeaders
      ? {
          extraHeaders: [
            `In-Reply-To: ${threadingHeaders.inReplyTo}`,
            `References: ${threadingHeaders.references}`,
          ],
        }
      : {}),
  });

  const res = (await proxyRequest(account.id, "post", `${GMAIL_API}/drafts`, {
    body: { message: { raw, ...(input.threadId ? { threadId: input.threadId } : {}) } },
  })) as { id: string; message: { id: string; threadId: string } };

  draftsMutated(account.id);
  return { draftId: res.id, messageId: res.message.id, threadId: res.message.threadId };
}

/**
 * Depth-first walk collecting every part with a non-empty filename — Gmail's
 * own definition of "this part is an attachment" (mirrors
 * ./attachments.ts's collectAttachments). Small parts carry their bytes
 * inline as base64url `body.data`; larger ones only a `body.attachmentId`.
 */
function collectAttachmentParts(
  part: MessagePart | undefined,
  out: { filename: string; mimeType: string; data?: string; attachmentId?: string }[],
): void {
  if (!part) return;
  if (part.filename) {
    out.push({
      filename: part.filename,
      mimeType: part.mimeType ?? "application/octet-stream",
      ...(part.body?.data ? { data: part.body.data } : {}),
      ...(part.body?.attachmentId ? { attachmentId: part.body.attachmentId } : {}),
    });
  }
  for (const child of part.parts ?? []) collectAttachmentParts(child, out);
}

/**
 * The draft message's attachments with their bytes resolved — inline parts
 * decoded directly, ref-only parts downloaded via the attachments endpoint.
 * updateGmailDraft re-embeds these when it rebuilds the raw message, since
 * drafts.update replaces the whole message and would otherwise drop them.
 */
async function fetchDraftAttachments(
  account: ConnectedAccount,
  messageId: string,
  payload: MessagePart | undefined,
): Promise<DraftAttachment[]> {
  const parts: { filename: string; mimeType: string; data?: string; attachmentId?: string }[] = [];
  collectAttachmentParts(payload, parts);

  const resolved: DraftAttachment[] = [];
  for (const part of parts) {
    let content: Buffer;
    if (part.data) {
      content = Buffer.from(part.data, "base64url");
    } else if (part.attachmentId) {
      const fetched = (await proxyRequest(
        account.id,
        "get",
        `${GMAIL_API}/messages/${messageId}/attachments/${part.attachmentId}`,
      )) as { data?: string };
      if (!fetched.data) {
        throw new Error(`Gmail returned no data for attachment "${part.filename}".`);
      }
      content = Buffer.from(fetched.data, "base64url");
    } else {
      continue;
    }
    resolved.push({ filename: part.filename, mimeType: part.mimeType, content });
  }
  return resolved;
}

/**
 * Gmail's drafts.get (format=full), read for exactly the fields
 * updateGmailDraft needs to preserve when the caller doesn't override them —
 * including the draft's attachments, with bytes.
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
  attachments: DraftAttachment[];
}> {
  const full = (await proxyRequest(account.id, "get", `${GMAIL_API}/drafts/${draftId}`, {
    params: { format: "full" },
  })) as {
    message?: {
      id?: string;
      threadId?: string;
      payload?: MessagePart & { headers?: { name: string; value: string }[] };
    };
  };
  const payload = full.message?.payload;
  const header = headerLookup(payload);
  const messageId = full.message?.id;
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
    attachments: messageId ? await fetchDraftAttachments(account, messageId, payload) : [],
  };
}

/**
 * Save a draft's body/subject exactly as the caller passed them — no
 * humanizer, no signature (those are the create-draft tool's job, not this
 * endpoint's). Everything the caller doesn't override (to/cc/bcc/threadId,
 * PRESERVED_HEADERS, attachments) is fetched from the current draft first,
 * since Gmail's drafts.update replaces the whole message rather than
 * patching headers.
 *
 * The rebuilt message is always text/plain. A draft composed in Gmail's own
 * web UI is text/html, so saving an edit to one converts it to the plain text
 * the editor showed — lossy for markup, but never for anything the user could
 * see or type here.
 */
async function updateGmailDraft(
  account: ConnectedAccount,
  draftId: string,
  input: UpdateDraftPatch,
): Promise<void> {
  const current = await fetchGmailDraftFull(account, draftId);
  const raw = buildRawMessage({
    to: current.to,
    ...(current.cc ? { cc: current.cc } : {}),
    ...(current.bcc ? { bcc: current.bcc } : {}),
    subject: input.subject ?? current.subject,
    body: input.body ?? current.body,
    extraHeaders: current.extraHeaders,
    ...(current.attachments.length > 0 ? { attachments: current.attachments } : {}),
  });

  await proxyRequest(account.id, "put", `${GMAIL_API}/drafts/${draftId}`, {
    body: { message: { raw, ...(current.threadId ? { threadId: current.threadId } : {}) } },
  });

  draftsMutated(account.id);
}

/**
 * Dispatch an existing draft via Gmail's drafts.send. Gmail returns the sent
 * message's id, which the caller records on the draft snapshot so the
 * learning loop never has to match this send.
 */
async function sendGmailDraft(
  account: ConnectedAccount,
  draftId: string,
): Promise<SendDraftResult> {
  const res = (await proxyRequest(account.id, "post", `${GMAIL_API}/drafts/send`, {
    body: { id: draftId },
  })) as { id?: string };
  draftsMutated(account.id);
  return res.id ? { sentMessageId: res.id } : {};
}

/** This module's DraftProvider — and its entire interface (registered by ../registerProviders.ts). */
export const gmailDraftProvider: DraftProvider = {
  listDrafts: listGmailDrafts,
  getDraftDetail: getGmailDraftDetail,
  async createDraft(account, input) {
    const result = await createGmailDraft(account, input);
    return { ...result, webUrl: gmailDraftUrl(account.name, result.messageId) };
  },
  deleteDraft: deleteGmailDraft,
  updateDraft: updateGmailDraft,
  sendDraft: sendGmailDraft,
};
