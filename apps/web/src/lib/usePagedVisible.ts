import * as React from "react";

/**
 * Monotonic "show more" cap for a filtered list: starts at `initial`, grows by
 * `step`, resets to `initial` whenever `resetKey` changes (pass the filter or
 * query the list is derived from), and can jump past the fold to reveal one
 * specific index (a search-palette hit). Pairs with `ShowMoreButton`.
 */
export function usePagedVisible(initial: number, step: number, resetKey: string) {
  const [visible, setVisible] = React.useState(initial);

  // Reset the cap whenever the visible set changes shape, so a narrower
  // filter or search doesn't leave the cap sitting past the end.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resetKey drives the reset, not the effect body
  React.useEffect(() => {
    setVisible(initial);
  }, [resetKey]);

  const showMore = React.useCallback(() => setVisible((v) => v + step), [step]);

  /** Expand the cap just far enough to include `index`; no-op when negative or already shown. */
  const revealIndex = React.useCallback((index: number) => {
    if (index >= 0) setVisible((v) => (index >= v ? index + 1 : v));
  }, []);

  return { visible, showMore, revealIndex };
}
