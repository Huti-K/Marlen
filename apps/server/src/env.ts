import "dotenv/config";

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : undefined;
}

export const env = {
  port: Number(optional("PORT") ?? 3001),
  databasePath: optional("DATABASE_PATH") ?? "./data/trailin.db",
  /** Drop folder for the document library (PDF / Markdown / text). */
  libraryPath: optional("LIBRARY_PATH") ?? "./data/library",

  agentProvider: optional("AGENT_PROVIDER") ?? "anthropic",
  agentModel: optional("AGENT_MODEL") ?? "claude-opus-4-8",

  // Fallbacks only — credentials saved in the app (Settings → Connect email)
  // take precedence; see pipedream/connect.ts.
  pipedream: {
    clientId: optional("PIPEDREAM_CLIENT_ID"),
    clientSecret: optional("PIPEDREAM_CLIENT_SECRET"),
    projectId: optional("PIPEDREAM_PROJECT_ID"),
    environment: (optional("PIPEDREAM_ENVIRONMENT") ?? "development") as
      | "development"
      | "production",
    externalUserId: optional("PIPEDREAM_EXTERNAL_USER_ID") ?? "local-user",
  },
  encryptionKey: optional("ENCRYPTION_KEY"),
};
