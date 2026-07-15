import * as React from "react";

/** Minimum gap kept between a floating popover and the viewport edge. */
const VIEWPORT_MARGIN = 8;
/** Space between the trigger and the popover along the anchored edge. */
const TRIGGER_GAP = 8;

interface UseAnchoredPopoverOptions {
  /** Horizontal alignment against the trigger: "start" hugs its left edge
   *  (for a list wider than the trigger), "center" centers under it. */
  align?: "start" | "center";
}

/**
 * Open state plus a viewport-clamped position for a trigger-anchored popover
 * portaled to <body>: below the trigger, flipped above when it doesn't fit,
 * clamped horizontally so it never overhangs the viewport. Also wires the
 * dismiss behavior every such popover needs — outside mousedown, Escape, and
 * re-anchoring on scroll (capture phase, so any ancestor scroller counts)
 * and resize.
 */
export function useAnchoredPopover<
  TriggerEl extends HTMLElement = HTMLElement,
  PopoverEl extends HTMLElement = HTMLDivElement,
>({ align = "start" }: UseAnchoredPopoverOptions = {}) {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState<{ left: number; top: number } | null>(null);
  const triggerRef = React.useRef<TriggerEl>(null);
  const popoverRef = React.useRef<PopoverEl>(null);

  const updatePosition = React.useCallback(() => {
    const trigger = triggerRef.current;
    const popover = popoverRef.current;
    if (!trigger || !popover) return;
    const rect = trigger.getBoundingClientRect();
    const { width, height } = popover.getBoundingClientRect();
    const rawLeft = align === "center" ? rect.left + rect.width / 2 - width / 2 : rect.left;
    const left = Math.min(
      Math.max(rawLeft, VIEWPORT_MARGIN),
      window.innerWidth - width - VIEWPORT_MARGIN,
    );
    let top = rect.bottom + TRIGGER_GAP;
    if (top + height > window.innerHeight - VIEWPORT_MARGIN) {
      const above = rect.top - TRIGGER_GAP - height;
      if (above >= VIEWPORT_MARGIN) top = above;
    }
    setPos({ left, top });
  }, [align]);

  React.useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    updatePosition();
  }, [open, updatePosition]);

  React.useEffect(() => {
    if (!open) return;
    const handlePointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    // Capture phase so scrolling any ancestor container re-anchors the popover.
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open, updatePosition]);

  return { open, setOpen, pos, triggerRef, popoverRef };
}
