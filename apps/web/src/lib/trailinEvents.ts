import type { EmailRef } from "@trailin/shared";
import type { ThemePref } from "@/lib/useTheme";

/**
 * Every `trailin:*` window `CustomEvent`, keyed by its name (without the
 * `trailin:` wire prefix) to the type of its `detail`. `undefined` marks
 * events that carry no detail. This is the single source of truth for the
 * on-the-wire shape of each event — dispatch and listen only through
 * `dispatchTrailin` and `subscribeTrailin` below, never
 * `window.dispatchEvent`/`addEventListener` directly, so every site agrees
 * on these types.
 */
export interface TrailinEventMap {
  /** Push this route path (e.g. a toast's click-through action). */
  navigate: string;
  /** Show the chat panel/tab without changing what conversation it holds. */
  "show-chat": undefined;
  /** Open the Cmd+K / Ctrl+K search palette. */
  "open-search": undefined;
  /** Reset the chat panel to a fresh, empty conversation. */
  "new-chat": undefined;
  /** Open an existing conversation (or automation run) by id. */
  "open-chat": string;
  /** Start a fresh conversation with the composer pre-filled but not sent. */
  "prefill-chat": { text: string };
  /** Start a fresh conversation and send this text immediately. */
  "send-chat": { text: string };
  /** Answer a choices-card question in the conversation that asked it. */
  "answer-chat": { text: string; refs?: EmailRef[] };
  /** Pin an email to the composer's next message. */
  "add-chat-ref": { ref: EmailRef };
  /** The conversation list changed; the history rail should refetch. */
  "conversations-changed": undefined;
  /** Focus a specific draft on the Home tab. */
  "open-draft": { accountId: string; draftId: string };
  /** Focus a specific document or memory on the Knowledge tab. */
  "open-knowledge": { type: "document" | "memory"; id: string };
  /** Open an email attachment in the side-panel viewer. */
  "open-attachment": {
    accountId: string;
    messageId: string;
    filename: string;
    mimeType?: string;
    /** The document library accepts this format, so the viewer offers "Save to library". */
    saveable: boolean;
  };
  /** The resolved theme preference changed; broadcast for cross-instance sync. */
  "theme-changed": ThemePref;
}

/** Event names whose `detail` is `undefined` — these dispatch with no second argument. */
type VoidEventName = {
  [K in keyof TrailinEventMap]: TrailinEventMap[K] extends undefined ? K : never;
}[keyof TrailinEventMap];

function wireName<K extends keyof TrailinEventMap>(name: K): string {
  return `trailin:${name}`;
}

/** Dispatch a `trailin:*` event that carries no payload. */
export function dispatchTrailin<K extends VoidEventName>(name: K): void;
/** Dispatch a `trailin:*` event, carrying its typed `detail`. */
export function dispatchTrailin<K extends Exclude<keyof TrailinEventMap, VoidEventName>>(
  name: K,
  detail: TrailinEventMap[K],
): void;
export function dispatchTrailin<K extends keyof TrailinEventMap>(
  name: K,
  detail?: TrailinEventMap[K],
): void {
  window.dispatchEvent(new CustomEvent(wireName(name), { detail }));
}

/**
 * Listen for a `trailin:*` event and get a `detail` typed by `TrailinEventMap`.
 * Returns an unsubscribe function, so callers can `return subscribeTrailin(...)`
 * directly from a `useEffect`. This is the only place in the app that casts
 * the raw DOM `Event` to a `CustomEvent`.
 */
export function subscribeTrailin<K extends keyof TrailinEventMap>(
  name: K,
  handler: (detail: TrailinEventMap[K]) => void,
): () => void {
  const listener = (event: Event) => {
    handler((event as CustomEvent<TrailinEventMap[K]>).detail);
  };
  window.addEventListener(wireName(name), listener);
  return () => window.removeEventListener(wireName(name), listener);
}
