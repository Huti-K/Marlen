# Marlen — agent working rules

`CLAUDE.md` imports this file via `@AGENTS.md`.

## What

Marlen is a local-first AI email assistant shipped as a desktop app: it reads,
drafts, and organizes mail (Gmail, Outlook / Microsoft 365, anything Pipedream
connects), runs scheduled automations, and answers a chat. Single user, single
machine — the Fastify server, SQLite db, and LLM agent all run on-device; there
is no backend. That shapes the code: module-level singletons instead of DI, no
SaaS telemetry, and the public repo exists for transparency and auto-update,
not for contributions.

pnpm monorepo:

- `apps/server` — Fastify API, SQLite storage, the LLM agent (pi SDK, `@earendil-works/*`)
- `apps/web` — Vite/React SPA; the API's only client
- `apps/desktop` — Electron shell embedding server + web, GitHub-releases auto-update
- `packages/shared` — request/response and card types shared server↔web

`CONTEXT.md` is the domain glossary (conversation, turn, run, card). Modules
are named after it; when a word there and a word in the code disagree, one of
them is a bug. `apps/web/DESIGN.md` is binding for all web UI work — read it
before touching `apps/web`.

## How

- `pnpm dev` — server on :3001 + web on :5173 with reload
- `pnpm check` — lint + conventions + typecheck + tests; must pass before a change is done
- `pnpm --filter @marlen/server test` / `pnpm --filter @marlen/web test` — vitest per package
- `pnpm lint:fix` — Biome; `pnpm knip` — dead-export check (keep it green)
- pnpm only, never npm/yarn (the desktop build's internal npm install into `build/app` is the packaging exception)
- End-to-end verification: the `verify` skill (`.claude/skills/verify`) boots an isolated server + headless UI
- A second Claude session may edit this same working tree — re-check `git status` and mtimes before bulk edits

## Rules

- **Provider-generic.** Never hardcode Gmail/Outlook in features. Provider code
  lives behind the registries in `apps/server/src/email/`.
- **The db survives every update.** Every schema or data-shape change ships as
  a NEW step appended to `SCHEMA_STEPS` (`apps/server/src/db/schemaSteps.ts`);
  never edit a shipped step; keep `schema.ts` matching the end state of all
  steps. Never destroy user-authored data in a step — removing a feature does
  not license dropping its data. Copy it forward; if it truly has no home,
  stop and ask the owner.
- **No legacy paths.** Data upgrades live in migration steps, not code. Delete
  a superseded code path in the same change that migrates its data; no
  back-compat shims or fallbacks.
- **API shape.** Routes validate input with TypeBox and throw the `errors.ts`
  AppError helpers; the central handler renders `{ error, requestId }`.
  Uniform 200s, deliberately no `schema.response` declarations. Annotate
  handler return types with `@marlen/shared` types — an inline inferred
  envelope silently decouples server and web.
- **Trust boundaries.** JSON the app wrote to its own db is trusted:
  `JSON.parse(...) as T` is house style there. Parse-to-`unknown` + narrowing
  is for untrusted input only: LLM tool params/output and SDK responses.
- **Tests are few and behavioral.** Test through stable seams — a real Fastify
  app with an in-memory db, a scripted fake LLM for agent turns, provider
  fixtures — and only where a regression would actually hurt. Never write
  1:1 src-mirror unit tests or change-detectors that lock in today's
  structure, and never bend a test until it passes: a failing test means the
  code or the test is wrong — decide which. Tests live in `test/` mirroring
  the src area they cover.
- **Less code.** Prefer removing and combining over adding; reuse the ui
  primitives and lib helpers; a new abstraction needs ≥2 clean call sites.
- **Comments** describe what the code does and the invariants it protects, as
  the code is today — never development history ("used to", "now", "after the
  split") and never the instruction that prompted the change.
- **Agent tools** go through the validating `tool()` factory
  (`agent/toolkit.ts`): TypeBox params, validated on every call. Failures
  meant to steer the model return as result text (`catchToText` /
  `textResult`); real failures throw and surface as pi's error-flagged tool
  results. MCP pass-through wrappers are plain `AgentTool` literals
  (`agent/emailToolset.ts`).
- **Logging:** `moduleLogger` from `src/core/logger.ts` (pino).
- **Server layout:** `src/` top level is role-shaped (agent, core, db, email,
  integrations, routes, services, storage). Domain/business logic lives under
  `src/services/` — new rules land there (as a file, or a folder when they
  grow), never as new top-level folders.

## Direction (refactor in flight)

`REFACTOR.md` tracks the active restructure — read it before structural work.
Each slice's rules become fully true as it lands; until then, never extend the
deprecated pattern — build new code in the target shape:

- Web server-state: TanStack Query with SSE-topic-keyed invalidation. No new
  hand-rolled load/race-guard/cache loops in panels.
- Cross-panel intents: router/URL state + the chat controller. No new
  `marlenEvents` window events.
- DB access: drizzle by default; `lazyStatement` raw SQL only for FTS/virtual
  tables; never bare `sqlite.prepare`.
- Stores emit their own `emitServerEvent`; callers never do.
- The model transcript is becoming durable (tool calls + compaction summaries
  persisted per turn). Don't add code that reconstructs agent state by
  parsing prose or scraping cards.
