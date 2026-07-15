import type { ConnectedAccountWithSync, EmailThread } from "@trailin/shared";
import { AtSign, ChevronLeft, ExternalLink, Loader2, Reply } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { AccountDot } from "@/components/ui/account-dot";
import { Button } from "@/components/ui/button";
import { LoadingRow, RetryableError } from "@/components/ui/feedback";
import { MailboxActionButton } from "@/features/email/comingSoon";
import { ThreadHistory } from "@/features/email/ThreadHistory";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { dispatchTrailin } from "@/lib/trailinEvents";
import { errorMessage, openExternal } from "@/lib/utils";

/** Guard against stacking "Re: Re: …" when the subject already carries one. */
function replySubject(subject: string): string {
  return /^re:/i.test(subject.trim()) ? subject : `Re: ${subject}`;
}

/**
 * One thread, read from the mailbox mirror — swaps in for the inbox list
 * inside EmailPanel, a single-pane drill-down like contacts' detail view.
 * Reply is real (it creates a provider draft on the thread and lands in the
 * Drafts lane); the other mailbox actions render through the coming-soon
 * seam until the server grows a write layer for them.
 */
export function ThreadView({
  accountId,
  threadId,
  account,
  color,
  canReply,
  onBack,
  onReplyStarted,
}: {
  accountId: string;
  threadId: string;
  /** The connected account, when known — names the mailbox in the header. */
  account: ConnectedAccountWithSync | undefined;
  color?: string;
  /** False when this mailbox has no draft provider (reply can't create a draft). */
  canReply: boolean;
  onBack: () => void;
  onReplyStarted: (draftId: string) => void;
}) {
  const { t } = useTranslation();
  const [thread, setThread] = React.useState<EmailThread | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [replying, setReplying] = React.useState(false);

  const load = React.useCallback(() => {
    api
      .mailThread(accountId, threadId)
      .then((data) => {
        setThread(data);
        setLoadError(null);
      })
      .catch((err) => setLoadError(errorMessage(err)));
  }, [accountId, threadId]);

  React.useEffect(() => {
    setThread(null);
    setLoadError(null);
    load();
  }, [load]);

  const subject = thread?.subject || t("email.noSubject");

  const askAgent = () => {
    dispatchTrailin("show-chat");
    dispatchTrailin("add-chat-ref", {
      ref: {
        threadId,
        accountId,
        accountName: account?.name ?? "",
        subject: thread?.subject ?? "",
      },
    });
  };

  /**
   * Reply = a provider draft attached to this thread, prefilled with the
   * account's signature, addressed to the last message someone else sent
   * (falling back to the last message's recipients when the user spoke
   * last). The draft then opens in the Drafts lane — one send path.
   */
  const reply = async () => {
    if (!thread || thread.messages.length === 0) return;
    setReplying(true);
    try {
      const messages = thread.messages;
      const lastInbound = [...messages].reverse().find((m) => m.isFromMe === false);
      const last = messages[messages.length - 1];
      const to = lastInbound ? [lastInbound.from] : (last?.to ?? []);
      if (to.length === 0) throw new Error(t("email.replyNoRecipient"));

      const { voices } = await api.accountVoices().catch(() => ({ voices: [] }));
      const signature = voices.find((v) => v.accountId === accountId)?.signature;
      const created = await api.composeDraft(accountId, {
        to,
        subject: replySubject(thread.subject ?? ""),
        body: signature ? `\n\n${signature}` : "",
        threadId,
      });
      toast.success(t("email.replyStartedToast"));
      onReplyStarted(created.draftId);
    } catch (err) {
      toast.error(err);
    } finally {
      setReplying(false);
    }
  };

  const actionCtx = { accountId, threadId };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} className="w-fit">
          <ChevronLeft className="h-4 w-4" />
          {t("email.thread.back")}
        </Button>
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => void reply()}
            disabled={!canReply || replying || !thread}
            title={canReply ? t("email.thread.reply") : t("email.thread.replyUnavailable")}
            aria-label={canReply ? t("email.thread.reply") : t("email.thread.replyUnavailable")}
          >
            {replying ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Reply className="h-4 w-4" />
            )}
          </Button>
          <MailboxActionButton action="forward" ctx={actionCtx} />
          <MailboxActionButton action="archive" ctx={actionCtx} />
          <MailboxActionButton action="markUnread" ctx={actionCtx} />
          <MailboxActionButton action="move" ctx={actionCtx} />
          <MailboxActionButton action="labels" ctx={actionCtx} />
          <MailboxActionButton action="delete" ctx={actionCtx} />
          <Button
            variant="ghost"
            size="icon-sm"
            className="hover:bg-accent/10 hover:text-accent"
            onClick={askAgent}
            title={t("email.thread.askAgent")}
            aria-label={t("email.thread.askAgent")}
          >
            <AtSign className="h-4 w-4" />
          </Button>
          {thread?.webUrl && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => openExternal(thread.webUrl ?? "")}
              title={t("email.thread.openInMailbox")}
              aria-label={t("email.thread.openInMailbox")}
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {!thread ? (
        loadError ? (
          <RetryableError onRetry={load}>{loadError}</RetryableError>
        ) : (
          <LoadingRow />
        )
      ) : (
        <div className="surface flex flex-col gap-4 rounded-xl p-5">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold tracking-tight">{subject}</h2>
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              {account && (
                <>
                  <AccountDot className="h-2 w-2" color={color} />
                  <span className="truncate">{account.name}</span>
                  <span aria-hidden>·</span>
                </>
              )}
              <span className="tabular-nums">
                {t("email.thread.messageCount", { count: thread.messages.length })}
              </span>
            </p>
          </div>
          <ThreadHistory messages={thread.messages} />
        </div>
      )}
    </div>
  );
}
