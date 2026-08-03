import type { OnOfficeStatus, PipedreamStatus, WhatsAppStatus } from "@marlen/shared";
import { expect, openApp, test } from "../src/fixtures.js";
import { t } from "../src/i18n.js";

/**
 * The integration surfaces, as far as a hermetic run can reach them.
 *
 * Linking an account is by definition a round trip through Pipedream, onOffice
 * or WhatsApp, so what is tested here is everything on this side of that trip:
 * that a rejected credential never half-persists, and that the permission
 * grants — the toggles that decide whether the agent may send or write on the
 * user's behalf — actually reach the server and come back.
 */

async function openConnections(page: import("@playwright/test").Page) {
  await openApp(page, "/settings");
  await expect(
    page.getByRole("heading", { name: t("settings.sections.accounts.title"), exact: true }),
  ).toBeVisible();
}

test("a malformed Pipedream project is rejected without persisting anything", async ({
  page,
  request,
}) => {
  await openConnections(page);

  await page.getByLabel(t("connections.clientId")).fill("e2e-client-id");
  await page.getByLabel(t("connections.clientSecret")).fill("e2e-client-secret");
  // Anything without a proj_… id fails validation before any network call, so
  // this never reaches Pipedream.
  await page.getByLabel(t("connections.project")).fill("not-a-project");
  await page.getByRole("button", { name: t("connections.saveVerify") }).click();

  await expect(page.getByText(/proj_/).last()).toBeVisible();

  const status = (await (await request.get("/api/pipedream")).json()) as PipedreamStatus;
  expect(status.configured, "a rejected save leaves no credentials behind").toBe(false);
  expect(status.clientId).toBeNull();
});

test("a CRM can be connected from the UI without a Pipedream project", async ({
  page,
  request,
}) => {
  // onOffice and WhatsApp are native connections that need no Pipedream, and
  // this list is the only place they are offered.
  await openConnections(page);
  await page.getByRole("button", { name: t("connections.addAccount") }).click();
  await page.getByRole("button", { name: "onOffice" }).click();

  await page.getByLabel(t("onoffice.token")).fill("e2e-ui-token");
  await page.getByLabel(t("onoffice.secret")).fill("e2e-ui-secret");
  await page.getByRole("button", { name: t("onoffice.save"), exact: true }).click();

  try {
    // The disconnect action exists only on a connected onOffice row.
    await expect(page.getByRole("button", { name: t("onoffice.removeSaved") })).toBeVisible();
    const status = (await (await request.get("/api/onoffice")).json()) as OnOfficeStatus;
    expect(status.configured).toBe(true);
  } finally {
    await request.delete("/api/onoffice");
  }
});

test("onOffice credentials round-trip and clear again", async ({ request }) => {
  const before = (await (await request.get("/api/onoffice")).json()) as OnOfficeStatus;
  expect(before.configured).toBe(false);

  await request.put("/api/onoffice", { data: { token: "e2e-token", secret: "e2e-secret" } });
  const saved = (await (await request.get("/api/onoffice")).json()) as OnOfficeStatus;
  expect(saved.configured).toBe(true);
  expect(saved.source).toBe("settings");
  // Both CRM grants stay off until the user arms them.
  expect(saved.writeAccess).toBe(false);
  expect(saved.automationCreates).toBe(false);
  expect(JSON.stringify(saved), "the secret never leaves the server").not.toContain("e2e-secret");

  await request.put("/api/onoffice/write-access", { data: { enabled: true } });
  const armed = (await (await request.get("/api/onoffice")).json()) as OnOfficeStatus;
  expect(armed.writeAccess).toBe(true);

  await request.delete("/api/onoffice");
  const cleared = (await (await request.get("/api/onoffice")).json()) as OnOfficeStatus;
  expect(cleared.configured).toBe(false);
});

test("WhatsApp reports no link and autosend stays opt-in", async ({ request }) => {
  const status = (await (await request.get("/api/whatsapp")).json()) as WhatsAppStatus;
  expect(status.linked, "the harness must never inherit a real device session").toBe(false);
  expect(status.connection).toBe("off");
  expect(status.sendAccess, "sending is off until armed").toBe(false);
  expect(status.business.connected).toBe(false);

  await request.put("/api/whatsapp/send-access", { data: { enabled: true } });
  const armed = (await (await request.get("/api/whatsapp")).json()) as WhatsAppStatus;
  expect(armed.sendAccess).toBe(true);

  await request.put("/api/whatsapp/send-access", { data: { enabled: false } });
  const disarmed = (await (await request.get("/api/whatsapp")).json()) as WhatsAppStatus;
  expect(disarmed.sendAccess).toBe(false);
});

test("per-account grants default to read-only and survive a round trip", async ({ request }) => {
  const initial = (await (await request.get("/api/settings/permissions")).json()) as {
    permissions: unknown[];
  };
  expect(initial.permissions, "no account starts with a grant").toEqual([]);

  await request.put("/api/settings/permissions", {
    data: { permissions: [{ accountId: "e2e-account", write: false, send: true, delete: false }] },
  });
  const saved = (await (await request.get("/api/settings/permissions")).json()) as {
    permissions: { accountId: string; send: boolean }[];
  };
  expect(saved.permissions).toEqual([
    { accountId: "e2e-account", write: false, send: true, delete: false },
  ]);

  // An all-false record is dropped rather than stored: absence IS read-only.
  await request.put("/api/settings/permissions", {
    data: { permissions: [{ accountId: "e2e-account", write: false, send: false, delete: false }] },
  });
  const dropped = (await (await request.get("/api/settings/permissions")).json()) as {
    permissions: unknown[];
  };
  expect(dropped.permissions).toEqual([]);
});
