import type { ConnectedAccount } from "@trailin/shared";
import { createProviderRegistry } from "../registry.js";

/**
 * Live mail-read drivers, one per app slug. The learning subsystem
 * (email/learn/, agent/voiceLearnService.ts) reads the user's sent mail
 * straight from the provider through these — mail is never stored locally.
 * Apps without a driver simply skip the features built on it, the same way
 * apps without a DraftProvider get no draft tools.
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

export interface MailReadProvider {
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
}

const registry = createProviderRegistry<MailReadProvider>();

export const registerMailReadProvider = registry.register;
export const getMailReadProvider = registry.get;
