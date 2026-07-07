import * as React from "react";
import { cn } from "@/lib/utils";

/** Borderless icon-only affordance — dismiss/close rows. Opacity hover only, no fill (unlike Button's tonal ghost). */
export function IconButton({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn("shrink-0 opacity-70 transition-opacity hover:opacity-100", className)}
      {...props}
    />
  );
}
