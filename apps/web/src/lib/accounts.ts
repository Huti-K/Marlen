import type { AccountColor, ConnectedAccount } from "@trailin/shared";
import { EMAIL_APPS } from "@trailin/shared";
import * as React from "react";
import { api } from "@/lib/api";

/** Whether a Pipedream app slug is one of the supported mail providers. */
export const isEmailApp = (app: string) => (EMAIL_APPS as readonly string[]).includes(app);

/** Whether a connected account is a mailbox — judged by its provider, never by
 *  whether the display name happens to contain an "@". */
export const isEmailAccount = (account: ConnectedAccount) => isEmailApp(account.app);

/** An account's assigned dot color; undefined (→ `AccountDot`'s grey) when unassigned. */
export const accountColor = (colors: AccountColor[] | undefined, accountId?: string | null) =>
  colors?.find((c) => c.accountId === accountId)?.hex;

/** An account's display name, falling back to the raw id so there's always a label. */
export const accountName = (accounts: ConnectedAccount[] | undefined, accountId?: string | null) =>
  accounts?.find((a) => a.id === accountId)?.name ?? accountId ?? "";

/**
 * Connected accounts plus their color assignments — the pair every account
 * dot, chip, and scope picker resolves from. Fetched once per mount (or once
 * `enabled` first becomes true, for lazy consumers like the search palette).
 * Cosmetic data: failures resolve to empty lists, never an error state.
 */
export function useAccountColors({ withAccounts = true, enabled = true } = {}): {
  accounts: ConnectedAccount[];
  colors: AccountColor[];
} {
  const [accounts, setAccounts] = React.useState<ConnectedAccount[]>([]);
  const [colors, setColors] = React.useState<AccountColor[]>([]);
  const fetched = React.useRef(false);

  React.useEffect(() => {
    if (!enabled || fetched.current) return;
    fetched.current = true;
    void Promise.all([
      withAccounts ? api.pipedreamAccounts().catch(() => []) : Promise.resolve([]),
      api
        .accountColors()
        .then((r) => r.colors)
        .catch(() => []),
    ]).then(([accountList, colorList]) => {
      setAccounts(accountList);
      setColors(colorList);
    });
  }, [enabled, withAccounts]);

  return { accounts, colors };
}
