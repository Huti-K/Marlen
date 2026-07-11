import type { AgentTool } from "@earendil-works/pi-agent-core";
import { mapWithConcurrency } from "../jobs.js";
import { errorMessage } from "../util.js";
import { buildKnowledgeContext, buildKnowledgeReadTools } from "./knowledgeTools.js";
import { buildMailReadTools } from "./mailTools.js";
import { runOneShot } from "./oneShot.js";
import { defineTool, textResult } from "./toolResult.js";

/**
 * The fan-out tool: the main agent hands off several independent read-only
 * lookups to short-lived worker agents that run in parallel, then folds
 * their reports back into one result. Workers get a stripped-down toolset
 * (the mirror's read-only mail tools plus the library) and no view of the
 * main conversation.
 */

/** Keeps parallel MCP and model calls modest. */
const MAX_TASKS = 8;
const CONCURRENCY = 4;

const WORKER_PROMPT = `You are a background research worker for Trailin, a personal email assistant. The main assistant
handed you ONE self-contained task. Complete it with your read-only tools (email search and
reading, plus the user's document library) and reply with a compact, factual report.

Rules:
- Your final message IS the report the main assistant reads. No greetings, no questions, no
  meta-commentary about what you did.
- You cannot ask anything; if the task is ambiguous, state the assumption you made and proceed.
- You are read-only: you cannot draft, send, label or change anything.
- Report the concrete identifiers the main assistant will need to act (thread and message ids,
  senders, dates, subjects, document titles and part numbers). Quote short key passages verbatim
  when the wording matters; keep everything else terse.
- If you find nothing, say so plainly instead of padding the report.`;

/** Task label for the result header, capped so a long task doesn't blow up the summary. */
function truncateLabel(task: string, max = 80): string {
  return task.length > max ? `${task.slice(0, max - 1)}…` : task;
}

export const delegateTool: AgentTool = defineTool({
  name: "delegate",
  label: "Delegate research tasks",
  description: `Fan out independent read-only research tasks to parallel background workers. Use this when a job
needs several separate lookups (reviewing many threads for a digest, checking several senders'
histories, cross-checking multiple library documents) instead of doing every lookup serially
yourself. Each task must be fully self-contained — workers see nothing of this conversation — so
spell out exactly what to look up and what to report back. Workers can search and read email and
the document library but cannot draft, send or change anything; you act on their reports. For a
single quick lookup, call the email tools directly instead.`,
  parameters: {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        items: { type: "string" },
        description: "Self-contained task instructions, one per worker (max 8 per call).",
      },
    },
    required: ["tasks"],
  },
  execute: async (_toolCallId, params, signal, onUpdate) => {
    const { tasks: rawTasks } = params as { tasks?: unknown[] };
    const allTasks = (rawTasks ?? []).map((t) => String(t).trim()).filter(Boolean);
    if (allTasks.length === 0) {
      return textResult("The tasks array was empty. Nothing to delegate.");
    }
    const dropped = allTasks.length - MAX_TASKS;
    const tasks = allTasks.slice(0, MAX_TASKS);

    const systemPrompt = WORKER_PROMPT + (await buildKnowledgeContext());
    const tools = [...buildMailReadTools(), ...buildKnowledgeReadTools()];

    let finished = 0;
    const reports = await mapWithConcurrency(tasks, CONCURRENCY, async (task) => {
      // The main turn was aborted (e.g. client disconnect): don't start
      // more workers; in-flight ones stop via the signal passed below.
      if (signal?.aborted) return "Cancelled before it started.";
      let report: string;
      try {
        report =
          (await runOneShot({ systemPrompt, tools, prompt: task, signal })) ||
          "(the worker returned an empty report)";
      } catch (error) {
        report = `Worker failed: ${errorMessage(error)}`;
      }
      finished += 1;
      // Streamed progress for the UI's tool badge; ignored elsewhere.
      onUpdate?.(textResult(`${finished}/${tasks.length} tasks done`));
      return report;
    });

    let text = tasks
      .map((task, i) => `### Task ${i + 1}: ${truncateLabel(task)}\n\n${reports[i]}`)
      .join("\n\n---\n\n");
    if (dropped > 0) {
      text += `\n\nNote: ${dropped} additional task(s) were dropped (max ${MAX_TASKS} per call).`;
    }

    return textResult(text);
  },
});
