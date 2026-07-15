import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConnectedAccount, EmailThread, MailThreadOverview } from "@trailin/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// db/index.ts (pulled in transitively by app.ts) runs its DDL as an
// import-time side effect and resolves its path through env.ts's
// DATABASE_PATH read, also at import time — so, same as
// test/routes/drafts.test.ts, point DATABASE_PATH at a fresh temp file
// before anything imports app.ts, rather than share a worker-wide database
// with other test files.
const tempDir = mkdtempSync(join(tmpdir(), "trailin-threads-route-"));
const originalDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(tempDir, "test.db");

// Connected accounts are consulted only for webmail deep links here; the
// mock keeps those deterministic (and lets one test simulate the lookup
// failing) without touching Pipedream. Everything else on the module stays
// real — buildApp() registers routes that import far more than listAccounts.
const listAccountsMock = vi.fn<() => Promise<ConnectedAccount[]>>();
vi.mock("../../src/pipedream/connect.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/pipedream/connect.js")>();
  return { ...actual, listAccounts: () => listAccountsMock() };
});

const { buildApp } = await import("../../src/app.js");
const { applySyncPage } = await import("../../src/email/sync/mailStore.js");

const gmailAccountId = "acct-threads-gmail";
const otherAccountId = "acct-threads-other";

const connectedAccounts: ConnectedAccount[] = [
  {
    id: gmailAccountId,
    app: "gmail",
    name: "alice@example.com",
    healthy: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: otherAccountId,
    app: "some_unknown_app",
    name: "bob@example.com",
    healthy: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  listAccountsMock.mockResolvedValue(connectedAccounts);

  // Newest-first across accounts: thread-b (05-04) > thread-unread (05-03)
  // > thread-old (05-01) > thread-detail (04-21).
  applySyncPage(gmailAccountId, {
    upserts: [
      {
        providerMessageId: "msg-detail-1",
        providerThreadId: "thread-detail",
        subject: "Detail thread",
        from: "alice@example.com",
        to: ["bob@example.com"],
        cc: [],
        date: "2026-04-20T00:00:00.000Z",
        snippet: "First message snippet",
        bodyText: "First message body.",
        isFromMe: false,
        isUnread: false,
        labels: [],
      },
      {
        providerMessageId: "msg-detail-2",
        providerThreadId: "thread-detail",
        subject: "Detail thread",
        from: "bob@example.com",
        to: ["alice@example.com"],
        cc: ["carol@example.com"],
        date: "2026-04-21T00:00:00.000Z",
        snippet: "Second message snippet",
        bodyText: "Second message body.",
        isFromMe: true,
        isUnread: true,
        labels: [],
      },
      {
        providerMessageId: "msg-old-1",
        providerThreadId: "thread-old",
        subject: "Old read thread",
        from: "dana@example.com",
        to: ["alice@example.com"],
        cc: [],
        date: "2026-05-01T00:00:00.000Z",
        snippet: "Old snippet",
        bodyText: "Old body.",
        isFromMe: false,
        isUnread: false,
        labels: [],
      },
      {
        providerMessageId: "msg-unread-1",
        providerThreadId: "thread-unread",
        subject: "Unread thread",
        from: "erin@example.com",
        to: ["alice@example.com"],
        cc: [],
        date: "2026-05-03T00:00:00.000Z",
        snippet: "Unread snippet",
        bodyText: "Unread body.",
        isFromMe: false,
        isUnread: true,
        labels: [],
      },
    ],
    deletes: [],
    cursor: "seed",
    hasMore: false,
  });
  applySyncPage(otherAccountId, {
    upserts: [
      {
        providerMessageId: "msg-b-1",
        providerThreadId: "thread-b",
        subject: "Other account thread",
        from: "bob@example.com",
        to: ["frank@example.com"],
        cc: [],
        date: "2026-05-04T00:00:00.000Z",
        snippet: "B snippet",
        bodyText: "B body.",
        isFromMe: true,
        isUnread: false,
        labels: [],
      },
    ],
    deletes: [],
    cursor: "seed",
    hasMore: false,
  });
});

afterAll(async () => {
  await app.close();
  rmSync(tempDir, { recursive: true, force: true });
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
});

async function listThreads(query = ""): Promise<{ status: number; items: MailThreadOverview[] }> {
  const res = await app.inject({ method: "GET", url: `/api/threads${query}` });
  return {
    status: res.statusCode,
    items: res.statusCode === 200 ? (res.json() as { items: MailThreadOverview[] }).items : [],
  };
}

describe("GET /api/threads — inbox overviews from the mailbox mirror", () => {
  it("returns every account's threads newest-first with mirror fields mapped", async () => {
    const { status, items } = await listThreads();
    expect(status).toBe(200);
    expect(items.map((t) => t.threadId)).toEqual([
      "thread-b",
      "thread-unread",
      "thread-old",
      "thread-detail",
    ]);

    const unread = items[1] as MailThreadOverview;
    expect(unread).toMatchObject({
      accountId: gmailAccountId,
      threadId: "thread-unread",
      subject: "Unread thread",
      messageCount: 1,
      lastMessageAt: "2026-05-03T00:00:00.000Z",
      hasUnread: true,
      lastFromMe: false,
      gist: null,
      triage: null,
      urgency: null,
      deadline: null,
    });
    expect(unread.participants).toContain("erin@example.com");
  });

  it("builds webmail deep links per account app, empty for apps with no web UI", async () => {
    const { items } = await listThreads();
    const gmailThread = items.find((t) => t.threadId === "thread-unread");
    expect(gmailThread?.webUrl).toBe(
      "https://mail.google.com/mail/?authuser=alice%40example.com#all/thread-unread",
    );
    const otherThread = items.find((t) => t.threadId === "thread-b");
    expect(otherThread?.webUrl).toBe("");
  });

  it("filter=unread narrows to threads with unread mail", async () => {
    const { items } = await listThreads("?filter=unread");
    expect(items.map((t) => t.threadId)).toEqual(["thread-unread", "thread-detail"]);
  });

  it("accountId scopes to one account", async () => {
    const { items } = await listThreads(`?accountId=${otherAccountId}`);
    expect(items.map((t) => t.threadId)).toEqual(["thread-b"]);
  });

  it("honors limit", async () => {
    const { items } = await listThreads("?limit=2");
    expect(items.map((t) => t.threadId)).toEqual(["thread-b", "thread-unread"]);
  });

  it("rejects an out-of-range limit and an unknown filter", async () => {
    expect((await listThreads("?limit=101")).status).toBe(400);
    expect((await listThreads("?filter=starred")).status).toBe(400);
  });

  it("still answers with empty webUrls when the account lookup fails", async () => {
    listAccountsMock.mockRejectedValueOnce(new Error("pipedream down"));
    const { status, items } = await listThreads();
    expect(status).toBe(200);
    expect(items).toHaveLength(4);
    expect(items.every((t) => t.webUrl === "")).toBe(true);
  });
});

describe("GET /api/threads/:accountId/:threadId — served from the mailbox mirror", () => {
  it("404s for a thread id the mirror has never seen", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/threads/${gmailAccountId}/no-such-thread`,
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: string; requestId: string };
    expect(typeof body.error).toBe("string");
    expect(typeof body.requestId).toBe("string");
  });

  it("404s when the thread exists but under a different account", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/threads/some-other-account/thread-detail`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("maps every message oldest-first with provider id and flags, cc omitted when empty", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/threads/${gmailAccountId}/thread-detail`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as EmailThread;
    expect(body.subject).toBe("Detail thread");
    expect(body.webUrl).toBe(
      "https://mail.google.com/mail/?authuser=alice%40example.com#all/thread-detail",
    );
    expect(body.messages).toHaveLength(2);

    const [first, second] = body.messages;
    expect(first).toEqual({
      id: "msg-detail-1",
      from: "alice@example.com",
      to: ["bob@example.com"],
      date: "2026-04-20T00:00:00.000Z",
      body: "First message body.",
      subject: "Detail thread",
      isUnread: false,
      isFromMe: false,
    });
    expect(first && "cc" in first).toBe(false);

    expect(second).toEqual({
      id: "msg-detail-2",
      from: "bob@example.com",
      to: ["alice@example.com"],
      cc: ["carol@example.com"],
      date: "2026-04-21T00:00:00.000Z",
      body: "Second message body.",
      subject: "Detail thread",
      isUnread: true,
      isFromMe: true,
    });
  });

  it("excludeMessageId drops just that one message by provider message id", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/threads/${gmailAccountId}/thread-detail?excludeMessageId=msg-detail-1`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as EmailThread;
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toMatchObject({ from: "bob@example.com" });
  });

  it("leaves the thread untouched when excludeMessageId matches nothing", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/threads/${gmailAccountId}/thread-detail?excludeMessageId=not-a-real-message-id`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as EmailThread;
    expect(body.messages).toHaveLength(2);
  });
});
