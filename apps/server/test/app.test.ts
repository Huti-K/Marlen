import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("buildApp", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("answers unknown API routes with the { error } envelope", async () => {
    const res = await app.inject({ method: "GET", url: "/api/does-not-exist" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not found", requestId: expect.any(String) });
  });

  it("rejects a non-loopback Host header (DNS-rebinding guard)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/status",
      headers: { host: "evil.example.com" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("host not allowed");
  });

  it("serves /api/status with the AppStatus shape", async () => {
    const res = await app.inject({ method: "GET", url: "/api/status" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(typeof body.pipedreamConfigured).toBe("boolean");
    expect(typeof body.modelConfigured).toBe("boolean");
    expect(typeof body.emailAccounts).toBe("number");
    expect(typeof body.emailAccountsKnown).toBe("boolean");
  });
});
