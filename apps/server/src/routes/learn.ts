import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { AccountVoiceInfo, LearnStatus, VoiceLearnRun } from "@marlen/shared";
import { listAccountVoiceInfos } from "../agent/voiceLearn.js";
import { listLearnRuns } from "../db/learnRuns.js";
import { listVoiceLearnRuns } from "../db/voiceRuns.js";
import { nextLearnRunAt } from "../email/learn/service.js";

export const learnRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get("/api/learn/status", async (): Promise<LearnStatus> => {
    return { runs: await listLearnRuns(), nextRunAt: nextLearnRunAt() };
  });

  app.get("/api/learn/voice-runs", async (): Promise<VoiceLearnRun[]> => listVoiceLearnRuns());

  app.get("/api/learn/voices", async (): Promise<AccountVoiceInfo[]> => listAccountVoiceInfos());
};
