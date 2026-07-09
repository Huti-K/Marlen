import * as React from "react";
import { CalendarClock, ChevronDown, ChevronUp, FileText, Mail, MessageSquareShare, Newspaper, RefreshCw, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AccountColor, AccountDrafts, Automation, RunFeedItem } from "@trailin/shared";
import type { View } from "@/components/DockNav";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { ErrorBanner, LoadingRow } from "@/components/ui/feedback";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { DraftRow } from "@/features/home/DraftRow";
import { Markdown } from "@/components/ui/markdown";
import { useServerEvents } from "@/lib/serverEvents";
import { errorMessage } from "@/lib/utils";

/** Widening windows for the "Needs your review" drafts filter; defaults to "today". */
type DraftRange = "today" | "7d" | "30d" | "all";

/** Whether a draft's timestamp falls within the selected range. Drafts with a
 * missing/unparseable date are never hidden, since we can't place them in time. */
function draftInRange(dateIso: string, range: DraftRange): boolean {
  if (range === "all" || !dateIso) return true;
  const t = new Date(dateIso).getTime();
  if (Number.isNaN(t)) return true;
  const now = Date.now();
  if (range === "today") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return t >= start.getTime();
  }
  const days = range === "7d" ? 7 : 30;
  return t >= now - days * 24 * 60 * 60 * 1000;
}

/**
 * Stale-while-revalidate cache. The Home route unmounts when you navigate away
 * (React Router swaps the route element), so without this every return to Home
 * re-fetches from scratch and flashes a spinner. Seeding state from the last
 * known data lets the page paint instantly while `load()` refreshes in the
 * background. Module-level so it survives the component's unmount/remount.
 */
const cache: {
  drafts: AccountDrafts[] | null;
  runs: RunFeedItem[] | null;
  automations: Automation[] | null;
  colors: AccountColor[];
} = { drafts: null, runs: null, automations: null, colors: [] };

/**
 * The default view: what the agent prepared for you (drafts to review) and
 * what it has been doing (automation runs), on one page.
 */
export function HomePanel({
  setupIncomplete,
  offline,
  onNavigate,
}: {
  setupIncomplete: boolean;
  /** Pipedream is configured but the last account list couldn't be fetched. */
  offline: boolean;
  onNavigate: (view: View) => void;
}) {
  const { t } = useTranslation();
  const [drafts, setDrafts] = React.useState<AccountDrafts[] | null>(cache.drafts);
  const [runs, setRuns] = React.useState<RunFeedItem[] | null>(cache.runs);
  const [automations, setAutomations] = React.useState<Automation[] | null>(cache.automations);
  const [colors, setColors] = React.useState<AccountColor[]>(cache.colors);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setError(null);
    const results = await Promise.allSettled([
      api.drafts(),
      api.runsFeed(),
      api.automations(),
      api.accountColors(),
    ]);
    const [d, r, a, c] = results;
    if (d.status === "fulfilled") setDrafts((cache.drafts = d.value));
    if (r.status === "fulfilled") setRuns((cache.runs = r.value));
    if (a.status === "fulfilled") setAutomations((cache.automations = a.value));
    if (c.status === "fulfilled") setColors((cache.colors = c.value.colors));
    const failed = results.find((x) => x.status === "rejected");
    setError(failed ? errorMessage(failed.reason) : null);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Refetch in place when the agent or an automation changes data server-side.
  useServerEvents(["runs", "drafts", "automations"], () => void load());

  // No top-level loading gate: each section renders its own <LoadingRow /> while
  // its data is null, so the fast local reads (runs/automations) paint straight
  // away instead of waiting on the slow live Gmail drafts fetch.
  return (
    <div className="flex flex-col gap-10 pt-1">


      {error && !offline && <ErrorBanner>{error}</ErrorBanner>}

      {setupIncomplete ? (
        <div className="tint-warning flex flex-wrap items-center justify-between gap-3 rounded-lg p-3.5">
          <p className="text-sm">{t("home.setupBanner")}</p>
          <Button size="sm" onClick={() => onNavigate("settings")}>
            {t("home.setupBannerCta")}
          </Button>
        </div>
      ) : (
        offline && (
          <div className="tint-warning flex items-center gap-3 rounded-lg p-3.5">
            <p className="text-sm">{t("home.offlineBanner")}</p>
          </div>
        )
      )}

      <ReviewSection drafts={drafts} colors={colors} onChanged={() => void load()} />
      <ActivitySection runs={runs} automations={automations} onNavigate={onNavigate} />
    </div>
  );
}

/* ---------------- Drafts waiting for review ---------------- */

function ReviewSection({
  drafts,
  colors,
  onChanged,
}: {
  drafts: AccountDrafts[] | null;
  colors: AccountColor[];
  onChanged: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [rowError, setRowError] = React.useState<string | null>(null);
  const [range, setRange] = React.useState<DraftRange>("today");
  const [isExpanded, setIsExpanded] = React.useState(true);

  const dateLabel = (iso: string) =>
    iso
      ? new Date(iso).toLocaleDateString(i18n.language, {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";

  const unfilteredTotal = drafts?.reduce((n, a) => n + a.drafts.length, 0) ?? 0;

  const filteredAccounts: AccountDrafts[] =
    drafts?.map((a) => ({ ...a, drafts: a.drafts.filter((d) => draftInRange(d.date, range)) })) ??
    [];
  const filteredTotal = filteredAccounts.reduce((n, a) => n + a.drafts.length, 0);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 
          className="flex items-center gap-2 text-sm font-semibold tracking-tight cursor-pointer hover:text-muted-foreground transition-colors select-none"
          onClick={() => setIsExpanded(!isExpanded)}
          title={isExpanded ? "Collapse" : "Expand"}
        >
          <FileText className="h-4 w-4 text-muted-foreground" />
          {t("home.reviewTitle")}
          {filteredTotal > 0 && <Badge variant="muted">{filteredTotal}</Badge>}
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground ml-1" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground ml-1" />
          )}
        </h2>
        {unfilteredTotal > 0 && (
          <Select
            id="draft-range"
            value={range}
            onChange={(v) => setRange(v as DraftRange)}
            aria-label={t("home.filterPeriod")}
            className="w-auto"
            options={[
              { value: "today", label: t("home.filterToday") },
              { value: "7d", label: t("home.filter7Days") },
              { value: "30d", label: t("home.filter30Days") },
              { value: "all", label: t("home.filterAll") },
            ]}
          />
        )}
      </div>

      {isExpanded && (
        <div className="flex flex-col gap-3">
          {rowError && <ErrorBanner>{rowError}</ErrorBanner>}

          {!drafts ? (
            <LoadingRow />
          ) : unfilteredTotal === 0 ? (
            <p className="rounded-lg bg-surface-2 px-3.5 py-3 text-xs text-muted-foreground">
              {t("home.reviewEmpty")}
            </p>
          ) : filteredTotal === 0 ? (
            <p className="rounded-lg bg-surface-2 px-3.5 py-3 text-xs text-muted-foreground">
              {t("home.reviewEmptyFiltered")}
            </p>
          ) : (
            <div className="flex flex-col gap-8">
              {filteredAccounts
                .filter((a) => a.drafts.length > 0 || a.error)
                .map((accountDrafts) => (
                  <div key={accountDrafts.accountId} className="flex flex-col gap-3">
                    {filteredAccounts.length > 1 && (
                      <h3 className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{
                            backgroundColor:
                              colors.find((c) => c.accountId === accountDrafts.accountId)?.hex ??
                              undefined,
                          }}
                        />
                        <Mail className="h-3.5 w-3.5" />
                        {accountDrafts.account}
                        <span className="text-muted-foreground/60">
                          · {accountDrafts.drafts.length}
                        </span>
                      </h3>
                    )}
                    {accountDrafts.error ? (
                      <ErrorBanner>{accountDrafts.error}</ErrorBanner>
                    ) : (
                      <div className="flex flex-col gap-3">
                        {accountDrafts.drafts.map((draft, i) => (
                          <div
                            key={draft.id}
                            className="animate-in-up"
                            style={{ animationDelay: `${i * 45}ms` }}
                          >
                            <DraftRow
                              accountId={accountDrafts.accountId}
                              draft={draft}
                              dateLabel={dateLabel}
                              onDeleted={onChanged}
                              onError={setRowError}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/* ---------------- What the agent has been doing ---------------- */

function ActivitySection({
  runs,
  automations,
  onNavigate,
}: {
  runs: RunFeedItem[] | null;
  automations: Automation[] | null;
  onNavigate: (view: View) => void;
}) {
  const { t, i18n } = useTranslation();

  const dayLabel = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language, {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  const timeLabel = (iso: string) =>
    new Date(iso).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" });

  const byDay = new Map<string, RunFeedItem[]>();
  for (const run of runs ?? []) {
    const key = dayLabel(run.startedAt);
    byDay.set(key, [...(byDay.get(key) ?? []), run]);
  }

  const hasAutomations = (automations?.length ?? 0) > 0;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Wrench className="h-4 w-4 text-muted-foreground" />
          {t("home.activityTitle")}
        </h2>
      </div>

      {!runs ? (
        <LoadingRow />
      ) : runs.length === 0 ? (
        <EmptyState
          icon={Newspaper}
          title={t("home.activityEmptyTitle")}
          description={hasAutomations ? t("home.activityNoRunsBody") : t("home.activityEmptyBody")}
          action={
            <Button size="sm" onClick={() => onNavigate("automations")}>
              <CalendarClock />
              {hasAutomations ? t("home.viewAutomations") : t("home.createAutomation")}
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-8">
          {[...byDay.entries()].map(([day, dayRuns], dayIndex) => (
            <div key={day} className="flex flex-col gap-3">
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground/80">
                {day}
              </h3>
              <div className="flex flex-col gap-3">
                {dayRuns.map((run, i) => (
                  <ActivityRunCard key={run.id} run={run} index={i} timeLabel={timeLabel} defaultExpanded={dayIndex === 0 && i === 0} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ActivityRunCard({
  run,
  index,
  timeLabel,
  defaultExpanded = false,
}: {
  run: RunFeedItem;
  index: number;
  timeLabel: (iso: string) => string;
  defaultExpanded?: boolean;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = React.useState(defaultExpanded);
  const hasResult = !!run.result;

  return (
    <Card
      as="article"
      className="animate-in-up flex flex-col gap-3"
      style={{ animationDelay: `${index * 45}ms` }}
    >
      <div 
        className={hasResult ? "flex items-center justify-between gap-3 cursor-pointer" : "flex items-center justify-between gap-3"}
        onClick={() => hasResult && setExpanded(!expanded)}
      >
        <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">
            {run.automationName ?? t("home.deletedAutomation")}
          </span>
          {hasResult && (
            expanded ? <ChevronUp className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          )}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            title="Go to chat"
            onClick={(e) => {
              e.stopPropagation();
              window.dispatchEvent(new CustomEvent("trailin:show-chat"));
              setTimeout(() => {
                window.dispatchEvent(new CustomEvent("trailin:open-chat", { detail: run.id }));
              }, 100);
            }}
          >
            <MessageSquareShare className="h-3 w-3" />
          </Button>
          <Badge
            variant={
              run.status === "success"
                ? "success"
                : run.status === "error"
                  ? "destructive"
                  : "muted"
            }
          >
            {t(`automations.runStatus.${run.status}`)}
          </Badge>
          <span className="text-xs tabular-nums text-muted-foreground">
            {timeLabel(run.startedAt)}
          </span>
        </div>
      </div>
      {expanded && hasResult && <Markdown content={run.result} className="text-sm border-t border-border/50 pt-2 mt-1" />}
    </Card>
  );
}
