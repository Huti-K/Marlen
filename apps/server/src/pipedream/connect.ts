import { PipedreamClient } from "@pipedream/sdk";
import type {
  ConnectedAccount,
  ConnectTokenResponse,
  PipedreamApp,
  PipedreamStatus,
} from "@trailin/shared";
import { deleteSetting, getSetting, setSetting } from "../db/settings.js";
import { env } from "../env.js";

/**
 * Pipedream Connect (developer mode): the user's own Pipedream project powers
 * managed OAuth for any number of Gmail/Outlook accounts. Configured once in
 * Settings with an OAuth client (id + secret) and a project id.
 */

export type PipedreamEnvironment = "development" | "production";

export interface ConnectConfig {
  clientId: string;
  clientSecret: string;
  projectId: string;
  environment: PipedreamEnvironment;
  externalUserId: string;
  source: "settings" | "env";
}

const KEYS = {
  clientId: "pipedream.clientId",
  clientSecret: "pipedream.clientSecret",
  projectId: "pipedream.projectId",
  environment: "pipedream.environment",
  useCustom: "pipedream.useCustom",
} as const;

function asEnvironment(value: string | undefined): PipedreamEnvironment {
  return value === "production" ? "production" : "development";
}

/**
 * Accept a raw proj_… id or any Pipedream dashboard URL that contains one —
 * pasting the project URL is easier than hunting for the id inside it.
 */
export function extractProjectId(input: string): string | null {
  return input.trim().match(/proj_[A-Za-z0-9]+/)?.[0] ?? null;
}

/** Built-in credentials shipped with this deployment (today: the .env fallback). */
function builtinConfig(): ConnectConfig | null {
  const builtin = env.pipedream;
  if (!builtin.clientId || !builtin.clientSecret || !builtin.projectId) return null;
  return {
    clientId: builtin.clientId,
    clientSecret: builtin.clientSecret,
    projectId: builtin.projectId,
    environment: builtin.environment,
    externalUserId: builtin.externalUserId,
    source: "env",
  };
}

async function customConfig(): Promise<ConnectConfig | null> {
  const [clientId, clientSecret, projectId, environment] = await Promise.all([
    getSetting(KEYS.clientId),
    getSetting(KEYS.clientSecret),
    getSetting(KEYS.projectId),
    getSetting(KEYS.environment),
  ]);
  if (!clientId || !clientSecret || !projectId) return null;
  return {
    clientId,
    clientSecret,
    projectId,
    environment: asEnvironment(environment),
    externalUserId: env.pipedream.externalUserId,
    source: "settings",
  };
}

/**
 * Whether the user's own Pipedream project (vs the built-in credentials) is
 * active. Unset means: infer — saved custom credentials win, otherwise use
 * the built-in ones when available, otherwise custom (the only actionable
 * path on a build without built-in credentials).
 */
export async function getUseCustom(): Promise<boolean> {
  const explicit = await getSetting(KEYS.useCustom);
  if (explicit !== undefined) return explicit === "true";
  if (await getSetting(KEYS.clientId)) return true;
  return builtinConfig() === null;
}

export async function setUseCustom(useCustom: boolean): Promise<void> {
  await setSetting(KEYS.useCustom, String(useCustom));
}

/** Resolve the active credentials for the selected mode (null = not usable yet). */
export async function getConnectConfig(): Promise<ConnectConfig | null> {
  return (await getUseCustom()) ? customConfig() : builtinConfig();
}

export async function pipedreamConfigured(): Promise<boolean> {
  return (await getConnectConfig()) !== null;
}

export async function getPipedreamStatus(): Promise<PipedreamStatus> {
  const [useCustom, config] = await Promise.all([getUseCustom(), getConnectConfig()]);
  return {
    configured: config !== null,
    mode: useCustom ? "custom" : "builtin",
    builtinAvailable: builtinConfig() !== null,
    source: config?.source ?? null,
    clientId: config?.clientId ?? null,
    projectId: config?.projectId ?? null,
    environment: config?.environment ?? "development",
    hasClientSecret: config !== null,
  };
}

/** The client secret saved in the app (not the .env one), for edits that keep it. */
export async function getSavedClientSecret(): Promise<string | undefined> {
  return getSetting(KEYS.clientSecret);
}

export async function saveConnectSettings(input: {
  clientId: string;
  clientSecret: string;
  projectId: string;
  environment: PipedreamEnvironment;
}): Promise<void> {
  await setSetting(KEYS.clientId, input.clientId);
  await setSetting(KEYS.clientSecret, input.clientSecret);
  await setSetting(KEYS.projectId, input.projectId);
  await setSetting(KEYS.environment, input.environment);
}

/** Remove app-saved credentials; built-in ones (if any) become active again. */
export async function clearConnectSettings(): Promise<void> {
  for (const key of Object.values(KEYS)) await deleteSetting(key);
}

/** ---- SDK client (cached; rebuilt when credentials change) ---- */

let cached: { client: PipedreamClient; signature: string } | null = null;

function signatureOf(config: ConnectConfig): string {
  return [config.clientId, config.clientSecret, config.projectId, config.environment].join("\n");
}

function buildClient(config: ConnectConfig): PipedreamClient {
  return new PipedreamClient({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    projectId: config.projectId,
    projectEnvironment: config.environment,
  });
}

async function getClient(): Promise<{ pd: PipedreamClient; config: ConnectConfig }> {
  const config = await getConnectConfig();
  if (!config) {
    throw new Error(
      "Pipedream is not set up. Add your Pipedream credentials under Settings → Connect email.",
    );
  }
  const signature = signatureOf(config);
  if (!cached || cached.signature !== signature) {
    cached = { client: buildClient(config), signature };
  }
  return { pd: cached.client, config };
}

/**
 * Check candidate credentials against Pipedream before saving them: creating a
 * Connect token exercises the OAuth client (id/secret) and the project id.
 * Throws with Pipedream's error message when something is wrong.
 */
export async function verifyConnectConfig(
  config: Pick<
    ConnectConfig,
    "clientId" | "clientSecret" | "projectId" | "environment" | "externalUserId"
  >,
): Promise<void> {
  const pd = buildClient(config as ConnectConfig);
  await pd.tokens.create({ externalUserId: config.externalUserId });
}

/** OAuth access token for talking to Pipedream's remote MCP server. */
export async function getPipedreamAccessToken(): Promise<string> {
  const { pd } = await getClient();
  return pd.rawAccessToken;
}

/**
 * Create a short-lived Connect token and the hosted Connect Link URL the user
 * opens in a browser to run the Google/Microsoft OAuth flow. Repeatable per
 * app — every completed flow links one more account.
 */
export async function createConnectToken(app: string): Promise<ConnectTokenResponse> {
  const { pd, config } = await getClient();
  const res = await pd.tokens.create({ externalUserId: config.externalUserId });
  const url = new URL(res.connectLinkUrl);
  url.searchParams.set("app", app);
  return {
    token: res.token,
    connectLinkUrl: url.toString(),
    expiresAt:
      res.expiresAt instanceof Date ? res.expiresAt.toISOString() : String(res.expiresAt),
  };
}

/** All connected accounts, any app, any number per app. */
export async function listAccounts(): Promise<ConnectedAccount[]> {
  const { pd, config } = await getClient();
  const page = await pd.accounts.list({ externalUserId: config.externalUserId });

  const accounts: ConnectedAccount[] = [];
  for await (const account of page) {
    const a = account as {
      id: string;
      app?: { nameSlug?: string; name?: string };
      name?: string;
      healthy?: boolean;
      createdAt?: string | Date;
    };
    accounts.push({
      id: a.id,
      app: a.app?.nameSlug ?? "unknown",
      appName: a.app?.name,
      name: a.name ?? a.app?.name ?? a.id,
      healthy: a.healthy ?? true,
      createdAt:
        a.createdAt instanceof Date ? a.createdAt.toISOString() : String(a.createdAt ?? ""),
    });
  }
  // Stable order: oldest first, so tool names stay stable as accounts are added.
  return accounts.sort((x, y) => x.createdAt.localeCompare(y.createdAt));
}

/** Search Pipedream's app catalog (for the "connect an account" picker). */
export async function searchApps(query: string): Promise<PipedreamApp[]> {
  const { pd } = await getClient();
  const page = await pd.apps.list({ q: query, limit: 10 });
  const apps: PipedreamApp[] = [];
  for await (const app of page) {
    const a = app as { nameSlug?: string; name?: string; imgSrc?: string };
    if (!a.nameSlug || !a.name) continue;
    apps.push({ slug: a.nameSlug, name: a.name, imgSrc: a.imgSrc });
    if (apps.length >= 10) break;
  }
  return apps;
}

export async function deleteAccount(accountId: string): Promise<void> {
  const { pd } = await getClient();
  await pd.accounts.delete(accountId);
}

/**
 * Authenticated request to an external API through Pipedream's Connect proxy —
 * Pipedream injects the account's OAuth credentials. Used where the prebuilt
 * components fall short (e.g. their draft/send components need a paid
 * workspace for attachment handling; the proxy is available on all plans).
 */
export async function proxyRequest(
  accountId: string,
  method: "get" | "post" | "delete",
  url: string,
  opts: { params?: Record<string, string>; body?: unknown } = {},
): Promise<unknown> {
  const { pd, config } = await getClient();
  const request = {
    url,
    externalUserId: config.externalUserId,
    accountId,
    params: opts.params,
  };
  if (method === "get") return pd.proxy.get(request);
  if (method === "delete") return pd.proxy.delete(request);
  return pd.proxy.post({ ...request, body: (opts.body ?? {}) as Record<string, unknown> });
}
