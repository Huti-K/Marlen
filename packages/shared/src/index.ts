/** App slugs supported for Pipedream Connect. */
export const EMAIL_APPS = ["gmail", "microsoft_outlook"] as const;
export type EmailApp = (typeof EMAIL_APPS)[number];

export const EMAIL_APP_LABELS: Record<EmailApp, string> = {
  gmail: "Gmail",
  microsoft_outlook: "Outlook",
};

/** A connected account as reported by Pipedream Connect. */
export interface ConnectedAccount {
  id: string;
  app: string;
  name: string;
  healthy: boolean;
  createdAt: string;
}

export interface ConnectTokenResponse {
  token: string;
  connectLinkUrl: string;
  expiresAt: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface Automation {
  id: string;
  name: string;
  /** Natural-language instruction the agent executes on each run. */
  instruction: string;
  /** Standard 5-field cron expression, e.g. "0 8 * * 1-5". */
  schedule: string;
  enabled: boolean;
  createdAt: string;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  status: "running" | "success" | "error";
  /** Agent's final text (or the error message). */
  result: string;
  startedAt: string;
  finishedAt: string | null;
}

/** One LLM provider known to the pi SDK, with its current auth state. */
export interface LlmProviderInfo {
  id: string;
  name: string;
  /** Supports a subscription-style OAuth login (Claude Pro/Max, Copilot, ChatGPT). */
  oauth: boolean;
  /** Display name of the OAuth login, e.g. "Anthropic (Claude Pro/Max)". */
  oauthName?: string;
  /** How the provider is currently authenticated. */
  auth: "subscription" | "stored_key" | "env" | null;
  /** e.g. "ANTHROPIC_API_KEY" when auth === "env". */
  authDetail?: string;
  modelCount: number;
}

/** State of the (single) in-flight OAuth login flow. */
export interface LoginFlowStatus {
  providerId: string | null;
  providerName?: string;
  authUrl?: string;
  instructions?: string;
  deviceCode?: { userCode: string; verificationUri: string };
  prompt?: { message: string; placeholder?: string };
  select?: { message: string; options: { id: string; label: string }[] };
  done: boolean;
  error?: string;
}

export interface ModelSettings {
  provider: string;
  model: string;
  catalog: { id: string; name: string; models: string[] }[];
}

export interface AppStatus {
  pipedreamConfigured: boolean;
  /** Whether the active model's provider has working credentials. */
  modelConfigured: boolean;
  provider: string;
  model: string;
}

/** Server-sent events streamed from POST /api/chat. */
export type ChatStreamEvent =
  | { type: "conversation"; conversationId: string }
  | { type: "text_delta"; delta: string }
  | { type: "thinking" }
  | { type: "tool_start"; toolName: string }
  | { type: "tool_end"; toolName: string; isError: boolean }
  | { type: "done"; text: string }
  | { type: "error"; message: string };
