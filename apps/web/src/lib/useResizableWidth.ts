import * as React from "react";

interface UseResizableWidthOptions {
  /** localStorage key the width is persisted under, as a fraction of the window width. */
  storageKey: string;
  /** Width in px when nothing is stored, converted against the current window. */
  defaultWidth: number;
  min: number;
  max: number;
  /** Which screen edge the panel is docked to — sets which drag direction grows it. */
  edge: "left" | "right";
  /** Pulling more than OVERDRAG_PX past `min` reads as "put it away": the drag
   *  ends and this fires (e.g. collapse the panel). Width stays clamped at
   *  `min`, so reopening restores a usable size. */
  onOverdrag?: () => void;
}

/** How far past `min` a drag must pull before it counts as a close gesture
 *  rather than jitter against the stop. */
const OVERDRAG_PX = 64;

/** A docked panel never takes more than this share of the window, whatever
 *  `max` allows — it must always leave the majority of the screen to the
 *  content it sits beside. */
const MAX_VIEWPORT_FRACTION = 0.45;

/** Stored values are window-width fractions in (0, 1); anything else is ignored. */
function readStoredFraction(key: string): number | null {
  if (typeof window === "undefined") return null;
  const saved = Number(window.localStorage.getItem(key));
  return saved > 0 && saved < 1 ? saved : null;
}

/** Drag-to-resize width for a docked side panel, persisted across reloads as a
 *  fraction of the window width — so the panel scales with the screen it is on
 *  (laptop vs external monitor) instead of carrying one screen's pixel width to
 *  the other. `min`/`max` bound the resolved px width on every screen. */
export function useResizableWidth({
  storageKey,
  defaultWidth,
  min,
  max,
  edge,
  onOverdrag,
}: UseResizableWidthOptions) {
  const [viewportWidth, setViewportWidth] = React.useState(() =>
    typeof window === "undefined" ? 0 : window.innerWidth,
  );
  const [fraction, setFraction] = React.useState(() => {
    const stored = readStoredFraction(storageKey);
    if (stored !== null) return stored;
    const vw = typeof window === "undefined" ? 0 : window.innerWidth;
    return vw > 0 ? defaultWidth / vw : 0;
  });

  const maxPx = Math.max(min, Math.min(max, Math.round(viewportWidth * MAX_VIEWPORT_FRACTION)));
  const width = Math.min(maxPx, Math.max(min, Math.round(fraction * viewportWidth)));

  React.useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const stop = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    const onMove = (ev: PointerEvent) => {
      const delta = ev.clientX - startX;
      const next = edge === "right" ? startWidth - delta : startWidth + delta;
      if (onOverdrag && next < min - OVERDRAG_PX) {
        stop();
        onOverdrag();
        return;
      }
      const clamped = Math.min(maxPx, Math.max(min, next));
      setFraction(clamped / window.innerWidth);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
    // A drag can be interrupted (touch gesture takeover, pen leaving range, OS
    // pointer steal) without a pointerup — without this the listener and the
    // body cursor/user-select styles would leak past the drag.
    window.addEventListener("pointercancel", stop);
  };

  React.useEffect(() => {
    if (fraction > 0) window.localStorage.setItem(storageKey, String(fraction));
  }, [storageKey, fraction]);

  return { width, onPointerDown };
}
