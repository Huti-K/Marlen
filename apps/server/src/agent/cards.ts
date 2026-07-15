import type { AgentCard, MessageCard } from "@trailin/shared";
import { isRecord } from "../util.js";
import { parseCardAccount } from "./card/common.js";
import { CARD_KINDS } from "./card/kinds.js";

/**
 * Validates tool `details` payloads into `AgentCard`s the chat can render.
 * `parseAgentCard` is the last line of defense before a card reaches the
 * client: `details` is `unknown` by the time it gets here (it round-trips
 * through pi's event stream as `any`), so every field is checked rather
 * than trusted, and nothing here ever throws. The actual per-kind shape
 * rules live in agent/card/kinds.ts, shared with the tool that builds each
 * kind — this function is just the dispatch through the CARD_KINDS registry.
 */
export function parseAgentCard(details: unknown): AgentCard | undefined {
  try {
    if (!isRecord(details)) return undefined;
    const kind = details.kind;
    // Object.hasOwn (not `in`) so a kind string naming an Object.prototype
    // member can't reach the lookup; after the guard the string is known to
    // be a registry key, which is what the narrowing cast records.
    if (typeof kind !== "string" || !Object.hasOwn(CARD_KINDS, kind)) return undefined;
    const def = CARD_KINDS[kind as AgentCard["kind"]];
    return def.parse(details, parseCardAccount(details.account));
  } catch {
    return undefined;
  }
}

/**
 * Parses a messages.cards JSON blob back into validated cards for the API.
 * Same trust posture as parseAgentCard: the column is our own write, but it
 * round-trips through JSON, so anything malformed is dropped rather than
 * crashing message restore.
 */
export function parseStoredCards(raw: string | null | undefined): MessageCard[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    const cards: MessageCard[] = [];
    for (const entry of parsed) {
      if (!isRecord(entry) || typeof entry.toolCallId !== "string") continue;
      const card = parseAgentCard(entry.card);
      if (card) cards.push({ toolCallId: entry.toolCallId, card });
    }
    return cards.length > 0 ? cards : undefined;
  } catch {
    return undefined;
  }
}
