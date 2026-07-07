import type { FastifyInstance } from "fastify";
import { createMemory, deleteMemory, listMemories, updateMemory } from "../db/memories.js";
import { resetSessions } from "../agent/emailAgent.js";
import { errorMessage } from "../util.js";

/**
 * Long-term memory, managed in Settings. Memory lives in the system prompt,
 * so every change drops the in-memory agent sessions — the next message (and
 * scheduled runs) see the updated memory.
 */
export async function memoryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/memories", async () => listMemories());

  app.post<{ Body: { content?: string } }>("/api/memories", async (req, reply) => {
    try {
      const entry = await createMemory(req.body?.content ?? "", "user");
      await resetSessions();
      return entry;
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });

  app.put<{ Params: { id: string }; Body: { content?: string } }>(
    "/api/memories/:id",
    async (req, reply) => {
      try {
        const entry = await updateMemory(req.params.id, req.body?.content ?? "");
        if (!entry) return reply.code(404).send({ error: "memory not found" });
        await resetSessions();
        return entry;
      } catch (error) {
        return reply.code(400).send({ error: errorMessage(error) });
      }
    },
  );

  app.delete<{ Params: { id: string } }>("/api/memories/:id", async (req) => {
    await deleteMemory(req.params.id);
    await resetSessions();
    return { ok: true };
  });
}
