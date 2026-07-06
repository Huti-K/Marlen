# Trailin — local email agent

A locally-run AI email agent for **Gmail and Outlook**, built on:

- **[pi](https://github.com/badlogic/pi-mono)** (`@earendil-works/pi-agent-core` + `@earendil-works/pi-ai`) — the agent loop and LLM layer
- **Pipedream Connect + MCP** — managed OAuth for Google/Microsoft; the agent's email tools come from Pipedream's remote MCP server
- **Fastify** API server with **SQLite** (Drizzle) persistence and a **node-cron** automation scheduler
- **Vite + React + shadcn-style UI** (Tailwind v4)

```
apps/
  server/   Fastify API: chat (SSE), Pipedream Connect, automations + scheduler
  web/      Vite/React UI: Chat, Connections, Automations tabs
packages/
  shared/   Types shared between server and web
```

## Setup

1. **Install** (Node 20+, pnpm):

   ```sh
   pnpm install
   ```

2. **Configure** — copy `.env.example` to `.env` and fill in:

   - `ANTHROPIC_API_KEY` — from https://platform.claude.com (any provider pi-ai supports works; set `AGENT_PROVIDER`/`AGENT_MODEL` accordingly)
   - Pipedream Connect credentials: create a project at https://pipedream.com/projects, open **Connect**, and copy the **Client ID**, **Client Secret** and **Project ID**. Keep `PIPEDREAM_ENVIRONMENT=development` while testing.

3. **Run** (starts server on :3001 and web on :5173):

   ```sh
   pnpm dev
   ```

4. Open http://localhost:5173 → **Connections** tab → *Connect Gmail* / *Connect Outlook*. The OAuth flow runs on a Pipedream-hosted page; afterwards the agent can use that account's tools.

## Hosted / single-process mode

`pnpm build` builds the web app; when `apps/web/dist` exists, the server serves it itself:

```sh
pnpm build
pnpm start   # everything on http://localhost:3001
```

## How it works

- Each chat conversation gets its own **pi Agent**. On creation, the server connects to Pipedream's remote MCP server (`https://remote.mcp.pipedream.net/v3`) once per app slug (`gmail`, `microsoft_outlook`), lists the tools, and bridges them into pi `AgentTool`s. Tool calls are executed over MCP; auth is injected by Pipedream.
- **Automations** are cron-scheduled standing instructions ("summarize unread mail every weekday at 8am"). Each run spins up a fresh agent, executes the instruction, and stores the result in SQLite (visible under *Recent runs*).
- Conversation transcripts and automations live in `data/trailin.db`. Agent context (tool-call history) is in-memory per conversation and resets on server restart.

## Current limitations (v1)

- Single user (`PIPEDREAM_EXTERNAL_USER_ID`) — fine for desktop, needs per-user ids before multi-tenant hosting.
- Automations only *run and report*; triggers (e.g. "on new email") would use Pipedream triggers/webhooks — a natural next step.
- MCP sessions are created per conversation; a very long-lived conversation may need a new conversation once the Pipedream access token expires (~1h).
