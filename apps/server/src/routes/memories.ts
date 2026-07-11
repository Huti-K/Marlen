import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { resetSessions } from "../agent/emailAgent.js";
import { createMemory, deleteMemory, listMemories, updateMemory } from "../db/memories.js";
import { badRequest, notFound } from "../errors.js";
import { errorMessage } from "../util.js";

const memoryBody = Type.Object({
  content: Type.String(),
  // null = global scope; omitted keeps the current scope on updates.
  accountId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

const idParams = Type.Object({ id: Type.String() });

/**
 * Long-term memory, managed in Settings. Memory lives in the system prompt,
 * so every change drops the in-memory agent sessions — the next message (and
 * scheduled runs) see the updated memory.
 */
export const memoryRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get("/api/memories", async () => listMemories());

  app.post("/api/memories", { schema: { body: memoryBody } }, async (req) => {
    // Only createMemory's own validation (empty/too-long content, memory
    // full) belongs to this catch — resetSessions below is a separate
    // failure mode and must not be reported as a bad request too.
    let result: Awaited<ReturnType<typeof createMemory>>;
    try {
      result = await createMemory(req.body.content, "user", req.body.accountId ?? null);
    } catch (error) {
      throw badRequest(errorMessage(error));
    }
    // A dedup hit returns the existing entry unchanged — no need to reset sessions.
    if (result.created) await resetSessions();
    return result.entry;
  });

  app.put("/api/memories/:id", { schema: { params: idParams, body: memoryBody } }, async (req) => {
    let entry: Awaited<ReturnType<typeof updateMemory>>;
    try {
      // accountId undefined (omitted from the body) keeps the entry's current scope.
      entry = await updateMemory(req.params.id, req.body.content, req.body.accountId);
    } catch (error) {
      throw badRequest(errorMessage(error));
    }
    if (!entry) throw notFound("memory not found");
    await resetSessions();
    return entry;
  });

  app.delete("/api/memories/:id", { schema: { params: idParams } }, async (req) => {
    const deleted = await deleteMemory(req.params.id);
    if (!deleted) throw notFound("memory not found");
    await resetSessions();
    return { ok: true };
  });
};
