import * as React from "react";
import { ChevronDown, ChevronUp, MessageSquareShare, RefreshCw, Sunrise } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { RunFeedItem } from "@trailin/shared";
import type { View } from "@/lib/nav";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ErrorBanner } from "@/components/ui/feedback";
import { DigestView, parseDigest } from "@/features/automations/DigestView";
import { openRunInChat } from "@/lib/runNavigation";
import { cn, errorMessage } from "@/lib/utils";

/** Count of ⚠️-flagged items across every account section of a digest run —
 *  exported so GlanceStrip's urgent figure never drifts from this card's own
 *  badge. */
export function countUrgentItems(result: string): number {
  return parseDigest(result).accounts.reduce(
    (n, section) => n + section.items.filter((item) => item.urgent).length,
    0,
  );
}

/**
 * The flagship "Today's briefing" card — the most recent successful,
 * digest-shaped automation run (see HomePanel's heroRun selection), shown
 * expanded above the rest of the activity feed.
 */
export function BriefingHero({
  run,
  runs,
  onNavigate,
  nextRunAt,
}: {
  run: RunFeedItem;
  /** Full runs feed, used only to detect an already in-flight re-run of this automation. */
  runs?: RunFeedItem[] | null;
  onNavigate: (view: View) => void;
  /** Next scheduled run of this automation (Automation.nextRunAt), shown when this run isn't from today. */
  nextRunAt?: string | null;
}) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const urgentCount = React.useMemo(() => countUrgentItems(run.result), [run.result]);

  // Cover both "I just clicked refresh" and "a schedule/chat kicked off a run
  // for this automation elsewhere" — either way the spinner should be lit.
  const feedRunning = runs?.some(
    (r) => r.automationId === run.automationId && r.status === "running",
  );
  const isRefreshing = refreshing || !!feedRunning;

  const started = new Date(run.startedAt);
  const isToday = started.toDateString() === new Date().toDateString();
  const timeLabel = started.toLocaleTimeString(i18n.language, {
    hour: "2-digit",
    minute: "2-digit",
  });
  let metaLabel = isToday
    ? t("home.briefingToday", { time: timeLabel })
    : `${started.toLocaleDateString(i18n.language, {
        weekday: "long",
        day: "numeric",
        month: "short",
      })} · ${timeLabel}`;

  // Only surface the next scheduled run when this one isn't from today — a
  // fresh today's briefing doesn't need a "next" hint next to it.
  if (!isToday && nextRunAt) {
    const next = new Date(nextRunAt);
    const nextTime = next.toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" });
    const nextIsToday = next.toDateString() === new Date().toDateString();
    const when = nextIsToday
      ? nextTime
      : `${next.toLocaleDateString(i18n.language, { weekday: "short" })} · ${nextTime}`;
    metaLabel += ` · ${t("home.briefingNext", { when })}`;
  }

  const refresh = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isRefreshing) return;
    setError(null);
    setRefreshing(true);
    try {
      await api.runAutomation(run.automationId);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRefreshing(false);
    }
  };

  const openInChat = (e: React.MouseEvent) => {
    e.stopPropagation();
    openRunInChat(run.id, () => onNavigate("chat"));
  };

  return (
    <Card as="section" padding="lg" className="animate-in-up flex flex-col gap-3">
      <div
        className="flex items-center justify-between gap-3 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent/15 text-accent">
            <Sunrise className="h-4 w-4" />
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="flex items-center gap-2 text-base font-semibold tracking-tight">
              <span className="truncate">{run.automationName ?? t("home.deletedAutomation")}</span>
              {expanded ? (
                <ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
            </span>
            <span className="text-xs text-muted-foreground">{metaLabel}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {urgentCount > 0 && (
            <Badge variant="destructive">{t("home.briefingUrgent", { count: urgentCount })}</Badge>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            aria-label={t("home.briefingRefresh")}
            disabled={isRefreshing}
            onClick={(e) => void refresh(e)}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            title={t("home.openInChat")}
            aria-label={t("home.openInChat")}
            onClick={openInChat}
          >
            <MessageSquareShare className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {expanded && (
        <div className="mt-1 border-t border-border/40 pt-3">
          <DigestView content={run.result} automationName={run.automationName} runDate={run.startedAt} />
        </div>
      )}
    </Card>
  );
}
