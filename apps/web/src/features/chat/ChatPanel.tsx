import type { ChatToolCall, EmailRef } from "@marlen/shared";
import type { ParseKeys } from "i18next";
import { Check, Copy, Send, X } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { AgentCardView } from "@/components/cards";
import { Button } from "@/components/ui/button";
import { DisclosureToggle } from "@/components/ui/disclosure-toggle";
import { LoadingRow } from "@/components/ui/feedback";
import { Highlight } from "@/components/ui/highlight";
import { Markdown } from "@/components/ui/markdown";
import { SearchField } from "@/components/ui/search-field";
import { Spinner } from "@/components/ui/spinner";
import { AgentAvatar } from "@/features/chat/AgentAvatar";
import { RefChips } from "@/features/chat/composer/RefChips";
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

  // The canvas answers the agent: while a turn is live, `data-agent-busy` on
  // <html> makes the ambient aurora breathe (index.css). Set here because this
  // is the one persistent chat instance, so no route change can strand it.
  React.useEffect(() => {
    document.documentElement.toggleAttribute("data-agent-busy", runs.busy);
    return () => document.documentElement.removeAttribute("data-agent-busy");
  }, [runs.busy]);

  // Keep the host in sync with the open conversation (Chat tab highlights it).
  React.useEffect(() => {
    onConversationChange?.(runs.conversationId);
  }, [runs.conversationId, onConversationChange]);

  useAutoGrow(textareaRef, input);

  /** Answers `/showcase` client-side: one sample turn per thing the assistant can
   *  render. Dev-only, and the fixtures load dynamically so they stay out of the
   *  production bundle. */
  const showcase = async (message: string) => {
    const { SHOWCASE_TURNS } = await import("@/components/cards/samples");
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

    if (import.meta.env.DEV && message.toLowerCase() === SHOWCASE_COMMAND) {
      await showcase(message);
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
            {/* The assistant's presence, not a generic "nothing here": the
                avatar sits lit and breathing, waiting to be spoken to. */}
            <div className="flex flex-col items-center gap-3 text-center">
              <AgentAvatar size="lg" active />
              <div className="flex flex-col gap-1.5">
                <p className="text-base font-semibold tracking-tight">{t("chat.emptyTitle")}</p>
                <p className="max-w-sm text-pretty text-sm text-muted-foreground">
                  {t("chat.emptyBody")}
                </p>
              </div>
            </div>
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
                    (CardShell carries the hairline), full-width like the
                    assistant's prose. */}
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
                  <RefChips refs={m.refs} colors={accountColors} />
                )}
                {(m.content ||
                  m.streaming ||
                  m.toolCalls.length > 0 ||
                  m.error ||
                  m.systemPrompt) && (
                  <div
                    className={cn(
                      "flex w-full gap-2",
                      m.role === "user" ? "justify-end" : "flex-col gap-1.5",
                    )}
                  >
                    {/* The avatar tops the turn; its bloom lights while this
                        turn is still streaming. */}
                    {m.role === "assistant" && <AgentAvatar active={m.streaming} />}
                    <div
                      className={cn(
                        "text-sm",
                        m.role === "user"
                          ? "bubble-accent max-w-[85%] rounded-2xl rounded-br-md px-4 py-2.5 text-accent-foreground"
                          : "min-w-0 text-foreground",
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

function formatToolValue(value: unknown, unavailable: string): string {
  if (value === undefined) return unavailable;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Live elapsed readout for a running tool; freezes where it stands when the
 * call completes. Renders nothing for calls restored already-done, where the
 * start time is unknown.
 */
function ToolTimer({ done }: { done: boolean }) {
  const start = React.useRef(performance.now());
  const restored = React.useRef(done);
  const [elapsedMs, setElapsedMs] = React.useState(0);
  React.useEffect(() => {
    if (restored.current || done) return;
    const id = window.setInterval(() => setElapsedMs(performance.now() - start.current), 100);
    return () => window.clearInterval(id);
  }, [done]);
  if (restored.current) return null;
  return (
    <span className="ml-auto shrink-0 pl-2 font-mono text-2xs tabular-nums text-muted-foreground/70">
      {(elapsedMs / 1000).toFixed(1)}s
    </span>
  );
}

function ToolActivity({ call }: { call: ChatToolCall }) {
  const { t } = useTranslation();
  return (
    <details className="animate-in-up my-1 text-xs text-muted-foreground">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 py-0.5 hover:text-foreground">
        {!call.done ? (
          <Spinner className="h-3 w-3" />
        ) : call.isError ? (
          <X className="check-pop h-3 w-3 shrink-0 text-destructive" strokeWidth={3} />
        ) : (
          <Check className="check-pop h-3 w-3 shrink-0 text-success" strokeWidth={3} />
        )}
        <span className={cn("truncate", !call.done && "text-shimmer")} title={call.name}>
          {call.label ?? call.name}
        </span>
        {call.detail && !call.done && <span className="truncate opacity-70">· {call.detail}</span>}
        {call.isError && (
          <span className="shrink-0 text-destructive">· {t("chat.tool.failed")}</span>
        )}
        <ToolTimer done={call.done} />
      </summary>
      <div className="mt-1 space-y-2 border-l border-border pl-3">
        <div>
          <div className="mb-0.5 font-medium">{t("chat.tool.parameters")}</div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-2 p-2 font-mono text-2xs text-foreground">
            {formatToolValue(call.parameters, t("chat.tool.noValue"))}
          </pre>
        </div>
        <div>
          <div className="mb-0.5 font-medium">{t("chat.tool.result")}</div>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-2 p-2 font-mono text-2xs text-foreground">
            {call.done
              ? formatToolValue(call.result, t("chat.tool.noValue"))
              : t("chat.tool.running")}
          </pre>
        </div>
      </div>
    </details>
  );
}

/** A closed cluster this long folds into a step-count summary line. */
const CLUSTER_COLLAPSE_MIN = 4;

/**
 * One contiguous run of tool calls with no prose between them. While the run
 * is live the steps stay visible and tick off one by one; once the cluster is
 * `closed` (prose follows it, or the turn is over) a long fully-finished
 * cluster folds into a step-count line so past work reads as one quiet
 * summary instead of a wall of rows.
 */
function ToolCluster({ calls, closed }: { calls: ChatToolCall[]; closed: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const collapsible = closed && calls.length >= CLUSTER_COLLAPSE_MIN && calls.every((c) => c.done);
  if (!collapsible) {
    return (
      <>
        {calls.map((c) => (
          <ToolActivity key={c.id} call={c} />
        ))}
      </>
    );
  }
  const failed = calls.filter((c) => c.isError).length;
  return (
    <div className="my-1">
      <DisclosureToggle
        open={open}
        onToggle={() => setOpen((o) => !o)}
        className="animate-in-up py-0.5"
      >
        {t("chat.tool.steps", { count: calls.length })}
        {failed > 0 && (
          <span className="text-destructive">
            · {t("chat.tool.stepsFailed", { count: failed })}
          </span>
        )}
      </DisclosureToggle>
      {open && calls.map((c) => <ToolActivity key={c.id} call={c} />)}
    </div>
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
  // Prose-separated clusters: a call with no text since the previous one joins
  // the previous cluster. Keyed by the first call's id — stable while the
  // stream appends calls and text.
  const groups: { key: string; text: string; calls: ChatToolCall[] }[] = [];
  let offset = 0;
  for (const call of calls) {
    const callOffset = Math.max(offset, Math.min(message.content.length, call.contentOffset ?? 0));
    const text = message.content.slice(offset, callOffset);
    const last = groups[groups.length - 1];
    if (last && !text) last.calls.push(call);
    else groups.push({ key: call.id, text, calls: [call] });
    offset = callOffset;
  }
  const tail = message.content.slice(offset);
  const parts: React.ReactNode[] = groups.flatMap((group, i) => [
    group.text ? <Markdown key={`text-${group.key}`} content={group.text} /> : null,
    <ToolCluster
      key={`calls-${group.key}`}
      calls={group.calls}
      closed={!message.streaming || i < groups.length - 1 || tail.length > 0}
    />,
  ]);
  if (tail) parts.push(<Markdown key="text-tail" content={tail} stream={message.streaming} />);
  if (message.streaming && (message.thinking || parts.length === 0)) {
    parts.push(
      <div key="thinking" className="text-shimmer leading-relaxed">
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
