import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// db/index.ts runs its DDL as an import-time side effect resolved via
// env.ts's DATABASE_PATH read — same pattern as
// test/agent/automationTools.test.ts — so this suite gets its own scratch
// database.
const tempDir = mkdtempSync(join(tmpdir(), "trailin-lead-tools-"));
const originalDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(tempDir, "test.db");

const { closeDb, db, schema } = await import("../../src/db/index.js");
const { stopScheduler } = await import("../../src/automations/scheduler.js");
const { createAutomation } = await import("../../src/automations/manage.js");
const { leadDeleteTool, leadTools } = await import("../../src/agent/leadTools.js");

const leadRecord = leadTools.find((t) => t.name === "lead_record");
const leadList = leadTools.find((t) => t.name === "lead_list");
const leadUpdate = leadTools.find((t) => t.name === "lead_update");
if (!leadRecord || !leadList || !leadUpdate) {
  throw new Error("lead tools not registered");
}

afterAll(() => {
  stopScheduler();
  closeDb();
  rmSync(tempDir, { recursive: true, force: true });
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
});

function textOf(result: { content: { type: string; text?: string }[] }): string {
  return result.content.map((c) => c.text ?? "").join("");
}

/** The single lead row most tests operate on; fails loudly when it's missing. */
async function onlyLead() {
  const [row] = await db.select().from(schema.leads);
  if (!row) throw new Error("expected exactly one lead row");
  return row;
}

describe("lead_list", () => {
  it("says so when the directory is empty", async () => {
    const result = await leadList.execute("call-1", {} as never);
    expect(textOf(result)).toContain("directory is empty");
  });
});

describe("lead_record", () => {
  it("returns a rejected email address as steering text and persists nothing", async () => {
    const result = await leadRecord.execute("call-2", { email: "Anna Muster" } as never);
    expect(textOf(result)).toContain("not an email address");
    expect(await db.select().from(schema.leads)).toHaveLength(0);
  });

  it("records a new lead with its inbound timestamp and assessment", async () => {
    const result = await leadRecord.execute("call-3", {
      email: "Anna.Muster@Example.com",
      name: "Anna Muster",
      interest: "Penthouse E-1041",
      persona: "Kapitalanleger",
      score: "high",
      inboundAt: "2026-07-16T08:30:00.000Z",
    } as never);
    expect(textOf(result)).toContain("Recorded new lead");
    const row = await onlyLead();
    expect(row.email).toBe("anna.muster@example.com");
    expect(row.persona).toBe("Kapitalanleger");
    expect(row.score).toBe("high");
    expect(row.lastInboundAt).toBe("2026-07-16T08:30:00.000Z");
  });

  it("merges a repeat record instead of duplicating", async () => {
    const result = await leadRecord.execute("call-4", {
      email: "anna.muster@example.com",
      phone: "+49 30 555 0100",
    } as never);
    expect(textOf(result)).toContain("already known");
    const row = await onlyLead();
    expect(row.phone).toBe("+49 30 555 0100");
  });
});

describe("lead_update", () => {
  it("moves the lead along the pipeline", async () => {
    const row = await onlyLead();
    const result = await leadUpdate.execute("call-5", {
      id: row.id,
      status: "contacted",
      score: "medium",
      outboundAt: "2026-07-16T10:00:00.000Z",
    } as never);
    expect(textOf(result)).toContain("contacted");
    const updated = await onlyLead();
    expect(updated.status).toBe("contacted");
    expect(updated.score).toBe("medium");
    expect(updated.lastOutboundAt).toBe("2026-07-16T10:00:00.000Z");
  });

  it("reports an unknown id instead of claiming success", async () => {
    const result = await leadUpdate.execute("call-6", {
      id: "does-not-exist",
      status: "won",
    } as never);
    expect(textOf(result)).toContain("No lead with id does-not-exist");
  });
});

describe("lead_list — rendering", () => {
  it("shows the lead with status and interest, and filters by status", async () => {
    const listed = await leadList.execute("call-7", {} as never);
    const text = textOf(listed);
    expect(text).toContain("Anna Muster <anna.muster@example.com>");
    expect(text).toContain("contacted");
    expect(text).toContain("Penthouse E-1041");
    expect(text).toContain("persona: Kapitalanleger");
    expect(text).toContain("score medium");

    const none = await leadList.execute("call-8", { status: "won" } as never);
    expect(textOf(none)).toContain('No leads with status "won"');
  });
});

describe("lead_delete", () => {
  it("deletes the lead and its attached automations", async () => {
    const row = await onlyLead();
    await createAutomation({
      name: "Follow up with Anna",
      instruction: "Check whether anna.muster@example.com replied.",
      schedule: "0 9 * * *",
      enabled: false,
      leadId: row.id,
    });

    const result = await leadDeleteTool.execute("call-9", { id: row.id } as never);
    expect(textOf(result)).toContain("Deleted lead anna.muster@example.com");
    expect(await db.select().from(schema.leads)).toHaveLength(0);
    expect(await db.select().from(schema.automations)).toHaveLength(0);
  });

  it("reports an unknown id instead of claiming success", async () => {
    const result = await leadDeleteTool.execute("call-10", { id: "does-not-exist" } as never);
    expect(textOf(result)).toContain("No lead with id does-not-exist");
  });
});
