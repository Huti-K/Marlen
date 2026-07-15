import type {
  AgentTool,
  AgentToolResult,
  AgentToolUpdateCallback,
} from "@earendil-works/pi-agent-core";
import { type Static, type TObject, type TProperties, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { AgentCard, ConnectedAccount } from "@trailin/shared";
import { errorMessage } from "../util.js";
import { accountNameMap, resolveAccountParam, resolveRequiredAccountParam } from "./accounts.js";

/**
 * Typed factory for the app's own agent tools (MCP-wrapped tools keep raw
 * pass-through schemas via defineTool below). Parameters are
 * declared once as TypeBox properties: the JSON schema the model sees and the
 * `params` type execute receives both derive from that one declaration, so
 * they cannot drift, and every call is re-validated here — direct invocations
 * (tests, delegate workers) get the same guarantee as pi's agent loop.
 *
 * Cross-cutting parameter conventions live here, not in each tool:
 * - `account: "optional" | "required"` injects the account parameter with the
 *   canonical description, resolves it against the connected accounts, and
 *   short-circuits with the not-found guidance text so execute only ever
 *   sees a valid resolution.
 * - `catchToText` converts a thrown error into plain result text for tools
 *   whose failures should steer the model rather than fail the run.
 */

type ToolResult = AgentToolResult<AgentCard | undefined>;

/** The plain-text AgentTool result every local tool returns. */
export function textResult(value: string, card?: AgentCard) {
  return {
    content: [{ type: "text" as const, text: value }],
    details: card,
  };
}

/**
 * Identity helper for declaring a tool literal that keeps its own raw JSON
 * schema instead of going through `tool` below (MCP pass-through, one-shot
 * report tools). pi's `AgentTool["parameters"]` is typed as its typebox
 * `TSchema`, an empty interface any JSON Schema object already satisfies
 * structurally — so a tool literal passed through this function's `AgentTool`
 * parameter type needs no `as AgentTool["parameters"]` cast on its
 * `parameters` block; it's inferred from context like any other typed literal.
 */
export function defineTool(definition: AgentTool): AgentTool {
  return definition;
}

export interface ToolCtx {
  toolCallId: string;
  signal?: AbortSignal;
  /** Stream partial progress text while the tool is still running (e.g. delegate's "N/M tasks done"). */
  onUpdate?: AgentToolUpdateCallback<AgentCard | undefined>;
}

export interface AccountToolCtx extends ToolCtx {
  /** Set when the model passed an account that resolved. */
  account?: ConnectedAccount;
  /** Every connected account, regardless of what the parameter resolved to. */
  accounts: ConnectedAccount[];
  /**
   * ` [name]` label for multi-account output rows; empty when the tool call
   * is already scoped to one account, where the label would be noise.
   */
  accountTag: (accountId: string) => string;
}

export interface RequiredAccountToolCtx extends AccountToolCtx {
  account: ConnectedAccount;
}

interface ToolSpecBase<P extends TProperties> {
  name: string;
  label: string;
  description: string;
  /** Tool parameters as TypeBox properties; the factory builds the object schema. */
  params: P;
  /** Return a thrown error's message as result text instead of failing the run. */
  catchToText?: boolean;
}

const OPTIONAL_ACCOUNT_DESCRIPTION =
  "Optional: only this connected account (its email address or id).";
const REQUIRED_ACCOUNT_DESCRIPTION = "The connected account (its email address or id).";

export function tool<P extends TProperties>(
  spec: ToolSpecBase<P> & {
    account: "required";
    accountDescription?: string;
    execute: (params: Static<TObject<P>>, ctx: RequiredAccountToolCtx) => Promise<ToolResult>;
  },
): AgentTool;
export function tool<P extends TProperties>(
  spec: ToolSpecBase<P> & {
    account: "optional";
    accountDescription?: string;
    execute: (params: Static<TObject<P>>, ctx: AccountToolCtx) => Promise<ToolResult>;
  },
): AgentTool;
export function tool<P extends TProperties>(
  spec: ToolSpecBase<P> & {
    account?: undefined;
    execute: (params: Static<TObject<P>>, ctx: ToolCtx) => Promise<ToolResult>;
  },
): AgentTool;
export function tool(
  spec: ToolSpecBase<TProperties> & {
    account?: "optional" | "required";
    accountDescription?: string;
    execute: (params: never, ctx: never) => Promise<ToolResult>;
  },
): AgentTool {
  // The overloads pair each ctx shape with its account mode; inside the
  // implementation that correspondence is enforced by construction, so the
  // one widening cast here is sound.
  const execute = spec.execute as (params: unknown, ctx: unknown) => Promise<ToolResult>;
  const properties: TProperties = spec.account
    ? {
        ...spec.params,
        account:
          spec.account === "required"
            ? Type.String({ description: spec.accountDescription ?? REQUIRED_ACCOUNT_DESCRIPTION })
            : Type.Optional(
                Type.String({
                  description: spec.accountDescription ?? OPTIONAL_ACCOUNT_DESCRIPTION,
                }),
              ),
      }
    : spec.params;
  const parameters = Type.Object(properties);

  return {
    name: spec.name,
    label: spec.label,
    description: spec.description,
    parameters,
    execute: async (toolCallId, params, signal, onUpdate) => {
      if (!Value.Check(parameters, params)) {
        const issue = Value.Errors(parameters, params).First();
        return textResult(
          `Invalid ${spec.name} parameters: ` +
            `${issue ? `${issue.path || "value"} ${issue.message}` : "schema mismatch"}.`,
        );
      }

      let ctx: ToolCtx | AccountToolCtx = { toolCallId, signal, onUpdate };
      if (spec.account) {
        const raw = (params as { account?: string }).account;
        const resolved =
          spec.account === "required"
            ? await resolveRequiredAccountParam(raw)
            : await resolveAccountParam(raw);
        if (resolved.error) return textResult(resolved.error);
        const names = accountNameMap(resolved.accounts);
        ctx = {
          ...ctx,
          account: resolved.account,
          accounts: resolved.accounts,
          accountTag: (accountId: string) =>
            resolved.account ? "" : ` [${names.get(accountId) ?? accountId}]`,
        };
      }

      if (!spec.catchToText) return execute(params, ctx);
      try {
        return await execute(params, ctx);
      } catch (error) {
        return textResult(errorMessage(error));
      }
    },
  };
}

/** The optional `limit` parameter, phrased consistently across list tools. */
export function limitParam(defaultLimit: number, noun = "results") {
  return Type.Optional(Type.Number({ description: `Max ${noun} (default ${defaultLimit}).` }));
}

/** Clamp a limit parameter to [1, max], flooring fractions; default when unset. */
export function clampLimit(raw: number | undefined, defaultLimit: number, max: number): number {
  const n = raw !== undefined && Number.isFinite(raw) ? Math.floor(raw) : defaultLimit;
  return Math.min(Math.max(n, 1), max);
}

/** The optional `refresh` parameter for tools that can pull the provider feed first. */
export function refreshParam(verb: string) {
  return Type.Optional(
    Type.Boolean({
      description: `Pull the latest changes from the provider before ${verb}.`,
    }),
  );
}

export interface NumberedRow {
  /** The `N. …` line. */
  head: string;
  /** Indented detail lines; `false`/`undefined` entries are dropped. */
  body?: Array<string | false | undefined>;
}

/** The numbered-list shape every list tool prints: head lines with indented details. */
export function numberedList(rows: NumberedRow[]): string {
  return rows
    .map((row, i) =>
      [
        `${i + 1}. ${row.head}`,
        ...(row.body ?? [])
          .filter((line): line is string => line !== false && line !== undefined)
          .map((line) => `   ${line}`),
      ].join("\n"),
    )
    .join("\n");
}
