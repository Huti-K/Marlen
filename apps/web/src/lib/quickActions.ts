import * as React from "react";

/**
 * What one-tap chat actions (the digest's "Draft reply" / "Ask about this"
 * buttons) do with their composed message: send it right away, or prefill
 * the composer so the user can edit it first.
 */
export type QuickActionMode = "send" | "prefill";

const STORAGE_KEY = "trailin-quick-action-mode";

export function getQuickActionMode(): QuickActionMode {
  if (typeof window === "undefined") return "send";
  return localStorage.getItem(STORAGE_KEY) === "prefill" ? "prefill" : "send";
}

/** Hand a composed message to the chat panel, honoring the Settings preference. */
export function dispatchQuickAction(text: string): void {
  const event = getQuickActionMode() === "prefill" ? "trailin:prefill-chat" : "trailin:send-chat";
  window.dispatchEvent(new CustomEvent(event, { detail: { text } }));
  window.dispatchEvent(new CustomEvent("trailin:show-chat"));
}

export function useQuickActionMode() {
  const [mode, setMode] = React.useState<QuickActionMode>(getQuickActionMode);

  React.useEffect(() => {
    localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  return [mode, setMode] as const;
}
