import type { AgentCard } from "@marlen/shared";
import { Phone, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { LEAD_PRIORITY_TONE, LEAD_STATUS_TONE } from "@/features/leads/leadTone";
import { relativeTime } from "@/lib/dates";
import { CardShell } from "./CardShell";

type LeadData = Extract<AgentCard, { kind: "lead" }>;

/**
 * A leads-directory row the agent surfaced in chat: name + status/priority
 * badges up top, the interest and notes, then a mono meta line (email, phone,
 * persona, language, last contact). Read-only — the Leads panel owns editing.
 */
export function LeadCard({ card }: { card: LeadData }) {
  const { t, i18n } = useTranslation();
  const { lead } = card;

  return (
    <CardShell icon={UserRound} label={t("chat.cards.lead.badge")} title={lead.name || lead.email}>
      <div className="flex flex-col gap-2 px-4 pb-4 pt-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={LEAD_STATUS_TONE[lead.status]}>{t(`leads.status.${lead.status}`)}</Badge>
          {lead.priority && (
            <Badge
              variant={LEAD_PRIORITY_TONE[lead.priority]}
              aria-label={t("leads.priorityLabel")}
            >
              {lead.priority}
            </Badge>
          )}
        </div>

        {lead.interest && <p className="text-sm">{lead.interest}</p>}
        {lead.notes && (
          <p className="whitespace-pre-wrap text-xs text-muted-foreground">{lead.notes}</p>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-2xs text-muted-foreground tabular-nums">
          <span className="truncate">{lead.email}</span>
          {lead.phone && (
            <span className="flex items-center gap-1">
              <Phone className="h-3 w-3" /> {lead.phone}
            </span>
          )}
          {lead.persona && <span>{lead.persona}</span>}
          {lead.language && (
            <span>
              {t("leads.language")}: {lead.language}
            </span>
          )}
          <span>
            {lead.lastInboundAt
              ? t("leads.lastInbound", { time: relativeTime(lead.lastInboundAt, i18n.language) })
              : t("leads.noInbound")}
          </span>
          <span>
            {lead.lastOutboundAt
              ? t("leads.lastOutbound", { time: relativeTime(lead.lastOutboundAt, i18n.language) })
              : t("leads.noOutbound")}
          </span>
        </div>
      </div>
    </CardShell>
  );
}
