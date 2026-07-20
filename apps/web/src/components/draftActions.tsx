import { Sparkles } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { revealChat, sendChatCommand } from "@/features/chat/controller";

/** A draft action pending confirmation in the shared armed dialog. */
export type DraftAction = "send" | "discard";

/**
 * The arm → confirm → execute machinery every surface that sends or discards
 * a draft shares (Home's DraftRow, the chat's EmailDraftCard). The callbacks
 * own their surface's API call and error semantics — inline banner on one,
 * card status/toast on the other — while the hook owns arming, the busy
 * flag, and closing the dialog afterwards, so the two surfaces cannot drift
 * in how an action is confirmed.
 */
export function useDraftActions(callbacks: {
  send: () => Promise<void>;
  discard: () => Promise<void>;
}): {
  pending: DraftAction | null;
  busy: boolean;
  arm: (action: DraftAction) => void;
  close: () => void;
  confirm: () => Promise<void>;
} {
  const [pending, setPending] = React.useState<DraftAction | null>(null);
  const [busy, setBusy] = React.useState(false);

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await (pending === "send" ? callbacks.send() : callbacks.discard());
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  return {
    pending,
    busy,
    arm: (action: DraftAction) => setPending(action),
    close: () => setPending(null),
    confirm,
  };
}

/** The armed confirm dialog for those actions; each surface supplies its own labels. */
export function DraftActionDialog({
  pending,
  busy,
  onClose,
  onConfirm,
  labels,
}: {
  pending: DraftAction | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
  /** Title doubles as the confirm-button label, matching both surfaces today. */
  labels: Record<DraftAction, { title: string; description: string }>;
}) {
  return (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={pending ? labels[pending].title : ""}
      description={pending ? labels[pending].description : ""}
      confirmLabel={pending ? labels[pending].title : ""}
      variant={pending === "send" ? "default" : "destructive"}
      busy={busy}
      onConfirm={onConfirm}
    />
  );
}

/**
 * Hands a draft to the chat for rewording. With a `conversationId` the agent
 * wrote this draft, so its conversation reopens with the context and the draft
 * card intact; without one the draft predates the link and a fresh chat with a
 * prefilled ask is the best available.
 */
export function RefineInChatButton({
  conversationId,
  subject,
}: {
  conversationId?: string | null;
  subject: string;
}) {
  const { t } = useTranslation();
  const label = conversationId ? t("drafts.refineInChat") : t("drafts.refine");
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      className="icon-refine hover:bg-accent/10 hover:text-accent"
      onClick={(e) => {
        e.stopPropagation();
        revealChat();
        if (conversationId) sendChatCommand({ kind: "open", conversationId });
        else sendChatCommand({ kind: "prefill", text: t("drafts.refinePrompt", { subject }) });
      }}
      title={label}
      aria-label={label}
    >
      <Sparkles />
    </Button>
  );
}

/** The cancel/save footer an in-place draft edit reveals once it is dirty. */
export function EditSaveActions({
  saving,
  busy,
  onCancel,
  onSave,
}: {
  saving: boolean;
  busy: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex justify-end gap-2">
      <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving || busy}>
        {t("common.cancel")}
      </Button>
      <Button size="sm" onClick={onSave} disabled={busy} loading={saving}>
        {saving ? t("common.saving") : t("drafts.save")}
      </Button>
    </div>
  );
}
