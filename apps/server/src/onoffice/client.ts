import { createHmac } from "node:crypto";

/**
 * Thin client for the onOffice enterprise API (a real-estate CRM: estates,
 * addresses/leads, emails, appointments, tasks, relations). onOffice is not in
 * Pipedream's catalog and authenticates with a token + secret rather than
 * OAuth, so it rides its own native path instead of the Pipedream MCP sessions
 * in pipedream/mcp.ts — this client talks to the HTTP API directly.
 *
 * Every request is a POST to a single endpoint; each action is individually
 * HMAC-signed (hmac_version 2).
 */

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
}

/** onOffice's monthly stable endpoint. */
export const STABLE_URL = "https://api.onoffice.de/api/stable/api.php";
/** The rolling latest endpoint, opted into via config. */
export const LATEST_URL = "https://api.onoffice.de/api/latest/api.php";

export class OnOfficeClient {
  private readonly token: string;
  private readonly secret: string;
  readonly apiUrl: string;

  constructor(config: OnOfficeClientConfig) {
    if (!config.token || !config.secret) {
      throw new Error("onOffice credentials missing: set a token and secret in Settings.");
    }
    this.token = config.token;
    this.secret = config.secret;
    this.apiUrl = config.apiUrl || STABLE_URL;
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

  /** Send one or more actions in a single request. Returns the parsed response. */
  async call(
    actions: ActionInput | ActionInput[],
    signal?: AbortSignal,
  ): Promise<OnOfficeResponse> {
    const list = Array.isArray(actions) ? actions : [actions];
    const body = {
      token: this.token,
      request: { actions: list.map((a) => this.buildAction(a)) },
    };

    const res = await fetch(this.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });

    const text = await res.text();
    let parsed: OnOfficeResponse;
    try {
      parsed = JSON.parse(text) as OnOfficeResponse;
    } catch {
      throw new Error(
        `onOffice API returned non-JSON response (HTTP ${res.status}): ${text.slice(0, 500)}`,
      );
    }

    assertOk(parsed);
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

/** Throw on transport-level (top status) or per-action errors. */
function assertOk(resp: OnOfficeResponse): void {
  const top = resp.status;
  if (top && typeof top.code === "number" && top.code >= 300) {
    throw new Error(
      `onOffice API error (status ${top.code}${top.errorcode ? `/${top.errorcode}` : ""}): ${top.message ?? "unknown error"}`,
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
