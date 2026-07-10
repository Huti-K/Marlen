import type { ConnectedAccount, WaitingThread } from "@trailin/shared";

/**
 * Waiting-thread provider registry — mirrors ./providers.ts's DraftProvider
 * registry so routes/waiting.ts can filter connected accounts down to "this
 * app knows how to compute waiting threads" instead of hardcoding "gmail".
 *
 * Deliberately smaller than DraftProvider: read-only, one method. Only Gmail
 * has an implementation today (../pipedream/gmailWaiting.ts registers itself
 * at the bottom of that file); an app with nothing registered simply
 * contributes no waiting entries to the Home page, same as an app with no
 * DraftProvider contributes no drafts. There is intentionally no Outlook
 * implementation yet — absence here is not a bug, it's "not built yet".
 */

export interface WaitingProvider {
  listWaiting(account: ConnectedAccount, opts?: { refresh?: boolean }): Promise<WaitingThread[]>;
}

const registry = new Map<string, WaitingProvider>();

/** Called once per provider module, at import time (see registerWaitingProviders.ts). */
export function registerWaitingProvider(app: string, provider: WaitingProvider): void {
  registry.set(app, provider);
}

/** null when `app` has no waiting driver — callers must handle that, not assume Gmail. */
export function getWaitingProvider(app: string): WaitingProvider | null {
  return registry.get(app) ?? null;
}
