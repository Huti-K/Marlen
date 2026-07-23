import { createHash } from "node:crypto";
import { EMAIL_BODY_FONT_FAMILY } from "@marlen/shared";
import addrs from "email-addresses";
import { type HtmlToTextOptions, htmlToText } from "html-to-text";
import type { InlineImage } from "./providers.js";

/** Keep link text but drop hrefs and images; keep heading case (html-to-text uppercases headings by default). */
const STRIP_HTML_OPTIONS: HtmlToTextOptions = {
  wordwrap: false,
  selectors: [
    { selector: "a", options: { ignoreHref: true } },
    { selector: "img", format: "skip" },
    ...["h1", "h2", "h3", "h4", "h5", "h6"].map((selector) => ({
      selector,
      options: { uppercase: false },
    })),
  ],
};

export function stripHtml(html: string): string {
  return htmlToText(html, STRIP_HTML_OPTIONS).trim();
}

/** Unstyled HTML falls back to per-client serif defaults (Times in classic Outlook), so body and signature share one wrapper style. */
const EMAIL_BODY_STYLE = `font-family:${EMAIL_BODY_FONT_FAMILY};font-size:14px;line-height:1.5`;

const DATA_URI_IMG =
  /(<img\b[^>]*?\bsrc\s*=\s*)(["'])data:(image\/[a-z0-9.+-]+);base64,([^"']*)\2/gi;

/**
 * Receiving clients (Outlook desktop, Gmail's message view) block or strip
 * data: images, so each becomes a cid: reference resolved by an inline part.
 * Content ids hash the bytes: identical images dedupe, and an unchanged
 * signature keeps stable ids across draft updates.
 */
function extractInlineImages(html: string): { html: string; images: InlineImage[] } {
  const byContentId = new Map<string, InlineImage>();
  const replaced = html.replace(
    DATA_URI_IMG,
    (_match, prefix: string, quote: string, mimeType: string, base64: string) => {
      const content = Buffer.from(base64, "base64");
      const contentId = `${createHash("sha256").update(content).digest("hex").slice(0, 16)}@marlen`;
      if (!byContentId.has(contentId)) {
        const extension = mimeType.slice("image/".length).split("+")[0] || "img";
        byContentId.set(contentId, {
          contentId,
          filename: `signature-${byContentId.size + 1}.${extension}`,
          mimeType,
          content,
        });
      }
      return `${prefix}${quote}cid:${contentId}${quote}`;
    },
  );
  return { html: replaced, images: [...byContentId.values()] };
}

/**
 * Plain agent prose and the account's signature as one outgoing HTML body:
 * escaped body above the signature (mirroring a mail client's placement), both
 * in one styled wrapper, the signature's data-URI images extracted to cid
 * references the caller must pass on as inlineImages.
 */
export function htmlBodyWithSignature(
  body: string,
  signatureHtml: string,
): { html: string; images: InlineImage[] } {
  const escaped = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
  const { html: signature, images } = extractInlineImages(signatureHtml);
  return {
    html: `<div style="${EMAIL_BODY_STYLE}">${escaped}<br><br>${signature}</div>`,
    images,
  };
}

/**
 * Closing phrases a body may end on. Deliberately whole-line and anchored:
 * "Viele Grüße aus Berlin" is content and never matches.
 */
const CLOSING_PHRASE =
  /^(mit freundlichen grüßen|freundliche grüße|viele grüße|beste grüße|liebe grüße|herzliche grüße|schöne grüße|grüße|gruß|mfg|vg|lg|(with )?(best|kind|warm)(est)? regards|best wishes|regards|sincerely( yours)?|yours (sincerely|truly)|cheers|(many )?thanks|thank you|best)$/;

function normalizeSignoffLine(line: string): string {
  return line
    .replace(/\s+/g, " ")
    .replace(/[\s,.!;:]+$/, "")
    .trim()
    .toLowerCase();
}

/**
 * Drop a model-written trailing sign-off that the account signature already
 * carries, so the appended signature never doubles it: trailing lines equal to
 * a signature line always go (name, contact block), and a trailing closing
 * phrase goes only when the signature brings a closing line of its own. A
 * closing the signature does not duplicate stays in the body, like a human
 * typing "Viele Grüße" above their mail client's auto-signature.
 */
export function stripDuplicateSignoff(body: string, signatureText: string): string {
  const signatureLines = new Set(
    signatureText.split("\n").map(normalizeSignoffLine).filter(Boolean),
  );
  if (signatureLines.size === 0) return body;
  const signatureHasClosing = [...signatureLines].some((line) => CLOSING_PHRASE.test(line));

  const lines = body.split("\n");
  let end = lines.length;
  while (end > 0) {
    const normalized = normalizeSignoffLine(lines[end - 1] ?? "");
    if (!normalized) {
      end--;
      continue;
    }
    if (
      !signatureLines.has(normalized) &&
      !(signatureHasClosing && CLOSING_PHRASE.test(normalized))
    ) {
      break;
    }
    end--;
  }
  const trimmed = lines.slice(0, end).join("\n").trimEnd();
  // A body that was nothing but sign-off is left alone rather than emptied.
  return trimmed || body;
}

/**
 * Split a provider draft body into prose and the account signature it ends
 * with, comparing whitespace-normalized non-empty lines so spacing differences
 * from the HTML round-trip can't defeat the match. Null when the body does not
 * end with the signature (a hand-written draft, or one from before the
 * signature was configured) — the caller then treats the whole text as body
 * and must not re-append the signature on save.
 */
export function detachSignature(
  body: string,
  signatureText: string,
): { body: string; signature: string } | null {
  const normalize = (line: string) => line.replace(/\s+/g, " ").trim();
  const signatureLines = signatureText.split("\n").map(normalize).filter(Boolean);
  if (signatureLines.length === 0) return null;

  const lines = body.split("\n");
  const content: { text: string; index: number }[] = [];
  lines.forEach((raw, index) => {
    const text = normalize(raw);
    if (text) content.push({ text, index });
  });
  if (content.length < signatureLines.length) return null;

  const tail = content.slice(-signatureLines.length);
  if (!tail.every((entry, i) => entry.text === signatureLines[i])) return null;

  const cutIndex = tail[0]?.index ?? 0;
  return { body: lines.slice(0, cutIndex).join("\n").trimEnd(), signature: signatureText };
}

const SNIPPET_MAX_LENGTH = 140;

export function snippetFrom(text: string, maxLength = SNIPPET_MAX_LENGTH): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, maxLength).trimEnd()}…`;
}

/**
 * Split a To/Cc header value into entries. RFC 5322-aware: a quoted display
 * name may itself contain commas, so the value is parsed rather than split, and
 * groups are flattened; a value that doesn't parse falls back to a comma split.
 */
export function splitAddressList(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  const parsed = addrs.parseAddressList({ input: trimmed, rfc6532: true });
  if (!parsed) {
    return trimmed
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return parsed
    .flatMap((entry) => (entry.type === "group" ? entry.addresses : [entry]))
    .map((mailbox) => (mailbox.name ? `${mailbox.name} <${mailbox.address}>` : mailbox.address));
}
