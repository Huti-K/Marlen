import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// db/index.ts (pulled in transitively by app.ts) runs its DDL as an
// import-time side effect resolved via env.ts's DATABASE_PATH read — same as
// test/routes/automations.test.ts — so point DATABASE_PATH at a fresh temp
// file before anything imports app.ts.
const tempDir = mkdtempSync(join(tmpdir(), "trailin-leads-route-"));
const originalDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(tempDir, "test.db");

const { buildApp } = await import("../../src/app.js");
const { stopScheduler } = await import("../../src/automations/scheduler.js");

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  stopScheduler();
  rmSync(tempDir, { recursive: true, force: true });
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
});

describe("POST /api/leads", () => {
  it("records a lead and reports created: true", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/leads",
      payload: {
        email: "Anna.Muster@Example.com",
        name: "Anna Muster",
        interest: "E-1041",
        persona: "Kapitalanleger",
        score: "high",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.created).toBe(true);
    expect(body.lead.email).toBe("anna.muster@example.com");
    expect(body.lead.source).toBe("manual");
    expect(body.lead.persona).toBe("Kapitalanleger");
    expect(body.lead.score).toBe("high");
  });

  it("merges a repeat record instead of duplicating", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/leads",
      payload: { email: "anna.muster@example.com", phone: "+49 30 555 0100" },
    });
    expect(res.json().created).toBe(false);

    const list = await app.inject({ method: "GET", url: "/api/leads" });
    expect(list.json()).toHaveLength(1);
    expect(list.json()[0].phone).toBe("+49 30 555 0100");
  });

  it("rejects a non-email with 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/leads",
      payload: { email: "not an address" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /api/leads", () => {
  it("narrows by status", async () => {
    const none = await app.inject({ method: "GET", url: "/api/leads?status=won" });
    expect(none.json()).toEqual([]);
    const all = await app.inject({ method: "GET", url: "/api/leads?status=new" });
    expect(all.json()).toHaveLength(1);
  });
});

describe("PATCH /api/leads/:id", () => {
  it("updates fields and returns the row", async () => {
    const [lead] = (await app.inject({ method: "GET", url: "/api/leads" })).json();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/leads/${lead.id}`,
      payload: { status: "contacted", score: "medium", lastOutboundAt: "2026-07-16T10:00:00.000Z" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("contacted");
    expect(res.json().score).toBe("medium");
    expect(res.json().lastOutboundAt).toBe("2026-07-16T10:00:00.000Z");
  });

  it("rejects an invalid score with 400", async () => {
    const [lead] = (await app.inject({ method: "GET", url: "/api/leads" })).json();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/leads/${lead.id}`,
      payload: { score: "very-high" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("404s on an unknown id", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/leads/does-not-exist",
      payload: { status: "won" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("lead automations", () => {
  it("lists the automations attached to a lead, and DELETE cascades over them", async () => {
    const [lead] = (await app.inject({ method: "GET", url: "/api/leads" })).json();
    const created = await app.inject({
      method: "POST",
      url: "/api/automations",
      payload: {
        name: "Follow up with Anna",
        instruction: "Check whether anna.muster@example.com replied; update the lead.",
        schedule: "0 9 * * *",
        enabled: false,
        leadId: lead.id,
      },
    });
    expect(created.statusCode).toBe(200);

    const attached = await app.inject({ method: "GET", url: `/api/leads/${lead.id}/automations` });
    expect(attached.json().map((a: { name: string }) => a.name)).toEqual(["Follow up with Anna"]);

    const del = await app.inject({ method: "DELETE", url: `/api/leads/${lead.id}` });
    expect(del.statusCode).toBe(200);

    const automations = await app.inject({ method: "GET", url: "/api/automations" });
    expect(automations.json().map((a: { name: string }) => a.name)).not.toContain(
      "Follow up with Anna",
    );
  });

  it("404s for automations of an unknown lead", async () => {
    const res = await app.inject({ method: "GET", url: "/api/leads/does-not-exist/automations" });
    expect(res.statusCode).toBe(404);
  });

  it("400s when creating an automation for an unknown lead", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/automations",
      payload: {
        name: "Orphan",
        instruction: "Follow up.",
        schedule: "0 9 * * *",
        enabled: false,
        leadId: "does-not-exist",
      },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("DELETE /api/leads/:id", () => {
  it("404s on an unknown id", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/leads/does-not-exist" });
    expect(res.statusCode).toBe(404);
  });
});
