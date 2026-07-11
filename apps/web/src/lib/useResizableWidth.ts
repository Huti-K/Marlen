import * as React from "react";

interface UseResizableWidthOptions {
  /** localStorage key the width is persisted under. */
  storageKey: string;
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

function readStored(key: string, min: number, max: number, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const saved = Number(window.localStorage.getItem(key));
  return saved >= min && saved <= max ? saved : fallback;
}

/** Drag-to-resize width for a docked side panel, persisted across reloads. */
export function useResizableWidth({
  storageKey,
  defaultWidth,
  min,
  max,
  edge,
  onOverdrag,
}: UseResizableWidthOptions) {
  const [width, setWidth] = React.useState(() => readStored(storageKey, min, max, defaultWidth));

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
      setWidth(Math.min(max, Math.max(min, next)));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
    // A drag can be interrupted (touch gesture takeover, pen leaving range, OS
    // pointer steal) without a pointerup — without this the listener and the
    // body cursor/user-select styles would leak past the drag.
    window.addEventListener("pointercancel", stop);
  };

  React.useEffect(() => {
    window.localStorage.setItem(storageKey, String(width));
  }, [storageKey, width]);

  return { width, onPointerDown };
}
