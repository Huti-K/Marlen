import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// db/index.ts (pulled in transitively by search/sources.ts) runs its DDL as an
// import-time side effect and resolves its path through env.ts's
// DATABASE_PATH read, also at import time — same as test/routes/search.test.ts,
// point DATABASE_PATH at a fresh temp file before anything imports the module
// under test, rather than let it touch the real DB.
const tempDir = mkdtempSync(join(tmpdir(), "trailin-search-sources-"));
const originalDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(tempDir, "test.db");

const { searchChats, searchRuns } = await import("../../src/search/sources.js");
const { db, schema } = await import("../../src/db/index.js");

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
});

describe("searchChats", () => {
  const nowIso = new Date().toISOString();

  beforeAll(() => {
    // messages_fts is external-content over `messages` with AFTER INSERT/
    // UPDATE/DELETE triggers (see db/schemaSteps.ts), so inserting into
    // `messages` via drizzle keeps the FTS index in sync automatically —
    // unlike mail_fts, no hand-written index row is needed here.
    db.insert(schema.conversations)
      .values({ id: "conv-1", title: "Trip planning", type: "chat", createdAt: nowIso })
      .run();
    db.insert(schema.messages)
      .values({
        id: "msg-1",
        conversationId: "conv-1",
        role: "user",
        content: "Let's talk about the zephyr project timeline.",
        createdAt: nowIso,
      })
      .run();

    db.insert(schema.conversations)
      .values({ id: "conv-2", title: "zephyr kickoff notes", type: "chat", createdAt: nowIso })
      .run();
    db.insert(schema.messages)
      .values({
        id: "msg-2",
        conversationId: "conv-2",
        role: "assistant",
        content: "Nothing relevant here.",
        createdAt: nowIso,
      })
      .run();

    // Automation-run conversations are excluded from chat search entirely.
    db.insert(schema.conversations)
      .values({ id: "conv-3", title: "zephyr digest run", type: "automation", createdAt: nowIso })
      .run();
    db.insert(schema.messages)
      .values({
        id: "msg-3",
        conversationId: "conv-3",
        role: "assistant",
        content: "zephyr automation output",
        createdAt: nowIso,
      })
      .run();
  });

  it("matches a conversation via its message content", async () => {
    const results = await searchChats("zephyr", "%zephyr%");
    const ids = results.map((r) => r.id);
    expect(ids).toContain("conv-1");
    expect(ids).not.toContain("conv-3");
    const hit = results.find((r) => r.id === "conv-1");
    expect(hit?.snippet.toLowerCase()).toContain("zephyr");
  });

  it("falls back to a title match when no message matches", async () => {
    const results = await searchChats("zephyr", "%zephyr%");
    expect(results.map((r) => r.id)).toContain("conv-2");
  });

  it("never surfaces automation-run conversations", async () => {
    const results = await searchChats("zephyr", "%zephyr%");
    expect(results.map((r) => r.id)).not.toContain("conv-3");
  });

  it("returns no hits for a query with no word/number characters", async () => {
    const results = await searchChats("***", "%***%");
    expect(results).toEqual([]);
  });
});

describe("searchRuns", () => {
  const nowIso = new Date().toISOString();

  beforeAll(() => {
    db.insert(schema.automations)
      .values({
        id: "auto-1",
        name: "Morning briefing",
        instruction: "summarize inbox",
        schedule: "0 8 * * *",
        createdAt: nowIso,
      })
      .run();
    db.insert(schema.automationRuns)
      .values({
        id: "run-1",
        automationId: "auto-1",
        status: "success",
        result: "Nothing about the search term here.",
        startedAt: nowIso,
      })
      .run();
    db.insert(schema.automationRuns)
      .values({
        id: "run-2",
        automationId: "auto-1",
        status: "success",
        result: "The falcon report is ready.",
        startedAt: nowIso,
      })
      .run();
  });

  it("matches a run by its automation's name", async () => {
    const results = await searchRuns("morning", "%morning%");
    expect(results.map((r) => r.id)).toEqual(expect.arrayContaining(["run-1", "run-2"]));
    expect(results[0]?.title).toContain("Morning briefing");
  });

  it("matches a run by its result text and prefers the result as the snippet source", async () => {
    const results = await searchRuns("falcon", "%falcon%");
    const hit = results.find((r) => r.id === "run-2");
    expect(hit?.snippet.toLowerCase()).toContain("falcon");
  });
});
