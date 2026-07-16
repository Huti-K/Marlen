import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// db/index.ts runs its DDL as an import-time side effect against env.ts's
// DATABASE_PATH read, also at import time — same pattern as
// test/db/automationSuggestions.test.ts — so this suite gets its own scratch
// database.
const tempDir = mkdtempSync(join(tmpdir(), "trailin-leads-"));
const originalDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(tempDir, "test.db");

const { closeDb } = await import("../../src/db/index.js");
const { createLead, deleteLead, findLeadByEmail, getLead, listLeads, updateLead } = await import(
  "../../src/db/leads.js"
);

afterAll(() => {
  closeDb();
  rmSync(tempDir, { recursive: true, force: true });
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
});

describe("createLead", () => {
  it("normalizes the email and fills defaults", async () => {
    const lead = await createLead({ email: "  Anna.Muster@Example.COM ", name: " Anna Muster " });
    expect(lead.email).toBe("anna.muster@example.com");
    expect(lead.name).toBe("Anna Muster");
    expect(lead.status).toBe("new");
    expect(lead.source).toBe("email");
    expect(lead.persona).toBe("");
    expect(lead.score).toBe("");
    expect(lead.lastInboundAt).toBeNull();
    expect(await getLead(lead.id)).toEqual(lead);
  });

  it("enforces one row per address", async () => {
    await expect(createLead({ email: "ANNA.MUSTER@example.com" })).rejects.toThrow(/UNIQUE/i);
  });
});

describe("findLeadByEmail", () => {
  it("matches case-insensitively via normalization", async () => {
    const found = await findLeadByEmail("Anna.Muster@EXAMPLE.com");
    expect(found?.name).toBe("Anna Muster");
    expect(await findLeadByEmail("nobody@example.com")).toBeNull();
  });
});

describe("listLeads", () => {
  it("lists everything, and narrows by status", async () => {
    const second = await createLead({ email: "ben@example.com", status: "contacted" });
    const all = await listLeads();
    expect(all.map((l) => l.email)).toContain("anna.muster@example.com");
    expect(all.map((l) => l.email)).toContain("ben@example.com");

    const contacted = await listLeads({ status: "contacted" });
    expect(contacted.map((l) => l.id)).toEqual([second.id]);
  });
});

describe("updateLead", () => {
  it("applies only the given fields and bumps updatedAt", async () => {
    const lead = await findLeadByEmail("ben@example.com");
    if (!lead) throw new Error("lead missing");

    const updated = await updateLead(lead.id, {
      status: "engaged",
      interest: "3-room flat in Mitte",
      persona: " Kapitalanleger ",
      score: "high",
      lastInboundAt: "2026-07-16T09:00:00.000Z",
    });
    expect(updated?.status).toBe("engaged");
    expect(updated?.interest).toBe("3-room flat in Mitte");
    expect(updated?.persona).toBe("Kapitalanleger");
    expect(updated?.score).toBe("high");
    expect(updated?.lastInboundAt).toBe("2026-07-16T09:00:00.000Z");
    // Untouched fields survive.
    expect(updated?.email).toBe("ben@example.com");
    expect((updated?.updatedAt ?? "") >= lead.updatedAt).toBe(true);
  });

  it("returns null for an unknown id", async () => {
    expect(await updateLead("does-not-exist", { status: "won" })).toBeNull();
  });
});

describe("deleteLead", () => {
  it("removes the row and reports unknown ids", async () => {
    const lead = await findLeadByEmail("ben@example.com");
    if (!lead) throw new Error("lead missing");
    expect(await deleteLead(lead.id)).toBe(true);
    expect(await getLead(lead.id)).toBeNull();
    expect(await deleteLead(lead.id)).toBe(false);
  });
});
