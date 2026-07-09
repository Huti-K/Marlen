import type { FastifyInstance } from "fastify";
import type { PipedreamConfigInput } from "@trailin/shared";
import "../email/registerProviders.js";
import { invalidateDraftsCacheEverywhere } from "../email/providers.js";
import {
  clearConnectSettings,
  createConnectToken,
  deleteAccount,
  extractProjectId,
  getPipedreamStatus,
  getSavedClientSecret,
  getDefaultApps,
  listAccounts,
  saveConnectSettings,
  searchApps,
  setUseCustom,
  verifyConnectConfig,
} from "../pipedream/connect.js";
import { env } from "../env.js";
import { resetSessions } from "../agent/emailAgent.js";
import { errorMessage } from "../util.js";

export async function pipedreamRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/pipedream", async () => getPipedreamStatus());

  app.put<{ Body: PipedreamConfigInput }>("/api/pipedream", async (req, reply) => {
    const body = req.body ?? ({} as PipedreamConfigInput);
    const clientId = body.clientId?.trim();
    if (!clientId) {
      return reply.code(400).send({ error: "clientId is required" });
    }
    // The project field accepts a raw proj_… id or any URL containing one.
    const projectId = extractProjectId(body.project ?? "");
    if (!projectId) {
      return reply
        .code(400)
        .send({ error: "project must be a proj_… id or a Pipedream project URL" });
    }
    // An empty secret on edit means "keep the one already saved".
    const clientSecret = body.clientSecret?.trim() || (await getSavedClientSecret());
    if (!clientSecret) {
      return reply.code(400).send({ error: "clientSecret is required" });
    }
    const environment = body.environment === "production" ? "production" : "development";

    const candidate = {
      clientId,
      clientSecret,
      projectId,
      environment,
      externalUserId: env.pipedream.externalUserId,
    } as const;
    try {
      await verifyConnectConfig(candidate);
    } catch (error) {
      return reply
        .code(400)
        .send({ error: `Pipedream rejected these credentials: ${errorMessage(error)}` });
    }

    await saveConnectSettings(candidate);
    // Saving your own credentials implies you want to use them.
    await setUseCustom(true);
    // Live agents hold MCP sessions built with the old credentials.
    await resetSessions();
    return getPipedreamStatus();
  });

  /** Switch between the built-in Pipedream credentials and the user's own. */
  app.put<{ Body: { useCustom: boolean } }>("/api/pipedream/mode", async (req, reply) => {
    if (typeof req.body?.useCustom !== "boolean") {
      return reply.code(400).send({ error: "useCustom must be a boolean" });
    }
    await setUseCustom(req.body.useCustom);
    await resetSessions();
    return getPipedreamStatus();
  });

  app.delete("/api/pipedream", async () => {
    await clearConnectSettings();
    await resetSessions();
    return getPipedreamStatus();
  });

  /** ---- connected accounts (any app, any number per app) ---- */

  app.get("/api/pipedream/accounts", async (req, reply) => {
    try {
      return await listAccounts();
    } catch (error) {
      req.log.error(error, "listing accounts failed");
      return reply.code(502).send({ error: errorMessage(error) });
    }
  });

  /** Search Pipedream's app catalog for the provider picker. */
  app.get<{ Querystring: { q?: string } }>("/api/pipedream/apps", async (req, reply) => {
    const q = req.query.q?.trim() || "";
    try {
      return q ? await searchApps(q) : await getDefaultApps();
    } catch (error) {
      req.log.error(error, "searching apps failed");
      return reply.code(502).send({ error: errorMessage(error) });
    }
  });

  app.post<{ Body: { app: string } }>(
    "/api/pipedream/accounts/connect-token",
    async (req, reply) => {
      const appSlug = req.body?.app?.trim();
      if (!appSlug || !/^[a-z0-9_]+$/.test(appSlug)) {
        return reply.code(400).send({ error: "app must be a Pipedream app slug" });
      }
      try {
        return await createConnectToken(appSlug);
      } catch (error) {
        req.log.error(error, "creating connect token failed");
        return reply.code(502).send({ error: errorMessage(error) });
      }
    },
  );

  app.delete<{ Params: { id: string } }>("/api/pipedream/accounts/:id", async (req, reply) => {
    try {
      await deleteAccount(req.params.id);
      // Live agents may hold tools for the removed account.
      await resetSessions();
      // The account's app slug is gone along with it, so sweep every
      // provider's drafts cache rather than looking the app up first.
      invalidateDraftsCacheEverywhere(req.params.id);
      return { ok: true };
    } catch (error) {
      req.log.error(error, "deleting account failed");
      return reply.code(502).send({ error: errorMessage(error) });
    }
  });
}
