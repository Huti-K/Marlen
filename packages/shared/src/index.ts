/**
 * Suggested email apps, shown before the user searches the full catalog.
 * These are the mail providers Pipedream exposes as Connect apps; any other
 * app (mail or not) is a search away. `imap` is the catch-all for any other
 * mailbox that speaks IMAP.
 */
export const EMAIL_APPS = ["gmail", "microsoft_outlook", "zoho_mail", "imap"] as const;
export type EmailApp = (typeof EMAIL_APPS)[number];

export const EMAIL_APP_LABELS: Record<EmailApp, string> = {
  gmail: "Gmail",
  // Microsoft Graph — covers outlook.com and Microsoft 365 / Exchange Online.
  microsoft_outlook: "Outlook / Microsoft 365",
  zoho_mail: "Zoho Mail",
  imap: "IMAP (any other provider)",
};

/**
 * A small teaser of popular non-email integrations, shown under the email apps
 * so the picker makes clear Trailin connects far more than mail. The full
 * catalog (2,000+ apps) is always a search away.
 */
export const POPULAR_APPS = [
  "notion",
  "slack_bot",
  "google_calendar",
  "google_drive",
  "github",
  "todoist",
] as const;

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
  /** App logo URL from Pipedream's catalog, for the account row icon. */
  imgSrc?: string;
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

/**
 * A user-written note on a connected account describing what it's for. Unlike
 * the app/name (which come from Pipedream), this is app-local and, crucially,
 * fed to the agent as tool context so it knows why the connection exists
 * (e.g. a Notion account connected "to save meeting notes").
 */
export interface AccountDescription {
  /** Pipedream account id. */
  accountId: string;
  /** Free-text purpose, e.g. "Save meeting notes here". */
  text: string;
}

export interface ConnectTokenResponse {
  token: string;
  connectLinkUrl: string;
  expiresAt: string;
  /** Pipedream external user id; the browser Connect SDK needs it to start the flow. */
  externalUserId: string;
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
  /** Whether this automation's runs appear in the Home activity feed. */
  showInActivity: boolean;
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
  /**
   * Whether `emailAccounts` is a real answer: true when the account list was
   * actually fetched, or when Pipedream isn't configured at all (0 is a real
   * answer then too). False only when Pipedream IS configured but listing
   * accounts failed — a transient outage, not a setup problem.
   */
  emailAccountsKnown: boolean;
  provider: string;
  model: string;
  /** True when the server is running in dev-only demo mode (seeded fake data). */
  demo?: boolean;
}

/** The app is usable once the model has credentials and an email account is linked.
 *  An unknown account count (provider unreachable) never counts as incomplete —
 *  only a confirmed zero does. */
export function isSetupComplete(status: AppStatus): boolean {
  return status.modelConfigured && (status.emailAccounts > 0 || !status.emailAccountsKnown);
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

/** Human-readable file size, e.g. "600 B", "12.9 KB", "1.4 MB". */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Topics broadcast over GET /api/events when server-side data changes. */
export type ServerEventTopic =
  | "runs"           // automation run started/finished (activity feed, run history)
  | "drafts"         // a Gmail draft was created or deleted
  | "memories"       // agent memory saved/updated/deleted
  | "library"        // library document written/changed
  | "conversations"  // chat/automation conversation list changed
  | "automations";   // automation definitions created/updated/deleted

export interface ServerEvent {
  topic: ServerEventTopic;
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
