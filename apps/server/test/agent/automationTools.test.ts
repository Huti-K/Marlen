import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// db/index.ts runs its DDL as an import-time side effect resolved via
// env.ts's DATABASE_PATH read — same pattern as test/agent/knowledgeTools.test.ts —
// so this suite gets its own scratch database.
const tempDir = mkdtempSync(join(tmpdir(), "trailin-automation-tools-"));
const originalDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(tempDir, "test.db");

const { closeDb, db, schema } = await import("../../src/db/index.js");
const { getNextRunAt, stopScheduler } = await import("../../src/automations/scheduler.js");
const { automationManageTools } = await import("../../src/agent/automationTools.js");

const automationList = automationManageTools.find((t) => t.name === "automation_list");
const automationCreate = automationManageTools.find((t) => t.name === "automation_create");
const automationUpdate = automationManageTools.find((t) => t.name === "automation_update");
const automationDelete = automationManageTools.find((t) => t.name === "automation_delete");
if (!automationList || !automationCreate || !automationUpdate || !automationDelete) {
  throw new Error("automation tools not registered");
}

afterAll(() => {
  // Creating an enabled automation registers a live node-cron task; destroy
  // them all so the test process can exit cleanly.
  stopScheduler();
  closeDb();
  rmSync(tempDir, { recursive: true, force: true });
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
});

function textOf(result: { content: { type: string; text?: string }[] }): string {
  return result.content.map((c) => c.text ?? "").join("");
}

/** The single automation row most tests operate on; fails loudly when it's missing. */
async function onlyAutomation() {
  const [row] = await db.select().from(schema.automations);
  if (!row) throw new Error("expected exactly one automation row");
  return row;
}

// Long enough that the list preview must truncate before this marker.
const LONG_TAIL = "zz-end-of-instruction-marker";
const LONG_INSTRUCTION = `${"Review every connected account for open invoices. ".repeat(10)}${LONG_TAIL}`;

describe("automation_list", () => {
  it("says so when no automations exist", async () => {
    const result = await automationList.execute("call-1", {} as never);
    expect(textOf(result)).toContain("No automations exist yet");
  });
});

describe("automation_create", () => {
  it("returns an invalid cron expression as steering text and persists nothing", async () => {
    const result = await automationCreate.execute("call-2", {
      name: "Bad schedule",
      instruction: "do things",
      schedule: "not-a-cron",
    } as never);
    expect(textOf(result)).toContain("invalid cron expression: not-a-cron");
    expect(await db.select().from(schema.automations)).toHaveLength(0);
  });

  it("creates an enabled, scheduled automation and confirms id and next run", async () => {
    const result = await automationCreate.execute("call-3", {
      name: "Friday digest",
      instruction: LONG_INSTRUCTION,
      schedule: "0 9 * * 5",
    } as never);
    const text = textOf(result);
    expect(text).toContain('Created automation "Friday digest"');
    expect(text).toContain("next run");

    const row = await onlyAutomation();
    expect(row.enabled).toBe(true);
    expect(text).toContain(row.id);
    expect(getNextRunAt(row.id)).not.toBeNull();
  });
});

describe("automation_list — instruction rendering", () => {
  it("previews a long instruction and shows schedule and id", async () => {
    const result = await automationList.execute("call-4", {} as never);
    const text = textOf(result);
    expect(text).toContain("Friday digest");
    expect(text).toContain("0 9 * * 5");
    expect(text).toContain("…");
    expect(text).not.toContain(LONG_TAIL);
  });

  it("includes the complete text with fullInstructions", async () => {
    const result = await automationList.execute("call-5", { fullInstructions: true } as never);
    expect(textOf(result)).toContain(LONG_TAIL);
  });
});

describe("automation_update", () => {
  it("pauses and unschedules the automation with enabled: false", async () => {
    const row = await onlyAutomation();
    const result = await automationUpdate.execute("call-6", {
      id: row.id,
      enabled: false,
    } as never);
    expect(textOf(result)).toContain("paused");
    expect(getNextRunAt(row.id)).toBeNull();

    const updated = await onlyAutomation();
    expect(updated.enabled).toBe(false);
  });

  it("returns steering text for an unknown id", async () => {
    const result = await automationUpdate.execute("call-7", {
      id: "does-not-exist",
      enabled: false,
    } as never);
    expect(textOf(result)).toContain("not found");
  });

  it("returns steering text when no fields are passed", async () => {
    const row = await onlyAutomation();
    const result = await automationUpdate.execute("call-8", { id: row.id } as never);
    expect(textOf(result)).toContain("nothing to update");
  });
});

describe("automation_delete", () => {
  it("deletes the automation, its runs, and each run's conversation", async () => {
    const row = await onlyAutomation();
    // A past run and its conversation (id = run id), the shape runRecorder creates.
    await db.insert(schema.automationRuns).values({
      id: "run-1",
      automationId: row.id,
      status: "success",
      result: "done",
      startedAt: "2026-07-16T08:00:00.000Z",
      finishedAt: "2026-07-16T08:01:00.000Z",
    });
    await db.insert(schema.conversations).values({
      id: "run-1",
      title: "Friday digest",
      type: "automation",
      createdAt: "2026-07-16T08:00:00.000Z",
    });

    const result = await automationDelete.execute("call-9", { id: row.id } as never);
    expect(textOf(result)).toContain("deleted");
    expect(await db.select().from(schema.automations)).toHaveLength(0);
    expect(await db.select().from(schema.automationRuns)).toHaveLength(0);
    expect(await db.select().from(schema.conversations)).toHaveLength(0);
  });

  it("reports an unknown id instead of claiming success", async () => {
    const result = await automationDelete.execute("call-10", { id: "does-not-exist" } as never);
    expect(textOf(result)).toContain("No automation with id does-not-exist");
  });
});
