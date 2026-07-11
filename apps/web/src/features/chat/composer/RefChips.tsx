import type { AccountColor, EmailRef } from "@trailin/shared";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AccountDot } from "@/components/ui/account-dot";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";

/** Best available label for a pinned email: subject, then sender, then the bare thread id — always something. */
function refLabel(ref: EmailRef): string {
  return ref.subject || ref.from || ref.threadId;
}

function refKey(ref: EmailRef): string {
  return `${ref.threadId}:${ref.messageId ?? ""}`;
}

function colorFor(ref: EmailRef, colors?: AccountColor[]): string | undefined {
  return colors?.find((c) => c.accountId === ref.accountId)?.hex;
}

/**
 * Removable chips for the composer's pinned emails (an @-mention pick or a
 * card's "add to chat" action) — a recessed tonal fill on the composer's own
 * `bg-surface-2`, per DESIGN.md's rule that fills recess against what they
 * sit on (`bg-secondary` here routes through the derived fill variables).
 */
export function RefChips({
  refs,
  colors,
  onRemove,
  className,
}: {
  refs: EmailRef[];
  colors?: AccountColor[];
  onRemove: (ref: EmailRef) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  if (refs.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {refs.map((ref) => {
        const label = refLabel(ref);
        return (
          <span
            key={refKey(ref)}
            className="flex max-w-56 items-center gap-1.5 rounded-md bg-secondary px-2 py-1 text-xs text-secondary-foreground"
          >
            <AccountDot color={colorFor(ref, colors)} className="shrink-0" />
            <span className="min-w-0 truncate">{label}</span>
            <IconButton
              onClick={() => onRemove(ref)}
              aria-label={t("chat.refs.remove", { label })}
              title={t("chat.refs.remove", { label })}
            >
              <X className="h-3 w-3" />
            </IconButton>
          </span>
        );
      })}
    </div>
  );
}

/**
 * Read-only pinned-email chips for a sent user bubble — same shape as
 * `RefChips` minus the remove action. Tinted off `accent-foreground` rather
 * than `bg-secondary`: it sits inside the ink/accent-filled user bubble, not
 * on the composer's `surface-2`, so the neutral tonal fill would have no
 * contrast there.
 */
export function RefChipsReadOnly({
  refs,
  colors,
  className,
}: {
  refs: EmailRef[];
  colors?: AccountColor[];
  className?: string;
}) {
  if (refs.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {refs.map((ref) => (
        <span
          key={refKey(ref)}
          className="flex max-w-56 items-center gap-1.5 rounded-md bg-accent-foreground/12 px-2 py-1 text-xs text-accent-foreground"
        >
          <AccountDot color={colorFor(ref, colors)} className="shrink-0" />
          <span className="min-w-0 truncate">{refLabel(ref)}</span>
        </span>
      ))}
    </div>
  );
}
