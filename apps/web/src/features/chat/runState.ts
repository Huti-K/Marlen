import type {
  AgentCard,
  ChatMessage,
  ChatStreamEvent,
  ChatToolCall,
  EmailRef,
} from "@marlen/shared";

/**
 * One message as the chat panel renders it — a user turn, or an assistant
 * turn that may still be streaming, carrying tool activity and cards.
 */
export interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls: ChatToolCall[];
  /** Structured tool results, keyed by tool call so a retried tool replaces its card. */
  cards: { toolCallId: string; card: AgentCard }[];
  streaming: boolean;
  thinking?: boolean;
  error?: string;
  /** Local-only /sys result. */
  systemPrompt?: string;
  /** Emails the user pinned to this message (composer @-mentions or a card's "add to chat" action); user messages only. */
  refs?: EmailRef[];
}

/** One turn's own message buffer, independent of what the panel currently shows. */
export interface RunEntry {
  /** Assigned once the server confirms/creates the conversation; undefined until then. */
  conversationId: string | undefined;
  messages: DisplayMessage[];
}

export interface RunState {
  /** The conversation shown in the panel right now; undefined = a fresh, unsaved chat. */
  activeConversationId: string | undefined;
  /** Messages rendered for the active conversation right now. */
  messages: DisplayMessage[];
  /** True while the active slot is occupied by a turn — a streamed run or a local one (/sys). */
  busy: boolean;
  /** True until the boot-time "restore last conversation" lookup settles. */
  restoring: boolean;
  /** The run currently driving `messages`/`busy`; undefined when idle or the occupant is a local turn. */
  activeRunId: string | undefined;
  /** Every turn still writing, keyed by runId — including ones for a conversation the panel isn't showing. */
  runs: Record<string, RunEntry>;
  /** Live runId for a conversation once the server has assigned it an id, so reopening that conversation finds the in-progress run. */
  runIdByConversation: Record<string, string>;
  /** Last known messages per conversation id, so switching conversations doesn't require a re-fetch mid-stream. */
  messageCache: Record<string, DisplayMessage[]>;
}

export type RunAction =
  /** Boot-time restore of the last open conversation; `result` is null when there was nothing to restore (or the lookup failed). */
  | { type: "restore"; result: { conversationId: string; messages: DisplayMessage[] } | null }
  /** A new turn is being sent in the active conversation (or a brand-new one). */
  | {
      type: "start-run";
      runId: string;
      userMessage: DisplayMessage;
      assistantMessage: DisplayMessage;
    }
  /** One event off a run's stream. */
  | { type: "stream"; runId: string; event: ChatStreamEvent }
  /** The stream's request itself failed (network/transport), rather than reporting an in-band `error` event. */
  | { type: "run-error"; runId: string; message: string }
  /** The run's stream has ended (success, failure, or abandonment) — release its slot. */
  | { type: "run-settled"; runId: string }
  /** The user opened a conversation: adopt its live run (if any) and cached messages (if any). */
  | { type: "open-conversation"; conversationId: string }
  /** A conversation's messages finished loading from the server. */
  | { type: "open-conversation-loaded"; conversationId: string; messages: DisplayMessage[] }
  | { type: "new-conversation" }
  /** Appends messages built outside a server run (e.g. /showcase). */
  | { type: "append-messages"; messages: DisplayMessage[] }
  /** Patches one message by id (e.g. the /sys command filling in its result). */
  | { type: "update-message"; id: string; patch: Partial<DisplayMessage> }
  /** Occupies/releases the busy slot for a local (non-streamed) turn, e.g. /sys. */
  | { type: "set-busy"; busy: boolean };

export function createInitialRunState(): RunState {
  return {
    activeConversationId: undefined,
    messages: [],
    busy: false,
    restoring: true,
    activeRunId: undefined,
    runs: {},
    runIdByConversation: {},
    messageCache: {},
  };
}

/** Maps a persisted server message onto the panel's display shape. */
export function toDisplayMessage(m: ChatMessage): DisplayMessage {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    toolCalls: m.toolCalls ?? [],
    cards: m.cards ?? [],
    streaming: false,
    error: m.error,
    refs: m.refs,
  };
}

function withoutKey<T>(map: Record<string, T>, key: string): Record<string, T> {
  if (!(key in map)) return map;
  const next = { ...map };
  delete next[key];
  return next;
}

/**
 * Replaces a run's trailing streaming-assistant message via `updater`, then
 * fans the result out to the run's own buffer, the conversation's message
 * cache (once it has a conversationId), and the visible `messages` — but
 * only when this run is the one the panel is currently showing (by run
 * identity, or by conversation id once the run has been assigned one).
 */
function applyToRun(
  state: RunState,
  runId: string,
  updater: (message: DisplayMessage) => DisplayMessage,
): RunState {
  const run = state.runs[runId];
  if (!run) return state;

  const nextMessages = [...run.messages];
  const last = nextMessages[nextMessages.length - 1];
  if (last && last.role === "assistant" && last.streaming) {
    nextMessages[nextMessages.length - 1] = updater(last);
  }

  const nextRun: RunEntry = { ...run, messages: nextMessages };
  const runs = { ...state.runs, [runId]: nextRun };
  const messageCache =
    run.conversationId !== undefined
      ? { ...state.messageCache, [run.conversationId]: nextMessages }
      : state.messageCache;
  const isVisible =
    state.activeRunId === runId ||
    (run.conversationId !== undefined && state.activeConversationId === run.conversationId);

  return {
    ...state,
    runs,
    messageCache,
    messages: isVisible ? nextMessages : state.messages,
  };
}

function reduceStreamEvent(
  state: RunState,
  runId: string,
  run: RunEntry,
  event: ChatStreamEvent,
): RunState {
  switch (event.type) {
    case "conversation": {
      const updatedRun: RunEntry = { ...run, conversationId: event.conversationId };
      const runs = { ...state.runs, [runId]: updatedRun };
      const runIdByConversation = { ...state.runIdByConversation, [event.conversationId]: runId };
      const messageCache = { ...state.messageCache, [event.conversationId]: run.messages };
      const wasActive = state.activeRunId === runId;
      return {
        ...state,
        runs,
        runIdByConversation,
        messageCache,
        activeConversationId: wasActive ? event.conversationId : state.activeConversationId,
      };
    }
    case "thinking":
      return applyToRun(state, runId, (m) => ({ ...m, thinking: true }));
    case "text_delta":
      return applyToRun(state, runId, (m) => ({
        ...m,
        content: m.content + event.delta,
        thinking: false,
      }));
    case "tool_start":
      return applyToRun(state, runId, (m) => ({
        ...m,
        thinking: false,
        toolCalls: [
          ...m.toolCalls,
          {
            id: event.toolCallId,
            name: event.toolName,
            label: event.toolLabel,
            isError: false,
            done: false,
            parameters: event.parameters,
            contentOffset: event.contentOffset,
          },
        ],
      }));
    case "tool_update":
      return applyToRun(state, runId, (m) => ({
        ...m,
        toolCalls: m.toolCalls.map((call) =>
          call.id === event.toolCallId ? { ...call, detail: event.detail } : call,
        ),
      }));
    case "tool_end":
      return applyToRun(state, runId, (m) => ({
        ...m,
        toolCalls: m.toolCalls.map((call) =>
          call.id === event.toolCallId
            ? { ...call, done: true, isError: event.isError, result: event.result }
            : call,
        ),
      }));
    case "card":
      return applyToRun(state, runId, (m) => ({
        ...m,
        thinking: false,
        cards: [
          ...m.cards.filter((c) => c.toolCallId !== event.toolCallId),
          { toolCallId: event.toolCallId, card: event.card },
        ],
      }));
    case "done":
      return applyToRun(state, runId, (m) => ({
        ...m,
        content: event.text || m.content,
        streaming: false,
        thinking: false,
      }));
    case "error":
      return applyToRun(state, runId, (m) => ({
        ...m,
        error: event.message,
        streaming: false,
        thinking: false,
      }));
  }
}

export function reduceRunEvent(state: RunState, action: RunAction): RunState {
  switch (action.type) {
    case "restore": {
      if (!action.result) return { ...state, restoring: false };
      const { conversationId, messages } = action.result;
      return {
        ...state,
        activeConversationId: conversationId,
        messages,
        messageCache: { ...state.messageCache, [conversationId]: messages },
        restoring: false,
      };
    }
    case "start-run": {
      const { runId, userMessage, assistantMessage } = action;
      const conversationId = state.activeConversationId;
      const nextMessages = [...state.messages, userMessage, assistantMessage];
      const run: RunEntry = { conversationId, messages: nextMessages };
      const runs = { ...state.runs, [runId]: run };
      const runIdByConversation =
        conversationId !== undefined
          ? { ...state.runIdByConversation, [conversationId]: runId }
          : state.runIdByConversation;
      const messageCache =
        conversationId !== undefined
          ? { ...state.messageCache, [conversationId]: nextMessages }
          : state.messageCache;
      return {
        ...state,
        runs,
        runIdByConversation,
        messageCache,
        activeRunId: runId,
        messages: nextMessages,
        busy: true,
      };
    }
    case "stream": {
      const run = state.runs[action.runId];
      if (!run) return state;
      return reduceStreamEvent(state, action.runId, run, action.event);
    }
    case "run-error":
      return applyToRun(state, action.runId, (m) => ({
        ...m,
        error: action.message,
        streaming: false,
        thinking: false,
      }));
    case "run-settled": {
      const run = state.runs[action.runId];
      if (!run) return state;
      const runs = withoutKey(state.runs, action.runId);
      const runIdByConversation =
        run.conversationId !== undefined &&
        state.runIdByConversation[run.conversationId] === action.runId
          ? withoutKey(state.runIdByConversation, run.conversationId)
          : state.runIdByConversation;
      const wasActive = state.activeRunId === action.runId;
      return {
        ...state,
        runs,
        runIdByConversation,
        activeRunId: wasActive ? undefined : state.activeRunId,
        busy: wasActive ? false : state.busy,
      };
    }
    case "open-conversation": {
      const { conversationId } = action;
      const liveRunId = state.runIdByConversation[conversationId];
      const cached = state.messageCache[conversationId];
      return {
        ...state,
        activeConversationId: conversationId,
        activeRunId: liveRunId,
        busy: Boolean(liveRunId),
        messages: cached ?? state.messages,
      };
    }
    case "open-conversation-loaded": {
      if (state.activeConversationId !== action.conversationId) return state;
      return {
        ...state,
        messages: action.messages,
        messageCache: { ...state.messageCache, [action.conversationId]: action.messages },
      };
    }
    case "new-conversation":
      return {
        ...state,
        activeConversationId: undefined,
        activeRunId: undefined,
        busy: false,
        messages: [],
      };
    case "append-messages":
      return { ...state, messages: [...state.messages, ...action.messages] };
    case "update-message":
      return {
        ...state,
        messages: state.messages.map((m) => (m.id === action.id ? { ...m, ...action.patch } : m)),
      };
    case "set-busy":
      return { ...state, busy: action.busy };
  }
}
