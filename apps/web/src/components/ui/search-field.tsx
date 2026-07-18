import { Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Leading magnifier, trailing clear — the same shape used across the app's list filters. */
export function SearchField({
  value,
  onChange,
  placeholder,
  className,
  size = "default",
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  className?: string;
  /** `sm` is the compact in-card variant (e.g. the system-prompt inspector). */
  size?: "default" | "sm";
}) {
  const { t } = useTranslation();
  const sm = size === "sm";
  return (
    <div className={cn("relative", className)}>
      <Search
        className={cn(
          "pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground",
          sm ? "left-2.5 h-3.5 w-3.5" : "left-3 h-4 w-4",
        )}
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={sm ? "h-8 pl-8 pr-8 text-xs" : "pl-9 pr-8"}
      />
      {value && (
        <IconButton
          onClick={() => onChange("")}
          aria-label={t("common.clearSearch")}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </IconButton>
      )}
    </div>
  );
}
