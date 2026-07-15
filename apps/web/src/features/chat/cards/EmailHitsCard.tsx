import type { AgentCard, CardAccount, EmailHit, EmailRef } from "@trailin/shared";
import { AtSign, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { relativeTime } from "@/lib/dates";
import { dispatchTrailin } from "@/lib/trailinEvents";
import { CardShell } from "./CardShell";

type EmailHitsData = Extract<AgentCard, { kind: "email_hits" }>;

/**
 * The ref a hit's "add to chat" action would pin, or null when no connected
 * account can be resolved for it (the row then gets no action at all).
 * `accountName` only rides along when the hit's account matches the card's
 * own account — a cross-account hit with no card-level account has no known
 * display name to attach.
 */
function refFor(hit: EmailHit, account?: CardAccount): EmailRef | null {
  const accountId = hit.accountId ?? account?.accountId;
  if (!accountId) return null;
  return {
    threadId: hit.threadId,
    accountId,
    accountName: accountId === account?.accountId ? account?.name : undefined,
    messageId: hit.messageId,
    subject: hit.subject,
    from: hit.from,
    date: hit.date,
  };
}

/** The find-email result list: the query as title, then one compact two-line row per hit. */
export function EmailHitsCard({ card, color }: { card: EmailHitsData; color?: string }) {
  const { t, i18n } = useTranslation();
  const { account, query, hits, truncated } = card;

  const addToChat = (hit: EmailHit) => {
    const ref = refFor(hit, account);
    if (!ref) return;
    dispatchTrailin("add-chat-ref", { ref });
  };

  return (
    <CardShell
      icon={Search}
      label={t("chat.cards.hits.title")}
      meta={t("chat.cards.hits.resultCount", { count: hits.length })}
      title={query ? `“${query}”` : undefined}
      account={account}
      color={color}
    >
      {hits.length === 0 ? (
        <p className="px-4 pb-4 text-xs text-muted-foreground">{t("chat.cards.hits.empty")}</p>
      ) : (
        <div className="flex flex-col gap-3 px-4 pb-4 pt-1">
          {hits.map((hit) => {
            const ref = refFor(hit, account);
            return (
              <div key={hit.messageId} className="group flex min-w-0 items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-3">
                    <p className="min-w-0 flex-1 truncate text-sm font-medium">
                      {hit.subject || t("chat.cards.noSubject")}
                    </p>
                    <time className="shrink-0 font-mono text-2xs text-muted-foreground">
                      {relativeTime(hit.date, i18n.language)}
                    </time>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {hit.from}
                    {hit.snippet && (
                      <span className="text-muted-foreground/70"> — {hit.snippet}</span>
                    )}
                  </p>
                </div>
                {ref && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                    onClick={() => addToChat(hit)}
                    aria-label={t("chat.cards.addToChat")}
                    title={t("chat.cards.addToChat")}
                  >
                    <AtSign />
                  </Button>
                )}
              </div>
            );
          })}
          {truncated && (
            <p className="font-mono text-2xs text-muted-foreground/70">
              {t("chat.cards.hits.truncatedLabel")}
            </p>
          )}
        </div>
      )}
    </CardShell>
  );
}
