import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// db/index.ts runs its DDL as an import-time side effect against env.ts's
// DATABASE_PATH read, also at import time — same pattern as
// test/db/leads.test.ts — so this suite gets its own scratch database.
const tempDir = mkdtempSync(join(tmpdir(), "trailin-leads-manage-"));
const originalDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(tempDir, "test.db");

const { closeDb, db, schema } = await import("../../src/db/index.js");
const { getLead } = await import("../../src/db/leads.js");
const { recordLead, removeLead } = await import("../../src/leads/manage.js");
const { createAutomation } = await import("../../src/automations/manage.js");
const { stopScheduler } = await import("../../src/automations/scheduler.js");

afterAll(() => {
  stopScheduler();
  closeDb();
  rmSync(tempDir, { recursive: true, force: true });
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
});

describe("recordLead", () => {
  it("rejects things that are not an email address", async () => {
    await expect(recordLead({ email: "Anna Muster" })).rejects.toThrow(/not an email address/);
    await expect(recordLead({ email: "+49 170 1234567" })).rejects.toThrow(/not an email address/);
  });

  it("creates a new lead keyed by the normalized address", async () => {
    const { lead, created } = await recordLead({
      email: "Anna.Muster@Example.com",
      name: "Anna Muster",
      interest: "Penthouse listing E-1041",
      lastInboundAt: "2026-07-15T10:00:00.000Z",
    });
    expect(created).toBe(true);
    expect(lead.email).toBe("anna.muster@example.com");
    expect(lead.status).toBe("new");
  });

  it("merges a repeat record: fills gaps, never overwrites, timestamps only advance", async () => {
    const { lead, created } = await recordLead({
      email: "ANNA.MUSTER@example.com",
      name: "A. Muster (different)",
      phone: "+49 30 555 0100",
      interest: "completely different interest",
      persona: "Kapitalanleger",
      score: "high",
      lastInboundAt: "2026-07-14T08:00:00.000Z",
    });
    expect(created).toBe(false);
    // Empty before → filled now.
    expect(lead.phone).toBe("+49 30 555 0100");
    expect(lead.persona).toBe("Kapitalanleger");
    expect(lead.score).toBe("high");
    // Already known → kept, not overwritten.
    expect(lead.name).toBe("Anna Muster");
    expect(lead.interest).toBe("Penthouse listing E-1041");
    // The incoming inbound date is older — the newer stored one wins.
    expect(lead.lastInboundAt).toBe("2026-07-15T10:00:00.000Z");

    // A filled assessment is never regressed by a later, different one.
    const reassessed = await recordLead({
      email: "anna.muster@example.com",
      persona: "Eigennutzer",
      score: "low",
    });
    expect(reassessed.lead.persona).toBe("Kapitalanleger");
    expect(reassessed.lead.score).toBe("high");

    const again = await recordLead({
      email: "anna.muster@example.com",
      lastInboundAt: "2026-07-16T09:00:00.000Z",
    });
    expect(again.lead.lastInboundAt).toBe("2026-07-16T09:00:00.000Z");
  });
});

describe("removeLead", () => {
  it("deletes the lead and every automation attached to it", async () => {
    const { lead } = await recordLead({ email: "ben@example.com" });
    const attached = await createAutomation({
      name: "Follow up with Ben",
      instruction: "Check whether ben@example.com replied; update the lead.",
      schedule: "0 9 * * *",
      enabled: false,
      leadId: lead.id,
    });
    const standalone = await createAutomation({
      name: "Unrelated",
      instruction: "Do something else entirely.",
      schedule: "0 9 * * *",
      enabled: false,
    });

    expect(await removeLead(lead.id)).toBe(true);
    expect(await getLead(lead.id)).toBeNull();

    const remaining = await db.select({ id: schema.automations.id }).from(schema.automations);
    expect(remaining.map((a) => a.id)).not.toContain(attached.id);
    expect(remaining.map((a) => a.id)).toContain(standalone.id);
  });

  it("returns false for an unknown id", async () => {
    expect(await removeLead("does-not-exist")).toBe(false);
  });
});

describe("createAutomation with a leadId", () => {
  it("rejects an unknown lead", async () => {
    await expect(
      createAutomation({
        name: "Orphan",
        instruction: "Follow up.",
        schedule: "0 9 * * *",
        enabled: false,
        leadId: "does-not-exist",
      }),
    ).rejects.toThrow(/no lead with id/);
  });
});
