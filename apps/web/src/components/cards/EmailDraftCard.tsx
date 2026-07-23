import type { AgentCard } from "@marlen/shared";
import { formatFileSize } from "@marlen/shared";
import { useQuery } from "@tanstack/react-query";
import { AudioLines, BookmarkCheck, Paperclip, PenLine } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { DraftActionDialog, useDraftActions } from "@/components/draftActions";
import { ThreadHistory } from "@/components/ThreadHistory";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OpenExternalButton } from "@/components/ui/open-external-button";
import { api, isNotFound } from "@/lib/api";
import { toast } from "@/lib/toast";
import { CardBodyText, CardShell } from "./CardShell";

type EmailDraftData = Extract<AgentCard, { kind: "email_draft" }>;

/** The draft's fate as this card knows it. `open` covers both "still a live
 *  draft" and "we haven't checked yet" — the status fetch is a local DB read
 *  that resolves fast enough that a separate loading state isn't worth it.
 *  `gone` is a 404 hit while sending/discarding: the draft vanished upstream
 *  outside this card's own action. */
type DraftCardStatus = "open" | "kept" | "sent" | "discarded" | "gone";

/** localStorage flag for a card manually collapsed via Keep — cleared by
 *  clicking the collapsed line back open. */
function keepStorageKey(draftId: string): string {
  return `marlen-draft-keep:${draftId}`;
}

/** The create-draft preview — the card most worth getting right, since it's what actually gets sent. */
export function EmailDraftCard({ card, color }: { card: EmailDraftData; color?: string }) {
  const { t } = useTranslation();
  const { account, draft } = card;
  const accountId = account?.accountId;
  // A proposal card: the draft exists only in Marlen until kept. Cards with a
  // draftId front a real mailbox draft (created by keeping, an automation, or
  // the pre-proposal era).
  const proposalId = draft.draftId ? undefined : draft.proposalId;
  // Without an id to act on (or, for mailbox drafts, a known account) the
  // card falls back to a read-only preview.
  const canAct = Boolean(proposalId || (accountId && draft.draftId));
  const keepKey = keepStorageKey(draft.draftId ?? draft.proposalId ?? "");

  // The action's own outcome; wins over the fetched status so the card flips
  // immediately. The "drafts" topic keeps the query side fresh when the draft
  // is actioned elsewhere (e.g. approved from Home).
  const [localStatus, setLocalStatus] = React.useState<DraftCardStatus | null>(null);
  // localStorage "kept" is the pre-proposal acknowledgement for mailbox-draft
  // cards; a proposal's kept state is server truth via its status.
  const [kept, setKept] = React.useState(
    () => !proposalId && canAct && localStorage.getItem(keepKey) === "1",
  );
  // The mailbox link learned from keeping; the stored proposal card has none.
  const [keptWebUrl, setKeptWebUrl] = React.useState<string | null>(null);
  const [keeping, setKeeping] = React.useState(false);
  const webUrl = keptWebUrl ?? draft.webUrl;

  const statusQuery = useQuery({
    queryKey: ["drafts", "status", accountId, proposalId ?? draft.draftId],
    queryFn: async (): Promise<{ status: DraftCardStatus }> => {
      if (proposalId) {
        const result = await api.proposalStatus(proposalId);
        return { status: result.status === "proposed" ? "open" : result.status };
      }
      return api.draftStatus(accountId as string, draft.draftId as string);
    },
    enabled: canAct && !kept,
    // 404 (no snapshot — the draft wasn't agent-written) or any other
    // failure: treat as unknown, keep live actions.
    retry: false,
  });
  const status: DraftCardStatus = localStatus ?? statusQuery.data?.status ?? "open";

  // Keeping a proposal is what creates the real mailbox draft (it then also
  // waits on Home); on a mailbox-draft card it only acknowledges the card.
  const keep = async () => {
    if (!proposalId) {
      localStorage.setItem(keepKey, "1");
      setKept(true);
      return;
    }
    setKeeping(true);
    try {
      const result = await api.keepProposal(proposalId);
      if (result.webUrl) setKeptWebUrl(result.webUrl);
      setLocalStatus("kept");
    } catch (err) {
      if (isNotFound(err)) setLocalStatus("gone");
      else toast.error(err);
    } finally {
      setKeeping(false);
    }
  };

  const reopen = () => {
    localStorage.removeItem(keepKey);
    setKept(false);
  };

  const actions = useDraftActions({
    send: async () => {
      try {
        if (proposalId) {
          const result = await api.keepProposal(proposalId, { send: true });
          if (result.webUrl) setKeptWebUrl(result.webUrl);
          setLocalStatus(result.sent ? "sent" : "kept");
          return;
        }
        if (!accountId || !draft.draftId) return;
        await api.sendDraft(accountId, draft.draftId);
        setLocalStatus("sent");
      } catch (err) {
        if (isNotFound(err)) setLocalStatus("gone");
        else toast.error(err);
      }
    },
    discard: async () => {
      try {
        if (proposalId) {
          await api.discardProposal(proposalId);
          setLocalStatus("discarded");
          return;
        }
        if (!accountId || !draft.draftId) return;
        await api.deleteDraft(accountId, draft.draftId);
        setLocalStatus("discarded");
      } catch (err) {
        if (isNotFound(err)) setLocalStatus("gone");
        else toast.error(err);
      }
    },
  });

  const recipients: Array<[string, string[] | undefined]> = [
    [t("chat.cards.draft.to"), draft.to],
    [t("chat.cards.draft.cc"), draft.cc],
    [t("chat.cards.draft.bcc"), draft.bcc],
  ];

  return (
    <CardShell
      icon={PenLine}
      label={t("chat.cards.draft.badge")}
      title={draft.subject || t("chat.cards.noSubject")}
      account={account}
      color={color}
      action={
        <>
          {/* Provenance: the learned style directives this draft was written
              under; the tooltip lists them, the memory itself lives on the
              Knowledge page. */}
          {card.voiceDirectives && card.voiceDirectives.length > 0 && (
            <Badge
              variant="muted"
              className="shrink-0"
              data-tooltip={card.voiceDirectives.join("\n")}
            >
              <AudioLines aria-hidden />
              {t("chat.cards.draft.voice")}
            </Badge>
          )}
          {/* The open-in-provider link stays meaningful for an open or
              just-sent draft (the message still exists there); a
              discarded/gone one has nothing left to open. */}
          {webUrl && status !== "discarded" && status !== "gone" && (
            <OpenExternalButton
              url={webUrl}
              label={t("chat.cards.draft.open")}
              className="shrink-0"
            />
          )}
        </>
      }
    >
      {kept ? (
        <div className="px-4 pb-4 pt-0.5">
          <button
            type="button"
            onClick={reopen}
            className="flex w-fit items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <BookmarkCheck className="h-3.5 w-3.5 shrink-0" />
            {t("chat.cards.draft.kept")}
          </button>
        </div>
      ) : status === "kept" ? (
        // A kept proposal became a real mailbox draft: terminal here, it now
        // lives in the approval list on Home (and the mailbox).
        <div className="px-4 pb-4 pt-0.5">
          <span className="flex w-fit items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <BookmarkCheck className="h-3.5 w-3.5 shrink-0" />
            {t("chat.cards.draft.kept")}
          </span>
        </div>
      ) : status === "sent" ? (
        <div className="px-4 pb-4 pt-0.5">
          <Badge variant="success">{t("chat.cards.draft.sentLabel")}</Badge>
        </div>
      ) : status === "discarded" ? (
        <div className="px-4 pb-4 pt-0.5">
          <Badge variant="destructive">{t("chat.cards.draft.discardedLabel")}</Badge>
        </div>
      ) : status === "gone" ? (
        <div className="px-4 pb-4 pt-0.5">
          <Badge variant="muted">{t("chat.cards.draft.goneLabel")}</Badge>
        </div>
      ) : (
        <div className="flex flex-col gap-3 px-4 pb-4 pt-0.5">
          {/* Recipient header, set like a real mail header: mono labels, plain values. */}
          <div className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1">
            {recipients.map(
              ([label, list]) =>
                list &&
                list.length > 0 && (
                  <React.Fragment key={label}>
                    <span className="font-mono text-2xs text-muted-foreground">{label}</span>
                    <span className="truncate text-xs text-foreground/90">{list.join(", ")}</span>
                  </React.Fragment>
                ),
            )}
          </div>

          <CardBodyText text={draft.body} />

          {/* The signature the server appends on send — shown so the card reads
              like the outgoing mail, visually set off as the fixed block it is. */}
          {draft.signatureText && (
            <p className="whitespace-pre-line border-t border-border/60 pt-2 text-sm leading-relaxed text-muted-foreground">
              {draft.signatureText}
            </p>
          )}

          {draft.attachments && draft.attachments.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-2xs text-muted-foreground tabular-nums">
              {draft.attachments.map((attachment) => (
                <span key={attachment.filename} className="flex items-center gap-1">
                  <Paperclip className="h-3 w-3 shrink-0" />
                  {attachment.filename}
                  {attachment.size !== undefined && ` (${formatFileSize(attachment.size)})`}
                </span>
              ))}
            </div>
          )}

          {accountId && draft.threadId && (
            <ThreadHistory accountId={accountId} threadId={draft.threadId} />
          )}

          {canAct && (
            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void keep()}
                disabled={actions.busy || keeping}
                loading={keeping}
              >
                {t("chat.cards.draft.keep")}
              </Button>
              <Button
                variant="ghost-danger"
                size="sm"
                onClick={() => actions.arm("discard")}
                disabled={actions.busy}
              >
                {t("chat.cards.draft.discard")}
              </Button>
              <Button size="sm" onClick={() => actions.arm("send")} disabled={actions.busy}>
                {t("chat.cards.draft.send")}
              </Button>
            </div>
          )}
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
            description: t("chat.cards.draft.sendConfirm"),
          },
          discard: {
            title: t("chat.cards.draft.discard"),
            description: t("chat.cards.draft.discardConfirm"),
          },
        }}
      />
    </CardShell>
  );
}
