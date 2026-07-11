import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import { env } from "../env.js";
import * as schema from "./schema.js";

/**
 * Lazy singleton: importing this module never touches the filesystem — the
 * database file is created, opened, and DDL-initialized on first use. That
 * keeps `buildApp()` importable by tests, which point DATABASE_PATH at a
 * scratch file (test/setup.ts) before any query runs. Statement modules that
 * want module-scope prepared statements use `lazyStatement` below for the
 * same reason.
 */

type DrizzleDb = BetterSQLite3Database<typeof schema>;

interface DbHandle {
  sqlite: Database.Database;
  db: DrizzleDb;
}

let handle: DbHandle | null = null;

function openHandle(): DbHandle {
  if (handle) return handle;

  const dbPath = resolve(process.cwd(), env.databasePath);
  mkdirSync(dirname(dbPath), { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  // Wait up to 5s for a competing writer instead of throwing SQLITE_BUSY: under
  // WAL the server, the sync engine, and a `pnpm start` alongside `pnpm dev` can
  // all hold the DB at once, and a locked moment shouldn't fail a request.
  sqlite.pragma("busy_timeout = 5000");

  // Idempotent DDL instead of a migration toolchain: a schema change is applied
  // by deleting data/trailin.db* and letting boot recreate it (dev policy, see
  // CLAUDE.md) — no upgrade shims for existing databases.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'chat',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      cards TEXT,
      tool_calls TEXT,
      error TEXT,
      created_at TEXT NOT NULL
    );
    -- External-content FTS5 index over messages.content: the index itself stores
    -- no text, only a token->rowid mapping, and reads the row back from
    -- 'messages' by rowid on demand. Kept in sync by triggers rather than app
    -- code (contrast mail_fts/library_chunks, which are maintained by hand in
    -- mailStore.ts/store.ts) because messages are written from more than one
    -- place (routes/chat.ts and automations/scheduler.ts, both via
    -- agent/turnRecorder.ts) — a trigger fires no matter which of them writes.
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content,
      content = 'messages',
      content_rowid = 'rowid',
      tokenize = 'unicode61 remove_diacritics 2'
    );
    CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_fts_au AFTER UPDATE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
      INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
    CREATE TABLE IF NOT EXISTS automations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      instruction TEXT NOT NULL,
      schedule TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      show_in_activity INTEGER NOT NULL DEFAULT 1,
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS automation_runs (
      id TEXT PRIMARY KEY,
      automation_id TEXT NOT NULL,
      status TEXT NOT NULL,
      result TEXT NOT NULL DEFAULT '',
      cards TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      source TEXT NOT NULL,
      account_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS library_documents (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      ext TEXT NOT NULL,
      size INTEGER NOT NULL,
      mtime_ms INTEGER NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      text_length INTEGER NOT NULL DEFAULT 0,
      indexed_at TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS library_chunks USING fts5(
      content,
      doc_id UNINDEXED,
      seq UNINDEXED,
      tokenize = 'unicode61 remove_diacritics 2'
    );
    CREATE TABLE IF NOT EXISTS draft_links (
      draft_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mail_threads (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      provider_thread_id TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT '',
      participants TEXT NOT NULL DEFAULT '[]',
      message_count INTEGER NOT NULL DEFAULT 0,
      last_message_at TEXT NOT NULL,
      has_unread INTEGER NOT NULL DEFAULT 0,
      last_from_me INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mail_messages (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      provider_message_id TEXT NOT NULL,
      provider_thread_id TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT '',
      from_addr TEXT NOT NULL DEFAULT '',
      to_addrs TEXT NOT NULL DEFAULT '[]',
      cc_addrs TEXT NOT NULL DEFAULT '[]',
      date TEXT NOT NULL,
      snippet TEXT NOT NULL DEFAULT '',
      body_text TEXT NOT NULL DEFAULT '',
      is_from_me INTEGER NOT NULL DEFAULT 0,
      is_unread INTEGER NOT NULL DEFAULT 0,
      labels TEXT,
      synced_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mail_sync_state (
      account_id TEXT PRIMARY KEY,
      cursor TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      error TEXT,
      last_synced_at TEXT
    );
    CREATE TABLE IF NOT EXISTS mail_thread_state (
      thread_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      gist TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      action_items TEXT NOT NULL DEFAULT '[]',
      triage TEXT NOT NULL DEFAULT 'fyi',
      urgency TEXT NOT NULL DEFAULT 'normal',
      deadline TEXT,
      model TEXT,
      error TEXT,
      enriched_at TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS mail_fts USING fts5(
      subject,
      body_text,
      from_addr,
      message_id UNINDEXED,
      tokenize = 'unicode61 remove_diacritics 2'
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_runs_automation ON automation_runs(automation_id);
    CREATE INDEX IF NOT EXISTS idx_mail_threads_account ON mail_threads(account_id, last_message_at);
    CREATE INDEX IF NOT EXISTS idx_mail_messages_thread ON mail_messages(thread_id, date);
    CREATE INDEX IF NOT EXISTS idx_mail_messages_account ON mail_messages(account_id, date);
  `);

  handle = { sqlite, db: drizzle(sqlite, { schema }) };
  return handle;
}

/**
 * Forwards property access to the lazily opened target so call sites keep
 * plain `db.select()` / `sqlite.prepare()` usage. Only top-level access goes
 * through the proxy; whatever a method returns (query builders, statements)
 * is the real object.
 */
function lazyView<T extends object>(resolveTarget: () => T): T {
  return new Proxy({} as T, {
    get(_stub, prop) {
      const target = resolveTarget();
      const value = Reflect.get(target as object, prop, target);
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
    has(_stub, prop) {
      return prop in (resolveTarget() as object);
    },
  });
}

export const db: DrizzleDb = lazyView(() => openHandle().db);

// Raw handle for the FTS5 tables and `.backup()` — drizzle can't address virtual tables.
export const sqlite: Database.Database = lazyView(() => openHandle().sqlite);

export { schema };

/**
 * Memoized prepare, safe to declare at module scope: the statement is
 * prepared on first call, against whichever handle is open at that moment,
 * and re-prepared if the database was closed and reopened since.
 */
export function lazyStatement(sql: string): () => Database.Statement {
  let prepared: { stmt: Database.Statement; owner: DbHandle } | null = null;
  return () => {
    const h = openHandle();
    if (!prepared || prepared.owner !== h) prepared = { stmt: h.sqlite.prepare(sql), owner: h };
    return prepared.stmt;
  };
}

/** Close the handle (app shutdown, test teardown). The next access reopens. */
export function closeDb(): void {
  handle?.sqlite.close();
  handle = null;
}
