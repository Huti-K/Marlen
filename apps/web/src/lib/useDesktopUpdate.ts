import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast as sonnerToast } from "sonner";
import { desktopBridge } from "@/lib/desktop";

/**
 * Desktop shell only (no-op in the browser): when the shell reports a
 * downloaded update, raise one persistent toast whose action restarts the
 * app into the new version. The fixed toast id dedupes the two signals
 * (already-pending on mount, and the live update-ready event).
 */
export function useDesktopUpdate(): void {
  const { t } = useTranslation();
  React.useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge) return;
    const announce = (version: string) => {
      sonnerToast.info(t("app.updateReady", { version }), {
        id: "desktop-update",
        duration: Number.POSITIVE_INFINITY,
        action: { label: t("app.updateRestart"), onClick: () => bridge.installUpdate() },
      });
    };
    const unsubscribe = bridge.onUpdateReady(announce);
    void bridge.getPendingUpdate().then((version) => {
      if (version) announce(version);
    });
    return unsubscribe;
  }, [t]);
}
