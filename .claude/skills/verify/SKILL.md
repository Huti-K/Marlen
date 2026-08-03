---
name: verify
description: Build, run, and drive Marlen (server + web UI) to verify changes end-to-end.
---

# Verifying Marlen changes

## Cheapest first: unit tests

`pnpm --filter @marlen/server test` (vitest; tests in `apps/server/test/`).
Run these before spinning up a server.

Route handlers are testable without a socket: `buildApp()` from `src/app.ts`
returns the configured Fastify instance; drive it with `app.inject()`. Tests
isolate the db themselves: in `beforeAll`, point `process.env.DATABASE_PATH`
at a scratch file, then dynamically import the modules under test — `env.ts`
reads the variable at import time (any file under `test/` shows the pattern).
Always `await app.close()` in afterAll — it releases the DB handle via an
onClose hook.

## Launch an isolated server instance

The Fastify server serves the built web UI itself when `apps/web/dist` exists,
so one process gives you both the API and the SPA. Run it from a scratch
directory, not from `apps/server`: every state path the server has is
cwd-relative (including the `.env` it loads), so the cwd does most of the
isolation on its own.

```sh
pnpm --filter @marlen/web build          # ~1s; refresh dist after UI changes
mkdir -p /tmp/<scratch> && cd /tmp/<scratch>
DATABASE_PATH=./verify.db AGENT_HOME_PATH=./home \
LEGACY_AGENT_HOME_PATH=./legacy-home LIBRARY_PATH=./legacy-library SKILLS_PATH=./legacy-skills \
WHATSAPP_AUTH_PATH=./whatsapp-auth PORT=3111 \
node ~/…/Trailin/apps/server/node_modules/.bin/tsx ~/…/Trailin/apps/server/src/index.ts
```

- `DATABASE_PATH` isolates SQLite state (tables are auto-created). The user's
  real data is `apps/server/data/` — never point tests there.
- `AGENT_HOME_PATH` isolates the agent home (memory/skills/knowledge folders);
  without it the server uses the user's real `~/Trailin`.
- `LEGACY_AGENT_HOME_PATH`, `LIBRARY_PATH` and `SKILLS_PATH` are the three boot
  migrations' SOURCE folders, and they MOVE (`rename`) what they find into the
  agent home. Left at their defaults (`~/Trailin`, `./data/library`,
  `./data/skills`) a throwaway server relocates the user's real memories,
  skills and knowledge documents into the scratch home, and deleting the
  scratch dir destroys them.
- `WHATSAPP_AUTH_PATH` is NOT optional: it defaults to `./data/whatsapp-auth`
  (cwd-relative), so a verify server launched from `apps/server` would grab the
  user's real WhatsApp credentials, connect on boot, and kick the real
  server's session offline — WhatsApp allows one socket per linked device.
- Config env vars (`PIPEDREAM_*`, `ANTHROPIC_API_KEY`, …) can be set per
  instance to simulate .env fallback states; set them to the empty string to
  shadow an `apps/server/.env` entry (Node's env-file loader only fills unset
  variables). App-saved settings live in the `settings` table of the SQLite DB
  and win over env.
- Don't reuse :3001/:5173 — those may be the user's own `pnpm dev`.

`apps/e2e/src/server.ts` does all of the above already; read it rather than
re-deriving the flags.

## Drive the API

Plain curl against `http://127.0.0.1:<port>/api/...`. Useful states:
- Pipedream config: `GET/PUT/DELETE /api/pipedream` (PUT verifies credentials
  against Pipedream's real OAuth endpoint — fake creds get a 401-wrapped 400,
  so the happy save path needs real credentials).
- Seed app-saved settings directly when real creds are unavailable:
  `sqlite3 verify.db "INSERT INTO settings (key,value) VALUES ('pipedream.clientId','x'),…"`

## Drive the UI headlessly

`apps/e2e` is a Playwright suite over exactly this setup: `pnpm test:e2e` from
the repo root builds the web app and runs it. Add a spec there rather than
hand-rolling a browser session — the fixtures already boot an isolated server
per worker, dismiss the first-run setup gate, and pin the language.

`apps/e2e/README.md` has the rules that bite: never wait for `networkidle` (the
SPA holds an SSE connection open forever), select through the `t()` helper
rather than hardcoded German copy, and remember nav items are links, not
buttons.
