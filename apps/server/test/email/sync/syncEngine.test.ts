import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConnectedAccount } from "@trailin/shared";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// db/index.ts and env.ts both resolve process.env at import time — same
// isolation dance as test/email/sync/mailQuery.test.ts and
// test/agent/turnRecorder.test.ts: set overrides before anything pulls
// those modules in, then import everything dynamically. SYNC_INTERVAL_MS is
// shrunk so the backoff windows below (multiples of intervalMs) are
// testable in milliseconds instead of the real 180s default.
const tempDir = mkdtempSync(join(tmpdir(), "trailin-sync-engine-"));
const originalDatabasePath = process.env.DATABASE_PATH;
const originalSyncIntervalMs = process.env.SYNC_INTERVAL_MS;
process.env.DATABASE_PATH = join(tempDir, "test.db");
process.env.SYNC_INTERVAL_MS = "1000";

const listAccountsMock = vi.fn<() => Promise<ConnectedAccount[]>>();
vi.mock("../../../src/pipedream/connect.js", () => ({
  listAccounts: () => listAccountsMock(),
}));

const { sqlite } = await import("../../../src/db/index.js");
const { registerSyncProvider } = await import("../../../src/email/sync/syncProviders.js");
const { startSyncEngine, stopSyncEngine } = await import("../../../src/email/sync/syncEngine.js");

afterAll(() => {
  sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
  if (originalSyncIntervalMs === undefined) delete process.env.SYNC_INTERVAL_MS;
  else process.env.SYNC_INTERVAL_MS = originalSyncIntervalMs;
});

beforeEach(() => {
  listAccountsMock.mockReset();
});

afterEach(() => {
  stopSyncEngine();
});

function fakeAccount(id: string, app: string): ConnectedAccount {
  return { id, app, appName: app, name: id, healthy: true, createdAt: "2026-01-01T00:00:00.000Z" };
}

describe("self-continuation when a sweep hits the per-account page cap", () => {
  it("triggers another sweep promptly instead of waiting for the poll interval", async () => {
    const account = fakeAccount("acct-cap", "test-cap-app");
    let fetchCalls = 0;
    registerSyncProvider("test-cap-app", {
      // hasMore stays true through exactly the first sweep's 500-page
      // budget (MAX_PAGES_PER_SWEEP), so that sweep hits the cap with
      // backfill still pending; the very next call (sweep #2's first page)
      // reports hasMore: false, so the chain stops itself there instead of
      // triggering indefinitely.
      fetchChanges: async () => {
        fetchCalls++;
        return { upserts: [], deletes: [], cursor: `c${fetchCalls}`, hasMore: fetchCalls <= 500 };
      },
    });
    listAccountsMock.mockResolvedValue([account]);

    startSyncEngine();
    // The assertion window (800ms) is well under SYNC_INTERVAL_MS (1000ms):
    // only the self-trigger — not the next poll tick — can explain a second
    // sweep (a second listAccounts() call) landing this fast.
    await vi.waitFor(
      () => {
        expect(listAccountsMock.mock.calls.length).toBeGreaterThanOrEqual(2);
      },
      { timeout: 800, interval: 5 },
    );
    expect(fetchCalls).toBeGreaterThanOrEqual(500);
  });
});

describe("per-account failure backoff", () => {
  it("skips a failing account until its backoff window elapses, and resets the window on success", async () => {
    vi.useFakeTimers();
    try {
      const account = fakeAccount("acct-backoff", "test-backoff-app");
      let calls = 0;
      // Scripted outcomes: fail, succeed, fail, succeed — exercises both the
      // initial backoff and that a success resets it (a fourth call that
      // arrives on the same short schedule as the first proves the second
      // failure wasn't escalated from the first).
      const outcomes: Array<"fail" | "ok"> = ["fail", "ok", "fail", "ok"];
      registerSyncProvider("test-backoff-app", {
        fetchChanges: async () => {
          calls++;
          if (outcomes[calls - 1] === "fail") throw new Error(`boom ${calls}`);
          return { upserts: [], deletes: [], cursor: `c${calls}`, hasMore: false };
        },
      });
      listAccountsMock.mockResolvedValue([account]);

      startSyncEngine();
      // t≈0: initial sweep — call #1 fails. Backoff: failures=1,
      // retryAt = now + intervalMs*2^1 = +2000ms.
      await vi.advanceTimersByTimeAsync(0);
      expect(calls).toBe(1);

      // t≈1001: still inside the 2000ms window — sweep runs but skips the account.
      await vi.advanceTimersByTimeAsync(1001);
      expect(calls).toBe(1);

      // t≈2002: window elapsed — call #2 attempted, succeeds, backoff cleared.
      await vi.advanceTimersByTimeAsync(1001);
      expect(calls).toBe(2);

      // t≈3003: no backoff — call #3 attempted, fails again. If the earlier
      // success hadn't reset the counter, this would escalate to failures=2
      // (a 4000ms window); a correct reset instead restarts at failures=1
      // (2000ms), so the account is due again by t≈5003.
      await vi.advanceTimersByTimeAsync(1001);
      expect(calls).toBe(3);

      // t≈4004: inside the fresh (reset) 2000ms window — skipped.
      await vi.advanceTimersByTimeAsync(1001);
      expect(calls).toBe(3);

      // t≈5005: window elapsed — call #4 attempted.
      await vi.advanceTimersByTimeAsync(1001);
      expect(calls).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never blocks an explicit syncAccount() call, even while the account is in backoff", async () => {
    const { syncAccount } = await import("../../../src/email/sync/syncEngine.js");
    const account = fakeAccount("acct-manual", "test-manual-app");
    let calls = 0;
    registerSyncProvider("test-manual-app", {
      fetchChanges: async () => {
        calls++;
        if (calls === 1) throw new Error("boom");
        return { upserts: [], deletes: [], cursor: `c${calls}`, hasMore: false };
      },
    });

    await syncAccount(account); // fails, would set backoff if this went through sweep()
    expect(calls).toBe(1);
    await syncAccount(account); // a direct call always attempts, backoff or not
    expect(calls).toBe(2);
  });
});
