import { ChevronDown, ChevronUp } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

/** Quiet text disclosure for list rows — chevron + label, no fill. */
export function DisclosureToggle({
  open,
  onToggle,
  className,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className={cn(
        "flex w-fit items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
        className,
      )}
    >
      {open ? (
        <ChevronUp className="h-3 w-3 shrink-0" />
      ) : (
        <ChevronDown className="h-3 w-3 shrink-0" />
      )}
      {children}
    </button>
  );
}
