import type { ServerEvent } from "@trailin/shared";
import type { FastifyInstance } from "fastify";
import { onServerEvent } from "../events.js";
import { openSse, type SseStream } from "./sse.js";

/** Comment frames keep proxies and browsers from dropping the idle stream. */
const HEARTBEAT_MS = 25_000;

/** Live "data changed" notifications for the web UI, as one SSE stream. */
export async function eventRoutes(app: FastifyInstance): Promise<void> {
  // Hijacked replies are invisible to Fastify's own request draining, so
  // close() must end the open streams itself rather than wait on every
  // connected browser tab.
  const streams = new Set<SseStream<ServerEvent>>();
  app.addHook("onClose", async () => {
    for (const stream of streams) stream.end();
  });

  app.get("/api/events", async (_req, reply) => {
    let unsubscribe: () => void;
    let heartbeat: ReturnType<typeof setInterval>;

    const stream = openSse<ServerEvent>(reply, () => {
      streams.delete(stream);
      unsubscribe();
      clearInterval(heartbeat);
    });
    streams.add(stream);

    unsubscribe = onServerEvent((event) => stream.send(event));
    heartbeat = setInterval(() => {
      reply.raw.write(": ping\n\n");
    }, HEARTBEAT_MS);

    reply.raw.write("retry: 3000\n\n");
    reply.raw.write(": connected\n\n");
  });
}
