import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent } from "@earendil-works/pi-agent-core";
import type { EmailRef } from "@trailin/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { AgentSession } from "../../src/agent/emailAgent.js";
import type { RunHandlers, TurnLogger } from "../../src/agent/run.js";
import type { TurnSessions } from "../../src/agent/turnRecorder.js";

// db/index.ts (pulled in transitively by app.ts) runs its DDL as an
// import-time side effect and resolves its path through env.ts's
// DATABASE_PATH read, also at import time — same as test/routes/search.test.ts,
// point DATABASE_PATH at a fresh temp file before anything imports app.ts.
const tempDir = mkdtempSync(join(tmpdir(), "trailin-chat-route-"));
const originalDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(tempDir, "test.db");

const { buildApp } = await import("../../src/app.js");
const { _setSessionsForTest } = await import("../../src/agent/turnRecorder.js");
// runPrompt is pure (see test/agent/turnRecorder.test.ts's own comment on the
// same fake) — safe to use for real against the scripted FakeAgent below.
const { runPrompt } = await import("../../src/agent/run.js");
const { db, schema } = await import("../../src/db/index.js");

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  rmSync(tempDir, { recursive: true, force: true });
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
});

afterEach(() => {
  _setSessionsForTest(null);
});

/**
 * Stands in for pi's real Agent class — same scripted fake as
 * test/agent/turnRecorder.test.ts (see its own comment for the rationale):
 * exposes exactly what run.ts consumes and nothing else, since the real
 * Agent builds against the modelRegistry singleton and can't run in tests.
 */
class FakeAgent {
  state: { errorMessage?: string; tools: { name: string; label: string }[] } = { tools: [] };
  aborted = false;
  prompts: string[] = [];

  private listeners: Array<(event: unknown) => void> = [];
  private settle: { resolve: () => void; reject: (error: unknown) => void } | null = null;
  private promptedResolve!: () => void;

  /** Resolves once prompt() has actually been called and its resolvers are live. */
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

/** Parses the SSE frames light-my-request captured off the hijacked raw response. */
function parseSseEvents(body: string): Array<Record<string, unknown>> {
  return body
    .split("\n\n")
    .map((line) => line.replace(/^data: /, "").trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("PATCH /api/conversations/:id — validation and not-found", () => {
  it("rejects a blank title with 400", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/conversations/does-not-exist",
      payload: { title: "  " },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("title is required");
  });

  it("answers a nonexistent id with 404", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/conversations/does-not-exist",
      payload: { title: "New title" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("not found");
  });
});

describe("DELETE /api/conversations/:id — not-found", () => {
  it("answers a nonexistent id with 404", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/conversations/does-not-exist" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("not found");
  });
});

describe("POST /api/chat — validation", () => {
  it("rejects a blank message with 400 before hijacking the reply", async () => {
    const res = await app.inject({ method: "POST", url: "/api/chat", payload: { message: "  " } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("message is required");
  });
});

describe("POST /api/chat — attached-email refs (composer @-mentions)", () => {
  const ref: EmailRef = {
    threadId: "t1",
    accountId: "acc-1",
    accountName: "work@example.com",
    subject: "Contract renewal",
  };

  it("decorates the prompt actually run, keeps the persisted row raw, and returns refs from history", async () => {
    const agent = new FakeAgent();
    const sessions: TurnSessions = {
      pooled: async () => fakeSession(agent),
      ephemeral: () => Promise.reject(new Error("ephemeral session not expected in this test")),
    };
    _setSessionsForTest(sessions);

    const injectPromise = app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "Please reply to this", refs: [ref] },
    });

    await agent.whenPrompted;
    agent.emit({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Sure thing." },
    });
    agent.resolveTurn();

    const res = await injectPromise;
    expect(res.statusCode).toBe(200);

    // The model saw the raw message plus the attached-email note appended.
    expect(agent.prompts).toHaveLength(1);
    const prompt = agent.prompts[0] ?? "";
    expect(prompt.startsWith("Please reply to this\n\n[Attached email:")).toBe(true);
    expect(prompt).toContain("authoritative");

    const conversationEvent = parseSseEvents(res.body).find((e) => e.type === "conversation");
    const conversationId = conversationEvent?.conversationId as string;
    expect(conversationId).toBeTruthy();

    const messagesRes = await app.inject({
      method: "GET",
      url: `/api/conversations/${conversationId}/messages`,
    });
    expect(messagesRes.statusCode).toBe(200);
    const messages = messagesRes.json() as Array<Record<string, unknown>>;
    const userMessage = messages.find((m) => m.role === "user");

    // The persisted row keeps the message exactly as the user typed it.
    expect(userMessage?.content).toBe("Please reply to this");
    expect(userMessage?.content as string).not.toContain("Attached email");
    expect(userMessage?.refs).toEqual([ref]);
  });

  it("omits refs from a restored message that had none", async () => {
    const agent = new FakeAgent();
    _setSessionsForTest({
      pooled: async () => fakeSession(agent),
      ephemeral: () => Promise.reject(new Error("ephemeral session not expected in this test")),
    });

    const injectPromise = app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { message: "No attachments here" },
    });
    await agent.whenPrompted;
    agent.emit({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Got it." },
    });
    agent.resolveTurn();
    const res = await injectPromise;

    const conversationEvent = parseSseEvents(res.body).find((e) => e.type === "conversation");
    const conversationId = conversationEvent?.conversationId as string;

    const messagesRes = await app.inject({
      method: "GET",
      url: `/api/conversations/${conversationId}/messages`,
    });
    const messages = messagesRes.json() as Array<Record<string, unknown>>;
    const userMessage = messages.find((m) => m.role === "user");
    expect(userMessage?.refs).toBeUndefined();
  });
});

describe("GET /api/conversations — search", () => {
  const nowIso = new Date().toISOString();

  beforeAll(() => {
    // messages_fts is external-content over `messages` with AFTER INSERT/
    // UPDATE/DELETE triggers (db/schemaSteps.ts), so inserting via drizzle
    // keeps the FTS index in sync automatically — same fixture shape as
    // test/search/sources.test.ts's searchChats coverage.
    db.insert(schema.conversations)
      .values({ id: "search-conv-body", title: "Weekly sync notes", createdAt: nowIso })
      .run();
    db.insert(schema.messages)
      .values({
        id: "search-msg-body",
        conversationId: "search-conv-body",
        role: "user",
        content: "The quetzalcoatl rollout starts Monday.",
        createdAt: nowIso,
      })
      .run();

    db.insert(schema.conversations)
      .values({ id: "search-conv-title", title: "quetzalcoatl status", createdAt: nowIso })
      .run();
    db.insert(schema.messages)
      .values({
        id: "search-msg-title",
        conversationId: "search-conv-title",
        role: "assistant",
        content: "Nothing relevant in this body.",
        createdAt: nowIso,
      })
      .run();

    db.insert(schema.conversations)
      .values({ id: "search-conv-unrelated", title: "Unrelated topic", createdAt: nowIso })
      .run();
    db.insert(schema.messages)
      .values({
        id: "search-msg-unrelated",
        conversationId: "search-conv-unrelated",
        role: "user",
        content: "Nothing to see here either.",
        createdAt: nowIso,
      })
      .run();
  });

  it("finds a conversation by message body content via the FTS index", async () => {
    const res = await app.inject({ method: "GET", url: "/api/conversations?q=quetzalcoatl" });
    expect(res.statusCode).toBe(200);
    const ids = (res.json().items as Array<{ id: string }>).map((i) => i.id);
    expect(ids).toContain("search-conv-body");
  });

  it("also matches by title", async () => {
    const res = await app.inject({ method: "GET", url: "/api/conversations?q=quetzalcoatl" });
    const ids = (res.json().items as Array<{ id: string }>).map((i) => i.id);
    expect(ids).toContain("search-conv-title");
  });

  it("excludes conversations with no title or body match", async () => {
    const res = await app.inject({ method: "GET", url: "/api/conversations?q=quetzalcoatl" });
    const ids = (res.json().items as Array<{ id: string }>).map((i) => i.id);
    expect(ids).not.toContain("search-conv-unrelated");
  });

  it("degrades to a title-only match for a query with no word/number characters", async () => {
    const res = await app.inject({ method: "GET", url: "/api/conversations?q=***" });
    expect(res.statusCode).toBe(200);
    const ids = (res.json().items as Array<{ id: string }>).map((i) => i.id);
    expect(ids).not.toContain("search-conv-body");
  });
});
