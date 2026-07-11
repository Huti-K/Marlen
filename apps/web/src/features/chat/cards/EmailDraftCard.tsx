import type { AgentCard } from "@trailin/shared";
import { ExternalLink, PenLine } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { openExternal } from "@/lib/utils";
import { CardBodyText, CardShell } from "./CardShell";

type EmailDraftData = Extract<AgentCard, { kind: "email_draft" }>;

/** The create-draft preview — the card most worth getting right, since it's what actually gets sent. */
export function EmailDraftCard({ card, color }: { card: EmailDraftData; color?: string }) {
  const { t } = useTranslation();
  const { account, draft } = card;
  const webUrl = draft.webUrl;

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
        webUrl ? (
          <Button
            variant="ghost"
            size="icon-xs"
            className="shrink-0"
            onClick={() => openExternal(webUrl)}
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
                  <span className="font-mono text-2xs text-muted-foreground">{label}</span>
                  <span className="truncate text-xs text-foreground/90">{list.join(", ")}</span>
                </React.Fragment>
              ),
          )}
        </div>

        <CardBodyText text={draft.body} />

        {draft.signatureAppended && (
          <p className="text-xs text-muted-foreground/70">{t("chat.cards.draft.signatureNote")}</p>
        )}
      </div>
    </CardShell>
  );
}
