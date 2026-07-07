import * as React from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

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
