import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// db/index.ts runs its DDL as an import-time side effect against env.ts's
// DATABASE_PATH read, also at import time — same pattern as
// test/db/leads.test.ts. The onOffice secret file lands next to the database,
// so saveOnOfficeConfig below writes into this temp dir too.
const tempDir = mkdtempSync(join(tmpdir(), "trailin-defaults-"));
const originalDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(tempDir, "test.db");

const { closeDb, db, schema } = await import("../../src/db/index.js");
const { pauseOnOfficeDefaults, resumeOnOfficeDefaults, seedDefaultAutomations } = await import(
  "../../src/automations/defaults.js"
);
const { deleteAutomation, updateAutomation } = await import("../../src/automations/manage.js");
const { stopScheduler } = await import("../../src/automations/scheduler.js");
const { saveOnOfficeConfig } = await import("../../src/onoffice/config.js");

afterAll(() => {
  stopScheduler();
  closeDb();
  rmSync(tempDir, { recursive: true, force: true });
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
});

async function automationByName(name: string) {
  const rows = await db.select().from(schema.automations);
  return rows.find((row) => row.name === name);
}

describe("seedDefaultAutomations — onOffice gate", () => {
  it("skips the requiresOnOffice defaults while the CRM is unconfigured", async () => {
    await seedDefaultAutomations();

    expect(await automationByName("Morgenbriefing")).toBeDefined();
    expect(await automationByName("Lead-Eingang")).toBeUndefined();
    expect(await automationByName("Lead-Kadenz")).toBeUndefined();
  });

  it("seeds them on the first call after credentials are saved", async () => {
    await saveOnOfficeConfig({ token: "test-token", secret: "test-secret" });
    await seedDefaultAutomations();

    expect((await automationByName("Lead-Eingang"))?.enabled).toBe(true);
    expect((await automationByName("Lead-Kadenz"))?.enabled).toBe(true);
  });

  it("never re-seeds one the user deleted", async () => {
    const intake = await automationByName("Lead-Eingang");
    expect(intake).toBeDefined();
    if (!intake) return;
    await deleteAutomation(intake.id);

    await seedDefaultAutomations();
    expect(await automationByName("Lead-Eingang")).toBeUndefined();
  });
});

describe("pause/resumeOnOfficeDefaults", () => {
  it("pauses only enabled lead defaults and resumes exactly those", async () => {
    const nachfass = await automationByName("Lead-Kadenz");
    expect(nachfass?.enabled).toBe(true);
    if (!nachfass) return;

    await pauseOnOfficeDefaults();
    expect((await automationByName("Lead-Kadenz"))?.enabled).toBe(false);

    await resumeOnOfficeDefaults();
    expect((await automationByName("Lead-Kadenz"))?.enabled).toBe(true);
  });

  it("leaves an automation the user disabled themselves alone on resume", async () => {
    const nachfass = await automationByName("Lead-Kadenz");
    if (!nachfass) throw new Error("Lead-Kadenz missing");
    await updateAutomation(nachfass.id, { enabled: false });

    // Nothing is enabled to pause, so resume has nothing to re-enable either.
    await pauseOnOfficeDefaults();
    await resumeOnOfficeDefaults();

    expect((await automationByName("Lead-Kadenz"))?.enabled).toBe(false);
  });
});
