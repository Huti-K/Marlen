import {
  type AgentCard,
  type AttachmentItem,
  BRIEFING_PRIORITIES,
  type BriefingItem,
  type BriefingPriority,
  type BriefingRollup,
  type CardAccount,
  type ChoiceOption,
  type ConnectedAccount,
  type DraftPreview,
  type EmailRef,
  type MessageCard,
} from "@trailin/shared";
import { isNonEmptyString, isRecord } from "../utils/util.js";
import { parseEmailRef } from "./emailRefs.js";

/**
 * The AgentCard system: every kind's shape rules and the parse dispatch that
 * turns tool `details` payloads into cards the chat can render. Each kind
 * keeps the same split: coerce* validates one untrusted entry, build*
 * assembles the card its emitting tool publishes (agent/emailToolset.ts's draft
 * tools, briefingTool, choicesTool, attachmentTool), and its arm in
 * CARD_PARSERS (below) revalidates a stored or round-tripped payload. What a
 * card means for conversation focus lives with the focus logic itself
 * (focusFromCard in focus.ts).
 */

/** The AgentCard union member for one kind. */
export type CardOf<K extends AgentCard["kind"]> = Extract<AgentCard, { kind: K }>;

/**
 * The reminder a card-emitting tool appends to its result text: the card
 * already renders `subject` to the user, so the model's reply should react to
 * it — per `instruction` — instead of restating its contents. One phrasing,
 * shared by every card-emitting tool, so this instruction reads the same
 * everywhere rather than being reworded per tool.
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

// email_draft — a saved or rewritten draft preview. The create/update draft
// tools (agent/emailToolset.ts) assemble the raw draft object from trusted local
// state; both they and parseAgentCard funnel through buildEmailDraftCard so
// the required-field rule lives once.

/** Validates one raw attachment entry of a draft preview. `filename` is required; a malformed size is dropped, not the entry. */
function coerceDraftAttachment(value: unknown): { filename: string; size?: number } | undefined {
  if (!isRecord(value) || !isNonEmptyString(value.filename)) return undefined;
  return {
    filename: value.filename,
    ...(typeof value.size === "number" && Number.isFinite(value.size)
      ? { size: Math.max(0, Math.round(value.size)) }
      : {}),
  };
}

/** Validates a raw draft-shaped value. draftId/subject/body are required; everything else is dropped when malformed rather than failing the whole draft. */
export function coerceDraftPreview(value: unknown): DraftPreview | undefined {
  if (!isRecord(value)) return undefined;
  const { draftId, threadId, subject, to, cc, bcc, body, webUrl, attachments } = value;
  if (!isString(draftId) || !isString(subject) || !isString(body)) return undefined;
  const ccList = toStringArray(cc);
  const bccList = toStringArray(bcc);
  const attachmentList = Array.isArray(attachments)
    ? attachments
        .map(coerceDraftAttachment)
        .filter((a): a is { filename: string; size?: number } => a !== undefined)
    : undefined;
  return {
    draftId,
    ...(isString(threadId) ? { threadId } : {}),
    subject,
    to: toStringArray(to) ?? [],
    ...(ccList ? { cc: ccList } : {}),
    ...(bccList ? { bcc: bccList } : {}),
    body,
    ...(isString(webUrl) ? { webUrl } : {}),
    ...(attachmentList && attachmentList.length > 0 ? { attachments: attachmentList } : {}),
  };
}

export interface EmailDraftCardInput {
  account?: CardAccount;
  /** Raw draft-shaped value, coerced via coerceDraftPreview. */
  draft: unknown;
}

/** Builds the "email_draft" card, or undefined when `draft` is missing a required field. */
export function buildEmailDraftCard(input: EmailDraftCardInput): CardOf<"email_draft"> | undefined {
  const draft = coerceDraftPreview(input.draft);
  if (!draft) return undefined;
  return { kind: "email_draft", ...(input.account ? { account: input.account } : {}), draft };
}

function parseEmailDraftCard(
  details: Record<string, unknown>,
  account: CardAccount | undefined,
): CardOf<"email_draft"> | undefined {
  return buildEmailDraftCard({ account, draft: details.draft });
}

// attachments — a message's attachments, each with the handle its row actions
// (open in the viewer, save to library) need. list_attachments builds it from
// the provider's live listing plus the resolved account and the server-decided
// viewable/saveable flags; the parse arm trusts a stored card's own item
// fields. accountId/messageId/filename together address the bytes through
// GET /api/mail/attachments/open.

/** Validates a raw attachment-shaped value. accountId/messageId/filename are required; the flags default to false when absent. */
export function coerceAttachmentItem(value: unknown): AttachmentItem | undefined {
  if (!isRecord(value)) return undefined;
  const { accountId, messageId, filename, mimeType, size, viewable, saveable } = value;
  if (!isNonEmptyString(accountId) || !isNonEmptyString(messageId) || !isNonEmptyString(filename)) {
    return undefined;
  }
  return {
    accountId,
    messageId,
    filename,
    ...(isNonEmptyString(mimeType) ? { mimeType } : {}),
    ...(typeof size === "number" && Number.isFinite(size)
      ? { size: Math.max(0, Math.round(size)) }
      : {}),
    viewable: viewable === true,
    saveable: saveable === true,
  };
}

export interface AttachmentsCardInput {
  account?: CardAccount;
  subject?: string;
  /** Raw attachment-shaped values, coerced one by one — malformed entries are dropped, not the whole card. */
  items: unknown[];
}

/** Builds the "attachments" card. */
export function buildAttachmentsCard(input: AttachmentsCardInput): CardOf<"attachments"> {
  const items = input.items
    .map(coerceAttachmentItem)
    .filter((i): i is AttachmentItem => i !== undefined);
  return {
    kind: "attachments",
    ...(input.account ? { account: input.account } : {}),
    ...(input.subject ? { subject: input.subject } : {}),
    items,
  };
}

function parseAttachmentsCard(
  details: Record<string, unknown>,
  account: CardAccount | undefined,
): CardOf<"attachments"> | undefined {
  if (!Array.isArray(details.items)) return undefined;
  return buildAttachmentsCard({
    account,
    subject: isString(details.subject) ? details.subject : undefined,
    items: details.items,
  });
}

// choices — clickable buttons the user picks from. present_choices
// (choicesTool.ts) attaches each option's bare ref
// via its own `account`/`threadId` parameters — never from a raw `ref` field
// — while the parse arm trusts a stored card's own `ref` field, parsed via
// parseEmailRef; both funnel an option's label/detail/reply through
// coerceChoiceOption, with the ref resolved by each caller its own way.

/** Validates a raw option-shaped value against an already-resolved ref. `label` is the only required field. */
export function coerceChoiceOption(
  value: unknown,
  ref: EmailRef | undefined,
): ChoiceOption | undefined {
  if (!isRecord(value)) return undefined;
  const { label, detail, reply } = value;
  if (!isNonEmptyString(label)) return undefined;
  return {
    label,
    ...(isNonEmptyString(detail) ? { detail } : {}),
    ...(isNonEmptyString(reply) ? { reply } : {}),
    ...(ref ? { ref } : {}),
  };
}

/** Builds the "choices" card from already-validated options — present_choices has its own min/max option-count gate before this ever runs. */
export function buildChoicesCard(question: string, options: ChoiceOption[]): CardOf<"choices"> {
  return { kind: "choices", question, options };
}

/**
 * Unlike the other kinds, a choices card carries no top-level `account` —
 * options are self-contained via their own `ref`, parsed here straight off
 * each raw option.
 */
function parseChoicesCard(details: Record<string, unknown>): CardOf<"choices"> | undefined {
  if (!isNonEmptyString(details.question) || !Array.isArray(details.options)) return undefined;
  const options = details.options
    .map((raw) => coerceChoiceOption(raw, parseEmailRef(isRecord(raw) ? raw.ref : undefined)))
    .filter((o): o is ChoiceOption => o !== undefined);
  if (options.length === 0) return undefined;
  return buildChoicesCard(details.question, options);
}

// briefing — a triaged, cross-account inbox digest. compose_briefing
// (briefingTool.ts) resolves the model's account name/address string against
// connected accounts and builds the webmail deep link from threadId + account
// before calling coerceBriefingItem, while the parse arm trusts a stored
// card's `accountId`/`webUrl` fields directly — both funnel item/rollup
// validation through the coerce functions, so the required-field rule and the
// priority fallback live in exactly one place. This trusted/untrusted
// asymmetry is why briefing's coercion stays hand-written rather than leaning
// on anything generic.

export function isBriefingPriority(value: unknown): value is BriefingPriority {
  return typeof value === "string" && (BRIEFING_PRIORITIES as readonly string[]).includes(value);
}

/**
 * Coerces a raw item-shaped record into a BriefingItem, given an
 * already-resolved accountId and webUrl. Both accountId and webUrl are taken
 * only from the resolved parameters, never read off the raw model-supplied
 * `value` — the model can't be trusted to name our internal account ids or
 * construct a correct provider deep link. Drops anything missing threadId,
 * sender, subject or gist rather than throwing; an unrecognized priority
 * degrades to the least-pressing tier rather than dropping the item.
 */
export function coerceBriefingItem(
  value: unknown,
  accountId: string | undefined,
  webUrl: string | undefined,
): BriefingItem | undefined {
  if (!isRecord(value)) return undefined;
  const {
    threadId,
    messageId,
    sender,
    senderEmail,
    subject,
    gist,
    priority,
    deadline,
    receivedAt,
    draftId,
  } = value;
  if (
    !isNonEmptyString(threadId) ||
    !isNonEmptyString(sender) ||
    !isNonEmptyString(subject) ||
    !isNonEmptyString(gist)
  ) {
    return undefined;
  }
  return {
    threadId,
    ...(isNonEmptyString(messageId) ? { messageId } : {}),
    ...(accountId ? { accountId } : {}),
    sender,
    ...(isNonEmptyString(senderEmail) ? { senderEmail } : {}),
    subject,
    gist,
    priority: isBriefingPriority(priority) ? priority : "fyi",
    ...(isNonEmptyString(deadline) ? { deadline } : {}),
    ...(isNonEmptyString(receivedAt) ? { receivedAt } : {}),
    ...(isNonEmptyString(draftId) ? { draftId } : {}),
    ...(webUrl ? { webUrl } : {}),
  };
}

/** The parse arm's per-item coercion: accountId/webUrl are trusted straight off the stored item, unlike compose_briefing's server-resolved values. */
function parseBriefingItem(value: unknown): BriefingItem | undefined {
  if (!isRecord(value)) return undefined;
  const accountId = isNonEmptyString(value.accountId) ? value.accountId : undefined;
  const webUrl = isNonEmptyString(value.webUrl) ? value.webUrl : undefined;
  return coerceBriefingItem(value, accountId, webUrl);
}

/**
 * Coerces a raw rollup-shaped record into a BriefingRollup, given its items
 * already coerced by the caller (compose_briefing resolves each item's account
 * and webUrl server-side; the parse arm reads them off the stored item). Keeps
 * the group only when it has a label and at least one surviving item — an empty
 * group has nothing to render.
 */
export function coerceBriefingRollup(
  value: unknown,
  items: BriefingItem[],
): BriefingRollup | undefined {
  if (!isRecord(value)) return undefined;
  if (!isNonEmptyString(value.label) || items.length === 0) return undefined;
  return { label: value.label, items };
}

function parseBriefingRollup(value: unknown): BriefingRollup | undefined {
  if (!isRecord(value)) return undefined;
  const items = Array.isArray(value.items)
    ? value.items.map(parseBriefingItem).filter((i): i is BriefingItem => i !== undefined)
    : [];
  return coerceBriefingRollup(value, items);
}

export interface BriefingCardInput {
  headline?: string;
  periodLabel?: string;
  /** Every account the briefing covered — omitted entirely when empty, so empty ones still get credit only when actually listed. */
  accounts?: CardAccount[];
  items: BriefingItem[];
  rollups?: BriefingRollup[];
  scanned?: number;
}

/** Builds the "briefing" card from already-validated items/rollups — both callers coerce their raw entries themselves (see coerceBriefingItem/coerceBriefingRollup) before reaching this. */
export function buildBriefingCard(input: BriefingCardInput): CardOf<"briefing"> {
  return {
    kind: "briefing",
    ...(input.headline ? { headline: input.headline } : {}),
    ...(input.periodLabel ? { periodLabel: input.periodLabel } : {}),
    ...(input.accounts && input.accounts.length > 0 ? { accounts: input.accounts } : {}),
    items: input.items,
    ...(input.rollups && input.rollups.length > 0 ? { rollups: input.rollups } : {}),
    ...(input.scanned !== undefined ? { scanned: input.scanned } : {}),
  };
}

/** Unlike the other kinds, a briefing carries every account it touched as an array rather than a single top-level `account`. */
function parseBriefingCard(details: Record<string, unknown>): CardOf<"briefing"> | undefined {
  if (!Array.isArray(details.items)) return undefined;
  const items = details.items
    .map(parseBriefingItem)
    .filter((i): i is BriefingItem => i !== undefined);
  const accountsList = Array.isArray(details.accounts)
    ? details.accounts.map(parseCardAccount).filter((a): a is CardAccount => a !== undefined)
    : undefined;
  const rollups = Array.isArray(details.rollups)
    ? details.rollups.map(parseBriefingRollup).filter((r): r is BriefingRollup => r !== undefined)
    : undefined;
  return buildBriefingCard({
    headline: isString(details.headline) ? details.headline : undefined,
    periodLabel: isString(details.periodLabel) ? details.periodLabel : undefined,
    accounts: accountsList,
    items,
    rollups,
    scanned: typeof details.scanned === "number" ? details.scanned : undefined,
  });
}

/**
 * One parse arm per kind. The mapped type keeps this record exhaustive:
 * adding a kind to the shared AgentCard union fails compilation here until
 * the kind supplies its parse arm. Each arm gets the already-parsed top-level
 * `details.account`; kinds that carry no top-level account ignore it.
 */
const CARD_PARSERS: {
  [K in AgentCard["kind"]]: (
    details: Record<string, unknown>,
    account: CardAccount | undefined,
  ) => CardOf<K> | undefined;
} = {
  email_draft: parseEmailDraftCard,
  attachments: parseAttachmentsCard,
  choices: parseChoicesCard,
  briefing: parseBriefingCard,
};

/**
 * Validates a tool `details` payload into an `AgentCard` the chat can render.
 * The last line of defense before a card reaches the client: `details` is
 * `unknown` by the time it gets here (it round-trips through pi's event
 * stream as `any`), so every field is checked rather than trusted, and
 * nothing here ever throws — this function is just the dispatch through the
 * CARD_PARSERS record above.
 */
export function parseAgentCard(details: unknown): AgentCard | undefined {
  try {
    if (!isRecord(details)) return undefined;
    const kind = details.kind;
    // Object.hasOwn (not `in`) so a kind string naming an Object.prototype
    // member can't reach the lookup; after the guard the string is known to
    // be a parser key, which is what the narrowing cast records.
    if (typeof kind !== "string" || !Object.hasOwn(CARD_PARSERS, kind)) return undefined;
    const parse = CARD_PARSERS[kind as AgentCard["kind"]];
    return parse(details, parseCardAccount(details.account));
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
