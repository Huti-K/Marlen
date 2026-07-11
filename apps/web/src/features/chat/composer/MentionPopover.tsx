import type { AccountColor, MailSuggestion } from "@trailin/shared";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { AccountDot } from "@/components/ui/account-dot";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/dates";
import { cn } from "@/lib/utils";

const DEBOUNCE_MS = 200;

/** Keyboard control surface the composer's textarea drives from its own
 *  onKeyDown — the popover never takes focus, since a mention search must
 *  never move the caret away from where the user is typing. */
export interface MentionPopoverHandle {
  moveHighlight: (delta: number) => void;
  /** Picks the highlighted suggestion; false when there is nothing to pick
   *  (no results yet), so the composer can let Enter fall through to send. */
  pickHighlighted: () => boolean;
}

/**
 * Floating @-mention suggestions, anchored above the composer. A debounced
 * keyword search against the mailbox mirror; an empty query is a valid
 * search (recent threads), so it fires as soon as the user types a bare "@".
 * While a request is in flight the previous results stay on screen and a
 * thin accent bar sweeps instead — never a spinner that blanks the list.
 */
export const MentionPopover = React.forwardRef<
  MentionPopoverHandle,
  {
    query: string;
    colors?: AccountColor[];
    onPick: (item: MailSuggestion) => void;
  }
>(function MentionPopover({ query, colors, onPick }, ref) {
  const { t, i18n } = useTranslation();
  const [result, setResult] = React.useState<{ query: string; items: MailSuggestion[] } | null>(
    null,
  );
  const [highlighted, setHighlighted] = React.useState(0);
  const requestSeq = React.useRef(0);
  const listRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const seq = ++requestSeq.current;
    const timer = setTimeout(() => {
      api
        .mailSuggest(query)
        .then((res) => {
          if (seq === requestSeq.current) setResult({ query, items: res.items });
        })
        .catch(() => {
          if (seq === requestSeq.current) setResult({ query, items: [] });
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const items = result?.items ?? [];
  // Previous results stay visible under the sweep while the newest query is still in flight.
  const loading = result?.query !== query;

  // biome-ignore lint/correctness/useExhaustiveDependencies: query isn't read here — a new query resetting the highlight is the intentional trigger, independent of when its results land
  React.useEffect(() => {
    setHighlighted(0);
  }, [query]);

  // Results can shrink under the highlight (a slower earlier query lands after a shorter one).
  React.useEffect(() => {
    setHighlighted((h) => Math.min(h, Math.max(0, items.length - 1)));
  }, [items.length]);

  React.useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${highlighted}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  React.useImperativeHandle(
    ref,
    () => ({
      moveHighlight(delta) {
        setHighlighted((h) => Math.min(items.length - 1, Math.max(0, h + delta)));
      },
      pickHighlighted() {
        const item = items[highlighted];
        if (!item) return false;
        onPick(item);
        return true;
      },
    }),
    [items, highlighted, onPick],
  );

  const colorFor = (accountId: string) => colors?.find((c) => c.accountId === accountId)?.hex;

  return (
    <div className="surface-pop absolute inset-x-0 bottom-full z-20 mb-2 flex max-h-64 flex-col overflow-hidden">
      {/* Invisible at rest — only the accent sweep shows while a query is in flight. */}
      <div className="relative h-px shrink-0 overflow-hidden">
        {loading && <div className="palette-scan absolute inset-y-0 left-0 w-1/3 bg-accent" />}
      </div>
      <span className="sr-only" aria-live="polite">
        {loading ? t("chat.mention.loading") : ""}
      </span>
      <div ref={listRef} className="scroll-stable flex-1 overflow-y-auto p-1">
        {items.length === 0 ? (
          loading ? null : (
            <p className="px-3 py-2 text-xs text-muted-foreground">{t("chat.mention.empty")}</p>
          )
        ) : (
          items.map((item, index) => (
            <button
              key={`${item.threadId}:${item.messageId ?? ""}`}
              type="button"
              data-index={index}
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHighlighted(index)}
              onClick={() => onPick(item)}
              className={cn(
                "flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors",
                index === highlighted ? "bg-accent/10" : "hover:bg-secondary",
              )}
            >
              <AccountDot color={colorFor(item.accountId)} className="mt-1.5 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">
                  {item.subject || t("chat.cards.noSubject")}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {item.from} · {relativeTime(item.date, i18n.language)}
                </span>
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
});
