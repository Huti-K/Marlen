import type { AccountColor, AccountDrafts } from "@trailin/shared";
import { FileText, Mail, PenLine } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { AccountDot } from "@/components/ui/account-dot";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner, LoadingRow } from "@/components/ui/feedback";
import { DraftRow } from "@/features/email/DraftRow";
import { dateTimeLabel } from "@/lib/dates";

/**
 * Drafts lane: every live draft per connected account, reusing the same
 * DraftRow (expand, edit, send, discard) Home's review section renders —
 * both surfaces refetch off the `drafts` SSE topic. Unlike Home this is the
 * full list, not a "needs review" framing, so there is no date filter. The
 * data and reload live in EmailPanel, which also derives draft capability
 * for Reply/Compose from the same response.
 */
export function DraftsLane({
  drafts,
  colors,
  onChanged,
  focusDraftId,
  onCompose,
}: {
  drafts: AccountDrafts[] | null;
  colors: AccountColor[];
  onChanged: () => void;
  /** A just-created reply/compose draft — expanded and scrolled to on arrival. */
  focusDraftId: string | null;
  onCompose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [rowError, setRowError] = React.useState<string | null>(null);

  const dateLabel = (iso: string) => dateTimeLabel(iso, i18n.language);
  const total = drafts?.reduce((n, a) => n + a.drafts.length, 0) ?? 0;
  const hasErroredAccount = drafts?.some((a) => a.error) ?? false;

  const composeButton = (
    <Button size="sm" onClick={onCompose}>
      <PenLine className="h-4 w-4" />
      {t("email.compose.trigger")}
    </Button>
  );

  if (!drafts) return <LoadingRow />;

  if (total === 0 && !hasErroredAccount) {
    return (
      <EmptyState
        icon={FileText}
        title={t("email.drafts.emptyTitle")}
        description={t("email.drafts.emptyBody")}
        action={composeButton}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">{composeButton}</div>
      {rowError && <ErrorBanner>{rowError}</ErrorBanner>}

      <div className="flex flex-col gap-8">
        {drafts
          .filter((a) => a.drafts.length > 0 || a.error)
          .map((accountDrafts) => (
            <div key={accountDrafts.accountId} className="flex flex-col gap-3">
              {drafts.length > 1 && (
                <h3 className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <AccountDot
                    className="h-2.5 w-2.5"
                    color={colors.find((c) => c.accountId === accountDrafts.accountId)?.hex}
                  />
                  <Mail className="h-3.5 w-3.5" />
                  {accountDrafts.account}
                  <span className="text-muted-foreground/70">· {accountDrafts.drafts.length}</span>
                </h3>
              )}
              {accountDrafts.error ? (
                <ErrorBanner>{accountDrafts.error}</ErrorBanner>
              ) : (
                <div className="flex flex-col gap-3">
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
                        onSaved={onChanged}
                        onError={setRowError}
                        forceOpen={focusDraftId === draft.id}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}
