import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConnectedAccount, CreatedDraft } from "@trailin/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CreateDraftInput } from "../../src/email/providers.js";

// db/index.ts (pulled in transitively by app.ts) runs its DDL as an
// import-time side effect and resolves its path through env.ts's
// DATABASE_PATH read, also at import time — so, same as
// test/routes/search.test.ts, point DATABASE_PATH at a fresh temp file
// before anything imports app.ts, rather than share a worker-wide database
// with other test files.
const tempDir = mkdtempSync(join(tmpdir(), "trailin-drafts-route-"));
const originalDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(tempDir, "test.db");

// The compose tests resolve their account through findDraftAccount →
// listAccounts; the mock keeps that local. Everything else on the module
// stays real — buildApp() registers routes that import far more than
// listAccounts.
const listAccountsMock = vi.fn<() => Promise<ConnectedAccount[]>>();
vi.mock("../../src/pipedream/connect.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/pipedream/connect.js")>();
  return { ...actual, listAccounts: () => listAccountsMock() };
});

const { buildApp } = await import("../../src/app.js");
const { createDraftSnapshot, markDraftStatus } = await import("../../src/db/draftStore.js");
const { registerDraftProvider } = await import("../../src/email/providers.js");

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

describe("POST /api/drafts/:accountId — user-authored compose", () => {
  const accountId = "acct-compose-route";
  const createDraftMock =
    vi.fn<(account: ConnectedAccount, input: CreateDraftInput) => Promise<CreatedDraft>>();

  beforeAll(() => {
    registerDraftProvider("test_mail", {
      listDrafts: async () => [],
      getDraftDetail: async () => ({ body: "", cc: "", bcc: "" }),
      createDraft: createDraftMock,
      deleteDraft: async () => {},
    });
    listAccountsMock.mockResolvedValue([
      {
        id: accountId,
        app: "test_mail",
        name: "compose@example.com",
        healthy: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "acct-no-driver",
        app: "some_app_without_provider",
        name: "other@example.com",
        healthy: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("passes the compose fields to the provider verbatim and returns its handles", async () => {
    const handles: CreatedDraft = {
      draftId: "d-compose-1",
      messageId: "m-compose-1",
      threadId: "t-compose-1",
      webUrl: "https://mail.example.com/d-compose-1",
    };
    createDraftMock.mockResolvedValueOnce(handles);

    const res = await app.inject({
      method: "POST",
      url: `/api/drafts/${accountId}`,
      payload: {
        to: ["anna@example.com"],
        cc: ["max@example.com"],
        subject: "Hello",
        body: "Hi Anna,\n\nBest\nMe",
        threadId: "t-compose-1",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(handles);
    expect(createDraftMock).toHaveBeenCalledWith(expect.objectContaining({ id: accountId }), {
      to: ["anna@example.com"],
      cc: ["max@example.com"],
      subject: "Hello",
      body: "Hi Anna,\n\nBest\nMe",
      threadId: "t-compose-1",
    });
  });

  it("404s for an unknown account and for one whose app has no draft provider", async () => {
    const payload = { to: ["anna@example.com"], subject: "S", body: "B" };
    const unknown = await app.inject({
      method: "POST",
      url: "/api/drafts/acct-does-not-exist",
      payload,
    });
    expect(unknown.statusCode).toBe(404);

    const noDriver = await app.inject({
      method: "POST",
      url: "/api/drafts/acct-no-driver",
      payload,
    });
    expect(noDriver.statusCode).toBe(404);
  });

  it("400s when `to` is empty", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/drafts/${accountId}`,
      payload: { to: [], subject: "S", body: "B" },
    });
    expect(res.statusCode).toBe(400);
    expect(createDraftMock).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/drafts/:accountId/:draftId/status — served from the snapshot store", () => {
  const accountId = "acct-status-route";

  it("404s for a draft with no snapshot (not agent-written)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/drafts/${accountId}/untracked-draft/status`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("reports the recorded fate, including the sent message id", async () => {
    await createDraftSnapshot({
      accountId,
      providerDraftId: "draft-status-1",
      subject: "Status route",
      to: ["anna@example.com"],
      signature: null,
      body: "Body.",
    });

    const open = await app.inject({
      method: "GET",
      url: `/api/drafts/${accountId}/draft-status-1/status`,
    });
    expect(open.statusCode).toBe(200);
    expect(open.json()).toEqual({ status: "open" });

    await markDraftStatus(accountId, "draft-status-1", "sent", "sent-msg-9");
    const sent = await app.inject({
      method: "GET",
      url: `/api/drafts/${accountId}/draft-status-1/status`,
    });
    expect(sent.statusCode).toBe(200);
    expect(sent.json()).toEqual({ status: "sent", sentMessageId: "sent-msg-9" });
  });

  it("scopes the lookup to the account", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/drafts/some-other-account/draft-status-1/status",
    });
    expect(res.statusCode).toBe(404);
  });
});
