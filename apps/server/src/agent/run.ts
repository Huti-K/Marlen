import type { Agent } from "@earendil-works/pi-agent-core";
import { type AssistantMessage, isRetryableAssistantError } from "@earendil-works/pi-ai";
import type { AgentCard } from "@trailin/shared";
import { moduleLogger } from "../logger.js";
import { parseAgentCard } from "./cards.js";
import { maybeCompact } from "./compaction.js";

/**
 * The slice of pino's Logger a turn needs. Spelling out the narrow shape lets
 * a route hand over `req.log.child(...)` — which Fastify types as
 * FastifyBaseLogger, not pino.Logger — without a cast.
 */
export interface TurnLogger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
}

export interface RunHandlers {
  onTextDelta?: (delta: string) => void;
  onThinking?: () => void;
  /** `toolLabel` is the tool definition's human-readable label, falling back to the name. */
  onToolStart?: (
    toolCallId: string,
    toolName: string,
    toolLabel: string,
    parameters: unknown,
  ) => void;
  /** Progress text a long-running tool streamed via its onUpdate callback (e.g. delegate's "2/5 tasks done"). */
  onToolUpdate?: (toolCallId: string, toolName: string, detail: string) => void;
  onToolEnd?: (toolCallId: string, toolName: string, isError: boolean, result: unknown) => void;
  /** Fired for a tool_execution_end whose result carries a recognizable AgentCard, before onToolEnd. */
  onCard?: (toolCallId: string, card: AgentCard) => void;
}

const defaultLog = moduleLogger("agent");

/** Turn-retry budget for transient provider failures (rate limits, 5xx, dropped streams). */
const MAX_TRANSIENT_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 2_000;

/** Provider context-overflow errors, which retry cleanly only after the transcript shrinks. */
const CONTEXT_OVERFLOW_PATTERN =
  /prompt is too long|maximum context length|context window|input token count exceeds/i;

/** True when the errored turn already streamed text the user saw — a retry would visibly repeat it. */
function streamedVisibleText(message: AssistantMessage): boolean {
  return message.content.some((block) => block.type === "text" && block.text.trim() !== "");
}

/** Abortable backoff: 2s then 6s, plus jitter, resolving early when the signal fires. */
function backoff(attempt: number, signal?: AbortSignal): Promise<void> {
  const delay = RETRY_BASE_DELAY_MS * 3 ** (attempt - 1) + Math.random() * 500;
  return new Promise((resolve) => {
    const timer = setTimeout(done, delay);
    function done(): void {
      signal?.removeEventListener("abort", done);
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener("abort", done);
  });
}

/**
 * Retries the turn when it ended in a transient provider failure that
 * produced no user-visible output. pi doesn't throw on provider errors — it
 * appends the errored assistant message to the transcript and records
 * state.errorMessage — so recovery is: classify the failure, drop the errored
 * message, and continue() from the user/toolResult tail it left behind. A
 * context-overflow failure gets one forced compaction first (the pre-turn
 * estimate has been proven wrong by the provider, so the transcript must
 * actually shrink); everything else backs off briefly. Failures that already
 * streamed visible text, aborted turns, and non-transient errors surface to
 * the caller unchanged.
 */
async function retryTransientFailures(
  agent: Agent,
  log: TurnLogger,
  signal?: AbortSignal,
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
    const failure = agent.state.errorMessage;
    if (!failure || signal?.aborted) return;
    const last = agent.state.messages[agent.state.messages.length - 1];
    if (last?.role !== "assistant") return;
    const errored = last as AssistantMessage;
    // "aborted" is the caller's own cancellation, never retried.
    if (errored.stopReason !== "error") return;
    if (streamedVisibleText(errored)) return;

    const overflow = CONTEXT_OVERFLOW_PATTERN.test(failure);
    if (!overflow && !isRetryableAssistantError(errored)) return;

    if (overflow) {
      // Compact before touching the transcript tail: when nothing can be
      // compacted, the errored message stays in place and the failure
      // surfaces as-is rather than retrying into the same overflow.
      if (!(await maybeCompact(agent, log, { force: true }))) return;
    }

    // continue() resumes from a user/toolResult tail — drop the errored
    // assistant message it re-attempts.
    agent.state.messages = agent.state.messages.slice(0, -1);

    if (!overflow) {
      await backoff(attempt, signal);
      if (signal?.aborted) return;
    }
    log.warn({ attempt, failure }, "retrying turn after transient provider failure");
    await agent.continue();
  }
}

/**
 * Run one prompt through the agent, forwarding streaming events to the
 * handlers. Resolves with the assistant's final text for this turn.
 *
 * `signal`, when given, aborts the in-flight run (streaming and any pending
 * tool calls) if it fires mid-turn — e.g. the HTTP client disconnecting.
 *
 * `log` should carry whatever identifies this turn (a conversation id, an
 * automation run id) so its tool calls can be picked out of the stream.
 */
export async function runPrompt(
  session: { agent: Agent },
  prompt: string,
  handlers: RunHandlers = {},
  signal?: AbortSignal,
  log: TurnLogger = defaultLog,
): Promise<string> {
  // Already gone before we started — don't open a turn at all.
  if (signal?.aborted) return "";

  let text = "";
  const turnStartedAt = Date.now();
  // Tool name -> display label, resolved once — the toolset is fixed for the turn.
  const toolLabels = new Map(session.agent.state.tools.map((t) => [t.name, t.label]));
  // toolCallId -> start time, so tool_execution_end can report a duration.
  const toolStarts = new Map<string, number>();
  let toolCalls = 0;
  let toolErrors = 0;

  const unsubscribe = session.agent.subscribe((event) => {
    switch (event.type) {
      case "message_update": {
        // Forward only visible text; thinking deltas keep their own type.
        const inner = event.assistantMessageEvent;
        if (inner.type === "text_delta") {
          text += inner.delta;
          handlers.onTextDelta?.(inner.delta);
        } else if (inner.type === "thinking_delta") {
          handlers.onThinking?.();
        }
        break;
      }
      case "tool_execution_start": {
        toolStarts.set(event.toolCallId, Date.now());
        handlers.onToolStart?.(
          event.toolCallId,
          event.toolName,
          toolLabels.get(event.toolName) ?? event.toolName,
          event.args,
        );
        break;
      }
      case "tool_execution_update": {
        // partialResult is a tool's streamed AgentToolResult, typed `any` by
        // pi — extract the first text block defensively.
        const partial = event.partialResult as { content?: unknown } | undefined;
        const blocks = Array.isArray(partial?.content) ? partial.content : [];
        const first = blocks[0] as { type?: string; text?: unknown } | undefined;
        if (first?.type === "text" && typeof first.text === "string" && first.text) {
          handlers.onToolUpdate?.(event.toolCallId, event.toolName, first.text);
        }
        break;
      }
      case "tool_execution_end": {
        const { toolName, toolCallId, isError } = event;
        toolCalls += 1;
        if (isError) toolErrors += 1;

        const startedAt = toolStarts.get(toolCallId);
        toolStarts.delete(toolCallId);

        // A tool's arguments and its result are the user's mail. Only the
        // tool's name, outcome and timing are ever written to the log.
        const fields = {
          tool: toolName,
          ms: startedAt === undefined ? undefined : Date.now() - startedAt,
        };
        if (isError) log.warn(fields, "tool call failed");
        else log.info(fields, "tool call");

        // event.result is the tool's raw { content, details } return, typed
        // `any` by pi — details may be malformed or absent, parseAgentCard
        // never throws.
        const result = event.result as { details?: unknown } | undefined;
        const card = parseAgentCard(result?.details);
        if (card) handlers.onCard?.(toolCallId, card);
        handlers.onToolEnd?.(toolCallId, toolName, isError, event.result);
        break;
      }
    }
  });

  // The pi Agent owns its own AbortController per run; forward the external
  // signal into it so the model stream and tool execution actually stop.
  const onAbort = () => session.agent.abort();
  signal?.addEventListener("abort", onAbort);

  try {
    // Trim the transcript in advance if it's nearing the model's context
    // window — fails open (never throws), so a compaction hiccup can't sink
    // the turn itself.
    await maybeCompact(session.agent, log);
    await session.agent.prompt(prompt);
    // Transient provider failures (rate limits, 5xx, dropped streams) are
    // retried in place while the subscription above is still attached, so a
    // successful retry streams through the same handlers.
    await retryTransientFailures(session.agent, log, signal);
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (typeof unsubscribe === "function") unsubscribe();
  }

  const durationMs = Date.now() - turnStartedAt;

  // pi doesn't throw on provider failures (missing credentials, refused
  // requests); it records them on the state. Surface them to the caller.
  const failure = session.agent.state.errorMessage;
  if (failure) {
    log.warn({ durationMs, toolCalls, toolErrors, failure }, "agent turn failed");
    throw new Error(failure);
  }

  log.info({ durationMs, toolCalls, toolErrors }, "agent turn finished");
  return text.trim();
}
