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

/** A deps object whose probe finds sent mail immediately; overrides tweak individual behaviors per test. */
function makeDeps(overrides: Partial<VoiceLearnDeps> = {}): VoiceLearnDeps {
  return {
    listAccounts: vi.fn(async () => [gmailAccount]),
    hasSentMail: vi.fn(async () => true),
    modelConfigured: vi.fn(async () => true),
    learn: vi.fn(async () => ({})),
    sleep: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("runVoiceLearnOnConnect", () => {
  it("probes for sent mail and learns", async () => {
    const deps = makeDeps();
    await runVoiceLearnOnConnect("acc_gmail", deps);
    expect(deps.hasSentMail).toHaveBeenCalledTimes(1);
    expect(deps.learn).toHaveBeenCalledWith("acc_gmail");
  });

  it("skips entirely when no LLM is configured", async () => {
    const deps = makeDeps({ modelConfigured: vi.fn(async () => false) });
    await runVoiceLearnOnConnect("acc_gmail", deps);
    expect(deps.hasSentMail).not.toHaveBeenCalled();
    expect(deps.learn).not.toHaveBeenCalled();
  });

  it("skips accounts that are not email providers", async () => {
    const slack: ConnectedAccount = { ...gmailAccount, id: "acc_slack", app: "slack" };
    const deps = makeDeps({ listAccounts: vi.fn(async () => [slack]) });
    await runVoiceLearnOnConnect("acc_slack", deps);
    expect(deps.learn).not.toHaveBeenCalled();
  });

  it("skips without learning when the account has no sent mail", async () => {
    const deps = makeDeps({ hasSentMail: vi.fn(async () => false) });
    await runVoiceLearnOnConnect("acc_gmail", deps);
    expect(deps.hasSentMail).toHaveBeenCalledTimes(1);
    expect(deps.sleep).not.toHaveBeenCalled();
    expect(deps.learn).not.toHaveBeenCalled();
  });

  it("retries a throwing probe a bounded number of times, then learns if one succeeds", async () => {
    let calls = 0;
    const hasSentMail = vi.fn(async () => {
      if (calls++ < 2) throw new Error("proxy timeout");
      return true;
    });
    const deps = makeDeps({ hasSentMail });
    await runVoiceLearnOnConnect("acc_gmail", deps);
    expect(hasSentMail).toHaveBeenCalledTimes(3);
    expect(deps.sleep).toHaveBeenCalledTimes(2);
    expect(deps.learn).toHaveBeenCalledTimes(1);
  });

  it("gives up (without learning) when the probe keeps throwing", async () => {
    const deps = makeDeps({
      hasSentMail: vi.fn(async () => {
        throw new Error("proxy timeout");
      }),
    });
    await runVoiceLearnOnConnect("acc_gmail", deps);
    expect(deps.hasSentMail).toHaveBeenCalledTimes(3);
    expect(deps.learn).not.toHaveBeenCalled();
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
