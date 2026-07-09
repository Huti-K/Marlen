import type { AgentTool } from "@earendil-works/pi-agent-core";
import { EMAIL_APPS, type ConnectedAccount } from "@trailin/shared";
import { listAccounts } from "../pipedream/connect.js";
import { listGmailWaiting } from "../pipedream/gmailWaiting.js";
import { errorMessage } from "../util.js";
import { accountNotFoundText, findAccount } from "./knowledgeTools.js";

/**
 * Agent tool over gmailWaiting.ts's "waiting on others" threads (same data
 * the Home page's pending-work section uses) — Gmail only for now, other
 * email apps aren't wired up to listGmailWaiting.
 */

const text = (value: string) => ({
  content: [{ type: "text" as const, text: value }],
  details: undefined,
});

/** Whole days elapsed since `iso`, floored, min 1 (matches gmailWaiting's ≥24h wait filter). */
function daysSince(iso: string): number {
  return Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000)));
}

const listWaitingThreadsTool: AgentTool = {
  name: "list_waiting_threads",
  label: "List threads awaiting replies",
  description:
    `Threads where the user sent the last message and nobody has replied for at least a day ` +
    `— per connected Gmail account, most-overdue first, up to 10 per account. Use this for ` +
    `follow-up checks, briefings, or when the user asks what they're still waiting on. Read a ` +
    `thread with the account's get-thread tool using the listed threadId, and consider ` +
    `offering a nudge draft for long-overdue ones. Only Gmail accounts are covered for now.`,
  parameters: {
    type: "object",
    properties: {
      account: {
        type: "string",
        description:
          "Only check this account (email address or account id); omit to check every " +
          "connected Gmail account.",
      },
    },
  } as AgentTool["parameters"],
  execute: async (_id, params) => {
    const { account } = params as { account?: string };
    const accounts = await listAccounts();
    const filtered = account?.trim();

    let targets: ConnectedAccount[];
    if (filtered) {
      const resolved = findAccount(accounts, filtered);
      if (!resolved) return text(accountNotFoundText(filtered, accounts));
      targets = [resolved];
    } else {
      targets = accounts.filter((a) => a.app === "gmail");
    }

    if (targets.length === 0) {
      return text(
        "No Gmail accounts are connected — waiting-thread tracking is Gmail-only for now.",
      );
    }

    const sections: string[] = [];
    let anyWaiting = false;
    let anyFailed = false;
    for (const acc of targets) {
      try {
        const items = await listGmailWaiting(acc);
        if (items.length === 0) {
          sections.push(`${acc.name}: nothing waiting.`);
          continue;
        }
        anyWaiting = true;
        const lines = items.map(
          (t) =>
            `- ${t.counterpart} — "${t.subject}" — waiting ${daysSince(t.lastSentAt)} day(s), ` +
            `since ${t.lastSentAt.slice(0, 10)} — threadId: ${t.threadId}`,
        );
        sections.push(`${acc.name}:\n${lines.join("\n")}`);
      } catch (error) {
        anyFailed = true;
        sections.push(`${acc.name}: lookup failed (${errorMessage(error)})`);
      }
    }

    // Collapse to one line only when every account came back clean and empty —
    // a failure is worth surfacing even if nothing else is waiting.
    if (!anyWaiting && !anyFailed) return text("No threads are waiting on a reply right now.");

    if (!filtered) {
      const uncovered = accounts.filter(
        (a) => a.app !== "gmail" && (EMAIL_APPS as readonly string[]).includes(a.app),
      );
      if (uncovered.length > 0) {
        sections.push(
          `Not covered yet (waiting-thread tracking is Gmail-only for now): ` +
            `${uncovered.map((a) => a.name).join(", ")}.`,
        );
      }
    }

    return text(sections.join("\n\n"));
  },
};

export function buildWaitingThreadsTool(): AgentTool {
  return listWaitingThreadsTool;
}
