import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Credential resolution: the saved secret file wins over the env fallback, and
 * an omitted field on save keeps the one already stored. Fake the secret file
 * (in-memory) and force the env fallback empty so the precedence is deterministic.
 */
let stored: { token: string; secret: string } | undefined;

vi.mock("../../src/onoffice/secretFile.js", () => ({
  readOnOfficeSecret: async () => stored,
  writeOnOfficeSecret: async (v: { token: string; secret: string }) => {
    stored = v;
  },
  deleteOnOfficeSecret: async () => {
    stored = undefined;
  },
}));

vi.mock("../../src/env.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/env.js")>();
  return {
    env: { ...actual.env, onoffice: { token: undefined, secret: undefined, apiUrl: undefined } },
  };
});

const { getOnOfficeConfig, getOnOfficeStatus, saveOnOfficeConfig, clearOnOfficeConfig } =
  await import("../../src/onoffice/config.js");

beforeEach(() => {
  stored = undefined;
});

describe("onOffice config", () => {
  it("reports unconfigured with no saved credentials and an empty env", async () => {
    expect(await getOnOfficeConfig()).toBeNull();
    expect(await getOnOfficeStatus()).toMatchObject({ configured: false, source: null });
  });

  it("saves a token + secret and reports the settings source", async () => {
    await saveOnOfficeConfig({ token: "tok", secret: "sec" });
    expect(stored).toEqual({ token: "tok", secret: "sec" });
    const config = await getOnOfficeConfig();
    expect(config).toMatchObject({ token: "tok", secret: "sec", source: "settings" });
    expect(await getOnOfficeStatus()).toMatchObject({ configured: true, source: "settings" });
  });

  it("keeps the saved field when the matching input is omitted", async () => {
    stored = { token: "old-tok", secret: "old-sec" };
    await saveOnOfficeConfig({ secret: "new-sec" });
    expect(stored).toEqual({ token: "old-tok", secret: "new-sec" });
  });

  it("throws when a field is still missing after the merge", async () => {
    await expect(saveOnOfficeConfig({ secret: "only-secret" })).rejects.toThrow(
      /token is required/,
    );
  });

  it("clears saved credentials", async () => {
    stored = { token: "t", secret: "s" };
    await clearOnOfficeConfig();
    expect(stored).toBeUndefined();
    expect(await getOnOfficeStatus()).toMatchObject({ configured: false });
  });
});
