import type { Api, Model } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { getOAuthProvider } from "@earendil-works/pi-ai/oauth";
import type { LlmProviderInfo, ModelSettings } from "@trailin/shared";
import { eq } from "drizzle-orm";
import { credentialStore } from "../auth/credentialStore.js";
import { db, schema } from "../db/index.js";
import { env } from "../env.js";

/**
 * Single model registry for the whole app. Auth resolution order per call:
 * stored credential (subscription OAuth or saved API key) → environment.
 * OAuth tokens are auto-refreshed and written back to the store.
 */
export const modelRegistry = builtinModels({ credentials: credentialStore });

/** ---- active provider/model (persisted in SQLite settings) ---- */

async function getSetting(key: string): Promise<string | undefined> {
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, key));
  return row?.value;
}

async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(schema.settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value } });
}

export async function getActiveModelIds(): Promise<{ provider: string; model: string }> {
  return {
    provider: (await getSetting("llm.provider")) ?? env.agentProvider,
    model: (await getSetting("llm.model")) ?? env.agentModel,
  };
}

export async function setActiveModelIds(provider: string, model: string): Promise<void> {
  if (!modelRegistry.getModel(provider, model)) {
    throw new Error(`Unknown model "${model}" for provider "${provider}".`);
  }
  await setSetting("llm.provider", provider);
  await setSetting("llm.model", model);
}

export async function resolveActiveModel(): Promise<Model<Api>> {
  const { provider, model } = await getActiveModelIds();
  const resolved = modelRegistry.getModel(provider, model);
  if (!resolved) {
    throw new Error(
      `Unknown model "${model}" for provider "${provider}". Pick a model in Settings.`,
    );
  }
  return resolved;
}

/** True when the active model's provider has usable credentials. */
export async function activeModelConfigured(): Promise<boolean> {
  try {
    const model = await resolveActiveModel();
    return (await modelRegistry.getAuth(model)) !== undefined;
  } catch {
    return false;
  }
}

/** ---- provider listing for the Settings page ---- */

export async function listProviders(): Promise<LlmProviderInfo[]> {
  const providers = modelRegistry.getProviders();

  return Promise.all(
    providers.map(async (provider): Promise<LlmProviderInfo> => {
      const models = provider.getModels();
      const oauthProvider = getOAuthProvider(provider.id);

      let auth: LlmProviderInfo["auth"] = null;
      let authDetail: string | undefined;

      const stored = await credentialStore.read(provider.id);
      if (stored?.type === "oauth") {
        auth = "subscription";
        authDetail = provider.auth.oauth?.name;
      } else if (stored?.type === "api_key") {
        auth = "stored_key";
        authDetail = "Saved API key";
      } else {
        // Ambient config (env vars, AWS profiles, ADC files)?
        try {
          const first = models[0];
          const result = first ? await modelRegistry.getAuth(first) : undefined;
          if (result) {
            auth = "env";
            authDetail = result.source;
          }
        } catch {
          // Treat resolution failures as unconfigured for listing purposes.
        }
      }

      return {
        id: provider.id,
        name: provider.name,
        oauth: Boolean(oauthProvider ?? provider.auth.oauth),
        oauthName: provider.auth.oauth?.name ?? oauthProvider?.name,
        auth,
        authDetail,
        modelCount: models.length,
      };
    }),
  );
}

export async function getModelSettings(): Promise<ModelSettings> {
  const { provider, model } = await getActiveModelIds();
  return {
    provider,
    model,
    catalog: modelRegistry.getProviders().map((p) => ({
      id: p.id,
      name: p.name,
      models: p.getModels().map((m) => m.id),
    })),
  };
}

export async function saveApiKey(providerId: string, apiKey: string): Promise<void> {
  if (!modelRegistry.getProvider(providerId)) {
    throw new Error(`Unknown provider "${providerId}"`);
  }
  await credentialStore.modify(providerId, async () => ({ type: "api_key", key: apiKey }));
}

export async function clearCredential(providerId: string): Promise<void> {
  await credentialStore.delete(providerId);
}
