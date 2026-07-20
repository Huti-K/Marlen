import { OUTBOUND_CHANNEL_LABELS, type OutboundDraft } from "@trailin/shared";
import { ChevronRight, MessageSquare, Send, Sparkles, Trash2 } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { DraftActionDialog, useDraftActions } from "@/components/draftActions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconChip } from "@/components/ui/icon-chip";
import { ListRow } from "@/components/ui/list-row";
import { Textarea } from "@/components/ui/textarea";
import { revealChat, sendChatCommand } from "@/features/chat/controller";
import { NewDot } from "@/features/home/seen";
import { api, isNotFound } from "@/lib/api";
import { toast } from "@/lib/toast";
import { cn, errorMessage } from "@/lib/utils";

/**
 * One outbound message awaiting approval (WhatsApp today) in the attention
 * list — the channel counterpart of the email DraftRow, on the same
 * arm→confirm→execute machinery, and editable in place the same way. Sending
 * dispatches through POST /api/outbound/:id/send — the click is the
 * authorization.
 */
export function OutboundRow({
  draft,
  dateLabel,
  onChanged,
  onError,
  isNew,
}: {
  draft: OutboundDraft;
  dateLabel: (iso: string) => string;
  /** Called after a send/discard succeeds, so the list refetches without waiting on the event debounce. */
  onChanged: () => void;
  onError: (message: string | null) => void;
  /** Drafted since the user last looked — fronts the title with the new dot. */
  isNew?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  // Editable body: `bodyDraft` is the live field value, `savedBody` the
  // last-persisted baseline it's compared against for the dirty flag.
  const [bodyDraft, setBodyDraft] = React.useState(draft.body);
  const [savedBody, setSavedBody] = React.useState(draft.body);
  const [saving, setSaving] = React.useState(false);
  // True right after a send — a quiet terminal line until the "outbound"
  // server event removes the row from the open list.
  const [sent, setSent] = React.useState(false);

  const dirty = bodyDraft !== savedBody;

  const save = async () => {
    setSaving(true);
    onError(null);
    try {
      await api.updateOutbound(draft.id, { body: bodyDraft });
      setSavedBody(bodyDraft);
      toast.success(t("common.saved"));
      onChanged();
    } catch (err) {
      // Keep the typed text — only the banner reflects the failure.
      onError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const actions = useDraftActions({
    // Flushes any unsaved edits first: the channel sends the stored body.
    send: async () => {
      onError(null);
      try {
        if (dirty) {
          await api.updateOutbound(draft.id, { body: bodyDraft });
          setSavedBody(bodyDraft);
        }
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
    <div className="surface surface-hover rounded-lg">
      <div className="flex w-full items-center gap-2 px-2.5 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 min-w-0 items-center gap-2 text-left"
        >
          <IconChip size="sm" tone="tint-success">
            <MessageSquare />
          </IconChip>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate text-sm font-medium">
              {isNew && <NewDot />}
              {title}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {channelLabel} · {dateLabel(draft.createdAt)}
              {!open && <span className="text-muted-foreground/70"> · {draft.body}</span>}
            </p>
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            className="hover:bg-accent/10 hover:text-accent"
            onClick={(e) => {
              e.stopPropagation();
              revealChat();
              if (draft.conversationId) {
                // The agent wrote this draft — reopen that conversation, with
                // its context and draft card, instead of starting cold.
                sendChatCommand({ kind: "open", conversationId: draft.conversationId });
              } else {
                // Drafted before the conversation link existed: a fresh chat
                // with a prefilled ask is the best we can do.
                sendChatCommand({
                  kind: "prefill",
                  text: t("drafts.refinePrompt", { subject: title }),
                });
              }
            }}
            title={draft.conversationId ? t("drafts.refineInChat") : t("drafts.refine")}
            aria-label={draft.conversationId ? t("drafts.refineInChat") : t("drafts.refine")}
          >
            <Sparkles />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => actions.arm("send")}
            disabled={actions.busy}
            loading={actions.busy && actions.pending === "send"}
            title={t("chat.cards.draft.send")}
            aria-label={t("chat.cards.draft.send")}
          >
            <Send />
          </Button>
          <Button
            variant="ghost-danger"
            size="icon-xs"
            onClick={() => actions.arm("discard")}
            disabled={actions.busy}
            loading={actions.busy && actions.pending === "discard"}
            title={t("chat.cards.draft.discard")}
            aria-label={t("chat.cards.draft.discard")}
          >
            <Trash2 />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-expanded={open}
            title={t(open ? "common.collapse" : "common.expand")}
            aria-label={t(open ? "common.collapse" : "common.expand")}
            onClick={() => setOpen((v) => !v)}
          >
            <ChevronRight className={cn("transition-transform", open && "rotate-90")} />
          </Button>
        </div>
      </div>

      {open && (
        <div className="px-2.5 pb-3">
          <div className="flex flex-col gap-2 pl-8 pt-1">
            <Textarea
              value={bodyDraft}
              onChange={(e) => setBodyDraft(e.target.value)}
              rows={Math.max(3, bodyDraft.split("\n").length)}
              disabled={actions.busy}
              className="resize-none text-sm leading-relaxed text-foreground/90"
            />
            {dirty && (
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setBodyDraft(savedBody)}
                  disabled={saving || actions.busy}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  size="sm"
                  onClick={() => void save()}
                  disabled={actions.busy}
                  loading={saving}
                >
                  {saving ? t("common.saving") : t("drafts.save")}
                </Button>
              </div>
            )}
          </div>
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
