import { onServerEvent } from "../events.js";
import { JobLoop } from "../jobs.js";

/**
 * Reactive wiring shared by every mail-triggered background pipeline (thread
 * enrichment, contacts, draft-vs-sent matching): a cycle function driven by
 * the sync engine's "mail" server event, debounced so one sync sweep landing
 * several pages triggers a single cycle. A boot catch-up and a slow safety
 * interval cover backlogs the event stream alone would miss — e.g. one that
 * built up while a dependency (the LLM) was unconfigured. JobLoop underneath
 * keeps cycles single-flight, coalescing triggers that land mid-cycle into
 * exactly one follow-up.
 */

const DEFAULT_DEBOUNCE_MS = 2_000;
const DEFAULT_SAFETY_INTERVAL_MS = 10 * 60_000;

export interface MailReactivePipelineOptions {
  /** Shown in JobLoop's log line when a run fails. */
  name: string;
  run: () => Promise<void>;
  /** Coalescing window between a "mail" event (or trigger()) and the cycle starting. */
  debounceMs?: number;
  /** Poll cadence that catches backlogs the event stream alone would miss. */
  safetyIntervalMs?: number;
}

export interface MailReactivePipeline {
  /** Idempotent: subscribes to "mail" events and fires a boot catch-up cycle. */
  start(): void;
  /** Idempotent: unsubscribes and cancels any pending cycle; one already running finishes on its own. */
  stop(): void;
  /** Ask for a cycle soon, same as an incoming "mail" event would. */
  trigger(): void;
}

export function createMailReactivePipeline(
  options: MailReactivePipelineOptions,
): MailReactivePipeline {
  const loop = new JobLoop({
    name: options.name,
    run: options.run,
    intervalMs: options.safetyIntervalMs ?? DEFAULT_SAFETY_INTERVAL_MS,
    debounceMs: options.debounceMs ?? DEFAULT_DEBOUNCE_MS,
  });

  let unsubscribe: (() => void) | null = null;

  return {
    start(): void {
      if (unsubscribe) return;
      unsubscribe = onServerEvent((event) => {
        if (event.topic === "mail") loop.trigger();
      });
      // start() fires the boot catch-up cycle (the debounce delay also lets
      // the first sync pages land), then the safety interval keeps draining
      // backlogs — a cycle with nothing stale is one cheap query.
      loop.start();
    },
    stop(): void {
      unsubscribe?.();
      unsubscribe = null;
      loop.stop();
    },
    trigger(): void {
      loop.trigger();
    },
  };
}
