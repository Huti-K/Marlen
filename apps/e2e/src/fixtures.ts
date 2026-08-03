import { test as base, expect } from "@playwright/test";
import { TEST_LANGUAGE } from "./i18n.js";
import { type StartedServer, startServer } from "./server.js";

/**
 * The e2e fixtures. Each Playwright worker boots its own isolated server
 * (src/server.ts) and every test in that worker talks to it, so workers never
 * share a database and the suite can run in parallel.
 *
 * Tests within one worker DO share their server. Anything a test creates
 * outlives it, so tests name what they create uniquely and clean up after
 * themselves rather than assuming an empty database.
 */

interface WorkerFixtures {
  server: StartedServer;
}

interface TestFixtures {
  /** Auto-fixture: attaches the server log tail to a failing test's report. */
  serverLogs: undefined;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  server: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright reads a fixture's dependencies out of this destructuring pattern and rejects a plain identifier, so "no dependencies" has to be spelled {}
    async ({}, use, workerInfo) => {
      const server = await startServer(workerInfo.workerIndex);
      await use(server);
      await server.stop();
    },
    { scope: "worker" },
  ],

  // Point every built-in that takes a base URL (page.goto, the `request`
  // fixture) at this worker's own server.
  baseURL: async ({ server }, use) => {
    await use(server.baseURL);
  },

  /**
   * The app is gated behind first-run setup until AI credentials and an email
   * account exist — neither of which a hermetic run can have. The gate is
   * dismissible and remembers that in localStorage, so seeding the same key
   * lands every test on the app itself. Language and theme are pinned in the
   * same script: both are read at first paint, so leaving them to chance would
   * make selectors and screenshots depend on the machine.
   *
   * Only keys the page hasn't set are seeded. An init script runs on EVERY
   * navigation, so overwriting unconditionally would reset the app's own state
   * on each reload — and a test about what survives a reload would be testing
   * the fixture.
   */
  context: async ({ context }, use) => {
    await context.addInitScript(
      ([language]) => {
        const defaults: Record<string, string> = {
          "marlen-setup-dismissed": "1",
          "marlen-language": language as string,
          "marlen-theme": "light",
          "marlen-sidebar-collapsed": "false",
        };
        try {
          for (const [key, value] of Object.entries(defaults)) {
            if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
          }
        } catch {
          // about:blank and other opaque origins have no storage; the next
          // real navigation runs this again.
        }
      },
      [TEST_LANGUAGE],
    );
    await use(context);
  },

  serverLogs: [
    async ({ server }, use, testInfo) => {
      await use(undefined);
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach("server.log", { body: server.logs(), contentType: "text/plain" });
      }
    },
    { auto: true },
  ],
});

export { expect };

/**
 * The app shell, ready to drive. Waits on the sidebar rather than a load
 * state: the SPA holds an SSE connection open for its whole life, so
 * `networkidle` never fires and any test that waits for it times out.
 */
export async function openApp(page: import("@playwright/test").Page, path = "/") {
  await page.goto(path);
  await expect(page.getByRole("navigation")).toBeVisible();
}
