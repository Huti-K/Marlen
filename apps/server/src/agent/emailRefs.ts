import type { EmailRef } from "@trailin/shared";
import { isNonEmptyString, isRecord } from "../util.js";

/**
 * The one place that owns EmailRef serialization (messages.refs) and the
 * prompt note wording that makes an attached email authoritative to the
 * agent. Chat messages carry these as composer @-mentions; refs are never
 * inferred by the model — only ever supplied by the client on a user turn.
 */

/** Serializes a message's refs for the messages.refs column; null when there are none. */
export function serializeRefs(refs: EmailRef[] | undefined): string | null {
  return refs && refs.length > 0 ? JSON.stringify(refs) : null;
}

/**
 * Defensive parse of a single ref-shaped value: threadId/accountId are
 * required non-empty strings (the tool handles they feed — read_thread,
 * create-draft — need both), every other field is an optional string kept
 * only when non-empty. Never throws; returns undefined for anything
 * malformed rather than a half-built ref.
 */
export function parseEmailRef(value: unknown): EmailRef | undefined {
  if (!isRecord(value)) return undefined;
  const { threadId, accountId, accountName, messageId, subject, from, date } = value;
  if (!isNonEmptyString(threadId) || !isNonEmptyString(accountId)) return undefined;
  return {
    threadId,
    accountId,
    ...(isNonEmptyString(accountName) ? { accountName } : {}),
    ...(isNonEmptyString(messageId) ? { messageId } : {}),
    ...(isNonEmptyString(subject) ? { subject } : {}),
    ...(isNonEmptyString(from) ? { from } : {}),
    ...(isNonEmptyString(date) ? { date } : {}),
  };
}

/**
 * Parses a messages.refs JSON blob back into validated refs. Same trust
 * posture as cards.ts's parseStoredCards: the column is our own write, but it
 * round-trips through JSON, so malformed entries are dropped rather than
 * crashing message restore.
 */
export function parseStoredRefs(raw: string | null | undefined): EmailRef[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    const refs = parsed.map(parseEmailRef).filter((r): r is EmailRef => r !== undefined);
    return refs.length > 0 ? refs : undefined;
  } catch {
    return undefined;
  }
}

/** One bracketed, model-facing note per ref — omits fields the ref doesn't carry. */
export function renderRefNotes(refs: EmailRef[]): string {
  return refs
    .map((ref) => {
      const parts = [`thread ${ref.threadId} in ${ref.accountName ?? ref.accountId}`];
      if (ref.subject) parts.push(`subject "${ref.subject}"`);
      if (ref.from) parts.push(`from ${ref.from}`);
      if (ref.date) parts.push(`date ${ref.date}`);
      return (
        `[Attached email: ${parts.join(", ")}. This reference is authoritative — read this ` +
        `exact thread with read_thread and use its threadId for any reply draft; do not search ` +
        `for a different match.]`
      );
    })
    .join("\n");
}

/**
 * The prompt actually run against the model: the user's raw content plus a
 * note per attached ref, so the agent treats pinned emails as authoritative
 * instead of resolving them itself. The persisted message row keeps `content`
 * raw (see turnRecorder.ts) — only the live prompt is decorated.
 */
export function decoratePrompt(content: string, refs: EmailRef[] | undefined): string {
  if (!refs || refs.length === 0) return content;
  return `${content}\n\n${renderRefNotes(refs)}`;
}
