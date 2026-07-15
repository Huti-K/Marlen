import type { AgentCard, CardAccount, ConnectedAccount } from "@trailin/shared";
import { isRecord } from "../../util.js";
import type { FocusPatch } from "../focus.js";

/**
 * The card-kind mechanism. Every AgentCard kind is described by one
 * CardKindDef in kinds.ts's CARD_KINDS registry; parseAgentCard (cards.ts)
 * and focusFromCard (focus.ts) dispatch through that registry, so adding a
 * kind means adding one entry rather than editing parallel switches. The
 * low-level coercion helpers the kind definitions share live here too.
 */

/** The AgentCard union member for one kind. */
export type CardOf<K extends AgentCard["kind"]> = Extract<AgentCard, { kind: K }>;

/**
 * One card kind's registry entry. The parameter is the card type itself (not
 * the kind key — variance through `CardOf` isn't measurable), and parse/focus
 * are declared as methods, not function properties, so their parameters check
 * bivariantly: together these keep a per-kind def assignable to the
 * card-erased `CardKindDef` the dispatchers hold — sound because the registry
 * is keyed by kind, so the def fetched for a card's own `kind` always matches
 * that card.
 */
export interface CardKindDef<C extends AgentCard = AgentCard> {
  /**
   * parseAgentCard's arm for this kind — the last line of defense before an
   * untrusted `details` payload reaches the client, so every field is
   * checked rather than trusted. `account` is the already-parsed top-level
   * `details.account`; kinds that carry no top-level account ignore it.
   */
  parse(details: Record<string, unknown>, account: CardAccount | undefined): C | undefined;
  /** What this card says about where the conversation is (focusFromCard's arm). */
  focus(card: C): FocusPatch | null;
  /** The reminder the emitting tool appends to its result text (built via cardNote). */
  note: string;
}

/**
 * The reminder a card-emitting tool appends to its result text: the card
 * already renders `subject` to the user, so the model's reply should react to
 * it — per `instruction` — instead of restating its contents. One phrasing,
 * shared by every card kind, so this instruction reads the same everywhere
 * rather than being reworded per tool.
 */
export function cardNote(subject: string, instruction: string): string {
  return `\n\n[The user sees ${subject} as a card in the conversation. ${instruction}]`;
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** Coerces a header-ish value (string, string[], or anything else) to string[]. */
export function toStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const arr = value.filter(isString);
    return arr.length > 0 ? arr : undefined;
  }
  return isString(value) && value.length > 0 ? [value] : undefined;
}

/** Maps a resolved connected account onto a card's account slot. */
export function toCardAccount(account: ConnectedAccount): CardAccount {
  return {
    accountId: account.id,
    name: account.name,
    app: account.app,
    appName: account.appName,
    imgSrc: account.imgSrc,
  };
}

/** Defensive parse of an untrusted `details.account`-shaped value. */
export function parseCardAccount(value: unknown): CardAccount | undefined {
  if (!isRecord(value)) return undefined;
  const { accountId, name, app, appName, imgSrc } = value;
  if (!isString(accountId) || !isString(name) || !isString(app)) return undefined;
  return {
    accountId,
    name,
    app,
    ...(isString(appName) ? { appName } : {}),
    ...(isString(imgSrc) ? { imgSrc } : {}),
  };
}
