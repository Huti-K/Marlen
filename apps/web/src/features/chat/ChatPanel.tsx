import * as React from "react";
import { Loader2, MessagesSquare, Send, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ChatStreamEvent, Conversation } from "@trailin/shared";
import { api, streamChat } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LoadingRow } from "@/components/ui/feedback";
import { EmptyState } from "@/components/ui/empty-state";
import { Markdown } from "@/components/ui/markdown";
import { toast } from "@/lib/toast";
import { cn, errorMessage } from "@/lib/utils";

/** Same-device continuity: the conversation to restore on the next load. */
const LAST_CONVERSATION_KEY = "trailin-last-conversation";

interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls: { name: string; isError: boolean; done: boolean }[];
  streaming: boolean;
  thinking?: boolean;
}

export function ChatPanel({
  historyOpen,
  setHistoryOpen,
}: {
  historyOpen: boolean;
  setHistoryOpen: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const { t } = useTranslation();
  const [messages, setMessages] = React.useState<DisplayMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [restoring, setRestoring] = React.useState(true);
  const [conversationId, setConversationId] = React.useState<string | undefined>();
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  // Pick up where this device left off. Tool badges aren't persisted — restored
  // turns render as plain text.
  React.useEffect(() => {
    const savedId = localStorage.getItem(LAST_CONVERSATION_KEY);
    if (!savedId) {
      setRestoring(false);
      return;
    }
    let cancelled = false;
    api
      .conversationMessages(savedId)
      .then((msgs) => {
        if (cancelled || msgs.length === 0) return;
        setMessages(
          msgs.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            toolCalls: [],
            streaming: false,
          })),
        );
        setConversationId(savedId);
      })
      .catch(() => {
        // Unreachable or gone — start fresh.
      })
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Grow the textarea with its content, up to the CSS max-height cap (then it
  // scrolls internally). Empty is left to the CSS min-height instead of measured
  // via scrollHeight — Chrome/Firefox size that against the wrapped placeholder
  // text, not the (empty) value, which puffed the box up at rest.
  React.useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (!input) {
      el.style.height = "";
      return;
    }
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  const updateAssistant = (updater: (m: DisplayMessage) => DisplayMessage) => {
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last && last.role === "assistant" && last.streaming) {
        next[next.length - 1] = updater(last);
      }
      return next;
    });
  };

  const handleEvent = (event: ChatStreamEvent) => {
    switch (event.type) {
      case "conversation":
        setConversationId(event.conversationId);
        localStorage.setItem(LAST_CONVERSATION_KEY, event.conversationId);
        break;
      case "thinking":
        updateAssistant((m) => ({ ...m, thinking: true }));
        break;
      case "text_delta":
        updateAssistant((m) => ({ ...m, content: m.content + event.delta, thinking: false }));
        break;
      case "tool_start":
        updateAssistant((m) => ({
          ...m,
          thinking: false,
          toolCalls: [...m.toolCalls, { name: event.toolName, isError: false, done: false }],
        }));
        break;
      case "tool_end":
        updateAssistant((m) => ({
          ...m,
          toolCalls: m.toolCalls.map((t, i) =>
            i === m.toolCalls.length - 1 && t.name === event.toolName
              ? { ...t, done: true, isError: event.isError }
              : t,
          ),
        }));
        break;
      case "done":
        updateAssistant((m) => ({
          ...m,
          content: event.text || m.content,
          streaming: false,
          thinking: false,
        }));
        break;
      case "error":
        toast.error(event.message);
        updateAssistant((m) => ({ ...m, streaming: false, thinking: false }));
        break;
    }
  };

  const send = async () => {
    const message = input.trim();
    if (!message || busy) return;
    setInput("");
    setBusy(true);
    setHistoryOpen(false);
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "user",
        content: message,
        toolCalls: [],
        streaming: false,
      },
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        toolCalls: [],
        streaming: true,
      },
    ]);

    try {
      await streamChat({ conversationId, message }, handleEvent);
    } catch (err) {
      toast.error(errorMessage(err));
      updateAssistant((m) => ({ ...m, streaming: false }));
    } finally {
      setBusy(false);
    }
  };

  const openConversation = async (id: string) => {
    try {
      const msgs = await api.conversationMessages(id);
      setMessages(
        msgs.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          toolCalls: [],
          streaming: false,
        })),
      );
      setConversationId(id);
      localStorage.setItem(LAST_CONVERSATION_KEY, id);
      setHistoryOpen(false);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const newConversation = React.useCallback(() => {
    setConversationId(undefined);
    setMessages([]);
    setHistoryOpen(false);
    localStorage.removeItem(LAST_CONVERSATION_KEY);
  }, [setHistoryOpen]);

  React.useEffect(() => {
    const handleOpenChat = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      void openConversation(id);
    };
    window.addEventListener("trailin:new-chat", newConversation);
    window.addEventListener("trailin:open-chat", handleOpenChat);
    return () => {
      window.removeEventListener("trailin:new-chat", newConversation);
      window.removeEventListener("trailin:open-chat", handleOpenChat);
    };
  }, [newConversation]);

  return (
    <div className="flex h-full flex-col gap-3">

      <div className="min-h-0 flex-1 overflow-y-auto scroll-stable">
        {historyOpen ? (
          <HistoryList activeId={conversationId} onPick={(id) => void openConversation(id)} />
        ) : restoring ? (
          <LoadingRow />
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={MessagesSquare}
              size="lg"
              title={t("chat.emptyTitle")}
              description={t("chat.emptyBody")}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-4 py-1">
            {messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  "animate-in-up flex",
                  m.role === "user" ? "justify-end" : "justify-start",
                )}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm",
                    m.role === "user"
                      ? "rounded-br-md bg-primary text-primary-foreground"
                      : "rounded-bl-md bg-surface-2 text-foreground",
                  )}
                >
                  {m.toolCalls.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {m.toolCalls.map((t, i) => (
                        <Badge
                          key={`${t.name}-${i}`}
                          variant={t.isError ? "destructive" : t.done ? "success" : "muted"}
                        >
                          <Wrench className="h-3 w-3" />
                          {t.name}
                          {!t.done && <Loader2 className="h-3 w-3 animate-spin" />}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {m.content ? (
                    m.role === "assistant" ? (
                      <Markdown content={m.content} />
                    ) : (
                      <div className="whitespace-pre-wrap leading-relaxed">{m.content}</div>
                    )
                  ) : (
                    <div className="leading-relaxed">
                      {m.streaming &&
                        (m.thinking ? (
                          <span className="animate-pulse text-muted-foreground">
                            {t("chat.thinking")}
                          </span>
                        ) : (
                          "…"
                        ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="flex items-end gap-2 rounded-2xl bg-surface-2 p-1.5 pl-4">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={t("chat.placeholder")}
          rows={1}
          className="max-h-40 min-h-[36px] flex-1 resize-none overflow-y-auto bg-transparent py-2 text-sm leading-relaxed [scrollbar-width:none] [-webkit-scrollbar]:hidden placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
          disabled={busy}
        />
        <Button
          onClick={() => void send()}
          disabled={busy || !input.trim()}
          size="icon"
          className="h-8 w-8 shrink-0 rounded-xl"
          aria-label={t("chat.send")}
        >
          {busy ? <Loader2 className="animate-spin" /> : <Send />}
        </Button>
      </div>
    </div>
  );
}

/** Past conversations, newest first; fetched fresh each time it opens. */
function HistoryList({
  activeId,
  onPick,
}: {
  activeId: string | undefined;
  onPick: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [list, setList] = React.useState<Conversation[] | null>(null);

  React.useEffect(() => {
    api
      .conversations()
      .then(setList)
      .catch((err) => {
        toast.error(errorMessage(err));
        setList([]);
      });
  }, []);

  const dateLabel = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

  if (!list) return <LoadingRow />;
  if (list.length === 0) {
    return <p className="px-1 py-2 text-xs text-muted-foreground">{t("chat.noConversations")}</p>;
  }

  const chats = list.filter((c) => c.type !== "automation");
  const automations = list.filter((c) => c.type === "automation");

  const renderList = (items: Conversation[]) => (
    <div className="flex flex-col gap-1">
      {items.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onPick(c.id)}
          className={cn(
            "flex flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left transition-colors",
            c.id === activeId ? "bg-accent/12" : "hover:bg-secondary",
          )}
        >
          <span
            className={cn(
              "w-full truncate text-sm",
              c.id === activeId ? "font-medium text-accent" : "text-foreground",
            )}
          >
            {c.title || t("chat.untitled")}
          </span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {dateLabel(c.createdAt)}
          </span>
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-4 py-2 px-1">
      {chats.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="px-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("chat.chats", "Chats")}</h3>
          {renderList(chats)}
        </div>
      )}
      {automations.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="px-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("chat.automations", "Automations")}</h3>
          {renderList(automations)}
        </div>
      )}
    </div>
  );
}
