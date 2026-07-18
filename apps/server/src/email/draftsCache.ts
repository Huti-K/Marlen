import type { ConnectedAccount, EmailDraft } from "@trailin/shared";
import { emitServerEvent } from "../events.js";
import { moduleLogger } from "../logger.js";
import { createFetchCache } from "../utils/fetchCache.js";
import { getDraftProvider } from "./providers.js";

/**
 * Shared drafts cache, one entry per connected account (keyed by account id
 * in fetchCache.ts), used by every DraftProvider's `listDrafts` instead of
 * each provider keeping its own. Stale-while-revalidate: a stale entry is
 * still returned immediately (so a Home page load never blocks on a live
 * Gmail/Outlook round-trip), and a single deduped background refresh brings
 * it back up to date, notifying the web UI via the "drafts" server event only
 * when the refreshed list actually differs from what was just served.
 *
 * Entries are never evicted on a timer (fetchCache checks staleness against
 * its TTL at read time), so a quiet account's last-known drafts stay servable
 * indefinitely if nothing ever calls listDraftsCached for it again. Failed
 * fetches never update the cache; the fetch-dedupe and generation-counter
 * invariants live in fetchCache.ts.
 */

const log = moduleLogger("drafts-cache");

const cache = createFetchCache<EmailDraft[]>({ ttlMs: 60_000 });

/** Accounts with a background refresh already scheduled, so a second stale hit doesn't queue a second one. */
const refreshing = new Set<string>();

/** Order-sensitive is fine here — both sides come from the same provider-sorted (newest-first) list. */
function draftsEqual(a: EmailDraft[], b: EmailDraft[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function providerFor(account: ConnectedAccount) {
  const provider = getDraftProvider(account.app);
  if (!provider) throw new Error(`no draft provider registered for app "${account.app}"`);
  return provider;
}

/**
 * Live fetch through the shared cache: deduped per account, and the result
 * only lands in the cache when no invalidateDraftsCache ran while it was in
 * flight (`stored` reports which).
 */
function fetchDrafts(account: ConnectedAccount) {
  return cache.fetch(account.id, () => providerFor(account).listDrafts(account));
}

/**
 * Refresh one account's cache in the background, without making the caller
 * that triggered it (who already got the stale list) wait. Never throws —
 * failures are logged at warn and simply leave the stale entry in place for
 * the next reader to retry from, matching the "failed fetches never update
 * the cache" rule.
 */
function scheduleBackgroundRefresh(account: ConnectedAccount, previous: EmailDraft[]): void {
  if (refreshing.has(account.id)) return;
  refreshing.add(account.id);
  fetchDrafts(account)
    .then(({ value: drafts, stored }) => {
      // A mutation invalidated the cache while this fetch was in flight — its
      // result reflects pre-mutation state and was not cached, so it must not
      // drive a UI notification either (the mutation's own invalidate +
      // emit already covers this).
      if (!stored) return;
      // Only notify the UI when something actually changed — an account with
      // no external activity shouldn't trigger a refetch storm every TTL.
      if (!draftsEqual(previous, drafts)) emitServerEvent("drafts");
    })
    .catch((error) => {
      log.warn({ err: error, accountId: account.id }, "background drafts refresh failed");
    })
    .finally(() => {
      refreshing.delete(account.id);
    });
}

/**
 * Cached, stale-while-revalidate drafts list for one account.
 *
 * - `refresh: true`: live fetch (still deduped against any fetch already in
 *   flight for this account), cache the result, return it.
 * - fresh cache entry: return it as-is.
 * - stale cache entry: return it immediately and kick off one background
 *   refresh (see scheduleBackgroundRefresh).
 * - cache miss: live fetch (deduped), cache, return.
 */
export async function listDraftsCached(
  account: ConnectedAccount,
  opts: { refresh?: boolean } = {},
): Promise<EmailDraft[]> {
  if (!opts.refresh) {
    const entry = cache.peek(account.id);
    if (entry) {
      if (!entry.fresh) scheduleBackgroundRefresh(account, entry.value);
      return entry.value;
    }
  }
  return (await fetchDrafts(account)).value;
}

/**
 * Drop one account's cached drafts list and bump its generation — the bump
 * is what stops a fetch already in flight when this runs from re-caching its
 * (now stale) result afterwards; see fetchCache.ts. Mutation paths go through
 * draftsMutated below; call this directly only when no UI refetch should be
 * triggered (e.g. the account itself was removed).
 */
export function invalidateDraftsCache(accountId: string): void {
  cache.invalidate(accountId);
}

/**
 * The epilogue every draft mutation (create/update/delete, any app) ends
 * with: invalidate first, then emit "drafts", in that order — so the
 * SSE-driven refetch the event triggers can't race the cache and be served
 * the old list.
 */
export function draftsMutated(accountId: string): void {
  invalidateDraftsCache(accountId);
  emitServerEvent("drafts");
}
