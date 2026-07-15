import {
  type AgentCard,
  type AttachmentItem,
  BRIEFING_PRIORITIES,
  type BriefingItem,
  type BriefingPriority,
  type BriefingRollup,
  type CardAccount,
  type ChoiceOption,
  type DraftPreview,
  type EmailHit,
  type EmailRef,
  type EmailThreadMessage,
} from "@trailin/shared";
import { isNonEmptyString, isRecord } from "../../util.js";
import { parseEmailRef } from "../emailRefs.js";
import {
  type CardKindDef,
  type CardOf,
  cardNote,
  isString,
  parseCardAccount,
  toStringArray,
} from "./common.js";

/**
 * Every AgentCard kind's shape rules, plus the CARD_KINDS registry that
 * cards.ts and focus.ts dispatch through. Each kind keeps the same split:
 * coerce* validates one untrusted entry, build* assembles the card its
 * emitting tool publishes (mailTools, pipedream/mcp.ts's draft tools,
 * briefingTool, choicesTool), and the kind's registry entry carries its
 * parse arm (parseAgentCard), focus extraction (focusFromCard) and the note
 * the tool appends to its result text.
 */

// email_hits — a search result list. search_mail's hits are already-typed
// local mail rows; parseAgentCard sees only `unknown` off the wire — both
// funnel through buildEmailHitsCard so a hit's required-field rule lives once.

/** Validates a raw hit-shaped value. messageId/threadId/from are required; everything else degrades to empty rather than dropping the hit. */
export function coerceEmailHit(value: unknown): EmailHit | undefined {
  if (!isRecord(value)) return undefined;
  const { messageId, threadId, accountId, subject, from, to, date, snippet } = value;
  if (!isString(messageId) || !isString(threadId) || !isString(from)) return undefined;
  return {
    messageId,
    threadId,
    ...(isNonEmptyString(accountId) ? { accountId } : {}),
    subject: isString(subject) ? subject : "",
    from,
    to: toStringArray(to) ?? [],
    date: isString(date) ? date : "",
    snippet: isString(snippet) ? snippet : "",
  };
}

export interface EmailHitsCardInput {
  account?: CardAccount;
  /** Echoed back as the card's header; always set by search_mail, even to "". */
  query?: string;
  /** Raw hit-shaped values, coerced one by one — malformed entries are dropped, not the whole card. */
  hits: unknown[];
  truncated?: boolean;
}

/** Builds the "email_hits" card. Both callers pass `truncated` only when they know it either way, so a caller that never sets it leaves the field off rather than defaulting to false. */
export function buildEmailHitsCard(input: EmailHitsCardInput): CardOf<"email_hits"> {
  const hits = input.hits.map(coerceEmailHit).filter((h): h is EmailHit => h !== undefined);
  return {
    kind: "email_hits",
    ...(input.account ? { account: input.account } : {}),
    ...(input.query !== undefined ? { query: input.query } : {}),
    hits,
    ...(input.truncated !== undefined ? { truncated: input.truncated } : {}),
  };
}

function parseEmailHitsCard(
  details: Record<string, unknown>,
  account: CardAccount | undefined,
): CardOf<"email_hits"> | undefined {
  if (!Array.isArray(details.hits)) return undefined;
  return buildEmailHitsCard({
    account,
    query: isString(details.query) ? details.query : undefined,
    hits: details.hits,
    truncated: typeof details.truncated === "boolean" ? details.truncated : undefined,
  });
}

// email_thread — a full thread read. read_thread's messages are already-typed
// mirror rows; both it and parseAgentCard funnel through buildEmailThreadCard.

/** Validates a raw message-shaped value. `from` and `body` are required; everything else degrades to empty rather than dropping the message. */
export function coerceEmailThreadMessage(value: unknown): EmailThreadMessage | undefined {
  if (!isRecord(value)) return undefined;
  const { from, to, cc, date, body } = value;
  if (!isString(from) || !isString(body)) return undefined;
  const ccList = toStringArray(cc);
  return {
    from,
    to: toStringArray(to) ?? [],
    ...(ccList ? { cc: ccList } : {}),
    date: isString(date) ? date : "",
    body,
  };
}

export interface EmailThreadCardInput {
  account?: CardAccount;
  threadId: string;
  subject?: string;
  /** Raw message-shaped values, coerced one by one — malformed entries are dropped, not the whole card. */
  messages: unknown[];
}

/** Builds the "email_thread" card. `threadId` is a required precondition the caller must have already checked. */
export function buildEmailThreadCard(input: EmailThreadCardInput): CardOf<"email_thread"> {
  const messages = input.messages
    .map(coerceEmailThreadMessage)
    .filter((m): m is EmailThreadMessage => m !== undefined);
  return {
    kind: "email_thread",
    ...(input.account ? { account: input.account } : {}),
    threadId: input.threadId,
    subject: input.subject ?? "",
    messages,
  };
}

function parseEmailThreadCard(
  details: Record<string, unknown>,
  account: CardAccount | undefined,
): CardOf<"email_thread"> | undefined {
  if (!isString(details.threadId) || !Array.isArray(details.messages)) return undefined;
  return buildEmailThreadCard({
    account,
    threadId: details.threadId,
    subject: isString(details.subject) ? details.subject : undefined,
    messages: details.messages,
  });
}

// email_draft — a saved or rewritten draft preview. The create/update draft
// tools (pipedream/mcp.ts) assemble the raw draft object from trusted local
// state; both they and parseAgentCard funnel through buildEmailDraftCard so
// the required-field rule lives once.

/** Validates a raw draft-shaped value. draftId/subject/body are required; everything else is dropped when malformed rather than failing the whole draft. */
export function coerceDraftPreview(value: unknown): DraftPreview | undefined {
  if (!isRecord(value)) return undefined;
  const { draftId, threadId, subject, to, cc, bcc, body, webUrl, signatureAppended } = value;
  if (!isString(draftId) || !isString(subject) || !isString(body)) return undefined;
  const ccList = toStringArray(cc);
  const bccList = toStringArray(bcc);
  return {
    draftId,
    ...(isString(threadId) ? { threadId } : {}),
    subject,
    to: toStringArray(to) ?? [],
    ...(ccList ? { cc: ccList } : {}),
    ...(bccList ? { bcc: bccList } : {}),
    body,
    ...(isString(webUrl) ? { webUrl } : {}),
    ...(typeof signatureAppended === "boolean" ? { signatureAppended } : {}),
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
// (choicesTool.ts) resolves each option's ref from the local mailbox mirror
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
 * One CardKindDef per kind. The mapped type keeps this record exhaustive:
 * adding a kind to the shared AgentCard union fails compilation here until
 * the kind supplies its parse arm, focus extraction and tool note.
 */
export const CARD_KINDS: { [K in AgentCard["kind"]]: CardKindDef<CardOf<K>> } = {
  email_hits: {
    parse: parseEmailHitsCard,
    // Search hits set the account and CLEAR the thread — the topic has
    // widened beyond one email.
    focus: (card) => (card.account ? { accountId: card.account.accountId, threadId: null } : null),
    note: cardNote(
      "these hits",
      "Don't re-list them in your reply — give your takeaway and say which threads are worth opening.",
    ),
  },
  email_thread: {
    parse: parseEmailThreadCard,
    // Thread cards set both the account and the thread — the conversation is
    // pinned to this one email.
    focus: (card) =>
      card.account
        ? {
            accountId: card.account.accountId,
            threadId: card.threadId,
            subject: card.subject ?? null,
          }
        : null,
    note: cardNote(
      "this thread",
      "Don't re-print or quote the messages in your reply — summarize or answer directly.",
    ),
  },
  email_draft: {
    parse: parseEmailDraftCard,
    // Draft cards follow the draft's own thread — a reply draft pins focus to
    // the thread it replies to.
    focus: (card) =>
      card.account
        ? {
            accountId: card.account.accountId,
            threadId: card.draft.threadId ?? null,
            subject: card.draft.subject ?? null,
          }
        : null,
    note: cardNote("the draft", "Don't repeat its subject or body in your reply."),
  },
  attachments: {
    parse: parseAttachmentsCard,
    // An attachments listing is an aside within a thread, not a focus move —
    // leave whatever thread the conversation is already pinned to in place.
    focus: () => null,
    note: cardNote(
      "these attachments",
      "Don't re-list them in your reply — the user opens or saves each one from the card.",
    ),
  },
  choices: {
    parse: parseChoicesCard,
    // A choices card never moves focus — it's a question, not activity in an
    // account or thread.
    focus: () => null,
    note: cardNote(
      "these choices",
      "End your turn with a short question restating what you need — the user's pick arrives as " +
        "their next message. Do not act until then.",
    ),
  },
  briefing: {
    parse: parseBriefingCard,
    // A briefing spans accounts, so it never pins the conversation to one of them.
    focus: () => null,
    note: cardNote(
      "this briefing",
      "Do not repeat the items in prose — close with exactly one line naming what needs them " +
        'first, or "Quiet otherwise — nothing urgent" if nothing does.',
    ),
  },
};
