import type { Agent } from "@earendil-works/pi-agent-core";

export interface RunHandlers {
  onTextDelta?: (delta: string) => void;
  onThinking?: () => void;
  onToolStart?: (toolName: string) => void;
  onToolEnd?: (toolName: string, isError: boolean) => void;
}

/**
 * Run one prompt through the agent, forwarding streaming events to the
 * handlers. Resolves with the assistant's final text for this turn.
 */
export async function runPrompt(
  session: { agent: Agent },
  prompt: string,
  handlers: RunHandlers = {},
): Promise<string> {
  let text = "";

  const unsubscribe = session.agent.subscribe((event) => {
    const e = event as Record<string, unknown>;
    switch (e.type) {
      case "message_update": {
        const inner = e.assistantMessageEvent as
          | { type?: string; delta?: unknown }
          | undefined;
        if (inner && typeof inner.delta === "string") {
          // Forward only visible text; thinking deltas keep their own type.
          if (!inner.type || String(inner.type).startsWith("text")) {
            text += inner.delta;
            handlers.onTextDelta?.(inner.delta);
          } else if (String(inner.type).startsWith("thinking")) {
            handlers.onThinking?.();
          }
        }
        break;
      }
      case "tool_execution_start": {
        const name = (e.toolName ?? e.name ?? "tool") as string;
        handlers.onToolStart?.(name);
        break;
      }
      case "tool_execution_end": {
        const name = (e.toolName ?? e.name ?? "tool") as string;
        handlers.onToolEnd?.(name, Boolean(e.isError));
        break;
      }
    }
  });

  try {
    await session.agent.prompt(prompt);
  } finally {
    if (typeof unsubscribe === "function") unsubscribe();
  }

  // pi doesn't throw on provider failures (missing credentials, refused
  // requests); it records them on the state. Surface them to the caller.
  const failure = session.agent.state.errorMessage;
  if (failure) throw new Error(failure);

  return text.trim();
}
