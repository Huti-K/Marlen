import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** Imported dynamically after DATABASE_PATH points at a scratch file — env.ts reads it at import. */
let manage: typeof import("../../src/automations/manage.js");
let scheduler: typeof import("../../src/automations/scheduler.js");

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "trailin-automations-"));
  process.env.DATABASE_PATH = join(dir, "test.db");
  manage = await import("../../src/automations/manage.js");
  scheduler = await import("../../src/automations/scheduler.js");
});

afterAll(() => {
  scheduler.stopScheduler();
});

describe("manual-only automations", () => {
  it("creates one when schedule is omitted or empty, and never schedules it", async () => {
    const omitted = await manage.createAutomation({
      name: "Report button",
      instruction: "Follow the skill 'market-report'.",
    });
    expect(omitted.schedule).toBe("");
    expect(omitted.enabled).toBe(true);
    expect(scheduler.getNextRunAt(omitted.id)).toBeNull();

    const empty = await manage.createAutomation({
      name: "Sweep button",
      instruction: "Sweep the inbox.",
      schedule: "   ",
    });
    expect(empty.schedule).toBe("");
    expect(scheduler.getNextRunAt(empty.id)).toBeNull();
  });

  // Runs while only the manual-only rows above exist: they have no slots to miss.
  it("is never reported as missed", async () => {
    expect(await scheduler.findMissedAutomations()).toEqual([]);
  });

  it("still rejects an invalid non-empty cron", async () => {
    await expect(
      manage.createAutomation({ name: "Bad", instruction: "x", schedule: "not cron" }),
    ).rejects.toThrow(/invalid cron/);
  });

  it("still requires name and instruction", async () => {
    await expect(manage.createAutomation({ name: "  ", instruction: "x" })).rejects.toThrow(
      /name and instruction/,
    );
    await expect(manage.createAutomation({ name: "x", instruction: "  " })).rejects.toThrow(
      /name and instruction/,
    );
  });

  it("converts between scheduled and manual-only via update", async () => {
    const automation = await manage.createAutomation({
      name: "Digest",
      instruction: "Summarize.",
      schedule: "0 8 * * *",
    });
    expect(scheduler.getNextRunAt(automation.id)).not.toBeNull();

    const manual = await manage.updateAutomation(automation.id, { schedule: "" });
    expect(manual.schedule).toBe("");
    expect(scheduler.getNextRunAt(automation.id)).toBeNull();

    const back = await manage.updateAutomation(automation.id, { schedule: "0 9 * * 1" });
    expect(back.schedule).toBe("0 9 * * 1");
    expect(scheduler.getNextRunAt(automation.id)).not.toBeNull();
  });
});
