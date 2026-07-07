import * as React from "react";
import { CalendarClock, ChevronDown, ChevronUp, FileText, Mail, MessageSquareShare, Newspaper, RefreshCw, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AccountColor, AccountDrafts, Automation, RunFeedItem } from "@trailin/shared";
import type { View } from "@/components/Sidebar";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ErrorBanner, LoadingRow } from "@/components/ui/feedback";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { DraftRow } from "@/features/home/DraftRow";
import { Markdown } from "@/components/ui/markdown";
import { errorMessage } from "@/lib/utils";

/**
 * The default view: what the agent prepared for you (drafts to review) and
 * what it has been doing (automation runs), on one page.
 */
export function HomePanel({
  setupIncomplete,
  onNavigate,
}: {
  setupIncomplete: boolean;
  onNavigate: (view: View) => void;
}) {
  const { t } = useTranslation();
  const [drafts, setDrafts] = React.useState<AccountDrafts[] | null>(null);
  const [runs, setRuns] = React.useState<RunFeedItem[] | null>(null);
  const [automations, setAutomations] = React.useState<Automation[] | null>(null);
  const [colors, setColors] = React.useState<AccountColor[]>([]);
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
    if (d.status === "fulfilled") setDrafts(d.value);
    if (r.status === "fulfilled") setRuns(r.value);
    if (a.status === "fulfilled") setAutomations(a.value);
    if (c.status === "fulfilled") setColors(c.value.colors);
    const failed = results.find((x) => x.status === "rejected");
    if (failed) setError(errorMessage(failed.reason));
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (!drafts && !runs && !error) return <LoadingRow />;

  return (
    <div className="flex flex-col gap-10 pt-1">


      {error && <ErrorBanner>{error}</ErrorBanner>}

      {setupIncomplete && (
        <div className="tint-warning flex flex-wrap items-center justify-between gap-3 rounded-lg p-3.5">
          <p className="text-sm">{t("home.setupBanner")}</p>
          <Button size="sm" onClick={() => onNavigate("settings")}>
            {t("home.setupBannerCta")}
          </Button>
        </div>
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

  const dateLabel = (iso: string) =>
    iso
      ? new Date(iso).toLocaleDateString(i18n.language, {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";

  const total = drafts?.reduce((n, a) => n + a.drafts.length, 0) ?? 0;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <FileText className="h-4 w-4 text-muted-foreground" />
          {t("home.reviewTitle")}
          {total > 0 && <Badge variant="muted">{total}</Badge>}
        </h2>
      </div>

      {rowError && <ErrorBanner>{rowError}</ErrorBanner>}

      {!drafts ? (
        <LoadingRow />
      ) : total === 0 ? (
        <p className="rounded-lg bg-surface-2 px-3.5 py-3 text-xs text-muted-foreground">
          {t("home.reviewEmpty")}
        </p>
      ) : (
        drafts
          .filter((a) => a.drafts.length > 0 || a.error)
          .map((accountDrafts) => (
            <div key={accountDrafts.accountId} className="flex flex-col gap-2">
              {drafts.length > 1 && (
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
                <div className="flex flex-col gap-2">
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
          ))
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
        [...byDay.entries()].map(([day, dayRuns], dayIndex) => (
          <div key={day} className="flex flex-col gap-2">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground/80">
              {day}
            </h3>
            {dayRuns.map((run, i) => (
              <ActivityRunCard key={run.id} run={run} index={i} timeLabel={timeLabel} defaultExpanded={dayIndex === 0 && i === 0} />
            ))}
          </div>
        ))
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
