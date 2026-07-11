import type { AccountColor, AgentCard, CardAccount } from "@trailin/shared";
import { BriefingCard } from "./BriefingCard";
import { ChoicesCard } from "./ChoicesCard";
import { EmailDraftCard } from "./EmailDraftCard";
import { EmailHitsCard } from "./EmailHitsCard";
import { EmailThreadCard } from "./EmailThreadCard";

/**
 * Registry mapping an `AgentCard.kind` to its presentation component,
 * resolving the account's hex from `colors` by `accountId` before handing it
 * down. Falls through to `null` for a `kind` this switch doesn't recognize —
 * the server can ship a new card kind before this client has shipped the
 * component for it, and that must degrade silently rather than crash chat.
 */
export function AgentCardView({ card, colors }: { card: AgentCard; colors?: AccountColor[] }) {
  const hex = (account?: CardAccount) =>
    account ? colors?.find((c) => c.accountId === account.accountId)?.hex : undefined;

  switch (card.kind) {
    case "email_hits":
      return <EmailHitsCard card={card} color={hex(card.account)} />;
    case "email_thread":
      return <EmailThreadCard card={card} color={hex(card.account)} />;
    case "email_draft":
      return <EmailDraftCard card={card} color={hex(card.account)} />;
    case "briefing":
      return <BriefingCard card={card} colors={colors} />;
    case "choices":
      return <ChoicesCard card={card} colors={colors} />;
    default:
      return null;
  }
}
