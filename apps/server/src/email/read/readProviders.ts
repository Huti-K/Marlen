import type { ConnectedAccount, EmailThreadMessage } from "@trailin/shared";
import { createProviderRegistry } from "../registry.js";

/**
 * Live mail-read drivers, one per app slug. The learning subsystem
 * (email/learn/, agent/voiceLearnService.ts) reads the user's sent mail
 * straight from the provider through these, and the thread-history viewer
 * (routes/mail.ts) reads whole threads the same way — mail is never stored
 * locally. Apps without a driver simply skip the features built on it, the
 * same way apps without a DraftProvider get no draft tools.
 */

/** One sent message as the learn loops consume it. */
export interface SentMessage {
  providerMessageId: string;
  providerThreadId: string;
  subject: string;
  /** Recipients in `"Name <addr>"` form (learn/addressSubject.ts normalizes them). */
  to: string[];
  /** ISO timestamp, orderable. */
  date: string;
  /** Plain text; HTML-only bodies arrive tag-stripped. */
  bodyText: string;
}

/** One thread's conversation for display: subject plus its messages, oldest first. */
export interface ThreadDetail {
  subject: string;
  messages: EmailThreadMessage[];
}

export interface MailReadProvider {
  /**
   * The account's newest inbox message as `{ id, date }` (ISO date), or null
   * for an empty inbox. When the newest id equals `opts.knownId`, a provider
   * may answer `{ id, date: null }` without fetching the message — the caller
   * already holds that message's date next to the id it passed in. The mail
   * probe (automations/mailProbe.ts) polls this to detect new inbound mail.
   */
  newestInbound(
    account: ConnectedAccount,
    opts?: { knownId?: string; signal?: AbortSignal },
  ): Promise<{ id: string; date: string | null } | null>;
  /** The account's own sent mail after `sinceIso`, oldest first, capped at `limit`. */
  listSentSince(
    account: ConnectedAccount,
    sinceIso: string,
    opts?: { limit?: number; signal?: AbortSignal },
  ): Promise<SentMessage[]>;
  /** Plain-text body of one sent message, or null when it no longer exists (404). */
  getMessageBody(
    account: ConnectedAccount,
    providerMessageId: string,
    signal?: AbortSignal,
  ): Promise<string | null>;
  /**
   * Optional capability: one thread's sent/received messages, oldest first,
   * drafts excluded — a reply draft sits in the same provider thread it
   * answers, and the viewer shows the conversation, not the unsent reply.
   * Null when the thread no longer exists (404) or has no non-draft message.
   * Absent means "not supported for this account" — the route replies 400,
   * provider-neutral.
   */
  getThread?(
    account: ConnectedAccount,
    providerThreadId: string,
    signal?: AbortSignal,
  ): Promise<ThreadDetail | null>;
}

const registry = createProviderRegistry<MailReadProvider>();

export const registerMailReadProvider = registry.register;
export const getMailReadProvider = registry.get;
