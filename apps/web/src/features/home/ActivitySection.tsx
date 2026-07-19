import type { AccountColor, Automation, RunFeedItem } from "@trailin/shared";
import { CalendarClock, ChevronDown, ChevronUp, History, Newspaper, RefreshCw } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { AgentCardView } from "@/components/cards";
import { OpenRunInChatButton } from "@/components/OpenRunInChatButton";
import { RunStatusBadge } from "@/components/RunStatusBadge";
import { Button } from "@/components/ui/button";
import { DisclosureToggle } from "@/components/ui/disclosure-toggle";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingRow } from "@/components/ui/feedback";
import { GroupLabel } from "@/components/ui/group-label";
import { SectionTitle } from "@/components/ui/section-header";
import { findBriefingCard, RunBody } from "@/features/home/BriefingHero";
import { api } from "@/lib/api";
import { dayLabel as formatDayLabel, timeLabel as formatTimeLabel, isToday } from "@/lib/dates";
import type { View } from "@/lib/nav";
import { toast } from "@/lib/toast";
import { cn, stagger, toggleRowProps } from "@/lib/utils";

/**
 * "Aktivität" — the complete run log, the page's quiet audit trail. Collapsed
 * by default: fresh output already surfaces in the sections above, so the log
 * only unfolds on demand. Today's runs show grouped by day; older ones sit
 * behind a second disclosure.
 */
export function ActivitySection({
  runs,
  automations,
  colors,
  onNavigate,
  hasHero,
}: {
  runs: RunFeedItem[] | null;
  automations: Automation[] | null;
  colors: AccountColor[];
  onNavigate: (view: View) => void;
  /** The latest digest already leads the page as the BriefingHero — don't also auto-expand it here. */
  hasHero: boolean;
}) {
  const { t, i18n } = useTranslation();
  // Older runs stay collapsed behind this toggle; only today's ever show by
  // default so the section doesn't grow unbounded with automation history.
  const [showEarlier, setShowEarlier] = React.useState(false);
  // The whole section folds away, and starts folded — it's history.
  const [expanded, setExpanded] = React.useState(false);

  const dayLabel = (iso: string) => formatDayLabel(iso, i18n.language);
  const timeLabel = (iso: string) => formatTimeLabel(iso, i18n.language);

  const groupByDay = (list: RunFeedItem[]) => {
    const byDay = new Map<string, RunFeedItem[]>();
    for (const run of list) {
      const key = dayLabel(run.startedAt);
      byDay.set(key, [...(byDay.get(key) ?? []), run]);
    }
    return byDay;
  };

  const todayRuns = (runs ?? []).filter((r) => isToday(r.startedAt));
  const earlierRuns = (runs ?? []).filter((r) => !isToday(r.startedAt));
  // `runs` arrives newest-first from the feed, so its head is the newest run
  // — the one card expanded by default, whichever day group it lands in.
  const firstRunId = runs?.[0]?.id;

  const hasAutomations = (automations?.length ?? 0) > 0;

  const renderDayGroups = (list: RunFeedItem[]) => (
    <div className="flex flex-col gap-8">
      {[...groupByDay(list).entries()].map(([day, dayRuns]) => (
        <div key={day} className="flex flex-col gap-3">
          <GroupLabel>{day}</GroupLabel>
          <div className="flex flex-col gap-3">
            {dayRuns.map((run, i) => (
              <ActivityRunCard
                key={run.id}
                run={run}
                index={i}
                colors={colors}
                timeLabel={timeLabel}
                defaultExpanded={!hasHero && run.id === firstRunId}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <section className="flex flex-col gap-3">
      <SectionTitle
        icon={History}
        tone="tint-neutral"
        title={t("home.activityTitle")}
        count={todayRuns.length}
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
      />

      {expanded &&
        (!runs ? (
          <LoadingRow />
        ) : runs.length === 0 ? (
          <EmptyState
            icon={Newspaper}
            title={t("home.activityEmptyTitle")}
            description={
              hasAutomations ? t("home.activityNoRunsBody") : t("home.activityEmptyBody")
            }
            action={
              <Button size="sm" onClick={() => onNavigate("automations")}>
                <CalendarClock />
                {hasAutomations ? t("home.viewAutomations") : t("home.createAutomation")}
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-4">
            {todayRuns.length > 0 ? (
              renderDayGroups(todayRuns)
            ) : earlierRuns.length > 0 ? (
              <p className="text-xs text-muted-foreground">{t("home.activityNothingToday")}</p>
            ) : null}

            {earlierRuns.length > 0 && (
              <div className="flex flex-col gap-4">
                {showEarlier && renderDayGroups(earlierRuns)}
                <DisclosureToggle open={showEarlier} onToggle={() => setShowEarlier((v) => !v)}>
                  {showEarlier
                    ? t("home.showLess")
                    : t("home.activityShowEarlier", { count: earlierRuns.length })}
                </DisclosureToggle>
              </div>
            )}
          </div>
        ))}
    </section>
  );
}

function ActivityRunCard({
  run,
  index,
  colors,
  timeLabel,
  defaultExpanded = false,
  onNavigate,
}: {
  run: RunFeedItem;
  index: number;
  colors: AccountColor[];
  timeLabel: (iso: string) => string;
  defaultExpanded?: boolean;
  onNavigate: (view: View) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = React.useState(defaultExpanded);
  // A run whose turn produced a briefing card is represented by that card
  // alone — the same body the BriefingHero renders — since the prose result
  // and the raw tool cards only restate what the briefing already carries.
  const briefing = findBriefingCard(run);
  const cards = run.cards ?? [];
  const hasResult = !!run.result;
  const expandable = !!briefing || hasResult || cards.length > 0;
  const toggleExpanded = () => setExpanded(!expanded);

  // Re-run a failed automation in place. Fire-and-forget on the server (202):
  // the resulting "runs" server event reloads the feed, where the fresh run
  // appears as its own running row. Hidden for a deleted automation (null
  // automationName) — there is nothing left to run.
  const [retrying, setRetrying] = React.useState(false);
  const canRetry = run.status === "error" && run.automationName !== null;
  const retry = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setRetrying(true);
    try {
      await api.runAutomation(run.automationId);
    } catch (err) {
      toast.error(err);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="animate-in-up flex flex-col gap-3" style={stagger(index)}>
      <article className="surface surface-hover flex flex-col gap-3 rounded-lg p-4">
        <div
          className={cn("flex items-center justify-between gap-3", expandable && "cursor-pointer")}
          {...(expandable ? toggleRowProps(expanded, toggleExpanded) : {})}
        >
          <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
            <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{run.automationName ?? t("home.deletedAutomation")}</span>
            {expandable &&
              (expanded ? (
                <ChevronUp className="h-3 w-3 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
              ))}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            {canRetry && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("common.retry")}
                data-tooltip={t("common.retry")}
                disabled={retrying}
                onClick={(e) => void retry(e)}
              >
                <RefreshCw className={cn("h-3.5 w-3.5", retrying && "animate-spin")} />
              </Button>
            )}
            <OpenRunInChatButton runId={run.id} onNavigateToChat={() => onNavigate("chat")} />
            <RunStatusBadge status={run.status} />
            <span className="text-xs tabular-nums text-muted-foreground">
              {timeLabel(run.startedAt)}
            </span>
          </div>
        </div>
        {expanded && (briefing || hasResult) && (
          <RunBody run={run} colors={colors} markdownClassName="text-sm text-foreground/90" />
        )}
      </article>
      {/* Sibling blocks, never nested in the row's surface (DESIGN.md: no card-in-card). */}
      {expanded &&
        !briefing &&
        cards.map(({ toolCallId, card }) => (
          <AgentCardView key={toolCallId} card={card} colors={colors} />
        ))}
    </div>
  );
}
