import * as React from "react";
import { createPortal } from "react-dom";

export function CursorTooltip() {
  const [tooltip, setTooltip] = React.useState<{ text: string; x: number; y: number } | null>(null);

  React.useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Find elements explicitly requesting a tooltip OR clickable elements with an accessible name
      const tooltipElement = target.closest(
        "[data-tooltip], button[aria-label], a[aria-label], [role='button'][aria-label], button[title], a[title], [role='button'][title], [data-restored-title]",
      ) as HTMLElement;

      if (tooltipElement) {
        const text =
          tooltipElement.getAttribute("data-tooltip") ||
          tooltipElement.getAttribute("aria-label") ||
          tooltipElement.getAttribute("title") ||
          tooltipElement.getAttribute("data-restored-title");

        if (text && text.trim() !== "") {
          setTooltip({ text: text.trim(), x: e.clientX, y: e.clientY });

          // Suppress the slow, native browser tooltip
          if (tooltipElement.hasAttribute("title")) {
            tooltipElement.setAttribute(
              "data-restored-title",
              tooltipElement.getAttribute("title") || "",
            );
            tooltipElement.removeAttribute("title");
          }
          return;
        }
      }
      setTooltip(null);
    };

    const handleMouseLeave = () => setTooltip(null);
    const handleMouseDown = () => setTooltip(null); // Hide on click

    window.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseleave", handleMouseLeave);
    document.addEventListener("mousedown", handleMouseDown);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseleave", handleMouseLeave);
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, []);

  if (!tooltip) return null;

  return createPortal(<TooltipContent tooltip={tooltip} />, document.body);
}

function TooltipContent({ tooltip }: { tooltip: { text: string; x: number; y: number } }) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    if (ref.current) {
      const el = ref.current;
      const rect = el.getBoundingClientRect();
      let left = tooltip.x + 16;
      let top = tooltip.y + 16;

      // Flip to the left if it overflows the right edge
      if (left + rect.width > window.innerWidth - 8) {
        left = tooltip.x - rect.width - 8;
      }

      // Flip above if it overflows the bottom edge
      if (top + rect.height > window.innerHeight - 8) {
        top = tooltip.y - rect.height - 8;
      }

      el.style.transform = `translate(${left}px, ${top}px)`;
    }
  }, [tooltip]);

  return (
    <div
      ref={ref}
      className="pointer-events-none fixed left-0 top-0 z-[100] max-w-xs rounded-md bg-foreground px-2 py-1.5 text-xs font-medium text-background whitespace-pre-line"
    >
      {tooltip.text}
    </div>
  );
}
