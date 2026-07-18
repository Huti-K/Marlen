import type { ConnectedAccount } from "@trailin/shared";
import { getAccountPermissions } from "../db/settings.js";
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
  /** Set when `raw` didn't resolve; return it verbatim instead of proceeding. */
  error?: string;
}

/**
 * Resolve a tool's `account` parameter. A name or id resolves to that one
 * account; anything that doesn't match a connected account comes back as
 * `error` text. An unset or blank value depends on the mode: "optional" means
 * "every account" (the caller gets `accounts` back with no `account` and no
 * error), "required" treats it as a no-match. In "required" mode, `account`
 * is always set when `error` isn't.
 */
export async function resolveAccountParam(
  raw: unknown,
  mode: "optional" | "required" = "optional",
): Promise<AccountParamResolution> {
  const accounts = await listAccounts();
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value === "") {
    if (mode === "optional") return { accounts };
    return { accounts, error: accountNotFoundText("", accounts) };
  }
  const account = findAccount(accounts, value);
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
 * System-prompt section listing the connected accounts and which permission
 * grants each one carries (read-only when none), so the model can pick the
 * right account without every tool description restating the list. With no
 * account connected it carries the setup guidance instead; only a failed
 * account listing (e.g. a Pipedream outage — not the same as "not set up")
 * yields an empty string.
 */
export async function buildAccountsContext(): Promise<string> {
  let accounts: ConnectedAccount[];
  try {
    accounts = await listAccounts();
  } catch {
    return "";
  }
  if (accounts.length === 0) {
    return (
      `\n\nNo email account is connected yet, so there are no email tools. When the user asks ` +
      `for anything that needs mail access, tell them to finish the email setup under ` +
      `Settings → Connect email.`
    );
  }
  const permissions = new Map((await getAccountPermissions()).map((p) => [p.accountId, p]));
  const lines = accounts.map((account) => {
    const app = account.appName ?? account.app;
    const p = permissions.get(account.id);
    const granted = [
      ...(p?.write ? ["create & change"] : []),
      ...(p?.send ? ["send"] : []),
      ...(p?.delete ? ["delete"] : []),
    ];
    const access = granted.length > 0 ? ` — may ${granted.join(", ")}` : " — read-only";
    return `- ${account.name} (${app})${access}`;
  });
  return `\n\nConnected accounts:\n${lines.join("\n")}`;
}
