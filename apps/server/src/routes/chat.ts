import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { desc, eq } from "drizzle-orm";
import type { ChatStreamEvent } from "@trailin/shared";
import { db, schema } from "../db/index.js";
import { getOrCreateSession, runPrompt } from "../agent/emailAgent.js";

interface ChatBody {
  conversationId?: string;
  message: string;
}

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/conversations", async () => {
    return db
      .select()
      .from(schema.conversations)
      .orderBy(desc(schema.conversations.createdAt));
  });

  app.get<{ Params: { id: string } }>("/api/conversations/:id/messages", async (req) => {
    return db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, req.params.id))
      .orderBy(schema.messages.createdAt);
  });

  app.post<{ Body: ChatBody }>("/api/chat", async (req, reply) => {
    const message = req.body?.message?.trim();
    if (!message) {
      return reply.code(400).send({ error: "message is required" });
    }

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const send = (event: ChatStreamEvent) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    const now = () => new Date().toISOString();

    try {
      let conversationId = req.body.conversationId;
      if (!conversationId) {
        conversationId = randomUUID();
        await db.insert(schema.conversations).values({
          id: conversationId,
          title: message.slice(0, 80),
          createdAt: now(),
        });
      }
      send({ type: "conversation", conversationId });

      await db.insert(schema.messages).values({
        id: randomUUID(),
        conversationId,
        role: "user",
        content: message,
        createdAt: now(),
      });

      const session = await getOrCreateSession(conversationId);
      const text = await runPrompt(session, message, {
        onTextDelta: (delta) => send({ type: "text_delta", delta }),
        onToolStart: (toolName) => send({ type: "tool_start", toolName }),
        onToolEnd: (toolName, isError) => send({ type: "tool_end", toolName, isError }),
      });

      await db.insert(schema.messages).values({
        id: randomUUID(),
        conversationId,
        role: "assistant",
        content: text,
        createdAt: now(),
      });

      send({ type: "done", text });
    } catch (error) {
      req.log.error(error, "chat failed");
      send({ type: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      reply.raw.end();
    }
  });
}
