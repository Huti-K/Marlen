import type { AccountColor, MessageCard, RunFeedItem } from "@trailin/shared";
import { Sparkles } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { AgentCardView } from "@/components/cards";
import { OpenRunInChatButton } from "@/components/OpenRunInChatButton";
import { RunTriggerBadge } from "@/components/RunTriggerBadge";
import { SectionTitle } from "@/components/ui/section-header";
import { NewDot, runSeenKey, type Seen, SeenOnInteract } from "@/features/home/seen";
import { timeLabel } from "@/lib/dates";
import type { View } from "@/lib/nav";
import { stagger } from "@/lib/utils";

/** How far back a run still counts as a fresh result before it is history. */
const RESULTS_WINDOW_MS = 48 * 60 * 60 * 1000;
/** Newest results shown; older ones age out into the activity log. */
const RESULTS_MAX = 4;

/** The run's presentable output: draft cards are excluded — those are
 *  approvals and already live in the attention list. */
function displayCards(run: RunFeedItem): MessageCard[] {
  return (run.cards ?? []).filter(
    ({ card }) => card.kind !== "email_draft" && card.kind !== "message_draft",
  );
}

/**
 * The runs this section shows: recent, successful, carrying presentable output,
 * and not the hero automation's. Exported so Home can count the new ones among
 * them without restating the window.
 */
export function freshResultRuns(
  runs: RunFeedItem[] | null,
  heroAutomationId?: string,
): { run: RunFeedItem; cards: MessageCard[] }[] {
  if (!runs) return [];
  const cutoff = Date.now() - RESULTS_WINDOW_MS;
  return runs
    .filter(
      (run) =>
        run.status === "success" &&
        new Date(run.startedAt).getTime() >= cutoff &&
        run.automationId !== heroAutomationId,
    )
    .map((run) => ({ run, cards: displayCards(run) }))
    .filter(({ cards }) => cards.length > 0)
    .slice(0, RESULTS_MAX);
}

/**
 * "Neue Ergebnisse" — what the other automations produced recently, shown as
 * their actual output cards instead of history rows. The hero automation is
 * excluded (its output leads the page); runs older than the window live only
 * in the activity log below. Hidden entirely when nothing is fresh.
 */
export function ResultsSection({
  runs,
  heroAutomationId,
  colors,
  onNavigate,
  seen,
}: {
  /** The activity feed with the hero run already removed; null while loading. */
  runs: RunFeedItem[] | null;
  /** Every run of this automation is excluded, not just the hero run itself. */
  heroAutomationId?: string;
  colors: AccountColor[];
  onNavigate: (view: View) => void;
  seen: Seen;
}) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = React.useState(true);

  const fresh = React.useMemo(
    () => freshResultRuns(runs, heroAutomationId),
    [runs, heroAutomationId],
  );

  if (fresh.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <SectionTitle
        icon={Sparkles}
        title={t("home.resultsTitle")}
        count={fresh.length}
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
      />
      {expanded && (
        <div className="flex flex-col gap-6">
          {fresh.map(({ run, cards }, i) => (
            <SeenOnInteract
              key={run.id}
              seen={seen}
              itemKey={runSeenKey(run.id)}
              createdAt={run.startedAt}
              className="animate-in-up flex flex-col gap-2"
              style={stagger(i)}
            >
              {(isNew) => (
                <>
                  <div className="flex items-center gap-2 px-0.5 text-xs text-muted-foreground">
                    {isNew && <NewDot />}
                    <span className="truncate font-medium text-foreground/80">
                      {run.automationName ?? t("home.deletedAutomation")}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {timeLabel(run.startedAt, i18n.language)}
                    </span>
                    <RunTriggerBadge trigger={run.trigger} />
                    <OpenRunInChatButton
                      runId={run.id}
                      onNavigateToChat={() => onNavigate("chat")}
                    />
                  </div>
                  {/* Sibling blocks, never nested (DESIGN.md: no card-in-card). */}
                  {cards.map(({ toolCallId, card }) => (
                    <AgentCardView key={toolCallId} card={card} colors={colors} />
                  ))}
                </>
              )}
            </SeenOnInteract>
          ))}
        </div>
      )}
    </section>
  );
}
