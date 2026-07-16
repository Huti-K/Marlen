import http from "node:http";
import { BrowserWindow, Notification } from "electron";

/**
 * Native desktop notifications for finished automation runs: a long-lived
 * subscription to the local server's SSE feed (GET /api/events) that shows a
 * system Notification for every "notification" event. Lives in the main
 * process so runs finishing with every window closed (macOS keeps the server
 * alive) still notify; a focused window is skipped — its in-app activity feed
 * already shows the run land live. Clicking a notification asks the shell to
 * focus or recreate the window.
 */

const RECONNECT_MS = 3_000;

/** The slice of a ServerEvent frame this module reads (see @trailin/shared's RunNotification). */
interface NotificationEvent {
  topic?: string;
  notification?: { automationName?: string; summary?: string };
}

let request: http.ClientRequest | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let stopped = true;

function showNotification(data: string, onOpenRequest: () => void): void {
  let event: NotificationEvent;
  try {
    event = JSON.parse(data) as NotificationEvent;
  } catch {
    return;
  }
  if (event.topic !== "notification" || !event.notification) return;
  // A focused window already shows the run in its live activity feed.
  if (BrowserWindow.getAllWindows().some((window) => window.isFocused())) return;
  if (!Notification.isSupported()) return;
  const notification = new Notification({
    title: event.notification.automationName ?? "Trailin",
    body: event.notification.summary ?? "",
  });
  notification.on("click", onOpenRequest);
  notification.show();
}

function scheduleReconnect(port: number, onOpenRequest: () => void): void {
  if (stopped || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!stopped) connect(port, onOpenRequest);
  }, RECONNECT_MS);
}

function connect(port: number, onOpenRequest: () => void): void {
  const req = http.get(
    {
      host: "127.0.0.1",
      port,
      path: "/api/events",
      headers: { Accept: "text/event-stream" },
    },
    (response) => {
      response.setEncoding("utf8");
      // Line-buffered SSE parsing: `data:` lines accumulate until the blank
      // line that ends a frame. The server's named "ping" frames carry `{}`
      // as data and fall out on the topic check in showNotification.
      let buffer = "";
      let data: string[] = [];
      response.on("data", (chunk: string) => {
        buffer += chunk;
        for (let newline = buffer.indexOf("\n"); newline !== -1; newline = buffer.indexOf("\n")) {
          const line = buffer.slice(0, newline).replace(/\r$/, "");
          buffer = buffer.slice(newline + 1);
          if (line === "") {
            if (data.length > 0) showNotification(data.join("\n"), onOpenRequest);
            data = [];
          } else if (line.startsWith("data:")) {
            data.push(line.slice("data:".length).trimStart());
          }
        }
      });
      // Covers both the server closing the stream and the response erroring
      // mid-flight ("close" fires after either).
      response.on("close", () => scheduleReconnect(port, onOpenRequest));
    },
  );
  req.on("error", () => scheduleReconnect(port, onOpenRequest));
  request = req;
}

/** Subscribe to the server's event stream and notify on finished runs; reconnects until stopped. */
export function startNotifications(port: number, opts: { onOpenRequest: () => void }): void {
  if (!stopped) return;
  stopped = false;
  connect(port, opts.onOpenRequest);
}

/** Tear the stream down and stop reconnecting; startNotifications re-arms. */
export function stopNotifications(): void {
  stopped = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  request?.destroy();
  request = null;
}
