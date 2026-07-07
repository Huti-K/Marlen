import type { FastifyInstance } from "fastify";
import type { AppStatus } from "@trailin/shared";
import { listAccounts, pipedreamConfigured } from "../pipedream/connect.js";
import { activeModelConfigured, getActiveModelIds } from "../llm/registry.js";

export async function accountRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/status", async (): Promise<AppStatus> => {
    const { provider, model } = await getActiveModelIds();
    const configured = await pipedreamConfigured();
    // A Pipedream hiccup must not take the whole readiness gate down.
    const emailAccounts = configured
      ? await listAccounts().then((a) => a.length).catch(() => 0)
      : 0;
    return {
      pipedreamConfigured: configured,
      modelConfigured: await activeModelConfigured(),
      emailAccounts,
      provider,
      model,
    };
  });
}
