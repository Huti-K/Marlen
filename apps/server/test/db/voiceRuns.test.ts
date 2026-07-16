import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// db/index.ts runs its DDL as an import-time side effect against env.ts's
// DATABASE_PATH read, also at import time — same pattern as
// test/db/memories.test.ts — so this suite gets its own scratch database.
const tempDir = mkdtempSync(join(tmpdir(), "trailin-voice-runs-"));
const originalDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(tempDir, "test.db");

const { closeDb } = await import("../../src/db/index.js");
const {
  listVoiceLearnRuns,
  markVoiceLearnRunning,
  finishVoiceLearnRun,
  deleteVoiceLearnRun,
  failInterruptedVoiceLearnRuns,
} = await import("../../src/db/voiceRuns.js");

afterAll(() => {
  closeDb();
  rmSync(tempDir, { recursive: true, force: true });
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
});

async function runFor(accountId: string) {
  return (await listVoiceLearnRuns()).find((run) => run.accountId === accountId);
}

describe("voice-learn run state", () => {
  it("tracks a run from running to ok", async () => {
    await markVoiceLearnRunning("acc-1");
    expect(await runFor("acc-1")).toMatchObject({ status: "running", finishedAt: null });

    await finishVoiceLearnRun("acc-1");
    expect(await runFor("acc-1")).toMatchObject({ status: "ok", error: null });
    expect((await runFor("acc-1"))?.finishedAt).not.toBeNull();
  });

  it("records a failure with its reason, and a retry overwrites it", async () => {
    await markVoiceLearnRunning("acc-2");
    await finishVoiceLearnRun("acc-2", "no sent mail found to learn from");
    expect(await runFor("acc-2")).toMatchObject({
      status: "error",
      error: "no sent mail found to learn from",
    });

    // Retry: one row per account — the new attempt replaces the failed one.
    await markVoiceLearnRunning("acc-2");
    expect(await runFor("acc-2")).toMatchObject({
      status: "running",
      error: null,
      finishedAt: null,
    });
    expect((await listVoiceLearnRuns()).filter((r) => r.accountId === "acc-2")).toHaveLength(1);
    await finishVoiceLearnRun("acc-2");
    expect(await runFor("acc-2")).toMatchObject({ status: "ok" });
  });

  it("deletes an account's state with the account", async () => {
    await markVoiceLearnRunning("acc-3");
    await deleteVoiceLearnRun("acc-3");
    expect(await runFor("acc-3")).toBeUndefined();
  });

  it("closes out runs left running by a restart as retryable errors", async () => {
    await markVoiceLearnRunning("acc-4");
    await failInterruptedVoiceLearnRuns();
    expect(await runFor("acc-4")).toMatchObject({
      status: "error",
      error: "interrupted by a server restart",
    });
    // Finished runs are untouched.
    expect(await runFor("acc-1")).toMatchObject({ status: "ok" });
  });
});
