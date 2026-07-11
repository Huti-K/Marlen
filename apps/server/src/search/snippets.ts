/**
 * Text helpers for turning stored content — markdown, plain prose, file
 * titles — into the short plain-text snippets search results and library
 * hits show under a heading.
 */

/** Collapse runs of whitespace to a single space and trim the ends. */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Chats, briefings and library documents all store markdown, but a snippet is
 * rendered as plain text — without this, hits read as literal
 * `## Zusammenfassung **selin@…**` noise. Runs before whitespace is collapsed,
 * because the line-anchored rules (headings, quotes, bullets) need the newlines.
 */
function stripMarkdown(text: string): string {
  return (
    text
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s{0,3}>\s?/gm, "")
      .replace(/^\s{0,3}([-*+]|\d+\.)\s+/gm, "")
      .replace(/^\s{0,3}([-*_]\s*){3,}$/gm, " ")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/__(.+?)__/g, "$1")
      .replace(/~~(.+?)~~/g, "$1")
      // Emphasis only when the asterisks hug the text; `a * b` and `2 * 3` survive.
      .replace(/\*(\S(?:[^*]*\S)?)\*/g, "$1")
  );
}

/** Markdown stripped, whitespace collapsed — how every search snippet reaches the client. */
export function plainText(text: string): string {
  return collapseWhitespace(stripMarkdown(text));
}

/**
 * Characters of context kept on each side of the first match (~320 total with the
 * match itself). The search palette's list truncates this to one line; its preview
 * pane shows the whole thing, which is what the extra context is for.
 */
const SNIPPET_RADIUS = 160;

/** ~320 chars of context around the first case-insensitive match, or the start of the text. */
export function buildSnippet(text: string, query: string): string {
  const collapsed = plainText(text);
  if (!collapsed) return "";
  const idx = collapsed.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return collapsed.slice(0, SNIPPET_RADIUS * 2);
  const start = Math.max(0, idx - SNIPPET_RADIUS);
  const end = Math.min(collapsed.length, idx + query.length + SNIPPET_RADIUS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < collapsed.length ? "…" : "";
  return `${prefix}${collapsed.slice(start, end)}${suffix}`;
}

/** Collapse whitespace and cap length at `max` chars, breaking on a word boundary. */
export function trimSnippet(value: string, max = 200): string {
  const collapsed = collapseWhitespace(value);
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1).trimEnd()}…`;
}
