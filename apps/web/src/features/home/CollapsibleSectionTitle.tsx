import { ChevronDown, ChevronUp, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";

/** The collapsible section `<h2>` shared by Home's list sections (Review,
 *  Waiting) — icon chip, title, optional count badge, trailing chevron. */
export function CollapsibleSectionTitle({
  icon: Icon,
  title,
  count,
  expanded,
  onToggle,
}: {
  icon: LucideIcon;
  title: string;
  count?: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <h2 className="text-base font-semibold tracking-tight">
      <button
        type="button"
        onClick={onToggle}
        title={t(expanded ? "common.collapse" : "common.expand")}
        aria-expanded={expanded}
        className="flex items-center gap-2.5 hover:text-muted-foreground transition-colors select-none"
      >
        <div className="tint-accent flex h-7 w-7 items-center justify-center rounded-md">
          <Icon className="h-4 w-4" />
        </div>
        {title}
        {typeof count === "number" && count > 0 && <Badge variant="muted">{count}</Badge>}
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground ml-1" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground ml-1" />
        )}
      </button>
    </h2>
  );
}
