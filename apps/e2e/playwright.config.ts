import { defineConfig, devices } from "@playwright/test";

/**
 * Marlen end-to-end config.
 *
 * There is deliberately no `webServer` entry: one shared server would put every
 * worker on the same SQLite file, and a settings write in one test would change
 * what another sees. Instead each worker boots its own isolated instance from
 * the `server` worker fixture (src/server.ts), which also pins every state path
 * into a scratch folder so a run cannot touch the developer's real database,
 * agent home, or WhatsApp session.
 *
 * The app holds an SSE connection open for its whole life, so `networkidle`
 * never settles. Tests wait on locators, never on load state.
 */
export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",

  // Booting a server per worker costs a few seconds, so give tests room.
  timeout: 60_000,
  expect: { timeout: 10_000 },

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Each worker owns a server process; more than a handful is mostly boot cost.
  workers: process.env.CI ? 2 : 3,

  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],

  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // Marlen answers only loopback Hosts (core/hostGuard.ts); "localhost" and
    // "127.0.0.1" are both allowed, but the fixtures hand out the numeric form
    // so the Origin the browser sends matches what CORS reflects.
    actionTimeout: 15_000,
  },

  projects: [
    {
      name: "desktop",
      grepInvert: /@mobile/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      // The layout swaps below `md`: the sidebar becomes a drawer and the chat
      // a slide-over. Only tests tagged @mobile run here.
      name: "mobile",
      grep: /@mobile/,
      use: { ...devices["Pixel 7"] },
    },
  ],
});
