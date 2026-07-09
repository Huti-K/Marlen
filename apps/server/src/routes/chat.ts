import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { desc, eq, inArray, or, sql } from "drizzle-orm";
import type { ChatStreamEvent } from "@trailin/shared";
import { db, schema } from "../db/index.js";
import { parseStoredCards } from "../agent/cards.js";
import { disposeSession, getOrCreateSession, runPrompt } from "../agent/emailAgent.js";
import { collectTurnCards, serializeTurnCards } from "../agent/turnCards.js";
import { emitServerEvent } from "../events.js";
import { errorMessage, escapeLikeInput, likePattern } from "../util.js";

interface ChatBody {
  conversationId?: string;
  message: string;
}

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { q?: string; limit?: string; offset?: string } }>(
    "/api/conversations",
    async (req) => {
      const q = req.query.q?.trim();
      const limit = Math.min(Math.max(parseInt(req.query.limit ?? "", 10) || 50, 1), 200);
      const offset = Math.max(parseInt(req.query.offset ?? "", 10) || 0, 0);

      // Matches conversations by title, or that contain at least one matching message.
      const pattern = q ? `%${escapeLikeInput(q)}%` : undefined;
      const where = pattern
        ? or(
            likePattern(schema.conversations.title, pattern),
            inArray(
              schema.conversations.id,
              db
                .select({ id: schema.messages.conversationId })
                .from(schema.messages)
                .where(likePattern(schema.messages.content, pattern)),
            ),
          )
        : undefined;

      const itemsQuery = db.select().from(schema.conversations);
      const items = await (where ? itemsQuery.where(where) : itemsQuery)
        .orderBy(desc(schema.conversations.createdAt))
        .limit(limit)
        .offset(offset);

      const totalQuery = db.select({ count: sql<number>`count(*)` }).from(schema.conversations);
      const [totalRow] = await (where ? totalQuery.where(where) : totalQuery);

      return { items, total: Number(totalRow?.count ?? 0) };
    },
  );

  app.patch<{ Params: { id: string }; Body: { title: string } }>(
    "/api/conversations/:id",
    async (req, reply) => {
      const title = req.body?.title?.trim();
      if (!title) {
        return reply.code(400).send({ error: "title is required" });
      }
      await db
        .update(schema.conversations)
        .set({ title })
        .where(eq(schema.conversations.id, req.params.id));
      emitServerEvent("conversations");
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>("/api/conversations/:id", async (req) => {
    await db.delete(schema.messages).where(eq(schema.messages.conversationId, req.params.id));
    await db.delete(schema.conversations).where(eq(schema.conversations.id, req.params.id));
    // Drop the live agent session too — otherwise a deleted conversation could
    // keep running (and its next reply would resurrect the row on write).
    await disposeSession(req.params.id);
    emitServerEvent("conversations");
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>("/api/conversations/:id/messages", async (req) => {
    const rows = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, req.params.id))
      .orderBy(schema.messages.createdAt);

    // The cards column is a JSON blob internally; the API ships parsed cards.
    let msgs = rows.map(({ cards, ...row }) => ({
      ...row,
      cards: parseStoredCards(cards),
    }));

    if (msgs.length === 0) {
      // Legacy-only fallback: automation runs now write real rows into
      // `messages` (see automations/scheduler.ts), so this only reconstructs
      // synthetic messages for runs that predate that change.
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
                cards: undefined,
              },
              {
                id: req.params.id + "-assistant",
                conversationId: req.params.id,
                role: "assistant",
                content: run.result || "Run failed or no result.",
                createdAt: run.finishedAt || run.startedAt,
                cards: undefined,
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

    // Stop the turn as soon as the client disconnects, so an abandoned tab
    // doesn't keep burning tool calls and model tokens (see routes/events.ts
    // for the same pattern on the plain SSE stream). Disconnect is signalled
    // by the *response* closing before we ended it — the request's own
    // "close" fires as soon as its body is consumed (Node ≥ 16), long before
    // the client goes away.
    let clientClosed = false;
    const controller = new AbortController();
    const onClientClose = () => {
      if (reply.raw.writableEnded) return;
      clientClosed = true;
      controller.abort();
    };
    reply.raw.on("close", onClientClose);

    const send = (event: ChatStreamEvent) => {
      if (clientClosed) return;
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
      // Collects this turn's cards (persisted with the assistant message below)
      // and links any created draft back to this conversation.
      const turnCards = collectTurnCards(conversationId);
      const text = await runPrompt(
        session,
        message,
        {
          onTextDelta: (delta) => send({ type: "text_delta", delta }),
          // At most one per turn — it only drives the UI's "thinking…" placeholder.
          onThinking: () => {
            if (!thinkingSent) {
              thinkingSent = true;
              send({ type: "thinking" });
            }
          },
          onToolStart: (toolName) => send({ type: "tool_start", toolName }),
          onToolUpdate: (toolName, detail) => send({ type: "tool_update", toolName, detail }),
          onToolEnd: (toolName, isError) => send({ type: "tool_end", toolName, isError }),
          onCard: (toolCallId, card) => {
            turnCards.onCard(toolCallId, card);
            send({ type: "card", toolCallId, card });
          },
        },
        controller.signal,
        req.log.child({ conversationId }),
      );

      await db.insert(schema.messages).values({
        id: randomUUID(),
        conversationId,
        role: "assistant",
        content: text,
        cards: serializeTurnCards(turnCards.cards),
        createdAt: now(),
      });
      emitServerEvent("conversations");

      send({ type: "done", text });
    } catch (error) {
      // A client-disconnect abort surfaces here too (runPrompt rethrows the
      // agent's "aborted" failure); clientClosed already suppressed send().
      req.log.error(error, "chat failed");
      send({ type: "error", message: errorMessage(error) });
    } finally {
      reply.raw.off("close", onClientClose);
      if (!reply.raw.writableEnded) reply.raw.end();
    }
  });
}
