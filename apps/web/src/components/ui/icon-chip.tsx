import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Tinted square icon tile fronting section titles and palette rows — the one
 * shape for a small icon-on-pastel mark. Icons are sized here; callers pass a
 * bare icon element.
 */
export function IconChip({
  tone = "tint-accent",
  size = "md",
  className,
  children,
}: {
  /** Always a `tint-*` token; the tone is the item's type color (see DESIGN.md). */
  tone?: "tint-accent" | "tint-neutral" | "tint-success" | "tint-warning";
  /** sm = 24px (inline SectionHeader chip), md = 28px (section titles, palette rows). */
  size?: "sm" | "md";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md",
        size === "sm" ? "h-6 w-6 [&_svg]:h-3.5 [&_svg]:w-3.5" : "h-7 w-7 [&_svg]:h-4 [&_svg]:w-4",
        tone,
        className,
      )}
    >
      {children}
    </span>
  );
}
