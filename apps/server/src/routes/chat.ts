import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { desc, eq } from "drizzle-orm";
import type { ChatStreamEvent } from "@trailin/shared";
import { db, schema } from "../db/index.js";
import { getOrCreateSession, runPrompt } from "../agent/emailAgent.js";
import { emitServerEvent } from "../events.js";
import { errorMessage } from "../util.js";

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
    let msgs = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, req.params.id))
      .orderBy(schema.messages.createdAt);

    if (msgs.length === 0) {
      // Fallback: check if this ID is actually an old automation run
      const runs = await db
        .select()
        .from(schema.automationRuns)
        .where(eq(schema.automationRuns.id, req.params.id))
        .limit(1);

      if (runs.length > 0) {
        const run = runs[0];
        if (run) {
          const autos = await db
            .select()
            .from(schema.automations)
            .where(eq(schema.automations.id, run.automationId))
            .limit(1);
          const auto = autos[0];

          if (auto) {
            msgs = [
              {
                id: req.params.id + "-user",
                conversationId: req.params.id,
                role: "user",
                content: `Scheduled automation "${auto.name}". Execute this instruction now and report the outcome:\n\n${auto.instruction}`,
                createdAt: run.startedAt,
              },
              {
                id: req.params.id + "-assistant",
                conversationId: req.params.id,
                role: "assistant",
                content: run.result || "Run failed or no result.",
                createdAt: run.finishedAt || run.startedAt,
              },
            ];
          }
        }
      }
    }

    return msgs;
  });

  app.post<{ Body: ChatBody }>("/api/chat", async (req, reply) => {
    const message = req.body?.message?.trim();
    if (!message) {
      return reply.code(400).send({ error: "message is required" });
    }

    // We stream on the raw socket; tell Fastify the reply is ours now.
    reply.hijack();
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
        emitServerEvent("conversations");
      }
      send({ type: "conversation", conversationId });

      // Build the session before persisting the new message: a session rebuilt
      // from the DB must seed only *prior* turns, not the one being sent.
      const session = await getOrCreateSession(conversationId);

      await db.insert(schema.messages).values({
        id: randomUUID(),
        conversationId,
        role: "user",
        content: message,
        createdAt: now(),
      });
      let thinkingSent = false;
      const text = await runPrompt(session, message, {
        onTextDelta: (delta) => send({ type: "text_delta", delta }),
        // At most one per turn — it only drives the UI's "thinking…" placeholder.
        onThinking: () => {
          if (!thinkingSent) {
            thinkingSent = true;
            send({ type: "thinking" });
          }
        },
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
      emitServerEvent("conversations");

      send({ type: "done", text });
    } catch (error) {
      req.log.error(error, "chat failed");
      send({ type: "error", message: errorMessage(error) });
    } finally {
      reply.raw.end();
    }
  });
}
