import type { Api, Model } from "@earendil-works/pi-ai";
import { fetchAccountNameMap } from "../../agent/accounts.js";
import { env } from "../../env.js";
import { emitServerEvent } from "../../events.js";
import { mapWithConcurrency } from "../../jobs.js";
import { activeModelConfigured, resolveCheapModel } from "../../llm/registry.js";
import { moduleLogger } from "../../logger.js";
import { errorMessage } from "../../util.js";
import { createMailReactivePipeline } from "../reactivePipeline.js";
import { enrichThread } from "./enrichLLM.js";
import {
  type EnrichmentResult,
  findStaleCandidates,
  saveEnrichment,
  saveEnrichmentError,
  snapshotThread,
  storedInputHash,
  type ThreadSnapshot,
  touchEnrichment,
} from "./enrichStore.js";

const log = moduleLogger("enrich");

/**
 * Drives the enrichment pipeline on top of the shared mail reactive pipeline
 * (email/reactivePipeline.ts): staleness only ever arises from mirror
 * changes, so cycles are reactive to "mail" events, a boot catch-up, and a
 * slow safety interval for backlogs that appeared while the LLM was
 * unconfigured.
 */

export interface EnrichCycleResult {
  enriched: number;
  failed: number;
  /** Stale-looking candidates whose recomputed hash actually still matched. */
  untouched: number;
}

/**
 * One cycle, with the LLM call injectable so tests can drive it with a fake
 * enrich function instead of a real model.
 */
export async function runCycle(
  enrich: (
    snapshot: ThreadSnapshot,
    accountName: string,
    model: Model<Api>,
  ) => Promise<EnrichmentResult> = enrichThread,
): Promise<EnrichCycleResult> {
  if (!(await activeModelConfigured())) {
    log.debug("skipped: no usable LLM credentials");
    return { enriched: 0, failed: 0, untouched: 0 };
  }
  // Backoff for errored threads is enforced inside the query itself, so
  // every candidate returned here is genuinely due for (re)enrichment.
  const candidates = findStaleCandidates(env.enrich.batch);
  if (candidates.length === 0) return { enriched: 0, failed: 0, untouched: 0 };

  const [names, model] = await Promise.all([
    fetchAccountNameMap(),
    resolveCheapModel(env.enrich.model),
  ]);
  let enriched = 0;
  let failed = 0;
  let untouched = 0;

  await mapWithConcurrency(candidates, env.enrich.concurrency, async (candidate) => {
    const snapshot = snapshotThread(candidate.threadId, candidate.accountId);
    if (!snapshot) return; // thread vanished; candidate query won't surface it again
    if (
      candidate.lastError === null &&
      snapshot.inputHash === storedInputHash(candidate.threadId)
    ) {
      // A successful prior enrichment whose inputs are unchanged (e.g. only an
      // unread flip touched the thread row) — refresh the timestamp, skip the
      // LLM. Guarded on lastError: a row left in `error` state carries the
      // failing snapshot's hash too, so an unchanged errored thread must fall
      // through and actually retry rather than touch-and-skip forever.
      touchEnrichment(candidate.threadId, snapshot.takenAt);
      untouched++;
      return;
    }
    try {
      const result = await enrich(
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
  if (candidates.length === env.enrich.batch) pipeline.trigger();
  return { enriched, failed, untouched };
}

const pipeline = createMailReactivePipeline({
  name: "enrich",
  run: () => runCycle().then(() => undefined),
});

export function startEnrichment(): void {
  pipeline.start();
}

/** Detach from "mail" events and cancel pending cycles; one already running finishes on its own. */
export function stopEnrichment(): void {
  pipeline.stop();
}
