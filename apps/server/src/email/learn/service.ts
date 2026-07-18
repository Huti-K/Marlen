import { recordLearnRun } from "../../db/learnRuns.js";
import { getTimezoneSetting } from "../../db/settings.js";
import { moduleLogger } from "../../logger.js";
import { JobLoop, NightlyJob } from "../../utils/jobs.js";
import { errorMessage } from "../../utils/util.js";
import { runExtractionSweep } from "./extractor.js";
import { runMatchSweep } from "./matcher.js";

const log = moduleLogger("learn");

/**
 * Lifecycle of the draft-vs-sent learning subsystem — both of its loops
 * behind one start/stop pair:
 *
 * - The match loop drives the matcher (matcher.ts) on a plain interval: a
 *   boot catch-up plus a fixed cadence. A sweep with no open drafts costs one
 *   local query and zero provider calls, so idle ticks are effectively free;
 *   when a draft is pending, the interval bounds how long a send can go
 *   unnoticed.
 * - The nightly extraction sweep (extractor.ts) runs at 03:00 in the user's
 *   configured timezone (falling back to the server's local time when none is
 *   set), plus a boot catch-up run so a pair that became learnable while the
 *   process was down isn't stuck waiting for the next 03:00.
 *
 * Each extraction sweep runs the matcher first: extraction only sees pairs
 * the matcher has resolved, so matching immediately before it keeps a
 * same-day send from waiting on the match loop's slower cadence.
 *
 * Every extraction sweep — including one that found nothing to learn — is
 * recorded via db/learnRuns.ts, feeding the Knowledge page's
 * learning-activity history.
 */

const MATCH_INTERVAL_MS = 30 * 60_000;
const NIGHTLY_CRON = "0 3 * * *";

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

const matchLoop = new JobLoop({
  name: "learn-match",
  run: async () => {
    await runMatchSweep();
  },
  intervalMs: MATCH_INTERVAL_MS,
});

const nightly = new NightlyJob({
  name: "learn-extract",
  cron: NIGHTLY_CRON,
  run: runLearningSweep,
});

export async function startLearning(): Promise<void> {
  matchLoop.start();
  nightly.start((await getTimezoneSetting()) ?? undefined);
}

/** Rebuild the nightly extraction cron against the current timezone setting
 *  (see routes/settings.ts's timezone route); a no-op while stopped. The
 *  match loop is interval-based and needs no rebuild. */
export async function rescheduleNightlyLearn(): Promise<void> {
  nightly.reschedule((await getTimezoneSetting()) ?? undefined);
}

/** Stop both loops; a sweep already running finishes on its own. */
export function stopLearning(): void {
  matchLoop.stop();
  nightly.stop();
}

/** When the nightly extraction sweep will fire next; null while it isn't scheduled. */
export function nextLearnRunAt(): string | null {
  return nightly.nextRunAt();
}
