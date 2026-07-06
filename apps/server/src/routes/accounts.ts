import type { FastifyInstance } from "fastify";
import { EMAIL_APPS, type AppStatus, type EmailApp } from "@trailin/shared";
import { pipedreamConfigured } from "../env.js";
import { activeModelConfigured, getActiveModelIds } from "../llm/registry.js";
import {
  createConnectToken,
  deleteAccount,
  listConnectedAccounts,
} from "../pipedream/client.js";

export async function accountRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/status", async (): Promise<AppStatus> => {
    const { provider, model } = await getActiveModelIds();
    return {
      pipedreamConfigured: pipedreamConfigured(),
      modelConfigured: await activeModelConfigured(),
      provider,
      model,
    };
  });

  app.get("/api/accounts", async (req, reply) => {
    try {
      return await listConnectedAccounts();
    } catch (error) {
      req.log.error(error, "listing accounts failed");
      return reply
        .code(502)
        .send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post<{ Body: { app: EmailApp } }>("/api/accounts/connect-token", async (req, reply) => {
    const appSlug = req.body?.app;
    if (!EMAIL_APPS.includes(appSlug)) {
      return reply.code(400).send({ error: `app must be one of: ${EMAIL_APPS.join(", ")}` });
    }
    try {
      return await createConnectToken(appSlug);
    } catch (error) {
      req.log.error(error, "creating connect token failed");
      return reply
        .code(502)
        .send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete<{ Params: { id: string } }>("/api/accounts/:id", async (req, reply) => {
    try {
      await deleteAccount(req.params.id);
      return { ok: true };
    } catch (error) {
      req.log.error(error, "deleting account failed");
      return reply
        .code(502)
        .send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
