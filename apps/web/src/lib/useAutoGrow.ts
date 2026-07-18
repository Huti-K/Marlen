import * as React from "react";

/**
 * Grows a textarea with its content, up to the element's CSS max-height cap
 * (then it scrolls internally). Empty is left to the CSS min-height/rows
 * instead of measured via scrollHeight — Chrome/Firefox size that against the
 * wrapped placeholder text, not the (empty) value, which puffs the box up at
 * rest.
 */
export function useAutoGrow(ref: React.RefObject<HTMLTextAreaElement | null>, value: string) {
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!value) {
      el.style.height = "";
      return;
    }
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [ref, value]);
}
