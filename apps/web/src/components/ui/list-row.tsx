import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A single settings/account row — icon or label at left, status/actions at
 * right. A standalone item on the canvas, so it rises as a white `surface`;
 * grouped rows inside a card stay bare and don't use this.
 */
export function ListRow({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "surface flex items-center justify-between gap-3 rounded-lg px-3.5 py-3",
        className,
      )}
      {...props}
    />
  );
}
