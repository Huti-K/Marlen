import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AgentCard, ChoiceOption, ConnectedAccount, EmailRef } from "@trailin/shared";
import { getThreadDetail } from "../email/sync/mailQuery.js";
import { listAccounts } from "../pipedream/connect.js";
import { isNonEmptyString, isRecord } from "../util.js";
import { findAccount } from "./accounts.js";
import { defineTool, textResult } from "./toolResult.js";

/**
 * Agent tool that asks the user to pick instead of the model guessing, for a
 * draft/send/label/delete request that more than one account, thread or
 * draft plausibly matches. Publishes the "choices" AgentCard (clickable
 * buttons); the user's pick arrives as their next chat message, same as any
 * other reply — this tool never blocks waiting for it. Nothing here throws:
 * a malformed call yields a text error result instead of an unhandled
 * rejection.
 */

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;

interface RawOption {
  label?: unknown;
  detail?: unknown;
  reply?: unknown;
  threadId?: unknown;
  account?: unknown;
}

/**
 * Builds the option's EmailRef when it names a thread. Prefers the local
 * mirror (getThreadDetail) for accountId/subject/from/date; when the thread
 * isn't mirrored, still attaches a bare ref if the account param resolved, so
 * the option is at least actionable by account. Returns undefined rather
 * than a half-built ref when neither source has enough to work with.
 */
function buildRef(
  threadId: string | undefined,
  resolvedAccount: ConnectedAccount | undefined,
  accounts: ConnectedAccount[],
): EmailRef | undefined {
  if (!threadId) return undefined;

  const detail = getThreadDetail(threadId, resolvedAccount?.id);
  if (detail) {
    const accountMatch = accounts.find((a) => a.id === detail.accountId);
    const newest = detail.messages.at(-1);
    return {
      threadId: detail.providerThreadId,
      accountId: detail.accountId,
      ...(accountMatch ? { accountName: accountMatch.name } : {}),
      ...(detail.subject ? { subject: detail.subject } : {}),
      ...(newest?.from ? { from: newest.from } : {}),
      ...(newest?.date ? { date: newest.date } : {}),
    };
  }

  if (resolvedAccount) {
    return { threadId, accountId: resolvedAccount.id, accountName: resolvedAccount.name };
  }
  return undefined;
}

export const presentChoicesTool: AgentTool = defineTool({
  name: "present_choices",
  label: "Ask the user to choose",
  description:
    `Use when more than one email, account or draft plausibly matches an action the user asked ` +
    `for (drafting, sending, labeling, deleting) and their message doesn't settle which one. ` +
    `Renders clickable buttons; the user's pick arrives as their next message in this same ` +
    `conversation. After calling this, end your turn with a short question restating what you ` +
    `need — do not act until the user replies. Do NOT use this when only one match is clear, or ` +
    `for pure read/summarize questions.`,
  parameters: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: 'What you need the user to decide, e.g. "Which email do you mean?".',
      },
      options: {
        type: "array",
        minItems: MIN_OPTIONS,
        maxItems: MAX_OPTIONS,
        description: `Between ${MIN_OPTIONS} and ${MAX_OPTIONS} choices for the user to pick from.`,
        items: {
          type: "object",
          properties: {
            label: {
              type: "string",
              description:
                'Short button text, e.g. an account address or "Ayşe — Friday deadline".',
            },
            detail: {
              type: "string",
              description: "One-line supporting detail (subject, date, account).",
            },
            reply: {
              type: "string",
              description:
                "Full-sentence reply sent when this option is picked; defaults to label.",
            },
            threadId: {
              type: "string",
              description: "Provider thread id this option refers to, if it names one.",
            },
            account: {
              type: "string",
              description: "The connected account this option refers to — email address or id.",
            },
          },
          required: ["label"],
        },
      },
    },
    required: ["question", "options"],
  },
  execute: async (_id, params) => {
    const input = isRecord(params) ? params : {};
    const question = input.question;
    const rawOptions = input.options;

    if (!isNonEmptyString(question)) {
      return textResult("present_choices needs a non-empty question.");
    }
    if (!Array.isArray(rawOptions) || rawOptions.length < MIN_OPTIONS) {
      return textResult(`present_choices needs at least ${MIN_OPTIONS} options.`);
    }
    if (rawOptions.length > MAX_OPTIONS) {
      return textResult(`present_choices takes at most ${MAX_OPTIONS} options.`);
    }
    const withLabels = (rawOptions as RawOption[]).filter((o) => isNonEmptyString(o.label));
    if (withLabels.length < MIN_OPTIONS) {
      return textResult(`present_choices needs at least ${MIN_OPTIONS} options with a label.`);
    }

    const accounts = await listAccounts();
    const options: ChoiceOption[] = withLabels.map((raw) => {
      const label = raw.label as string;
      const resolvedAccount = isNonEmptyString(raw.account)
        ? findAccount(accounts, raw.account)
        : undefined;
      const threadId = isNonEmptyString(raw.threadId) ? raw.threadId : undefined;
      const ref = buildRef(threadId, resolvedAccount, accounts);
      return {
        label,
        ...(isNonEmptyString(raw.detail) ? { detail: raw.detail } : {}),
        ...(isNonEmptyString(raw.reply) ? { reply: raw.reply } : {}),
        ...(ref ? { ref } : {}),
      };
    });

    const card: AgentCard = { kind: "choices", question, options };
    const labels = options.map((o) => o.label).join(", ");
    return textResult(
      `Presented ${options.length} choices to the user: ${labels}. End your turn with a short ` +
        `question restating what you need — the user's pick arrives as their next message. Do ` +
        `not act until then.`,
      card,
    );
  },
});
