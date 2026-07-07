import * as React from "react";
import { HexColorPicker } from "react-colorful";
import { useTranslation } from "react-i18next";

interface ColorPickerProps {
  color: string; // current hex
  onSelect: (hex: string) => void;
}

/**
 * A beautiful custom color picker using react-colorful.
 * Ensures consistent UI across Windows/Mac instead of the native OS picker.
 */
export function ColorPicker({ color, onSelect }: ColorPickerProps) {
  const { t } = useTranslation();
  const ref = React.useRef<HTMLDivElement>(null);
  const [open, setOpen] = React.useState(false);

  // Close on click outside.
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="h-4 w-4 shrink-0 rounded-full transition-transform hover:scale-110 border border-black/10 shadow-sm"
        style={{ backgroundColor: color }}
        title={t("connections.accountColor")}
      />

      {open && (
        <div 
          className="surface-soft animate-in-up absolute left-1/2 top-full z-50 mt-2 -translate-x-1/2 p-3 flex flex-col gap-3 rounded-xl shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="react-colorful-custom">
            <HexColorPicker color={color} onChange={onSelect} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider pl-1">Hex</span>
            <input 
              type="text" 
              value={color} 
              onChange={(e) => onSelect(e.target.value)}
              className="w-full bg-surface-2 px-2 py-1 text-xs rounded border border-transparent hover:border-border focus:border-ring focus:outline-none font-mono uppercase"
              spellCheck={false}
            />
          </div>
        </div>
      )}
    </div>
  );
}
