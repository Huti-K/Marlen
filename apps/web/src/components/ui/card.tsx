import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

// The shared elevated container. Wraps `.surface` (index.css) with a standard
// padding scale so call sites stop picking their own. Floating panels paint
// `.surface-pop` directly — they are anchored one-offs, not cards.
const cardVariants = cva("surface", {
  variants: {
    padding: {
      sm: "p-3",
      md: "p-4",
      lg: "p-5",
    },
  },
  defaultVariants: {
    padding: "md",
  },
});

export interface CardProps
  extends React.HTMLAttributes<HTMLElement>,
    VariantProps<typeof cardVariants> {
  as?: React.ElementType;
}

export function Card({ className, padding, as: Comp = "div", ...props }: CardProps) {
  return <Comp className={cn(cardVariants({ padding }), className)} {...props} />;
}
