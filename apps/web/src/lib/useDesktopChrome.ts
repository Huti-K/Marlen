import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { desktopBridge, insetTitleBar } from "@/lib/desktop";

/**
 * Wires the desktop shell's title bar into the DOM. On macOS the shell hides the
 * bar and floats the traffic lights over the web chrome, so this marks the root
 * (`data-titlebar-inset` + `--titlebar-h`) to reserve their strip — the
 * `.titlebar-pad`/`.titlebar-drag` rules in index.css activate off it. It also
 * reports the resolved theme so the native window background tracks it, and the
 * tray menu's strings, which the shell has no other way to translate.
 */
export function useDesktopChrome(resolvedTheme: "light" | "dark"): void {
  // `t` changes identity when the language does, which is what re-sends the labels.
  const { t } = useTranslation();
  React.useEffect(() => {
    const bar = insetTitleBar();
    if (!bar) return;
    const root = document.documentElement;
    root.dataset.titlebarInset = "true";
    root.style.setProperty("--titlebar-h", `${bar.height}px`);
    return () => {
      delete root.dataset.titlebarInset;
      root.style.removeProperty("--titlebar-h");
    };
  }, []);

  React.useEffect(() => {
    desktopBridge()?.setChromeTheme(resolvedTheme);
  }, [resolvedTheme]);

  React.useEffect(() => {
    desktopBridge()?.setTrayLabels({
      open: t("desktop.tray.open"),
      quit: t("desktop.tray.quit"),
      background: t("desktop.tray.background"),
    });
  }, [t]);
}

/**
 * Badges the app icon (and the tray tooltip) with the drafts waiting for
 * approval, across mailboxes and the other outbound channels. Mounted app-wide
 * rather than on Home so the count is right whatever page is open; the two
 * queries reuse Home's own cache entries, so being on Home costs no extra fetch.
 */
export function useWaitingBadge(): void {
  const { t } = useTranslation();
  const bridge = desktopBridge();
  const draftsQuery = useQuery({
    queryKey: ["drafts", "review"],
    queryFn: () => api.drafts(),
    enabled: !!bridge,
  });
  const outboundQuery = useQuery({
    queryKey: ["outbound", "open"],
    queryFn: () => api.outbound("open"),
    enabled: !!bridge,
  });

  const waiting =
    (outboundQuery.data?.length ?? 0) +
    (draftsQuery.data ?? []).reduce((total, account) => total + account.drafts.length, 0);

  React.useEffect(() => {
    bridge?.setWaiting(waiting, waiting > 0 ? t("desktop.tray.waiting", { count: waiting }) : "");
  }, [bridge, waiting, t]);
}
