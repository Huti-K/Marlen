import { env } from "../../env.js";
import { emitServerEvent, onServerEvent } from "../../events.js";
import { JobLoop, mapWithConcurrency } from "../../jobs.js";
import { activeModelConfigured } from "../../llm/registry.js";
import { moduleLogger } from "../../logger.js";
import { listAccounts } from "../../pipedream/connect.js";
import { errorMessage } from "../../util.js";
import { enrichThread, resolveEnrichModel } from "./enrichLLM.js";
import {
  findStaleCandidates,
  saveEnrichment,
  saveEnrichmentError,
  snapshotThread,
  storedInputHash,
  touchEnrichment,
} from "./enrichStore.js";

const log = moduleLogger("enrich");

/**
 * Drives the enrichment pipeline. Purely reactive: staleness only ever
 * arises from mirror changes, so cycles are triggered by the sync engine's
 * "mail" events (debounced — one sweep usually lands several pages), plus a
 * boot catch-up and a slow safety interval for backlogs that appeared while
 * the LLM was unconfigured. The JobLoop keeps cycles single-flight and
 * coalesces triggers that land mid-cycle.
 */

const DEBOUNCE_MS = 2_000;
const SAFETY_INTERVAL_MS = 10 * 60_000;

/** Account display names for the prompt's "owner" line; ids beat nothing. */
async function accountNames(): Promise<Map<string, string>> {
  try {
    return new Map((await listAccounts()).map((account) => [account.id, account.name]));
  } catch {
    return new Map();
  }
}

async function runCycle(): Promise<void> {
  if (!(await activeModelConfigured())) {
    log.debug("skipped: no usable LLM credentials");
    return;
  }
  // Backoff for errored threads is enforced inside the query itself, so
  // every candidate returned here is genuinely due for (re)enrichment.
  const candidates = findStaleCandidates(env.enrich.batch);
  if (candidates.length === 0) return;

  const [names, model] = await Promise.all([accountNames(), resolveEnrichModel()]);
  let enriched = 0;
  let failed = 0;
  let untouched = 0;

  await mapWithConcurrency(candidates, env.enrich.concurrency, async (candidate) => {
    const snapshot = snapshotThread(candidate.threadId, candidate.accountId);
    if (!snapshot) return; // thread vanished; candidate query won't surface it again
    if (snapshot.inputHash === storedInputHash(candidate.threadId)) {
      // Content still valid (e.g. only an unread flip touched the
      // thread row) — refresh the timestamp, skip the LLM entirely.
      touchEnrichment(candidate.threadId, snapshot.takenAt);
      untouched++;
      return;
    }
    try {
      const result = await enrichThread(
        snapshot,
        names.get(candidate.accountId) ?? candidate.accountId,
        model,
      );
      saveEnrichment(snapshot, result, model.id);
      enriched++;
    } catch (error) {
      saveEnrichmentError(snapshot, errorMessage(error));
      failed++;
    }
  });

  if (enriched > 0 || failed > 0) {
    log.info({ enriched, failed, untouched }, "enrichment cycle done");
    emitServerEvent("mail_state");
  }
  // A full batch means there's likely more backlog — keep draining.
  if (candidates.length === env.enrich.batch) loop.trigger();
}

const loop = new JobLoop({
  name: "enrich",
  run: runCycle,
  intervalMs: SAFETY_INTERVAL_MS,
  debounceMs: DEBOUNCE_MS,
});

let unsubscribe: (() => void) | null = null;

export function startEnrichment(): void {
  if (unsubscribe) return;
  unsubscribe = onServerEvent((event) => {
    if (event.topic === "mail") loop.trigger();
  });
  // start() fires a boot catch-up (the debounce delay also lets the first
  // sync pages land), then the slow safety net keeps draining backlogs —
  // cycles with nothing stale are one cheap query.
  loop.start();
}

/** Detach from "mail" events and cancel pending cycles; one already running finishes on its own. */
export function stopEnrichment(): void {
  unsubscribe?.();
  unsubscribe = null;
  loop.stop();
}
