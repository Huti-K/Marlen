import "dotenv/config";

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : undefined;
}

/** Dev-only sandbox: seeded fake accounts/drafts/digests, real Pipedream never called. */
const demoMode = optional("TRAILIN_DEMO") === "1";

export const env = {
  port: Number(optional("PORT") ?? 3001),
  demoMode,
  // Demo mode defaults to a sibling database file so it can never touch the
  // user's real data — an explicit DATABASE_PATH still always wins.
  databasePath:
    optional("DATABASE_PATH") ?? (demoMode ? "./data/demo.db" : "./data/trailin.db"),
  /** Default drop folder for the document library; a folder saved in the app wins. */
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
};
