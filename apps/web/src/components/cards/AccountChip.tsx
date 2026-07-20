import type { CardAccount } from "@marlen/shared";
import { AccountDot } from "@/components/ui/account-dot";
import { AppIcon } from "@/components/ui/app-icon";

/**
 * App icon + account address + a color dot — the one visual anchor that
 * says which connected inbox a card's data came from, so a chat that mixes
 * multiple accounts stays legible. No pill background: cards already sit on
 * the `bg-surface-2` shell, so a same-tone chip behind this would have zero
 * contrast. `color` is the account's resolved hex (see AgentCardView),
 * never read off `account` directly.
 */
export function AccountChip({ account, color }: { account?: CardAccount; color?: string }) {
  if (!account) return null;

  return (
    <span
      className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground"
      data-tooltip={account.appName || account.app}
    >
      <AppIcon src={account.imgSrc} className="h-3.5 w-3.5" />
      <AccountDot color={color} />
      <span className="truncate">{account.name}</span>
    </span>
  );
}
