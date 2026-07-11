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

// These only exercise validation and not-found paths — none create a real,
// enabled automation, since that would register a live node-cron task.
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
