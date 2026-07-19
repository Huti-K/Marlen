import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { Todo } from "@trailin/shared";
import { createTodo, listTodos } from "../db/todos.js";
import { applyTodoUpdate, automationExists } from "../services/todos.js";
import { textResult, tool } from "./toolkit.js";

const statusSchema = Type.Union(
  [Type.Literal("open"), Type.Literal("done"), Type.Literal("dismissed")],
  { description: 'Status: "open" (needs action), "done", "dismissed" (dropped).' },
);

const dueAtSchema = Type.String({
  description:
    "When the user should do or decide this, as an ISO 8601 date or date-time " +
    '("2026-07-24" or "2026-07-24T15:00"). Set it whenever the todo is time-bound — a ' +
    "deadline, a follow-up date, an appointment — so it lands on the right day of the home " +
    "agenda (overdue items surface at the top). Omit for an anytime todo.",
});

/** Renders a todo with the id the maintenance tools need. */
function todoLine(todo: Todo): string {
  return [
    `- [${todo.id}] ${todo.title} — ${todo.status}${todo.dueAt ? ` — due ${todo.dueAt}` : ""}${todo.linkedAutomationId ? ` — runs ${todo.linkedAutomationId} when done` : ""}`,
    ...(todo.body ? [`  ${todo.body}`] : []),
  ].join("\n");
}

const listTodosTool: AgentTool = tool({
  name: "list_todos",
  label: "List todos",
  description:
    `The user's todo list — everything you filed for them to do or decide, each with its id. ` +
    `Call this before touching an existing todo (to get its id) or to check what is still open. ` +
    `Filter by status.`,
  params: { status: Type.Optional(statusSchema) },
  execute: async ({ status }) => {
    const todos = await listTodos({ status });
    if (todos.length === 0) {
      return textResult(status ? `No ${status} todos.` : "The todo list is empty.");
    }
    return textResult(todos.map(todoLine).join("\n"));
  },
});

const updateTodoTool: AgentTool = tool({
  name: "update_todo",
  label: "Update todo",
  description:
    `Maintain a todo you filed — pass its id (from list_todos) and only what changes. Rewrite ` +
    `the title/body as things move, set status "done" when it is finished, or "dismissed" to ` +
    `drop it. This is how a later run keeps a standing todo current instead of filing a new one. ` +
    `Track finer-grained progress in the body text, not as separate todos.`,
  params: {
    id: Type.String({ description: "The todo id (from list_todos)." }),
    title: Type.Optional(Type.String()),
    body: Type.Optional(Type.String({ description: "Complete replacement text." })),
    dueAt: Type.Optional(dueAtSchema),
    linkedAutomationId: Type.Optional(
      Type.Union([Type.String(), Type.Null()], {
        description: "Automation id to run the moment the user completes this todo; null unlinks.",
      }),
    ),
    status: Type.Optional(statusSchema),
  },
  catchToText: true,
  execute: async ({ id, ...update }) => {
    const todo = await applyTodoUpdate(id, update);
    if (!todo) return textResult(`No todo with id ${id} — check list_todos.`);
    return textResult(`Updated todo:\n${todoLine(todo)}`);
  },
});

/**
 * create_todo closes over the session's conversation id so the todo links back
 * to the chat/run that filed it; list/update address todos by id alone. All
 * three stay available to unattended runs — a todo is inert data (like a lead),
 * and a run that hits a decision it can't make files one for the user.
 */
export function buildTodoTools(conversationId: string | undefined): AgentTool[] {
  const createTodoTool: AgentTool = tool({
    name: "create_todo",
    label: "Create todo",
    description:
      `File something the USER must do or decide, as a todo on their home page: a decision only ` +
      `they can make, an offline action (call someone, sign a document), or a follow-up to ` +
      `track. Reach for this from an unattended run the moment you hit a point that needs a ` +
      `human. Do NOT use it for work you can do yourself (make an automation), an email to review ` +
      `(leave a draft), or a prospect (record a lead). One todo per action; details go in body. ` +
      `Pass a stable 'key' from a recurring source so re-runs reuse the one open todo instead of ` +
      `piling up copies. Pass 'linkedAutomationId' to fire an automation the moment the user ` +
      `ticks this done, chaining their action into the next agent step.`,
    params: {
      title: Type.String({
        description:
          "A SHORT, scannable action — a few plain words the user grasps at a glance, e.g. " +
          '"Approve refund for order #4821". Keep specifics OUT of the title; they go in body.',
      }),
      body: Type.Optional(
        Type.String({
          description:
            "The important detail, revealed when the user expands the todo: what is blocked, what " +
            "you found, why it needs them. Put the specifics here so the title can stay short.",
        }),
      ),
      dueAt: Type.Optional(dueAtSchema),
      key: Type.Optional(
        Type.String({
          description:
            'Stable dedup key for a recurring source (e.g. "weekly-returns-sweep"); recreating ' +
            "with the same key reuses the open todo instead of duplicating it.",
        }),
      ),
      linkedAutomationId: Type.Optional(
        Type.String({
          description:
            "Automation id to run the moment the user completes this todo. Create a manual, " +
            "schedule-less automation first, then pass its id here. Omit for a plain todo.",
        }),
      ),
    },
    catchToText: true,
    execute: async ({ title, body, dueAt, key, linkedAutomationId }) => {
      if (linkedAutomationId && !(await automationExists(linkedAutomationId))) {
        return textResult(
          `No automation with id ${linkedAutomationId}. Create it first with automation_create ` +
            `(schedule-less), then link its id.`,
        );
      }
      const { todo, created } = await createTodo({
        title,
        body,
        dueAt,
        key,
        linkedAutomationId,
        conversationId,
      });
      if (!created) {
        return textResult(
          `A todo with this key is already open — reusing it. Use update_todo to keep it ` +
            `current:\n${todoLine(todo)}`,
        );
      }
      return textResult(`Created todo:\n${todoLine(todo)}`);
    },
  });

  return [createTodoTool, listTodosTool, updateTodoTool];
}
