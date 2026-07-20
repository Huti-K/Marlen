import type { EmailRef } from "@marlen/shared";

/**
 * Command channel into the chat: other panels drive the ONE persistent
 * ChatPanel instance (open a conversation, prefill/send a message, pin a
 * ref) through here instead of window events, which silently drop when no
 * listener is attached. Commands queue until the panel subscribes, so even
 * a command fired during the very first render cannot be lost.
 */
export type ChatCommand =
  | { kind: "new" }
  | { kind: "open"; conversationId: string }
  | { kind: "prefill"; text: string }
  | { kind: "send"; text: string }
  | { kind: "answer"; text: string; refs?: EmailRef[] }
  | { kind: "add-ref"; ref: EmailRef };

let commandListener: ((command: ChatCommand) => void) | null = null;
const queuedCommands: ChatCommand[] = [];

export function sendChatCommand(command: ChatCommand): void {
  if (commandListener) commandListener(command);
  else queuedCommands.push(command);
}

/** ChatPanel's subscription — one listener, the persistent instance. */
export function onChatCommand(listener: (command: ChatCommand) => void): () => void {
  commandListener = listener;
  while (queuedCommands.length > 0) {
    const command = queuedCommands.shift();
    if (command) listener(command);
  }
  return () => {
    if (commandListener === listener) commandListener = null;
  };
}

/**
 * Reveal the chat surface — the mobile slide-over; a no-op where the panel
 * is already visible. App registers the real implementation.
 */
let revealListener: (() => void) | null = null;

export function revealChat(): void {
  revealListener?.();
}

export function onRevealChat(listener: () => void): () => void {
  revealListener = listener;
  return () => {
    if (revealListener === listener) revealListener = null;
  };
}

/** One email attachment for the side-panel viewer (AttachmentViewer). */
export interface AttachmentOpen {
  accountId: string;
  messageId: string;
  filename: string;
  mimeType?: string;
  /** The document library accepts this format, so the viewer offers "Save to library". */
  saveable: boolean;
}

let attachmentListener: ((attachment: AttachmentOpen) => void) | null = null;

export function openAttachment(attachment: AttachmentOpen): void {
  attachmentListener?.(attachment);
}

/** The viewer's subscription — a single instance mounted at the app shell. */
export function onOpenAttachment(listener: (attachment: AttachmentOpen) => void): () => void {
  attachmentListener = listener;
  return () => {
    if (attachmentListener === listener) attachmentListener = null;
  };
}
