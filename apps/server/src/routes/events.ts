import type { FastifyInstance } from "fastify";
import { onServerEvent } from "../events.js";

/** Comment frames keep proxies and browsers from dropping the idle stream. */
const HEARTBEAT_MS = 25_000;

/** Live "data changed" notifications for the web UI, as one SSE stream. */
export async function eventRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/events", async (req, reply) => {
    // We stream on the raw socket; tell Fastify the reply is ours now.
    reply.hijack();
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
      unsubscribe();
      clearInterval(heartbeat);
      if (!reply.raw.writableEnded) reply.raw.end();
    });
  });
}
