# @marlen/e2e

End-to-end tests: a real Fastify server, a real SQLite database, and a real
browser driving the built SPA.

```sh
pnpm test:e2e            # from the repo root — builds apps/web/dist, then runs
pnpm test:e2e:ui         # same, in Playwright's UI mode
pnpm --filter @marlen/e2e exec playwright install chromium   # one-time
```

Artifacts land in `test-results/` (traces, screenshots, videos) and
`playwright-report/`; both are gitignored. `pnpm --filter @marlen/e2e report`
opens the last HTML report.

## How a run is isolated

Every Playwright **worker** boots its own server (`src/server.ts`) on its own
port, with its own scratch state folder under the OS temp dir, removed on
teardown (`E2E_KEEP_STATE=1` keeps it). There is no shared `webServer`: one
server would put every worker on the same database, and a settings write in one
test would change what another sees.

Isolation matters more here than in most apps, because Marlen's defaults point
at real user data:

| Variable                  | Default                | What a run would otherwise touch                                     |
| ------------------------- | ---------------------- | -------------------------------------------------------------------- |
| `DATABASE_PATH`           | `./data/marlen.db`     | the real mail/chat/automation database                                |
| `AGENT_HOME_PATH`         | `./agent-home`         | memories, skills, knowledge documents                                 |
| `LEGACY_AGENT_HOME_PATH`  | `~/Trailin`            | **moved** into the agent home by a boot migration — a destructive read |
| `LIBRARY_PATH`            | `./data/library`       | **moved** into `knowledge/` by a boot migration                       |
| `SKILLS_PATH`             | `./data/skills`        | **moved** into `skills/` by a boot migration                          |
| `WHATSAPP_AUTH_PATH`      | `./data/whatsapp-auth` | the paired device session — connecting kicks the real server offline   |

The launcher sets all of them, and additionally runs the server with its **cwd
inside the scratch folder**, so every cwd-relative default (including the `.env`
file `process.loadEnvFile()` looks for) resolves there too. Third-party
credentials are blanked in the child environment, and `ONOFFICE_API_URL` points
at a closed port so a stray CRM call cannot leave the machine.

Belt and braces: `assertIsolated` refuses to hand a server to any test if
Pipedream reports itself configured, onOffice reports credentials, or WhatsApp
reports a linked device. A green run therefore cannot have touched a live
account.

## Writing tests

- **Never wait for `networkidle`.** The SPA holds an SSE connection open for its
  whole life, so it never settles. Wait on locators; Playwright auto-waits.
- **Select through `t()`** (`src/i18n.ts`), which reads the app's own
  `locales/*.json`. Tests then follow copy edits instead of breaking on them.
  The fixtures pin the app to German, the app's default language.
- **The setup gate is pre-dismissed** by the `context` fixture, which seeds
  `localStorage` — but only keys the page has not set itself, so a test about
  what survives a reload still tests the app.
- **Tests in one worker share a server.** Name anything you create uniquely and
  clean up after yourself; do not assume an empty database (the server seeds a
  default automation at boot).
- **Tag `@mobile`** to run a test in the phone-viewport project instead of the
  desktop one. The layout swaps below `md`: the sidebar becomes a drawer that is
  translated off-screen rather than unmounted, so assert with
  `toBeInViewport()`, not `toBeVisible()`.
- **Failing tests attach the server log** automatically (`serverLogs` fixture).

## What is out of reach

Anything behind a third-party round trip: linking a Pipedream account, pairing
WhatsApp, reading mail, and every agent turn (which needs LLM credentials). The
suite covers everything on this side of that boundary — validation, persistence,
permission grants, the host/CORS boundary — and drives what it can through the
UI (onOffice connects with a token, so its whole flow is a browser test) while
asserting the rest through the API.

Two seams exist if that ever needs to change: `ONOFFICE_API_URL` already points
the CRM client at an arbitrary host, so a local mock makes the whole onOffice
tool surface testable; a Pipedream equivalent would need a base-URL override in
`integrations/pipedream/connect.ts`.
