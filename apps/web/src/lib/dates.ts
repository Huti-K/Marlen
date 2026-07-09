/**
 * Shared date/time formatters. Everything here just wraps `Intl` with the
 * project's chosen shapes, so a chat card, the library grid, and the Home
 * feed all render the same timestamp the same way.
 */

const rtfCache = new Map<string, Intl.RelativeTimeFormat>();

/** "3 days ago", "yesterday", "last month" — in the given language. */
export function relativeTime(iso: string, lang: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  let rtf = rtfCache.get(lang);
  if (!rtf) {
    rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
    rtfCache.set(lang, rtf);
  }
  const diff = then - Date.now();
  const abs = Math.abs(diff);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (abs < hour) return rtf.format(Math.round(diff / minute), "minute");
  if (abs < day) return rtf.format(Math.round(diff / hour), "hour");
  if (abs < 30 * day) return rtf.format(Math.round(diff / day), "day");
  if (abs < 365 * day) return rtf.format(Math.round(diff / (30 * day)), "month");
  return rtf.format(Math.round(diff / (365 * day)), "year");
}

/** "9 Jul, 14:32"-style absolute label — the chat history rail and the
 *  drafts review list both use this shape. Empty/unparsable input → "". */
export function dateTimeLabel(iso: string, lang: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(lang, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "Wednesday, 9 July"-style day heading — groups the Home activity feed. */
export function dayLabel(iso: string, lang: string): string {
  return new Date(iso).toLocaleDateString(lang, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

/** "14:32"-style time-only label, paired with `dayLabel` in the Home activity feed. */
export function timeLabel(iso: string, lang: string): string {
  return new Date(iso).toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" });
}
