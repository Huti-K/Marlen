import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

// db/index.ts runs its DDL and reads DATABASE_PATH at import time (same pattern
// as runRecorder.test.ts) — point it at a fresh temp file before anything pulls
// db/index.ts in.
const tempDir = mkdtempSync(join(tmpdir(), "trailin-scheduler-"));
const originalDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(tempDir, "test.db");

const { db, schema, closeDb } = await import("../../src/db/index.js");
const { previousCronRun, findMissedAutomations } = await import(
  "../../src/automations/scheduler.js"
);
const { setSetting, TIMEZONE_SETTING_KEY } = await import("../../src/db/settings.js");

afterAll(() => {
  closeDb();
  rmSync(tempDir, { recursive: true, force: true });
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
});

beforeEach(async () => {
  await db.delete(schema.automationRuns);
  await db.delete(schema.automations);
  // findMissedAutomations resolves cron in this zone; pin it so the slot math is
  // deterministic regardless of the host's local timezone.
  await setSetting(TIMEZONE_SETTING_KEY, "UTC");
});

async function insertAutomation(
  overrides: Partial<{ enabled: boolean; schedule: string; createdAt: string }> = {},
): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.automations).values({
    id,
    name: "Daily briefing",
    instruction: "Summarize the inbox",
    schedule: overrides.schedule ?? "0 8 * * *",
    enabled: overrides.enabled ?? true,
    showInActivity: true,
    pinned: false,
    createdAt: overrides.createdAt ?? new Date("2026-07-01T00:00:00Z").toISOString(),
  });
  return id;
}

async function insertRun(
  automationId: string,
  status: "running" | "success" | "error",
  startedAt: string,
): Promise<void> {
  await db.insert(schema.automationRuns).values({
    id: randomUUID(),
    automationId,
    status,
    result: "",
    startedAt,
    finishedAt: status === "running" ? null : startedAt,
  });
}

describe("previousCronRun", () => {
  it("returns the most recent daily slot at or before the given time", () => {
    const after = previousCronRun("0 8 * * *", "UTC", new Date("2026-07-15T09:00:00Z"));
    expect(after?.toISOString()).toBe("2026-07-15T08:00:00.000Z");

    const before = previousCronRun("0 8 * * *", "UTC", new Date("2026-07-15T07:00:00Z"));
    expect(before?.toISOString()).toBe("2026-07-14T08:00:00.000Z");
  });

  it("evaluates the pattern in the given timezone", () => {
    // 08:00 in Asia/Tokyo (UTC+9) is 23:00 UTC the previous day.
    const slot = previousCronRun("0 8 * * *", "Asia/Tokyo", new Date("2026-07-15T00:00:00Z"));
    expect(slot?.toISOString()).toBe("2026-07-14T23:00:00.000Z");
  });

  it("returns null when the pattern never fires within the lookback window", () => {
    // Feb 29 last occurred 2024 — far beyond the 40-day lookback from July 2026.
    expect(previousCronRun("0 8 29 2 *", "UTC", new Date("2026-07-15T09:00:00Z"))).toBeNull();
  });
});

describe("findMissedAutomations", () => {
  const now = new Date("2026-07-15T09:00:00Z"); // just after the 08:00 UTC slot

  it("reports an enabled automation whose latest slot never ran", async () => {
    const id = await insertAutomation();
    const missed = await findMissedAutomations(now);
    expect(missed.map((m) => m.id)).toEqual([id]);
    expect(missed[0]?.dueAt).toBe("2026-07-15T08:00:00.000Z");
  });

  it("does not report a slot already covered by a successful run", async () => {
    const id = await insertAutomation();
    await insertRun(id, "success", "2026-07-15T08:01:00Z");
    expect(await findMissedAutomations(now)).toEqual([]);
  });

  it("does not report a slot with a catch-up run still in progress", async () => {
    const id = await insertAutomation();
    await insertRun(id, "running", "2026-07-15T08:30:00Z");
    expect(await findMissedAutomations(now)).toEqual([]);
  });

  it("still reports a slot whose only covering run errored", async () => {
    const id = await insertAutomation();
    await insertRun(id, "error", "2026-07-15T08:02:00Z");
    expect((await findMissedAutomations(now)).map((m) => m.id)).toEqual([id]);
  });

  it("ignores a run that predates the missed slot", async () => {
    const id = await insertAutomation();
    // Yesterday's run succeeded, but today's 08:00 slot has nothing.
    await insertRun(id, "success", "2026-07-14T08:00:00Z");
    expect((await findMissedAutomations(now)).map((m) => m.id)).toEqual([id]);
  });

  it("skips disabled automations", async () => {
    await insertAutomation({ enabled: false });
    expect(await findMissedAutomations(now)).toEqual([]);
  });

  it("ignores a slot from before the automation was created", async () => {
    // Created after today's 08:00 slot: that slot isn't its responsibility.
    await insertAutomation({ createdAt: "2026-07-15T08:30:00Z" });
    expect(await findMissedAutomations(now)).toEqual([]);
  });
});
