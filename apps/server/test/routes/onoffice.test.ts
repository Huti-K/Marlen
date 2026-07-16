import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// db/index.ts (pulled in transitively by app.ts) runs its DDL as an
// import-time side effect resolved via env.ts's DATABASE_PATH read — same as
// test/routes/automations.test.ts — so point DATABASE_PATH at a fresh temp
// file before anything imports app.ts.
const tempDir = mkdtempSync(join(tmpdir(), "trailin-onoffice-route-"));
const originalDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(tempDir, "test.db");

const { buildApp } = await import("../../src/app.js");

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  rmSync(tempDir, { recursive: true, force: true });
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
});

describe("PUT /api/onoffice/automation-creates", () => {
  it("defaults to off and arms/disarms via the toggle", async () => {
    const initial = await app.inject({ method: "GET", url: "/api/onoffice" });
    expect(initial.json().automationCreates).toBe(false);

    const armed = await app.inject({
      method: "PUT",
      url: "/api/onoffice/automation-creates",
      payload: { enabled: true },
    });
    expect(armed.statusCode).toBe(200);
    expect(armed.json().automationCreates).toBe(true);

    const after = await app.inject({ method: "GET", url: "/api/onoffice" });
    expect(after.json().automationCreates).toBe(true);

    const disarmed = await app.inject({
      method: "PUT",
      url: "/api/onoffice/automation-creates",
      payload: { enabled: false },
    });
    expect(disarmed.json().automationCreates).toBe(false);
  });

  it("rejects a non-boolean body with 400", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/onoffice/automation-creates",
      payload: { enabled: "yes" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("PUT /api/onoffice/write-access", () => {
  it("defaults to off and arms/disarms via the toggle", async () => {
    const initial = await app.inject({ method: "GET", url: "/api/onoffice" });
    expect(initial.json().writeAccess).toBe(false);

    const armed = await app.inject({
      method: "PUT",
      url: "/api/onoffice/write-access",
      payload: { enabled: true },
    });
    expect(armed.statusCode).toBe(200);
    expect(armed.json().writeAccess).toBe(true);

    const after = await app.inject({ method: "GET", url: "/api/onoffice" });
    expect(after.json().writeAccess).toBe(true);

    const disarmed = await app.inject({
      method: "PUT",
      url: "/api/onoffice/write-access",
      payload: { enabled: false },
    });
    expect(disarmed.json().writeAccess).toBe(false);
  });

  it("rejects a non-boolean body with 400", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/onoffice/write-access",
      payload: { enabled: "yes" },
    });
    expect(res.statusCode).toBe(400);
  });
});
