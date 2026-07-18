import * as React from "react";
import { dispatchTrailin } from "@/lib/trailinEvents";

/**
 * What one-tap chat actions (the digest's "Draft reply" / "Ask about this"
 * buttons) do with their composed message: send it right away, or prefill
 * the composer so the user can edit it first.
 */
export type QuickActionMode = "send" | "prefill";

const STORAGE_KEY = "trailin-quick-action-mode";

function getQuickActionMode(): QuickActionMode {
  if (typeof window === "undefined") return "send";
  return localStorage.getItem(STORAGE_KEY) === "prefill" ? "prefill" : "send";
}

/** Hand a composed message to the chat panel, honoring the Settings preference. */
export function dispatchQuickAction(text: string): void {
  if (getQuickActionMode() === "prefill") dispatchTrailin("prefill-chat", { text });
  else dispatchTrailin("send-chat", { text });
  dispatchTrailin("show-chat");
}

export function useQuickActionMode() {
  const [mode, setMode] = React.useState<QuickActionMode>(getQuickActionMode);

  React.useEffect(() => {
    localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  return [mode, setMode] as const;
}

/**
 * Navigates to the Chat tab, then opens a specific run's conversation once
 * it has mounted. The short delay bridges the gap between the route
 * change/DOM commit and the chat panel's "open a conversation" listener
 * being ready — shared by every run card that offers a "go to chat" action
 * (Home's activity feed, its briefing hero, and the Automations run list).
 */
export function openRunInChat(runId: string, goToChat: () => void): void {
  goToChat();
  setTimeout(() => {
    dispatchTrailin("open-chat", runId);
  }, 100);
}
