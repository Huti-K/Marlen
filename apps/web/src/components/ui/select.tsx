import * as React from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, Check } from "lucide-react";

/** Searchable combobox dropdown. */
export function Select({
  id,
  value,
  onChange,
  options,
  className,
  "aria-label": ariaLabel,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  className?: string;
  "aria-label"?: string;
}) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedOption = options.find((o) => o.value === value);
  const displayValue = isOpen ? search : (selectedOption?.label || "");

  const filteredOptions = options.filter(o => 
    o.label.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className={cn("relative w-full", className)} ref={containerRef}>
      <div className="relative flex items-center w-full">
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={displayValue}
          aria-label={ariaLabel}
          onChange={(e) => {
            setSearch(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          onClick={() => {
            setIsOpen(true);
            setSearch("");
          }}
          className="field h-9 w-full px-3 text-sm pr-8"
          placeholder={selectedOption?.label || "Select..."}
          autoComplete="off"
        />
        <ChevronDown 
          className="absolute right-2.5 h-4 w-4 text-muted-foreground pointer-events-none" 
        />
      </div>
      
      {isOpen && (
        <div className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto rounded-md border border-surface bg-surface-2 p-1 shadow-md">
          {filteredOptions.length === 0 ? (
            <div className="p-2 text-center text-sm text-muted-foreground">
              No results found.
            </div>
          ) : (
            filteredOptions.map((option) => (
              <div
                key={option.value}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                  setSearch("");
                }}
                className={cn(
                  "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-surface hover:text-foreground",
                  value === option.value ? "bg-surface font-medium text-foreground" : "text-muted-foreground"
                )}
              >
                <span className="flex-1 truncate">{option.label}</span>
                {value === option.value && (
                  <Check className="ml-2 h-4 w-4 shrink-0" />
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
