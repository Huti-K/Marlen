import type { Automation } from "@marlen/shared";
import { expect, openApp, test } from "../src/fixtures.js";
import { t } from "../src/i18n.js";

/**
 * Automations are the one substantial write surface a hermetic run can drive
 * end to end: they need no email account, no LLM and no third-party service.
 * This covers the whole path — form, API, SQLite, list — for a create and a
 * delete.
 */

// The worker's server is shared by its tests and seeds a default automation of
// its own, so this one is found by name rather than by position.
const NAME = `E2E Automatisierung ${Date.now()}`;

test("an automation created in the UI is persisted and can be deleted again", async ({
  page,
  request,
}) => {
  await openApp(page, "/automations");

  await page.getByRole("button", { name: t("automations.new") }).click();
  await page.getByLabel(t("automations.name")).fill(NAME);
  await page.getByLabel(t("automations.instruction")).fill("Fasse den Posteingang zusammen.");
  await page.getByRole("button", { name: t("automations.create"), exact: true }).click();

  // The row's accessible name concatenates name, schedule and instruction.
  const row = page.getByRole("button", { name: new RegExp(NAME) });
  await expect(row).toBeVisible();

  const created = (await (await request.get("/api/automations")).json()) as Automation[];
  expect(
    created.map((a) => a.name),
    "the automation reached the database",
  ).toContain(NAME);

  await row.click();
  // The edit dialog's own footer button opens a second, confirming dialog;
  // both are role=dialog, so the confirm is addressed by its title.
  await page.getByRole("button", { name: t("automations.delete"), exact: true }).click();
  await page
    .getByRole("dialog", { name: t("automations.delete") })
    .getByRole("button", { name: t("automations.delete"), exact: true })
    .click();

  await expect(row).toHaveCount(0);

  const after = (await (await request.get("/api/automations")).json()) as Automation[];
  expect(after.map((a) => a.name)).not.toContain(NAME);
});
