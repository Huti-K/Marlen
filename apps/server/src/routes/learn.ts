import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { LearnStatus, VoiceLearnRun } from "@trailin/shared";
import { listLearnRuns } from "../db/learnRuns.js";
import { listVoiceLearnRuns } from "../db/voiceRuns.js";
import { nextLearnRunAt } from "../email/learn/service.js";

/**
 * The learning loops' visibility surface: the draft-vs-sent sweep history
 * (newest first, plus when the next nightly one fires) for the Knowledge
 * page, and each account's latest voice-learn attempt for the Settings
 * account rows' status/retry affordance.
 */
export const learnRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get("/api/learn/status", async (): Promise<LearnStatus> => {
    return { runs: await listLearnRuns(), nextRunAt: nextLearnRunAt() };
  });

  app.get("/api/learn/voice-runs", async (): Promise<VoiceLearnRun[]> => listVoiceLearnRuns());
};
