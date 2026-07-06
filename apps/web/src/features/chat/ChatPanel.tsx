import * as React from "react";
import { Loader2, MessagesSquare, Send, Wrench } from "lucide-react";
import type { ChatStreamEvent } from "@trailin/shared";
import { streamChat } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls: { name: string; isError: boolean; done: boolean }[];
  streaming: boolean;
}

const SUGGESTIONS = [
  "Summarize my unread Gmail from today",
  "Find the last email from my bank",
  "Draft a reply to the latest message from Anna",
];

export function ChatPanel() {
  const [messages, setMessages] = React.useState<DisplayMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [conversationId, setConversationId] = React.useState<string | undefined>();
  const [error, setError] = React.useState<string | null>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const useSuggestion = (text: string) => {
    setInput(text);
    textareaRef.current?.focus();
  };

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
        break;
      case "text_delta":
        updateAssistant((m) => ({ ...m, content: m.content + event.delta }));
        break;
      case "tool_start":
        updateAssistant((m) => ({
          ...m,
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
        }));
        break;
      case "error":
        setError(event.message);
        updateAssistant((m) => ({ ...m, streaming: false }));
        break;
    }
  };

  const send = async () => {
    const message = input.trim();
    if (!message || busy) return;
    setError(null);
    setInput("");
    setBusy(true);
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
      setError(err instanceof Error ? err.message : String(err));
      updateAssistant((m) => ({ ...m, streaming: false }));
    } finally {
      setBusy(false);
    }
  };

  const newConversation = () => {
    setConversationId(undefined);
    setMessages([]);
    setError(null);
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-end">
        <Button variant="outline" size="sm" onClick={newConversation} disabled={busy}>
          New conversation
        </Button>
      </div>

      <Card className="min-h-0 flex-1 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-secondary text-muted-foreground">
              <MessagesSquare className="h-6 w-6" />
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">Ask your inbox anything</p>
              <p className="max-w-sm text-pretty text-xs text-muted-foreground">
                The agent can search, label, and draft across your connected accounts. Start with
                one of these:
              </p>
            </div>
            <div className="flex max-w-md flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => useSuggestion(s)}
                  className="rounded-full border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-xs transition-colors hover:border-primary/40 hover:bg-accent hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
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
                    "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm shadow-xs",
                    m.role === "user"
                      ? "rounded-br-sm bg-primary text-primary-foreground"
                      : "rounded-bl-sm border border-border/70 bg-card text-card-foreground",
                  )}
                >
                  {m.toolCalls.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {m.toolCalls.map((t, i) => (
                        <Badge
                          key={`${t.name}-${i}`}
                          variant={t.isError ? "destructive" : t.done ? "success" : "secondary"}
                          className="gap-1"
                        >
                          <Wrench className="h-3 w-3" />
                          {t.name}
                          {!t.done && <Loader2 className="h-3 w-3 animate-spin" />}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <div className="whitespace-pre-wrap">
                    {m.content || (m.streaming ? "…" : "")}
                  </div>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </Card>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="flex items-end gap-2">
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Message your email agent… (Enter to send, Shift+Enter for newline)"
          className="min-h-[52px] resize-none"
          disabled={busy}
        />
        <Button onClick={() => void send()} disabled={busy || !input.trim()} className="h-[52px]">
          {busy ? <Loader2 className="animate-spin" /> : <Send />}
        </Button>
      </div>
    </div>
  );
}
