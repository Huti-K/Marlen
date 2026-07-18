import type * as React from "react";
import { Label } from "@/components/ui/label";
import { ListRow } from "@/components/ui/list-row";
import { cn } from "@/lib/utils";

/**
 * The one shape for a settings row: label + description at left, the row's
 * control(s) at right. Renders as a raised `ListRow` on the canvas by
 * default; `bare` is the same row inside an already-raised card or dialog
 * (top-aligned so a wrapping description doesn't drag the control down).
 */
export function SettingRow({
  htmlFor,
  label,
  description,
  error,
  icon,
  bare,
  className,
  children,
}: {
  /** Links the label to the row's control. */
  htmlFor?: string;
  label: React.ReactNode;
  description?: React.ReactNode;
  error?: string | null;
  /** Leading mark ahead of the label block (app logo, glyph). */
  icon?: React.ReactNode;
  bare?: boolean;
  className?: string;
  /** The right-aligned control(s). */
  children: React.ReactNode;
}) {
  const body = (
    <>
      <div className="flex min-w-0 items-center gap-3">
        {icon}
        <div className="flex min-w-0 flex-col gap-0.5">
          <Label htmlFor={htmlFor} className="truncate text-sm font-medium">
            {label}
          </Label>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </>
  );

  return bare ? (
    <div className={cn("flex items-start justify-between gap-3", className)}>{body}</div>
  ) : (
    <ListRow className={className}>{body}</ListRow>
  );
}
