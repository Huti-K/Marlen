import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// db/index.ts (pulled in transitively by pipedream/connect.ts) runs its DDL
// as an import-time side effect and resolves its path through env.ts's
// DATABASE_PATH read, also at import time — same isolation idiom as
// test/routes/chat.test.ts: point DATABASE_PATH at a fresh temp file before
// anything imports the module under test.
const tempDir = mkdtempSync(join(tmpdir(), "trailin-pipedream-connect-"));
const originalDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(tempDir, "test.db");

const { clearConnectSettings, getConnectConfig, getSavedClientSecret, saveConnectSettings } =
  await import("../../src/pipedream/connect.js");
const { readClientSecret } = await import("../../src/pipedream/secretFile.js");
const { db, schema } = await import("../../src/db/index.js");

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
});

/** Every row currently in the settings table, for asserting what did/didn't land there. */
async function allSettings(): Promise<Array<{ key: string; value: string }>> {
  return db.select().from(schema.settings);
}

describe("pipedream connect settings — client secret storage", () => {
  it("saves the secret so it round-trips through getSavedClientSecret", async () => {
    await saveConnectSettings({
      clientId: "client-abc",
      clientSecret: "top-secret-value",
      projectId: "proj_123",
      environment: "development",
    });
    await expect(getSavedClientSecret()).resolves.toBe("top-secret-value");
  });

  it("resolves the secret into getConnectConfig for the active (custom) mode", async () => {
    const config = await getConnectConfig();
    expect(config?.clientSecret).toBe("top-secret-value");
    expect(config?.clientId).toBe("client-abc");
    expect(config?.projectId).toBe("proj_123");
    expect(config?.source).toBe("settings");
  });

  it("writes the non-secret fields to the settings table", async () => {
    const rows = await allSettings();
    expect(rows.find((r) => r.key === "pipedream.clientId")?.value).toBe("client-abc");
    expect(rows.find((r) => r.key === "pipedream.projectId")?.value).toBe("proj_123");
    expect(rows.find((r) => r.key === "pipedream.environment")?.value).toBe("development");
  });

  it("never writes the client secret to the settings table, under any key or value", async () => {
    const rows = await allSettings();
    expect(rows.some((r) => r.key === "pipedream.clientSecret")).toBe(false);
    expect(rows.some((r) => r.value === "top-secret-value")).toBe(false);
  });

  it("stores the secret in the file store instead", async () => {
    await expect(readClientSecret()).resolves.toBe("top-secret-value");
  });

  it("overwrites the file (not the settings table) when credentials are re-saved", async () => {
    await saveConnectSettings({
      clientId: "client-abc",
      clientSecret: "rotated-secret",
      projectId: "proj_123",
      environment: "development",
    });
    await expect(getSavedClientSecret()).resolves.toBe("rotated-secret");
    const rows = await allSettings();
    expect(rows.some((r) => r.value === "rotated-secret")).toBe(false);
  });

  it("clearConnectSettings removes both the settings rows and the secret file", async () => {
    await clearConnectSettings();
    await expect(getSavedClientSecret()).resolves.toBeUndefined();
    await expect(readClientSecret()).resolves.toBeUndefined();
    const rows = await allSettings();
    expect(rows.some((r) => r.key.startsWith("pipedream."))).toBe(false);
  });
});
