import {
  app,
  type BrowserWindowConstructorOptions,
  Menu,
  type MenuItemConstructorOptions,
  nativeTheme,
} from "electron";
import { titleBarMode } from "./titlebar";

// Native window-background tone shown before the renderer paints and along the
// window edge while resizing. Mirrors the web palette's --sidebar so a dark
// launch doesn't flash white; kept in sync by hand (only the pre-paint flash
// rides on it — the visible chrome is the web sidebar itself).
const CHROME_LIGHT = "#ffffff";
const CHROME_DARK = "#0b0b0d";

export function chromeBackground(dark: boolean): string {
  return dark ? CHROME_DARK : CHROME_LIGHT;
}

export function initialBackground(): string {
  return chromeBackground(nativeTheme.shouldUseDarkColors);
}

/** Data-URL spinner page shown in the window while the local server boots (the
 *  first launch on Windows can take a while — Defender scans the unpacked app).
 *  Inline so it needs no packaged asset. */
export function splashUrl(): string {
  const dark = nativeTheme.shouldUseDarkColors;
  const track = dark ? "#27272a" : "#e4e4e7";
  const head = dark ? "#a1a1aa" : "#52525b";
  const html =
    `<!doctype html><title>Trailin</title><style>` +
    `html,body{height:100%;margin:0;background:${chromeBackground(dark)}}` +
    `body{display:flex;align-items:center;justify-content:center}` +
    `div{width:28px;height:28px;border-radius:50%;border:3px solid ${track};border-top-color:${head};animation:s .8s linear infinite}` +
    `@keyframes s{to{transform:rotate(1turn)}}` +
    `</style><div></div>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

/** macOS drops the title bar and lets the web chrome run edge to edge under the
 *  floating traffic lights; other platforms keep their native bar. */
export function windowChrome(): BrowserWindowConstructorOptions {
  if (titleBarMode() === "inset") {
    return { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 16, y: 14 } };
  }
  return {};
}

/** macOS keeps a minimal native menu — the app/edit/window roles that the
 *  standard shortcuts (copy, paste, quit) are wired through — minus the
 *  File/Help clutter. Elsewhere the menu bar is dropped entirely; Chromium still
 *  handles the edit shortcuts inside the web content. */
export function installAppMenu(): void {
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(null);
    return;
  }
  const view: MenuItemConstructorOptions[] = [
    { role: "resetZoom" },
    { role: "zoomIn" },
    { role: "zoomOut" },
    { type: "separator" },
    { role: "togglefullscreen" },
  ];
  if (!app.isPackaged) {
    view.unshift(
      { role: "reload" },
      { role: "forceReload" },
      { role: "toggleDevTools" },
      { type: "separator" },
    );
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: "appMenu" },
      { role: "editMenu" },
      { label: "View", submenu: view },
      { role: "windowMenu" },
    ]),
  );
}
