import path from "node:path";
import { app, Menu, nativeImage, Tray } from "electron";

/**
 * The app's background presence on platforms where the last window closing
 * would otherwise quit it (Windows, Linux) and take every scheduled automation
 * with it. macOS keeps the app alive in the dock, which already serves that
 * purpose, so no tray is created there.
 *
 * Labels arrive from the renderer (marlen:set-tray-labels): the app language is
 * the web app's, not the shell's. The German defaults only cover the gap before
 * a window has reported it — the app's default language.
 */

export interface TrayLabels {
  open: string;
  quit: string;
  /** Shown once, the first time closing a window leaves the app in the tray. */
  background: string;
}

let tray: Tray | null = null;
let labels: TrayLabels = {
  open: "Marlen öffnen",
  quit: "Marlen beenden",
  background: "Marlen läuft weiter und führt Ihre Automatisierungen aus.",
};
let waiting = "";
let openWindow: () => void = () => {};

/** Whether this platform relies on a tray to stay reachable without a window. */
export function trayPlatform(): boolean {
  return process.platform !== "darwin";
}

/** Whether a tray icon actually exists — a Linux desktop without a system tray
 *  leaves the app with no way back, so callers keep quitting on last close. */
export function trayActive(): boolean {
  return tray !== null;
}

function render(): void {
  if (!tray) return;
  // The tooltip is where the pending count lives on Windows, whose taskbar has
  // no badge to set (app.setBadgeCount is macOS and Linux).
  tray.setToolTip(waiting ? `Marlen — ${waiting}` : "Marlen");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: labels.open, click: () => openWindow() },
      { type: "separator" },
      { label: labels.quit, click: () => app.quit() },
    ]),
  );
}

export function startTray(opts: { onOpen: () => void }): void {
  if (!trayPlatform() || tray) return;
  openWindow = opts.onOpen;
  try {
    const icon = nativeImage
      .createFromPath(path.join(__dirname, "resources", "icon.png"))
      .resize({ width: 16, height: 16 });
    tray = new Tray(icon);
  } catch {
    // No system tray (some Linux desktops). Without one the app must keep
    // quitting with its last window, which trayActive() reports.
    return;
  }
  tray.on("click", () => openWindow());
  render();
}

export function setTrayLabels(next: TrayLabels): void {
  labels = next;
  render();
}

/** The already-translated "N waiting" line for the tooltip; empty when nothing is. */
export function setTrayWaiting(summary: string): void {
  if (summary === waiting) return;
  waiting = summary;
  render();
}

/** The hint text for the one-time "still running" notification. */
export function backgroundHint(): string {
  return labels.background;
}

export function stopTray(): void {
  tray?.destroy();
  tray = null;
}
