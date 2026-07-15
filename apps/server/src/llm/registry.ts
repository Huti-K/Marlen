import type { Api, Model } from "@earendil-works/pi-ai";
import { getOAuthProvider } from "@earendil-works/pi-ai/oauth";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { LlmProviderInfo, ModelSettings } from "@trailin/shared";
import { getSetting, setSetting } from "../db/settings.js";
import { env } from "../env.js";
import { credentialStore } from "./credentialStore.js";

/**
 * Single model registry for the whole app. Auth resolution order per call:
 * stored credential (subscription OAuth or saved API key) → environment.
 * OAuth tokens are auto-refreshed and written back to the store.
 */
export const modelRegistry = builtinModels({ credentials: credentialStore });

/** ---- active provider/model (persisted in SQLite settings) ---- */

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

/** Cheap-tier candidates tried against the active provider, in order, before the active-model fallback. */
const CHEAP_MODEL_CANDIDATES = ["claude-haiku-4-5", "claude-haiku-4-5-20251001"];

/**
 * Cheap-tier model for high-volume background LLM seams (thread enrichment,
 * contact judging, draft-match tiebreak, nightly style extraction): tries an
 * optional caller override, then the built-in cheap candidates, against the
 * active provider — a different provider would need its own credentials —
 * falling back to the active model when none of them resolve.
 */
export async function resolveCheapModel(overrideModelId?: string): Promise<Model<Api>> {
  const { provider } = await getActiveModelIds();
  const candidates = overrideModelId
    ? [overrideModelId, ...CHEAP_MODEL_CANDIDATES]
    : CHEAP_MODEL_CANDIDATES;
  for (const id of candidates) {
    const model = modelRegistry.getModel(provider, id);
    if (model) return model;
  }
  return resolveActiveModel();
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
