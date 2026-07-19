import type { ChatToolCall, EmailRef } from "@trailin/shared";
import type { ParseKeys } from "i18next";
import { Check, Copy, MessagesSquare, Send } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { AgentCardView } from "@/components/cards";
import { SHOWCASE_TURNS } from "@/components/cards/samples";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingRow } from "@/components/ui/feedback";
import { Highlight } from "@/components/ui/highlight";
import { Markdown } from "@/components/ui/markdown";
import { SearchField } from "@/components/ui/search-field";
import { Spinner } from "@/components/ui/spinner";
import { RefChips, RefChipsReadOnly } from "@/features/chat/composer/RefChips";
import { useComposerRefs } from "@/features/chat/composer/useComposerRefs";
import { onChatCommand } from "@/features/chat/controller";
import { HistoryList } from "@/features/chat/HistoryList";
import type { DisplayMessage } from "@/features/chat/runState";
import { useChatRuns } from "@/features/chat/useChatRuns";
import { useAccountColors } from "@/lib/accounts";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { useAutoGrow } from "@/lib/useAutoGrow";
import { cn, errorMessage } from "@/lib/utils";

/** Renders one of every agent card locally. Never reaches the agent or the DB. */
const SHOWCASE_COMMAND = "/showcase";
const SYSTEM_PROMPT_COMMAND = "/sys";

/** A message queued by a chat command, sent once the panel goes idle so it
 *  never races the reset (when requested) or a still-streaming turn. */
interface PendingSend {
  text: string;
  refs?: EmailRef[];
  /** A `send` command resets the conversation first; an `answer` (a choices-card pick) continues the open one. */
  newConversation: boolean;
}

export function ChatPanel({
  historyOpen,
  setHistoryOpen,
  layout = "panel",
  onConversationChange,
  pendingFocusAccountId,
}: {
  historyOpen: boolean;
  setHistoryOpen: React.Dispatch<React.SetStateAction<boolean>>;
  /** "panel" is the floating side-panel; "page" is the full-page Chat tab (history lives in an external rail). */
  layout?: "panel" | "page";
  /** Lets the host mirror the active conversation (e.g. to highlight it in the Chat tab's history rail). */
  onConversationChange?: (id: string | undefined) => void;
  /** Mailbox the header chip pre-selected before any conversation exists; sent with the first message. */
  pendingFocusAccountId?: string | null;
}) {
  const { t } = useTranslation();
  const [input, setInput] = React.useState("");
  // A message queued by a chat command — sent by the effect below once the
  // panel is idle, so it never races a conversation reset or a streaming turn.
  const [pendingSend, setPendingSend] = React.useState<PendingSend | null>(null);
  // Tints each card's account chip. Cosmetic, so a failed load is not surfaced.
  const { colors: accountColors } = useAccountColors({ withAccounts: false });
  // Emails pinned to the message about to be sent (a
  // card's "add to chat" action) — cleared once the turn is sent.
  const composerRefs = useComposerRefs();
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const focusComposer = React.useCallback(() => {
    textareaRef.current?.focus();
  }, []);
  const runs = useChatRuns({
    setHistoryOpen,
    onFocusComposer: focusComposer,
    pendingFocusAccountId,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs.messages is the intentional re-run trigger (a new turn or streaming delta), not read in the body
  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [runs.messages]);

  // Keep the host in sync with the open conversation (Chat tab highlights it).
  React.useEffect(() => {
    onConversationChange?.(runs.conversationId);
  }, [runs.conversationId, onConversationChange]);

  useAutoGrow(textareaRef, input);

  /** Answers `/showcase` client-side: one sample turn per thing the assistant can render. */
  const showcase = (message: string) => {
    const userMessage: DisplayMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: message,
      toolCalls: [],
      cards: [],
      streaming: false,
    };
    const turns: DisplayMessage[] = SHOWCASE_TURNS.map((turn, turnIndex) => ({
      id: crypto.randomUUID(),
      role: "assistant",
      content: turn.contentKey ? String(t(turn.contentKey as ParseKeys)) : (turn.content ?? ""),
      toolCalls: (turn.toolCalls ?? []).map((call, i) => ({
        ...call,
        id: `showcase-tool-${turnIndex}-${i}`,
      })),
      cards: (turn.cards ?? []).map((card, i) => ({
        toolCallId: `showcase-${turnIndex}-${i}`,
        card,
      })),
      streaming: turn.thinking ?? false,
      thinking: turn.thinking,
    }));
    runs.appendMessages([userMessage, ...turns]);
  };

  const showSystemPrompt = async (message: string) => {
    runs.setBusy(true);
    const userMessage: DisplayMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: message,
      toolCalls: [],
      cards: [],
      streaming: false,
    };
    const loadingMessage: DisplayMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      toolCalls: [],
      cards: [],
      streaming: true,
      thinking: true,
    };
    runs.appendMessages([userMessage, loadingMessage]);
    try {
      const { prompt } = await api.systemPrompt();
      runs.updateMessage(loadingMessage.id, {
        streaming: false,
        thinking: false,
        systemPrompt: prompt,
      });
    } catch (err) {
      const messageText = errorMessage(err);
      toast.error(err);
      runs.updateMessage(loadingMessage.id, {
        streaming: false,
        thinking: false,
        error: messageText,
      });
    } finally {
      runs.setBusy(false);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  };

  /** Sends a message in the open conversation (or starts one server-side); routes
   *  /showcase and /sys to their local, agent-free handlers instead. */
  const sendText = async (message: string, sendRefs?: EmailRef[]) => {
    if (!message || runs.busy) return;
    setHistoryOpen(false);

    if (message.toLowerCase() === SHOWCASE_COMMAND) {
      showcase(message);
      return;
    }
    if (message.toLowerCase() === SYSTEM_PROMPT_COMMAND) {
      await showSystemPrompt(message);
      return;
    }
    await runs.send(message, sendRefs);
  };

  const send = async () => {
    const message = input.trim();
    if (!message || runs.busy) return;
    setInput("");
    const sendRefs = composerRefs.refs.length > 0 ? composerRefs.refs : undefined;
    composerRefs.clear();
    await sendText(message, sendRefs);
  };

  // Deferred one render on purpose: waits for the panel to go idle (any
  // streaming turn to finish) before resetting the conversation (when
  // requested) and sending, so this can never race an in-flight turn or
  // stream into a closed-over previous conversation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (!pendingSend || runs.busy || runs.restoring) return;
    const { text, refs: sendRefs, newConversation: reset } = pendingSend;
    setPendingSend(null);
    if (reset) runs.newConversation();
    void sendText(text, sendRefs);
  });

  React.useEffect(() => {
    return onChatCommand((command) => {
      switch (command.kind) {
        case "new":
          runs.newConversation();
          return;
        case "open":
          void runs.openConversation(command.conversationId);
          return;
        // Starts a fresh conversation with the composer pre-filled (not
        // sent) — how other panels hand a suggested question to the chat.
        case "prefill":
          runs.newConversation();
          setInput(command.text);
          textareaRef.current?.focus();
          return;
        // Like prefill, but sends immediately — for actions where the
        // composed message is complete as-is (the digest's reply buttons).
        case "send":
          setPendingSend({ text: command.text, newConversation: true });
          return;
        // A choices-card option answering the agent's clarifying question —
        // sent in the SAME conversation (never resets it) so it lands as
        // the next turn of the exchange that asked the question.
        case "answer":
          setPendingSend({ text: command.text, refs: command.refs, newConversation: false });
          return;
        // A card's "add to chat" action pinning an email to the composer's
        // next message — never resets the conversation.
        case "add-ref":
          composerRefs.add(command.ref);
          textareaRef.current?.focus();
          return;
      }
    });
  }, [runs.newConversation, runs.openConversation, composerRefs.add]);

  const isPage = layout === "page";

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-3 overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto scroll-stable">
        {/* In page mode the history rail is external, so the internal toggle is inert. */}
        {!isPage && historyOpen ? (
          <HistoryList
            activeId={runs.conversationId}
            onPick={(id) => void runs.openConversation(id)}
          />
        ) : runs.restoring ? (
          <LoadingRow />
        ) : runs.messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={MessagesSquare}
              size="lg"
              title={t("chat.emptyTitle")}
              description={t("chat.emptyBody")}
            />
          </div>
        ) : (
          <div
            className={cn(
              "flex flex-col gap-4 py-1",
              isPage && "mx-auto w-full max-w-4xl @7xl:max-w-5xl",
            )}
          >
            {runs.messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  "animate-in-up flex flex-col gap-2",
                  m.role === "user" ? "items-end" : "w-full items-start",
                )}
              >
                {/* Cards sit on the chat canvas as their own outlined blocks
                    (CardShell carries the hairline), not wrapped in a bubble —
                    full-width, since tool results (threads, tables, briefings)
                    need more room than a reply bubble allows. */}
                {m.cards.length > 0 && (
                  <div className="flex w-full flex-col gap-2">
                    {m.cards.map((c) => (
                      <AgentCardView key={c.toolCallId} card={c.card} colors={accountColors} />
                    ))}
                  </div>
                )}
                {/* Pinned emails sit outside the bubble, like cards: a neutral chip
                    on the canvas rather than baked into the accent fill, so the
                    selected email reads as quiet reference, not high-contrast. */}
                {m.role === "user" && m.refs && m.refs.length > 0 && (
                  <RefChipsReadOnly refs={m.refs} colors={accountColors} />
                )}
                {(m.content ||
                  m.streaming ||
                  m.toolCalls.length > 0 ||
                  m.error ||
                  m.systemPrompt) && (
                  <div
                    className={cn(
                      "text-sm",
                      m.role === "user"
                        ? "max-w-[85%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-accent-foreground"
                        : "max-w-[85%] rounded-2xl rounded-bl-md bg-surface-2 px-4 py-2.5 text-foreground",
                    )}
                  >
                    {m.systemPrompt ? (
                      <SystemPromptView prompt={m.systemPrompt} />
                    ) : m.role === "assistant" ? (
                      <AssistantSequence message={m} thinkingLabel={t("chat.thinking")} />
                    ) : (
                      <div className="whitespace-pre-wrap leading-relaxed">{m.content}</div>
                    )}
                    {m.error && (
                      <div
                        role="alert"
                        className={cn(
                          "text-destructive",
                          (m.content || m.toolCalls.length > 0) && "mt-2",
                        )}
                      >
                        {m.error}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div
        className={cn(
          "relative flex flex-col gap-1.5 rounded-2xl bg-surface-2 p-1.5 pl-4",
          isPage && "mx-auto w-full max-w-4xl @7xl:max-w-5xl",
        )}
      >
        {composerRefs.refs.length > 0 && (
          <RefChips
            refs={composerRefs.refs}
            colors={accountColors}
            onRemove={composerRefs.remove}
          />
        )}
        <div className="flex items-end gap-2">
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
            className="max-h-40 min-h-9 flex-1 resize-none overflow-y-auto bg-transparent py-2 text-base md:text-sm leading-relaxed [scrollbar-width:none] [-webkit-scrollbar]:hidden placeholder:text-muted-foreground focus:outline-none"
            aria-busy={runs.busy}
          />
          <Button
            onClick={() => void send()}
            disabled={!input.trim()}
            loading={runs.busy}
            size="icon-sm"
            className="mb-1 shrink-0 rounded-xl"
            aria-label={t("chat.send")}
          >
            <Send className="-translate-x-px translate-y-px" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function formatToolValue(value: unknown): string {
  if (value === undefined) return "Not available";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function ToolActivity({ call }: { call: ChatToolCall }) {
  return (
    <details className="my-1 text-xs text-muted-foreground">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 py-0.5 hover:text-foreground">
        {!call.done && <Spinner className="h-3 w-3" />}
        <span title={call.name}>{call.label ?? call.name}</span>
        {call.detail && !call.done && <span className="truncate opacity-70">· {call.detail}</span>}
        {call.isError && <span className="text-destructive">· failed</span>}
      </summary>
      <div className="mt-1 space-y-2 border-l border-border pl-3">
        <div>
          <div className="mb-0.5 font-medium">Parameters</div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-2 p-2 font-mono text-2xs text-foreground">
            {formatToolValue(call.parameters)}
          </pre>
        </div>
        <div>
          <div className="mb-0.5 font-medium">Result</div>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-2 p-2 font-mono text-2xs text-foreground">
            {call.done ? formatToolValue(call.result) : "Running…"}
          </pre>
        </div>
      </div>
    </details>
  );
}

/** Keeps visible assistant prose in its actual position around tool calls. */
function AssistantSequence({
  message,
  thinkingLabel,
}: {
  message: DisplayMessage;
  thinkingLabel: string;
}) {
  const calls = [...message.toolCalls].sort(
    (a, b) => (a.contentOffset ?? 0) - (b.contentOffset ?? 0),
  );
  const parts: React.ReactNode[] = [];
  let offset = 0;
  for (let i = 0; i < calls.length; ) {
    const callOffset = Math.max(
      offset,
      Math.min(message.content.length, calls[i]?.contentOffset ?? 0),
    );
    const text = message.content.slice(offset, callOffset);
    if (text) parts.push(<Markdown key={`text-${i}`} content={text} />);
    let j = i;
    while (j < calls.length && (calls[j]?.contentOffset ?? 0) === (calls[i]?.contentOffset ?? 0)) {
      const call = calls[j];
      if (call) parts.push(<ToolActivity key={call.id} call={call} />);
      j++;
    }
    offset = callOffset;
    i = j;
  }
  const tail = message.content.slice(offset);
  if (tail) parts.push(<Markdown key="text-tail" content={tail} />);
  if (message.streaming && (message.thinking || parts.length === 0)) {
    parts.push(
      <div key="thinking" className="animate-pulse leading-relaxed text-muted-foreground">
        {thinkingLabel}
      </div>,
    );
  }
  return <>{parts}</>;
}

/** Compact inspector returned by /sys, with literal prompt text and in-place matches. */
function SystemPromptView({ prompt }: { prompt: string }) {
  const { t } = useTranslation();
  const [query, setQuery] = React.useState("");
  const [copied, setCopied] = React.useState(false);
  const normalized = query.trim().toLocaleLowerCase();
  const matchCount = normalized ? prompt.toLocaleLowerCase().split(normalized).length - 1 : 0;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <section
      className="overflow-hidden rounded-xl bg-surface-2"
      aria-label={t("chat.systemPrompt.title")}
    >
      <div className="flex flex-wrap items-center gap-2 p-2.5">
        <span className="px-1 text-xs font-semibold">{t("chat.systemPrompt.title")}</span>
        <SearchField
          size="sm"
          value={query}
          onChange={setQuery}
          placeholder={t("chat.systemPrompt.search")}
          className="ml-auto min-w-40 flex-1 sm:max-w-64"
        />
        {normalized && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {t("chat.systemPrompt.matches", { count: matchCount })}
          </span>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={() => void copy()}>
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? t("chat.systemPrompt.copied") : t("chat.systemPrompt.copy")}
        </Button>
      </div>
      <pre className="max-h-112 overflow-auto whitespace-pre-wrap break-words bg-background/55 p-4 font-mono text-xs leading-relaxed">
        <Highlight text={prompt} query={query} minLength={1} />
      </pre>
    </section>
  );
}
