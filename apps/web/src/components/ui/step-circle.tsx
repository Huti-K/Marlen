import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Tiny numbered circle fronting a setup/guide step — pass the step number,
 * or a Check glyph once the step is done (with the success tone).
 */
export function StepCircle({
  tone = "tint-neutral",
  className,
  children,
}: {
  tone?: "tint-neutral" | "tint-success" | "tint-accent";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-2xs font-semibold tabular-nums",
        tone,
        className,
      )}
    >
      {children}
    </span>
  );
}
