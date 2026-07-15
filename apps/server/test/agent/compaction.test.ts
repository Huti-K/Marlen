import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

// compactedMessages hands the dropped prefix to a one-shot summarizer model
// (oneShot.ts → the live model registry); stub it at the module boundary so
// the compaction pipeline runs for real with a canned brief.
const runOneShotMock = vi.fn<() => Promise<string>>();
vi.mock("../../src/agent/oneShot.js", () => ({
  runOneShot: () => runOneShotMock(),
}));

const { compactedMessages, findCutIndex, KEEP_RECENT_TOKENS } = await import(
  "../../src/agent/compaction.js"
);

// estimateTokens (pi-agent-core) is a plain chars/4 heuristic per role, so
// fixtures below use char counts that are multiples of 4 for exact,
// rounding-free token counts.

function userMessage(chars: number, timestamp: number): AgentMessage {
  return { role: "user", content: "x".repeat(chars), timestamp };
}

function assistantMessage(chars: number, timestamp: number): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: "x".repeat(chars) }],
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
    stopReason: "stop",
    timestamp,
  };
}

function toolResultMessage(chars: number, timestamp: number): AgentMessage {
  return {
    role: "toolResult",
    toolCallId: `call-${timestamp}`,
    toolName: "test-tool",
    content: [{ type: "text", text: "x".repeat(chars) }],
    isError: false,
    timestamp,
  };
}

describe("findCutIndex", () => {
  it("returns 0 for an empty transcript", () => {
    expect(findCutIndex([])).toBe(0);
  });

  it("returns 0 (nothing to compact) when the whole transcript fits within KEEP_RECENT_TOKENS", () => {
    const messages = [
      userMessage(40, 1),
      assistantMessage(40, 2),
      userMessage(40, 3),
      assistantMessage(40, 4),
    ];
    expect(findCutIndex(messages)).toBe(0);
  });

  it("steps the cut back one message when the raw token cut lands on a single toolResult", () => {
    // 19,995 recent tokens (message 3) + a 10-token toolResult (message 2)
    // crosses KEEP_RECENT_TOKENS (20,000) right after message 2 is folded
    // in, so the raw cut lands on that toolResult; the walk-back must move
    // it to the preceding assistant message that issued the tool call.
    const messages = [
      userMessage(40, 1), // dropped filler
      assistantMessage(40, 2), // issues the tool call
      toolResultMessage(40, 3),
      userMessage(79_980, 4), // recent: 19,995 tokens
    ];

    expect(findCutIndex(messages)).toBe(1);
    expect(messages[1]?.role).toBe("assistant");
  });

  it("walks the cut back over a whole run of toolResult messages so it never opens mid-tool-call", () => {
    // Same shape, but with three toolResults in a row — the raw cut lands on
    // the middle one, and the walk-back must skip all three, not just one.
    const messages = [
      userMessage(200, 1), // dropped filler
      userMessage(200, 2), // dropped filler
      assistantMessage(40, 3), // issues three tool calls
      toolResultMessage(40, 4),
      toolResultMessage(40, 5),
      toolResultMessage(40, 6),
      userMessage(79_980, 7), // recent: 19,995 tokens
    ];

    const cutIndex = findCutIndex(messages);

    expect(cutIndex).toBe(2);
    expect(messages[cutIndex]?.role).not.toBe("toolResult");
    // The whole tool-call batch stays together with the assistant turn that issued it.
    expect(messages.slice(cutIndex).map((m) => m.role)).toEqual([
      "assistant",
      "toolResult",
      "toolResult",
      "toolResult",
      "user",
    ]);
    // And the dropped prefix never includes a bare toolResult either.
    expect(messages.slice(0, cutIndex).some((m) => m.role === "toolResult")).toBe(false);
  });

  it("keeps KEEP_RECENT_TOKENS as the trigger this test suite is pinned to", () => {
    // Guards against a silent threshold change invalidating the char counts above.
    expect(KEEP_RECENT_TOKENS).toBe(20_000);
  });
});

describe("compactedMessages", () => {
  const quietLog = { info: () => {}, warn: () => {} };

  // Ten 4,000-token user messages: findCutIndex keeps the last five (~20k
  // tokens) verbatim and leaves a five-message prefix, comfortably over
  // MIN_PREFIX_MESSAGES, for the summarizer.
  function transcript(): AgentMessage[] {
    return Array.from({ length: 10 }, (_, i) => userMessage(16_000, i + 1));
  }

  beforeEach(() => {
    runOneShotMock.mockReset();
  });

  it("returns null under the trigger fraction without calling the summarizer", async () => {
    runOneShotMock.mockResolvedValue("BRIEF");

    const result = await compactedMessages(
      { systemPrompt: "", model: { contextWindow: 1_000_000 }, messages: transcript() },
      quietLog,
    );

    expect(result).toBeNull();
    expect(runOneShotMock).not.toHaveBeenCalled();
  });

  it("replaces the prefix with one summary message and keeps the recent tail verbatim", async () => {
    runOneShotMock.mockResolvedValue("BRIEF");
    const messages = transcript();

    const result = await compactedMessages(
      { systemPrompt: "", model: { contextWindow: 1_000_000 }, messages },
      quietLog,
      { force: true },
    );

    expect(result).toHaveLength(6);
    const summary = result?.[0];
    expect(summary?.role).toBe("user");
    expect(summary && "content" in summary ? summary.content : "").toContain("BRIEF");
    expect(result?.slice(1)).toEqual(messages.slice(5));
  });

  it("fails open when the summarizer returns nothing or throws", async () => {
    const state = {
      systemPrompt: "",
      model: { contextWindow: 1_000_000 },
      messages: transcript(),
    };

    runOneShotMock.mockResolvedValue("");
    expect(await compactedMessages(state, quietLog, { force: true })).toBeNull();

    runOneShotMock.mockRejectedValue(new Error("model down"));
    expect(await compactedMessages(state, quietLog, { force: true })).toBeNull();
  });
});
