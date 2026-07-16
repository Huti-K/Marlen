import { JobLoop } from "../../jobs.js";
import { runMatchSweep } from "./matcher.js";

/**
 * Drives the draft-vs-sent matcher on a plain interval: a boot catch-up plus
 * a fixed cadence. A sweep with no open drafts costs one local query and zero
 * provider calls, so idle ticks are effectively free; when a draft is
 * pending, the interval bounds how long a send can go unnoticed. The nightly
 * extraction sweep (extractService.ts) also runs a match sweep first, so a
 * pair never waits an extra night on this loop's cadence.
 */

const MATCH_INTERVAL_MS = 30 * 60_000;

const loop = new JobLoop({
  name: "learn-match",
  run: async () => {
    await runMatchSweep();
  },
  intervalMs: MATCH_INTERVAL_MS,
});

export function startDraftMatching(): void {
  loop.start();
}

/** Stop the interval; a sweep already running finishes on its own. */
export function stopDraftMatching(): void {
  loop.stop();
}
