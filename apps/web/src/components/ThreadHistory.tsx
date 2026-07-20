import type { EmailThreadMessage } from "@marlen/shared";
import { ChevronDown, ChevronRight } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { DisclosureToggle } from "@/components/ui/disclosure-toggle";
import { LoadingRow, RetryableError } from "@/components/ui/feedback";
import { api, isNotFound } from "@/lib/api";
import { relativeTime } from "@/lib/dates";
import { errorMessage } from "@/lib/utils";

/**
 * Collapsible conversation history for anything that references a provider
 * thread — reply drafts in the chat card and the Home review list. The thread
 * is read live on first expand (nothing is stored locally), with the last
 * message opened since that's the one being replied to. A thread with no
 * earlier messages (a draft that isn't a reply sits alone in its own thread)
 * renders a quiet empty line instead of an error.
 */
export function ThreadHistory({ accountId, threadId }: { accountId: string; threadId: string }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const [messages, setMessages] = React.useState<EmailThreadMessage[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [openIndexes, setOpenIndexes] = React.useState<Set<number>>(new Set());

  const load = React.useCallback(async () => {
    setError(null);
    // No provider thread id (unlinked/legacy draft): same as a thread holding
    // nothing beyond the draft — the server rejects an empty id.
    if (!threadId) {
      setMessages([]);
      return;
    }
    try {
      const detail = await api.threadDetail(accountId, threadId);
      setMessages(detail.messages);
      setOpenIndexes(new Set(detail.messages.length > 0 ? [detail.messages.length - 1] : []));
    } catch (err) {
      // A 404 means the thread holds nothing beyond the draft itself — that's
      // the standalone-draft case, not a failure.
      if (isNotFound(err)) setMessages([]);
      else setError(errorMessage(err));
    }
  }, [accountId, threadId]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && messages === null && !error) void load();
  };

  const toggleMessage = (index: number) => {
    setOpenIndexes((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <DisclosureToggle open={open} onToggle={toggle}>
        {open ? t("threadHistory.hide") : t("threadHistory.show")}
      </DisclosureToggle>
      {open &&
        (error ? (
          <RetryableError onRetry={() => void load()}>{error}</RetryableError>
        ) : messages === null ? (
          <LoadingRow className="py-1 text-xs" />
        ) : messages.length === 0 ? (
          <p className="text-xs text-muted-foreground/70">{t("threadHistory.empty")}</p>
        ) : (
          <div className="flex flex-col">
            {messages.map((message, index) => (
              <ThreadMessageRow
                key={message.id ?? `${message.date}-${message.from}`}
                message={message}
                open={openIndexes.has(index)}
                onToggle={() => toggleMessage(index)}
                lang={i18n.language}
              />
            ))}
          </div>
        ))}
    </div>
  );
}

/** One message: a collapsed sender/time line that expands to recipients + body. */
export function ThreadMessageRow({
  message,
  open,
  onToggle,
  lang,
}: {
  message: EmailThreadMessage;
  open: boolean;
  onToggle: () => void;
  lang: string;
}) {
  const { t } = useTranslation();

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-2"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{message.from}</span>
        <time className="shrink-0 font-mono text-2xs text-muted-foreground">
          {relativeTime(message.date, lang)}
        </time>
      </button>

      {open && (
        /* Body indents to the sender's text edge, keeping the chevron column clear. */
        <div className="flex flex-col gap-2 pb-3 pl-7.5 pr-3 pt-0.5">
          {message.to.length > 0 && (
            <p className="truncate text-xs text-muted-foreground">
              <span className="font-mono text-2xs">{t("threadHistory.to")}</span>{" "}
              {message.to.join(", ")}
            </p>
          )}
          {message.cc && message.cc.length > 0 && (
            <p className="truncate text-xs text-muted-foreground">
              <span className="font-mono text-2xs">{t("threadHistory.cc")}</span>{" "}
              {message.cc.join(", ")}
            </p>
          )}
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {message.body || t("threadHistory.emptyBody")}
          </p>
        </div>
      )}
    </div>
  );
}
