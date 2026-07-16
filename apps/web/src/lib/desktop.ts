/**
 * The bridge the desktop shell's preload script exposes as
 * window.trailinDesktop (apps/desktop/src/preload.ts). Absent in a plain
 * browser tab — callers feature-detect via desktopBridge().
 */
export type DesktopBridge = {
  /** Version of an update already downloaded and waiting for a restart, if any. */
  getPendingUpdate: () => Promise<string | null>;
  /** Fires when an update finishes downloading in the background; returns unsubscribe. */
  onUpdateReady: (callback: (version: string) => void) => () => void;
  /** Quit and relaunch into the downloaded update. */
  installUpdate: () => void;
};

export function desktopBridge(): DesktopBridge | undefined {
  return (window as Window & { trailinDesktop?: DesktopBridge }).trailinDesktop;
}
