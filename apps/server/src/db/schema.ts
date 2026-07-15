import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  type: text("type", { enum: ["chat", "automation"] })
    .notNull()
    .default("chat"),
  /**
   * Conversation focus: the account (and, while one email is the topic, the
   * thread) this chat works in. Last writer wins — a manual pick from the
   * chip, an @-mention ref, or the agent's own tool activity all move it;
   * null = no focus yet ("all accounts").
   */
  focusAccountId: text("focus_account_id"),
  focusThreadId: text("focus_thread_id"),
  /** Display subject for the focused thread, so the chip needs no provider lookup. */
  focusThreadSubject: text("focus_thread_subject"),
  createdAt: text("created_at").notNull(),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  /** JSON-encoded MessageCard[] — the cards an assistant turn produced; null for none. */
  cards: text("cards"),
  /** JSON-encoded ChatToolCall[] for restoring tool activity in history. */
  toolCalls: text("tool_calls"),
  /** Turn-level agent/provider error, if the response ended unsuccessfully. */
  error: text("error"),
  /** JSON-encoded EmailRef[] — emails the user pinned to this message; null for none. */
  refs: text("refs"),
  createdAt: text("created_at").notNull(),
});

/**
 * Snapshot of every agent-written draft (db/draftStore.ts): what the agent
 * composed survives here even after the provider draft is edited, sent, or
 * deleted — the provider stays source of truth for the live drafts list; these
 * rows exist for the draft-vs-sent learning loop and for navigation
 * (conversation_id lets the Drafts list reopen the chat that wrote a draft).
 * Body text lives in agent_draft_versions; the row keeps identity, recipients
 * as at creation, the account signature at compose time (so diffs can strip
 * it), and the draft's fate.
 */
export const agentDrafts = sqliteTable("agent_drafts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerDraftId: text("provider_draft_id").notNull(),
  providerMessageId: text("provider_message_id"),
  /** Provider thread id the draft replies to; null for standalone drafts. */
  threadId: text("thread_id"),
  /** Chat/automation conversation whose turn created the draft; null until linked. */
  conversationId: text("conversation_id"),
  subject: text("subject").notNull().default(""),
  /** JSON-encoded string[]. */
  toAddrs: text("to_addrs").notNull().default("[]"),
  /** JSON-encoded string[]. */
  ccAddrs: text("cc_addrs").notNull().default("[]"),
  /** JSON-encoded string[]. */
  bccAddrs: text("bcc_addrs").notNull().default("[]"),
  /** The account's configured signature at compose time; null when none. */
  signature: text("signature"),
  status: text("status", { enum: ["open", "sent", "discarded"] })
    .notNull()
    .default("open"),
  /** Provider id of the sent message, when known (in-app sends record it exactly). */
  sentMessageId: text("sent_message_id"),
  /** Set once the learning loop has consumed this row; prevents double-learning. */
  learnedAt: text("learned_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Append-only body/subject history of an agent draft: version 1 is what the
 * create tool saved, later rows record in-app rewrites (author "agent") and
 * manual UI edits (author "user"). The learning loop diffs the sent text
 * against the last agent-authored version.
 */
export const agentDraftVersions = sqliteTable("agent_draft_versions", {
  draftId: text("draft_id").notNull(),
  version: integer("version").notNull(),
  author: text("author", { enum: ["agent", "user"] }).notNull(),
  subject: text("subject").notNull().default(""),
  body: text("body").notNull(),
  createdAt: text("created_at").notNull(),
});

export const automations = sqliteTable("automations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  instruction: text("instruction").notNull(),
  schedule: text("schedule").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  showInActivity: integer("show_in_activity", { mode: "boolean" }).notNull().default(true),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const memories = sqliteTable("memories", {
  id: text("id").primaryKey(),
  content: text("content").notNull(),
  source: text("source", { enum: ["user", "agent"] }).notNull(),
  /** Connected-account id the fact is scoped to; null = applies everywhere. */
  accountId: text("account_id"),
  /**
   * Normalized email address the fact is about; the third scope axis. A
   * memory is global, account-scoped, OR contact-scoped — contact-scoped
   * facts reach the agent when it works with that correspondent.
   */
  contactId: text("contact_id"),
  /** Times the agent reported relying on this entry (memory_used) — feeds the prune-candidate hints. */
  usedCount: integer("used_count").notNull().default(0),
  /** ISO timestamp of the most recent reported use; null until first used. */
  lastUsedAt: text("last_used_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * One file of the document library. The searchable text lives in the
 * library_chunks FTS5 table (raw SQL — drizzle can't model virtual tables).
 */
export const libraryDocuments = sqliteTable("library_documents", {
  id: text("id").primaryKey(),
  path: text("path").notNull().unique(),
  title: text("title").notNull(),
  ext: text("ext").notNull(),
  size: integer("size").notNull(),
  mtimeMs: integer("mtime_ms").notNull(),
  status: text("status", { enum: ["indexed", "error"] }).notNull(),
  error: text("error"),
  chunkCount: integer("chunk_count").notNull().default(0),
  textLength: integer("text_length").notNull().default(0),
  indexedAt: text("indexed_at").notNull(),
});

export const automationRuns = sqliteTable("automation_runs", {
  id: text("id").primaryKey(),
  automationId: text("automation_id").notNull(),
  status: text("status", { enum: ["running", "success", "error"] }).notNull(),
  result: text("result").notNull().default(""),
  /** JSON-encoded MessageCard[] — the cards the run's assistant turn produced; null for none. */
  cards: text("cards"),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
});
