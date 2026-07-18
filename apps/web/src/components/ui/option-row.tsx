import type * as React from "react";
import { cn } from "@/lib/utils";

// Rest fill by surface context (see DESIGN.md's tone ladder): `recessed`
// listbox rows sit on a raised card, `ghost` rows in a floating panel,
// `bare` rows directly on a white surface.
const REST_FILL = {
  recessed: "bg-surface-2 hover:bg-secondary",
  ghost: "text-foreground hover:bg-secondary",
  bare: "hover:bg-surface-2",
} as const;

/**
 * One selectable row in a menu, picker, or choice list: optional leading mark
 * (app icon, account dot), truncated label with an optional muted detail line,
 * and a trailing slot (spinner, hover-revealed glyph — the row is a `group`).
 * `selected` wears the pale accent tint, the same "chosen" mark as Select.
 */
export function OptionRow({
  icon,
  label,
  detail,
  trailing,
  selected,
  fill = "ghost",
  className,
  ...props
}: {
  icon?: React.ReactNode;
  label: React.ReactNode;
  detail?: React.ReactNode;
  trailing?: React.ReactNode;
  selected?: boolean;
  fill?: keyof typeof REST_FILL;
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "group flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors disabled:opacity-50",
        selected ? "bg-accent/10 text-accent" : REST_FILL[fill],
        className,
      )}
      {...props}
    >
      {icon}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="min-w-0 truncate text-sm font-medium">{label}</span>
        {detail && <span className="min-w-0 truncate text-xs text-muted-foreground">{detail}</span>}
      </span>
      {trailing}
    </button>
  );
}
