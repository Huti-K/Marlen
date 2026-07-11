import * as React from "react";

/** Span of the active "@query" in the textarea's value — `start` is the "@" index, `end` is the caret. */
export interface MentionRange {
  start: number;
  end: number;
}

interface MentionQueryState {
  active: boolean;
  query: string;
  range: MentionRange | null;
}

const INACTIVE: MentionQueryState = { active: false, query: "", range: null };

/**
 * Detects the composer's active "@mention" span from the textarea's live DOM
 * state (value + caret), not React's `input` state, so a fast keystroke or a
 * programmatic caret move (arrow keys, a click) is never one render stale.
 *
 * A mention is active when the caret sits after an "@" that opens at the
 * very start of the text or right after whitespace, and the query does not
 * itself start with whitespace ("@ the meeting" is prose, not a mention).
 * The query is everything between that "@" and the caret; the backward scan
 * stops at a newline, so a mention never spans across lines.
 *
 * Callers must invoke `recompute()` from every textarea event that can move
 * the caret or change its value (change, click, keyup), `clear()` on blur or
 * once a suggestion is picked, and `dismiss()` on Escape — a dismissed "@"
 * stays inactive until the caret leaves its mention span or a different "@"
 * opens, so typing onward doesn't immediately reopen the popover.
 */
export function useMentionQuery(textareaRef: React.RefObject<HTMLTextAreaElement | null>) {
  const [state, setState] = React.useState<MentionQueryState>(INACTIVE);
  const dismissedAt = React.useRef<number | null>(null);

  const recompute = React.useCallback(() => {
    const el = textareaRef.current;
    if (!el) {
      dismissedAt.current = null;
      setState(INACTIVE);
      return;
    }
    const caret = el.selectionStart ?? el.value.length;
    const value = el.value;
    let at = -1;
    for (let i = caret - 1; i >= 0; i--) {
      const ch = value[i];
      if (ch === "@") {
        at = i;
        break;
      }
      if (ch === "\n") break;
    }
    const before = at > 0 ? value[at - 1] : undefined;
    const query = at === -1 ? "" : value.slice(at + 1, caret);
    if (at === -1 || (before !== undefined && !/\s/.test(before)) || /^\s/.test(query)) {
      dismissedAt.current = null;
      setState(INACTIVE);
      return;
    }
    if (dismissedAt.current === at) {
      setState(INACTIVE);
      return;
    }
    dismissedAt.current = null;
    setState({ active: true, query, range: { start: at, end: caret } });
  }, [textareaRef]);

  const clear = React.useCallback(() => setState(INACTIVE), []);

  const dismiss = React.useCallback(() => {
    setState((prev) => {
      if (prev.range) dismissedAt.current = prev.range.start;
      return INACTIVE;
    });
  }, []);

  return { ...state, recompute, clear, dismiss };
}

/** Removes a picked mention's "@query" span from the composer text, returning
 *  the caret position the composer should restore focus to (the span's own
 *  start — right where the "@" used to be). */
export function spliceMentionPick(
  value: string,
  range: MentionRange,
): { value: string; caret: number } {
  return { value: value.slice(0, range.start) + value.slice(range.end), caret: range.start };
}
