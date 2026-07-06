import type {
  AppStatus,
  Automation,
  AutomationRun,
  ChatMessage,
  ChatStreamEvent,
  ConnectedAccount,
  ConnectTokenResponse,
  Conversation,
  EmailApp,
  LlmProviderInfo,
  LoginFlowStatus,
  ModelSettings,
} from "@trailin/shared";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // keep the status text
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export const api = {
  status: () => fetch("/api/status").then(json<AppStatus>),

  llmProviders: () => fetch("/api/llm/providers").then(json<LlmProviderInfo[]>),
  modelSettings: () => fetch("/api/llm/model").then(json<ModelSettings>),
  setModel: (provider: string, model: string) =>
    fetch("/api/llm/model", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, model }),
    }).then(json<ModelSettings>),
  loginStatus: () => fetch("/api/llm/login/status").then(json<LoginFlowStatus>),
  loginStart: (providerId: string) =>
    fetch("/api/llm/login/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId }),
    }).then(json<LoginFlowStatus>),
  loginInput: (value: string) =>
    fetch("/api/llm/login/input", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    }).then(json<{ ok: boolean }>),
  loginSelect: (optionId: string) =>
    fetch("/api/llm/login/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ optionId }),
    }).then(json<{ ok: boolean }>),
  loginCancel: () =>
    fetch("/api/llm/login/cancel", { method: "POST" }).then(json<{ ok: boolean }>),
  saveApiKey: (providerId: string, apiKey: string) =>
    fetch("/api/llm/key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId, apiKey }),
    }).then(json<{ ok: boolean }>),
  llmLogout: (providerId: string) =>
    fetch("/api/llm/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId }),
    }).then(json<{ ok: boolean }>),

  accounts: () => fetch("/api/accounts").then(json<ConnectedAccount[]>),
  connectToken: (app: EmailApp) =>
    fetch("/api/accounts/connect-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app }),
    }).then(json<ConnectTokenResponse>),
  deleteAccount: (id: string) =>
    fetch(`/api/accounts/${id}`, { method: "DELETE" }).then(json<{ ok: boolean }>),

  conversations: () => fetch("/api/conversations").then(json<Conversation[]>),
  messages: (conversationId: string) =>
    fetch(`/api/conversations/${conversationId}/messages`).then(json<ChatMessage[]>),

  automations: () => fetch("/api/automations").then(json<Automation[]>),
  createAutomation: (body: { name: string; instruction: string; schedule: string }) =>
    fetch("/api/automations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(json<Automation>),
  updateAutomation: (id: string, body: Partial<Automation>) =>
    fetch(`/api/automations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(json<Automation>),
  deleteAutomation: (id: string) =>
    fetch(`/api/automations/${id}`, { method: "DELETE" }).then(json<{ ok: boolean }>),
  runAutomation: (id: string) =>
    fetch(`/api/automations/${id}/run`, { method: "POST" }).then(json<{ ok: boolean }>),
  automationRuns: (id: string) =>
    fetch(`/api/automations/${id}/runs`).then(json<AutomationRun[]>),
};

/**
 * POST /api/chat and iterate the SSE stream. Calls onEvent for every event;
 * resolves when the stream closes.
 */
export async function streamChat(
  body: { conversationId?: string; message: string },
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`chat request failed: ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      for (const line of frame.split("\n")) {
        if (line.startsWith("data: ")) {
          try {
            onEvent(JSON.parse(line.slice(6)) as ChatStreamEvent);
          } catch {
            // ignore malformed frames
          }
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}
