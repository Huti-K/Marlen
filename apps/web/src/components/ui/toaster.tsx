import * as React from "react";
import { AlertCircle, CheckCircle2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { dismissToast, subscribeToasts, type ToastItem } from "@/lib/toast";
import { cn } from "@/lib/utils";

/** Fixed bottom-right stack for transient action errors/confirmations. */
export function Toaster() {
  const { t } = useTranslation();
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);

  React.useEffect(() => subscribeToasts(setToasts), []);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed top-24 right-4 md:right-[calc(var(--chat-width)+2rem)] z-[100] flex w-full max-w-sm flex-col gap-2">
      {toasts.map((item) => (
        <div
          key={item.id}
          className={cn(
            "animate-in-up pointer-events-auto flex items-start gap-2.5 rounded-lg p-3.5 text-sm shadow-md",
            item.variant === "error" ? "tint-danger" : "tint-success",
          )}
        >
          {item.variant === "error" ? (
            <AlertCircle className="h-4 w-4 shrink-0 translate-y-0.5" />
          ) : (
            <CheckCircle2 className="h-4 w-4 shrink-0 translate-y-0.5" />
          )}
          <p className="min-w-0 flex-1 text-pretty">{item.message}</p>
          <button
            onClick={() => dismissToast(item.id)}
            className="shrink-0 opacity-70 transition-opacity hover:opacity-100"
            aria-label={t("common.dismiss")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
