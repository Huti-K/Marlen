import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// db/index.ts runs its DDL as an import-time side effect against env.ts's
// DATABASE_PATH read, also at import time — same pattern as
// test/db/learnRuns.test.ts — so this suite gets its own scratch database.
const tempDir = mkdtempSync(join(tmpdir(), "trailin-automation-suggestions-"));
const originalDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(tempDir, "test.db");

const { closeDb } = await import("../../src/db/index.js");
const { createSuggestion, decideSuggestion, listAllSuggestions, listPendingSuggestions } =
  await import("../../src/db/automationSuggestions.js");

afterAll(() => {
  closeDb();
  rmSync(tempDir, { recursive: true, force: true });
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
});

function proposal(name: string) {
  return {
    name,
    instruction: `Do the ${name} task across all accounts and report the result.`,
    schedule: "0 8 * * *",
    rationale: `You asked for ${name} several times.`,
  };
}

describe("createSuggestion / listPendingSuggestions", () => {
  it("stores a pending suggestion and lists it", async () => {
    const created = await createSuggestion(proposal("morning check"));
    expect(created.status).toBe("pending");
    expect(created.decidedAt).toBeNull();

    const pending = await listPendingSuggestions();
    expect(pending.map((s) => s.name)).toContain("morning check");
  });
});

describe("decideSuggestion", () => {
  it("stamps a pending suggestion and removes it from the pending list", async () => {
    const created = await createSuggestion(proposal("weekly summary"));
    const decided = await decideSuggestion(created.id, "dismissed");
    expect(decided?.status).toBe("dismissed");
    expect(decided?.decidedAt).not.toBeNull();

    const pending = await listPendingSuggestions();
    expect(pending.map((s) => s.name)).not.toContain("weekly summary");
    // Decided rows stay visible as dedup context.
    const all = await listAllSuggestions();
    expect(all.find((s) => s.id === created.id)?.status).toBe("dismissed");
  });

  it("is one-way: deciding an already-decided or unknown id returns null", async () => {
    const created = await createSuggestion(proposal("invoice sweep"));
    await decideSuggestion(created.id, "accepted");
    expect(await decideSuggestion(created.id, "dismissed")).toBeNull();
    expect(await decideSuggestion("does-not-exist", "dismissed")).toBeNull();
  });

  it("prunes the oldest decided rows beyond the keep window, never pending ones", async () => {
    for (let i = 0; i < 55; i++) {
      const created = await createSuggestion(proposal(`bulk-${i}`));
      await decideSuggestion(created.id, "dismissed");
    }
    const keeper = await createSuggestion(proposal("still pending"));

    const all = await listAllSuggestions();
    const decided = all.filter((s) => s.status !== "pending");
    expect(decided.length).toBeLessThanOrEqual(50);
    expect(all.find((s) => s.id === keeper.id)?.status).toBe("pending");
  });
});
