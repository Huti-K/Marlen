import type { AgentCard } from "@trailin/shared";
import { AtSign, MessagesSquare } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { ThreadMessageRow } from "@/components/ThreadHistory";
import { Button } from "@/components/ui/button";
import { dispatchTrailin } from "@/lib/trailinEvents";
import { CardShell } from "./CardShell";

type EmailThreadData = Extract<AgentCard, { kind: "email_thread" }>;

/**
 * The get-thread view: every message collapsed except the last —
 * that's the one being replied to, so it's the one worth reading first.
 */
export function EmailThreadCard({ card, color }: { card: EmailThreadData; color?: string }) {
  const { t, i18n } = useTranslation();
  const { account, threadId, subject, messages } = card;
  const lastIndex = messages.length - 1;
  const [openIndexes, setOpenIndexes] = React.useState<Set<number>>(
    () => new Set(lastIndex >= 0 ? [lastIndex] : []),
  );
  // A retried tool call replaces this card's `messages` in place, reusing this
  // same component instance (ChatPanel's "card" handler and turnCards.ts both
  // key by toolCallId). Re-derive which message is open whenever the array
  // itself changes, not just once on mount.
  const [trackedMessages, setTrackedMessages] = React.useState(messages);
  if (messages !== trackedMessages) {
    setTrackedMessages(messages);
    setOpenIndexes(new Set(lastIndex >= 0 ? [lastIndex] : []));
  }

  const toggle = (index: number) => {
    setOpenIndexes((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const addToChat = () => {
    if (!account) return;
    dispatchTrailin("add-chat-ref", {
      ref: { threadId, accountId: account.accountId, accountName: account.name, subject },
    });
  };

  return (
    <CardShell
      icon={MessagesSquare}
      label={t("chat.cards.thread.label")}
      meta={t("chat.cards.thread.messageCount", { count: messages.length })}
      title={subject || t("chat.cards.noSubject")}
      account={account}
      color={color}
      action={
        account ? (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={addToChat}
            aria-label={t("chat.cards.addToChat")}
            title={t("chat.cards.addToChat")}
          >
            <AtSign />
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col px-2 pb-2">
        {messages.map((message, index) => (
          <ThreadMessageRow
            key={`${message.date}-${message.from}`}
            message={message}
            open={openIndexes.has(index)}
            onToggle={() => toggle(index)}
            lang={i18n.language}
          />
        ))}
      </div>
    </CardShell>
  );
}
