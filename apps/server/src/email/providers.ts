import type { ConnectedAccount, EmailDraft } from "@trailin/shared";

/**
 * Draft-provider abstraction: every mail app Trailin can list/create drafts
 * for implements this interface against its own REST API — Gmail via the
 * plain Gmail REST API (pipedream/gmailDrafts.ts), Outlook via Microsoft
 * Graph (./outlookDrafts.ts) — all through Pipedream's Connect proxy so no
 * OAuth tokens ever touch this codebase directly.
 *
 * Keyed by Pipedream app slug in the registry below. `getDraftProvider`
 * returns null for apps with no driver yet (zoho_mail, imap, or anything
 * that isn't a mail app at all) so routes/tools can filter accounts down to
 * "drafts actually work here" instead of assuming every connected account is
 * Gmail. Adding a provider later is one new file (implementing DraftProvider
 * and calling registerDraftProvider) plus one import line in
 * registerProviders.ts — nothing else changes.
 */

export interface CreateDraftInput {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  /** Attach the draft to an existing conversation, where the provider supports it. */
  threadId?: string;
}

export interface CreateDraftResult {
  draftId: string;
  messageId: string;
  threadId: string;
  /** Deep link to review/send the draft in the provider's web UI. */
  webUrl: string;
}

export interface DraftProvider {
  listDrafts(
    account: ConnectedAccount,
    limit?: number,
    opts?: { refresh?: boolean },
  ): Promise<EmailDraft[]>;
  getDraftDetail(
    account: ConnectedAccount,
    draftId: string,
  ): Promise<{ body: string; cc: string; bcc: string }>;
  createDraft(account: ConnectedAccount, input: CreateDraftInput): Promise<CreateDraftResult>;
  deleteDraft(account: ConnectedAccount, draftId: string): Promise<void>;
  /** Drop this account's cached drafts list. Call before emitting "drafts". */
  invalidateCache(accountId: string): void;
}

const registry = new Map<string, DraftProvider>();

/** Called once per provider module, at import time (see registerProviders.ts). */
export function registerDraftProvider(app: string, provider: DraftProvider): void {
  registry.set(app, provider);
}

/** null when `app` has no draft driver yet — callers must handle that, not assume Gmail. */
export function getDraftProvider(app: string): DraftProvider | null {
  return registry.get(app) ?? null;
}

/**
 * Sweep every registered provider's cache for one account id. Used on account
 * removal (routes/pipedream.ts), where the caller no longer has the account's
 * app slug handy — a Map delete on a provider that never cached this id is a
 * harmless no-op, so sweeping all of them is simpler than looking the app up
 * first.
 */
export function invalidateDraftsCacheEverywhere(accountId: string): void {
  for (const provider of registry.values()) provider.invalidateCache(accountId);
}

/**
 * Small per-account TTL cache shared by every DraftProvider's `listDrafts`,
 * so GET /api/drafts doesn't hit the provider's API on every poll/SSE-driven
 * refetch. Failed fetches are never cached (callers simply don't call `set`
 * on error), so a broken account retries live on the next request instead of
 * serving stale — or another account's — data for the rest of the TTL.
 */
export class DraftsCache {
  private readonly entries = new Map<string, { drafts: EmailDraft[]; expiresAt: number }>();

  constructor(private readonly ttlMs = 60_000) {}

  get(accountId: string): EmailDraft[] | undefined {
    const cached = this.entries.get(accountId);
    return cached && cached.expiresAt > Date.now() ? cached.drafts : undefined;
  }

  set(accountId: string, drafts: EmailDraft[]): void {
    this.entries.set(accountId, { drafts, expiresAt: Date.now() + this.ttlMs });
  }

  invalidate(accountId: string): void {
    this.entries.delete(accountId);
  }
}
