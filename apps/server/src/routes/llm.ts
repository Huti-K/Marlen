import type { FastifyInstance } from "fastify";
import {
  clearCredential,
  getModelSettings,
  listProviders,
  saveApiKey,
  setActiveModelIds,
} from "../llm/registry.js";
import {
  cancelLogin,
  getLoginStatus,
  provideLoginInput,
  provideLoginSelection,
  startLogin,
} from "../llm/loginFlow.js";
import { resetSessions } from "../agent/emailAgent.js";
import { errorMessage } from "../util.js";

export async function llmRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/llm/providers", async () => listProviders());

  app.get("/api/llm/model", async () => getModelSettings());

  app.put<{ Body: { provider: string; model: string } }>("/api/llm/model", async (req, reply) => {
    const { provider, model } = req.body ?? {};
    if (!provider || !model) {
      return reply.code(400).send({ error: "provider and model are required" });
    }
    try {
      await setActiveModelIds(provider, model);
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
    // New conversations pick up the new model; existing in-memory agents are dropped.
    await resetSessions();
    return getModelSettings();
  });

  app.get("/api/llm/login/status", async () => getLoginStatus());

  app.post<{ Body: { providerId: string } }>("/api/llm/login/start", async (req, reply) => {
    const providerId = req.body?.providerId;
    if (!providerId) return reply.code(400).send({ error: "providerId is required" });
    try {
      return startLogin(providerId, {
        info: (m) => req.log.info(m),
        warn: (m) => req.log.warn(m),
      });
    } catch (error) {
      return reply.code(409).send({ error: errorMessage(error) });
    }
  });

  app.post<{ Body: { value: string } }>("/api/llm/login/input", async (req, reply) => {
    const value = req.body?.value?.trim();
    if (!value) return reply.code(400).send({ error: "value is required" });
    try {
      provideLoginInput(value);
      return { ok: true };
    } catch (error) {
      return reply.code(409).send({ error: errorMessage(error) });
    }
  });

  app.post<{ Body: { optionId: string } }>("/api/llm/login/select", async (req, reply) => {
    const optionId = req.body?.optionId;
    if (!optionId) return reply.code(400).send({ error: "optionId is required" });
    try {
      provideLoginSelection(optionId);
      return { ok: true };
    } catch (error) {
      return reply.code(409).send({ error: errorMessage(error) });
    }
  });

  app.post("/api/llm/login/cancel", async () => {
    cancelLogin();
    return { ok: true };
  });

  app.post<{ Body: { providerId: string; apiKey: string } }>(
    "/api/llm/key",
    async (req, reply) => {
      const { providerId, apiKey } = req.body ?? {};
      if (!providerId || !apiKey?.trim()) {
        return reply.code(400).send({ error: "providerId and apiKey are required" });
      }
      try {
        await saveApiKey(providerId, apiKey.trim());
        await resetSessions();
        return { ok: true };
      } catch (error) {
        return reply.code(400).send({ error: errorMessage(error) });
      }
    },
  );

  app.post<{ Body: { providerId: string } }>("/api/llm/logout", async (req, reply) => {
    const providerId = req.body?.providerId;
    if (!providerId) return reply.code(400).send({ error: "providerId is required" });
    await clearCredential(providerId);
    await resetSessions();
    return { ok: true };
  });
}
