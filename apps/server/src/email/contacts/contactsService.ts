import type { Api, Model } from "@earendil-works/pi-ai";
import { env } from "../../env.js";
import { emitServerEvent } from "../../events.js";
import { mapWithConcurrency } from "../../jobs.js";
import { activeModelConfigured, resolveCheapModel } from "../../llm/registry.js";
import { moduleLogger } from "../../logger.js";
import { errorMessage } from "../../util.js";
import { createMailReactivePipeline } from "../reactivePipeline.js";
import {
  buildContactSample,
  type ContactJudgment,
  type ContactSample,
  findStaleContacts,
  saveContactError,
  saveContactJudgment,
  touchContactEnrichment,
} from "./contactsEnrichStore.js";
import { judgeContact } from "./contactsLLM.js";
import { deriveContacts } from "./contactsStore.js";

const log = moduleLogger("contacts");

/**
 * Drives the contacts pipeline on top of the shared mail reactive pipeline
 * (email/reactivePipeline.ts), same shape as email/enrich/enrichService.ts.
 * Each cycle first re-derives every contact's aggregates (cheap, no LLM),
 * then judges whatever that left stale, up to one batch.
 */

export interface ContactsCycleResult {
  /** Addresses whose aggregate changed this cycle. */
  derived: number;
  enriched: number;
  failed: number;
  /** Stale-looking candidates whose recomputed hash actually still matched. */
  untouched: number;
}

/**
 * One cycle, with the LLM call injectable so tests can drive it with a fake
 * judge instead of a real model. Exported (unlike enrichService's runCycle)
 * specifically for that seam.
 */
export async function runContactsCycle(
  judge: (sample: ContactSample, model: Model<Api>) => Promise<ContactJudgment> = judgeContact,
): Promise<ContactsCycleResult> {
  const derived = deriveContacts();
  let enriched = 0;
  let failed = 0;
  let untouched = 0;
  let candidateCount = 0;

  if (await activeModelConfigured()) {
    const candidates = findStaleContacts(env.contacts.batch);
    candidateCount = candidates.length;
    if (candidates.length > 0) {
      const model = await resolveCheapModel(env.contacts.model);
      await mapWithConcurrency(candidates, env.contacts.concurrency, async (candidate) => {
        const sample = buildContactSample(candidate.address);
        if (!sample) return; // contact vanished; candidate query won't surface it again
        if (candidate.lastError === null && sample.inputHash === candidate.inputHash) {
          // A successful prior judgment whose inputs are unchanged (e.g. only
          // the aggregate's updated_at moved) — refresh the timestamp, skip the
          // LLM. Guarded on lastError: an errored row keeps the failing sample's
          // hash, so an unchanged errored contact must fall through and retry
          // rather than touch-and-skip forever.
          touchContactEnrichment(candidate.address);
          untouched++;
          return;
        }
        try {
          const judgment = await judge(sample, model);
          saveContactJudgment(candidate.address, sample.inputHash, judgment, model.id);
          enriched++;
        } catch (error) {
          saveContactError(candidate.address, sample.inputHash, errorMessage(error));
          failed++;
        }
      });
    }
  } else {
    log.debug("contact judgments skipped: no usable LLM credentials");
  }

  if (derived > 0 || enriched > 0 || failed > 0) {
    log.info({ derived, enriched, failed, untouched }, "contacts cycle done");
    emitServerEvent("contacts");
  }
  // A full batch means there's likely more backlog — keep draining.
  if (candidateCount > 0 && candidateCount === env.contacts.batch) pipeline.trigger();
  return { derived, enriched, failed, untouched };
}

const pipeline = createMailReactivePipeline({
  name: "contacts",
  run: () => runContactsCycle().then(() => undefined),
});

export function startContacts(): void {
  pipeline.start();
}

/** Detach from "mail" events and cancel pending cycles; one already running finishes on its own. */
export function stopContacts(): void {
  pipeline.stop();
}
