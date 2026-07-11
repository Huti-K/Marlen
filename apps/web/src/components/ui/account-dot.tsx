import { cn, UNASSIGNED_ACCOUNT_COLOR } from "@/lib/utils";

/**
 * The colored account marker — the one dot that says which connected inbox a
 * row, chip, or card line belongs to. Owns the fallback: an account with no
 * assigned color always gets the unassigned grey, never no dot and never an
 * ad-hoc tone. Resize/position via className (`h-2.5 w-2.5`, `mt-1.5`, …).
 */
export function AccountDot({ color, className }: { color?: string | null; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("h-1.5 w-1.5 shrink-0 rounded-full", className)}
      style={{ backgroundColor: color || UNASSIGNED_ACCOUNT_COLOR }}
    />
  );
}
