import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AccountSignature } from "@marlen/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Two things the settings layer has to get right, because both fail silently:
 * the whole-table read cache must survive concurrent writers, and a saved
 * signature must not carry anything that runs. The signature is the only
 * user-authored HTML the app stores and later renders in its own origin.
 */

let settings: typeof import("../../src/db/settings.js");
let app: Awaited<ReturnType<typeof import("../../src/app.js").buildApp>>;

beforeAll(async () => {
  const scratch = await mkdtemp(join(tmpdir(), "marlen-settings-test-"));
  process.env.AGENT_HOME_PATH = join(scratch, "Marlen");
  process.env.DATABASE_PATH = join(scratch, "test.db");
  settings = await import("../../src/db/settings.js");
  app = await (await import("../../src/app.js")).buildApp();
});

afterAll(async () => {
  await app?.close();
});

async function saveSignature(html: string): Promise<string> {
  const res = await app.inject({
    method: "PUT",
    url: "/api/settings/account-signatures",
    payload: { signatures: [{ accountId: "acc-1", html }] },
  });
  expect(res.statusCode).toBe(200);
  return res.json<{ signatures: AccountSignature[] }>().signatures[0]?.html ?? "";
}

describe("settings", () => {
  it("keeps every key when writes race the first read of the cache", async () => {
    // Both writes reach an unpopulated cache, so both trigger a load. Sharing
    // that load is what keeps them in the same Map; without it one write lands
    // in an orphaned copy and reads back as undefined for the process's life.
    await Promise.all([
      settings.setSetting("e2e.first", "one"),
      settings.setSetting("e2e.second", "two"),
      settings.setSetting("e2e.third", "three"),
    ]);

    expect(await settings.getSetting("e2e.first")).toBe("one");
    expect(await settings.getSetting("e2e.second")).toBe("two");
    expect(await settings.getSetting("e2e.third")).toBe("three");
  });

  it("keeps a pasted signature's formatting", async () => {
    const pasted =
      '<table><tr><td style="color:#333">Max Mustermann<br>' +
      '<a href="https://example.com">example.com</a></td></tr></table>';
    const saved = await saveSignature(pasted);
    expect(saved).toContain("Max Mustermann");
    expect(saved).toContain('style="color:#333"');
    expect(saved).toContain('href="https://example.com"');
  });

  it("strips everything executable from a signature", async () => {
    const saved = await saveSignature(
      [
        "<p>Max Mustermann</p>",
        "<script>fetch('/api/backup')</script>",
        "<script src='https://evil.example/x.js'>",
        '<img src="x" onerror="alert(1)">',
        "<svg/onload=alert(1)>",
        "<a href=javascript:alert(1)>klick</a>",
        '<a href="&#106;avascript:alert(1)">klick</a>',
        '<a href="java&#09;script:alert(1)">klick</a>',
        '<iframe src="https://evil.example"></iframe>',
        '<meta http-equiv="refresh" content="0;url=https://evil.example">',
      ].join(""),
    );

    expect(saved).toContain("Max Mustermann");
    for (const forbidden of ["<script", "onerror", "onload", "<iframe", "<meta", "evil.example"]) {
      expect(saved, `signature still carries ${forbidden}`).not.toContain(forbidden);
    }
    expect(saved.toLowerCase()).not.toContain("javascript:");
  });
});
