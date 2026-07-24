import type { LlmUsage, UsageWindow } from "@marlen/shared";
import { moduleLogger } from "../../core/logger.js";
import { isRecord } from "../../core/utils/util.js";
import { credentialStore } from "./credentialStore.js";
import { modelRegistry } from "./registry.js";

const log = moduleLogger("llm-usage");

// Per-provider cache bounding calls to the external endpoints, not freshness.
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; value: LlmUsage | null }>();

type ProviderUsage = Omit<LlmUsage, "provider">;

/** Per-provider subscription-usage fetchers; providers without one report nothing. */
const usageFetchers: Record<string, () => Promise<ProviderUsage | null>> = {
  anthropic: fetchAnthropicWindows,
  "openai-codex": fetchCodexWindows,
};

/** Rate-window usage for every connected subscription sign-in with a fetcher. */
export async function fetchLlmUsage(): Promise<LlmUsage[]> {
  const subscribed = (await credentialStore.list())
    .filter((c) => c.type === "oauth" && usageFetchers[c.providerId])
    .map((c) => c.providerId);
  const usages = await Promise.all(subscribed.map(fetchProviderUsage));
  return usages.filter((u): u is LlmUsage => u !== null);
}

async function fetchProviderUsage(provider: string): Promise<LlmUsage | null> {
  const cached = cache.get(provider);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  let value: LlmUsage | null = null;
  try {
    const usage = await usageFetchers[provider]?.();
    if (usage?.windows.length) value = { provider, ...usage };
  } catch (err) {
    log.warn({ err, provider }, "subscription usage fetch failed");
  }
  cache.set(provider, { at: Date.now(), value });
  return value;
}

/**
 * Anthropic's OAuth usage endpoint (what Claude Code's /usage reads). Only
 * meaningful for subscription (OAuth) sign-ins; API keys have no windows.
 */
async function fetchAnthropicWindows(): Promise<ProviderUsage | null> {
  const credential = await credentialStore.read("anthropic");
  if (credential?.type !== "oauth") return null;
  // getAuth refreshes an expired token under the store lock before handing it out.
  const auth = await modelRegistry.getAuth("anthropic");
  const token = auth?.auth.apiKey;
  if (!token) return null;

  const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
    headers: anthropicOauthHeaders(token),
  });
  if (!res.ok) {
    log.warn({ status: res.status }, "anthropic usage endpoint returned an error");
    return null;
  }

  // Undocumented endpoint. The `limits` array is the authoritative modern
  // shape — it also carries model-scoped weekly windows (Fable, Opus) that
  // never appear as top-level keys. The top-level utilization records remain
  // as fallback for older response shapes.
  const body: unknown = await res.json();
  if (!isRecord(body)) return null;
  const windows: UsageWindow[] = [];
  if (Array.isArray(body.limits)) {
    for (const raw of body.limits) {
      if (!isRecord(raw) || typeof raw.percent !== "number") continue;
      windows.push({
        id: anthropicLimitId(raw),
        usedPct: Math.min(100, Math.max(0, Math.round(raw.percent))),
        resetsAt: typeof raw.resets_at === "string" ? raw.resets_at : null,
      });
    }
  }
  if (windows.length === 0) {
    for (const [key, raw] of Object.entries(body)) {
      if (!isRecord(raw) || typeof raw.utilization !== "number") continue;
      windows.push({
        id: windowId(key),
        usedPct: Math.min(100, Math.max(0, Math.round(raw.utilization))),
        resetsAt: typeof raw.resets_at === "string" ? raw.resets_at : null,
      });
    }
  }
  // 5h first, then the plain week, then model-scoped weeks — the ring reads
  // the first meter's order and response order isn't guaranteed.
  return {
    windows: windows.sort((a, b) => windowRank(a.id) - windowRank(b.id)),
    plan: await fetchAnthropicPlan(token),
  };
}

function anthropicOauthHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "anthropic-beta": "oauth-2025-04-20",
    // The endpoints bucket rate limits by user agent; the default bucket
    // 429s aggressively, the Claude Code bucket doesn't.
    "user-agent": "claude-code/2.1.2",
  };
}

/** One limits[] entry: "session" → 5h; weekly windows keep their scope's own
 *  model display name ("Fable" → week_fable), so new tiers label themselves. */
function anthropicLimitId(raw: Record<string, unknown>): string {
  const kind = typeof raw.kind === "string" ? raw.kind : "";
  const group = typeof raw.group === "string" ? raw.group : "";
  const scopeModel = isRecord(raw.scope) && isRecord(raw.scope.model) ? raw.scope.model : null;
  const model =
    scopeModel && typeof scopeModel.display_name === "string" ? scopeModel.display_name : null;
  if (kind === "session" || group === "session") return "5h";
  if (group === "weekly" || kind.startsWith("weekly")) {
    return model ? `week_${model.toLowerCase()}` : "week";
  }
  return kind || "week";
}

/** The subscription tier lives on the OAuth profile, not the usage response:
 *  organization.rate_limit_tier ("default_claude_max_20x" → "max_20x"), with
 *  the account's max/pro flags as fallback. Fail-open to a null plan. */
async function fetchAnthropicPlan(token: string): Promise<string | null> {
  try {
    const res = await fetch("https://api.anthropic.com/api/oauth/profile", {
      headers: anthropicOauthHeaders(token),
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (!isRecord(body)) return null;
    const org = isRecord(body.organization) ? body.organization : {};
    const tier = firstString(org, "rate_limit_tier");
    if (tier) return tier.replace(/^default_/, "").replace(/^claude_/, "");
    const account = isRecord(body.account) ? body.account : {};
    if (account.has_claude_max === true) return "max";
    if (account.has_claude_pro === true) return "pro";
    return null;
  } catch {
    return null;
  }
}

/**
 * ChatGPT's Codex usage endpoint (what Codex CLI's /status polls). Primary is
 * the rolling 5-hour window, secondary the week. Undocumented and its field
 * spellings have drifted across Codex releases, so both variants of every
 * field are accepted and anything unparseable is skipped.
 */
async function fetchCodexWindows(): Promise<ProviderUsage | null> {
  const credential = await credentialStore.read("openai-codex");
  if (credential?.type !== "oauth") return null;
  const auth = await modelRegistry.getAuth("openai-codex");
  const token = auth?.auth.apiKey;
  if (!token) return null;

  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  const accountId = chatgptAccountId(token);
  if (accountId) headers["chatgpt-account-id"] = accountId;

  const res = await fetch("https://chatgpt.com/backend-api/wham/usage", { headers });
  if (!res.ok) {
    log.warn({ status: res.status }, "codex usage endpoint returned an error");
    return null;
  }

  const body: unknown = await res.json();
  if (!isRecord(body)) return null;
  const limits = [body.rate_limits, body.rate_limit].find(isRecord) ?? body;
  const windows: UsageWindow[] = [];
  const primary = firstRecord(limits, "primary", "primary_window");
  const secondary = firstRecord(limits, "secondary", "secondary_window");
  if (primary) pushCodexWindow(windows, primary, "5h");
  if (secondary) pushCodexWindow(windows, secondary, "week");
  return {
    windows: windows.sort((a, b) => windowRank(a.id) - windowRank(b.id)),
    plan: firstString(body, "plan_type", "plan"),
  };
}

/** The chatgpt_account_id claim of the access token; requests carry it as a header. */
function chatgptAccountId(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!isRecord(claims)) return null;
    const auth = claims["https://api.openai.com/auth"];
    return isRecord(auth) && typeof auth.chatgpt_account_id === "string"
      ? auth.chatgpt_account_id
      : null;
  } catch {
    return null;
  }
}

function firstRecord(
  source: Record<string, unknown>,
  ...keys: string[]
): Record<string, unknown> | null {
  for (const key of keys) {
    const value = source[key];
    if (isRecord(value)) return value;
  }
  return null;
}

function firstString(source: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value) return value;
  }
  return null;
}

function pushCodexWindow(
  windows: UsageWindow[],
  raw: Record<string, unknown>,
  fallback: "5h" | "week",
): void {
  if (typeof raw.used_percent !== "number") return;
  const resetsAt = codexResetIso(raw);
  windows.push({
    id: codexWindowId(raw, fallback, resetsAt),
    usedPct: Math.min(100, Math.max(0, Math.round(raw.used_percent))),
    resetsAt,
  });
}

const WINDOW_ORDER: Record<string, number> = { "5h": 0, week: 1, month: 2 };

/**
 * Codex windows are positional (primary ≈ 5h, secondary ≈ week), but some
 * plans report other spans (monthly credit windows), so the reported duration
 * — or failing that the reset distance — wins over position. Position only
 * sets the floor: a week never demotes to 5h just because it resets soon.
 */
function codexWindowId(
  raw: Record<string, unknown>,
  fallback: "5h" | "week",
  resetsAt: string | null,
): string {
  const minutes =
    typeof raw.window_minutes === "number"
      ? raw.window_minutes
      : typeof raw.limit_window_seconds === "number"
        ? raw.limit_window_seconds / 60
        : null;
  const days =
    minutes !== null
      ? minutes / 1440
      : resetsAt !== null
        ? (Date.parse(resetsAt) - Date.now()) / 86_400_000
        : null;
  if (days === null || Number.isNaN(days)) return fallback;
  const bySpan = days <= 1 ? "5h" : days <= 10 ? "week" : "month";
  return (WINDOW_ORDER[bySpan] ?? 0) < (WINDOW_ORDER[fallback] ?? 0) ? fallback : bySpan;
}

/** Reset time as absolute unix seconds/ms ("resets_at"/"reset_at") or relative seconds. */
function codexResetIso(raw: Record<string, unknown>): string | null {
  const at = raw.resets_at ?? raw.reset_at;
  if (typeof at === "number") return new Date(at > 1e12 ? at : at * 1000).toISOString();
  if (typeof at === "string") return at;
  const inSeconds = raw.resets_in_seconds;
  if (typeof inSeconds === "number") return new Date(Date.now() + inSeconds * 1000).toISOString();
  return null;
}

/** "five_hour" → "5h", "seven_day" → "week", "seven_day_<model>" → "week_<model>". */
function windowId(key: string): string {
  if (key === "five_hour") return "5h";
  if (key === "seven_day") return "week";
  return key.startsWith("seven_day_") ? `week_${key.slice("seven_day_".length)}` : key;
}

function windowRank(id: string): number {
  if (id === "5h") return 0;
  if (id === "week") return 1;
  if (id.startsWith("week_")) return 2;
  return id === "month" ? 3 : 4;
}
