import * as React from "react";
import { isEmailAccount, useAccountColors } from "@/lib/accounts";
import { takePendingKnowledgeFocus } from "@/lib/paletteFocus";
import { subscribeTrailin } from "@/lib/trailinEvents";
import { LibrarySection } from "./LibrarySection";
import { MemoryStrip } from "./MemoryStrip";
import { SkillsStrip } from "./SkillsStrip";

/**
 * Knowledge: the documents the agent can look up, and the handful of facts it
 * carries around. Documents are the body of the page; memory rides above them
 * as a collapsible strip, because there are usually three of the latter and
 * twenty of the former.
 *
 * Nothing here scrolls on its own — the page flows into the app's single
 * content scroller, like Automations and Settings.
 */

/** How long a search-palette hit stays highlighted before it fades back. */
const HIGHLIGHT_MS = 2400;

export function KnowledgePanel() {
  // Set by the search palette (see SearchPalette.tsx) when a document/memory hit is opened.
  const [focusMemoryId, setFocusMemoryId] = React.useState<string | null>(null);
  const [focusDocumentId, setFocusDocumentId] = React.useState<string | null>(null);

  // Connected accounts + their colors, feeding the memory scope picker and
  // account filter chips. Email accounts only for scoping — a Notion or Slack
  // connection has no sent mail to scope facts to.
  const { accounts, colors } = useAccountColors();
  const emailAccounts = React.useMemo(() => accounts.filter(isEmailAccount), [accounts]);

  // The search palette navigates here, then dispatches this with the hit's
  // id — but only once this effect's listener is attached, which loses the
  // race when Knowledge wasn't already mounted. Catch that case by also
  // reading the same payload stashed just before navigate (lib/paletteFocus.ts).
  React.useEffect(() => {
    const applyFocus = (detail: { type: "document" | "memory"; id: string }) => {
      if (detail.type === "memory") setFocusMemoryId(detail.id);
      else setFocusDocumentId(detail.id);
    };
    const pending = takePendingKnowledgeFocus();
    if (pending) applyFocus(pending);
    return subscribeTrailin("open-knowledge", (detail) => {
      if (!detail) return;
      applyFocus(detail);
      // Already handled live — discard so a later remount doesn't replay it.
      takePendingKnowledgeFocus();
    });
  }, []);

  // Let the highlight fade once it has done its job. Clearing it also means
  // re-opening the same hit registers as a change and scrolls to it again.
  React.useEffect(() => {
    if (!focusMemoryId) return;
    const timer = setTimeout(() => setFocusMemoryId(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [focusMemoryId]);

  React.useEffect(() => {
    if (!focusDocumentId) return;
    const timer = setTimeout(() => setFocusDocumentId(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [focusDocumentId]);

  return (
    <div className="flex flex-col gap-8 pb-4 pt-2">
      <MemoryStrip
        focusId={focusMemoryId}
        accounts={accounts}
        colors={colors}
        emailAccounts={emailAccounts}
      />
      <SkillsStrip />
      <LibrarySection focusId={focusDocumentId} />
    </div>
  );
}
