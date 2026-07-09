import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Pill filter chip — ink fill when active, recessed tonal fill otherwise.
 * The one shared shape for every "pick one/many of these" row: knowledge
 * filters, weekday pickers, the search palette's scope bar.
 */
export function Chip({
  active,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors",
        active ? "bg-primary text-primary-foreground" : "bg-surface-2 text-muted-foreground hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}
