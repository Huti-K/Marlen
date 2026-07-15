import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { AppStatus } from "@trailin/shared";
import { EMAIL_APPS } from "@trailin/shared";
import { activeModelConfigured, getActiveModelIds } from "../llm/registry.js";
import { listAccounts, pipedreamConfigured } from "../pipedream/connect.js";

export const accountRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get("/api/status", async (): Promise<AppStatus> => {
    const { provider, model } = await getActiveModelIds();
    const configured = await pipedreamConfigured();
    // A Pipedream hiccup must not take the whole readiness gate down — report
    // the count as unknown instead of silently claiming zero accounts.
    let emailAccounts = 0;
    let emailAccountsKnown = true;
    if (configured) {
      try {
        // Only mail apps count toward the setup gate — a Notion or Slack
        // connection alone must not make the app look "set up".
        const accounts = await listAccounts();
        emailAccounts = accounts.filter((a) =>
          (EMAIL_APPS as readonly string[]).includes(a.app),
        ).length;
      } catch {
        emailAccountsKnown = false;
      }
    }
    return {
      pipedreamConfigured: configured,
      modelConfigured: await activeModelConfigured(),
      emailAccounts,
      emailAccountsKnown,
      provider,
      model,
    };
  });
};
