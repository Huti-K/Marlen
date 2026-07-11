import addrs from "email-addresses";
import { type HtmlToTextOptions, htmlToText } from "html-to-text";

/**
 * Provider-neutral text helpers shared by the mail provider drivers. Kept out
 * of any one provider file so gmail/outlook don't each carry a drifting copy.
 */

/** Email bodies are for reading, not navigating: keep link text but drop
 * hrefs and images, and keep headings as written (html-to-text uppercases
 * them by default). */
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

/** Render an HTML body/preview as display text: tags gone, style/script
 * contents dropped, entities decoded. */
export function stripHtml(html: string): string {
  return htmlToText(html, STRIP_HTML_OPTIONS).trim();
}

const SNIPPET_MAX_LENGTH = 140;

/** One-line preview for list rows: collapse whitespace, cap length. */
export function snippetFrom(text: string, maxLength = SNIPPET_MAX_LENGTH): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, maxLength).trimEnd()}…`;
}

/**
 * Split a To/Cc-style header value ("a@x.com, B <b@y.com>") into its entries.
 * RFC 5322-aware: a quoted display name may itself contain commas
 * ('"Kaya, Ayşe" <a@x.com>'), so the value is parsed rather than split, and
 * address groups are flattened to their members. A value that doesn't parse
 * as an address list at all falls back to a plain comma split rather than
 * returning nothing.
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
