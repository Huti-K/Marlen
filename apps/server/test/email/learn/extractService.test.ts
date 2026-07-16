import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// Same DATABASE_PATH isolation dance as extractor.test.ts: point it at a
// fresh temp file before anything pulls db/index.ts in.
const tempDir = mkdtempSync(join(tmpdir(), "trailin-learn-service-"));
const originalDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(tempDir, "test.db");

const { closeDb } = await import("../../../src/db/index.js");
const { listLearnRuns } = await import("../../../src/db/learnRuns.js");
const { runLearningSweep, nextLearnRunAt } = await import(
  "../../../src/email/learn/extractService.js"
);

afterAll(() => {
  closeDb();
  rmSync(tempDir, { recursive: true, force: true });
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
});

describe("runLearningSweep", () => {
  it("records an ok run even when there is nothing to match or learn", async () => {
    // Empty database: both sweeps early-return before touching any provider,
    // and the run is still recorded — the whole point of the run log.
    await runLearningSweep("boot");

    const runs = await listLearnRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      reason: "boot",
      status: "ok",
      matched: 0,
      pending: 0,
      identical: 0,
      learned: 0,
      lessons: 0,
      error: null,
    });
    expect((runs[0]?.finishedAt ?? "") >= (runs[0]?.startedAt ?? "")).toBe(true);
  });
});

describe("nextLearnRunAt", () => {
  it("is null while the nightly cron isn't scheduled", () => {
    expect(nextLearnRunAt()).toBeNull();
  });
});
