import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type * as React from "react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";

/**
 * General-purpose modal — forms, pickers, anything bigger than a yes/no
 * prompt (use ConfirmDialog for that). One shape so features stop rolling
 * their own overlay/portal/close-button plumbing.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  actions,
  footer,
  className,
  bodyClassName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  /** Header controls rendered between the title and the close button. */
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  /** Overrides for the scrolling body wrapper (e.g. a fixed-height fill). */
  bodyClassName?: string;
}) {
  const { t } = useTranslation();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="scrim fixed inset-0 z-[110]" />
        <DialogPrimitive.Content
          // Radix warns about a missing description unless the prop is passed explicitly.
          {...(description ? {} : { "aria-describedby": undefined })}
          className={cn(
            "surface fixed left-1/2 top-1/2 z-[120] flex max-h-[85vh] w-[calc(100%-2.5rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col gap-4 p-5",
            className,
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <DialogPrimitive.Title className="text-sm font-semibold tracking-tight">
                {title}
              </DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description className="text-xs text-muted-foreground">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {actions}
              <DialogPrimitive.Close asChild>
                <IconButton aria-label={t("common.close")}>
                  <X className="h-4 w-4" />
                </IconButton>
              </DialogPrimitive.Close>
            </div>
          </div>
          <div className={cn("flex flex-col gap-4 overflow-y-auto", bodyClassName)}>{children}</div>
          {footer && <div className="flex shrink-0 justify-end gap-2">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
