import type { ConnectedAccount } from "@trailin/shared";
import { getWriteAccessAccounts } from "../db/settings.js";
import { listAccounts } from "../pipedream/connect.js";

/**
 * Shared account plumbing for agent tools: resolving a tool's `account`
 * parameter to a connected account, mapping accounts to their display names,
 * and the system-prompt section that tells the model what is connected.
 */

/** Case-insensitive match on a connected account's name, or an exact account id. */
export function findAccount(
  accounts: ConnectedAccount[],
  raw: string,
): ConnectedAccount | undefined {
  const trimmed = raw.trim();
  return (
    accounts.find((a) => a.id === trimmed) ??
    accounts.find((a) => a.name.toLowerCase() === trimmed.toLowerCase())
  );
}

/** Helpful "not found" text listing what's actually connected, for a bad account param. */
export function accountNotFoundText(raw: string, accounts: ConnectedAccount[]): string {
  const list =
    accounts.length > 0 ? accounts.map((a) => a.name).join(", ") : "no accounts are connected";
  return `No connected account matches "${raw}". Connected accounts: ${list}.`;
}

export interface AccountParamResolution {
  /** Set when `raw` resolved to a connected account. */
  account?: ConnectedAccount;
  /** Every connected account, regardless of what `raw` resolved to. */
  accounts: ConnectedAccount[];
  /** Set when `raw` was given but didn't match any connected account. */
  error?: string;
}

/**
 * Resolve a tool's optional `account` parameter: unset (or blank) means "every
 * account" (the caller gets `accounts` back with no `account` and no error), a
 * name or id resolves to that one account, and anything else that doesn't
 * match a connected account comes back as `error` text the tool should return
 * verbatim instead of proceeding.
 */
export async function resolveAccountParam(raw: unknown): Promise<AccountParamResolution> {
  const accounts = await listAccounts();
  if (typeof raw !== "string" || raw.trim() === "") return { accounts };
  const account = findAccount(accounts, raw);
  if (!account) return { accounts, error: accountNotFoundText(raw, accounts) };
  return { account, accounts };
}

/**
 * A true discriminated union (unlike AccountParamResolution) so callers get
 * `account` narrowed to defined after checking `error` — there is no
 * "every account, no error" state to represent, since the parameter is
 * required.
 */
export type RequiredAccountResolution =
  | { account: ConnectedAccount; accounts: ConnectedAccount[]; error?: undefined }
  | { account?: undefined; accounts: ConnectedAccount[]; error: string };

/**
 * Same resolution as resolveAccountParam, but for tools whose `account`
 * parameter is required: a blank or missing value is treated as a no-match
 * (there is no "every account" fallback) and always comes back as `error`.
 */
export async function resolveRequiredAccountParam(
  raw: unknown,
): Promise<RequiredAccountResolution> {
  const accounts = await listAccounts();
  const value = typeof raw === "string" ? raw : "";
  const account = value.trim() ? findAccount(accounts, value) : undefined;
  if (!account) return { accounts, error: accountNotFoundText(value, accounts) };
  return { account, accounts };
}

/** Maps connected accounts to their display name by id, for "[account]" labels. */
export function accountNameMap(accounts: ConnectedAccount[]): Map<string, string> {
  return new Map(accounts.map((a) => [a.id, a.name]));
}

/**
 * Best-effort accountNameMap that fetches the account list itself. Falls
 * back to an empty map on any failure so a Pipedream outage never breaks the
 * caller — it just makes the caller's output less readable (raw ids instead
 * of names) rather than failing outright.
 */
export async function fetchAccountNameMap(): Promise<Map<string, string>> {
  try {
    return accountNameMap(await listAccounts());
  } catch {
    return new Map();
  }
}

/**
 * System-prompt section listing the connected accounts and whether each is
 * armed for send/change or read-only, so the model can pick the right
 * account without every tool description restating the list. Empty string
 * when nothing is connected (the prompt's setup guidance covers that case).
 */
export async function buildAccountsContext(): Promise<string> {
  let accounts: ConnectedAccount[];
  try {
    accounts = await listAccounts();
  } catch {
    return "";
  }
  if (accounts.length === 0) return "";
  const writeAccess = new Set(await getWriteAccessAccounts());
  const lines = accounts.map((account) => {
    const app = account.appName ?? account.app;
    const access = writeAccess.has(account.id) ? " — may send & change" : " — read-only";
    return `- ${account.name} (${app})${access}`;
  });
  return `\n\nConnected accounts:\n${lines.join("\n")}`;
}
