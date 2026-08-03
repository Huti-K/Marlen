import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * One isolated Marlen server per Playwright worker: its own scratch state
 * folder, its own port, and an environment that cannot reach anything the
 * developer actually owns.
 *
 * Isolation is enforced twice on purpose. The process runs with its cwd inside
 * the scratch folder, so every cwd-relative default the server has (the
 * database, `data/whatsapp-auth`, `data/library`, `data/skills`, and the `.env`
 * file `process.loadEnvFile()` looks for) lands there; and every one of those
 * paths is *also* passed explicitly, so a future default that stops being
 * cwd-relative still can't escape. `assertIsolated` then refuses to hand the
 * server to a test if any real credential survived.
 */

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "../../..");

const SERVER_ENTRY = join(repoRoot, "apps/server/src/index.ts");
const TSX_BIN = join(
  repoRoot,
  "apps/server/node_modules/.bin",
  process.platform === "win32" ? "tsx.cmd" : "tsx",
);
const WEB_DIST = join(repoRoot, "apps/web/dist");

/** Deliberately far from the dev defaults (3001 API / 5173 Vite), which may be the developer's own `pnpm dev`. */
const BASE_PORT = 3210;
const READY_TIMEOUT_MS = 90_000;
const SHUTDOWN_TIMEOUT_MS = 10_000;

export interface TestServer {
  baseURL: string;
  /** Scratch state folder (db, agent home, whatsapp auth, secret files). */
  stateDir: string;
  /** Everything the server has written to stdout/stderr so far. */
  logs: () => string;
}

/**
 * Third-party credentials the server would otherwise pick up from the real
 * environment or an `apps/server/.env`. Empty strings, not deletions: Node's
 * env-file loader only fills variables that are unset, so an empty value is
 * what actually shadows a file entry (and `env.ts` reads empty as absent).
 */
const NEUTRALIZED = [
  "PIPEDREAM_CLIENT_ID",
  "PIPEDREAM_CLIENT_SECRET",
  "PIPEDREAM_PROJECT_ID",
  "PIPEDREAM_EXTERNAL_USER_ID",
  "ONOFFICE_TOKEN",
  "ONOFFICE_SECRET",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "BRAVE_SEARCH_API_KEY",
  "LOG_FILE",
] as const;

function serverEnv(stateDir: string, port: number): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...Object.fromEntries(NEUTRALIZED.map((name) => [name, ""])),
    NODE_ENV: "test",
    PORT: String(port),
    HOST: "127.0.0.1",
    LOG_LEVEL: process.env.E2E_LOG_LEVEL ?? "warn",
    DATABASE_PATH: join(stateDir, "marlen.db"),
    AGENT_HOME_PATH: join(stateDir, "agent-home"),
    // The boot migrations MOVE the contents of these folders into the agent
    // home. Left at their defaults they would point at the developer's real
    // `~/Trailin` and `apps/server/data/*`, and a test run would silently
    // relocate their memories, skills and documents into a temp folder.
    LEGACY_AGENT_HOME_PATH: join(stateDir, "legacy-home"),
    LIBRARY_PATH: join(stateDir, "legacy-library"),
    SKILLS_PATH: join(stateDir, "legacy-skills"),
    // WhatsApp allows one socket per linked device: sharing the real auth
    // folder would connect as the developer's phone and kick their own server
    // offline.
    WHATSAPP_AUTH_PATH: join(stateDir, "whatsapp-auth"),
    // A stray CRM call can only reach a closed local port, never onOffice.
    ONOFFICE_API_URL: "http://127.0.0.1:9/onoffice-must-not-be-called",
    WEB_DIST_PATH: WEB_DIST,
  };
}

/**
 * Refuse to run against anything real. Each of these is a state the harness is
 * supposed to make impossible, so reaching one means the isolation above broke
 * rather than that the test has something to assert.
 */
async function assertIsolated(baseURL: string): Promise<void> {
  const pipedream = (await (await fetch(`${baseURL}/api/pipedream`)).json()) as {
    configured: boolean;
  };
  if (pipedream.configured) {
    throw new Error(
      "e2e refused to start: the test server picked up real Pipedream credentials. " +
        "Linking or deleting accounts from a test would hit a live project.",
    );
  }
  const onoffice = (await (await fetch(`${baseURL}/api/onoffice`)).json()) as {
    configured: boolean;
  };
  if (onoffice.configured) {
    throw new Error("e2e refused to start: the test server picked up real onOffice credentials.");
  }
  const whatsapp = (await (await fetch(`${baseURL}/api/whatsapp`)).json()) as { linked: boolean };
  if (whatsapp.linked) {
    throw new Error(
      "e2e refused to start: the test server found a linked WhatsApp account. " +
        "Connecting would take over the real device session.",
    );
  }
}

async function waitForReady(baseURL: string, child: ChildProcess, logs: () => string) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let exited = false;
  child.once("exit", () => {
    exited = true;
  });
  while (Date.now() < deadline) {
    if (exited) {
      throw new Error(`the test server exited before it was ready.\n\n${logs()}`);
    }
    try {
      const res = await fetch(`${baseURL}/api/status`);
      if (res.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`the test server did not answer within ${READY_TIMEOUT_MS}ms.\n\n${logs()}`);
}

export interface StartedServer extends TestServer {
  stop: () => Promise<void>;
}

/** Boot one isolated server for `workerIndex` and resolve once it answers. */
export async function startServer(workerIndex: number): Promise<StartedServer> {
  if (!existsSync(WEB_DIST)) {
    throw new Error(
      `${WEB_DIST} is missing — the server serves the SPA from it.\n` +
        "Run `pnpm --filter @marlen/web build` (or `pnpm test:e2e`, which builds first).",
    );
  }
  if (!existsSync(TSX_BIN)) {
    throw new Error(`${TSX_BIN} is missing — run \`pnpm install\` at the repo root.`);
  }

  const stateDir = await mkdtemp(join(tmpdir(), `marlen-e2e-w${workerIndex}-`));
  const port = BASE_PORT + workerIndex;
  const baseURL = `http://127.0.0.1:${port}`;

  const child = spawn(TSX_BIN, [SERVER_ENTRY], {
    // Every cwd-relative default the server has now resolves inside stateDir,
    // including the `.env` it tries to load.
    cwd: stateDir,
    env: serverEnv(stateDir, port),
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  const capture = (chunk: Buffer) => {
    output += chunk.toString();
    // Keep the tail only: a failing boot loop must not grow without bound.
    if (output.length > 200_000) output = output.slice(-100_000);
  };
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);
  const logs = () => output.trim() || "(no server output)";

  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>((r) => child.once("exit", () => r()));
      child.kill("SIGTERM");
      const forced = setTimeout(() => child.kill("SIGKILL"), SHUTDOWN_TIMEOUT_MS);
      await exited;
      clearTimeout(forced);
    }
    if (!process.env.E2E_KEEP_STATE) await rm(stateDir, { recursive: true, force: true });
  };

  try {
    await waitForReady(baseURL, child, logs);
    await assertIsolated(baseURL);
  } catch (error) {
    await stop();
    throw error;
  }

  return { baseURL, stateDir, logs, stop };
}
