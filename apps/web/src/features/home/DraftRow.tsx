import * as React from "react";
import { ChevronDown, ChevronRight, ExternalLink, Loader2, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmailDraft } from "@trailin/shared";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { errorMessage } from "@/lib/utils";

/** One draft — click to read the full content right here. */
export function DraftRow({
  accountId,
  draft,
  dateLabel,
  onDeleted,
  onError,
}: {
  accountId: string;
  draft: EmailDraft;
  dateLabel: (iso: string) => string;
  onDeleted: () => void;
  onError: (message: string | null) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const [detail, setDetail] = React.useState<{ body: string; cc: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !detail) {
      try {
        setDetail(await api.draftDetail(accountId, draft.id));
      } catch (err) {
        onError(errorMessage(err));
        setOpen(false);
      }
    }
  };

  const discard = async () => {
    setBusy(true);
    onError(null);
    try {
      await api.deleteDraft(accountId, draft.id);
      onDeleted();
    } catch (err) {
      onError(errorMessage(err));
      setBusy(false);
    } finally {
      setConfirmOpen(false);
    }
  };

  return (
    <div className="rounded-lg bg-surface-2">
      <div className="flex w-full items-center justify-between gap-3 px-3.5 py-3">
        <button
          type="button"
          onClick={() => void toggle()}
          className="flex flex-1 min-w-0 items-center gap-2.5 text-left"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {draft.subject || t("drafts.noSubject")}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {draft.to && `${t("drafts.to")} ${draft.to}`}
              {draft.to && draft.date && " · "}
              {dateLabel(draft.date)}
            </p>
          </div>
        </button>
        <div className="flex items-center shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:bg-secondary hover:text-foreground"
            onClick={() => window.open(draft.webUrl, "_blank", "noopener,noreferrer")}
            title={t("drafts.open")}
            aria-label={t("drafts.open")}
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setConfirmOpen(true)}
            disabled={busy}
            className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            title={t("drafts.discard")}
            aria-label={t("drafts.discard")}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {open && (
        <div className="flex flex-col gap-3 px-3.5 pb-3.5 pt-1">
          {!detail ? (
            <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("common.loading")}
            </div>
          ) : (
            <>
              {detail.cc && (
                <p className="text-xs text-muted-foreground">
                  {t("drafts.cc")} {detail.cc}
                </p>
              )}
              {/* Literal draft body (what will actually be sent) — not agent
                  prose, so unlike Chat/Automations this stays unrendered. */}
              <p className="whitespace-pre-wrap text-sm leading-relaxed">
                {detail.body || t("drafts.emptyBodyText")}
              </p>
            </>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("drafts.discard")}
        description={t("drafts.discardConfirm")}
        confirmLabel={t("drafts.discard")}
        variant="destructive"
        busy={busy}
        onConfirm={() => void discard()}
      />
    </div>
  );
}
