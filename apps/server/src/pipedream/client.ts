import { PipedreamClient } from "@pipedream/sdk";
import type { ConnectedAccount, ConnectTokenResponse } from "@trailin/shared";
import { assertPipedreamConfigured, env } from "../env.js";

let client: PipedreamClient | null = null;

export function getPipedreamClient(): PipedreamClient {
  assertPipedreamConfigured();
  if (!client) {
    client = new PipedreamClient({
      clientId: env.pipedream.clientId!,
      clientSecret: env.pipedream.clientSecret!,
      projectId: env.pipedream.projectId!,
      projectEnvironment: env.pipedream.environment,
    });
  }
  return client;
}

/** OAuth access token for talking to Pipedream's remote MCP server. */
export async function getPipedreamAccessToken(): Promise<string> {
  return getPipedreamClient().rawAccessToken;
}

/**
 * Create a short-lived Connect token and the hosted Connect Link URL the user
 * opens in a browser to run the Google/Microsoft OAuth flow.
 */
export async function createConnectToken(app: string): Promise<ConnectTokenResponse> {
  const pd = getPipedreamClient();
  const res = await pd.tokens.create({
    externalUserId: env.pipedream.externalUserId,
  });
  // The hosted Connect Link URL; the `app` param preselects Gmail/Outlook.
  const url = new URL(res.connectLinkUrl);
  url.searchParams.set("app", app);
  return {
    token: res.token,
    connectLinkUrl: url.toString(),
    expiresAt:
      res.expiresAt instanceof Date ? res.expiresAt.toISOString() : String(res.expiresAt),
  };
}

/** List accounts the user has connected through Pipedream Connect. */
export async function listConnectedAccounts(): Promise<ConnectedAccount[]> {
  const pd = getPipedreamClient();
  const page = await pd.accounts.list({
    externalUserId: env.pipedream.externalUserId,
  });

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
      app: a.app?.nameSlug ?? a.app?.name ?? "unknown",
      name: a.name ?? a.app?.name ?? a.id,
      healthy: a.healthy ?? true,
      createdAt:
        a.createdAt instanceof Date ? a.createdAt.toISOString() : String(a.createdAt ?? ""),
    });
  }
  return accounts;
}

export async function deleteAccount(accountId: string): Promise<void> {
  await getPipedreamClient().accounts.delete(accountId);
}
