import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// db/index.ts (pulled in transitively by routes/search.ts) runs its DDL as an
// import-time side effect and resolves its path through env.ts's
// DATABASE_PATH read, also at import time — so, same as
// test/agent/turnRecorder.test.ts, point DATABASE_PATH at a fresh temp file
// before anything imports search.ts, rather than let it touch the real DB.
const tempDir = mkdtempSync(join(tmpdir(), "trailin-search-"));
const originalDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(tempDir, "test.db");

const { buildApp } = await import("../../src/app.js");
const { ensureConversation } = await import("../../src/db/conversationStore.js");
const { db, schema } = await import("../../src/db/index.js");

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();

  await ensureConversation("conv-search-1", { type: "chat", title: "Zephyr planning" });
  await db.insert(schema.messages).values({
    id: "msg-search-1",
    conversationId: "conv-search-1",
    role: "user",
    content: "When is the zephyr project kickoff?",
    cards: null,
    toolCalls: null,
    error: null,
    refs: null,
    createdAt: new Date().toISOString(),
  });
});

afterAll(async () => {
  // app.close() runs closeDb() (see app.ts's onClose hook), so the sqlite
  // handle above is already released by the time this returns.
  await app.close();
  rmSync(tempDir, { recursive: true, force: true });
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
});

describe("GET /api/search", () => {
  it("returns a chat hit for a matching query", async () => {
    const res = await app.inject({ method: "GET", url: "/api/search?q=zephyr" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { results: Array<Record<string, unknown>> };
    const chatHits = body.results.filter((r) => r.type === "chat");
    expect(chatHits).toHaveLength(1);
    expect(chatHits[0]).toMatchObject({ id: "conv-search-1", title: "Zephyr planning" });
  });

  it("returns nothing for a blank query", async () => {
    const res = await app.inject({ method: "GET", url: "/api/search?q=" });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { results: unknown[] }).results).toHaveLength(0);
  });

  it("stays empty for a non-matching query", async () => {
    const res = await app.inject({ method: "GET", url: "/api/search?q=nonexistent-term-xyz" });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { results: unknown[] }).results).toHaveLength(0);
  });
});
