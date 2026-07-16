import { mkdirSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, type UtilityProcess, utilityProcess } from "electron";
import log from "electron-log/main";
import { startNotifications, stopNotifications } from "./notifications";
import { installUpdate, pendingUpdateVersion, startUpdater } from "./updater";

/**
 * The desktop shell: boots the bundled @trailin/server as a utility child
 * process on a loopback port, opens a window on it, and installs updates
 * published as GitHub releases (updater.ts). All app state lives with the
 * server under Electron's per-user data directory.
 */

/**
 * First port tried for the local server, scanning upward when taken. Kept
 * stable across launches so the renderer origin — and with it localStorage
 * (theme, collapsed panels, the setup-dismissed flag) — survives restarts.
 */
const BASE_PORT = 43117;
const PORT_SCAN_RANGE = 20;
const SERVER_READY_TIMEOUT_MS = 30_000;

let serverProcess: UtilityProcess | null = null;
let serverPort: number | null = null;
let quitting = false;

const smokeMode = Boolean(process.env.TRAILIN_DESKTOP_SMOKE);

/** Report a startup/runtime failure and leave — non-zero in smoke mode so a
 * scripted run (CI, the verify loop) fails instead of hanging on a dialog. */
function fatal(message: string): void {
  log.error(message);
  if (smokeMode) {
    app.exit(1);
    return;
  }
  dialog.showErrorBox("Trailin", message);
  app.quit();
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolveProbe) => {
    const probe = net.createServer();
    probe.once("error", () => resolveProbe(false));
    probe.once("listening", () => probe.close(() => resolveProbe(true)));
    probe.listen(port, "127.0.0.1");
  });
}

async function findFreePort(): Promise<number> {
  for (let port = BASE_PORT; port < BASE_PORT + PORT_SCAN_RANGE; port++) {
    if (await portFree(port)) return port;
  }
  throw new Error(`no free port in ${BASE_PORT}-${BASE_PORT + PORT_SCAN_RANGE - 1}`);
}

/**
 * The child's environment: the parent's (minus undefined values, which the
 * utilityProcess API rejects) plus the desktop wiring — loopback binding and
 * every data path pointed into Electron's userData directory.
 */
function serverEnv(port: number): Record<string, string> {
  const dataRoot = app.getPath("userData");
  mkdirSync(dataRoot, { recursive: true });
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) merged[key] = value;
  }
  return {
    ...merged,
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: String(port),
    DATABASE_PATH: path.join(dataRoot, "data", "trailin.db"),
    LIBRARY_PATH: path.join(dataRoot, "library"),
    LOG_FILE: path.join(dataRoot, "logs", "trailin.log"),
    WEB_DIST_PATH: path.join(__dirname, "web"),
  };
}

function startServer(port: number): void {
  const entry = path.join(__dirname, "server", "index.mjs");
  const child = utilityProcess.fork(entry, [], {
    env: serverEnv(port),
    stdio: "inherit",
    serviceName: "trailin-server",
  });
  child.once("exit", (code) => {
    serverProcess = null;
    if (quitting) return;
    fatal(
      `The local Trailin server stopped unexpectedly (code ${code}). Check the logs and reopen the app.`,
    );
  });
  serverProcess = child;
}

function serverResponding(port: number): Promise<boolean> {
  return new Promise((resolvePoll) => {
    const request = http.get({ host: "127.0.0.1", port, path: "/", timeout: 1_000 }, (response) => {
      response.resume();
      resolvePoll(true);
    });
    request.on("error", () => resolvePoll(false));
    request.on("timeout", () => {
      request.destroy();
      resolvePoll(false);
    });
  });
}

async function waitForServer(port: number): Promise<void> {
  const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (serverProcess === null) throw new Error("server exited during startup");
    if (await serverResponding(port)) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`server not reachable on port ${port} within ${SERVER_READY_TIMEOUT_MS}ms`);
}

function createWindow(port: number): void {
  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    // Neutral pre-paint fill so the first frame isn't a white flash.
    backgroundColor: "#f4f4f5",
    webPreferences: { preload: path.join(__dirname, "preload.cjs") },
  });
  void window.loadURL(`http://127.0.0.1:${port}/`);
  // CI/dev smoke mode: prove the packaged shell boots end-to-end, then leave.
  if (smokeMode) {
    window.webContents.once("did-finish-load", () => {
      log.info("desktop smoke: window loaded");
      app.quit();
    });
  }
}

/** Bring the existing window to front, or reopen one on the running server. */
function focusOrCreateWindow(): void {
  const [window] = BrowserWindow.getAllWindows();
  if (window) {
    if (window.isMinimized()) window.restore();
    window.focus();
  } else if (serverPort !== null) {
    createWindow(serverPort);
  }
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  // A second launch would race the first for the port and the SQLite file —
  // hand over to the running instance instead (it gets `second-instance`).
  app.quit();
} else {
  app.on("second-instance", () => {
    focusOrCreateWindow();
  });

  app.on("window-all-closed", () => {
    // On macOS the server (and its scheduled automations) keeps running with
    // the window closed, per platform convention; elsewhere closing quits.
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverPort !== null) {
      createWindow(serverPort);
    }
  });

  app.on("before-quit", () => {
    quitting = true;
    stopNotifications();
    serverProcess?.kill();
  });

  ipcMain.handle("trailin:get-pending-update", () => pendingUpdateVersion());
  ipcMain.on("trailin:install-update", () => installUpdate());

  void app.whenReady().then(async () => {
    try {
      const port = await findFreePort();
      serverPort = port;
      startServer(port);
      await waitForServer(port);
      createWindow(port);
      // Run-completion notifications come off the server's own event stream,
      // so they keep working when every window is closed (macOS).
      startNotifications(port, { onOpenRequest: focusOrCreateWindow });
      // Dev runs (`electron build/app`) have no update feed baked in —
      // app-update.yml only exists in a packaged build.
      if (app.isPackaged) {
        startUpdater((version) => {
          for (const window of BrowserWindow.getAllWindows()) {
            window.webContents.send("trailin:update-ready", version);
          }
        });
      }
    } catch (error) {
      fatal(`Trailin failed to start: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}
