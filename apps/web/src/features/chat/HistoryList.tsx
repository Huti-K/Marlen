import type { Conversation } from "@trailin/shared";
import { Loader2, MessagesSquare, Pencil, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingRow } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { dateTimeLabel } from "@/lib/dates";
import { useServerEvents } from "@/lib/serverEvents";
import { toast } from "@/lib/toast";
import { dispatchTrailin, subscribeTrailin } from "@/lib/trailinEvents";
import { cn } from "@/lib/utils";

/** First page size for the history rail; "Load more" fetches in the same increments. */
const CONVERSATIONS_PAGE_SIZE = 50;

/** How far back a conversation's `createdAt` (local time) groups it in the rail. */
type RecencyGroup = "today" | "yesterday" | "week" | "earlier";

const RECENCY_ORDER: RecencyGroup[] = ["today", "yesterday", "week", "earlier"];
// `as const` keeps these as literal keys so t() can type-check them below.
const RECENCY_LABEL_KEY = {
  today: "chat.groupToday",
  yesterday: "chat.groupYesterday",
  week: "chat.groupThisWeek",
  earlier: "chat.groupEarlier",
} as const satisfies Record<RecencyGroup, string>;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function recencyGroup(createdAt: string, now: Date): RecencyGroup {
  const diffDays = Math.round(
    (startOfDay(now).getTime() - startOfDay(new Date(createdAt)).getTime()) / 86_400_000,
  );
  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays <= 7) return "week";
  return "earlier";
}

/** Past conversations, newest first; fetched fresh each time it opens. Search and
 * pagination are server-backed — this only ever holds one loaded "window". */
export function HistoryList({
  activeId,
  onPick,
  query = "",
}: {
  activeId: string | undefined;
  onPick: (id: string) => void;
  query?: string;
}) {
  const { t, i18n } = useTranslation();
  const [items, setItems] = React.useState<Conversation[] | null>(null);
  const [total, setTotal] = React.useState(0);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [debouncedQuery, setDebouncedQuery] = React.useState(query.trim());
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [renameDraft, setRenameDraft] = React.useState("");
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const renameHandled = React.useRef(false);

  // Server-backed search: wait ~250ms after typing stops before hitting the endpoint.
  React.useEffect(() => {
    const trimmed = query.trim();
    const timer = setTimeout(() => setDebouncedQuery(trimmed), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const load = React.useCallback(() => {
    api
      .conversations({ q: debouncedQuery || undefined, limit: CONVERSATIONS_PAGE_SIZE, offset: 0 })
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
      })
      .catch((err) => {
        toast.error(err);
        setItems([]);
        setTotal(0);
      });
  }, [debouncedQuery]);

  React.useEffect(() => {
    setItems(null);
    load();
  }, [load]);

  // New chats and automation runs appear in the list as they happen. Simplest
  // correct behavior for an invalidation: refetch and reset to the first page.
  useServerEvents(["conversations"], load);

  // Chat creation is reported on the request's stream as well as the global
  // server-event stream. Listen to the local invalidation so a newly submitted
  // chat appears even if EventSource had not connected when it was created.
  React.useEffect(() => {
    return subscribeTrailin("conversations-changed", load);
  }, [load]);

  const loadMore = async () => {
    if (!items) return;
    setLoadingMore(true);
    try {
      const res = await api.conversations({
        q: debouncedQuery || undefined,
        limit: CONVERSATIONS_PAGE_SIZE,
        offset: items.length,
      });
      setItems([...items, ...res.items]);
      setTotal(res.total);
    } catch (err) {
      toast.error(err);
    } finally {
      setLoadingMore(false);
    }
  };

  const startRename = (c: Conversation) => {
    // Enter/Escape set this true and unmount the input without firing blur
    // (browsers don't dispatch focusout for a removed element), so a stale
    // true would swallow the next rename's blur-commit. Clear it up front.
    renameHandled.current = false;
    setRenamingId(c.id);
    setRenameDraft(c.title || "");
  };

  const commitRename = async (id: string) => {
    setRenamingId(null);
    const title = renameDraft.trim();
    if (!title) return; // empty edit — silently cancel rather than 400 the server
    setItems((prev) => prev?.map((c) => (c.id === id ? { ...c, title } : c)) ?? prev);
    try {
      await api.renameConversation(id, title);
    } catch (err) {
      toast.error(err);
      load();
    }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await api.deleteConversation(deleteId);
      if (deleteId === activeId) {
        // Same reset the "New chat" button triggers: clears messages, the open
        // conversation id, and the last-open-conversation localStorage key.
        dispatchTrailin("new-chat");
      }
      setItems((prev) => prev?.filter((c) => c.id !== deleteId) ?? prev);
      setTotal((n) => Math.max(0, n - 1));
    } catch (err) {
      toast.error(err);
    } finally {
      setDeleting(false);
      setDeleteId(null);
    }
  };

  const dateLabel = (iso: string) => dateTimeLabel(iso, i18n.language);

  const renderRow = (c: Conversation) => (
    <div
      key={c.id}
      className={cn(
        "group flex items-center gap-1 rounded-lg transition-colors",
        c.id === activeId ? "bg-accent/10" : "hover:bg-secondary",
      )}
    >
      {renamingId === c.id ? (
        <Input
          autoFocus
          value={renameDraft}
          onChange={(e) => setRenameDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              renameHandled.current = true;
              void commitRename(c.id);
            } else if (e.key === "Escape") {
              renameHandled.current = true;
              setRenamingId(null);
            }
          }}
          onBlur={() => {
            if (renameHandled.current) {
              renameHandled.current = false;
              return;
            }
            void commitRename(c.id);
          }}
          className="mx-1 my-1 h-7 min-w-0 flex-1 px-2"
        />
      ) : (
        <button
          type="button"
          onClick={() => onPick(c.id)}
          className="flex min-w-0 flex-1 flex-col items-start gap-0.5 px-3 py-2 text-left"
        >
          <span className="flex w-full min-w-0 items-center gap-1.5">
            {c.running && (
              <Loader2
                className="h-3.5 w-3.5 shrink-0 animate-spin text-accent"
                aria-label={t("chat.working")}
              />
            )}
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm",
                c.id === activeId ? "font-medium text-accent" : "text-foreground",
              )}
            >
              {c.title || t("chat.untitled")}
            </span>
          </span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {dateLabel(c.createdAt)}
          </span>
        </button>
      )}
      {renamingId !== c.id && (
        <div className="flex shrink-0 items-center gap-0.5 pr-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          {c.type !== "automation" && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={(e) => {
                e.stopPropagation();
                startRename(c);
              }}
              aria-label={t("chat.rename")}
              title={t("chat.rename")}
            >
              <Pencil />
            </Button>
          )}
          <Button
            variant="ghost-danger"
            size="icon-xs"
            onClick={(e) => {
              e.stopPropagation();
              setDeleteId(c.id);
            }}
            aria-label={t("chat.delete")}
            title={t("chat.delete")}
          >
            <Trash2 />
          </Button>
        </div>
      )}
    </div>
  );

  const dialog = (
    <ConfirmDialog
      open={deleteId !== null}
      onOpenChange={(next) => !next && setDeleteId(null)}
      title={t("chat.deleteConfirmTitle")}
      description={t("chat.deleteConfirmBody")}
      confirmLabel={t("chat.delete")}
      busy={deleting}
      onConfirm={() => void confirmDelete()}
    />
  );

  if (!items) {
    return (
      <>
        <LoadingRow />
        {dialog}
      </>
    );
  }

  const loadMoreButton = items.length < total && (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => void loadMore()}
      disabled={loadingMore}
      className="w-full text-muted-foreground"
    >
      {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {t("chat.loadMore")}
    </Button>
  );

  if (items.length === 0) {
    if (debouncedQuery) {
      return (
        <>
          <p className="px-1 py-2 text-xs text-muted-foreground">{t("chat.noSearchResults")}</p>
          {dialog}
        </>
      );
    }
    return (
      <>
        <EmptyState
          icon={MessagesSquare}
          description={t("chat.noConversations")}
          className="py-8"
          action={
            <Button variant="secondary" size="sm" onClick={() => dispatchTrailin("new-chat")}>
              <Plus />
              {t("chat.newConversation")}
            </Button>
          }
        />
        {dialog}
      </>
    );
  }

  // While searching: one flat, ungrouped, unsectioned result list (chats + automations mixed).
  if (debouncedQuery) {
    return (
      <>
        <div className="flex flex-col gap-4 py-2 px-1">
          <div className="flex flex-col gap-1">{items.map(renderRow)}</div>
          {loadMoreButton}
        </div>
        {dialog}
      </>
    );
  }

  const chats = items.filter((c) => c.type !== "automation");
  const automations = items.filter((c) => c.type === "automation");
  const now = new Date();
  const grouped = RECENCY_ORDER.map((group) => ({
    group,
    items: chats.filter((c) => recencyGroup(c.createdAt, now) === group),
  })).filter((g) => g.items.length > 0);

  return (
    <>
      <div className="flex flex-col gap-4 py-2 px-1">
        {chats.length > 0 && (
          <div className="flex flex-col gap-3">
            <h3 className="px-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {t("chat.chats")}
            </h3>
            {grouped.map(({ group, items: groupItems }) => (
              <div key={group} className="flex flex-col gap-1">
                <h4 className="px-2 text-xs font-medium text-muted-foreground">
                  {t(RECENCY_LABEL_KEY[group])}
                </h4>
                {groupItems.map(renderRow)}
              </div>
            ))}
          </div>
        )}
        {automations.length > 0 && (
          <div className="flex flex-col gap-1">
            <h3 className="px-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {t("chat.automations")}
            </h3>
            {automations.map(renderRow)}
          </div>
        )}
        {loadMoreButton}
      </div>
      {dialog}
    </>
  );
}
