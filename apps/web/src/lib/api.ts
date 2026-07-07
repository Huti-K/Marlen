import type {
  AccountColor,
  AccountDrafts,
  AppStatus,
  Automation,
  AutomationRun,
  ChatMessage,
  ChatStreamEvent,
  ConnectedAccount,
  ConnectTokenResponse,
  Conversation,
  Language,
  LibraryStatus,
  LlmProviderInfo,
  LoginFlowStatus,
  MemoryEntry,
  ModelSettings,
  PipedreamApp,
  PipedreamConfigInput,
  PipedreamStatus,
  RunFeedItem,
} from "@trailin/shared";

/** Throws with the server's `error` message when a response is not ok. */
async function throwOnError(res: Response): Promise<void> {
  if (res.ok) return;
  let message = `${res.status} ${res.statusText}`;
  try {
    const data = (await res.json()) as { error?: string };
    if (data.error) message = data.error;
  } catch {
    // keep the status text
  }
  throw new Error(message);
}

/** Fetch JSON; non-2xx responses throw with the server's `error` message. */
async function http<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    ...(body !== undefined && {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
  await throwOnError(res);
  return res.json() as Promise<T>;
}

const get = <T>(url: string) => http<T>("GET", url);

export const api = {
  status: () => get<AppStatus>("/api/status"),

  // null until a language has been chosen (first web load initializes it).
  language: () => get<{ language: Language | null }>("/api/settings/language"),
  setLanguage: (language: Language) =>
    http<{ language: Language }>("PUT", "/api/settings/language", { language }),

  emailWrite: () => get<{ allowWrite: boolean }>("/api/settings/email-write"),
  setEmailWrite: (allowWrite: boolean) =>
    http<{ allowWrite: boolean }>("PUT", "/api/settings/email-write", { allowWrite }),

  accountColors: () => get<{ colors: AccountColor[] }>("/api/settings/account-colors"),
  setAccountColors: (colors: AccountColor[]) =>
    http<{ colors: AccountColor[] }>("PUT", "/api/settings/account-colors", { colors }),

  llmProviders: () => get<LlmProviderInfo[]>("/api/llm/providers"),
  modelSettings: () => get<ModelSettings>("/api/llm/model"),
  setModel: (provider: string, model: string) =>
    http<ModelSettings>("PUT", "/api/llm/model", { provider, model }),
  loginStatus: () => get<LoginFlowStatus>("/api/llm/login/status"),
  loginStart: (providerId: string) =>
    http<LoginFlowStatus>("POST", "/api/llm/login/start", { providerId }),
  loginInput: (value: string) => http<{ ok: boolean }>("POST", "/api/llm/login/input", { value }),
  loginSelect: (optionId: string) =>
    http<{ ok: boolean }>("POST", "/api/llm/login/select", { optionId }),
  loginCancel: () => http<{ ok: boolean }>("POST", "/api/llm/login/cancel"),
  saveApiKey: (providerId: string, apiKey: string) =>
    http<{ ok: boolean }>("POST", "/api/llm/key", { providerId, apiKey }),
  llmLogout: (providerId: string) => http<{ ok: boolean }>("POST", "/api/llm/logout", { providerId }),

  pipedreamStatus: () => get<PipedreamStatus>("/api/pipedream"),
  savePipedream: (body: PipedreamConfigInput) =>
    http<PipedreamStatus>("PUT", "/api/pipedream", body),
  clearPipedream: () => http<PipedreamStatus>("DELETE", "/api/pipedream"),
  setPipedreamMode: (useCustom: boolean) =>
    http<PipedreamStatus>("PUT", "/api/pipedream/mode", { useCustom }),
  pipedreamAccounts: () => get<ConnectedAccount[]>("/api/pipedream/accounts"),
  pipedreamApps: (q: string) =>
    get<PipedreamApp[]>(`/api/pipedream/apps?q=${encodeURIComponent(q)}`),
  pipedreamConnectToken: (app: string) =>
    http<ConnectTokenResponse>("POST", "/api/pipedream/accounts/connect-token", { app }),
  deletePipedreamAccount: (id: string) =>
    http<{ ok: boolean }>("DELETE", `/api/pipedream/accounts/${id}`),

  runsFeed: () => get<RunFeedItem[]>("/api/runs"),
  drafts: () => get<AccountDrafts[]>("/api/drafts"),
  draftDetail: (accountId: string, draftId: string) =>
    get<{ body: string; cc: string; bcc: string }>(`/api/drafts/${accountId}/${draftId}`),
  deleteDraft: (accountId: string, draftId: string) =>
    http<{ ok: boolean }>("DELETE", `/api/drafts/${accountId}/${draftId}`),

  conversations: () => get<Conversation[]>("/api/conversations"),
  conversationMessages: (id: string) =>
    get<ChatMessage[]>(`/api/conversations/${encodeURIComponent(id)}/messages`),

  automations: () => get<Automation[]>("/api/automations"),
  createAutomation: (body: { name: string; instruction: string; schedule: string; showInActivity?: boolean }) =>
    http<Automation>("POST", "/api/automations", body),
  updateAutomation: (id: string, body: Partial<Automation>) =>
    http<Automation>("PATCH", `/api/automations/${id}`, body),
  deleteAutomation: (id: string) => http<{ ok: boolean }>("DELETE", `/api/automations/${id}`),
  runAutomation: (id: string) => http<{ ok: boolean }>("POST", `/api/automations/${id}/run`),
  automationRuns: (id: string) => get<AutomationRun[]>(`/api/automations/${id}/runs`),

  memories: () => get<MemoryEntry[]>("/api/memories"),
  addMemory: (content: string) => http<MemoryEntry>("POST", "/api/memories", { content }),
  updateMemory: (id: string, content: string) =>
    http<MemoryEntry>("PUT", `/api/memories/${id}`, { content }),
  deleteMemory: (id: string) => http<{ ok: boolean }>("DELETE", `/api/memories/${id}`),

  library: () => get<LibraryStatus>("/api/library"),
  libraryScan: () => http<LibraryStatus>("POST", "/api/library/scan"),
  setLibraryFolder: (folder: string) =>
    http<LibraryStatus>("PUT", "/api/library/folder", { folder }),
  // Opens the OS's native folder dialog on the server's machine; the request
  // stays open until the user picks (fresh status) or dismisses the dialog.
  pickLibraryFolder: () =>
    http<LibraryStatus | { canceled: true }>("POST", "/api/library/folder/pick"),
  deleteLibraryDocument: (id: string) =>
    http<LibraryStatus>("DELETE", `/api/library/documents/${id}`),
  // Raw file body (not JSON), so this bypasses the `http` helper.
  uploadLibraryFile: async (file: File): Promise<LibraryStatus> => {
    const res = await fetch(`/api/library/files?name=${encodeURIComponent(file.name)}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
    });
    await throwOnError(res);
    return res.json() as Promise<LibraryStatus>;
  },
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
