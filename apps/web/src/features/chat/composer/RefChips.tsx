import type { AccountColor, EmailRef } from "@marlen/shared";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AccountDot } from "@/components/ui/account-dot";
import { IconButton } from "@/components/ui/icon-button";
import { accountColor } from "@/lib/accounts";

/** Best available label for a pinned email: subject, then sender, then the bare thread id — always something. */
function refLabel(ref: EmailRef): string {
  return ref.subject || ref.from || ref.threadId;
}

function refKey(ref: EmailRef): string {
  return `${ref.threadId}:${ref.messageId ?? ""}`;
}

/**
 * Chips for pinned emails (an @-mention pick or a card's "add to chat" action).
 * A recessed tonal fill on the composer's own `bg-surface-2`, per DESIGN.md's
 * rule that fills recess against what they sit on (`bg-secondary` routes
 * through the derived fill variables). A sent message renders the same chips
 * without `onRemove`, on the canvas beside the bubble rather than inside the
 * accent fill, so a selected email reads the same before and after sending.
 */
export function RefChips({
  refs,
  colors,
  onRemove,
}: {
  refs: EmailRef[];
  colors?: AccountColor[];
  /** Omitted for a sent message, where the pick is no longer editable. */
  onRemove?: (ref: EmailRef) => void;
}) {
  const { t } = useTranslation();
  if (refs.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {refs.map((ref) => {
        const label = refLabel(ref);
        return (
          <span
            key={refKey(ref)}
            className="flex max-w-56 items-center gap-1.5 rounded-md bg-secondary px-2 py-1 text-xs text-secondary-foreground"
          >
            <AccountDot color={accountColor(colors, ref.accountId)} className="shrink-0" />
            <span className="min-w-0 truncate">{label}</span>
            {onRemove && (
              <IconButton
                onClick={() => onRemove(ref)}
                aria-label={t("chat.refs.remove", { label })}
                title={t("chat.refs.remove", { label })}
              >
                <X className="h-3 w-3" />
              </IconButton>
            )}
          </span>
        );
      })}
    </div>
  );
}
