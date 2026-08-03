import { expect, test } from "../src/fixtures.js";
import { rawRequest } from "../src/rawRequest.js";

/**
 * The API's own guarantees, driven without a browser.
 *
 * Marlen has no authentication — it is a single-user app on loopback — so the
 * Host guard and the CORS origin check are the entire boundary between the
 * user's mailbox and any web page they happen to have open. These assert that
 * boundary from the outside, the way an attacking page would meet it.
 */

test("a foreign Host header is refused", async ({ server }) => {
  const rebound = await rawRequest(server.baseURL, "/api/status", { host: "attacker.example" });
  expect(rebound.status, "DNS rebinding survives the Origin check but not the Host").toBe(403);
  expect(JSON.parse(rebound.body)).toMatchObject({ error: "host not allowed" });

  const loopback = await rawRequest(server.baseURL, "/api/status", { host: "localhost:1234" });
  expect(loopback.status).toBe(200);
});

test("CORS reflects loopback origins only", async ({ server }) => {
  const evil = await rawRequest(server.baseURL, "/api/status", {
    origin: "https://attacker.example",
  });
  expect(evil.headers["access-control-allow-origin"]).toBeUndefined();

  const local = await rawRequest(server.baseURL, "/api/status", {
    origin: "http://localhost:5173",
  });
  expect(local.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
});

test("unknown API routes answer in the error envelope, not the SPA", async ({ request }) => {
  const res = await request.get("/api/does-not-exist");
  expect(res.status()).toBe(404);
  const body = (await res.json()) as { error: string; requestId: string };
  expect(body.error).toBe("not found");
  expect(body.requestId).toBeTruthy();

  // Every non-API path is the SPA's, so deep links reload instead of 404ing.
  const deepLink = await request.get("/automations");
  expect(deepLink.status()).toBe(200);
  expect(await deepLink.text()).toContain('<div id="root">');
});

test("the database backup carries no third-party secrets", async ({ request }) => {
  // Seed a credential through each store that deliberately keeps itself out of
  // the DB, then prove the backup really does exclude them.
  await request.put("/api/onoffice", {
    data: { token: "backup-probe-token", secret: "backup-probe-secret" },
  });
  try {
    const res = await request.get("/api/backup");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("application/x-sqlite3");

    const dump = (await res.body()).toString("latin1");
    expect(dump.startsWith("SQLite format 3")).toBe(true);
    expect(dump, "onOffice credentials live in a secret file, not the DB").not.toContain(
      "backup-probe-secret",
    );
    expect(dump).not.toContain("backup-probe-token");
  } finally {
    await request.delete("/api/onoffice");
  }
});
