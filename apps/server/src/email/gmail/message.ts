import { decodeHTML } from "entities";
import libmime from "libmime";
import { stripHtml } from "../textUtils.js";

/**
 * Gmail message-payload helpers shared by every file that reads the Gmail
 * REST API (drafts.ts, sync.ts, attachments.ts) — one
 * provider's wire format in one place.
 */

export const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

/** One Gmail MIME part — the superset of what drafts, sync and attachments each read. */
export interface MessagePart {
  filename?: string;
  mimeType?: string;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: MessagePart[];
}

type MessageHeaders = { headers?: { name: string; value: string }[] };

/** Case-insensitive header lookup, the way Gmail's `payload.headers` needs to be read. */
export function headerLookup(payload: MessageHeaders | undefined) {
  const headers = payload?.headers ?? [];
  return (name: string) =>
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
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
 * text/html with tags stripped (crude but serviceable for display). The one
 * MIME walker for every Gmail reader.
 */
export function plainTextBody(payload: MessagePart | undefined): string {
  const plain = findPart(payload, "text/plain");
  if (plain?.body?.data) return decodeBody(plain.body.data);
  const html = findPart(payload, "text/html");
  if (!html?.body?.data) return "";
  return stripHtml(decodeBody(html.body.data));
}

/** Decode the HTML entities Gmail escapes in `message.snippet` — named and
 * numeric alike; non-breaking spaces come back as plain spaces. */
export function decodeHtmlEntities(text: string): string {
  return decodeHTML(text).replace(/\u00a0/g, " ");
}

/**
 * Decode RFC 2047 encoded-words (`=?UTF-8?B?…?=`). Gmail's API returns
 * header values verbatim from the RFC 822 source, so a non-ASCII display
 * name or subject arrives encoded and would otherwise be mirrored as
 * gibberish. Values without an encoded-word marker pass through untouched;
 * a malformed encoding falls back to the raw value rather than failing the
 * message it rode in on. Display-path only — code that reuses headers to
 * rebuild raw MIME (drafts.ts) must keep them verbatim.
 */
export function decodeHeaderText(value: string): string {
  if (!value.includes("=?")) return value;
  try {
    return libmime.decodeWords(value);
  } catch {
    return value;
  }
}
