import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { Todo } from "@marlen/shared";
import { Type } from "@sinclair/typebox";
import { notFound } from "../core/errors.js";
import { listTodos, type TodoUpdate } from "../db/todos.js";
import { applyTodoUpdate } from "../services/todos.js";

const idParams = Type.Object({ id: Type.String() });

const statusValue = Type.Union([
  Type.Literal("open"),
  Type.Literal("done"),
  Type.Literal("dismissed"),
]);

const listQuery = Type.Object({ status: Type.Optional(statusValue) });

const patchBody = Type.Object({
  title: Type.Optional(Type.String()),
  body: Type.Optional(Type.String()),
  status: Type.Optional(statusValue),
  dueAt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  position: Type.Optional(Type.Number()),
  linkedAutomationId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export const todosRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get("/api/todos", { schema: { querystring: listQuery } }, async (req): Promise<Todo[]> => {
    return listTodos({ status: req.query.status });
  });

  app.patch(
    "/api/todos/:id",
    { schema: { params: idParams, body: patchBody } },
    async (req): Promise<Todo> => {
      const todo = await applyTodoUpdate(req.params.id, req.body as TodoUpdate);
      if (!todo) throw notFound("no todo with this id");
      return todo;
    },
  );
};
