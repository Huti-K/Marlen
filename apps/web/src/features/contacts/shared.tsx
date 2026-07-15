import type { ContactCategory } from "@trailin/shared";
import type { useTranslation } from "react-i18next";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Small pieces shared by the People and Newsletters lanes (ContactsPanel.tsx)
 * — kept here rather than duplicated in both, since neither lane is large
 * enough on its own to justify its own copy.
 */

/** Rows shown before a lane's list asks to be expanded, and how many each press adds. */
export const LANE_INITIAL_VISIBLE = 30;
export const LANE_VISIBLE_STEP = 60;

/** Below this a lane's search field is chrome — the whole list already fits on screen. */
export const LANE_SEARCH_THRESHOLD = 8;

/** Cap the cascade so a full page of rows doesn't take a second to finish arriving. */
export const stagger = (i: number) => ({ animationDelay: `${Math.min(i, 8) * 45}ms` });

/** The lanes' first-load placeholder — one skeleton per above-the-fold row. */
export function LaneSkeletons() {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-16 w-full rounded-lg" />
      ))}
    </div>
  );
}

/** `contacts.category.<value>` — the one place a category enum value becomes display text. */
export function categoryLabel(
  t: ReturnType<typeof useTranslation>["t"],
  category: ContactCategory,
): string {
  return t(`contacts.category.${category}`);
}

/**
 * Neutral initial avatar for a contact or sender row. Contacts span
 * connected accounts, so — unlike AccountDot — no single account color
 * applies; a plain recessed circle with the name's first letter stands in.
 */
export function ContactAvatar({ label, className }: { label: string; className?: string }) {
  const initial = label.trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      aria-hidden
      className={cn(
        "grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-sm font-medium text-muted-foreground",
        className,
      )}
    >
      {initial}
    </span>
  );
}
