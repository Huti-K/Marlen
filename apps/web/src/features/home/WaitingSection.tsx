import type { AccountColor, AccountWaiting } from "@trailin/shared";
import { ExternalLink, Hourglass, PenLine } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { AccountDot } from "@/components/ui/account-dot";
import { Button } from "@/components/ui/button";
import { ListRow } from "@/components/ui/list-row";
import { CollapsibleSectionTitle } from "@/features/home/CollapsibleSectionTitle";
import { openExternal } from "@/lib/utils";

/**
 * "Waiting on others" — sent threads nobody has replied to yet, flattened
 * across every connected account. Only renders once there's something to
 * show; per-account fetch errors are ignored here since ReviewSection/drafts
 * already surface connectivity problems.
 */
export function WaitingSection({
  waiting,
  colors,
}: {
  waiting: AccountWaiting[] | null;
  colors: AccountColor[];
}) {
  const { t, i18n } = useTranslation();
  const [isExpanded, setIsExpanded] = React.useState(true);

  const items = React.useMemo(
    () =>
      (waiting ?? []).flatMap((account) =>
        account.items.map((item) => ({
          ...item,
          account: account.account,
          accountId: account.accountId,
        })),
      ),
    [waiting],
  );

  const relativeTime = React.useMemo(
    () => new Intl.RelativeTimeFormat(i18n.language, { numeric: "auto" }),
    [i18n.language],
  );

  if (waiting === null || items.length === 0) return null;

  const relativeLabel = (iso: string) => {
    const t0 = new Date(iso).getTime();
    if (Number.isNaN(t0)) return "";
    const days = Math.round((t0 - Date.now()) / (24 * 60 * 60 * 1000));
    return relativeTime.format(days, "day");
  };

  const nudge = (counterpart: string, subject: string, account: string) => {
    window.dispatchEvent(new CustomEvent("trailin:show-chat"));
    window.dispatchEvent(
      new CustomEvent("trailin:prefill-chat", {
        detail: { text: t("home.waitingNudgePrompt", { counterpart, subject, account }) },
      }),
    );
  };

  return (
    <section className="flex flex-col gap-3">
      <CollapsibleSectionTitle
        icon={Hourglass}
        title={t("home.waitingTitle")}
        count={items.length}
        expanded={isExpanded}
        onToggle={() => setIsExpanded(!isExpanded)}
      />

      {isExpanded && (
        <div className="flex flex-col gap-3">
          {items.map((item, i) => (
            <ListRow
              key={`${item.accountId}-${item.threadId}`}
              className="animate-in-up"
              style={{ animationDelay: `${i * 45}ms` }}
            >
              <AccountDot
                className="h-2.5 w-2.5"
                color={colors.find((c) => c.accountId === item.accountId)?.hex}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.subject}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {item.counterpart} · {relativeLabel(item.lastSentAt)}
                </p>
              </div>
              <div className="flex shrink-0 items-center">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => openExternal(item.webUrl)}
                  title={t("drafts.open")}
                  aria-label={t("drafts.open")}
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="hover:bg-accent/10 hover:text-accent"
                  onClick={() => nudge(item.counterpart, item.subject, item.account)}
                  title={t("home.waitingNudge")}
                  aria-label={t("home.waitingNudge")}
                >
                  <PenLine className="h-4 w-4" />
                </Button>
              </div>
            </ListRow>
          ))}
        </div>
      )}
    </section>
  );
}
