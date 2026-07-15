import { HexColorPicker } from "react-colorful";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useAnchoredPopover } from "@/lib/useAnchoredPopover";

interface ColorPickerProps {
  color: string; // current hex
  onSelect: (hex: string) => void;
}

/**
 * A beautiful custom color picker using react-colorful.
 * Ensures consistent UI across Windows/Mac instead of the native OS picker.
 *
 * The popover is portaled to <body> and positioned off the trigger's viewport
 * rect — rendering it in place traps it in whatever stacking context the row
 * happens to create (account rows set zIndex, cards animate transforms) and
 * lets scroll containers clip it.
 */
export function ColorPicker({ color, onSelect }: ColorPickerProps) {
  const { t } = useTranslation();
  const { open, setOpen, pos, triggerRef, popoverRef } = useAnchoredPopover<HTMLButtonElement>({
    align: "center",
  });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="h-4 w-4 shrink-0 rounded-full transition-transform hover:scale-110"
        style={{ backgroundColor: color }}
        title={t("connections.accountColor")}
      />

      {open &&
        createPortal(
          // Portaled content still bubbles React synthetic events up the component
          // tree (not the DOM tree), so a click here would otherwise reach whatever
          // row/card renders the trigger. This wrapper only guards that propagation —
          // the real interactive controls below (canvas, input) carry their own roles.
          // biome-ignore lint/a11y/noStaticElementInteractions: propagation guard only, not a control itself
          <div
            ref={popoverRef}
            role="presentation"
            className="surface-pop animate-in-up fixed z-[130] p-3 flex flex-col gap-3 rounded-xl"
            style={pos ?? { left: 0, top: 0, visibility: "hidden" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="react-colorful-custom">
              <HexColorPicker color={color} onChange={onSelect} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider pl-1">
                Hex
              </span>
              <input
                type="text"
                value={color}
                onChange={(e) => onSelect(e.target.value)}
                className="field w-full px-2 py-1 text-xs font-mono uppercase"
                spellCheck={false}
              />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
