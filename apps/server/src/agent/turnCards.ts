import type { AgentCard, MessageCard } from "@trailin/shared";
import { db, schema } from "../db/index.js";
import { emitServerEvent } from "../events.js";

/**
 * Collects the cards one agent turn emits so the caller can persist them with
 * the assistant message, and records a draft_links row for every draft the
 * turn creates — that link is what lets the Drafts list reopen the exact
 * conversation a draft came from. Used by both the chat route and the
 * automation runner (a run id doubles as its conversation id).
 */
export function collectTurnCards(conversationId: string): {
  cards: MessageCard[];
  onCard: (toolCallId: string, card: AgentCard) => void;
} {
  const cards: MessageCard[] = [];

  const onCard = (toolCallId: string, card: AgentCard) => {
    // A retried tool call replaces its earlier card, same as the live chat UI.
    const existing = cards.findIndex((c) => c.toolCallId === toolCallId);
    if (existing >= 0) cards[existing] = { toolCallId, card };
    else cards.push({ toolCallId, card });

    if (card.kind === "email_draft" && card.draft.draftId) {
      // Fire-and-forget: the link is a navigation nicety and must never fail
      // or stall the turn. Re-emit "drafts" once the link exists — the draft
      // tool's own emit can race ahead of this insert, and the refetch it
      // triggers would miss the conversationId.
      db.insert(schema.draftLinks)
        .values({
          draftId: card.draft.draftId,
          accountId: card.account?.accountId ?? "",
          conversationId,
          createdAt: new Date().toISOString(),
        })
        .onConflictDoUpdate({
          target: schema.draftLinks.draftId,
          set: { conversationId },
        })
        .then(() => emitServerEvent("drafts"))
        .catch(() => {});
    }
  };

  return { cards, onCard };
}

/** Serializes a turn's cards for the messages.cards column; null when there were none. */
export function serializeTurnCards(cards: MessageCard[]): string | null {
  return cards.length > 0 ? JSON.stringify(cards) : null;
}
