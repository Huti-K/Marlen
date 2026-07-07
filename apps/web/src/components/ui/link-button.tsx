import * as React from "react";
import { cn } from "@/lib/utils";

/** Underlined text-only action — advanced-mode toggles, skip links. */
export function LinkButton({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "w-fit text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline",
        className,
      )}
      {...props}
    />
  );
}
