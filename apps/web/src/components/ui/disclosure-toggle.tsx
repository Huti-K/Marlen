import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react";
import type * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Quiet text disclosure for list rows — chevron + label, no fill. With `open`
 * it is a two-way toggle (chevron flips, `aria-expanded` announced); without
 * it, a one-way reveal affordance (chevron stays down, no expanded state).
 */
export function DisclosureToggle({
  open,
  onToggle,
  className,
  children,
}: {
  open?: boolean;
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

/** The chevron toggle in an expandable row's trailing action cluster. */
export function ExpandButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const label = t(open ? "common.collapse" : "common.expand");
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-expanded={open}
      title={label}
      aria-label={label}
      onClick={onToggle}
    >
      <ChevronRight className={cn("transition-transform", open && "rotate-90")} />
    </Button>
  );
}

/** The reveal-more affordance under a capped list — pairs with `usePagedVisible`. */
export function ShowMoreButton({ count, onClick }: { count: number; onClick: () => void }) {
  const { t } = useTranslation();
  return <DisclosureToggle onToggle={onClick}>{t("library.showMore", { count })}</DisclosureToggle>;
}
