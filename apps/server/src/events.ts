import { EventEmitter } from "node:events";
import type { ServerEvent, ServerEventTopic } from "@trailin/shared";

/**
 * In-process bus for "data changed" notifications, fanned out to the web UI
 * over GET /api/events. Emits live in the lowest-level mutation functions so
 * every path (chat agent tool, automation run, HTTP route) is covered once.
 */
const bus = new EventEmitter();
bus.setMaxListeners(0);

export function emitServerEvent(topic: ServerEventTopic): void {
  bus.emit("event", { topic } satisfies ServerEvent);
}

/** Subscribe to every server event; returns an unsubscribe function. */
export function onServerEvent(listener: (event: ServerEvent) => void): () => void {
  bus.on("event", listener);
  return () => {
    bus.off("event", listener);
  };
}
