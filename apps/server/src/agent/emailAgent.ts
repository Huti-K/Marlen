import { Agent } from "@earendil-works/pi-agent-core";
import { EMAIL_APPS } from "@trailin/shared";
import { modelRegistry, resolveActiveModel } from "../llm/registry.js";
import { loadEmailTools, type EmailToolset } from "../pipedream/mcp.js";

const SYSTEM_PROMPT = `You are Trailin, a personal email assistant. You have tools for the user's
Gmail and Outlook accounts, provided through Pipedream Connect.

Guidelines:
- Prefer reading and summarizing over acting. Look things up before you claim them.
- Never send, reply to, forward or delete an email unless the user's request explicitly asks for it.
  When composing, show the draft content in your answer so the user can see exactly what went out.
- If a tool responds with a Pipedream connect link (the account is not linked yet), surface that URL
  to the user and tell them to connect the account in the Connections tab.
- Keep answers short and skimmable. Use bullet lists for inbox summaries: sender — subject — one-line gist.
- Timestamps from tools are usually UTC; present them in a human-friendly way.`;

export interface AgentSession {
  agent: Agent;
  toolset: EmailToolset;
}

const sessions = new Map<string, AgentSession>();

async function buildAgent(toolset: EmailToolset): Promise<Agent> {
  return new Agent({
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      // Active model comes from Settings (SQLite), falling back to .env.
      model: await resolveActiveModel(),
      tools: toolset.tools,
      messages: [],
    },
    // Route model calls through the registry so stored credentials apply
    // (subscription OAuth with auto-refresh, saved API keys, then env vars).
    streamFn: (model, context, options) => modelRegistry.streamSimple(model, context, options),
  });
}

/** One pi Agent per conversation; context lives in process memory. */
export async function getOrCreateSession(conversationId: string): Promise<AgentSession> {
  const existing = sessions.get(conversationId);
  if (existing) return existing;

  const toolset = await loadEmailTools(EMAIL_APPS);
  const session: AgentSession = { agent: await buildAgent(toolset), toolset };
  sessions.set(conversationId, session);
  return session;
}

/** Drop all in-memory agent sessions (e.g. after auth or model changes). */
export async function resetSessions(): Promise<void> {
  const all = [...sessions.values()];
  sessions.clear();
  await Promise.all(all.map((s) => s.toolset.close().catch(() => {})));
}

export async function disposeSession(conversationId: string): Promise<void> {
  const session = sessions.get(conversationId);
  if (!session) return;
  sessions.delete(conversationId);
  await session.toolset.close();
}

/** Create a throwaway session (used by scheduled automations). */
export async function createEphemeralSession(): Promise<AgentSession> {
  const toolset = await loadEmailTools(EMAIL_APPS);
  return { agent: await buildAgent(toolset), toolset };
}

export interface RunHandlers {
  onTextDelta?: (delta: string) => void;
  onToolStart?: (toolName: string) => void;
  onToolEnd?: (toolName: string, isError: boolean) => void;
}

/**
 * Run one prompt through the agent, forwarding streaming events to the
 * handlers. Resolves with the assistant's final text for this turn.
 */
export async function runPrompt(
  session: AgentSession,
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

  return text.trim();
}
