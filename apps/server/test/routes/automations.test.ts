import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// db/index.ts (pulled in transitively by app.ts) runs its DDL as an
// import-time side effect and resolves its path through env.ts's
// DATABASE_PATH read, also at import time — same as test/routes/search.test.ts,
// point DATABASE_PATH at a fresh temp file before anything imports app.ts.
const tempDir = mkdtempSync(join(tmpdir(), "trailin-automations-route-"));
const originalDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(tempDir, "test.db");

const { buildApp } = await import("../../src/app.js");
const { createSuggestion } = await import("../../src/db/automationSuggestions.js");
const { stopScheduler } = await import("../../src/automations/scheduler.js");

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  // Accepting a suggestion creates an enabled automation, which registers a
  // live node-cron task; destroy them so the test process can exit cleanly.
  stopScheduler();
  rmSync(tempDir, { recursive: true, force: true });
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
});

// The CRUD suites only exercise validation and not-found paths; the one test
// that creates a real, enabled automation (accepting a suggestion) relies on
// afterAll's stopScheduler to destroy the node-cron task it registers.
describe("POST /api/automations — validation", () => {
  it("rejects a blank name/instruction/schedule with 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/automations",
      payload: { name: "  ", instruction: "  ", schedule: "  " },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("name, instruction and schedule are required");
  });

  it("rejects an invalid cron expression with 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/automations",
      payload: { name: "Daily digest", instruction: "summarize inbox", schedule: "not-a-cron" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid cron expression: not-a-cron");
  });
});

describe("PATCH /api/automations/:id — validation and not-found", () => {
  it("rejects an empty name with 400 before checking the id exists", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/automations/does-not-exist",
      payload: { name: "  " },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("name must not be empty");
  });

  it("rejects an empty body with 400 (nothing to update)", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/automations/does-not-exist",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("nothing to update");
  });

  it("answers a well-formed update for a nonexistent id with 404", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/automations/does-not-exist",
      payload: { name: "New name" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("not found");
  });
});

describe("POST /api/automations/:id/run — not-found", () => {
  it("answers a nonexistent id with 404", async () => {
    const res = await app.inject({ method: "POST", url: "/api/automations/does-not-exist/run" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("not found");
  });
});

describe("automation flags — runOnNewMail and notifyOnCompletion", () => {
  it("defaults both flags to false on create", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/automations",
      payload: { name: "Plain digest", instruction: "summarize inbox", schedule: "0 8 * * *" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ runOnNewMail: false, notifyOnCompletion: false });
  });

  it("round-trips both flags through create and patch", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/automations",
      payload: {
        name: "Inbox reactor",
        instruction: "React to new mail.",
        schedule: "0 8 * * *",
        runOnNewMail: true,
        notifyOnCompletion: true,
      },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({ runOnNewMail: true, notifyOnCompletion: true });

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/automations/${created.json().id}`,
      payload: { runOnNewMail: false, notifyOnCompletion: false },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({ runOnNewMail: false, notifyOnCompletion: false });
  });
});

describe("automation suggestions — accept and dismiss", () => {
  it("answers accept/dismiss for an unknown id with 404", async () => {
    for (const action of ["accept", "dismiss"]) {
      const res = await app.inject({
        method: "POST",
        url: `/api/automations/suggestions/does-not-exist/${action}`,
      });
      expect(res.statusCode).toBe(404);
    }
  });

  it("lists a pending suggestion and dismisses it exactly once", async () => {
    const suggestion = await createSuggestion({
      name: "Dismiss me",
      instruction: "Do the dismissed thing.",
      schedule: "0 8 * * *",
      rationale: "Recurs.",
    });

    const list = await app.inject({ method: "GET", url: "/api/automations/suggestions" });
    expect(list.json().map((s: { id: string }) => s.id)).toContain(suggestion.id);

    const res = await app.inject({
      method: "POST",
      url: `/api/automations/suggestions/${suggestion.id}/dismiss`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    // Deciding is one-way: a second dismiss finds nothing pending.
    const again = await app.inject({
      method: "POST",
      url: `/api/automations/suggestions/${suggestion.id}/dismiss`,
    });
    expect(again.statusCode).toBe(404);
  });

  it("accepting creates the proposed automation and retires the suggestion", async () => {
    const suggestion = await createSuggestion({
      name: "Accept me",
      instruction: "Do the accepted thing.",
      schedule: "0 9 * * 1",
      rationale: "Recurs.",
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/automations/suggestions/${suggestion.id}/accept`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: "Accept me", schedule: "0 9 * * 1", enabled: true });

    const list = await app.inject({ method: "GET", url: "/api/automations/suggestions" });
    expect(list.json().map((s: { id: string }) => s.id)).not.toContain(suggestion.id);
  });
});
