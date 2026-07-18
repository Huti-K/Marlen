import type { Api, Model } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { LlmProviderInfo, ModelSettings } from "@trailin/shared";
import { getSetting, setSetting } from "../db/settings.js";
import { env } from "../env.js";
import { badRequest } from "../errors.js";
import { moduleLogger } from "../logger.js";
import { credentialStore } from "./credentialStore.js";

const log = moduleLogger("llm-registry");

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
    throw badRequest(`Unknown model "${model}" for provider "${provider}".`);
  }
  await setSetting("llm.provider", provider);
  await setSetting("llm.model", model);
}

export async function resolveActiveModel(): Promise<Model<Api>> {
  const { provider, model } = await getActiveModelIds();
  const resolved = modelRegistry.getModel(provider, model);
  if (!resolved) {
    throw badRequest(
      `Unknown model "${model}" for provider "${provider}". Pick a model in Settings.`,
    );
  }
  return resolved;
}

/**
 * The provider's cheapest model by the catalog's per-token cost metadata
 * (input + output rate). Router pseudo-entries carry sentinel negative rates
 * so they always "win" a naive sort — those never count as cheap.
 */
function cheapestModelOf(providerId: string): Model<Api> | undefined {
  let best: Model<Api> | undefined;
  let bestRate = Number.POSITIVE_INFINITY;
  for (const model of modelRegistry.getProvider(providerId)?.getModels() ?? []) {
    const { input, output } = model.cost;
    if (input < 0 || output < 0) continue;
    const rate = input + output;
    if (rate < bestRate) {
      best = model;
      bestRate = rate;
    }
  }
  return best;
}

/**
 * Cheap-tier model for high-volume background LLM seams (automation
 * suggestions, the draft-match tiebreak, nightly style extraction): tries an
 * optional caller override, then the cheapest model in the active provider's
 * own catalog — a different provider would need its own credentials —
 * falling back to the active model (with a warn, since every background call
 * then runs at full price) when neither resolves.
 */
export async function resolveCheapModel(overrideModelId?: string): Promise<Model<Api>> {
  const { provider } = await getActiveModelIds();
  if (overrideModelId) {
    const model = modelRegistry.getModel(provider, overrideModelId);
    if (model) return model;
  }
  const cheapest = cheapestModelOf(provider);
  if (cheapest) return cheapest;
  log.warn(
    { provider, ...(overrideModelId ? { overrideModelId } : {}) },
    "no cheap-tier model resolved; background LLM seams run the full-price active model",
  );
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
        oauth: Boolean(provider.auth.oauth),
        oauthName: provider.auth.oauth?.name,
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
    throw badRequest(`Unknown provider "${providerId}"`);
  }
  await credentialStore.modify(providerId, async () => ({ type: "api_key", key: apiKey }));
}

export async function clearCredential(providerId: string): Promise<void> {
  await credentialStore.delete(providerId);
}
