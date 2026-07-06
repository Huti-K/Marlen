import "dotenv/config";

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : undefined;
}

export const env = {
  port: Number(optional("PORT") ?? 3001),
  databasePath: optional("DATABASE_PATH") ?? "./data/trailin.db",

  agentProvider: optional("AGENT_PROVIDER") ?? "anthropic",
  agentModel: optional("AGENT_MODEL") ?? "claude-opus-4-8",

  pipedream: {
    clientId: optional("PIPEDREAM_CLIENT_ID"),
    clientSecret: optional("PIPEDREAM_CLIENT_SECRET"),
    projectId: optional("PIPEDREAM_PROJECT_ID"),
    environment: (optional("PIPEDREAM_ENVIRONMENT") ?? "development") as
      | "development"
      | "production",
    externalUserId: optional("PIPEDREAM_EXTERNAL_USER_ID") ?? "local-user",
  },
};

export function pipedreamConfigured(): boolean {
  const { clientId, clientSecret, projectId } = env.pipedream;
  return Boolean(clientId && clientSecret && projectId);
}

export function assertPipedreamConfigured(): void {
  if (!pipedreamConfigured()) {
    throw new Error(
      "Pipedream Connect is not configured. Set PIPEDREAM_CLIENT_ID, PIPEDREAM_CLIENT_SECRET and PIPEDREAM_PROJECT_ID in .env (see .env.example).",
    );
  }
}
