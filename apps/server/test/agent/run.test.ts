import type { Agent } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runPrompt, type TurnLogger } from "../../src/agent/run.js";

/**
 * Exercises runPrompt's transient-failure retry against a scripted fake
 * agent: pi records provider failures as an errored assistant message plus
 * state.errorMessage instead of throwing, and run.ts decides whether to drop
 * that message and continue(). The fake exposes exactly the surface run.ts
 * consumes (subscribe/abort/prompt/continue and state), scripted per attempt.
 */

const testLog: TurnLogger = { info: () => {}, warn: () => {} };

interface FakeState {
  errorMessage?: string;
  messages: unknown[];
  tools: { name: string; label: string }[];
  systemPrompt: string;
  model: { contextWindow: number };
}

type Attempt = (agent: RetryFakeAgent) => void;

class RetryFakeAgent {
  state: FakeState = {
    messages: [],
    tools: [],
    systemPrompt: "",
    model: { contextWindow: 200_000 },
  };
  continueCalls = 0;

  private listeners: Array<(event: unknown) => void> = [];
  private attempts: Attempt[];

  constructor(attempts: Attempt[]) {
    this.attempts = attempts;
  }

  subscribe(listener: (event: unknown) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  abort(): void {}

  emit(event: unknown): void {
    for (const listener of this.listeners) listener(event);
  }

  private runNextAttempt(): void {
    const attempt = this.attempts.shift();
    if (!attempt) throw new Error("fake agent ran out of scripted attempts");
    attempt(this);
  }

  async prompt(_text: string): Promise<void> {
    this.runNextAttempt();
  }

  async continue(): Promise<void> {
    this.continueCalls++;
    this.runNextAttempt();
  }
}

function erroredAssistant(errorMessage: string, text = ""): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "test-model",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "error",
    errorMessage,
    timestamp: Date.now(),
  };
}

function failingAttempt(errorMessage: string, text = ""): Attempt {
  return (agent) => {
    agent.state.messages.push(erroredAssistant(errorMessage, text));
    agent.state.errorMessage = errorMessage;
  };
}

function succeedingAttempt(text: string): Attempt {
  return (agent) => {
    agent.state.errorMessage = undefined;
    agent.emit({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: text },
    });
    agent.state.messages.push({ role: "assistant" });
  };
}

function session(agent: RetryFakeAgent): { agent: Agent } {
  return { agent: agent as unknown as Agent };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("runPrompt — transient-failure retry", () => {
  it("drops the errored turn, backs off, and continues after a transient provider failure", async () => {
    vi.useFakeTimers();
    const agent = new RetryFakeAgent([
      failingAttempt("503 service unavailable"),
      succeedingAttempt("recovered"),
    ]);

    const promise = runPrompt(session(agent), "hi", {}, undefined, testLog);
    await vi.advanceTimersByTimeAsync(3_000);

    expect(await promise).toBe("recovered");
    expect(agent.continueCalls).toBe(1);
    // The errored assistant message was dropped before continuing, so the
    // transcript holds only the retried turn's reply.
    expect(agent.state.messages).toHaveLength(1);
  });

  it("stops after the retry budget and surfaces the last failure", async () => {
    vi.useFakeTimers();
    const agent = new RetryFakeAgent([
      failingAttempt("overloaded"),
      failingAttempt("overloaded"),
      failingAttempt("overloaded"),
    ]);

    const promise = runPrompt(session(agent), "hi", {}, undefined, testLog);
    promise.catch(() => {}); // settled by the rejection assertion below; avoids an unhandled-rejection warning while timers advance
    await vi.advanceTimersByTimeAsync(15_000);

    await expect(promise).rejects.toThrow("overloaded");
    expect(agent.continueCalls).toBe(2);
  });

  it("does not retry non-transient failures", async () => {
    const agent = new RetryFakeAgent([failingAttempt("invalid api key")]);

    await expect(runPrompt(session(agent), "hi", {}, undefined, testLog)).rejects.toThrow(
      "invalid api key",
    );
    expect(agent.continueCalls).toBe(0);
  });

  it("does not retry once the failed turn already streamed visible text", async () => {
    const agent = new RetryFakeAgent([failingAttempt("connection lost", "partial answer…")]);

    await expect(runPrompt(session(agent), "hi", {}, undefined, testLog)).rejects.toThrow(
      "connection lost",
    );
    expect(agent.continueCalls).toBe(0);
  });

  it("surfaces a context overflow unchanged when nothing can be compacted", async () => {
    const agent = new RetryFakeAgent([
      (fake) => {
        fake.state.messages.push({ role: "user", content: "hi", timestamp: Date.now() });
        failingAttempt("prompt is too long: 250000 tokens > 200000 maximum")(fake);
      },
    ]);

    await expect(runPrompt(session(agent), "hi", {}, undefined, testLog)).rejects.toThrow(
      "prompt is too long",
    );
    // The transcript is too short for compaction to shrink, so the errored
    // message stays in place and no continuation is attempted.
    expect(agent.continueCalls).toBe(0);
    expect(agent.state.messages).toHaveLength(2);
  });
});
