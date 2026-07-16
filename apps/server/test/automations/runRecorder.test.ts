import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent } from "@earendil-works/pi-agent-core";
import type { ServerEvent } from "@trailin/shared";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { AgentSession } from "../../src/agent/emailAgent.js";
import type { RunHandlers, TurnLogger } from "../../src/agent/run.js";
import type { TurnSessions } from "../../src/agent/turnRecorder.js";

// db/index.ts runs its DDL as an import-time side effect and resolves its
// path through env.ts's DATABASE_PATH read, also at import time — same
// pattern as test/agent/turnRecorder.test.ts, point DATABASE_PATH at a
// fresh temp file before anything pulls db/index.ts in.
const tempDir = mkdtempSync(join(tmpdir(), "trailin-run-recorder-"));
const originalDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(tempDir, "test.db");

const { db, schema, closeDb } = await import("../../src/db/index.js");
const { _setSessionsForTest } = await import("../../src/agent/turnRecorder.js");
// runPrompt is pure — see test/agent/turnRecorder.test.ts's own comment on
// the same fake — safe to use for real against the scripted FakeAgent below.
const { runPrompt } = await import("../../src/agent/run.js");
const { executeAutomationRun, sweepOrphanedRuns } = await import(
  "../../src/automations/runRecorder.js"
);
const { onServerEvent } = await import("../../src/events.js");
const { eq } = await import("drizzle-orm");

afterAll(() => {
  closeDb();
  rmSync(tempDir, { recursive: true, force: true });
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
});

afterEach(() => {
  _setSessionsForTest(null);
});

/**
 * Stands in for pi's real Agent class — same shape as
 * test/agent/turnRecorder.test.ts's own fake, with one addition: abort()
 * rejects the pending prompt(), the way pi's real Agent rejects an
 * in-flight turn once it's told to abort. That lets a real
 * AbortSignal.timeout drive the timeout test below deterministically,
 * without reaching into runRecorder's internals or faking timers.
 */
class FakeAgent {
  state: { errorMessage?: string; tools: { name: string; label: string }[] } = { tools: [] };
  aborted = false;
  prompts: string[] = [];

  private listeners: Array<(event: unknown) => void> = [];
  private settle: { resolve: () => void; reject: (error: unknown) => void } | null = null;
  private promptedResolve!: () => void;

  whenPrompted: Promise<void> = new Promise((resolve) => {
    this.promptedResolve = resolve;
  });

  subscribe(listener: (event: unknown) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  abort(): void {
    this.aborted = true;
    this.settle?.reject(new Error("aborted"));
  }

  emit(event: unknown): void {
    for (const listener of this.listeners) listener(event);
  }

  async prompt(text: string): Promise<void> {
    this.prompts.push(text);
    return new Promise<void>((resolve, reject) => {
      this.settle = { resolve, reject };
      this.promptedResolve();
    });
  }

  resolveTurn(): void {
    this.settle?.resolve();
  }

  rejectTurn(error: unknown): void {
    this.settle?.reject(error);
  }
}

/** A fake AgentSession wired the same way emailAgent.ts's createAgentSession wires a real one. */
function fakeSession(agent: FakeAgent): AgentSession {
  const session: AgentSession = {
    agent: agent as unknown as Agent,
    toolset: { tools: [], readTools: [], close: async () => {} },
    inFlight: 0,
    lastUsed: Date.now(),
    async runTurn(prompt: string, handlers?: RunHandlers, signal?: AbortSignal, log?: TurnLogger) {
      session.inFlight++;
      try {
        return await runPrompt(session, prompt, handlers, signal, log);
      } finally {
        session.inFlight--;
        session.lastUsed = Date.now();
      }
    },
  };
  return session;
}

function neverPooled(): Promise<AgentSession> {
  return Promise.reject(new Error("pooled session not expected for an automation run"));
}

function sessionsFor(agent: FakeAgent): TurnSessions {
  return { pooled: neverPooled, ephemeral: async () => fakeSession(agent) };
}

async function insertAutomation(
  overrides: Partial<{
    enabled: boolean;
    schedule: string;
    name: string;
    instruction: string;
    notifyOnCompletion: boolean;
  }> = {},
): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.automations).values({
    id,
    name: overrides.name ?? "Daily digest",
    instruction: overrides.instruction ?? "Summarize the inbox",
    schedule: overrides.schedule ?? "0 6 * * *",
    enabled: overrides.enabled ?? true,
    showInActivity: true,
    pinned: false,
    notifyOnCompletion: overrides.notifyOnCompletion ?? false,
    createdAt: new Date().toISOString(),
  });
  return id;
}

/** Collect every "notification" event the run under test emits; callers must unsubscribe. */
function captureNotifications(): { events: ServerEvent[]; unsubscribe: () => void } {
  const events: ServerEvent[] = [];
  const unsubscribe = onServerEvent((event) => {
    if (event.topic === "notification") events.push(event);
  });
  return { events, unsubscribe };
}

async function latestRunFor(automationId: string) {
  const [row] = await db
    .select()
    .from(schema.automationRuns)
    .where(eq(schema.automationRuns.automationId, automationId));
  return row;
}

describe("executeAutomationRun", () => {
  it("records a successful run and mirrors it into a Conversation", async () => {
    const automationId = await insertAutomation({ name: "Weekly review" });
    const agent = new FakeAgent();
    _setSessionsForTest(sessionsFor(agent));

    const resultPromise = executeAutomationRun(automationId);
    await agent.whenPrompted;
    agent.emit({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "All caught up." },
    });
    agent.resolveTurn();

    const result = await resultPromise;
    expect(result).toEqual({ started: true, succeeded: true, schedule: "0 6 * * *" });

    const run = await latestRunFor(automationId);
    expect(run?.status).toBe("success");
    expect(run?.result).toBe("All caught up.");
    expect(run?.finishedAt).toBeTruthy();

    const runId = run?.id as string;
    const [conversation] = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, runId));
    expect(conversation?.type).toBe("automation");
    expect(conversation?.title).toBe("Run: Weekly review");

    const messages = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, runId))
      .orderBy(schema.messages.createdAt);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("user");
    expect(messages[1]?.role).toBe("assistant");
    expect(messages[1]?.content).toBe("All caught up.");
  });

  it("records a failed run and reports it as not succeeded", async () => {
    const automationId = await insertAutomation();
    const agent = new FakeAgent();
    _setSessionsForTest(sessionsFor(agent));

    const resultPromise = executeAutomationRun(automationId);
    await agent.whenPrompted;
    agent.rejectTurn(new Error("model exploded"));

    const result = await resultPromise;
    expect(result.started).toBe(true);
    expect(result.succeeded).toBe(false);

    const run = await latestRunFor(automationId);
    expect(run?.status).toBe("error");
    expect(run?.result).toContain("model exploded");
  });

  it("times out a run that exceeds its deadline and records a timeout message", async () => {
    const automationId = await insertAutomation();
    const agent = new FakeAgent();
    _setSessionsForTest(sessionsFor(agent));

    // A short real deadline — the FakeAgent's abort() rejects the pending
    // prompt() once the signal fires, the same way pi's real Agent would.
    const result = await executeAutomationRun(automationId, { timeoutMs: 40 });

    expect(result.started).toBe(true);
    expect(result.succeeded).toBe(false);

    const run = await latestRunFor(automationId);
    expect(run?.status).toBe("error");
    expect(run?.result).toContain("time limit");
  });

  it("skips a disabled automation on a scheduled tick, but runs it when triggered manually", async () => {
    const automationId = await insertAutomation({ enabled: false });

    const skipped = await executeAutomationRun(automationId);
    expect(skipped).toEqual({ started: false, succeeded: false });
    expect(await latestRunFor(automationId)).toBeUndefined();

    const agent = new FakeAgent();
    _setSessionsForTest(sessionsFor(agent));
    const resultPromise = executeAutomationRun(automationId, { manual: true });
    await agent.whenPrompted;
    agent.resolveTurn();

    const result = await resultPromise;
    expect(result.started).toBe(true);
  });

  it("reports started:false for an automation id that doesn't exist, and creates no run row", async () => {
    const missingId = randomUUID();
    const result = await executeAutomationRun(missingId);
    expect(result).toEqual({ started: false, succeeded: false });
    expect(await latestRunFor(missingId)).toBeUndefined();
  });
});

describe("executeAutomationRun — completion notifications", () => {
  it("emits a notification event after a successful run when the flag is set", async () => {
    const automationId = await insertAutomation({ name: "Notify me", notifyOnCompletion: true });
    const agent = new FakeAgent();
    _setSessionsForTest(sessionsFor(agent));
    const { events, unsubscribe } = captureNotifications();
    try {
      const resultPromise = executeAutomationRun(automationId);
      await agent.whenPrompted;
      agent.emit({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "First line.\nSecond line." },
      });
      agent.resolveTurn();
      await resultPromise;
    } finally {
      unsubscribe();
    }

    const run = await latestRunFor(automationId);
    expect(events).toEqual([
      {
        topic: "notification",
        notification: {
          runId: run?.id,
          automationId,
          automationName: "Notify me",
          status: "success",
          summary: "First line.",
        },
      },
    ]);
  });

  it("emits an error notification after a failed run when the flag is set", async () => {
    const automationId = await insertAutomation({ notifyOnCompletion: true });
    const agent = new FakeAgent();
    _setSessionsForTest(sessionsFor(agent));
    const { events, unsubscribe } = captureNotifications();
    try {
      const resultPromise = executeAutomationRun(automationId);
      await agent.whenPrompted;
      agent.rejectTurn(new Error("model exploded"));
      await resultPromise;
    } finally {
      unsubscribe();
    }

    expect(events).toHaveLength(1);
    expect(events[0]?.notification).toMatchObject({
      automationId,
      status: "error",
      summary: expect.stringContaining("model exploded"),
    });
  });

  it("truncates the summary to the first line's leading 140 characters", async () => {
    const automationId = await insertAutomation({ notifyOnCompletion: true });
    const agent = new FakeAgent();
    _setSessionsForTest(sessionsFor(agent));
    const { events, unsubscribe } = captureNotifications();
    try {
      const resultPromise = executeAutomationRun(automationId);
      await agent.whenPrompted;
      agent.emit({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: `${"x".repeat(200)}\nsecond line` },
      });
      agent.resolveTurn();
      await resultPromise;
    } finally {
      unsubscribe();
    }

    expect(events[0]?.notification?.summary).toBe("x".repeat(140));
  });

  it("emits nothing when the flag is off", async () => {
    const automationId = await insertAutomation();
    const agent = new FakeAgent();
    _setSessionsForTest(sessionsFor(agent));
    const { events, unsubscribe } = captureNotifications();
    try {
      const resultPromise = executeAutomationRun(automationId);
      await agent.whenPrompted;
      agent.emit({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "All caught up." },
      });
      agent.resolveTurn();
      await resultPromise;
    } finally {
      unsubscribe();
    }

    expect(events).toEqual([]);
  });
});

describe("sweepOrphanedRuns", () => {
  it("marks a run still 'running' at boot as an error", async () => {
    const automationId = await insertAutomation();
    const runId = randomUUID();
    await db.insert(schema.automationRuns).values({
      id: runId,
      automationId,
      status: "running",
      result: "",
      startedAt: new Date().toISOString(),
    });

    await sweepOrphanedRuns();

    const [run] = await db
      .select()
      .from(schema.automationRuns)
      .where(eq(schema.automationRuns.id, runId));
    expect(run?.status).toBe("error");
    expect(run?.result).toContain("Interrupted by a server restart");
    expect(run?.finishedAt).toBeTruthy();
  });

  it("leaves an already-finished run untouched", async () => {
    const automationId = await insertAutomation();
    const runId = randomUUID();
    await db.insert(schema.automationRuns).values({
      id: runId,
      automationId,
      status: "success",
      result: "done",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    });

    await sweepOrphanedRuns();

    const [run] = await db
      .select()
      .from(schema.automationRuns)
      .where(eq(schema.automationRuns.id, runId));
    expect(run?.status).toBe("success");
    expect(run?.result).toBe("done");
  });
});
