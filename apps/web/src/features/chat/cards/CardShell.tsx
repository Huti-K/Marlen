import type * as React from "react";
import type { LucideIcon } from "lucide-react";
import type { CardAccount } from "@trailin/shared";
import { AccountChip } from "./AccountChip";

/**
 * Shared frame for agent cards. Cards are the agent's work products, so they
 * are the one elevated block in the chat stream (`surface-soft`) while speech
 * bubbles stay recessed — depth by tone, per DESIGN.md, never by lines.
 *
 * The mono uppercase eyebrow is the cards' signature: a specimen label naming
 * what the agent did (search, thread, draft) plus its scope, set in the data
 * face so it reads as machine output, not prose.
 */
export function CardShell({
  icon: Icon,
  label,
  meta,
  title,
  account,
  color,
  action,
  children,
}: {
  icon: LucideIcon;
  label: string;
  /** Scope readout next to the label, e.g. "3 results" — rendered as mono data. */
  meta?: string;
  title?: string;
  account?: CardAccount;
  color?: string;
  /** Optional header affordance (icon button), right-aligned after the account chip. */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="surface-soft overflow-hidden">
      <div className="flex flex-col gap-1 px-4 pb-2.5 pt-3.5">
        <div className="flex items-center justify-between gap-3">
          <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            <Icon className="h-3 w-3 shrink-0" aria-hidden />
            {label}
            {meta && (
              <>
                <span aria-hidden>·</span>
                <span className="tabular-nums">{meta}</span>
              </>
            )}
          </span>
          <div className="flex min-w-0 items-center gap-1.5">
            <AccountChip account={account} color={color} />
            {action}
          </div>
        </div>
        {title && <p className="truncate text-sm font-semibold tracking-tight">{title}</p>}
      </div>
      {children}
    </div>
  );
}
