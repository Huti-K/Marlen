import { decodeHTML } from "entities";
import { stripHtml } from "./textUtils.js";

/**
 * Gmail message-payload helpers shared by every file that reads the Gmail
 * REST API (gmailDrafts.ts, gmailSync.ts, gmailAttachments.ts) — one
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

export type MessageHeaders = { headers?: { name: string; value: string }[] };

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
