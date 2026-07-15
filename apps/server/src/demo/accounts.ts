import type { CardAccount, ConnectedAccount } from "@trailin/shared";

/**
 * The demo persona and its two synthetic mailboxes. One consistent voice —
 * Selin Kaya, co-founder of Nordwind Studio — juggling a work inbox
 * (nordwind-studio.de) and a personal Gmail. Every demo fixture (mail,
 * enrichment, golden chats) references these two account ids, so the mailbox
 * mirror, the account chips on cards, and thread drill-downs all agree.
 *
 * These ids double as the mirror's account-key prefix: a message with
 * providerMessageId "acme-2291-2" under WORK lands at "demo-work:acme-2291-2".
 * The card's own `accountId`/`threadId` stay the bare provider ids
 * (agent/card/kinds.ts builds them that way), which is exactly what
 * getThreadDetail(providerThreadId, accountId) resolves back to the mirror.
 */

export const DEMO_WORK_ACCOUNT_ID = "demo-work";
export const DEMO_PERSONAL_ACCOUNT_ID = "demo-personal";

export const DEMO_ACCOUNT_IDS = [DEMO_WORK_ACCOUNT_ID, DEMO_PERSONAL_ACCOUNT_ID] as const;

/**
 * True for the synthetic demo mailboxes. They exist only in the local mirror
 * (the seed writes their mail directly), so the sync engine must never try to
 * pull them from a provider — there is no real Pipedream account behind these
 * ids, and a fetch would just error and back off. Read paths (mirror queries,
 * enrichment, the digest) treat them like any other account.
 */
export function isDemoAccount(accountId: string): boolean {
  return (DEMO_ACCOUNT_IDS as readonly string[]).includes(accountId);
}

/** Owner addresses — a message whose `from` is one of these is `isFromMe`. */
export const DEMO_WORK_ADDRESS = "selin@nordwind-studio.de";
export const DEMO_PERSONAL_ADDRESS = "selin.kaya.mail@gmail.com";
export const DEMO_WORK_FROM = `Selin Kaya <${DEMO_WORK_ADDRESS}>`;
export const DEMO_PERSONAL_FROM = `Selin Kaya <${DEMO_PERSONAL_ADDRESS}>`;

/** Fixed so re-seeding is idempotent and demo accounts sort before live ones. */
const DEMO_CREATED_AT = "2020-01-01T00:00:00.000Z";

const DEMO_WORK_ACCOUNT: ConnectedAccount = {
  id: DEMO_WORK_ACCOUNT_ID,
  app: "gmail",
  appName: "Gmail",
  name: DEMO_WORK_ADDRESS,
  healthy: true,
  createdAt: DEMO_CREATED_AT,
};

const DEMO_PERSONAL_ACCOUNT: ConnectedAccount = {
  id: DEMO_PERSONAL_ACCOUNT_ID,
  app: "gmail",
  appName: "Gmail",
  name: DEMO_PERSONAL_ADDRESS,
  healthy: true,
  createdAt: DEMO_CREATED_AT,
};

/** The two demo mailboxes as listAccounts() surfaces them (see connect.ts). */
export const DEMO_ACCOUNTS: ConnectedAccount[] = [DEMO_WORK_ACCOUNT, DEMO_PERSONAL_ACCOUNT];

/** The card-embedded form of an account — carried on every demo card so it renders without a live lookup. */
export function toDemoCardAccount(account: ConnectedAccount): CardAccount {
  return { accountId: account.id, name: account.name, app: account.app, appName: account.appName };
}

export const DEMO_WORK_CARD_ACCOUNT = toDemoCardAccount(DEMO_WORK_ACCOUNT);
export const DEMO_PERSONAL_CARD_ACCOUNT = toDemoCardAccount(DEMO_PERSONAL_ACCOUNT);

/**
 * Demo mode is a dev-only, env-gated overlay: when set, listAccounts() merges
 * DEMO_ACCOUNTS in alongside any real Pipedream accounts, so the seeded
 * mailboxes appear in the UI and resolve for card account-name lookups. Off by
 * default — a normal run never sees synthetic accounts.
 */
export function demoModeEnabled(): boolean {
  const value = process.env.TRAILIN_DEMO;
  return value !== undefined && value.trim() !== "" && value.trim() !== "0";
}
