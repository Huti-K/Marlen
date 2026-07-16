import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConnectedAccount } from "@trailin/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// db/index.ts (pulled in transitively by app.ts) runs its DDL as an
// import-time side effect and resolves its path through env.ts's
// DATABASE_PATH read, also at import time — same as test/routes/drafts.test.ts:
// point DATABASE_PATH at a fresh temp file before anything imports app.ts.
const tempDir = mkdtempSync(join(tmpdir(), "trailin-mail-route-"));
const originalDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(tempDir, "test.db");

// The thread route resolves the account through listAccounts and the gmail
// read provider fetches through proxyRequest — mock both, keep the rest of
// the module real (buildApp() registers routes that import far more).
const listAccountsMock = vi.fn<() => Promise<ConnectedAccount[]>>();
const proxyRequestMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock("../../src/pipedream/connect.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/pipedream/connect.js")>();
  return {
    ...actual,
    listAccounts: () => listAccountsMock(),
    proxyRequest: (...args: unknown[]) => proxyRequestMock(...args),
  };
});

const { buildApp } = await import("../../src/app.js");

function account(id: string, app: string): ConnectedAccount {
  return { id, app, name: `${id}@example.com`, healthy: true, createdAt: "2026-01-01T00:00:00Z" };
}

function b64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

function gmailThreadMessage(
  id: string,
  opts: { date: string; labelIds?: string[] } = { date: "2026-07-02T10:00:00Z" },
) {
  return {
    id,
    internalDate: String(Date.parse(opts.date)),
    ...(opts.labelIds ? { labelIds: opts.labelIds } : {}),
    payload: {
      mimeType: "text/plain",
      body: { data: b64(`body of ${id}`) },
      headers: [
        { name: "Subject", value: `subject ${id}` },
        { name: "From", value: "Ada <ada@example.com>" },
        { name: "To", value: "me@example.com" },
      ],
    },
  };
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  // app.close() runs closeDb() (see app.ts's onClose hook), so the sqlite
  // handle underneath is already released by the time this returns.
  await app.close();
  rmSync(tempDir, { recursive: true, force: true });
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
});

beforeEach(() => {
  listAccountsMock.mockReset();
  proxyRequestMock.mockReset();
});

describe("GET /api/mail/threads — live conversation read", () => {
  const url = "/api/mail/threads?accountId=acct-mail&threadId=t-1";

  it("returns the thread's non-draft messages, oldest first", async () => {
    listAccountsMock.mockResolvedValue([account("acct-mail", "gmail")]);
    proxyRequestMock.mockResolvedValueOnce({
      messages: [
        gmailThreadMessage("m1", { date: "2026-07-02T10:00:00Z" }),
        gmailThreadMessage("m2", { date: "2026-07-03T10:00:00Z" }),
        gmailThreadMessage("d1", { date: "2026-07-04T10:00:00Z", labelIds: ["DRAFT"] }),
      ],
    });

    const res = await app.inject({ method: "GET", url });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { subject: string; messages: { id: string }[] };
    expect(body.subject).toBe("subject m1");
    expect(body.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("404s for an unknown account", async () => {
    listAccountsMock.mockResolvedValue([]);
    const res = await app.inject({ method: "GET", url });
    expect(res.statusCode).toBe(404);
  });

  it("400s for an account whose app has no thread read support", async () => {
    listAccountsMock.mockResolvedValue([account("acct-mail", "slack_bot")]);
    const res = await app.inject({ method: "GET", url });
    expect(res.statusCode).toBe(400);
  });

  it("404s when the thread is gone upstream or holds only the draft itself", async () => {
    listAccountsMock.mockResolvedValue([account("acct-mail", "gmail")]);

    proxyRequestMock.mockRejectedValueOnce(
      Object.assign(new Error("not found"), { statusCode: 404 }),
    );
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(404);

    proxyRequestMock.mockResolvedValueOnce({
      messages: [gmailThreadMessage("d1", { date: "2026-07-02T10:00:00Z", labelIds: ["DRAFT"] })],
    });
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(404);
  });
});
