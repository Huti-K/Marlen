import type * as React from "react";
import { cn } from "@/lib/utils";

/** A single settings/account row — icon or label at left, status/actions at right. */
export function ListRow({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3.5 py-3",
        className,
      )}
      {...props}
    />
  );
}
