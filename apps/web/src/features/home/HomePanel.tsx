import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { MissedAutomation, RunFeedItem } from "@trailin/shared";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ErrorBanner, Notice } from "@/components/ui/feedback";
import { ActivitySection } from "@/features/home/ActivitySection";
import { AttentionSection } from "@/features/home/AttentionSection";
import { BriefingHero, findBriefingCard } from "@/features/home/BriefingHero";
import { ResultsSection } from "@/features/home/ResultsSection";
import { useAccountColors } from "@/lib/accounts";
import { api } from "@/lib/api";
import type { View } from "@/lib/nav";
import { takePendingDraftFocus } from "@/lib/paletteFocus";
import { subscribeTrailin } from "@/lib/trailinEvents";
import { errorMessage } from "@/lib/utils";

/**
 * The default view, top to bottom: the pinned automation's latest output
 * (hero), everything actionable now (attention), fresh output from the other
 * automations (results), the schedule ahead (coming up), and the collapsed
 * run log (activity).
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
  const queryClient = useQueryClient();

  // Independent queries, so each section paints the moment its own data lands
  // — drafts fan out to live mailbox APIs and can take seconds cold while the
  // rest are fast local-DB reads. The query cache is also what makes a return
  // to Home paint instantly from the last known data while refreshing behind.
  const draftsQuery = useQuery({ queryKey: ["drafts", "review"], queryFn: () => api.drafts() });
  const runsQuery = useQuery({ queryKey: ["runs", "feed"], queryFn: () => api.runsFeed() });
  const automationsQuery = useQuery({
    queryKey: ["automations", "list"],
    queryFn: () => api.automations(),
  });
  const pinnedQuery = useQuery({ queryKey: ["runs", "pinned"], queryFn: () => api.pinnedRun() });
  const missedQuery = useQuery({ queryKey: ["runs", "missed"], queryFn: () => api.missedRuns() });
  const { colors } = useAccountColors({ withAccounts: false });

  const drafts = draftsQuery.data ?? null;
  const runs = runsQuery.data?.items ?? null;
  const automations = automationsQuery.data ?? null;
  const pinned = pinnedQuery.data ?? null;
  const missed = missedQuery.data?.items ?? [];
  const queryError =
    draftsQuery.error ??
    runsQuery.error ??
    automationsQuery.error ??
    pinnedQuery.error ??
    missedQuery.error;
  const error = queryError ? errorMessage(queryError) : null;

  // Set by the search palette (see SearchPalette.tsx) when a draft hit is opened.
  const [focusDraft, setFocusDraft] = React.useState<{ accountId: string; draftId: string } | null>(
    null,
  );

  // A draft was sent or discarded from a row: refresh the review list without
  // waiting for the server event's debounce.
  const refreshDrafts = () => void queryClient.invalidateQueries({ queryKey: ["drafts"] });

  // The search palette navigates here, then dispatches this with the hit's
  // ids — but only once this effect's listener is attached, which loses the
  // race when Home wasn't already mounted. Catch that case by also reading
  // the same payload stashed just before navigate (see lib/paletteFocus.ts).
  React.useEffect(() => {
    const pending = takePendingDraftFocus();
    if (pending) setFocusDraft(pending);
    return subscribeTrailin("open-draft", (detail) => {
      if (detail) setFocusDraft(detail);
      // Already handled live — discard so a later remount doesn't replay it.
      takePendingDraftFocus();
    });
  }, []);

  // The flagship output: the pinned automation's latest successful run, when
  // one is pinned. Otherwise fall back to the most recent successful run that
  // carries a structured briefing card. Sorted explicitly rather than
  // trusting feed order, since that's a server-side detail this component
  // shouldn't depend on. A run without a briefing card is never picked as
  // the hero — it still shows up in the plain activity feed.
  const heroRun = React.useMemo(() => {
    if (pinned?.run) return pinned.run;
    if (!runs) return null;
    let best: RunFeedItem | null = null;
    for (const run of runs) {
      if (run.status !== "success") continue;
      if (!findBriefingCard(run)) continue;
      if (!best || new Date(run.startedAt).getTime() > new Date(best.startedAt).getTime()) {
        best = run;
      }
    }
    return best;
  }, [runs, pinned]);

  // Keep `runs` as-is while loading (null) so ActivitySection still shows its
  // own loading state; once loaded, drop the run already shown in the hero.
  const activityRuns = React.useMemo(() => {
    if (!runs) return runs;
    return heroRun ? runs.filter((r) => r.id !== heroRun.id) : runs;
  }, [runs, heroRun]);

  // No top-level loading gate: each section renders its own loading state
  // while its data is null, so the fast local reads (runs/automations) paint
  // straight away instead of waiting on the slow live mailbox drafts fetch.
  return (
    <div className="flex flex-col gap-10 pt-1">
      {error && !offline && <ErrorBanner>{error}</ErrorBanner>}

      {setupIncomplete ? (
        <Notice tone="warning" className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">{t("home.setupBanner")}</p>
          <Button size="sm" onClick={() => onNavigate("settings")}>
            {t("home.setupBannerCta")}
          </Button>
        </Notice>
      ) : offline ? (
        <Notice tone="warning" className="flex items-center gap-3">
          <p className="text-sm">{t("home.offlineBanner")}</p>
        </Notice>
      ) : null}

      {missed.length > 0 && <MissedRunsBanner missed={missed} />}

      {heroRun && (
        <BriefingHero
          run={heroRun}
          runs={runs}
          onNavigate={onNavigate}
          colors={colors}
          nextRunAt={
            pinned?.automation?.nextRunAt ??
            automations?.find((a) => a.id === heroRun.automationId)?.nextRunAt
          }
        />
      )}

      <AttentionSection
        automations={automations}
        drafts={drafts}
        colors={colors}
        focusDraft={focusDraft}
        onDraftsChanged={refreshDrafts}
        onNavigate={onNavigate}
      />
      <ResultsSection
        runs={activityRuns}
        heroAutomationId={heroRun?.automationId}
        colors={colors}
        onNavigate={onNavigate}
      />
      <ActivitySection
        runs={activityRuns}
        automations={automations}
        colors={colors}
        onNavigate={onNavigate}
        hasHero={!!heroRun}
      />
    </div>
  );
}

/* ---------------- Missed scheduled runs ---------------- */

/**
 * Shown only when the server reports automations whose latest scheduled slot
 * elapsed without a covering run — i.e. boot catch-up couldn't run them. The
 * button starts them; the resulting "runs" server event reloads Home, which
 * recomputes the missed list to empty and unmounts this banner.
 */
function MissedRunsBanner({ missed }: { missed: MissedAutomation[] }) {
  const { t } = useTranslation();
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      await api.runMissed();
    } catch (e) {
      setError(errorMessage(e));
      setRunning(false);
    }
  };

  return (
    <Notice tone="warning" className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm">{error ?? t("home.missedBanner", { count: missed.length })}</p>
      <Button size="sm" onClick={run} disabled={running}>
        {running ? t("home.missedRunning") : t("home.missedRun")}
      </Button>
    </Notice>
  );
}
