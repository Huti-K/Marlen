import { contextBridge, ipcRenderer } from "electron";
import { TITLEBAR_HEIGHT, titleBarMode } from "./titlebar";
import type { UpdateCheckStatus } from "./updater";

/**
 * window.trailinDesktop — the web app's only view of the shell: the update flow
 * plus the title-bar contract (how the bar was drawn, so the web reserves the
 * matching strip). Mirrored by the DesktopBridge type in apps/web/src/lib/desktop.ts.
 */
contextBridge.exposeInMainWorld("trailinDesktop", {
  titleBar: titleBarMode(),
  titleBarHeight: TITLEBAR_HEIGHT,
  setChromeTheme: (theme: "light" | "dark"): void => {
    ipcRenderer.send("trailin:set-chrome-theme", theme);
  },
  getAppInfo: (): Promise<{ version: string; platform: string; arch: string }> =>
    ipcRenderer.invoke("trailin:get-app-info") as Promise<{
      version: string;
      platform: string;
      arch: string;
    }>,
  getPendingUpdate: (): Promise<string | null> =>
    ipcRenderer.invoke("trailin:get-pending-update") as Promise<string | null>,
  checkForUpdates: (): Promise<UpdateCheckStatus> =>
    ipcRenderer.invoke("trailin:check-for-updates") as Promise<UpdateCheckStatus>,
  onUpdateReady: (callback: (version: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, version: string) => callback(version);
    ipcRenderer.on("trailin:update-ready", listener);
    return () => {
      ipcRenderer.removeListener("trailin:update-ready", listener);
    };
  },
  installUpdate: (): void => {
    ipcRenderer.send("trailin:install-update");
  },
});
