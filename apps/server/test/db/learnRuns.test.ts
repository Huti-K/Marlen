import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LearnRun } from "@trailin/shared";
import { afterAll, describe, expect, it } from "vitest";

// db/index.ts runs its DDL as an import-time side effect against env.ts's
// DATABASE_PATH read, also at import time — same pattern as
// test/db/memories.test.ts — so this suite gets its own scratch database.
const tempDir = mkdtempSync(join(tmpdir(), "trailin-learn-runs-"));
const originalDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(tempDir, "test.db");

const { closeDb } = await import("../../src/db/index.js");
const { listLearnRuns, recordLearnRun } = await import("../../src/db/learnRuns.js");

afterAll(() => {
  closeDb();
  rmSync(tempDir, { recursive: true, force: true });
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
});

/** A completed ok-run stamped at the given minute offset, so ordering is deterministic. */
function run(minute: number, overrides: Partial<Omit<LearnRun, "id">> = {}): Omit<LearnRun, "id"> {
  const stamp = `2026-07-16T03:${String(minute).padStart(2, "0")}:00.000Z`;
  return {
    reason: "scheduled",
    status: "ok",
    matched: 0,
    pending: 0,
    identical: 0,
    learned: 0,
    lessons: 0,
    error: null,
    startedAt: stamp,
    finishedAt: stamp,
    ...overrides,
  };
}

describe("recordLearnRun / listLearnRuns", () => {
  it("stores a run and lists newest first", async () => {
    await recordLearnRun(run(1));
    await recordLearnRun(run(3, { reason: "boot", lessons: 2, learned: 1 }));
    await recordLearnRun(run(2, { status: "error", error: "provider down" }));

    const runs = await listLearnRuns();
    expect(runs.map((r) => r.startedAt.slice(14, 16))).toEqual(["03", "02", "01"]);
    expect(runs[0]).toMatchObject({ reason: "boot", lessons: 2, learned: 1 });
    expect(runs[1]).toMatchObject({ status: "error", error: "provider down" });
  });

  it("prunes to the newest 20 runs", async () => {
    for (let i = 0; i < 25; i++) await recordLearnRun(run(i + 10));
    const runs = await listLearnRuns();
    expect(runs).toHaveLength(20);
    // The oldest survivors are the newest 20 of everything inserted so far.
    expect(runs.at(-1)?.startedAt).toBe("2026-07-16T03:15:00.000Z");
  });
});
