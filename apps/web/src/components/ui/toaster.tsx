import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { Toaster as Sonner } from "sonner";

export function Toaster() {
  return (
    <Sonner
      position="top-right"
      className="md:!right-[calc(var(--chat-width)+1.5rem)] !top-4"
      toastOptions={{
        classNames: {
          toast:
            "group pointer-events-auto flex items-start gap-2.5 rounded-lg p-3.5 text-sm shadow-lg border font-sans w-[340px]",
          title: "min-w-0 flex-1 text-pretty",
          error: "bg-destructive text-destructive-foreground border-destructive/20 tint-danger",
          success: "bg-surface text-foreground border-border tint-success",
          info: "bg-surface text-foreground border-border tint-accent",
        },
      }}
      icons={{
        success: <CheckCircle2 className="h-4 w-4 shrink-0 translate-y-0.5 text-success" />,
        error: <AlertCircle className="h-4 w-4 shrink-0 translate-y-0.5" />,
        info: <Info className="h-4 w-4 shrink-0 translate-y-0.5 text-accent" />,
      }}
    />
  );
}
