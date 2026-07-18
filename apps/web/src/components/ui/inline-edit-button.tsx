import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Text that edits in place: a button styled as the value it displays, with a
 * text cursor and the keyboard focus ring. Clicking it swaps the caller's
 * display mode for its editor. Typography and the ring's offset tone come
 * from className (`focus-visible:ring-offset-surface-2` on a recessed row).
 */
export function InlineEditButton({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "min-w-0 flex-1 cursor-text truncate rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      )}
      {...props}
    />
  );
}
