import {
  type AccountColor,
  type ConnectedAccountWithSync,
  MAIL_THREAD_FILTERS,
  type MailThreadFilter,
  type MailThreadOverview,
} from "@trailin/shared";
import { Inbox } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { AccountDot } from "@/components/ui/account-dot";
import { Badge } from "@/components/ui/badge";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice, RetryableError } from "@/components/ui/feedback";
import { ShowMoreButton } from "@/components/ui/show-more-button";
import {
  formatParticipants,
  LANE_INITIAL_VISIBLE,
  LANE_VISIBLE_STEP,
  LaneSkeletons,
  stagger,
  THREAD_FETCH_LIMIT,
} from "@/features/email/shared";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/dates";
import { useServerEvents } from "@/lib/serverEvents";
import { usePagedVisible } from "@/lib/usePagedVisible";
import { errorMessage } from "@/lib/utils";

/**
 * Inbox lane: the mailbox mirror's thread overviews (GET /api/threads),
 * filtered by the chip row and the panel's account picker. Selecting a row
 * hands the thread up to EmailPanel, which swaps this list for ThreadView.
 * The list trails live mail by up to the sync interval — it reads the local
 * mirror, never the provider.
 */
export function InboxLane({
  accountId,
  accounts,
  colors,
  onOpenThread,
}: {
  /** undefined = all accounts. */
  accountId: string | undefined;
  accounts: ConnectedAccountWithSync[];
  colors: AccountColor[];
  onOpenThread: (thread: MailThreadOverview) => void;
}) {
  const { t } = useTranslation();
  const [threads, setThreads] = React.useState<MailThreadOverview[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<MailThreadFilter>("recent");
  const { visible, showMore } = usePagedVisible(
    LANE_INITIAL_VISIBLE,
    LANE_VISIBLE_STEP,
    `${filter}|${accountId ?? "all"}`,
  );
  // Guards against a slow, now-stale request overwriting a faster later one.
  const requestRef = React.useRef(0);

  const refresh = React.useCallback(() => {
    const id = ++requestRef.current;
    api
      .mailThreads({ accountId, filter, limit: THREAD_FETCH_LIMIT })
      .then(({ items }) => {
        if (requestRef.current !== id) return;
        setThreads(items);
        setLoadError(null);
      })
      .catch((err) => {
        if (requestRef.current !== id) return;
        setLoadError(errorMessage(err));
      });
  }, [accountId, filter]);

  React.useEffect(refresh, [refresh]);
  // `mail` = the mirror changed, `mail_state` = enrichment re-triaged threads.
  useServerEvents(["mail", "mail_state"], refresh);

  if (threads === null) {
    return loadError ? (
      <RetryableError onRetry={refresh}>{loadError}</RetryableError>
    ) : (
      <LaneSkeletons />
    );
  }

  const scoped = accountId ? accounts.filter((a) => a.id === accountId) : accounts;
  const syncErrors = scoped.filter((a) => a.sync?.status === "error");
  // No successful sync yet and nothing mirrored: the inbox isn't empty, it
  // just hasn't arrived — say that instead of "no threads".
  const stillImporting =
    threads.length === 0 && scoped.length > 0 && scoped.every((a) => !a.sync?.lastSyncedAt);

  const shown = threads.slice(0, visible);
  const remaining = threads.length - shown.length;
  const colorOf = (id: string) => colors.find((c) => c.accountId === id)?.hex;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1.5">
        {MAIL_THREAD_FILTERS.map((value) => (
          <Chip key={value} active={filter === value} onClick={() => setFilter(value)}>
            {t(`email.filters.${value}`)}
          </Chip>
        ))}
      </div>

      {syncErrors.length > 0 && (
        <Notice tone="warning">
          <p className="text-sm">
            {t("email.syncError", { account: syncErrors.map((a) => a.name).join(", ") })}
          </p>
        </Notice>
      )}

      {threads.length === 0 ? (
        stillImporting ? (
          <EmptyState
            icon={Inbox}
            title={t("email.importingTitle")}
            description={t("email.importingBody")}
          />
        ) : filter !== "recent" ? (
          <EmptyState icon={Inbox} description={t("email.emptyFiltered")} />
        ) : (
          <EmptyState
            icon={Inbox}
            title={t("email.emptyTitle")}
            description={t("email.emptyBody")}
          />
        )
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map((thread, i) => (
            <div
              key={`${thread.accountId}:${thread.threadId}`}
              className="animate-in-up"
              style={stagger(i)}
            >
              <ThreadRow
                thread={thread}
                color={accountId ? undefined : colorOf(thread.accountId)}
                onOpen={() => onOpenThread(thread)}
              />
            </div>
          ))}
          {remaining > 0 && <ShowMoreButton count={remaining} onClick={showMore} />}
        </div>
      )}
    </div>
  );
}

/** The triage states worth a badge in the list — the ball is with the user. */
const TRIAGE_BADGE: Record<string, "warning" | "muted"> = {
  needs_reply: "warning",
  needs_action: "warning",
};

function ThreadRow({
  thread,
  color,
  onOpen,
}: {
  thread: MailThreadOverview;
  /** Account color dot, shown only in the all-accounts view. */
  color?: string;
  onOpen: () => void;
}) {
  const { t, i18n } = useTranslation();
  const badgeTone = thread.triage ? TRIAGE_BADGE[thread.triage] : undefined;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-start gap-3 rounded-lg bg-surface-2 px-3.5 py-3 text-left transition-colors hover:bg-secondary"
    >
      {/* Unread marker column — accent = "has unread", the page's one meaningful color. */}
      <span className="mt-1.5 flex h-2 w-2 shrink-0 items-center justify-center">
        {thread.hasUnread && <span aria-hidden className="h-2 w-2 rounded-full bg-accent" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {color !== undefined && <AccountDot className="h-2 w-2 shrink-0" color={color} />}
          <p
            className={
              thread.hasUnread
                ? "truncate text-sm font-semibold"
                : "truncate text-sm font-medium text-foreground/90"
            }
          >
            {thread.subject || t("email.noSubject")}
          </p>
          {badgeTone && thread.triage && (
            <Badge variant={badgeTone} className="shrink-0 text-2xs">
              {t(`email.triage.${thread.triage}`)}
            </Badge>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {formatParticipants(thread.participants)}
          {thread.messageCount > 1 && ` · ${thread.messageCount}`}
        </p>
        {thread.gist && <p className="truncate text-xs text-muted-foreground/70">{thread.gist}</p>}
      </div>
      <time className="shrink-0 font-mono text-2xs tabular-nums text-muted-foreground">
        {relativeTime(thread.lastMessageAt, i18n.language)}
      </time>
    </button>
  );
}
