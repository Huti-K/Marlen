import { cn, UNASSIGNED_ACCOUNT_COLOR } from "@/lib/utils";

/**
 * The one round dot marker. Default form is the colored account marker — the
 * dot that says which connected inbox a row, chip, or card line belongs to —
 * and it owns the fallback: an account with no assigned color always gets the
 * unassigned grey, never no dot and never an ad-hoc tone. The `tone` variants
 * cover the non-account scopes (theme-aware ink, pale accent) so no caller
 * hand-mixes a dot fill. Resize/position via className (`h-2.5 w-2.5`, …).
 */
export function AccountDot({
  color,
  tone,
  className,
}: {
  color?: string | null;
  /** Theme-tone fill instead of an account color: `ink` (foreground) or `accent`. */
  tone?: "ink" | "accent";
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "h-1.5 w-1.5 shrink-0 rounded-full",
        tone === "ink" && "bg-foreground/80",
        tone === "accent" && "bg-accent/60",
        className,
      )}
      style={tone ? undefined : { backgroundColor: color || UNASSIGNED_ACCOUNT_COLOR }}
    />
  );
}
