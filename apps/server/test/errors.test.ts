import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { AppError, registerErrorHandler, upstreamError } from "../src/errors.js";

describe("upstreamError", () => {
  it("wraps a foreign error as a 502", () => {
    const wrapped = upstreamError("upstream broke", new Error("socket hang up"));
    expect(wrapped.statusCode).toBe(502);
    expect(wrapped.message).toBe("upstream broke");
  });

  it("passes an AppError cause through with its status, message, and code", () => {
    const original = new AppError("Pipedream is not set up.", 409, {
      code: "pipedream_not_configured",
    });
    const wrapped = upstreamError("upstream broke", original);
    expect(wrapped).toBe(original);
  });
});

describe("registerErrorHandler", () => {
  it("includes the AppError code in the envelope, and omits it otherwise", async () => {
    const app = Fastify();
    registerErrorHandler(app);
    app.get("/coded", () => {
      throw new AppError("Pipedream is not set up.", 409, { code: "pipedream_not_configured" });
    });
    app.get("/plain", () => {
      throw new AppError("nope", 400);
    });

    const coded = await app.inject({ method: "GET", url: "/coded" });
    expect(coded.statusCode).toBe(409);
    expect(coded.json()).toMatchObject({
      error: "Pipedream is not set up.",
      code: "pipedream_not_configured",
    });

    const plain = await app.inject({ method: "GET", url: "/plain" });
    expect(plain.statusCode).toBe(400);
    expect(plain.json()).not.toHaveProperty("code");

    await app.close();
  });
});
