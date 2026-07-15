import type * as React from "react";
import { cn } from "@/lib/utils";

/** Tiny keyboard-hint chip — palette footer, header search trigger, shortcut lists. */
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-4.5 min-w-4.5 items-center justify-center rounded bg-surface-2 px-1 font-sans text-3xs font-medium text-muted-foreground",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
