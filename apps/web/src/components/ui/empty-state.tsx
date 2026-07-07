import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Icon-circle + title/body placeholder for empty lists — the one shape for "nothing here yet". */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  size = "default",
  className,
}: {
  icon: LucideIcon;
  title?: string;
  description: string;
  action?: React.ReactNode;
  size?: "default" | "lg";
  className?: string;
}) {
  const lg = size === "lg";
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 text-center",
        !lg && "rounded-xl bg-surface-2 py-12",
        className,
      )}
    >
      <div
        className={cn(
          "grid place-items-center rounded-xl bg-surface text-accent",
          lg ? "h-14 w-14 rounded-2xl" : "h-11 w-11",
        )}
      >
        <Icon className={lg ? "h-7 w-7" : "h-5 w-5"} />
      </div>
      <div className="flex flex-col gap-1.5">
        {title && (
          <p className={lg ? "text-base font-semibold tracking-tight" : "text-sm font-medium"}>
            {title}
          </p>
        )}
        <p
          className={cn(
            "text-pretty text-muted-foreground",
            lg ? "max-w-sm text-sm" : "max-w-xs text-xs",
          )}
        >
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}
