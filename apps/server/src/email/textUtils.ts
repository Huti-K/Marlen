import addrs from "email-addresses";
import { type HtmlToTextOptions, htmlToText } from "html-to-text";

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

/** Plain agent prose as an HTML body with the account's signature below, mirroring a mail client's signature placement. */
export function htmlBodyWithSignature(body: string, signatureHtml: string): string {
  const escaped = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
  return `${escaped}<br><br>${signatureHtml}`;
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
