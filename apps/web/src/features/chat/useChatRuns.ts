import type { EmailRef } from "@marlen/shared";
import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  createInitialRunState,
  type DisplayMessage,
  type RunAction,
  reduceRunEvent,
  toDisplayMessage,
} from "@/features/chat/runState";
import { api, streamChat } from "@/lib/api";
import { subscribeServerEvents } from "@/lib/serverEvents";
import { toast } from "@/lib/toast";
import { errorMessage } from "@/lib/utils";

/** Same-device continuity: the conversation to restore on the next load. */
const LAST_CONVERSATION_KEY = "marlen-last-conversation";

export interface UseChatRunsOptions {
  setHistoryOpen: React.Dispatch<React.SetStateAction<boolean>>;
  /** Called after an async run/open settles, mirroring the composer's own focus timing. */
  onFocusComposer: () => void;
  /** Mailbox picked in the header chip before a conversation exists; sent with the
   *  first message so the new conversation (and its first turn) opens focused on it. */
  pendingFocusAccountId?: string | null;
}

export interface UseChatRunsResult {
  messages: DisplayMessage[];
  busy: boolean;
  restoring: boolean;
  conversationId: string | undefined;
  /** Streams a real turn — starts one server-side if no conversation is open yet. */
  send: (message: string, refs?: EmailRef[]) => Promise<void>;
  openConversation: (id: string) => Promise<void>;
  newConversation: () => void;
  /** Appends messages built outside a server run (e.g. /showcase). */
  appendMessages: (messages: DisplayMessage[]) => void;
  /** Patches one message by id (e.g. the /sys command filling in its result). */
  updateMessage: (id: string, patch: Partial<DisplayMessage>) => void;
  /** Occupies/releases the busy slot for a local (non-streamed) turn, e.g. /sys. */
  setBusy: (busy: boolean) => void;
}

/**
 * Owns the live-turn state machine: the active conversation, its message
 * list, and every run (streamed turn) writing to it — including ones for a
 * conversation the panel isn't currently showing. `reduceRunEvent` is the
 * single source of truth for how state changes; this hook only supplies the
 * things a pure reducer can't (ids, the stream/fetch plumbing, localStorage,
 * toasts, and the `conversations-changed` invalidation).
 */
export function useChatRuns({
  setHistoryOpen,
  onFocusComposer,
  pendingFocusAccountId,
}: UseChatRunsOptions): UseChatRunsResult {
  const { t } = useTranslation();
  // Mirrored to a ref so `send` (memoized, not re-created per keystroke) always
  // reads the latest header pick without widening its dependency list.
  const pendingFocusRef = React.useRef(pendingFocusAccountId);
  pendingFocusRef.current = pendingFocusAccountId;
  // Mirrors `state` synchronously so a handler can read the freshest value
  // even before React has re-rendered (e.g. newConversation() immediately
  // followed by a send() in the same tick, as marlen:send-chat does).
  const stateRef = React.useRef(createInitialRunState());
  const [state, setState] = React.useState(stateRef.current);

  const dispatch = React.useCallback((action: RunAction) => {
    const next = reduceRunEvent(stateRef.current, action);
    stateRef.current = next;
    setState(next);
  }, []);

  // Pick up where this device left off. Text, cards, tool activity and turn
  // errors are persisted together and restored here.
  React.useEffect(() => {
    const savedId = localStorage.getItem(LAST_CONVERSATION_KEY);
    if (!savedId) {
      dispatch({ type: "restore", result: null });
      return;
    }
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let restored: { conversationId: string; messages: DisplayMessage[] } | null = null;

    // A restored transcript ending in a user message means the reply is still
    // being produced: turns survive page unloads (routes/chat.ts), so watch
    // the "conversations" topic and re-pull until the outcome row lands.
    const awaitReply = () => {
      const refresh = () => {
        void api
          .conversationMessages(savedId)
          .then((msgs) => {
            if (cancelled || msgs[msgs.length - 1]?.role !== "assistant") return;
            const current = stateRef.current;
            // The user moved on to another conversation — its open flow owns
            // the state now, and reopening this one fetches fresh anyway.
            if (current.activeConversationId !== savedId) {
              unsubscribe?.();
              return;
            }
            // A live local run for this conversation streams its own state.
            if (Object.values(current.runs).some((run) => run.conversationId === savedId)) return;
            unsubscribe?.();
            dispatch({
              type: "restore",
              result: { conversationId: savedId, messages: msgs.map(toDisplayMessage) },
            });
          })
          .catch(() => {}); // Transient — the next topic event retries.
      };
      unsubscribe = subscribeServerEvents(["conversations"], refresh);
      // The outcome may have landed between the restore fetch and subscribing.
      refresh();
    };

    api
      .conversationMessages(savedId)
      .then((msgs) => {
        if (cancelled || msgs.length === 0) return;
        restored = { conversationId: savedId, messages: msgs.map(toDisplayMessage) };
        if (msgs[msgs.length - 1]?.role === "user") awaitReply();
      })
      .catch((err) => {
        // Unreachable or gone — start fresh, but don't make the failure silent.
        toast.error(err);
      })
      .finally(() => {
        if (!cancelled) dispatch({ type: "restore", result: restored });
      });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [dispatch]);

  const send = React.useCallback(
    async (message: string, refs?: EmailRef[]) => {
      const runId = crypto.randomUUID();
      const userMessage: DisplayMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: message,
        toolCalls: [],
        cards: [],
        streaming: false,
        refs,
      };
      const assistantMessage: DisplayMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        toolCalls: [],
        cards: [],
        streaming: true,
      };
      const conversationIdAtStart = stateRef.current.activeConversationId;
      // The header pick only seeds a brand-new conversation — an existing one
      // already owns its focus (moved by the chip's PATCH, @-mentions, or the
      // agent), which this must never clobber.
      const focusAccountId = conversationIdAtStart
        ? undefined
        : (pendingFocusRef.current ?? undefined);
      dispatch({ type: "start-run", runId, userMessage, assistantMessage });

      try {
        await streamChat(
          { conversationId: conversationIdAtStart, message, refs, focusAccountId },
          (event) => {
            if (event.type === "conversation") {
              // Read before dispatching: mirrors the reducer's own "is this run
              // still the active one" check, so the persisted id matches what
              // just became visible.
              const wasActive = stateRef.current.activeRunId === runId;
              dispatch({ type: "stream", runId, event });
              if (wasActive) localStorage.setItem(LAST_CONVERSATION_KEY, event.conversationId);
              // The conversation row is already committed when this stream event
              // arrives; the history rail refetches via the "conversations" SSE
              // topic, whose stream is held open for the app's whole lifetime by
              // the query bridge (lib/query.ts).
              return;
            }
            if (event.type === "error") {
              // Rate limits toast the plain-language line; the raw provider
              // error only helps for unclassified failures.
              toast.error(
                event.kind === "rate_limit" ? t("chat.rateLimited.message") : event.message,
              );
            }
            dispatch({ type: "stream", runId, event });
          },
        );
      } catch (err) {
        toast.error(err);
        dispatch({ type: "run-error", runId, message: errorMessage(err) });
      } finally {
        dispatch({ type: "run-settled", runId });
        requestAnimationFrame(() => onFocusComposer());
      }
    },
    [dispatch, onFocusComposer, t],
  );

  const openConversation = React.useCallback(
    async (id: string) => {
      dispatch({ type: "open-conversation", conversationId: id });
      localStorage.setItem(LAST_CONVERSATION_KEY, id);
      setHistoryOpen(false);
      if (stateRef.current.messageCache[id]) {
        onFocusComposer();
        return;
      }
      try {
        const msgs = await api.conversationMessages(id);
        if (stateRef.current.activeConversationId !== id) return;
        dispatch({
          type: "open-conversation-loaded",
          conversationId: id,
          messages: msgs.map(toDisplayMessage),
        });
        // Opening a conversation means continuing it — put the caret where the
        // user's next message goes (e.g. the Drafts page's refine jump).
        onFocusComposer();
      } catch (err) {
        toast.error(err);
      }
    },
    [dispatch, setHistoryOpen, onFocusComposer],
  );

  const newConversation = React.useCallback(() => {
    dispatch({ type: "new-conversation" });
    setHistoryOpen(false);
    localStorage.removeItem(LAST_CONVERSATION_KEY);
  }, [dispatch, setHistoryOpen]);

  const appendMessages = React.useCallback(
    (messages: DisplayMessage[]) => dispatch({ type: "append-messages", messages }),
    [dispatch],
  );

  const updateMessage = React.useCallback(
    (id: string, patch: Partial<DisplayMessage>) => dispatch({ type: "update-message", id, patch }),
    [dispatch],
  );

  const setBusy = React.useCallback(
    (busy: boolean) => dispatch({ type: "set-busy", busy }),
    [dispatch],
  );

  return {
    messages: state.messages,
    busy: state.busy,
    restoring: state.restoring,
    conversationId: state.activeConversationId,
    send,
    openConversation,
    newConversation,
    appendMessages,
    updateMessage,
    setBusy,
  };
}
