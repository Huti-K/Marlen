import { expect, openApp, test } from "../src/fixtures.js";
import { t } from "../src/i18n.js";

/**
 * The shell: does a fresh install actually reach the app, and does the primary
 * navigation land on each view. This is the test that fails first when routing,
 * i18n wiring, or the static serving of the built SPA breaks.
 */

test("a fresh install opens the app and navigates between views", async ({ page }) => {
  await openApp(page);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("views.home.title"));

  for (const view of ["automations", "knowledge", "settings"] as const) {
    await page.getByRole("link", { name: t(`views.${view}.title`), exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t(`views.${view}.title`));
  }
});

test("Leads stays hidden until a CRM is connected", async ({ page, request }) => {
  await openApp(page);
  const leads = page.getByRole("link", { name: t("views.leads.title"), exact: true });
  await expect(leads).toHaveCount(0);

  await request.put("/api/onoffice", { data: { token: "e2e-token", secret: "e2e-secret" } });
  try {
    // The nav reads AppStatus, which App refreshes when the tab regains focus.
    await page.reload();
    await expect(leads).toBeVisible();
    await leads.click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("views.leads.title"));
  } finally {
    await request.delete("/api/onoffice");
  }
});

test("the theme preference survives a reload", async ({ page }) => {
  await openApp(page);
  const html = page.locator("html");
  await expect(html).not.toHaveClass(/dark/);

  await page
    .getByRole("button", { name: t("sidebar.darkMode") })
    .first()
    .click();
  await expect(html).toHaveClass(/dark/);

  await page.reload();
  await expect(html).toHaveClass(/dark/);
});

test("@mobile the navigation is a drawer on a phone", async ({ page }) => {
  await page.goto("/");
  const home = page.getByRole("link", { name: t("views.home.title"), exact: true });
  // The sidebar is rendered but translated off-screen, so it is "visible" to
  // the DOM and only the viewport check distinguishes the two states.
  await expect(home).not.toBeInViewport();

  await page
    .getByRole("button", { name: t("app.openMenu") })
    .first()
    .click();
  await expect(home).toBeInViewport();
});
