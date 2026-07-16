import { contextBridge, ipcRenderer } from "electron";

/**
 * window.trailinDesktop — the web app's only view of the shell, deliberately
 * kept to the update flow (everything else the app needs comes over its own
 * HTTP API). Mirrored by the DesktopBridge type in apps/web/src/lib/desktop.ts.
 */
contextBridge.exposeInMainWorld("trailinDesktop", {
  getPendingUpdate: (): Promise<string | null> =>
    ipcRenderer.invoke("trailin:get-pending-update") as Promise<string | null>,
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
