import type { EmailRef } from "@trailin/shared";
import * as React from "react";

/** Matches the server's cap on ChatMessage.refs — additional picks past this are ignored. */
const MAX_CHAT_REFS = 8;

/** Same email dedupe key ChatPanel uses everywhere refs are compared: a
 *  whole-thread ref (messageId undefined) only ever matches another
 *  whole-thread ref on the same thread. */
function sameRef(a: EmailRef, b: EmailRef): boolean {
  return a.threadId === b.threadId && a.messageId === b.messageId;
}

/**
 * Owns the composer's pinned-email list: an @-mention pick or a card's "add
 * to chat" action both funnel through `add`, deduped by thread+message and
 * capped at MAX_CHAT_REFS (silently ignored past the cap — the server would
 * reject a longer list anyway).
 */
export function useComposerRefs() {
  const [refs, setRefs] = React.useState<EmailRef[]>([]);

  const add = React.useCallback((ref: EmailRef) => {
    setRefs((prev) => {
      if (prev.some((r) => sameRef(r, ref))) return prev;
      if (prev.length >= MAX_CHAT_REFS) return prev;
      return [...prev, ref];
    });
  }, []);

  const remove = React.useCallback((ref: EmailRef) => {
    setRefs((prev) => prev.filter((r) => !sameRef(r, ref)));
  }, []);

  const clear = React.useCallback(() => setRefs([]), []);

  return { refs, add, remove, clear };
}
