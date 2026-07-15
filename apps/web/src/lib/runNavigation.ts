import { dispatchTrailin } from "@/lib/trailinEvents";

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
