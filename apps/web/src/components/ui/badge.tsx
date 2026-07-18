import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

// Pill status chips: pale tonal fill + readable text tone, no border.
// Icons are sized here — callers pass a bare icon element. The exported
// variants let an interactive element (e.g. a button) wear the same pill.
export const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium [&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "tint-accent",
        muted: "tint-neutral",
        success: "tint-success",
        warning: "tint-warning",
        destructive: "tint-danger",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
