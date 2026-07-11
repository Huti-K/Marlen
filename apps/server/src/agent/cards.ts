import {
  type AgentCard,
  BRIEFING_PRIORITIES,
  type BriefingItem,
  type BriefingPriority,
  type BriefingRollup,
  type CardAccount,
  type ConnectedAccount,
  type DraftPreview,
  type EmailHit,
  type EmailThreadMessage,
  type MessageCard,
} from "@trailin/shared";
import { splitAddressList } from "../email/textUtils.js";

/**
 * Turns tool `details` payloads into `AgentCard`s the chat can render, and
 * validates them on the way out. Two entry points:
 * - `parseAgentCard` is the last line of defense before a card reaches the
 *   client: `details` is `unknown` by the time it gets here (it round-trips
 *   through pi's event stream as `any`), so every field is checked rather
 *   than trusted, and nothing here ever throws.
 * - `cardFromMcpResult` is the live-Pipedream path: it normalizes whatever a
 *   Gmail MCP tool returned into the same shapes, then `parseAgentCard`
 *   validates the result like anything else.
 */

const SNIPPET_LENGTH = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** Coerces a header-ish value (string, string[], or anything else) to string[]. */
function toStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const arr = value.filter(isString);
    return arr.length > 0 ? arr : undefined;
  }
  return isString(value) && value.length > 0 ? [value] : undefined;
}

function truncateSnippet(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > SNIPPET_LENGTH
    ? `${collapsed.slice(0, SNIPPET_LENGTH).trimEnd()}…`
    : collapsed;
}

/** Maps a resolved connected account onto the card's account slot. */
export function toCardAccount(account: ConnectedAccount): CardAccount {
  return {
    accountId: account.id,
    name: account.name,
    app: account.app,
    appName: account.appName,
    imgSrc: account.imgSrc,
  };
}

function parseCardAccount(value: unknown): CardAccount | undefined {
  if (!isRecord(value)) return undefined;
  const { accountId, name, app, appName, imgSrc } = value;
  if (!isString(accountId) || !isString(name) || !isString(app)) return undefined;
  return {
    accountId,
    name,
    app,
    ...(isString(appName) ? { appName } : {}),
    ...(isString(imgSrc) ? { imgSrc } : {}),
  };
}

function parseEmailHit(value: unknown): EmailHit | undefined {
  if (!isRecord(value)) return undefined;
  const { messageId, threadId, subject, from, to, date, snippet } = value;
  if (!isString(messageId) || !isString(threadId) || !isString(from)) return undefined;
  return {
    messageId,
    threadId,
    subject: isString(subject) ? subject : "",
    from,
    to: toStringArray(to) ?? [],
    date: isString(date) ? date : "",
    snippet: isString(snippet) ? snippet : "",
  };
}

function parseEmailThreadMessage(value: unknown): EmailThreadMessage | undefined {
  if (!isRecord(value)) return undefined;
  const { from, to, cc, date, body } = value;
  if (!isString(from) || !isString(body)) return undefined;
  const ccList = toStringArray(cc);
  return {
    from,
    to: toStringArray(to) ?? [],
    ...(ccList ? { cc: ccList } : {}),
    date: isString(date) ? date : "",
    body,
  };
}

function isBriefingPriority(value: unknown): value is BriefingPriority {
  return typeof value === "string" && (BRIEFING_PRIORITIES as readonly string[]).includes(value);
}

function parseBriefingItem(value: unknown): BriefingItem | undefined {
  if (!isRecord(value)) return undefined;
  const {
    threadId,
    messageId,
    accountId,
    sender,
    senderEmail,
    subject,
    gist,
    priority,
    deadline,
    receivedAt,
    draftId,
  } = value;
  if (!isString(threadId) || !isString(sender) || !isString(subject) || !isString(gist))
    return undefined;
  return {
    threadId,
    ...(isString(messageId) ? { messageId } : {}),
    ...(isString(accountId) ? { accountId } : {}),
    sender,
    ...(isString(senderEmail) ? { senderEmail } : {}),
    subject,
    gist,
    // An unrecognized priority degrades to the least-pressing tier rather
    // than dropping the whole item.
    priority: isBriefingPriority(priority) ? priority : "fyi",
    ...(isString(deadline) ? { deadline } : {}),
    ...(isString(receivedAt) ? { receivedAt } : {}),
    ...(isString(draftId) ? { draftId } : {}),
  };
}

function parseBriefingRollup(value: unknown): BriefingRollup | undefined {
  if (!isRecord(value)) return undefined;
  const { accountId, label, count, examples } = value;
  if (!isString(label) || typeof count !== "number" || !Number.isFinite(count)) return undefined;
  const exampleList = toStringArray(examples);
  return {
    ...(isString(accountId) ? { accountId } : {}),
    label,
    count,
    ...(exampleList ? { examples: exampleList } : {}),
  };
}

function parseDraftPreview(value: unknown): DraftPreview | undefined {
  if (!isRecord(value)) return undefined;
  const { draftId, threadId, subject, to, cc, bcc, body, webUrl, signatureAppended } = value;
  if (!isString(draftId) || !isString(subject) || !isString(body)) return undefined;
  const ccList = toStringArray(cc);
  const bccList = toStringArray(bcc);
  return {
    draftId,
    ...(isString(threadId) ? { threadId } : {}),
    subject,
    to: toStringArray(to) ?? [],
    ...(ccList ? { cc: ccList } : {}),
    ...(bccList ? { bcc: bccList } : {}),
    body,
    ...(isString(webUrl) ? { webUrl } : {}),
    ...(typeof signatureAppended === "boolean" ? { signatureAppended } : {}),
  };
}

/**
 * Defensive runtime guard for a tool's `details` value. `details` is
 * `unknown` — it may come from our own code (trusted shape, but still
 * crosses an `any` boundary in pi's event stream) or, via
 * `cardFromMcpResult`, from an MCP server we don't control. Coerces what it
 * can, drops anything malformed, and returns `undefined` for anything it
 * doesn't recognize rather than throwing or forwarding a half-built card.
 */
export function parseAgentCard(details: unknown): AgentCard | undefined {
  try {
    if (!isRecord(details)) return undefined;
    const account = parseCardAccount(details.account);

    switch (details.kind) {
      case "email_hits": {
        if (!Array.isArray(details.hits)) return undefined;
        const hits = details.hits.map(parseEmailHit).filter((h): h is EmailHit => h !== undefined);
        return {
          kind: "email_hits",
          ...(account ? { account } : {}),
          ...(isString(details.query) ? { query: details.query } : {}),
          hits,
          ...(typeof details.truncated === "boolean" ? { truncated: details.truncated } : {}),
        };
      }
      case "email_thread": {
        if (!isString(details.threadId) || !Array.isArray(details.messages)) return undefined;
        const messages = details.messages
          .map(parseEmailThreadMessage)
          .filter((m): m is EmailThreadMessage => m !== undefined);
        return {
          kind: "email_thread",
          ...(account ? { account } : {}),
          threadId: details.threadId,
          subject: isString(details.subject) ? details.subject : "",
          messages,
        };
      }
      case "email_draft": {
        const draft = parseDraftPreview(details.draft);
        if (!draft) return undefined;
        return { kind: "email_draft", ...(account ? { account } : {}), draft };
      }
      case "briefing": {
        // Unlike the other kinds, a briefing carries every account it
        // touched as an array rather than the single optional `account`
        // parsed above — that variable is unused in this arm.
        if (!Array.isArray(details.items)) return undefined;
        const items = details.items
          .map(parseBriefingItem)
          .filter((i): i is BriefingItem => i !== undefined);
        const accountsList = Array.isArray(details.accounts)
          ? details.accounts.map(parseCardAccount).filter((a): a is CardAccount => a !== undefined)
          : undefined;
        const rollups = Array.isArray(details.rollups)
          ? details.rollups
              .map(parseBriefingRollup)
              .filter((r): r is BriefingRollup => r !== undefined)
          : undefined;
        return {
          kind: "briefing",
          ...(isString(details.headline) ? { headline: details.headline } : {}),
          ...(isString(details.periodLabel) ? { periodLabel: details.periodLabel } : {}),
          ...(accountsList && accountsList.length > 0 ? { accounts: accountsList } : {}),
          items,
          ...(rollups && rollups.length > 0 ? { rollups } : {}),
          ...(typeof details.scanned === "number" ? { scanned: details.scanned } : {}),
        };
      }
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}

/**
 * Parses a messages.cards JSON blob back into validated cards for the API.
 * Same trust posture as parseAgentCard: the column is our own write, but it
 * round-trips through JSON, so anything malformed is dropped rather than
 * crashing message restore.
 */
export function parseStoredCards(raw: string | null | undefined): MessageCard[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    const cards: MessageCard[] = [];
    for (const entry of parsed) {
      if (!isRecord(entry) || !isString(entry.toolCallId)) continue;
      const card = parseAgentCard(entry.card);
      if (card) cards.push({ toolCallId: entry.toolCallId, card });
    }
    return cards.length > 0 ? cards : undefined;
  } catch {
    return undefined;
  }
}

// ---- cardFromMcpResult: best-effort Gmail normalization ----
//
// This is guesswork until we can observe a real Pipedream Gmail MCP payload.
// Pipedream's tool-mode responses aren't documented down to the byte for
// every action, so this tries the two shapes that are plausible (an MCP
// `structuredContent` record, or the provider's raw JSON stuffed into a text
// content block) and gives up rather than guessing further. On failure the
// tool call still succeeds — the model keeps its text result, the chat just
// falls back to the plain tool badge instead of a card.

function headerValue(headers: unknown, name: string): string | undefined {
  if (!Array.isArray(headers)) return undefined;
  for (const h of headers) {
    if (
      isRecord(h) &&
      isString(h.name) &&
      isString(h.value) &&
      h.name.toLowerCase() === name.toLowerCase()
    ) {
      return h.value;
    }
  }
  return undefined;
}

function decodeBase64Url(data: string): string | undefined {
  try {
    return Buffer.from(data, "base64url").toString("utf8");
  } catch {
    return undefined;
  }
}

/** Depth-first search for the first text/plain part's decoded body (Gmail message payload shape). */
function findPlainTextBody(part: unknown): string | undefined {
  if (!isRecord(part)) return undefined;
  if (part.mimeType === "text/plain" && isRecord(part.body) && isString(part.body.data)) {
    const decoded = decodeBase64Url(part.body.data);
    if (decoded) return decoded;
  }
  if (Array.isArray(part.parts)) {
    for (const child of part.parts) {
      const found = findPlainTextBody(child);
      if (found) return found;
    }
  }
  return undefined;
}

interface GmailFields {
  messageId?: string;
  threadId?: string;
  from: string;
  to: string[];
  cc: string[];
  date: string;
  subject: string;
  snippet: string;
  body: string;
}

/** Loosely extracts what a card needs from one Gmail API "Message"-shaped object. */
function gmailMessageFields(raw: unknown): GmailFields | undefined {
  if (!isRecord(raw)) return undefined;
  const payload = isRecord(raw.payload) ? raw.payload : undefined;
  const headers = payload?.headers;

  const from = headerValue(headers, "from") ?? (isString(raw.from) ? raw.from : undefined);
  if (!from) return undefined;

  const to = splitAddressList(headerValue(headers, "to") ?? (isString(raw.to) ? raw.to : ""));
  const cc = splitAddressList(headerValue(headers, "cc") ?? (isString(raw.cc) ? raw.cc : ""));
  const subject = headerValue(headers, "subject") ?? (isString(raw.subject) ? raw.subject : "");

  const dateHeader = headerValue(headers, "date");
  const internalDate = isString(raw.internalDate) ? raw.internalDate : undefined;
  const date =
    dateHeader ??
    (internalDate && /^\d+$/.test(internalDate)
      ? new Date(Number(internalDate)).toISOString()
      : isString(raw.date)
        ? raw.date
        : "");

  const rawSnippet = isString(raw.snippet) ? raw.snippet : "";
  const bodyText = (payload ? findPlainTextBody(payload) : undefined) ?? "";

  return {
    messageId: isString(raw.id) ? raw.id : isString(raw.messageId) ? raw.messageId : undefined,
    threadId: isString(raw.threadId) ? raw.threadId : undefined,
    from,
    to,
    cc,
    date,
    subject,
    snippet: truncateSnippet(rawSnippet || bodyText),
    body: bodyText || rawSnippet,
  };
}

function extractStructuredData(result: unknown): Record<string, unknown> | undefined {
  if (!isRecord(result)) return undefined;
  if (isRecord(result.structuredContent)) return result.structuredContent;

  // Fall back to the first text content block — Pipedream tools often stuff
  // the raw provider JSON in there instead of (or alongside) structuredContent.
  const content = result.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (isRecord(block) && block.type === "text" && isString(block.text)) {
        try {
          const parsed: unknown = JSON.parse(block.text);
          if (Array.isArray(parsed)) return { messages: parsed };
          if (isRecord(parsed)) return parsed;
        } catch {
          // Not JSON — a prose text block, nothing to extract.
        }
      }
    }
  }
  return undefined;
}

function firstArray(data: Record<string, unknown>, keys: string[]): unknown[] | undefined {
  for (const key of keys) {
    if (Array.isArray(data[key])) return data[key] as unknown[];
  }
  return undefined;
}

function cardFromFindEmail(
  account: CardAccount,
  data: Record<string, unknown>,
): AgentCard | undefined {
  const list = firstArray(data, ["messages", "results", "items", "hits"]);
  if (!list) return undefined;
  const hits: EmailHit[] = [];
  for (const entry of list) {
    const fields = gmailMessageFields(entry);
    if (!fields?.messageId || !fields.threadId) continue;
    hits.push({
      messageId: fields.messageId,
      threadId: fields.threadId,
      subject: fields.subject,
      from: fields.from,
      to: fields.to,
      date: fields.date,
      snippet: fields.snippet,
    });
  }
  return hits.length > 0 ? { kind: "email_hits", account, hits } : undefined;
}

function cardFromGetThread(
  account: CardAccount,
  data: Record<string, unknown>,
): AgentCard | undefined {
  const list = firstArray(data, ["messages"]);
  const threadId = isString(data.id)
    ? data.id
    : isString(data.threadId)
      ? data.threadId
      : undefined;
  if (!list || !threadId) return undefined;

  const messages: EmailThreadMessage[] = [];
  let subject = "";
  for (const entry of list) {
    const fields = gmailMessageFields(entry);
    if (!fields) continue;
    if (!subject && fields.subject) subject = fields.subject;
    messages.push({
      from: fields.from,
      to: fields.to,
      ...(fields.cc.length > 0 ? { cc: fields.cc } : {}),
      date: fields.date,
      body: fields.body,
    });
  }
  return messages.length > 0
    ? { kind: "email_thread", account, threadId, subject, messages }
    : undefined;
}

function cardFromGetEmail(
  account: CardAccount,
  data: Record<string, unknown>,
): AgentCard | undefined {
  const fields = gmailMessageFields(data);
  if (!fields?.threadId) return undefined;
  return {
    kind: "email_thread",
    account,
    threadId: fields.threadId,
    subject: fields.subject,
    messages: [
      {
        from: fields.from,
        to: fields.to,
        ...(fields.cc.length > 0 ? { cc: fields.cc } : {}),
        date: fields.date,
        body: fields.body,
      },
    ],
  };
}

/**
 * Best-effort normalizer for live Pipedream Gmail results. `action` is the
 * MCP tool name with the `${app}-` prefix stripped (e.g. "find-email"). Only
 * the three actions we know how to shape into a card are handled; everything
 * else — and anything that doesn't parse as expected — returns `undefined`
 * and the tool call still succeeds, just without a card.
 */
export function cardFromMcpResult(
  action: string,
  account: CardAccount,
  result: unknown,
): AgentCard | undefined {
  try {
    const data = extractStructuredData(result);
    if (!data) return undefined;
    switch (action) {
      case "find-email":
        return cardFromFindEmail(account, data);
      case "get-thread":
        return cardFromGetThread(account, data);
      case "get-email":
        return cardFromGetEmail(account, data);
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}
