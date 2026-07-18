import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import { env } from "../env.js";
import * as schema from "./schema.js";
import { SCHEMA_STEPS } from "./schemaSteps.js";

/**
 * Lazy singleton: importing this module never touches the filesystem — the
 * database file is created, opened, and DDL-initialized on first use. That
 * keeps `buildApp()` importable by tests, which point DATABASE_PATH at a
 * scratch file (test/setup.ts) before any query runs. Statement modules that
 * want module-scope prepared statements or transactions use `lazyStatement` /
 * `lazyTransaction` below for the same reason.
 */

type DrizzleDb = BetterSQLite3Database<typeof schema>;

interface DbHandle {
  sqlite: Database.Database;
  db: DrizzleDb;
}

let handle: DbHandle | null = null;

/**
 * Bring the file up to the current schema: run every step past the file's
 * `user_version`, each in its own transaction so a failed step leaves the
 * version pointing at the last completed one. A file from a newer build is
 * refused outright — there are no downgrades (dev policy, see schemaSteps.ts).
 */
function applySchema(sqlite: Database.Database): void {
  const version = sqlite.pragma("user_version", { simple: true }) as number;
  if (version > SCHEMA_STEPS.length) {
    throw new Error(
      `database is at schema version ${version}, this build knows ${SCHEMA_STEPS.length} — ` +
        `delete ${env.databasePath}* and restart to recreate it`,
    );
  }
  for (const [index, step] of SCHEMA_STEPS.entries()) {
    if (index < version) continue;
    sqlite.transaction(() => {
      sqlite.exec(step);
      sqlite.pragma(`user_version = ${index + 1}`);
    })();
  }
}

function openHandle(): DbHandle {
  if (handle) return handle;

  const dbPath = resolve(process.cwd(), env.databasePath);
  mkdirSync(dirname(dbPath), { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  // Wait up to 5s for a competing writer instead of throwing SQLITE_BUSY: under
  // WAL two server processes (a `pnpm start` alongside `pnpm dev`) can hold the
  // DB at once, and a locked moment shouldn't fail a request.
  sqlite.pragma("busy_timeout = 5000");

  applySchema(sqlite);

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

/**
 * Memoized `sqlite.transaction(fn)`, safe to declare at module scope: the
 * transaction wrapper is built on first call, against whichever handle is
 * open at that moment, and rebuilt if the database was closed and reopened
 * since — the same owner check lazyStatement uses.
 */
export function lazyTransaction<Args extends unknown[], Result>(
  fn: (...args: Args) => Result,
): (...args: Args) => Result {
  let built: { run: Database.Transaction<(...args: Args) => Result>; owner: DbHandle } | null =
    null;
  return (...args) => {
    const h = openHandle();
    if (!built || built.owner !== h) built = { run: h.sqlite.transaction(fn), owner: h };
    return built.run(...args);
  };
}

let generation = 0;

/**
 * Increments every time the handle is closed. Module-scope caches over table
 * contents (e.g. db/settings.ts) store the generation they loaded under and
 * reload when it moved, mirroring lazyStatement's owner check.
 */
export function dbGeneration(): number {
  return generation;
}

/** Close the handle (app shutdown, test teardown). The next access reopens. */
export function closeDb(): void {
  handle?.sqlite.close();
  handle = null;
  generation++;
}
