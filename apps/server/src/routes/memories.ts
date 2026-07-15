import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { createMemory, deleteMemory, listMemories, updateMemory } from "../db/memories.js";
import { badRequest, notFound } from "../errors.js";
import { errorMessage } from "../util.js";

const memoryBody = Type.Object({
  content: Type.String(),
  // null = clear this scope axis; omitted keeps the current value on updates —
  // except that setting one axis moves the memory there (the omitted other
  // axis clears). A memory carries accountId OR contactId, never both; only
  // sending both non-null is rejected — see db/memories.ts.
  accountId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  contactId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

const idParams = Type.Object({ id: Type.String() });

/**
 * Long-term memory, managed on the Knowledge page. Entries are injected into
 * the agent's system prompt, which is rebuilt on every turn (and for each
 * scheduled run), so an edit here reaches the next message on its own — no
 * need to disturb any in-flight conversation's session.
 */
export const memoryRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get("/api/memories", async () => listMemories());

  app.post("/api/memories", { schema: { body: memoryBody } }, async (req) => {
    // createMemory validates content (empty / too long) and the entry cap;
    // surface those as 400s.
    try {
      const result = await createMemory(
        req.body.content,
        "user",
        req.body.accountId ?? null,
        req.body.contactId ?? null,
      );
      return result.entry;
    } catch (error) {
      throw badRequest(errorMessage(error));
    }
  });

  app.put("/api/memories/:id", { schema: { params: idParams, body: memoryBody } }, async (req) => {
    let entry: Awaited<ReturnType<typeof updateMemory>>;
    try {
      // accountId/contactId undefined (omitted from the body) keeps that scope axis unchanged.
      entry = await updateMemory(
        req.params.id,
        req.body.content,
        req.body.accountId,
        req.body.contactId,
      );
    } catch (error) {
      throw badRequest(errorMessage(error));
    }
    if (!entry) throw notFound("memory not found");
    return entry;
  });

  app.delete("/api/memories/:id", { schema: { params: idParams } }, async (req) => {
    const deleted = await deleteMemory(req.params.id);
    if (!deleted) throw notFound("memory not found");
    return { ok: true };
  });
};
