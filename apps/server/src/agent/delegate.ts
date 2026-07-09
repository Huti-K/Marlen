import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import { modelRegistry, resolveActiveModel } from "../llm/registry.js";
import type { EmailToolset } from "../pipedream/mcp.js";
import { errorMessage } from "../util.js";
import { buildKnowledgeContext, buildKnowledgeReadTools } from "./knowledgeTools.js";
import { runPrompt } from "./run.js";

/**
 * The fan-out tool: the main agent hands off several independent read-only
 * lookups to short-lived worker agents that run in parallel, then folds
 * their reports back into one result. Workers get a stripped-down toolset
 * (read-only email plus library) and no view of the main conversation.
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

export function buildDelegateTool(toolset: EmailToolset): AgentTool {
  return {
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
    } as AgentTool["parameters"],
    execute: async (_toolCallId, params, signal, onUpdate) => {
      const { tasks: rawTasks } = params as { tasks?: unknown[] };
      const allTasks = (rawTasks ?? []).map((t) => String(t).trim()).filter(Boolean);
      if (allTasks.length === 0) {
        return {
          content: [{ type: "text", text: "The tasks array was empty. Nothing to delegate." }],
          details: undefined,
        };
      }
      const dropped = allTasks.length - MAX_TASKS;
      const tasks = allTasks.slice(0, MAX_TASKS);

      const [model, context] = await Promise.all([resolveActiveModel(), buildKnowledgeContext()]);
      const tools = [...toolset.readTools, ...buildKnowledgeReadTools()];
      const systemPrompt = WORKER_PROMPT + context;

      // Simple concurrency pool: a shared index counter, drained by
      // CONCURRENCY runners so at most that many workers run at once.
      const reports: string[] = new Array(tasks.length);
      let nextIndex = 0;
      let finished = 0;
      const runNext = async (): Promise<void> => {
        for (let i = nextIndex++; i < tasks.length; i = nextIndex++) {
          const task = tasks[i]!;
          // The main turn was aborted (e.g. client disconnect): don't start
          // more workers; in-flight ones stop via the signal passed below.
          if (signal?.aborted) {
            reports[i] = "Cancelled before it started.";
            continue;
          }
          try {
            const agent = new Agent({
              initialState: { systemPrompt, model, tools },
              streamFn: (m, c, o) => modelRegistry.streamSimple(m, c, o),
            });
            const report = await runPrompt({ agent }, task, {}, signal);
            reports[i] = report || "(the worker returned an empty report)";
          } catch (error) {
            reports[i] = `Worker failed: ${errorMessage(error)}`;
          }
          finished += 1;
          // Streamed progress for the UI's tool badge; ignored elsewhere.
          onUpdate?.({
            content: [{ type: "text", text: `${finished}/${tasks.length} tasks done` }],
            details: undefined,
          });
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, () => runNext()));

      let text = tasks
        .map((task, i) => `### Task ${i + 1}: ${truncateLabel(task)}\n\n${reports[i]}`)
        .join("\n\n---\n\n");
      if (dropped > 0) {
        text += `\n\nNote: ${dropped} additional task(s) were dropped (max ${MAX_TASKS} per call).`;
      }

      return { content: [{ type: "text", text }], details: undefined };
    },
  };
}
