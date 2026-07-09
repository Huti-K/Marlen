import * as React from "react";
import { ExternalLink, PenLine } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AgentCard } from "@trailin/shared";
import { Button } from "@/components/ui/button";
import { CardShell } from "./CardShell";

type EmailDraftData = Extract<AgentCard, { kind: "email_draft" }>;

/** The create-draft preview — the card most worth getting right, since it's what actually gets sent. */
export function EmailDraftCard({ card, color }: { card: EmailDraftData; color?: string }) {
  const { t } = useTranslation();
  const { account, draft } = card;

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
        draft.webUrl ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:bg-secondary hover:text-foreground"
            onClick={() => window.open(draft.webUrl, "_blank", "noopener,noreferrer")}
            title={t("chat.cards.draft.open")}
            aria-label={t("chat.cards.draft.open")}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3 px-4 pb-4 pt-0.5">
        {/* Recipient header, set like a real mail header: mono labels, plain values. */}
        <div className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1">
          {recipients.map(
            ([label, list]) =>
              list &&
              list.length > 0 && (
                <React.Fragment key={label}>
                  <span className="font-mono text-[11px] text-muted-foreground">{label}</span>
                  <span className="truncate text-xs text-foreground/90">{list.join(", ")}</span>
                </React.Fragment>
              ),
          )}
        </div>

        {/* Literal draft body (what will actually be sent) — never markdown, see DraftRow.tsx:133-134. */}
        <p className="whitespace-pre-wrap text-sm leading-relaxed">
          {draft.body || t("chat.cards.emptyBody")}
        </p>

        {draft.signatureAppended && (
          <p className="text-xs text-muted-foreground/70">{t("chat.cards.draft.signatureNote")}</p>
        )}
      </div>
    </CardShell>
  );
}
