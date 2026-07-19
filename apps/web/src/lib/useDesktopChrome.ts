import * as React from "react";
import { desktopBridge, insetTitleBar } from "@/lib/desktop";

/**
 * Wires the desktop shell's title bar into the DOM. On macOS the shell hides the
 * bar and floats the traffic lights over the web chrome, so this marks the root
 * (`data-titlebar-inset` + `--titlebar-h`) to reserve their strip — the
 * `.titlebar-pad`/`.titlebar-drag` rules in index.css activate off it. It also
 * reports the resolved theme so the native window background tracks it.
 */
export function useDesktopChrome(resolvedTheme: "light" | "dark"): void {
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
}
