import cron, { type ScheduledTask } from "node-cron";
import { recordLearnRun } from "../../db/learnRuns.js";
import { getTimezoneSetting } from "../../db/settings.js";
import { moduleLogger } from "../../logger.js";
import { errorMessage } from "../../util.js";
import { runExtractionSweep } from "./extractor.js";
import { runMatchSweep } from "./matcher.js";

const log = moduleLogger("learn-extract");

/**
 * Schedules the nightly extraction sweep (extractor.ts) at 03:00 in the
 * user's configured timezone (falling back to the server's local time when
 * none is set) — same node-cron usage as automations/scheduler.ts's
 * schedule(), a single fixed task rather than a user-configurable one. A
 * catch-up sweep also runs once at boot so a pair that became learnable
 * while the process was down isn't stuck waiting for the next 03:00.
 *
 * Each sweep runs the draft-vs-sent matcher first: extraction only sees
 * pairs the matcher has resolved, so matching immediately before it keeps a
 * same-day send from waiting on the match loop's slower cadence.
 *
 * Every sweep — including one that found nothing to learn — is recorded via
 * db/learnRuns.ts, feeding the Knowledge page's learning-activity history.
 */

const NIGHTLY_CRON = "0 3 * * *";

let task: ScheduledTask | null = null;

/** One full sweep (match, then extract), recorded whatever the outcome. Never throws. */
export async function runLearningSweep(reason: "boot" | "scheduled"): Promise<void> {
  const startedAt = new Date().toISOString();
  let matched = 0;
  try {
    matched = (await runMatchSweep()).matched;
    const extracted = await runExtractionSweep();
    await recordLearnRun({
      reason,
      status: "ok",
      matched,
      ...extracted,
      error: null,
      startedAt,
      finishedAt: new Date().toISOString(),
    });
  } catch (error) {
    log.warn({ err: error, reason }, "learning sweep failed to run");
    await recordLearnRun({
      reason,
      status: "error",
      matched,
      pending: 0,
      identical: 0,
      learned: 0,
      lessons: 0,
      error: errorMessage(error),
      startedAt,
      finishedAt: new Date().toISOString(),
    }).catch((recordError: unknown) => {
      log.warn({ err: recordError }, "failed to record the learning sweep's failure");
    });
  }
}

export async function startNightlyLearning(): Promise<void> {
  if (task) return;
  const timezone = (await getTimezoneSetting()) ?? undefined;
  task = cron.schedule(
    NIGHTLY_CRON,
    () => void runLearningSweep("scheduled"),
    timezone ? { timezone } : undefined,
  );
  void runLearningSweep("boot");
}

/** When the nightly sweep will fire next; null while it isn't scheduled. */
export function nextLearnRunAt(): string | null {
  const next = task?.getNextRun();
  return next ? next.toISOString() : null;
}

/** Destroy the nightly cron task; a sweep already running finishes on its own. */
export function stopNightlyLearning(): void {
  if (task) {
    void task.destroy();
    task = null;
  }
}
