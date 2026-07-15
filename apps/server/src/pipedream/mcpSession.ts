import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { ConnectedAccount } from "@trailin/shared";
import { moduleLogger } from "../logger.js";
import { type ConnectConfig, getPipedreamAccessToken } from "./connect.js";

/**
 * One account's live Pipedream MCP session: the pinned connect, per-request
 * token refresh, and the self-healing call path — every tool call is bounded
 * by a timeout, and transport-level failures reconnect the session once,
 * replaying reads but never writes. mcp.ts builds the AgentTool surface on
 * top of this; nothing here knows about tool naming or registration policy.
 */

const log = moduleLogger("mcp");

const MCP_BASE_URL = "https://remote.mcp.pipedream.net/v3";

export interface McpSession {
  client: McpClient;
  close: () => Promise<void>;
}

/**
 * StreamableHTTPClientTransport calls this for every HTTP request it makes
 * (initial SSE probe, each tool call POST, session teardown) — see its
 * `send`/`_startOrAuthSse`/`terminateSession`, which all do
 * `(this._fetch ?? fetch)(url, init)`. Injecting the Authorization header
 * here, instead of baking a snapshot into `requestInit.headers` once at
 * transport construction, is what keeps a long-lived cached MCP session
 * (agent sessions are cached upstream with an idle-refreshing TTL, so a busy
 * session can live indefinitely) authorized past the token's original expiry.
 *
 * getPipedreamAccessToken() is cheap to call per request: it resolves through
 * @pipedream/sdk's OAuthTokenProvider (core/auth/OAuthTokenProvider), which
 * caches the token in memory and only performs a network refresh once it's
 * within its own 2-minute safety buffer of expiring — so this is an in-memory
 * read almost every time, not a token fetch per tool call.
 */
const fetchWithFreshToken: FetchLike = async (url, init) => {
  const token = await getPipedreamAccessToken();
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...init, headers });
};

/**
 * Open an MCP session pinned to ONE connected account. "tools-only" mode
 * exposes tools with real structured parameters (no sub-agent indirection);
 * x-pd-account-id makes every tool act as exactly this account, which is what
 * lets several accounts of the same app coexist in one agent.
 */
export async function connectForAccount(
  account: ConnectedAccount,
  config: ConnectConfig,
): Promise<McpSession> {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_BASE_URL), {
    fetch: fetchWithFreshToken,
    requestInit: {
      headers: {
        "x-pd-project-id": config.projectId,
        "x-pd-environment": config.environment,
        "x-pd-external-user-id": config.externalUserId,
        "x-pd-app-slug": account.app,
        "x-pd-account-id": account.id,
        "x-pd-tool-mode": "tools-only",
      },
    },
  });
  const client = new McpClient({ name: "trailin-email-agent", version: "0.1.0" });
  await client.connect(transport);
  return {
    client,
    close: async () => {
      await client.close().catch(() => {});
    },
  };
}

/** Per-request ceiling on one MCP tool call; a hung call fails here instead of stalling the turn. */
const MCP_CALL_TIMEOUT_MS = 60_000;

/**
 * One account's live MCP session behind a mutable handle. Tool closures hold
 * the box, never a session directly, so a reconnect can swap the session
 * under every tool of that account at once. `closed` is set by the owning
 * toolset's close() and pins the box shut — a reconnect must never resurrect
 * connections after the toolset was disposed.
 */
export interface McpSessionBox {
  current: McpSession;
  /** In-flight reconnect shared by concurrently failing calls, so N parallel tool calls trigger one. */
  reconnecting?: Promise<void>;
  closed: boolean;
}

/** A call that outlived MCP_CALL_TIMEOUT_MS (the SDK rejects it with RequestTimeout). */
export function isMcpTimeoutError(error: unknown): boolean {
  return error instanceof McpError && error.code === ErrorCode.RequestTimeout;
}

/**
 * A failure of the transport or session itself — the connection dropped, the
 * remote end discarded the session (HTTP 404 per the MCP spec), or the
 * request never made it — as opposed to the tool running and reporting an
 * error. These are the failures a reconnect can heal; auth/config rejections
 * (401/403/…) would fail identically on a fresh session and pass through.
 */
export function isMcpTransportError(error: unknown): boolean {
  if (error instanceof McpError) return error.code === ErrorCode.ConnectionClosed;
  if (error instanceof StreamableHTTPError) {
    return error.code === undefined || error.code === 404 || error.code >= 500;
  }
  if (error instanceof Error) {
    return /fetch failed|network|socket hang up|other side closed|premature close|terminated|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE/i.test(
      error.message,
    );
  }
  return false;
}

/**
 * Replace the box's dead session with a freshly connected one. Deduped: every
 * concurrently failing call awaits the same attempt. The dead session is
 * closed best-effort, and a box whose toolset was closed refuses to reconnect
 * so disposal stays final.
 */
function reconnectSession(
  box: McpSessionBox,
  account: ConnectedAccount,
  config: ConnectConfig,
): Promise<void> {
  if (box.reconnecting) return box.reconnecting;
  const attempt = (async () => {
    if (box.closed) throw new Error(`the connection to ${account.name} was closed`);
    void box.current.close().catch(() => {});
    const fresh = await connectForAccount(account, config);
    if (box.closed) {
      // The toolset was disposed while this reconnect was in flight — don't
      // let the fresh connection outlive close().
      await fresh.close().catch(() => {});
      throw new Error(`the connection to ${account.name} was closed`);
    }
    box.current = fresh;
    log.info({ app: account.app, account: account.name }, "MCP session reconnected");
  })();
  box.reconnecting = attempt.finally(() => {
    box.reconnecting = undefined;
  });
  return box.reconnecting;
}

type McpCallResult = Awaited<ReturnType<McpClient["callTool"]>>;

/**
 * One tool call against the box's current session, bounded by
 * MCP_CALL_TIMEOUT_MS. Transport-level failures are healed in place: the
 * session is reconnected once, and a read call is replayed on the fresh
 * session; a write is never replayed — the dropped call may have taken
 * effect, so the model is told to verify instead. Timeouts and tool-level
 * errors pass through with steering text: a timeout usually means the query
 * was too broad, which is the model's fix to make, not the transport's.
 */
export async function callWithRevival(
  box: McpSessionBox,
  account: ConnectedAccount,
  config: ConnectConfig,
  toolName: string,
  args: Record<string, unknown>,
  replayable: boolean,
  signal?: AbortSignal,
): Promise<McpCallResult> {
  const call = () =>
    box.current.client.callTool({ name: toolName, arguments: args }, undefined, {
      signal,
      timeout: MCP_CALL_TIMEOUT_MS,
    });
  try {
    return await call();
  } catch (error) {
    // The turn itself was aborted (client disconnect, run deadline): nothing
    // to heal. Checked before classifying, because the SDK surfaces an
    // external abort as a RequestTimeout McpError too.
    if (signal?.aborted) throw error;
    if (isMcpTimeoutError(error)) {
      throw new Error(
        `${toolName} timed out after ${Math.round(MCP_CALL_TIMEOUT_MS / 1000)}s. Retry once with ` +
          `a narrower query (fewer results, a tighter date range); if that also fails, say ` +
          `plainly what you could not check.`,
      );
    }
    if (!isMcpTransportError(error) || box.closed) throw error;
    if (!replayable) {
      // Heal the session for whatever runs next, but never replay a write —
      // the dropped call may have gone through before the connection died.
      void reconnectSession(box, account, config).catch(() => {});
      throw new Error(
        `The connection to ${account.name} dropped during ${toolName}, so the action may or may ` +
          `not have taken effect. The connection is being restored — verify the outcome with a ` +
          `read tool before retrying.`,
      );
    }
    log.warn(
      { err: error, app: account.app, account: account.name, tool: toolName },
      "MCP call hit a transport failure, reconnecting",
    );
    await reconnectSession(box, account, config);
    return await call();
  }
}
