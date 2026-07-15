import type { CardAccount } from "@trailin/shared";
import type { LucideIcon } from "lucide-react";
import type * as React from "react";
import { useTranslation } from "react-i18next";
import { AccountChip } from "./AccountChip";

/**
 * Shared frame for agent cards. Cards are the agent's work products, so they
 * read as discrete blocks in the chat stream: a `surface` panel carrying a
 * hairline outline (`border-border`) — the one place the app outlines a shape,
 * a documented exception in DESIGN.md — so a card stands apart from the white
 * chat rail and from adjacent cards without a heavier grey wrapper around it.
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
    <div className="surface overflow-hidden border-2 border-border">
      <div className="flex flex-col gap-1 px-4 pb-2.5 pt-3.5">
        <div className="flex items-center justify-between gap-3">
          <span className="flex shrink-0 items-center gap-1.5 font-mono text-3xs uppercase tracking-[0.12em] text-muted-foreground">
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

/**
 * Literal email body text. Never markdown: bodies are foreign content, and
 * rendering their syntax would restyle what the sender actually wrote.
 */
export function CardBodyText({ text }: { text?: string | null }) {
  const { t } = useTranslation();
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed">
      {text || t("chat.cards.emptyBody")}
    </p>
  );
}
