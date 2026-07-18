import * as DialogPrimitive from "@radix-ui/react-dialog";
import type * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

/** Modal replacement for window.confirm() — used before destructive actions. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  variant = "destructive",
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  variant?: "destructive" | "default";
  busy?: boolean;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="scrim fixed inset-0 z-[110]" />
        <DialogPrimitive.Content className="surface fixed left-1/2 top-1/2 z-[120] w-[calc(100%-2.5rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 p-5">
          <DialogPrimitive.Title className="text-sm font-semibold tracking-tight">
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="mt-1.5 text-sm text-muted-foreground">
            {description}
          </DialogPrimitive.Description>
          <div className="mt-5 flex justify-end gap-2">
            <DialogPrimitive.Close asChild>
              <Button variant="ghost">{t("common.cancel")}</Button>
            </DialogPrimitive.Close>
            <Button variant={variant} onClick={onConfirm} loading={busy}>
              {confirmLabel}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
