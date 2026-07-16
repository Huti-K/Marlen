import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { desc } from "drizzle-orm";
import { createAutomation, deleteAutomation, updateAutomation } from "../automations/manage.js";
import { getNextRunAt } from "../automations/scheduler.js";
import { db, schema } from "../db/index.js";
import { collapseWhitespace } from "../search/snippets.js";
import { textResult, tool } from "./toolkit.js";

/**
 * Automation-management tools: list, create, update and delete the scheduled
 * automations the user otherwise manages in the web UI. Interactive sessions
 * only — an unattended run reads attacker-controllable mail, and an
 * automation's instruction is a standing prompt executed on every future
 * tick, so mail content must never be able to plant or alter one. (Unattended
 * runs keep the read-only automation_history/automation_run_read pair from
 * knowledgeTools.)
 */

const INSTRUCTION_PREVIEW_CHARS = 200;

const SCHEDULE_DESCRIPTION =
  `Five-field cron expression (minute hour day-of-month month day-of-week), interpreted in the ` +
  `user's timezone — "0 8 * * *" is daily at 08:00, "0 9 * * 1" is Mondays at 09:00. A fixed ` +
  `day-of-month AND month with day-of-week "*" (e.g. "0 9 15 3 *") is treated as one-time: it ` +
  `runs once at the next occurrence and then disables itself.`;

const RUN_ON_NEW_MAIL_DESCRIPTION =
  "Also run immediately whenever new inbound mail is detected in any connected account, in " +
  "addition to the cron schedule.";

const NOTIFY_ON_COMPLETION_DESCRIPTION =
  "Show a desktop notification when a run of this automation finishes.";

function instructionPreview(instruction: string): string {
  const collapsed = collapseWhitespace(instruction);
  if (collapsed.length <= INSTRUCTION_PREVIEW_CHARS) return collapsed;
  return `${collapsed.slice(0, INSTRUCTION_PREVIEW_CHARS)}…`;
}

/** The `— schedule …, next run …/paused` tail shared by the create and update confirmations. */
function scheduleSummary(automation: { id: string; schedule: string; enabled: boolean }): string {
  if (!automation.enabled) return `schedule ${automation.schedule}, paused`;
  const next = getNextRunAt(automation.id);
  return `schedule ${automation.schedule}${next ? `, next run ${next}` : ""}`;
}

const automationList: AgentTool = tool({
  name: "automation_list",
  label: "List automations",
  description:
    `The user's scheduled automations — each one's id, cron schedule, enabled state, next run ` +
    `time and a short preview of its instruction. Use it to answer "what runs when", and to find ` +
    `the id for automation_update or automation_delete. Pass fullInstructions to get complete ` +
    `instruction texts — always read the current text before editing one.`,
  params: {
    fullInstructions: Type.Optional(
      Type.Boolean({
        description: "Include each automation's complete instruction text instead of a preview.",
      }),
    ),
  },
  execute: async ({ fullInstructions }) => {
    const rows = await db
      .select()
      .from(schema.automations)
      .orderBy(desc(schema.automations.createdAt));
    if (rows.length === 0) {
      return textResult("No automations exist yet — create one with automation_create.");
    }
    const lines = rows.map((a) => {
      const status = a.enabled ? `next run ${getNextRunAt(a.id) ?? "unscheduled"}` : "paused";
      const instruction = fullInstructions
        ? `\n  instruction: ${a.instruction.replaceAll("\n", "\n  ")}`
        : `\n  ${instructionPreview(a.instruction)}`;
      return `- [${a.id}] "${a.name}" — ${a.schedule} — ${status}${instruction}`;
    });
    return textResult(lines.join("\n"));
  },
});

const automationCreate: AgentTool = tool({
  name: "automation_create",
  label: "Create automation",
  description:
    `Schedule recurring (or one-time future) work as an automation: every cron firing runs the ` +
    `instruction as a fresh unattended agent run whose result lands in the Home activity feed. ` +
    `Use it whenever the user wants something done on a schedule ("every morning…", "each ` +
    `Friday…", "on the 15th…") rather than doing it once and letting it drop. Write the ` +
    `instruction fully self-contained — the run sees nothing of this conversation, so spell out ` +
    `what to do, over which accounts, and what to report. Unattended runs read mail and create ` +
    `drafts but can never send, reply, forward, label or delete — phrase the instruction ` +
    `accordingly. After creating, confirm to the user what you set up; they can review and edit ` +
    `every automation in the web app.`,
  params: {
    name: Type.String({ description: 'Short display name, e.g. "Weekly invoice sweep".' }),
    instruction: Type.String({
      description: "The complete, self-contained instruction the unattended run will execute.",
    }),
    schedule: Type.String({ description: SCHEDULE_DESCRIPTION }),
    runOnNewMail: Type.Optional(Type.Boolean({ description: RUN_ON_NEW_MAIL_DESCRIPTION })),
    notifyOnCompletion: Type.Optional(
      Type.Boolean({ description: NOTIFY_ON_COMPLETION_DESCRIPTION }),
    ),
    leadId: Type.Optional(
      Type.String({
        description:
          "Attach the automation to this lead (from lead_list): it shows up with the lead and " +
          "is deleted with it. Only for follow-ups about that specific lead.",
      }),
    ),
  },
  catchToText: true,
  execute: async ({ name, instruction, schedule, runOnNewMail, notifyOnCompletion, leadId }) => {
    const automation = await createAutomation({
      name,
      instruction,
      schedule,
      runOnNewMail,
      notifyOnCompletion,
      leadId,
    });
    return textResult(
      `Created automation "${automation.name}" [${automation.id}] — ${scheduleSummary(automation)}.`,
    );
  },
});

const automationUpdate: AgentTool = tool({
  name: "automation_update",
  label: "Update automation",
  description:
    `Change an existing automation — pass its id (from automation_list) and only the fields to ` +
    `change. enabled: false pauses it without losing anything; enabled: true resumes it. A new ` +
    `instruction replaces the old one entirely, so read the current text first (automation_list ` +
    `with fullInstructions) and pass the complete edited version.`,
  params: {
    id: Type.String({ description: "The automation id (from automation_list)." }),
    name: Type.Optional(Type.String({ description: "New display name." })),
    instruction: Type.Optional(
      Type.String({ description: "Complete replacement instruction (not a diff)." }),
    ),
    schedule: Type.Optional(Type.String({ description: SCHEDULE_DESCRIPTION })),
    enabled: Type.Optional(
      Type.Boolean({ description: "false pauses the automation; true resumes it." }),
    ),
    runOnNewMail: Type.Optional(Type.Boolean({ description: RUN_ON_NEW_MAIL_DESCRIPTION })),
    notifyOnCompletion: Type.Optional(
      Type.Boolean({ description: NOTIFY_ON_COMPLETION_DESCRIPTION }),
    ),
  },
  catchToText: true,
  execute: async ({
    id,
    name,
    instruction,
    schedule,
    enabled,
    runOnNewMail,
    notifyOnCompletion,
  }) => {
    const automation = await updateAutomation(id, {
      name,
      instruction,
      schedule,
      enabled,
      runOnNewMail,
      notifyOnCompletion,
    });
    return textResult(
      `Updated automation "${automation.name}" [${automation.id}] — ${scheduleSummary(automation)}.`,
    );
  },
});

const automationDelete: AgentTool = tool({
  name: "automation_delete",
  label: "Delete automation",
  description:
    `Permanently delete an automation AND its entire run history — past results disappear from ` +
    `the activity feed and automation_history. Only when the user explicitly asks to delete or ` +
    `remove it; when they just want it to stop running, pause it instead with automation_update ` +
    `(enabled: false).`,
  params: {
    id: Type.String({ description: "The automation id (from automation_list)." }),
  },
  catchToText: true,
  execute: async ({ id }) => {
    const deleted = await deleteAutomation(id);
    return textResult(
      deleted
        ? "Automation deleted, along with its run history."
        : `No automation with id ${id} — check automation_list.`,
    );
  },
});

export const automationManageTools: AgentTool[] = [
  automationList,
  automationCreate,
  automationUpdate,
  automationDelete,
];
