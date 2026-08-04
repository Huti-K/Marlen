import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Notification,
  session,
  shell,
  systemPreferences,
  type UtilityProcess,
  utilityProcess,
  type WebContents,
} from "electron";
import log from "electron-log/main";
import {
  chromeBackground,
  initialBackground,
  installAppMenu,
  splashUrl,
  windowChrome,
} from "./chrome";
import { startNotifications, stopNotifications } from "./notifications";
import {
  backgroundHint,
  setTrayLabels,
  setTrayWaiting,
  startTray,
  stopTray,
  type TrayLabels,
  trayActive,
} from "./tray";
import {
  checkForUpdatesNow,
  installUpdate,
  pendingUpdateVersion,
  startUpdater,
  type UpdateCheckStatus,
} from "./updater";

/**
 * First port tried, scanning upward when taken. Stable across launches so the
 * renderer origin (and with it localStorage: theme, panels, setup flag)
 * survives restarts.
 */
const BASE_PORT = 43117;
const PORT_SCAN_RANGE = 20;
/**
 * Restart budget for the server process. A server that dies is a hiccup worth
 * restarting through — the port is stable, and the web reconnects its event
 * stream and refetches on its own, so a restart costs the user nothing.
 * Dying this many times inside the window is a broken install instead, and
 * restarting forever would only hide it.
 */
const RESTART_WINDOW_MS = 60_000;
const RESTART_BACKOFF_MS = [500, 1_000, 2_000, 5_000, 10_000];
// Generous: the first launch after install (or an update) on Windows can spend
// minutes in Defender's on-access scan of the unpacked node_modules before the
// server even starts booting. The splash window keeps the wait visible.
const SERVER_READY_TIMEOUT_MS = 180_000;

let serverProcess: UtilityProcess | null = null;
let serverPort: number | null = null;
let quitting = false;
// Exit timestamps inside RESTART_WINDOW_MS, and the handle of a restart that is
// waiting out its backoff — the pair is also what tells waitForServer that a
// gap in `serverProcess` is a restart rather than a dead boot.
let recentExits: number[] = [];
let restartTimer: NodeJS.Timeout | null = null;

const smokeMode = Boolean(process.env.MARLEN_DESKTOP_SMOKE);

/** Report a fatal error and leave; non-zero exit in smoke mode so a scripted run fails instead of hanging on a dialog. */
function fatal(message: string): void {
  log.error(message);
  if (smokeMode) {
    app.exit(1);
    return;
  }
  dialog.showErrorBox("Marlen", message);
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

/** Filters out undefined values (which the utilityProcess API rejects); adds the loopback binding and data paths under Electron's userData. */
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
    // The running app version, for the agent's self-description (core/version.ts);
    // dev servers fall back to the newest changelog entry.
    MARLEN_APP_VERSION: app.getVersion(),
    DATABASE_PATH: path.join(dataRoot, "data", "marlen.db"),
    // The agent home lives under userData like the DB, so it survives updates
    // (electron-updater replaces the app bundle, not userData). The old ~/Trailin
    // location migrates in via the default LEGACY_AGENT_HOME_PATH.
    AGENT_HOME_PATH: path.join(dataRoot, "agent-home"),
    // Pre-agent-home locations, still set so the server's boot migration can
    // move their contents into the agent home.
    LIBRARY_PATH: path.join(dataRoot, "library"),
    SKILLS_PATH: path.join(dataRoot, "skills"),
    WHATSAPP_AUTH_PATH: path.join(dataRoot, "data", "whatsapp-auth"),
    LOG_FILE: path.join(dataRoot, "logs", "marlen.log"),
    WEB_DIST_PATH: path.join(__dirname, "web"),
  };
}

function startServer(port: number): void {
  const entry = path.join(__dirname, "server", "index.mjs");
  const child = utilityProcess.fork(entry, [], {
    env: serverEnv(port),
    stdio: "inherit",
    serviceName: "marlen-server",
  });
  child.once("exit", (code) => {
    serverProcess = null;
    if (quitting) return;
    const now = Date.now();
    recentExits = recentExits.filter((at) => now - at < RESTART_WINDOW_MS);
    const backoff = RESTART_BACKOFF_MS[recentExits.length];
    if (backoff === undefined) {
      fatal(
        `The local Marlen server keeps stopping (code ${code}). Check the logs and reopen the app.`,
      );
      return;
    }
    recentExits.push(now);
    log.warn(`server exited (code ${code}); restarting in ${backoff}ms`);
    // Scheduled synchronously with the exit so no poll sees both a dead
    // process and no pending restart.
    restartTimer = setTimeout(() => {
      restartTimer = null;
      if (!quitting) startServer(port);
    }, backoff);
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
    // A gone process with no restart pending means the restart budget ran out
    // and fatal() has already reported it.
    if (serverProcess === null && restartTimer === null) {
      throw new Error("server exited during startup");
    }
    if (await serverResponding(port)) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`server not reachable on port ${port} within ${SERVER_READY_TIMEOUT_MS}ms`);
}

/**
 * Route every new-window request to the user's browser, never an Electron
 * child window: sign-in flows (Pipedream Connect, provider OAuth) need the
 * browser's cookies, which an Electron window doesn't have.
 */
function installLinkPolicy(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
}

/**
 * The window only ever shows the local app, so a permission request is always
 * the app's own and is granted. On macOS a microphone request (chat dictation)
 * additionally clears the system's own consent prompt first: without it
 * Chromium hands the page a silent input rather than the microphone.
 */
function installPermissionPolicy(): void {
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const wantsMicrophone =
      permission === "media" &&
      "mediaTypes" in details &&
      (details.mediaTypes ?? []).includes("audio");
    if (!wantsMicrophone || process.platform !== "darwin") {
      callback(true);
      return;
    }
    void systemPreferences.askForMediaAccess("microphone").then(callback);
  });
}

/** With `booting`, the window opens on the inline splash spinner instead of the
 *  app; the caller swaps in the real URL once the server answers. */
function createWindow(port: number, booting = false): BrowserWindow {
  const origin = `http://127.0.0.1:${port}`;
  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: initialBackground(),
    ...windowChrome(),
    webPreferences: { preload: path.join(__dirname, "preload.cjs") },
  });
  installLinkPolicy(window.webContents);
  // The main window never leaves the local app: a stray in-window navigation to
  // an external origin opens in the browser instead.
  window.webContents.on("will-navigate", (event, url) => {
    let external: boolean;
    try {
      external = new URL(url).origin !== origin;
    } catch {
      external = true;
    }
    if (!external) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) void shell.openExternal(url);
  });
  void window.loadURL(booting ? splashUrl() : `${origin}/`);
  if (smokeMode) {
    // Only the app itself counts as loaded — the splash finishing must not
    // end a smoke run early.
    window.webContents.on("did-finish-load", () => {
      if (!window.webContents.getURL().startsWith(origin)) return;
      log.info("desktop smoke: window loaded");
      app.quit();
    });
  }
  return window;
}

function focusOrCreateWindow(): void {
  const [window] = BrowserWindow.getAllWindows();
  if (window) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  } else if (serverPort !== null) {
    createWindow(serverPort);
  }
}

/**
 * Tell the user once that closing the window left the app running, so the
 * tray icon is not the only clue. The marker file makes "once" mean once per
 * install rather than once per launch.
 */
function noteBackgroundRunning(): void {
  const marker = path.join(app.getPath("userData"), "background-hint-shown");
  if (existsSync(marker)) return;
  try {
    writeFileSync(marker, "");
  } catch (error) {
    // Only costs a repeated hint; never worth failing the close over.
    log.warn(`writing the background hint marker failed: ${String(error)}`);
  }
  if (!Notification.isSupported()) return;
  new Notification({ title: "Marlen", body: backgroundHint() }).show();
}

/**
 * Launched by the OS at login (or relaunched with the flag the login item
 * carries): the app boots into the tray with no window, which is the point of
 * autostart for something that runs in the background.
 */
function startsHidden(): boolean {
  return process.argv.includes("--hidden") || app.getLoginItemSettings().wasOpenedAsHidden;
}

// One-shot rebrand carry-over: Electron derives the userData folder from the app
// name, so renaming Trailin -> Marlen would point a rebranded install at an empty
// folder. Move the existing data (db, agent home, library, skills) across once,
// before anything (the single-instance lock included) touches userData. renameSync
// is atomic on one volume; on failure keep using the legacy folder so nothing is lost.
function migrateUserData(): void {
  const current = app.getPath("userData");
  const legacy = path.join(app.getPath("appData"), "Trailin");
  if (legacy === current || existsSync(current) || !existsSync(legacy)) return;
  try {
    renameSync(legacy, current);
    log.info(`migrated userData from ${legacy}`);
  } catch (error) {
    log.warn(`userData rename failed, using legacy folder: ${String(error)}`);
    app.setPath("userData", legacy);
  }
}
migrateUserData();

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  // A second launch would race the first for the port and the SQLite file;
  // hand over to the running instance instead.
  app.quit();
} else {
  app.on("second-instance", () => {
    focusOrCreateWindow();
  });

  app.on("window-all-closed", () => {
    // The server, and with it every scheduled automation, outlives the window:
    // on macOS the dock keeps the app reachable, elsewhere the tray does. Only
    // a platform where neither exists still quits with its last window, since
    // there would be no way back.
    if (process.platform === "darwin") return;
    if (!trayActive()) {
      app.quit();
      return;
    }
    noteBackgroundRunning();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverPort !== null) {
      createWindow(serverPort);
    }
  });

  app.on("before-quit", () => {
    quitting = true;
    stopNotifications();
    stopTray();
    if (restartTimer) clearTimeout(restartTimer);
    serverProcess?.kill();
  });

  // The renderer owns the theme (localStorage; may differ from the OS), so it
  // reports the resolved tone and the native window background follows.
  ipcMain.on("marlen:set-chrome-theme", (event, theme: unknown) => {
    if (theme !== "light" && theme !== "dark") return;
    BrowserWindow.fromWebContents(event.sender)?.setBackgroundColor(
      chromeBackground(theme === "dark"),
    );
  });

  // The tray menu speaks the language the web app is set to, which only the
  // renderer knows; it reports the strings on mount and on every change.
  ipcMain.on("marlen:set-tray-labels", (_event, next: unknown) => {
    const labels = next as Partial<TrayLabels> | null;
    if (!labels?.open || !labels.quit || !labels.background) return;
    setTrayLabels({ open: labels.open, quit: labels.quit, background: labels.background });
  });

  // What is waiting for the user, reported by the web app: only it knows, since
  // the count spans local drafts and live mailbox ones, and only it can phrase
  // the summary in the app's language.
  ipcMain.on("marlen:set-waiting", (_event, count: unknown, summary: unknown) => {
    const waiting = typeof count === "number" && count > 0 ? Math.floor(count) : 0;
    // No-op on Windows, whose taskbar has no badge; the tooltip carries it there.
    app.setBadgeCount(waiting);
    setTrayWaiting(waiting > 0 && typeof summary === "string" ? summary : "");
  });

  ipcMain.handle("marlen:get-launch-at-login", () => app.getLoginItemSettings().openAtLogin);
  ipcMain.handle("marlen:set-launch-at-login", (_event, enabled: unknown) => {
    const openAtLogin = enabled === true;
    // Hidden on purpose: an assistant started at login belongs in the tray,
    // not in front of whatever the user opened their computer to do.
    app.setLoginItemSettings({
      openAtLogin,
      openAsHidden: openAtLogin,
      args: openAtLogin ? ["--hidden"] : [],
    });
    return app.getLoginItemSettings().openAtLogin;
  });

  ipcMain.handle("marlen:get-pending-update", () => pendingUpdateVersion());
  ipcMain.handle("marlen:get-app-info", () => ({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
  }));
  ipcMain.handle("marlen:check-for-updates", (): Promise<UpdateCheckStatus> | UpdateCheckStatus =>
    app.isPackaged ? checkForUpdatesNow() : { status: "unsupported" },
  );
  ipcMain.on("marlen:install-update", () => installUpdate());

  void app.whenReady().then(async () => {
    installAppMenu();
    installPermissionPolicy();
    try {
      const port = await findFreePort();
      serverPort = port;
      startServer(port);
      startTray({ onOpen: focusOrCreateWindow });
      // Window first, server-wait after: the user gets a spinner immediately
      // instead of a silent gap while the server boots. An autostarted launch
      // has no window to fill, and boots straight into the tray.
      const window = startsHidden() ? null : createWindow(port, true);
      await waitForServer(port);
      if (window && !window.isDestroyed()) void window.loadURL(`http://127.0.0.1:${port}/`);
      startNotifications(port, { onOpenRequest: focusOrCreateWindow });
      // Dev runs have no update feed baked in: app-update.yml only exists in a packaged build.
      if (app.isPackaged) {
        startUpdater((version) => {
          for (const window of BrowserWindow.getAllWindows()) {
            window.webContents.send("marlen:update-ready", version);
          }
        });
      }
    } catch (error) {
      // quitting: the user closed the splash mid-boot — that's a quit, not a failure.
      if (quitting) return;
      fatal(`Marlen failed to start: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}
