import type { ChatStreamEvent } from "@trailin/shared";
import { describe, expect, it } from "vitest";
import {
  createInitialRunState,
  type DisplayMessage,
  type RunState,
  reduceRunEvent,
} from "@/features/chat/runState";

function userMessage(id: string, content: string): DisplayMessage {
  return { id, role: "user", content, toolCalls: [], cards: [], streaming: false };
}

function assistantPlaceholder(id: string): DisplayMessage {
  return { id, role: "assistant", content: "", toolCalls: [], cards: [], streaming: true };
}

/** Applies a run's events to a state in order, as the streamChat callback would. */
function stream(state: RunState, runId: string, events: ChatStreamEvent[]): RunState {
  return events.reduce((s, event) => reduceRunEvent(s, { type: "stream", runId, event }), state);
}

/** Starts a run in `state`, returning the run id alongside the resulting state. */
function startRun(state: RunState, userText: string): { state: RunState; runId: string } {
  const runId = `run-${userText}`;
  const next = reduceRunEvent(state, {
    type: "start-run",
    runId,
    userMessage: userMessage(`u-${runId}`, userText),
    assistantMessage: assistantPlaceholder(`a-${runId}`),
  });
  return { state: next, runId };
}

describe("reduceRunEvent", () => {
  it("runs a full happy-path turn: start, deltas, a card, then done", () => {
    let state = createInitialRunState();
    const { state: started, runId } = startRun(state, "hello");
    state = started;

    expect(state.messages).toHaveLength(2);
    expect(state.busy).toBe(true);
    expect(state.activeRunId).toBe(runId);

    state = stream(state, runId, [
      { type: "conversation", conversationId: "conv-1" },
      { type: "thinking" },
      { type: "text_delta", delta: "Hi " },
      { type: "text_delta", delta: "there" },
      {
        type: "tool_start",
        toolCallId: "call-1",
        toolName: "search_mail",
        toolLabel: "Search mail",
        parameters: { q: "invoice" },
        contentOffset: 0,
      },
      { type: "tool_update", toolCallId: "call-1", toolName: "search_mail", detail: "1/2" },
      {
        type: "tool_end",
        toolCallId: "call-1",
        toolName: "search_mail",
        isError: false,
        result: [],
      },
      { type: "card", toolCallId: "call-1", card: { kind: "attachments", items: [] } },
      { type: "done", text: "Hi there" },
    ]);

    expect(state.activeConversationId).toBe("conv-1");
    const assistant = state.messages[1];
    expect(assistant?.content).toBe("Hi there");
    expect(assistant?.streaming).toBe(false);
    expect(assistant?.thinking).toBe(false);
    expect(assistant?.toolCalls).toEqual([
      {
        id: "call-1",
        name: "search_mail",
        label: "Search mail",
        isError: false,
        done: true,
        detail: "1/2",
        parameters: { q: "invoice" },
        result: [],
        contentOffset: 0,
      },
    ]);
    expect(assistant?.cards).toEqual([
      { toolCallId: "call-1", card: { kind: "attachments", items: [] } },
    ]);
    // messageCache reflects the same conversation state, keyed by its id.
    expect(state.messageCache["conv-1"]).toEqual(state.messages);

    state = reduceRunEvent(state, { type: "run-settled", runId });
    expect(state.busy).toBe(false);
    expect(state.activeRunId).toBeUndefined();
    expect(state.runs[runId]).toBeUndefined();
    expect(state.runIdByConversation["conv-1"]).toBeUndefined();
    // The turn's content survives settling.
    expect(state.messages[1]?.content).toBe("Hi there");
  });

  it("replaces a card by toolCallId instead of appending a duplicate", () => {
    let state = createInitialRunState();
    const { state: started, runId } = startRun(state, "search");
    state = started;

    state = stream(state, runId, [
      {
        type: "card",
        toolCallId: "call-1",
        card: { kind: "attachments", items: [], subject: "first" },
      },
      {
        type: "card",
        toolCallId: "call-1",
        card: { kind: "attachments", items: [], subject: "second" },
      },
    ]);

    expect(state.messages[1]?.cards).toEqual([
      { toolCallId: "call-1", card: { kind: "attachments", items: [], subject: "second" } },
    ]);
  });

  it("keeps a backgrounded conversation's events out of what the panel shows, but still caches them", () => {
    let state = createInitialRunState();
    // Both conversations already have a loaded/cached history, as if visited earlier this session.
    state = reduceRunEvent(state, { type: "open-conversation", conversationId: "conv-b" });
    state = reduceRunEvent(state, {
      type: "open-conversation-loaded",
      conversationId: "conv-b",
      messages: [userMessage("b0", "conv-b history")],
    });
    state = reduceRunEvent(state, { type: "open-conversation", conversationId: "conv-a" });
    state = reduceRunEvent(state, {
      type: "open-conversation-loaded",
      conversationId: "conv-a",
      messages: [userMessage("a0", "conv-a history")],
    });

    // Continue conv-a: send a turn, and the server confirms the same conversation id.
    const { state: afterStart, runId } = startRun(state, "new question");
    state = afterStart;
    state = stream(state, runId, [{ type: "conversation", conversationId: "conv-a" }]);
    expect(state.activeConversationId).toBe("conv-a");
    expect(state.runIdByConversation["conv-a"]).toBe(runId);

    // User switches to conv-b (already cached) while conv-a's turn is still streaming.
    state = reduceRunEvent(state, { type: "open-conversation", conversationId: "conv-b" });
    expect(state.activeConversationId).toBe("conv-b");
    expect(state.activeRunId).toBeUndefined();
    expect(state.busy).toBe(false);
    const visibleBeforeBackgroundEvents = state.messages;
    expect(visibleBeforeBackgroundEvents[0]?.content).toBe("conv-b history");

    // The backgrounded run keeps streaming; none of it should reach the visible messages.
    state = stream(state, runId, [
      { type: "text_delta", delta: "answer" },
      { type: "done", text: "answer" },
    ]);
    expect(state.messages).toBe(visibleBeforeBackgroundEvents);
    // But its own conversation's cache did update, so reopening it would see the finished turn.
    expect(state.messageCache["conv-a"]?.[2]?.content).toBe("answer");
    expect(state.runs[runId]?.messages[2]?.content).toBe("answer");

    // Settle, then reopen conv-a: no longer live, and shows the finished turn from cache.
    state = reduceRunEvent(state, { type: "run-settled", runId });
    state = reduceRunEvent(state, { type: "open-conversation", conversationId: "conv-a" });
    expect(state.busy).toBe(false);
    expect(state.activeRunId).toBeUndefined();
    expect(state.messages).toEqual(state.messageCache["conv-a"]);
    expect(state.messages[2]?.content).toBe("answer");
  });

  it("surfaces an in-band error event on the streaming message without ending the run map early", () => {
    let state = createInitialRunState();
    const { state: started, runId } = startRun(state, "oops");
    state = started;

    state = stream(state, runId, [{ type: "error", message: "Model unavailable" }]);
    expect(state.messages[1]).toMatchObject({
      error: "Model unavailable",
      streaming: false,
      thinking: false,
    });
    // The transport itself didn't fail — settling is still a separate step.
    expect(state.runs[runId]).toBeDefined();

    state = reduceRunEvent(state, { type: "run-settled", runId });
    expect(state.busy).toBe(false);
    expect(state.messages[1]?.error).toBe("Model unavailable");
  });

  it("surfaces a transport failure (thrown fetch/stream error) the same way an in-band error does", () => {
    let state = createInitialRunState();
    const { state: started, runId } = startRun(state, "flaky");
    state = started;

    state = reduceRunEvent(state, { type: "run-error", runId, message: "Network error" });
    expect(state.messages[1]).toMatchObject({ error: "Network error", streaming: false });

    state = reduceRunEvent(state, { type: "run-settled", runId });
    expect(state.busy).toBe(false);
    expect(state.activeRunId).toBeUndefined();
  });

  it("abandoning a run (new-conversation mid-stream) drops it from the visible slate without losing its own buffer", () => {
    let state = createInitialRunState();
    const { state: started, runId } = startRun(state, "will be abandoned");
    state = started;
    state = stream(state, runId, [{ type: "conversation", conversationId: "conv-x" }]);

    state = reduceRunEvent(state, { type: "new-conversation" });
    expect(state.messages).toEqual([]);
    expect(state.activeConversationId).toBeUndefined();
    expect(state.busy).toBe(false);

    // The run keeps writing into its own buffer/cache; it just isn't shown anymore.
    state = stream(state, runId, [{ type: "done", text: "finished after being abandoned" }]);
    expect(state.messages).toEqual([]);
    expect(state.messageCache["conv-x"]?.[1]?.content).toBe("finished after being abandoned");

    // Settling an already-abandoned run must not disturb the (now unrelated) busy/activeRunId.
    const { state: newRunStarted, runId: newRunId } = startRun(state, "the actual next turn");
    state = newRunStarted;
    state = reduceRunEvent(state, { type: "run-settled", runId });
    expect(state.busy).toBe(true); // the new run is still active
    expect(state.activeRunId).toBe(newRunId);
  });

  it("restores the last conversation on boot, or just clears restoring when there was nothing to restore", () => {
    const withNothing = reduceRunEvent(createInitialRunState(), { type: "restore", result: null });
    expect(withNothing.restoring).toBe(false);
    expect(withNothing.messages).toEqual([]);
    expect(withNothing.activeConversationId).toBeUndefined();

    const restored = reduceRunEvent(createInitialRunState(), {
      type: "restore",
      result: { conversationId: "conv-restored", messages: [userMessage("u1", "hi")] },
    });
    expect(restored.restoring).toBe(false);
    expect(restored.activeConversationId).toBe("conv-restored");
    expect(restored.messages).toEqual([userMessage("u1", "hi")]);
    expect(restored.messageCache["conv-restored"]).toEqual(restored.messages);
  });

  it("ignores a stale open-conversation-loaded once the user has moved on to another conversation", () => {
    let state = createInitialRunState();
    state = reduceRunEvent(state, { type: "open-conversation", conversationId: "conv-a" });
    state = reduceRunEvent(state, { type: "open-conversation", conversationId: "conv-b" });
    const beforeStaleLoad = state;

    state = reduceRunEvent(state, {
      type: "open-conversation-loaded",
      conversationId: "conv-a",
      messages: [userMessage("stale", "should not appear")],
    });
    expect(state).toBe(beforeStaleLoad);
  });

  it("supports the local (non-streamed) /sys and /showcase turns via append/update, gated by an explicit busy flag", () => {
    let state = createInitialRunState();
    state = reduceRunEvent(state, { type: "set-busy", busy: true });
    expect(state.busy).toBe(true);
    expect(state.activeRunId).toBeUndefined(); // no run backs a local turn

    state = reduceRunEvent(state, {
      type: "append-messages",
      messages: [userMessage("u-sys", "/sys"), assistantPlaceholder("a-sys")],
    });
    expect(state.messages).toHaveLength(2);

    state = reduceRunEvent(state, {
      type: "update-message",
      id: "a-sys",
      patch: { streaming: false, thinking: false, systemPrompt: "prompt text" },
    });
    expect(state.messages[1]).toMatchObject({ streaming: false, systemPrompt: "prompt text" });

    state = reduceRunEvent(state, { type: "set-busy", busy: false });
    expect(state.busy).toBe(false);
  });
});
