import type { AccountColor, EmailRef } from "@trailin/shared";
import { X } from "lucide-react";
import type * as React from "react";
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

/** The chip itself — dot + truncated label; tone and the optional trailing affordance vary per variant. */
function RefChip({
  item,
  colors,
  toneClass,
  trailing,
}: {
  item: EmailRef;
  colors?: AccountColor[];
  toneClass: string;
  trailing?: React.ReactNode;
}) {
  return (
    <span
      className={cn("flex max-w-56 items-center gap-1.5 rounded-md px-2 py-1 text-xs", toneClass)}
    >
      <AccountDot color={colorFor(item, colors)} className="shrink-0" />
      <span className="min-w-0 truncate">{refLabel(item)}</span>
      {trailing}
    </span>
  );
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
          <RefChip
            key={refKey(ref)}
            item={ref}
            colors={colors}
            toneClass="bg-secondary text-secondary-foreground"
            trailing={
              <IconButton
                onClick={() => onRemove(ref)}
                aria-label={t("chat.refs.remove", { label })}
                title={t("chat.refs.remove", { label })}
              >
                <X className="h-3 w-3" />
              </IconButton>
            }
          />
        );
      })}
    </div>
  );
}

/**
 * Read-only pinned-email chips for a sent message — same shape as `RefChips`
 * minus the remove action. Rendered on the canvas beside the bubble (not inside
 * the accent fill), so it keeps the same neutral `bg-secondary` tone the chip
 * had in the composer: a selected email reads the same before and after sending.
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
        <RefChip
          key={refKey(ref)}
          item={ref}
          colors={colors}
          toneClass="bg-secondary text-secondary-foreground"
        />
      ))}
    </div>
  );
}
