import cron, { type ScheduledTask } from "node-cron";
import { getTimezoneSetting } from "../../db/settings.js";
import { moduleLogger } from "../../logger.js";
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
 */

const NIGHTLY_CRON = "0 3 * * *";

let task: ScheduledTask | null = null;

function runSweep(reason: "boot" | "scheduled"): void {
  runMatchSweep()
    .then(() => runExtractionSweep())
    .catch((error: unknown) => {
      log.warn({ err: error, reason }, "nightly learning sweep failed to run");
    });
}

export async function startNightlyLearning(): Promise<void> {
  if (task) return;
  const timezone = (await getTimezoneSetting()) ?? undefined;
  task = cron.schedule(
    NIGHTLY_CRON,
    () => runSweep("scheduled"),
    timezone ? { timezone } : undefined,
  );
  runSweep("boot");
}

/** Destroy the nightly cron task; a sweep already running finishes on its own. */
export function stopNightlyLearning(): void {
  if (task) {
    void task.destroy();
    task = null;
  }
}
