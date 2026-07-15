import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConnectedAccount } from "@trailin/shared";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { VoiceLearnDeps } from "../../src/agent/voiceLearnService.js";

// runVoiceLearnOnConnect takes all its collaborators as injected deps, but
// importing the module still runs the transitive db DDL at import time — point
// DATABASE_PATH at a throwaway file first, same pattern as the other suites.
const tempDir = mkdtempSync(join(tmpdir(), "trailin-voicelearn-"));
const originalDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(tempDir, "test.db");

const { runVoiceLearnOnConnect } = await import("../../src/agent/voiceLearnService.js");
const { sqlite } = await import("../../src/db/index.js");

afterAll(() => {
  sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
});

const gmailAccount: ConnectedAccount = {
  id: "acc_gmail",
  app: "gmail",
  name: "me@example.com",
  healthy: true,
  createdAt: "2026-01-01T00:00:00.000Z",
};

/** A deps object wired to a fake clock; overrides tweak individual behaviors per test. */
function makeDeps(overrides: Partial<VoiceLearnDeps> = {}): VoiceLearnDeps {
  let clock = 0;
  return {
    listAccounts: vi.fn(async () => [gmailAccount]),
    syncAccount: vi.fn(async () => {}),
    countSentMessages: vi.fn(() => 5),
    modelConfigured: vi.fn(async () => true),
    learn: vi.fn(async () => ({})),
    now: () => clock,
    sleep: vi.fn(async (ms: number) => {
      clock += ms;
    }),
    ...overrides,
  };
}

describe("runVoiceLearnOnConnect", () => {
  it("learns once sent mail is already mirrored", async () => {
    const deps = makeDeps();
    await runVoiceLearnOnConnect("acc_gmail", deps);
    expect(deps.syncAccount).toHaveBeenCalledTimes(1);
    expect(deps.learn).toHaveBeenCalledWith("acc_gmail");
  });

  it("skips entirely when no LLM is configured", async () => {
    const deps = makeDeps({ modelConfigured: vi.fn(async () => false) });
    await runVoiceLearnOnConnect("acc_gmail", deps);
    expect(deps.syncAccount).not.toHaveBeenCalled();
    expect(deps.learn).not.toHaveBeenCalled();
  });

  it("skips accounts that are not email providers", async () => {
    const slack: ConnectedAccount = { ...gmailAccount, id: "acc_slack", app: "slack" };
    const deps = makeDeps({ listAccounts: vi.fn(async () => [slack]) });
    await runVoiceLearnOnConnect("acc_slack", deps);
    expect(deps.learn).not.toHaveBeenCalled();
  });

  it("polls until the fresh account's sent mail backfills, then learns", async () => {
    let calls = 0;
    // Empty for the first two syncs, then the mirror has sent mail.
    const countSentMessages = vi.fn(() => (calls++ < 2 ? 0 : 3));
    const deps = makeDeps({ countSentMessages });
    await runVoiceLearnOnConnect("acc_gmail", deps);
    expect(deps.syncAccount).toHaveBeenCalledTimes(3);
    expect(deps.sleep).toHaveBeenCalledTimes(2);
    expect(deps.learn).toHaveBeenCalledTimes(1);
  });

  it("gives up without learning when sent mail never arrives", async () => {
    const deps = makeDeps({ countSentMessages: vi.fn(() => 0) });
    await runVoiceLearnOnConnect("acc_gmail", deps);
    expect(deps.learn).not.toHaveBeenCalled();
    // Bounded: it stopped polling rather than looping forever.
    expect((deps.sleep as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });

  it("dedupes a concurrent second run for the same account", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const learn = vi.fn(async () => {
      await gate;
      return {};
    });

    // inFlight.add runs synchronously at entry, so the second call sees the
    // first already in flight and returns without ever touching its deps.
    const first = runVoiceLearnOnConnect("acc_gmail", makeDeps({ learn }));
    const second = runVoiceLearnOnConnect("acc_gmail", makeDeps({ learn }));
    await second;
    release();
    await first;
    // Only the first run reached learn; the second was deduped away.
    expect(learn).toHaveBeenCalledTimes(1);
  });
});
