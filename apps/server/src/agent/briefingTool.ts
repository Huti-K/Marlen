import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  BRIEFING_PRIORITIES,
  type AgentCard,
  type BriefingItem,
  type BriefingPriority,
  type BriefingRollup,
  type CardAccount,
  type ConnectedAccount,
} from "@trailin/shared";
import { listAccounts } from "../pipedream/connect.js";
import { errorMessage } from "../util.js";
import { toCardAccount } from "./cards.js";
import { findAccount } from "./knowledgeTools.js";

/**
 * Agent tool that publishes the structured "briefing" AgentCard — a triaged,
 * cross-account inbox digest grouped by how urgently each message needs the
 * user, with per-thread actions (see BriefingItem/BriefingRollup in
 * @trailin/shared for the card contract). The model only knows accounts by
 * email address, not our internal Pipedream account ids, so this tool
 * resolves `account` strings itself and drops what it can't resolve rather
 * than failing the call. Nothing here throws — a malformed argument yields a
 * text error result instead of an unhandled rejection.
 */

const text = (value: string) => ({
  content: [{ type: "text" as const, text: value }],
  details: undefined,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isBriefingPriority(value: unknown): value is BriefingPriority {
  return typeof value === "string" && (BRIEFING_PRIORITIES as readonly string[]).includes(value);
}

const PRIORITY_DESCRIPTION =
  '"urgent" when it is time-sensitive, a deadline could pass, or the user is blocked on it. ' +
  '"reply" when a real person is waiting on a reply but nothing is on fire. "action" when it ' +
  'needs a decision or task from the user and nobody is waiting. "fyi" when it is worth ' +
  "knowing and needs nothing.";

const composeBriefingTool: AgentTool = {
  name: "compose_briefing",
  label: "Compose the briefing",
  description:
    `Publish a structured, interactive briefing card for a multi-message inbox digest — ` +
    `grouped by how urgently each message needs the user, with per-thread actions. Call this ` +
    `once, at the end, after triaging every noteworthy message across the accounts reviewed ` +
    `and drafting the replies that are warranted. Give every item its real threadId from the ` +
    `search results so the card's row actions work. The card IS the report: once you call ` +
    `this, don't re-list the items in prose in your final answer.`,
  parameters: {
    type: "object",
    properties: {
      headline: {
        type: "string",
        description: 'One line on where the user stands, e.g. "Two things need you today".',
      },
      periodLabel: {
        type: "string",
        description: 'The window reviewed, in plain words, e.g. "since yesterday morning".',
      },
      scanned: {
        type: "number",
        description: "Total messages reviewed, including the ones rolled up.",
      },
      items: {
        type: "array",
        description: "Every noteworthy message, flat across accounts — the UI groups by priority.",
        items: {
          type: "object",
          properties: {
            threadId: {
              type: "string",
              description:
                "The thread id from the search results, so the card's row actions (open thread, etc.) work.",
            },
            messageId: { type: "string", description: "The specific message's id, if known." },
            account: {
              type: "string",
              description: "The connected account this arrived in — its email address or account id.",
            },
            sender: { type: "string", description: 'Display name of the sender, e.g. "Ayşe Kaya".' },
            senderEmail: { type: "string", description: "The sender's email address, if known." },
            subject: { type: "string", description: "The message subject." },
            gist: { type: "string", description: "One sentence: what it says and what it wants." },
            priority: {
              type: "string",
              enum: [...BRIEFING_PRIORITIES],
              description: PRIORITY_DESCRIPTION,
            },
            deadline: {
              type: "string",
              description: 'When it must be answered by, in the sender\'s own terms, e.g. "Friday 17:00".',
            },
            receivedAt: { type: "string", description: "When the message was received." },
            draftId: {
              type: "string",
              description: "Set when this run saved a reply draft for the thread.",
            },
          },
          required: ["threadId", "sender", "subject", "gist", "priority"],
        },
      },
      rollups: {
        type: "array",
        description:
          "Low-value mail collapsed to a count instead of listed, e.g. newsletters or receipts.",
        items: {
          type: "object",
          properties: {
            account: {
              type: "string",
              description: "The connected account this rollup covers — email address or account id.",
            },
            label: { type: "string", description: 'e.g. "Newsletters", "Receipts", "Promotions".' },
            count: { type: "number", description: "How many messages this rollup covers." },
            examples: {
              type: "array",
              items: { type: "string" },
              description: "A few sender names, to show what was folded away.",
            },
          },
          required: ["label", "count"],
        },
      },
    },
    required: ["items"],
  } as AgentTool["parameters"],
  execute: async (_id, params) => {
    try {
      const input = isRecord(params) ? params : {};
      const accounts = await listAccounts();

      const resolveAccountId = (value: unknown): string | undefined => {
        if (!isNonEmptyString(value)) return undefined;
        return findAccount(accounts, value)?.id;
      };

      const rawItems = Array.isArray(input.items) ? input.items : [];
      const items: BriefingItem[] = [];
      for (const raw of rawItems) {
        if (!isRecord(raw)) continue;
        const {
          threadId,
          messageId,
          account,
          sender,
          senderEmail,
          subject,
          gist,
          priority,
          deadline,
          receivedAt,
          draftId,
        } = raw;
        // Drop anything missing the fields the card and its row actions
        // depend on, rather than failing the whole call over one bad item.
        if (
          !isNonEmptyString(threadId) ||
          !isNonEmptyString(sender) ||
          !isNonEmptyString(subject) ||
          !isNonEmptyString(gist)
        ) {
          continue;
        }
        const accountId = resolveAccountId(account);
        items.push({
          threadId,
          ...(isNonEmptyString(messageId) ? { messageId } : {}),
          ...(accountId ? { accountId } : {}),
          sender,
          ...(isNonEmptyString(senderEmail) ? { senderEmail } : {}),
          subject,
          gist,
          // Never fail the call over a bad enum value — worst case an item
          // lands in the least-pressing tier instead of being dropped.
          priority: isBriefingPriority(priority) ? priority : "fyi",
          ...(isNonEmptyString(deadline) ? { deadline } : {}),
          ...(isNonEmptyString(receivedAt) ? { receivedAt } : {}),
          ...(isNonEmptyString(draftId) ? { draftId } : {}),
        });
      }

      const rawRollups = Array.isArray(input.rollups) ? input.rollups : [];
      const rollups: BriefingRollup[] = [];
      for (const raw of rawRollups) {
        if (!isRecord(raw)) continue;
        const { account, label, count, examples } = raw;
        if (!isNonEmptyString(label) || typeof count !== "number" || !Number.isFinite(count)) continue;
        const accountId = resolveAccountId(account);
        const exampleList = Array.isArray(examples) ? examples.filter(isNonEmptyString) : [];
        rollups.push({
          ...(accountId ? { accountId } : {}),
          label,
          count: Math.max(0, Math.round(count)),
          ...(exampleList.length > 0 ? { examples: exampleList } : {}),
        });
      }

      // The card's `accounts` list credits every connected account that
      // actually appears in the (resolved) items, not every account checked.
      const accountLookup = new Map<string, ConnectedAccount>(accounts.map((a) => [a.id, a]));
      const seenAccountIds = new Set(items.flatMap((i) => (i.accountId ? [i.accountId] : [])));
      const cardAccounts: CardAccount[] = [...seenAccountIds]
        .map((id) => accountLookup.get(id))
        .filter((a): a is ConnectedAccount => a !== undefined)
        .map(toCardAccount);

      const headline = isNonEmptyString(input.headline) ? input.headline : undefined;
      const periodLabel = isNonEmptyString(input.periodLabel) ? input.periodLabel : undefined;
      const scanned =
        typeof input.scanned === "number" && Number.isFinite(input.scanned) ? input.scanned : undefined;

      const card: AgentCard = {
        kind: "briefing",
        ...(headline ? { headline } : {}),
        ...(periodLabel ? { periodLabel } : {}),
        ...(cardAccounts.length > 0 ? { accounts: cardAccounts } : {}),
        items,
        ...(rollups.length > 0 ? { rollups } : {}),
        ...(scanned !== undefined ? { scanned } : {}),
      };

      const urgentCount = items.filter((i) => i.priority === "urgent").length;
      const awaitingReplyCount = items.filter((i) => i.priority === "reply").length;
      const rolledUpCount = rollups.reduce((sum, r) => sum + r.count, 0);
      const draftedCount = items.filter((i) => i.draftId).length;

      const summaryParts: string[] = [];
      if (items.length === 0) {
        summaryParts.push("Briefing published: no noteworthy items");
      } else {
        const tally = [
          urgentCount > 0 ? `${urgentCount} urgent` : undefined,
          awaitingReplyCount > 0 ? `${awaitingReplyCount} awaiting reply` : undefined,
        ].filter((s): s is string => Boolean(s));
        summaryParts.push(
          `Briefing published: ${items.length} item${items.length === 1 ? "" : "s"}` +
            (tally.length > 0 ? ` (${tally.join(", ")})` : ""),
        );
      }
      if (rolledUpCount > 0) summaryParts.push(`${rolledUpCount} messages rolled up`);
      if (draftedCount > 0) summaryParts.push(`${draftedCount} draft${draftedCount === 1 ? "" : "s"} linked`);

      const confirmation =
        `${summaryParts.join(", ")}. The user is now looking at this card. Do not repeat the ` +
        `items in prose — close with two or three sentences naming what needs them first and ` +
        `which drafts are waiting.`;

      return { content: [{ type: "text" as const, text: confirmation }], details: card };
    } catch (error) {
      return text(`Could not compose the briefing: ${errorMessage(error)}`);
    }
  },
};

export function buildBriefingTool(): AgentTool {
  return composeBriefingTool;
}
