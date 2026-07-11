import type { ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";
import { onServerEvent } from "../events.js";

/** Comment frames keep proxies and browsers from dropping the idle stream. */
const HEARTBEAT_MS = 25_000;

/** Live "data changed" notifications for the web UI, as one SSE stream. */
export async function eventRoutes(app: FastifyInstance): Promise<void> {
  // Hijacked replies are invisible to Fastify's own request draining, so
  // close() must end the open streams itself rather than wait on every
  // connected browser tab.
  const streams = new Set<ServerResponse>();
  app.addHook("onClose", async () => {
    for (const raw of streams) {
      if (!raw.writableEnded) raw.end();
    }
  });

  app.get("/api/events", async (_req, reply) => {
    // We stream on the raw socket; tell Fastify the reply is ours now.
    reply.hijack();
    streams.add(reply.raw);
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    reply.raw.write("retry: 3000\n\n");
    reply.raw.write(": connected\n\n");

    const unsubscribe = onServerEvent((event) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    const heartbeat = setInterval(() => {
      reply.raw.write(": ping\n\n");
    }, HEARTBEAT_MS);

    // The *response* closing signals the client went away — the request's
    // own "close" fires as soon as it is fully received (Node ≥ 16), which
    // would tear the stream down immediately.
    reply.raw.on("close", () => {
      streams.delete(reply.raw);
      unsubscribe();
      clearInterval(heartbeat);
      if (!reply.raw.writableEnded) reply.raw.end();
    });
  });
}
