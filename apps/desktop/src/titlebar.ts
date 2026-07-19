// Shared by the main process (window + menu chrome) and the preload bridge, so
// the web reserves the exact strip the native traffic lights float over. Pure —
// no electron import, safe to load in the preload sandbox.

export const TITLEBAR_HEIGHT = 34;

/** macOS hides the bar and floats the traffic lights over the app's own chrome;
 *  every other platform keeps its native title bar (with the menu removed). */
export function titleBarMode(): "inset" | "native" {
  return process.platform === "darwin" ? "inset" : "native";
}
