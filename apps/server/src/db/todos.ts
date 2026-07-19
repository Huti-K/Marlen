import { randomUUID } from "node:crypto";
import type { Todo, TodoStatus } from "@trailin/shared";
import { and, asc, eq } from "drizzle-orm";
import { emitServerEvent } from "../core/events.js";
import { db, schema } from "./index.js";

type TodoRow = typeof schema.todos.$inferSelect;

function assemble(todo: TodoRow): Todo {
  return {
    id: todo.id,
    title: todo.title,
    body: todo.body,
    status: todo.status,
    dueAt: todo.dueAt,
    position: todo.position,
    conversationId: todo.conversationId,
    linkedAutomationId: todo.linkedAutomationId,
    createdAt: todo.createdAt,
    updatedAt: todo.updatedAt,
  };
}

export async function listTodos(filter: { status?: TodoStatus } = {}): Promise<Todo[]> {
  const base = db.select().from(schema.todos);
  const rows = await (filter.status
    ? base.where(eq(schema.todos.status, filter.status))
    : base
  ).orderBy(asc(schema.todos.position), asc(schema.todos.createdAt));
  return rows.map(assemble);
}

export async function getTodo(id: string): Promise<Todo | null> {
  const [row] = await db.select().from(schema.todos).where(eq(schema.todos.id, id));
  return row ? assemble(row) : null;
}

/** An open todo carrying this dedup key, so a repeating run reuses it instead of duplicating. */
async function findOpenTodoByKey(key: string): Promise<Todo | null> {
  if (!key) return null;
  const [row] = await db
    .select()
    .from(schema.todos)
    .where(and(eq(schema.todos.dedupeKey, key), eq(schema.todos.status, "open")));
  return row ? assemble(row) : null;
}

export interface TodoInput {
  title: string;
  body?: string;
  dueAt?: string | null;
  conversationId?: string | null;
  linkedAutomationId?: string | null;
  key?: string;
}

export async function createTodo(input: TodoInput): Promise<{ todo: Todo; created: boolean }> {
  const key = input.key?.trim() ?? "";
  const existing = await findOpenTodoByKey(key);
  if (existing) return { todo: existing, created: false };

  const now = new Date().toISOString();
  const id = randomUUID();
  await db.insert(schema.todos).values({
    id,
    title: input.title.trim(),
    body: input.body?.trim() ?? "",
    status: "open",
    dueAt: input.dueAt ?? null,
    // New todos append to the end of the manual order; drag rewrites it.
    position: Date.now(),
    conversationId: input.conversationId ?? null,
    linkedAutomationId: input.linkedAutomationId ?? null,
    dedupeKey: key,
    createdAt: now,
    updatedAt: now,
  });

  emitServerEvent("todos");
  return { todo: (await getTodo(id)) as Todo, created: true };
}

export interface TodoUpdate {
  title?: string;
  body?: string;
  status?: TodoStatus;
  /** ISO due date/time; "" or null clears it. */
  dueAt?: string | null;
  /** Manual sort key within its agenda group (drag-and-drop). */
  position?: number;
  /** Automation fired on completion; null unlinks. */
  linkedAutomationId?: string | null;
}

/** The single maintenance verb (agent tool, routes, and drag all route here). */
export async function updateTodo(id: string, update: TodoUpdate): Promise<Todo | null> {
  const existing = await getTodo(id);
  if (!existing) return null;

  const fields: Partial<TodoRow> = { updatedAt: new Date().toISOString() };
  if (update.title !== undefined) fields.title = update.title.trim();
  if (update.body !== undefined) fields.body = update.body.trim();
  if (update.dueAt !== undefined) fields.dueAt = update.dueAt || null;
  if (update.position !== undefined) fields.position = update.position;
  if (update.linkedAutomationId !== undefined) {
    fields.linkedAutomationId = update.linkedAutomationId || null;
  }
  if (update.status !== undefined) fields.status = update.status;
  await db.update(schema.todos).set(fields).where(eq(schema.todos.id, id));

  emitServerEvent("todos");
  return getTodo(id);
}
