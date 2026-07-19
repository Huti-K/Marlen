/**
 * Module-level handoff for the search palette's draft hits.
 *
 * SearchPalette's openHit navigates to Home and then fires the `open-draft`
 * event for HomePanel to pick up. react-router's navigate is a batched state
 * update, so when the palette is used from another route, HomePanel isn't
 * mounted yet when the event fires — and window events aren't queued for a
 * listener that shows up later, so the dispatch is silently dropped.
 *
 * Stashing the same payload here lets HomePanel's mount effect pick it up
 * (read-and-clear, see takePendingDraftFocus) even when the live listener
 * missed it. The CustomEvent path handles the case where Home is already
 * mounted. Knowledge focus moved to URL state (?focus=…); this follows when
 * HomePanel's draft focus does the same.
 */

interface DraftFocus {
  accountId: string;
  draftId: string;
}

let pendingDraftFocus: DraftFocus | null = null;

export function setPendingDraftFocus(focus: DraftFocus): void {
  pendingDraftFocus = focus;
}

/** Reads and clears in one step — a mount effect only ever applies this once. */
export function takePendingDraftFocus(): DraftFocus | null {
  const focus = pendingDraftFocus;
  pendingDraftFocus = null;
  return focus;
}
