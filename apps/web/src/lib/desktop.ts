/**
 * The bridge the desktop shell's preload script exposes as
 * window.trailinDesktop (apps/desktop/src/preload.ts). Absent in a plain
 * browser tab — callers feature-detect via desktopBridge().
 */

/**
 * Outcome of a user-initiated update check (mirrors UpdateCheckStatus in
 * apps/desktop/src/updater.ts). "downloading" means a newer release is being
 * fetched in the background — completion arrives via onUpdateReady.
 * "unsupported" is an unpackaged dev run with no update feed.
 */
export type UpdateCheckStatus =
  | { status: "downloaded"; version: string }
  | { status: "downloading"; version: string }
  | { status: "current" }
  | { status: "unsupported" }
  | { status: "error"; message: string };

/** Identity of the installed shell build: app version plus the host platform/arch. */
export type DesktopAppInfo = {
  version: string;
  /** Node's process.platform in the shell — "darwin", "win32", "linux". */
  platform: string;
  /** Node's process.arch in the shell — "arm64", "x64", …. */
  arch: string;
};

type DesktopBridge = {
  /** How the shell drew its title bar: "inset" = macOS floats the traffic
   *  lights over the web chrome (the web reserves their strip); "native" = a
   *  normal OS title bar the web ignores. */
  titleBar: "inset" | "native";
  /** Height in px the web reserves at the top for the "inset" title bar. */
  titleBarHeight: number;
  /** Report the resolved theme so the native window background tracks it. */
  setChromeTheme: (theme: "light" | "dark") => void;
  getAppInfo: () => Promise<DesktopAppInfo>;
  /** Version of an update already downloaded and waiting for a restart, if any. */
  getPendingUpdate: () => Promise<string | null>;
  /** Check the release feed now; a found update starts downloading in the background. */
  checkForUpdates: () => Promise<UpdateCheckStatus>;
  /** Fires when an update finishes downloading in the background; returns unsubscribe. */
  onUpdateReady: (callback: (version: string) => void) => () => void;
  /** Quit and relaunch into the downloaded update. */
  installUpdate: () => void;
};

export function desktopBridge(): DesktopBridge | undefined {
  return (window as Window & { trailinDesktop?: DesktopBridge }).trailinDesktop;
}

/** The inset (macOS) title-bar reservation, or null in a browser tab / on a
 *  platform with a native bar — the only case the web reserves top space for. */
export function insetTitleBar(): { height: number } | null {
  const bridge = desktopBridge();
  return bridge?.titleBar === "inset" ? { height: bridge.titleBarHeight } : null;
}
