/**
 * The last `trailin:*` window `CustomEvent` standing — chat commands moved
 * to features/chat/controller.ts and navigation intents to router/URL state
 * (lib/nav.ts, ?focus= params). `open-draft` follows once HomePanel's
 * palette focus reads URL state too; then this module and lib/paletteFocus
 * are deleted together. Dispatch and listen only through the helpers below,
 * so every site agrees on the payload type.
 */
export interface TrailinEventMap {
  /** Focus a specific draft on the Home tab. */
  "open-draft": { accountId: string; draftId: string };
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
