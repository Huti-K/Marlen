import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { ServerEvent } from "@trailin/shared";
import { onServerEvent } from "../events.js";
import { openSse } from "./sse.js";

/** Comment frames keep proxies and browsers from dropping the idle stream. */
const HEARTBEAT_MS = 25_000;

/** Live "data changed" notifications for the web UI, as one SSE stream. */
export const eventRoutes: FastifyPluginAsyncTypebox = async (app) => {
  // Hijacked replies are invisible to Fastify's own request draining, so
  // close() must tear down the open streams itself — bus subscription and
  // heartbeat included — rather than wait on every connected browser tab.
  const teardowns = new Set<() => void>();
  app.addHook("onClose", async () => {
    for (const teardown of teardowns) teardown();
  });

  app.get("/api/events", async (_req, reply) => {
    const stream = openSse<ServerEvent>(reply, () => teardown());
    const unsubscribe = onServerEvent((event) => stream.send(event));
    const heartbeat = setInterval(() => {
      reply.raw.write(": ping\n\n");
    }, HEARTBEAT_MS);
    // One teardown for both ways a stream dies — client disconnect (openSse's
    // close callback) and server shutdown (the onClose hook above). The
    // heartbeat stops before end(), so nothing writes to an ended response.
    const teardown = () => {
      teardowns.delete(teardown);
      unsubscribe();
      clearInterval(heartbeat);
      stream.end();
    };
    teardowns.add(teardown);

    reply.raw.write("retry: 3000\n\n");
    reply.raw.write(": connected\n\n");
  });
};
