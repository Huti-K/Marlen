import type { ConnectedAccount, CreatedDraft, EmailDraft } from "@trailin/shared";
import { createProviderRegistry } from "./registry.js";

/**
 * Draft-provider abstraction: every mail app Trailin can list/create drafts
 * for implements this interface against its own REST API — Gmail via the
 * plain Gmail REST API (./gmail/drafts.ts), Outlook via Microsoft
 * Graph (./outlook/drafts.ts) — all through Pipedream's Connect proxy so no
 * OAuth tokens ever touch this codebase directly.
 *
 * Keyed by Pipedream app slug in the registry below. `getDraftProvider`
 * returns null for apps with no driver yet (zoho_mail, imap, or anything
 * that isn't a mail app at all) so routes/tools can filter accounts down to
 * "drafts actually work here" instead of assuming every connected account is
 * Gmail. Adding a provider later is one new file (implementing DraftProvider
 * and calling registerDraftProvider) plus one import line in
 * registerProviders.ts — nothing else changes.
 *
 * `listDrafts` implementations are pure live fetches — no caching, no
 * refresh flag. Caching lives one layer up, in ./draftsCache.ts, shared
 * across every provider instead of duplicated per provider.
 */

/**
 * One file to attach at draft creation. The caller passes fully resolved
 * bytes (see library/draftAttachments.ts) — providers never fetch content
 * themselves, and must persist the attachment on the stored draft so a later
 * sendDraft dispatches it.
 */
export interface DraftAttachment {
  filename: string;
  mimeType: string;
  content: Buffer;
}

export interface CreateDraftInput {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  /** Plain-text body; providers save it as a text/plain MIME part. */
  body: string;
  /** Attach the draft to an existing conversation, where the provider supports it. */
  threadId?: string;
  /** Files to attach, already resolved to bytes by the caller. */
  attachments?: DraftAttachment[];
}

/** Body of DraftProvider.updateDraft: only body/subject are overridable. */
export interface UpdateDraftPatch {
  body?: string;
  subject?: string;
}

/** How many drafts one listDrafts call returns at most, across every provider. */
export const DRAFTS_LIST_LIMIT = 15;

export interface SendDraftResult {
  /**
   * Provider id of the message that was sent, when the provider returns it
   * (Gmail does; Graph's send returns an empty 202, so Outlook omits it and
   * the learn loop's matcher pairs the send up from the provider's sent
   * mail later instead).
   */
  sentMessageId?: string;
}

export interface DraftProvider {
  listDrafts(account: ConnectedAccount): Promise<EmailDraft[]>;
  getDraftDetail(
    account: ConnectedAccount,
    draftId: string,
  ): Promise<{ body: string; cc: string; bcc: string }>;
  createDraft(account: ConnectedAccount, input: CreateDraftInput): Promise<CreatedDraft>;
  deleteDraft(account: ConnectedAccount, draftId: string): Promise<void>;
  /**
   * Optional capability: not every provider can do this (yet), so routes
   * check for the method rather than assuming any one app. Absent means "not
   * supported for this account" — the route replies 400, provider-neutral.
   * (Thread reading is a MailReadProvider concern — see
   * email/read/readProviders.ts.)
   */
  updateDraft?(account: ConnectedAccount, draftId: string, patch: UpdateDraftPatch): Promise<void>;
  /**
   * Optional capability: dispatch an existing draft as-is. Only ever invoked
   * from a human-initiated request (the in-app Send button) — the agent has
   * no tool over this method, and per-account write arming is deliberately
   * not consulted: an explicit click is the authorization.
   */
  sendDraft?(account: ConnectedAccount, draftId: string): Promise<SendDraftResult>;
}

const registry = createProviderRegistry<DraftProvider>();

/** Called once per provider module, at import time (see registerProviders.ts). */
export const registerDraftProvider = registry.register;

/** null when `app` has no draft driver yet — callers must handle that, not assume Gmail. */
export const getDraftProvider = registry.get;
