import { logger } from "./logger.js";

/**
 * In-process job primitives — the one home for "don't run this twice at
 * once" and "at most N at a time" machinery. Everything that schedules work
 * (sync engine, enrichment, automations, delegate workers) composes these
 * instead of hand-rolling its own timers, guards and pools. Deliberately no
 * persistence and no generic retry: all recovery state lives in SQLite
 * (cursors, derived staleness, run rows), so a restart resumes from data,
 * not from a queue.
 */

/**
 * Worker-pool map: at most `limit` calls to fn in flight, items claimed in
 * order, results in input order. The first rejection propagates; workers
 * already mid-item finish their current call but claim nothing further.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T, index);
    }
  };
  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

/**
 * Keyed mutual exclusion with two independent domains:
 *
 * - join/isRunning: at most one run per key; a caller hitting a busy key
 *   shares the in-flight promise. Callers that want drop-when-busy check
 *   isRunning first (safe without a lock — there is no await between the
 *   check and the join on the event loop).
 * - enqueue: strict serialization per key; each call runs after every
 *   earlier call for that key has settled, and observes only its own
 *   rejection.
 */
export class KeyedJobs {
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly chains = new Map<string, Promise<unknown>>();

  isRunning(key: string): boolean {
    return this.inFlight.has(key);
  }

  join<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const running = this.inFlight.get(key);
    if (running) return running as Promise<T>;
    const run = fn().finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, run);
    return run;
  }

  enqueue<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prior = this.chains.get(key) ?? Promise.resolve();
    const next = prior.then(fn, fn);
    // The stored chain link swallows the outcome so one failed call never
    // wedges later calls; `next` still carries the real rejection to its caller.
    this.chains.set(
      key,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }
}

export interface JobLoopOptions {
  /** Shown in the log line when a run fails. */
  name: string;
  run: () => Promise<void>;
  /** Poll cadence; every tick is a trigger(). */
  intervalMs: number;
  /** Coalescing window between trigger() and the run starting (default 0). */
  debounceMs?: number;
}

/**
 * A single-flight loop: interval ticks and external trigger() calls funnel
 * into the same debounced kick, a trigger landing mid-run queues exactly one
 * follow-up instead of stacking, and a failed run is logged without killing
 * the loop. Timers never keep the process alive; stop() also cancels a
 * queued follow-up (a run already executing finishes on its own).
 */
export class JobLoop {
  private interval: NodeJS.Timeout | null = null;
  private debounce: NodeJS.Timeout | null = null;
  private running = false;
  private runAgain = false;
  private stopped = true;

  constructor(private readonly opts: JobLoopOptions) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.trigger();
    this.interval = setInterval(() => this.trigger(), this.opts.intervalMs);
    this.interval.unref();
  }

  stop(): void {
    this.stopped = true;
    this.runAgain = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.debounce) {
      clearTimeout(this.debounce);
      this.debounce = null;
    }
  }

  /** Ask for a run soon; triggers while one is pending or running coalesce. */
  trigger(): void {
    if (this.stopped || this.debounce) return;
    this.debounce = setTimeout(() => {
      this.debounce = null;
      void this.cycle();
    }, this.opts.debounceMs ?? 0);
    this.debounce.unref();
  }

  private async cycle(): Promise<void> {
    if (this.stopped) return;
    if (this.running) {
      this.runAgain = true;
      return;
    }
    this.running = true;
    try {
      await this.opts.run();
    } catch (error) {
      logger.warn({ err: error, job: this.opts.name }, "job run failed");
    } finally {
      this.running = false;
      if (this.runAgain) {
        this.runAgain = false;
        this.trigger();
      }
    }
  }
}
