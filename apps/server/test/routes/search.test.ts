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

const { db, schema, sqlite } = await import("../../src/db/index.js");
const { buildApp } = await import("../../src/app.js");

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  // app.close() runs closeDb() (see app.ts's onClose hook), so the sqlite
  // handle above is already released by the time this returns.
  await app.close();
  rmSync(tempDir, { recursive: true, force: true });
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
});

describe("GET /api/search — mail section", () => {
  const accountId = "acct-test-1";
  const providerThreadId = "thread-zephyr";
  const providerMessageId = "msg-zephyr";
  const messageId = `${accountId}:${providerMessageId}`;
  const threadId = `${accountId}:${providerThreadId}`;

  beforeAll(() => {
    const nowIso = new Date().toISOString();

    // mail_threads/mail_messages via drizzle (schema-typed inserts); mail_fts
    // is a plain FTS5 virtual table with no triggers (see schemaSteps.ts), so
    // it's populated the same way the sync engine does it (mailStore.ts's
    // ftsInsert): one hand-written row per message, keyed by mail_messages.id.
    db.insert(schema.mailThreads)
      .values({
        id: threadId,
        accountId,
        providerThreadId,
        subject: "Zephyr project kickoff",
        participants: JSON.stringify(["alice@example.com"]),
        messageCount: 1,
        lastMessageAt: nowIso,
        hasUnread: false,
        lastFromMe: false,
        updatedAt: nowIso,
      })
      .run();

    db.insert(schema.mailMessages)
      .values({
        id: messageId,
        accountId,
        threadId,
        providerMessageId,
        providerThreadId,
        subject: "Zephyr project kickoff",
        fromAddr: "Alice <alice@example.com>",
        toAddrs: JSON.stringify(["bob@example.com"]),
        ccAddrs: "[]",
        date: nowIso,
        snippet: "Let's schedule the zephyr kickoff for Monday morning.",
        bodyText: "Let's schedule the zephyr project kickoff meeting for Monday morning.",
        isFromMe: false,
        isUnread: false,
        labels: null,
        syncedAt: nowIso,
      })
      .run();

    sqlite
      .prepare(
        "INSERT INTO mail_fts (subject, body_text, from_addr, message_id) VALUES (?, ?, ?, ?)",
      )
      .run(
        "Zephyr project kickoff",
        "Let's schedule the zephyr project kickoff meeting for Monday morning.",
        "Alice <alice@example.com>",
        messageId,
      );
  });

  it("returns the seeded hit for a matching query", async () => {
    const res = await app.inject({ method: "GET", url: "/api/search?q=zephyr" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { results: Array<Record<string, unknown>> };
    const mailHits = body.results.filter((r) => r.type === "mail");
    expect(mailHits).toHaveLength(1);
    const [hit] = mailHits as [Record<string, unknown>];
    expect(hit).toMatchObject({
      type: "mail",
      id: providerMessageId,
      title: "Zephyr project kickoff",
      accountId,
    });
    expect(typeof hit.snippet).toBe("string");
    expect((hit.snippet as string).length).toBeGreaterThan(0);
  });

  it("stays empty for a non-matching query", async () => {
    const res = await app.inject({ method: "GET", url: "/api/search?q=nonexistent-term-xyz" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { results: Array<Record<string, unknown>> };
    expect(body.results.filter((r) => r.type === "mail")).toHaveLength(0);
  });
});

describe("GET /api/mail/suggest — composer @-mention autocomplete", () => {
  const accountId = "acct-suggest-1";

  beforeAll(() => {
    const nowIso = new Date().toISOString();

    function seedThread(opts: {
      providerThreadId: string;
      providerMessageId: string;
      subject: string;
      participant: string;
      bodyText: string;
      lastMessageAt: string;
    }) {
      const threadKey = `${accountId}:${opts.providerThreadId}`;
      const messageKey = `${accountId}:${opts.providerMessageId}`;
      db.insert(schema.mailThreads)
        .values({
          id: threadKey,
          accountId,
          providerThreadId: opts.providerThreadId,
          subject: opts.subject,
          participants: JSON.stringify([opts.participant]),
          messageCount: 1,
          lastMessageAt: opts.lastMessageAt,
          hasUnread: false,
          lastFromMe: false,
          updatedAt: nowIso,
        })
        .run();
      db.insert(schema.mailMessages)
        .values({
          id: messageKey,
          accountId,
          threadId: threadKey,
          providerMessageId: opts.providerMessageId,
          providerThreadId: opts.providerThreadId,
          subject: opts.subject,
          fromAddr: opts.participant,
          toAddrs: "[]",
          ccAddrs: "[]",
          date: opts.lastMessageAt,
          snippet: opts.bodyText.slice(0, 40),
          bodyText: opts.bodyText,
          isFromMe: false,
          isUnread: false,
          labels: null,
          syncedAt: nowIso,
        })
        .run();
      sqlite
        .prepare(
          "INSERT INTO mail_fts (subject, body_text, from_addr, message_id) VALUES (?, ?, ?, ?)",
        )
        .run(opts.subject, opts.bodyText, opts.participant, messageKey);
    }

    seedThread({
      providerThreadId: "thread-suggest-old",
      providerMessageId: "msg-suggest-old",
      subject: "Older suggestion thread",
      participant: "dana@example.com",
      bodyText: "Nothing special in this older thread.",
      lastMessageAt: "2026-06-01T00:00:00.000Z",
    });
    seedThread({
      providerThreadId: "thread-suggest-new",
      providerMessageId: "msg-suggest-new",
      subject: "Newest suggestion thread",
      participant: "erin@example.com",
      bodyText: "The quokka project kickoff is set for Monday.",
      lastMessageAt: "2026-06-02T00:00:00.000Z",
    });
  });

  it("with no q, returns recent thread overviews newest first with no messageId/snippet", async () => {
    // "recent" mode spans every synced account/thread (not just this describe
    // block's fixtures — GET /api/search's own suite seeds another one with a
    // real current timestamp), so scope the assertion to this suite's own
    // threads by their distinctive id prefix rather than assuming position 0/1.
    const res = await app.inject({ method: "GET", url: `/api/mail/suggest?limit=50` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<Record<string, unknown>> };
    const ours = body.items.filter((i) => (i.threadId as string).startsWith("thread-suggest-"));
    expect(ours).toHaveLength(2);
    const [first, second] = ours;
    expect(first).toMatchObject({
      threadId: "thread-suggest-new",
      accountId,
      subject: "Newest suggestion thread",
      from: "erin@example.com",
      date: "2026-06-02T00:00:00.000Z",
    });
    expect(first?.messageId).toBeUndefined();
    expect(first?.snippet).toBeUndefined();
    expect(second).toMatchObject({ threadId: "thread-suggest-old" });
  });

  it("with a keyword q, returns deduped thread-level hits with accountId/threadId/messageId", async () => {
    const res = await app.inject({ method: "GET", url: "/api/mail/suggest?q=quokka" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<Record<string, unknown>> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      threadId: "thread-suggest-new",
      accountId,
      messageId: "msg-suggest-new",
      subject: "Newest suggestion thread",
      from: "erin@example.com",
    });
    expect(typeof body.items[0]?.snippet).toBe("string");
  });

  it("clamps limit into [1, 20] and respects it", async () => {
    const res = await app.inject({ method: "GET", url: "/api/mail/suggest?limit=1" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<Record<string, unknown>> };
    expect(body.items).toHaveLength(1);

    const tooBig = await app.inject({ method: "GET", url: "/api/mail/suggest?limit=999" });
    const tooBigBody = tooBig.json() as { items: Array<Record<string, unknown>> };
    expect(tooBigBody.items.length).toBeLessThanOrEqual(20);
  });
});
