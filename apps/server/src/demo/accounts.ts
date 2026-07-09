import type { ConnectedAccount } from "@trailin/shared";

/**
 * The 3 fake Gmail accounts demo mode presents everywhere a real
 * ConnectedAccount would appear (Home, Automations, Settings → Email). Kept
 * in their own tiny module so pipedream/connect.ts (which returns these
 * instead of calling Pipedream) doesn't have to pull in the rest of the demo
 * content (digests, drafts, chats) just to list accounts.
 */

export const DEMO_PERSONAL_ACCOUNT_ID = "demo-personal";
export const DEMO_WORK_ACCOUNT_ID = "demo-work";
export const DEMO_UNI_ACCOUNT_ID = "demo-uni";

/** Days before "now" each account was connected — cosmetic, keeps them out of the future. */
const CONNECTED_DAYS_AGO: Record<string, number> = {
  [DEMO_PERSONAL_ACCOUNT_ID]: 96,
  [DEMO_WORK_ACCOUNT_ID]: 74,
  [DEMO_UNI_ACCOUNT_ID]: 210,
};

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** Computed fresh on every call so `createdAt` never drifts into the future. */
export function getDemoAccounts(): ConnectedAccount[] {
  return [
    {
      id: DEMO_PERSONAL_ACCOUNT_ID,
      app: "gmail",
      appName: "Gmail",
      name: "selin.kaya.mail@gmail.com",
      healthy: true,
      createdAt: daysAgoIso(CONNECTED_DAYS_AGO[DEMO_PERSONAL_ACCOUNT_ID]!),
    },
    {
      id: DEMO_WORK_ACCOUNT_ID,
      app: "gmail",
      appName: "Gmail",
      name: "selin@nordwind-studio.de",
      healthy: true,
      createdAt: daysAgoIso(CONNECTED_DAYS_AGO[DEMO_WORK_ACCOUNT_ID]!),
    },
    {
      id: DEMO_UNI_ACCOUNT_ID,
      app: "gmail",
      appName: "Gmail",
      name: "s.kaya@student.tu-berlin.de",
      healthy: true,
      createdAt: daysAgoIso(CONNECTED_DAYS_AGO[DEMO_UNI_ACCOUNT_ID]!),
    },
  ];
}
