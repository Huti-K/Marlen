import { createHmac } from "node:crypto";
import { moduleLogger } from "../logger.js";

/**
 * Thin client for the onOffice enterprise API (a real-estate CRM: estates,
 * addresses/leads, emails, appointments, tasks, relations). onOffice is not in
 * Pipedream's catalog and authenticates with a token + secret rather than
 * OAuth, so it rides its own native path instead of the Pipedream MCP sessions
 * in agent/emailToolset.ts — this client talks to the HTTP API directly.
 *
 * Every request is a POST to a single endpoint; each action is individually
 * HMAC-signed (hmac_version 2). Each HTTP attempt runs under a hard deadline,
 * and read-only batches retry transient failures (network errors, timeouts,
 * HTTP 429/5xx) with exponential backoff — batches containing any mutating
 * action never retry, since a lost response leaves the write's fate unknown
 * and a blind retry could duplicate it.
 */

const log = moduleLogger("onoffice");

/** Hard deadline per HTTP attempt, so a hung connection can't stall a run. */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
/** Attempts for read-only batches that fail transiently. */
const MAX_READ_ATTEMPTS = 3;
/** First backoff delay; doubles per attempt. */
const RETRY_BASE_DELAY_MS = 500;

/** The six onOffice action types, mapped to their URNs. */
export const ACTION_URN = {
  read: "urn:onoffice-de-ns:smart:2.5:smartml:action:read",
  create: "urn:onoffice-de-ns:smart:2.5:smartml:action:create",
  modify: "urn:onoffice-de-ns:smart:2.5:smartml:action:modify",
  delete: "urn:onoffice-de-ns:smart:2.5:smartml:action:delete",
  get: "urn:onoffice-de-ns:smart:2.5:smartml:action:get",
  do: "urn:onoffice-de-ns:smart:2.5:smartml:action:do",
} as const;

export type ActionType = keyof typeof ACTION_URN;

/** Resolve an action shorthand ("read") or a full URN to a URN string. */
export function resolveActionId(action: string): string {
  if (action in ACTION_URN) return ACTION_URN[action as ActionType];
  return action; // already a URN
}

export interface ActionInput {
  /** Action shorthand ("read"|"create"|...) or a full actionid URN. */
  actionid: string;
  resourcetype: string;
  resourceid?: string | number;
  identifier?: string;
  parameters?: Record<string, unknown>;
}

export interface OnOfficeClientConfig {
  token: string;
  secret: string;
  /** Defaults to the "stable" endpoint. */
  apiUrl?: string;
  /** Per-attempt HTTP deadline in milliseconds. Defaults to 30s. */
  requestTimeoutMs?: number;
}

/** onOffice's monthly stable endpoint; a configured apiUrl overrides it. */
export const STABLE_URL = "https://api.onoffice.de/api/stable/api.php";

export class OnOfficeClient {
  private readonly token: string;
  private readonly secret: string;
  readonly apiUrl: string;
  private readonly requestTimeoutMs: number;

  constructor(config: OnOfficeClientConfig) {
    if (!config.token || !config.secret) {
      throw new Error("onOffice credentials missing: set a token and secret in Settings.");
    }
    this.token = config.token;
    this.secret = config.secret;
    this.apiUrl = config.apiUrl || STABLE_URL;
    this.requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  /** HMAC v2: base64(hmac_sha256(timestamp + token + resourcetype + actionid, secret)). */
  private createHmac(timestamp: number, resourcetype: string, actionId: string): string {
    const message = `${timestamp}${this.token}${resourcetype}${actionId}`;
    return createHmac("sha256", this.secret).update(message).digest("base64");
  }

  private buildAction(action: ActionInput): Record<string, unknown> {
    const actionId = resolveActionId(action.actionid);
    const resourcetype = action.resourcetype ?? "";
    const timestamp = Math.floor(Date.now() / 1000);
    return {
      actionid: actionId,
      resourceid: action.resourceid ?? "",
      identifier: action.identifier ?? "",
      resourcetype,
      timestamp,
      hmac: this.createHmac(timestamp, resourcetype, actionId),
      hmac_version: "2",
      parameters: action.parameters ?? {},
    };
  }

  /**
   * Send one or more actions in a single request. Returns the parsed response.
   * Read-only batches retry transient failures; anything mutating gets exactly
   * one attempt.
   */
  async call(
    actions: ActionInput | ActionInput[],
    signal?: AbortSignal,
  ): Promise<OnOfficeResponse> {
    const list = Array.isArray(actions) ? actions : [actions];
    const readOnly = list.every((a) => {
      const urn = resolveActionId(a.actionid);
      return urn === ACTION_URN.read || urn === ACTION_URN.get;
    });
    const maxAttempts = readOnly ? MAX_READ_ATTEMPTS : 1;
    const summary = list.map((a) => `${a.actionid}:${a.resourcetype}`);

    for (let attempt = 1; ; attempt++) {
      try {
        return await this.attempt(list, signal);
      } catch (error) {
        const retryable =
          error instanceof TransientError && attempt < maxAttempts && !signal?.aborted;
        if (!retryable) {
          log.error({ err: error, actions: summary, attempt }, "onOffice request failed");
          throw error;
        }
        log.warn({ err: error, actions: summary, attempt }, "onOffice request failed, retrying");
        await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), signal);
        if (signal?.aborted) throw error;
      }
    }
  }

  /**
   * One HTTP attempt. Actions are (re)built here so every retry signs with a
   * fresh timestamp — a signature minted before a backoff pause could drift
   * outside onOffice's HMAC timestamp tolerance.
   */
  private async attempt(list: ActionInput[], signal?: AbortSignal): Promise<OnOfficeResponse> {
    const body = {
      token: this.token,
      request: { actions: list.map((a) => this.buildAction(a)) },
    };
    const deadline = AbortSignal.timeout(this.requestTimeoutMs);

    let res: Response;
    let text: string;
    try {
      res = await fetch(this.apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      });
      text = await res.text();
    } catch (error) {
      if (signal?.aborted) throw error;
      if (deadline.aborted) {
        throw new TransientError(`onOffice API request timed out after ${this.requestTimeoutMs}ms`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new TransientError(`onOffice API request failed: ${message}`, { cause: error });
    }

    let parsed: OnOfficeResponse;
    try {
      parsed = JSON.parse(text) as OnOfficeResponse;
    } catch {
      const message = `onOffice API returned non-JSON response (HTTP ${res.status}): ${text.slice(0, 500)}`;
      throw isTransientStatus(res.status) ? new TransientError(message) : new Error(message);
    }

    // Rate limits and server errors are transient even when the body is a
    // parseable envelope; other HTTP failures are checked after assertOk so an
    // envelope-level message wins over a bare status code.
    if (isTransientStatus(res.status)) {
      throw new TransientError(
        `onOffice API error (HTTP ${res.status}): ${parsed.status?.message ?? "transient failure"}`,
      );
    }
    assertOk(parsed);
    if (!res.ok) {
      throw new Error(`onOffice API error (HTTP ${res.status}): ${text.slice(0, 500)}`);
    }
    return parsed;
  }

  /** Convenience wrapper for a single action. */
  action(
    action: ActionType | string,
    resourcetype: string,
    opts: Omit<ActionInput, "actionid" | "resourcetype"> = {},
    signal?: AbortSignal,
  ): Promise<OnOfficeResponse> {
    return this.call({ actionid: action, resourcetype, ...opts }, signal);
  }
}

export interface OnOfficeActionResponse {
  actionid?: string;
  resourceid?: string;
  resourcetype?: string;
  cacheable?: boolean;
  identifier?: string;
  data?: {
    meta?: { cntabsolute?: number | null; [k: string]: unknown };
    records?: Array<{ id?: string; type?: string; elements?: Record<string, unknown> }>;
    [k: string]: unknown;
  };
  status?: { errorcode?: number; message?: string };
}

export interface OnOfficeResponse {
  status?: { code?: number; errorcode?: number; message?: string };
  response?: { results?: OnOfficeActionResponse[] };
}

/** The action results, for rendering a compact tool reply. */
export function resultsOf(resp: OnOfficeResponse): OnOfficeActionResponse[] {
  return resp.response?.results ?? [];
}

/** A failure worth retrying on a read-only batch. */
class TransientError extends Error {}

/** HTTP statuses treated as transient: rate limiting and server-side errors. */
function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Resolve after `ms`, or as soon as `signal` aborts. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    if (signal?.aborted) done();
    else signal?.addEventListener("abort", done, { once: true });
  });
}

/** Throw on transport-level (top status) or per-action errors. */
function assertOk(resp: OnOfficeResponse): void {
  const top = resp.status;
  const topFailed =
    top !== undefined &&
    ((typeof top.code === "number" && top.code >= 300) ||
      (typeof top.errorcode === "number" && top.errorcode !== 0));
  if (topFailed) {
    throw new Error(
      `onOffice API error (status ${top.code ?? "?"}${top.errorcode ? `/${top.errorcode}` : ""}): ${top.message ?? "unknown error"}`,
    );
  }
  const failed = resultsOf(resp).filter(
    (r) => r.status && typeof r.status.errorcode === "number" && r.status.errorcode !== 0,
  );
  if (failed.length > 0) {
    const msgs = failed
      .map((r) => `[${r.status?.errorcode}] ${r.status?.message ?? "error"}`)
      .join("; ");
    throw new Error(`onOffice action error: ${msgs}`);
  }
}
