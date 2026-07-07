/**
 * Suggested email apps, shown before the user searches the full catalog
 * (Pipedream app registry slugs — any app can be connected).
 */
export const EMAIL_APPS = ["gmail", "microsoft_outlook"] as const;
export type EmailApp = (typeof EMAIL_APPS)[number];

export const EMAIL_APP_LABELS: Record<EmailApp, string> = {
  gmail: "Gmail",
  // Microsoft Graph — covers outlook.com and Microsoft 365 / Exchange Online.
  microsoft_outlook: "Outlook / Microsoft 365",
};

/** One entry of Pipedream's app catalog. */
export interface PipedreamApp {
  slug: string;
  name: string;
  imgSrc?: string;
}

/** Languages the app ships translations for. */
export const SUPPORTED_LANGUAGES = ["en", "de"] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

/** Native names, for the language picker. */
export const LANGUAGE_LABELS: Record<Language, string> = {
  en: "English",
  de: "Deutsch",
};

/** English names, used when instructing the agent which language to answer in. */
export const LANGUAGE_ENGLISH_NAMES: Record<Language, string> = {
  en: "English",
  de: "German",
};

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/** Pipedream Connect credential state, as shown in Settings. */
export interface PipedreamStatus {
  configured: boolean;
  /** "custom" = the user's own Pipedream project, "builtin" = credentials shipped with the app. */
  mode: "custom" | "builtin";
  /** True when this deployment ships built-in Pipedream credentials. */
  builtinAvailable: boolean;
  /** Where the active credentials come from: saved in the app or .env. */
  source: "settings" | "env" | null;
  clientId: string | null;
  projectId: string | null;
  environment: "development" | "production";
  /** True when a client secret is stored (the secret itself is never returned). */
  hasClientSecret: boolean;
}

/** Body of PUT /api/pipedream. clientSecret may be omitted to keep the saved one. */
export interface PipedreamConfigInput {
  clientId: string;
  clientSecret?: string;
  /** A proj_… id or any Pipedream project URL containing one. */
  project: string;
  environment?: "development" | "production";
}

/** One connected account (any app; several per app are fine). */
export interface ConnectedAccount {
  id: string;
  /** Pipedream app slug, e.g. "gmail". */
  app: string;
  /** Display name of the app, e.g. "Gmail". */
  appName?: string;
  /** Usually the account's email address. */
  name: string;
  healthy: boolean;
  createdAt: string;
}

/** Persisted color assignment for a connected account. */
export interface AccountColor {
  /** Pipedream account id. */
  accountId: string;
  /** Resolved hex. */
  hex: string;
}

export interface ConnectTokenResponse {
  token: string;
  connectLinkUrl: string;
  expiresAt: string;
}

export interface Conversation {
  id: string;
  title: string;
  type?: "chat" | "automation";
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

/** One run in the cross-automation feed (Digest view). */
export interface RunFeedItem extends AutomationRun {
  automationName: string | null;
}

/** One unsent draft, as it currently exists in the mail account. */
export interface EmailDraft {
  id: string;
  messageId: string;
  threadId: string;
  subject: string;
  to: string;
  date: string;
  /** Deep link to review/send the draft in the provider's web UI. */
  webUrl: string;
}

/** Live drafts of one connected account (Drafts view). */
export interface AccountDrafts {
  account: string;
  accountId: string;
  drafts: EmailDraft[];
  error?: string;
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
  /** Connected email accounts (0 when Pipedream is unconfigured or unreachable). */
  emailAccounts: number;
  provider: string;
  model: string;
}

/** The app is usable once the model has credentials and an email account is linked. */
export function isSetupComplete(status: AppStatus): boolean {
  return status.modelConfigured && status.emailAccounts > 0;
}

/** One long-term memory entry, shown in the agent's system prompt. */
export interface MemoryEntry {
  id: string;
  content: string;
  /** "user" = added in Settings, "agent" = saved by the assistant itself. */
  source: "user" | "agent";
  createdAt: string;
  updatedAt: string;
}

/** One file of the local document library (the drop folder). */
export interface LibraryDocument {
  id: string;
  /** Path relative to the library folder, e.g. "contracts/lease.pdf". */
  path: string;
  /** File name without extension, used as the display title. */
  title: string;
  ext: string;
  /** File size in bytes. */
  size: number;
  status: "indexed" | "error";
  /** Extraction/indexing error, when status is "error". */
  error: string | null;
  chunkCount: number;
  /** Characters of extracted text. */
  textLength: number;
  modifiedAt: string;
  indexedAt: string;
}

export interface LibraryStatus {
  /** Absolute path of the drop folder on the server's machine. */
  folder: string;
  documents: LibraryDocument[];
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
