import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { ServerEvent } from "@trailin/shared";
import { onServerEvent } from "../events.js";
import { openSse } from "./sse.js";

/**
 * Named "ping" events keep proxies from dropping the idle stream AND give the
 * client a liveness signal it can watch: a proxy may swallow the upstream's
 * end without closing the browser-side socket, so a stream that stops pinging
 * is the client's only way to detect it is dead (see web lib/serverEvents.ts).
 * Comment frames can't serve that role — EventSource never surfaces them.
 */
const HEARTBEAT_MS = 15_000;

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
      reply.raw.write("event: ping\ndata: {}\n\n");
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
