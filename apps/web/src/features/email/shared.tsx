import { Skeleton } from "@/components/ui/skeleton";

/**
 * Small pieces shared by the Email page's lanes (EmailPanel.tsx) — mirrors
 * features/contacts/shared.tsx rather than importing from it, since each
 * page tunes its own paging and skeleton heights.
 */

/** Rows shown before the inbox list asks to be expanded, and how many each press adds. */
export const LANE_INITIAL_VISIBLE = 30;
export const LANE_VISIBLE_STEP = 60;

/** How many overview rows one list fetch asks the mirror for (the route's cap). */
export const THREAD_FETCH_LIMIT = 100;

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

/** "alice@…, bob@… +3" — the inbox row's one-line participants summary. */
export function formatParticipants(participants: string[], max = 2): string {
  const names = participants.map((address) => address.split("@")[0] || address);
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} +${names.length - max}`;
}
