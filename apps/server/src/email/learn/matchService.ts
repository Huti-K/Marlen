import { createMailReactivePipeline } from "../reactivePipeline.js";
import { runMatchSweep } from "./matcher.js";

/**
 * Drives the draft-vs-sent matcher on top of the shared mail reactive
 * pipeline (email/reactivePipeline.ts): a draft can only resolve when new
 * mail lands, so cycles are reactive to "mail" events, a boot catch-up, and
 * a slow safety interval for backlogs left over from a quiet mailbox.
 */

const pipeline = createMailReactivePipeline({
  name: "learn-match",
  run: () => runMatchSweep(),
});

export function startDraftMatching(): void {
  pipeline.start();
}

/** Detach from "mail" events and cancel pending cycles; one already running finishes on its own. */
export function stopDraftMatching(): void {
  pipeline.stop();
}
