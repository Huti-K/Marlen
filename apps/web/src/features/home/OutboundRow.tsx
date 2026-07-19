import { OUTBOUND_CHANNEL_LABELS, type OutboundDraft } from "@trailin/shared";
import { ChevronDown, ChevronRight, MessageSquare, Send, Trash2 } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { DraftActionDialog, useDraftActions } from "@/components/draftActions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconChip } from "@/components/ui/icon-chip";
import { ListRow } from "@/components/ui/list-row";
import { api, isNotFound } from "@/lib/api";
import { toast } from "@/lib/toast";
import { errorMessage } from "@/lib/utils";

/**
 * One outbound message awaiting approval (WhatsApp today) in the attention
 * list — the channel counterpart of the email DraftRow, on the same
 * arm→confirm→execute machinery. The body is read-only; refinement happens in
 * chat. Sending dispatches through POST /api/outbound/:id/send — the click is
 * the authorization.
 */
export function OutboundRow({
  draft,
  dateLabel,
  onChanged,
  onError,
}: {
  draft: OutboundDraft;
  dateLabel: (iso: string) => string;
  /** Called after a send/discard succeeds, so the list refetches without waiting on the event debounce. */
  onChanged: () => void;
  onError: (message: string | null) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  // True right after a send — a quiet terminal line until the "outbound"
  // server event removes the row from the open list.
  const [sent, setSent] = React.useState(false);

  const actions = useDraftActions({
    send: async () => {
      onError(null);
      try {
        await api.sendOutbound(draft.id);
        setSent(true);
        toast.success(t("home.outboundSentToast"));
        onChanged();
      } catch (err) {
        if (isNotFound(err)) onChanged();
        else onError(errorMessage(err));
      }
    },
    discard: async () => {
      onError(null);
      try {
        await api.discardOutbound(draft.id);
        onChanged();
      } catch (err) {
        if (isNotFound(err)) onChanged();
        else onError(errorMessage(err));
      }
    },
  });

  const channelLabel = OUTBOUND_CHANNEL_LABELS[draft.channel] ?? draft.channel;
  const title = draft.targetLabel || channelLabel;

  if (sent) {
    return (
      <ListRow>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{title}</p>
          <p className="truncate text-xs text-muted-foreground">{channelLabel}</p>
        </div>
        <Badge variant="success">{t("chat.cards.messageDraft.sentLabel")}</Badge>
      </ListRow>
    );
  }

  return (
    <div className="rounded-lg bg-surface-2">
      <div className="flex w-full items-center justify-between gap-3 px-3.5 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 min-w-0 items-center gap-2.5 text-left"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <IconChip size="sm" tone="tint-success">
            <MessageSquare />
          </IconChip>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{title}</p>
            <p className="truncate text-xs text-muted-foreground">
              {channelLabel} · {dateLabel(draft.createdAt)}
            </p>
            {!open && <p className="truncate text-xs text-muted-foreground/70">{draft.body}</p>}
          </div>
        </button>
        <div className="flex items-center shrink-0">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => actions.arm("send")}
            disabled={actions.busy}
            loading={actions.busy && actions.pending === "send"}
            title={t("chat.cards.draft.send")}
            aria-label={t("chat.cards.draft.send")}
          >
            <Send className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost-danger"
            size="icon-sm"
            onClick={() => actions.arm("discard")}
            disabled={actions.busy}
            loading={actions.busy && actions.pending === "discard"}
            title={t("chat.cards.draft.discard")}
            aria-label={t("chat.cards.draft.discard")}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {open && (
        <div className="px-3.5 pb-3.5">
          <p className="whitespace-pre-wrap pl-6.5 text-sm leading-relaxed text-foreground/90">
            {draft.body}
          </p>
        </div>
      )}

      <DraftActionDialog
        pending={actions.pending}
        busy={actions.busy}
        onClose={actions.close}
        onConfirm={() => void actions.confirm()}
        labels={{
          send: {
            title: t("chat.cards.draft.send"),
            description: t("chat.cards.messageDraft.sendConfirm"),
          },
          discard: {
            title: t("chat.cards.draft.discard"),
            description: t("chat.cards.messageDraft.discardConfirm"),
          },
        }}
      />
    </div>
  );
}
