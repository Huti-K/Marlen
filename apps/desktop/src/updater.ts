import log from "electron-log/main";

/**
 * Auto-update against GitHub releases. electron-builder bakes the feed
 * (owner/repo from electron-builder.yml's `publish` block) into the packaged
 * app as app-update.yml; electron-updater polls it anonymously (the repo is
 * public), downloads a newer release in the background, and the renderer
 * offers a restart (via main.ts IPC and the web app's update toast).
 */

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1_000;

/**
 * Outcome of a user-initiated check (Settings → About). "downloading" means a
 * newer release exists and autoDownload is fetching it; the renderer hears
 * about completion through the regular update-ready event. "unsupported" is
 * a dev run — no update feed is baked into an unpackaged app.
 */
export type UpdateCheckStatus =
  | { status: "downloaded"; version: string }
  | { status: "downloading"; version: string }
  | { status: "current" }
  | { status: "unsupported" }
  | { status: "error"; message: string };

let pending: string | null = null;

/**
 * electron-updater loads lazily: it only exists in a packaged app's
 * node_modules, and only packaged runs get here (main.ts gates on
 * app.isPackaged), so dev runs never need it installed. It must load via
 * CJS require (the shell bundle's format — see scripts/build.mjs): its
 * `autoUpdater` is a getter on module.exports, which `import()`'s named-export
 * detection can't see.
 */
function loadUpdater(): typeof import("electron-updater") {
  return require("electron-updater") as typeof import("electron-updater");
}

/** Version of an already-downloaded update waiting for a restart, if any. */
export function pendingUpdateVersion(): string | null {
  return pending;
}

export function startUpdater(onDownloaded: (version: string) => void): void {
  const { autoUpdater } = loadUpdater();
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.on("update-downloaded", (info) => {
    pending = info.version;
    onDownloaded(info.version);
  });
  // Updating is best-effort: an unreachable feed or an unsigned build (macOS
  // refuses to apply unsigned updates) must never take the app down.
  autoUpdater.on("error", (error) => log.warn(`updater: ${error.message}`));

  const check = () =>
    autoUpdater.checkForUpdates().catch((error: unknown) => {
      log.warn(`updater check failed: ${String(error)}`);
    });
  void check();
  setInterval(check, CHECK_INTERVAL_MS);
}

/** User-initiated check, on the same auto-download pipeline as the periodic one. */
export async function checkForUpdatesNow(): Promise<UpdateCheckStatus> {
  if (pending) return { status: "downloaded", version: pending };
  const { autoUpdater } = loadUpdater();
  try {
    const result = await autoUpdater.checkForUpdates();
    if (result?.isUpdateAvailable) {
      return { status: "downloading", version: result.updateInfo.version };
    }
    return { status: "current" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`updater manual check failed: ${message}`);
    return { status: "error", message };
  }
}

/** Quit, install the downloaded update, and relaunch into the new version. */
export function installUpdate(): void {
  loadUpdater().autoUpdater.quitAndInstall();
}
