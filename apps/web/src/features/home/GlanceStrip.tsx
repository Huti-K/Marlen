import type { AccountDrafts, Automation, RunFeedItem } from "@trailin/shared";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { countUrgentItems } from "@/features/home/BriefingHero";
import { dayTimeLabel } from "@/lib/dates";

/**
 * A single quiet status line above the hero: figures worth a glance without
 * expanding anything. Each one is hidden when its source hasn't loaded yet or
 * the true count is zero — a "0" here would just be noise, and unknown reads
 * the same as zero. The whole strip renders nothing when every figure is
 * hidden, so Home never shows (then immediately hides) an empty bar.
 */
export function GlanceStrip({
  drafts,
  heroRun,
  automations,
}: {
  drafts: AccountDrafts[] | null;
  /** The hero run, for the same urgent count BriefingHero shows on its badge. */
  heroRun: RunFeedItem | null;
  automations: Automation[] | null;
}) {
  const { t, i18n } = useTranslation();

  const draftsCount = drafts?.reduce((n, a) => n + a.drafts.length, 0) ?? 0;
  const urgentCount = heroRun ? countUrgentItems(heroRun) : 0;

  const nextRunAt = React.useMemo(() => {
    let earliest: string | null = null;
    for (const a of automations ?? []) {
      if (!a.enabled || !a.nextRunAt) continue;
      if (!earliest || new Date(a.nextRunAt).getTime() < new Date(earliest).getTime()) {
        earliest = a.nextRunAt;
      }
    }
    return earliest;
  }, [automations]);

  const stats: string[] = [];
  if (draftsCount > 0) stats.push(t("home.glance.drafts", { count: draftsCount }));
  if (urgentCount > 0) stats.push(t("home.briefingUrgent", { count: urgentCount }));
  if (nextRunAt)
    stats.push(t("home.glance.nextRun", { when: dayTimeLabel(nextRunAt, i18n.language) }));

  if (stats.length === 0) return null;

  return <p className="text-xs tabular-nums text-muted-foreground">{stats.join("   ·   ")}</p>;
}
