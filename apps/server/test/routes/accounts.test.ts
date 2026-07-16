import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConnectedAccount } from "@trailin/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// db/index.ts (pulled in transitively by app.ts) runs its DDL as an
// import-time side effect and resolves its path through env.ts's
// DATABASE_PATH read, also at import time — same as test/routes/drafts.test.ts:
// point DATABASE_PATH at a fresh temp file before anything imports app.ts.
const tempDir = mkdtempSync(join(tmpdir(), "trailin-accounts-route-"));
const originalDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(tempDir, "test.db");

// /api/status resolves its account list through pipedreamConfigured +
// listAccounts; the mock keeps both local. Everything else on the module
// stays real — buildApp() registers routes that import far more than these.
const listAccountsMock = vi.fn<() => Promise<ConnectedAccount[]>>();
vi.mock("../../src/pipedream/connect.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/pipedream/connect.js")>();
  return {
    ...actual,
    pipedreamConfigured: async () => true,
    listAccounts: () => listAccountsMock(),
  };
});

const { buildApp } = await import("../../src/app.js");

function account(id: string, app: string): ConnectedAccount {
  return { id, app, name: `${id}@example.com`, healthy: true, createdAt: "2026-01-01T00:00:00Z" };
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

async function getStatus(): Promise<Record<string, unknown>> {
  const res = await app.inject({ method: "GET", url: "/api/status" });
  expect(res.statusCode).toBe(200);
  return res.json() as Record<string, unknown>;
}

describe("GET /api/status — email account counting", () => {
  it("counts only mail accounts toward the setup gate", async () => {
    listAccountsMock.mockResolvedValue([
      account("acct-status-a", "gmail"),
      account("acct-status-b", "gmail"),
      account("acct-status-slack", "slack_bot"),
    ]);

    const body = await getStatus();
    expect(body.emailAccounts).toBe(2);
    expect(body.emailAccountsKnown).toBe(true);
    // No onOffice credentials in tests (setup.ts neutralizes the env pair),
    // so the lead surface reports as absent.
    expect(body.onofficeConfigured).toBe(false);
  });

  it("reports the count as unknown when listing accounts fails", async () => {
    listAccountsMock.mockRejectedValueOnce(new Error("pipedream down"));
    const body = await getStatus();
    expect(body.emailAccounts).toBe(0);
    expect(body.emailAccountsKnown).toBe(false);
  });
});
