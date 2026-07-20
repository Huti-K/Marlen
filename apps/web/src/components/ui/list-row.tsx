import type * as React from "react";
import { Badge } from "@/components/ui/badge";
import { cn, rowTransition } from "@/lib/utils";

/**
 * A single settings/account row — icon or label at left, status/actions at
 * right. A standalone item on the canvas, so it rises as a white `surface`;
 * grouped rows inside a card stay bare and don't use this.
 */
export function ListRow({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "surface flex items-center justify-between gap-3 rounded-lg px-3.5 py-3",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The quiet terminal line a row becomes once it has been sent. It carries the
 * live row's transition name, so sending morphs the row in place rather than
 * reading as a leave plus an arrival — the one outward, irreversible action
 * must not look like a discard.
 */
export function SentRow({
  id,
  title,
  subtitle,
  label,
}: {
  id: string;
  title: string;
  subtitle?: string;
  label: string;
}) {
  return (
    <ListRow style={rowTransition(id)}>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{title}</p>
        {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      <Badge variant="success">{label}</Badge>
    </ListRow>
  );
}
