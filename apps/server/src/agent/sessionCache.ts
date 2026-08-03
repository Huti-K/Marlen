import type { Agent } from "@earendil-works/pi-agent-core";
import { moduleLogger, type TurnLogger } from "../core/logger.js";
import { buildAgent } from "./assembly.js";
import { sessionCapabilities } from "./capabilities.js";
import { compactedMessages } from "./compaction.js";
import { type EmailToolset, loadEmailTools } from "./emailToolset.js";
import { loadHistory, recordCompactionMarker } from "./history.js";
import { buildSystemPrompt } from "./prompt.js";
import { type RunHandlers, runPrompt } from "./run.js";

const log = moduleLogger("sessionCache");

export interface AgentSession {
  agent: Agent;
  toolset: EmailToolset;
  /**
   * Turns running against this session. A session's toolset is never closed
   * while this is above zero; go through runTurn (not the bare runPrompt) so a
   * turn can't forget to mark itself.
   */
  inFlight: number;
  /**
   * Dropped from the cache but still running a turn: no new turn can reach it,
   * and the last one to finish closes its toolset (see retireSession).
   */
  retired: boolean;
  /** Idle/LRU eviction clock; refreshed on creation, lookup, and turn end. */
  lastUsed: number;
  /**
   * Like the standalone runPrompt, but also marks the session busy for the
   * turn's duration and refreshes lastUsed when it ends (see sweepSessions).
   */
  runTurn(
    prompt: string,
    handlers?: RunHandlers,
    signal?: AbortSignal,
    log?: TurnLogger,
  ): Promise<string>;
}

/**
 * Wraps a fresh agent/toolset pair with the busy-tracking runTurn. The compact
 * hook trims the transcript in place and persists the compaction marker so a
 * rebuilt session starts from the same compacted shape (history.ts); fail-open,
 * a marker write never sinks the turn.
 */
function createAgentSession(
  agent: Agent,
  toolset: EmailToolset,
  conversationId: string,
): AgentSession {
  const session: AgentSession = {
    agent,
    toolset,
    inFlight: 0,
    retired: false,
    lastUsed: Date.now(),
    async runTurn(prompt, handlers, signal, turnLog) {
      session.inFlight++;
      try {
        return await runPrompt(session, prompt, {
          handlers,
          signal,
          log: turnLog,
          compact: async (options) => {
            const next = await compactedMessages(session.agent.state, turnLog, options);
            if (!next) return false;
            session.agent.state.messages = next;
            await recordCompactionMarker(conversationId, next).catch((err: unknown) => {
              (turnLog ?? log).warn(
                { err, conversationId },
                "persisting the compaction marker failed",
              );
            });
            return true;
          },
        });
      } finally {
        session.inFlight--;
        session.lastUsed = Date.now();
        if (session.retired && session.inFlight === 0) closeToolset(session, conversationId);
      }
    },
  };
  return session;
}

// Idle sessions keep their MCP connections open for nothing; cap how long one
// can sit unused and how many can exist at once.
const SESSION_IDLE_TTL_MS = 30 * 60 * 1000;
const SESSION_MAX_COUNT = 20;
const SESSION_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

const sessions = new Map<string, AgentSession>();
// In-flight session creations, keyed by conversationId: lets two concurrent
// requests for a new conversation share one creation instead of each opening
// (and one leaking) its own MCP session.
const pendingSessions = new Map<string, Promise<AgentSession>>();

function closeToolset(session: AgentSession, conversationId: string): void {
  void session.toolset.close().catch((err: unknown) => {
    log.warn({ err, conversationId }, "closing a retired session's MCP sessions failed");
  });
}

/**
 * Drop a session from the cache. Its toolset closes now if it is idle, and
 * otherwise when its last turn ends: closing under a running turn pins every
 * MCP session shut (mcpSession.ts refuses to revive a closed box), so the turn
 * would lose every email tool mid-answer.
 */
function retireSession(conversationId: string, session: AgentSession): void {
  sessions.delete(conversationId);
  if (session.inFlight > 0) {
    session.retired = true;
    return;
  }
  closeToolset(session, conversationId);
}

function sweepSessions(): void {
  const now = Date.now();
  for (const [conversationId, session] of sessions) {
    // A busy session isn't idle, whatever its clock says.
    if (session.inFlight > 0) continue;
    if (now - session.lastUsed > SESSION_IDLE_TTL_MS) retireSession(conversationId, session);
  }
  if (sessions.size > SESSION_MAX_COUNT) {
    const evictable = [...sessions.entries()]
      .filter(([, session]) => session.inFlight === 0)
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [conversationId, session] of evictable.slice(0, sessions.size - SESSION_MAX_COUNT)) {
      retireSession(conversationId, session);
    }
  }
}

const sweepTimer = setInterval(sweepSessions, SESSION_SWEEP_INTERVAL_MS);
sweepTimer.unref();

export async function getOrCreateSession(conversationId: string): Promise<AgentSession> {
  const existing = sessions.get(conversationId);
  if (existing) {
    existing.lastUsed = Date.now();
    // Memory/library/settings context can go stale on a long-lived session, so
    // recompute the system prompt before every prompt. The rebuild is
    // byte-identical unless those inputs changed (buildSystemPrompt holds no
    // clock or per-request values), so the provider's cached prefix survives
    // every turn where nothing moved.
    existing.agent.state.systemPrompt = await buildSystemPrompt();
    return existing;
  }

  // Two concurrent requests for the same new conversationId share one
  // creation; otherwise both pass the check above and each opens its own MCP
  // session, leaking whichever loses the race to `sessions.set`.
  const inFlight = pendingSessions.get(conversationId);
  if (inFlight) return inFlight;

  const creation = (async (): Promise<AgentSession> => {
    const caps = await sessionCapabilities(true);
    const toolsetPromise = loadEmailTools({ interactive: caps.interactive });
    try {
      const [toolset, history] = await Promise.all([toolsetPromise, loadHistory(conversationId)]);
      const session = createAgentSession(
        await buildAgent(toolset, history, caps, conversationId),
        toolset,
        conversationId,
      );
      sessions.set(conversationId, session);
      if (sessions.size > SESSION_MAX_COUNT) sweepSessions();
      return session;
    } catch (error) {
      // toolsetPromise may have resolved (live MCP connections open) even
      // though loadHistory or buildAgent failed; close it instead of leaking
      // those connections on every retry of a failing conversation.
      await toolsetPromise
        .then((t) => t.close())
        .catch((err: unknown) => {
          log.warn({ err, conversationId }, "closing the failed session's MCP sessions failed");
        });
      throw error;
    }
  })();
  pendingSessions.set(conversationId, creation);
  try {
    return await creation;
  } finally {
    pendingSessions.delete(conversationId);
  }
}

/**
 * Drop every cached session, so the next turn of every conversation is built
 * against the current credentials, grants and prompt. A turn already running
 * finishes on the toolset it started with; it is past the point where new
 * settings could apply to it anyway.
 */
export function resetSessions(): void {
  for (const [conversationId, session] of [...sessions]) retireSession(conversationId, session);
}

export function disposeSession(conversationId: string): void {
  const session = sessions.get(conversationId);
  if (session) retireSession(conversationId, session);
}

/**
 * Create a throwaway session for one automation run (the run id is its
 * conversation id). No human reviews a scheduled run's actions, so the
 * unattended profile withholds the create/change/delete tools while leaving
 * reads, drafts and granted sending intact (sessionGrants in toolAccess).
 */
export async function createEphemeralSession(conversationId: string): Promise<AgentSession> {
  const caps = await sessionCapabilities(false);
  const toolset = await loadEmailTools({ interactive: caps.interactive });
  try {
    return createAgentSession(
      await buildAgent(toolset, [], caps, conversationId),
      toolset,
      conversationId,
    );
  } catch (error) {
    // buildAgent failing (bad model config, a settings read failing) doesn't
    // leak the MCP connections loadEmailTools already opened; this runs on
    // every scheduled automation tick.
    await toolset.close().catch((err: unknown) => {
      log.warn({ err }, "closing the ephemeral session's MCP sessions failed");
    });
    throw error;
  }
}
