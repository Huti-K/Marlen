import { Loader2, X } from "lucide-react";
import type * as React from "react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";

/** Pale red banner for caught request errors. */
export function ErrorBanner({ children }: { children: React.ReactNode }) {
  return <p className="tint-danger rounded-lg px-3 py-2 text-xs">{children}</p>;
}

/** Inline row shown while a panel's first fetch is in flight. */
export function LoadingRow({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> {label ?? t("common.loading")}
    </div>
  );
}

const NOTICE_TONE_CLASSES = {
  danger: "tint-danger",
  success: "tint-success",
  warning: "tint-warning",
  accent: "tint-accent",
  neutral: "bg-surface-2",
} as const;

export type NoticeTone = keyof typeof NOTICE_TONE_CLASSES;

/**
 * Tonal notice box — the pale status fill used for banners, flow results, and
 * setup-step call-outs. `className` carries per-site layout (flex direction,
 * gap, padding); Notice only owns the shell (radius, base padding, tone fill)
 * and the optional dismiss affordance.
 */
export function Notice({
  tone,
  onDismiss,
  className,
  children,
}: {
  tone: NoticeTone;
  onDismiss?: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className={cn("rounded-lg p-3.5 text-sm", NOTICE_TONE_CLASSES[tone], className)}>
      {children}
      {onDismiss && (
        <IconButton onClick={onDismiss} aria-label={t("common.dismiss")}>
          <X className="h-4 w-4" />
        </IconButton>
      )}
    </div>
  );
}
