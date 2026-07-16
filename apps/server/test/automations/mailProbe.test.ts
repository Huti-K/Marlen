import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConnectedAccount } from "@trailin/shared";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MailReadProvider } from "../../src/email/read/readProviders.js";

// db/index.ts runs its DDL and reads DATABASE_PATH at import time (same pattern
// as scheduler.test.ts) — point it at a fresh temp file before anything pulls
// db/index.ts in. Provider/account lookups and the run entry point all come
// through probeOnce's deps seam, so nothing here reaches Pipedream or an agent.
const tempDir = mkdtempSync(join(tmpdir(), "trailin-mail-probe-"));
const originalDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(tempDir, "test.db");

const { db, schema, closeDb } = await import("../../src/db/index.js");
const { probeOnce } = await import("../../src/automations/mailProbe.js");
const { deleteSetting, getSetting } = await import("../../src/db/settings.js");

const CURSORS_KEY = "mailProbe.cursors";

afterAll(() => {
  closeDb();
  rmSync(tempDir, { recursive: true, force: true });
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
});

beforeEach(async () => {
  await db.delete(schema.automations);
  await deleteSetting(CURSORS_KEY);
});

function account(id: string, app = "gmail"): ConnectedAccount {
  return {
    id,
    app,
    appName: "Gmail",
    name: `${id}@example.com`,
    healthy: true,
    createdAt: "2026-01-01",
  };
}

/** A read provider whose only reachable method is the given newestInbound. */
function reader(newestInbound: MailReadProvider["newestInbound"]): MailReadProvider {
  return {
    newestInbound,
    listSentSince: async () => {
      throw new Error("not used by the mail probe");
    },
    getMessageBody: async () => {
      throw new Error("not used by the mail probe");
    },
  };
}

async function insertAutomation(
  overrides: Partial<{ enabled: boolean; runOnNewMail: boolean }> = {},
): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.automations).values({
    id,
    name: "Mail reactor",
    instruction: "React to new mail",
    schedule: "0 8 * * *",
    enabled: overrides.enabled ?? true,
    showInActivity: true,
    pinned: false,
    runOnNewMail: overrides.runOnNewMail ?? true,
    createdAt: new Date().toISOString(),
  });
  return id;
}

async function storedCursors(): Promise<Record<string, { id: string; date: string }>> {
  const raw = await getSetting(CURSORS_KEY);
  return raw ? (JSON.parse(raw) as Record<string, { id: string; date: string }>) : {};
}

describe("probeOnce", () => {
  it("returns before touching any account when no enabled automation is flagged", async () => {
    await insertAutomation({ runOnNewMail: false });
    await insertAutomation({ runOnNewMail: true, enabled: false });
    const listAccounts = vi.fn(async () => [account("acct-1")]);
    const requestRun = vi.fn(async (_automationId: string) => {});

    await probeOnce({ listAccounts, requestRun, readerFor: () => reader(vi.fn()) });

    expect(listAccounts).not.toHaveBeenCalled();
    expect(requestRun).not.toHaveBeenCalled();
  });

  it("seeds the cursor on first sight of an account without triggering", async () => {
    await insertAutomation();
    const newestInbound = vi.fn(async () => ({ id: "m1", date: "2026-07-16T09:00:00.000Z" }));
    const requestRun = vi.fn(async (_automationId: string) => {});

    await probeOnce({
      listAccounts: async () => [account("acct-1")],
      readerFor: () => reader(newestInbound),
      requestRun,
    });

    expect(requestRun).not.toHaveBeenCalled();
    expect(await storedCursors()).toEqual({
      "acct-1": { id: "m1", date: "2026-07-16T09:00:00.000Z" },
    });
  });

  it("triggers each flagged, enabled automation exactly once on a new id with a newer date", async () => {
    const flaggedA = await insertAutomation();
    const flaggedB = await insertAutomation();
    await insertAutomation({ runOnNewMail: false }); // unflagged — never triggered
    await insertAutomation({ enabled: false }); // paused — never triggered
    const requestRun = vi.fn(async (_automationId: string) => {});
    const newestInbound = vi
      .fn<MailReadProvider["newestInbound"]>()
      .mockResolvedValueOnce({ id: "m1", date: "2026-07-16T09:00:00.000Z" })
      .mockResolvedValueOnce({ id: "m2", date: "2026-07-16T09:05:00.000Z" });
    const deps = {
      listAccounts: async () => [account("acct-1")],
      readerFor: () => reader(newestInbound),
      requestRun,
    };

    await probeOnce(deps); // seeds the cursor
    await probeOnce(deps); // sees the new message

    expect(requestRun).toHaveBeenCalledTimes(2);
    expect(new Set(requestRun.mock.calls.map(([id]) => id))).toEqual(new Set([flaggedA, flaggedB]));
    expect(await storedCursors()).toEqual({
      "acct-1": { id: "m2", date: "2026-07-16T09:05:00.000Z" },
    });
  });

  it("advances the cursor without triggering when the id changed but the date is older or equal", async () => {
    await insertAutomation();
    const requestRun = vi.fn(async (_automationId: string) => {});
    const newestInbound = vi
      .fn<MailReadProvider["newestInbound"]>()
      .mockResolvedValueOnce({ id: "m2", date: "2026-07-16T09:05:00.000Z" })
      // The newest message was archived or deleted: a different id, older date.
      .mockResolvedValueOnce({ id: "m1", date: "2026-07-16T09:00:00.000Z" })
      // And again with an equal date — still not new mail.
      .mockResolvedValueOnce({ id: "m0", date: "2026-07-16T09:00:00.000Z" });
    const deps = {
      listAccounts: async () => [account("acct-1")],
      readerFor: () => reader(newestInbound),
      requestRun,
    };

    await probeOnce(deps); // seeds at m2
    await probeOnce(deps); // m1, older
    expect(await storedCursors()).toEqual({
      "acct-1": { id: "m1", date: "2026-07-16T09:00:00.000Z" },
    });

    await probeOnce(deps); // m0, equal
    expect(requestRun).not.toHaveBeenCalled();
    expect(await storedCursors()).toEqual({
      "acct-1": { id: "m0", date: "2026-07-16T09:00:00.000Z" },
    });
  });

  it("skips accounts whose app has no read provider", async () => {
    await insertAutomation();
    const requestRun = vi.fn(async (_automationId: string) => {});

    await probeOnce({
      listAccounts: async () => [account("acct-1", "unknown_app")],
      readerFor: () => null,
      requestRun,
    });

    expect(requestRun).not.toHaveBeenCalled();
    expect(await storedCursors()).toEqual({});
  });

  it("keeps a failing account's cursor and still probes the others", async () => {
    const flagged = await insertAutomation();
    const requestRun = vi.fn(async (_automationId: string) => {});
    let failA = false;
    const newestInbound = vi.fn(async (acct: ConnectedAccount) => {
      if (acct.id === "acct-a") {
        if (failA) throw new Error("proxy exploded");
        return { id: "a1", date: "2026-07-16T09:00:00.000Z" };
      }
      return failA
        ? { id: "b2", date: "2026-07-16T09:10:00.000Z" }
        : { id: "b1", date: "2026-07-16T09:01:00.000Z" };
    });
    const deps = {
      listAccounts: async () => [account("acct-a"), account("acct-b")],
      readerFor: () => reader(newestInbound),
      requestRun,
    };

    await probeOnce(deps); // seeds both cursors
    failA = true;
    await probeOnce(deps); // acct-a fails, acct-b has new mail

    expect(requestRun).toHaveBeenCalledTimes(1);
    expect(requestRun).toHaveBeenCalledWith(flagged);
    expect(await storedCursors()).toEqual({
      "acct-a": { id: "a1", date: "2026-07-16T09:00:00.000Z" },
      "acct-b": { id: "b2", date: "2026-07-16T09:10:00.000Z" },
    });
  });
});
