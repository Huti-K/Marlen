import * as React from "react";
import type { ServerEvent, ServerEventTopic } from "@trailin/shared";

/**
 * One shared EventSource on GET /api/events. Created when the first panel
 * subscribes, closed when the last unsubscribes. Events are debounced per
 * topic so a burst of server-side changes (an agent creating three drafts)
 * causes one refetch, not three.
 */

const DEBOUNCE_MS = 300;

interface Subscription {
  topics: ServerEventTopic[];
  handler: () => void;
}

const subscriptions = new Set<Subscription>();
const timers = new Map<ServerEventTopic, ReturnType<typeof setTimeout>>();
let source: EventSource | null = null;
let dropped = false;

function dispatch(topic: ServerEventTopic): void {
  for (const sub of subscriptions) {
    if (sub.topics.includes(topic)) sub.handler();
  }
}

function connect(): void {
  source = new EventSource("/api/events");
  source.onmessage = (e: MessageEvent<string>) => {
    let event: ServerEvent;
    try {
      event = JSON.parse(e.data) as ServerEvent;
    } catch {
      return;
    }
    const pending = timers.get(event.topic);
    if (pending) clearTimeout(pending);
    timers.set(
      event.topic,
      setTimeout(() => {
        timers.delete(event.topic);
        dispatch(event.topic);
      }, DEBOUNCE_MS),
    );
  };
  source.onerror = () => {
    // The browser reconnects on its own (the server sends `retry: 3000`).
    dropped = true;
  };
  source.onopen = () => {
    if (!dropped) return;
    dropped = false;
    // Back after a drop: refetch everything to catch changes missed offline.
    for (const sub of subscriptions) sub.handler();
  };
}

function disconnect(): void {
  source?.close();
  source = null;
  dropped = false;
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
}

export function subscribeServerEvents(
  topics: ServerEventTopic[],
  handler: () => void,
): () => void {
  const sub: Subscription = { topics, handler };
  subscriptions.add(sub);
  if (!source) connect();
  return () => {
    subscriptions.delete(sub);
    if (subscriptions.size === 0) disconnect();
  };
}

/** Re-run a panel's loader whenever the server changes data under these topics. */
export function useServerEvents(topics: ServerEventTopic[], onChange: () => void): void {
  const handler = React.useRef(onChange);
  handler.current = onChange;
  const key = topics.join(",");
  React.useEffect(
    () => subscribeServerEvents(key.split(",") as ServerEventTopic[], () => handler.current()),
    [key],
  );
}
