import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Trailing row actions revealed when the row is hovered or holds keyboard
 * focus — the surrounding row/tile must be a `group`. Always visible below
 * `sm`, where there is no hover to reveal them. Position and gap tweaks via
 * className.
 */
export function HoverActions({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-0.5 sm:opacity-0 sm:transition-opacity sm:focus-within:opacity-100 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100",
        className,
      )}
    >
      {children}
    </div>
  );
}
