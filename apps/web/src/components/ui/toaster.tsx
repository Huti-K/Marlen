import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import type * as React from "react";
import { Toaster as Sonner } from "sonner";

/*
 * Sonner injects its default skin as an unlayered stylesheet that out-guns
 * layered utility classes, so toasts run `unstyled` and these classNames own
 * the whole look. `--width` drives sonner's stacking math and must match the
 * toast width.
 */
export function Toaster() {
  return (
    <Sonner
      position="top-right"
      className="md:!right-[calc(var(--chat-width)+1.5rem)] !top-4 !z-[140]"
      style={{ "--width": "300px" } as React.CSSProperties}
      closeButton
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "group pointer-events-auto flex w-full items-start gap-2 rounded-lg px-3 py-2.5 font-sans text-xs",
          content: "min-w-0 flex-1",
          title: "text-pretty",
          actionButton:
            "shrink-0 self-center whitespace-nowrap text-xs font-medium underline underline-offset-2 opacity-80 transition-opacity hover:opacity-100",
          closeButton:
            "order-last flex h-4 w-4 shrink-0 items-center justify-center opacity-50 transition-opacity hover:opacity-100",
          error: "tint-pop-danger",
          success: "tint-pop-success",
          info: "tint-pop-accent",
        },
      }}
      icons={{
        success: <CheckCircle2 className="h-3.5 w-3.5 shrink-0 translate-y-px" />,
        error: <AlertCircle className="h-3.5 w-3.5 shrink-0 translate-y-px" />,
        info: <Info className="h-3.5 w-3.5 shrink-0 translate-y-px" />,
      }}
    />
  );
}
