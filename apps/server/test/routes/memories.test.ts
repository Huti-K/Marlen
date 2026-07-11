import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";

interface MemoryEntryBody {
  id: string;
  content: string;
}

describe("memory routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects a body that fails schema validation, in the error envelope", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/memories",
      payload: { accountId: 5 },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as Record<string, unknown>;
    expect(typeof body.error).toBe("string");
    expect(typeof body.requestId).toBe("string");
  });

  it("creates, lists, updates and deletes a memory", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/memories",
      payload: { content: "Bevorzugt kurze, formelle Antworten" },
    });
    expect(created.statusCode).toBe(200);
    const entry = created.json() as MemoryEntryBody;
    expect(entry.content).toBe("Bevorzugt kurze, formelle Antworten");

    const listed = await app.inject({ method: "GET", url: "/api/memories" });
    expect(listed.statusCode).toBe(200);
    const entries = listed.json() as MemoryEntryBody[];
    expect(entries.some((m) => m.id === entry.id)).toBe(true);

    const updated = await app.inject({
      method: "PUT",
      url: `/api/memories/${entry.id}`,
      payload: { content: "Bevorzugt ausführliche Antworten" },
    });
    expect(updated.statusCode).toBe(200);
    expect((updated.json() as MemoryEntryBody).content).toBe("Bevorzugt ausführliche Antworten");

    const deleted = await app.inject({ method: "DELETE", url: `/api/memories/${entry.id}` });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ ok: true });

    const gone = await app.inject({
      method: "PUT",
      url: `/api/memories/${entry.id}`,
      payload: { content: "x" },
    });
    expect(gone.statusCode).toBe(404);
  });
});
