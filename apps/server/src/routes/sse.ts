import type { FastifyReply } from "fastify";

/** The three headers every SSE response needs to stay open through proxies and browsers. */
const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
} as const;

/** A hijacked reply opened as an SSE stream — see openSse. */
export interface SseStream<T> {
  /** Write one `data:` frame. A no-op once the stream has ended. */
  send(payload: T): void;
  /** Detach the close listener and end the underlying response. Safe to call more than once. */
  end(): void;
}

/**
 * Hijacks `reply` — tells Fastify the response is ours now, since we stream
 * on the raw socket — writes the SSE headers, and listens for the raw
 * response's own "close" event to detect the client disconnecting mid-stream.
 * Response close, not request close, is what signals a real disconnect: the
 * request's own "close" fires as soon as its body is consumed (Node ≥ 16),
 * long before the client actually goes away.
 *
 * `onClose` runs at most once, only for a genuine disconnect: `end()`
 * detaches the listener before it ends the response itself, so a route's own
 * graceful shutdown can never re-trigger cleanup meant for an unexpected
 * disconnect.
 */
export function openSse<T>(reply: FastifyReply, onClose: () => void): SseStream<T> {
  reply.hijack();
  reply.raw.writeHead(200, SSE_HEADERS);

  let ended = false;
  const handleClose = () => {
    if (ended) return;
    ended = true;
    onClose();
  };
  reply.raw.on("close", handleClose);

  return {
    send(payload) {
      if (ended) return;
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    },
    end() {
      reply.raw.off("close", handleClose);
      if (ended) return;
      ended = true;
      if (!reply.raw.writableEnded) reply.raw.end();
    },
  };
}
