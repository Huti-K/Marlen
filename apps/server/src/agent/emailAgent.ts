import { Agent } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import { LANGUAGE_ENGLISH_NAMES, type Language } from "@trailin/shared";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import {
  getAccountPermissions,
  getLanguageSetting,
  getOnOfficeAutomationCreates,
  getOnOfficeWriteAccess,
  getTimezoneSetting,
  getWhatsAppSendAccess,
} from "../db/settings.js";
import { resolveActiveModel } from "../llm/registry.js";
import { moduleLogger } from "../logger.js";
import { getOnOfficeConfig } from "../onoffice/config.js";
import { loadOnOfficeTools } from "../onoffice/tools.js";
import { type EmailToolset, loadEmailTools } from "../pipedream/mcp.js";
import { prompts } from "../prompts.js";
import { isWhatsAppLinked } from "../whatsapp/session.js";
import { buildWhatsAppTools } from "../whatsapp/tools.js";
import { buildAccountsContext } from "./accounts.js";
import { automationManageTools, automationReadTools } from "./automationTools.js";
import { composeBriefingTool } from "./briefingTool.js";
import { parseStoredCards } from "./cards.js";
import { presentChoicesTool } from "./choicesTool.js";
import { compactedMessages, maybeCompact } from "./compaction.js";
import { buildDelegateTool } from "./delegate.js";
import { listDraftsTool } from "./draftTools.js";
import { decoratePrompt, parseStoredRefs } from "./emailRefs.js";
import { buildFileAccessContext, buildFileTools } from "./fileTools.js";
import {
  buildKnowledgeContext,
  buildKnowledgeReadTools,
  buildKnowledgeTools,
} from "./knowledgeTools.js";
import { leadDeleteTool, leadTools } from "./leadTools.js";
import { streamViaModelRegistry } from "./oneShot.js";
import { type RunHandlers, runPrompt, type TurnLogger } from "./run.js";
import { buildSkillsContext, skillReadTool, skillWriteTool } from "./skillTools.js";
import { voiceLearnTool } from "./voiceLearn.js";
import { webFetchTool } from "./webFetchTool.js";
import { webSearchTool } from "./webSearchTool.js";

const log = moduleLogger("emailAgent");

/** Intl locale used for the system prompt's date/time, keyed by the app's language setting. */
const DATE_LOCALE_BY_LANGUAGE: Record<Language, string> = {
  en: "en-US",
  de: "de-DE",
};

/** e.g. "Thu, Jul 9, 2026, 10:31" — rendered in the given IANA timezone and locale. */
function formatNow(timezone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date());
}

/**
 * The capability profile a session runs under. Both the toolset wiring
 * (buildAgent, the loadEmailTools calls) and the system-prompt prose
 * (buildSystemPrompt) derive from this one record, so what the tools can do
 * and what the prompt says about them cannot drift apart.
 */
export interface SessionCapabilities {
  /**
   * False for unattended scheduled runs: no human reviews an action before
   * it happens (or is present to click a choices card), so write surfaces
   * and standing-instruction tools are withheld throughout.
   */
  interactive: boolean;
  /** Whether account permission grants may arm provider write tools (loadEmailTools). */
  providerWrites: boolean;
  onOffice: {
    /** onOffice credentials exist; without them the whole CRM and lead surface is absent. */
    configured: boolean;
    /** The CRM modify/delete/send surface is armed — never for unattended runs. */
    writes: boolean;
    /** The additive CRM create surface (addresses, appointments, tasks, relations) is armed. */
    creates: boolean;
  };
  whatsapp: {
    /** A personal WhatsApp is paired; without it the whole surface is absent. */
    linked: boolean;
    /** whatsapp_send_message is armed — its Settings grant, never for unattended runs. */
    sends: boolean;
  };
}

/** Reads the settings once and derives the profile for one session build. */
async function sessionCapabilities(interactive: boolean): Promise<SessionCapabilities> {
  const configured = (await getOnOfficeConfig()) !== null;
  const whatsappLinked = isWhatsAppLinked();
  return {
    interactive,
    providerWrites: interactive,
    onOffice: {
      configured,
      writes: configured && interactive && (await getOnOfficeWriteAccess()),
      creates: configured && (interactive || (await getOnOfficeAutomationCreates())),
    },
    whatsapp: {
      linked: whatsappLinked,
      sends: whatsappLinked && interactive && (await getWhatsAppSendAccess()),
    },
  };
}

/**
 * The base prompt plus the Settings rules (scheduled runs rely on them too).
 * Defaults to the interactive profile when no capabilities are given.
 *
 * Byte-stable across turns unless its inputs genuinely change (settings,
 * connected accounts, memories, library): pi-ai puts a provider cache
 * breakpoint on the system prompt, so a volatile interpolation here (a clock,
 * a per-request id) would invalidate the cached prefix — system prompt plus
 * the entire prior conversation — on every turn. Per-turn context like the
 * current date/time rides the turn prompt instead: see buildTurnTimeNote.
 */
export async function buildSystemPrompt(caps?: SessionCapabilities): Promise<string> {
  const { interactive, onOffice, whatsapp } = caps ?? (await sessionCapabilities(true));
  let prompt = prompts.system;

  if (!interactive) {
    // Scheduled automations run with no human to review a send before it goes
    // out, so loadEmailTools withholds every provider write tool for this run
    // regardless of any account's permission grants (see providerWrites in
    // pipedream/mcp.ts) — say so plainly rather than let the interactive
    // permissions copy below imply sending is possible here.
    prompt += `
- Unattended scheduled run: provider write actions (send, reply, forward, label, move, delete) are
  unavailable in this run, regardless of any account's permission grants in Settings. Where a task
  would otherwise call for one of those, create a draft instead so the user can review and send it
  themselves.
- Search the document library first whenever this run's task relates to any listed document.`;
  } else {
    const permissions = await getAccountPermissions();
    if (!permissions.some((p) => p.write || p.send || p.delete)) {
      prompt += `
- Read-only mode: you only have tools that read, search or create drafts. You cannot send, delete
  or change anything. If the user asks for such an action, explain that permissions (create &
  change, send, delete) are granted per account on its row under Settings → Email.`;
    } else {
      prompt += `
- Permissions are granted per account and per category (create & change, send, delete), not
  globally — see what each connected account may do in the list below. Where a grant is missing
  you can only read, search and create drafts; if the user asks for more there, explain that
  permissions are granted per account on its row under Settings → Email.`;
    }

    // The automation-management tools exist only in interactive sessions, so
    // only those sessions are told about them.
    prompt += `
- When the user wants something done on a schedule — recurring ("every morning…", "each Friday…")
  or once at a later date ("on the 15th…") — set it up with automation_create instead of doing it
  once and letting the request drop, then tell them what you created (name, schedule, next run).
- When the user describes a repeatable way they want a task done — "always do it like this",
  "from now on when I ask for X…" — save it as a skill with skill_write, then tell them what you
  saved. A scheduled skill is an automation whose instruction says to follow it.`;
  }

  // Everything in this block exists only alongside configured onOffice
  // credentials: the leads directory is part of the real-estate workflow, so
  // its tools (see buildAgent) and guidance disappear together with the CRM's.
  if (onOffice.configured) {
    prompt += `
- Trailin keeps a leads directory (lead_record / lead_list / lead_update): every prospect who
  shows interest — in a property, a viewing, the user's services — belongs in it. When handling
  such an email, record the sender with lead_record (email, name, what they're interested in, the
  message date as inboundAt); it merges by address, so recording twice is safe. As correspondence
  develops, keep the lead's status and last-message timestamps current with lead_update — the
  directory is only useful when it reflects who owes whom a reply.`;
    if (interactive) {
      prompt += `
  For follow-ups on a specific lead ("check in three days whether they answered"), create an
  automation with automation_create and pass its leadId — the automation is then attached to the
  lead, shown with it, and deleted with it. Write the instruction self-contained: name the lead's
  email address, what to check (e.g. lead_list status + searching the mailbox for a reply), and
  what to do about it (update the lead, draft a nudge — unattended runs cannot send).`;
    }
    prompt += `
- The user's onOffice CRM is connected — the onoffice_* tools work against it. Reach for them
  whenever a request touches contacts/leads, properties (estates), viewings/appointments or CRM
  tasks: match an email sender to their address record, find the estate an inquiry is about
  (onoffice_search first, then read the full record). Field names vary per onOffice account —
  call onoffice_get_fields before filtering on or writing any field you aren't certain exists.`;
    if (onOffice.writes) {
      prompt += `
  CRM records are live business data: before any modify, delete, send or other side-effecting
  onOffice call, state exactly which record and fields you'll touch and get the user's explicit
  confirmation.`;
    } else if (interactive) {
      prompt += `
  You can read the CRM and create new records; modifying, deleting or sending via onOffice is
  not armed. If the user asks for one of those, explain that CRM write access is granted on the
  onOffice row under Settings → Email.`;
    } else if (onOffice.creates) {
      prompt += `
  In this run you can read the CRM and create new records (onoffice_create_address — always set
  checkDuplicate — plus appointments, tasks and relations). Modifying, deleting or sending via
  onOffice is not possible unattended. After creating an address for a lead, store its record id
  on the lead (lead_update, onofficeAddressId).`;
    } else {
      prompt += `
  Only the CRM read tools are available in this run; creating or changing CRM records is not
  possible unattended.`;
    }
  }

  if (whatsapp.linked) {
    prompt += `
- The user's personal WhatsApp is linked — the whatsapp_* tools work on its mirrored chats
  (synced since pairing, text only; media shows as a bracketed marker). Reach for them whenever
  a request touches WhatsApp conversations; leads often continue there — match people by phone
  number or name with whatsapp_search_contacts.`;
    if (whatsapp.sends) {
      prompt += `
  A WhatsApp message sends immediately — there is no draft stage. Before calling
  whatsapp_send_message, state the exact recipient and text and get the user's explicit
  confirmation.`;
    } else if (interactive) {
      prompt += `
  You can read WhatsApp but not send; if the user asks to send, explain that sending is
  granted on the WhatsApp row under Settings → Email.`;
    } else {
      prompt += `
  Only the WhatsApp read tools are available in this run; sending is never possible
  unattended.`;
    }
  }

  // The file tools exist only in interactive sessions (see buildAgent), so
  // only those prompts describe them.
  if (interactive) {
    prompt += await buildFileAccessContext();
  }

  const language = (await getLanguageSetting()) ?? "de";
  if (language !== "en") {
    prompt += `
- Always answer in ${LANGUAGE_ENGLISH_NAMES[language]}, no matter what language the user's message
  or their emails are written in. Quoted email text and draft emails may keep their own language.`;
  }

  prompt += await buildAccountsContext();
  prompt += await buildKnowledgeContext();
  prompt += await buildSkillsContext();
  return prompt;
}

/**
 * Bracketed note carrying the current date/time, appended to each turn's
 * prompt (see turnRecorder.ts) rather than written into the system prompt.
 * Keeping the clock out of the system prompt is what keeps that prompt
 * byte-stable across turns — see buildSystemPrompt's cache invariant.
 */
export async function buildTurnTimeNote(): Promise<string> {
  const language = (await getLanguageSetting()) ?? "de";
  const timezone = (await getTimezoneSetting()) ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    `\n\n[Current date and time: ${formatNow(timezone, DATE_LOCALE_BY_LANGUAGE[language] ?? "en-US")} ` +
    `(${timezone}). The user lives in this timezone — present times in it and interpret relative ` +
    `dates ("today", "next Monday") against it.]`
  );
}

export interface AgentSession {
  agent: Agent;
  toolset: EmailToolset;
  /**
   * Turns currently running against this session. sweepSessions (below) must
   * never close a session's toolset while this is above zero — go through
   * runTurn (not the bare runPrompt) so a turn can't forget to mark itself.
   */
  inFlight: number;
  /** Idle/LRU eviction clock: refreshed on creation, on lookup, and when a turn ends. */
  lastUsed: number;
  /**
   * Runs one prompt through this session, exactly like the standalone
   * runPrompt, but also marks the session busy for the turn's duration and
   * refreshes lastUsed when it ends — see sweepSessions.
   */
  runTurn(
    prompt: string,
    handlers?: RunHandlers,
    signal?: AbortSignal,
    log?: TurnLogger,
  ): Promise<string>;
}

/** Wraps a fresh agent/toolset pair with the busy-tracking runTurn every cached session shares. */
function createAgentSession(agent: Agent, toolset: EmailToolset): AgentSession {
  const session: AgentSession = {
    agent,
    toolset,
    inFlight: 0,
    lastUsed: Date.now(),
    async runTurn(prompt, handlers, signal, log) {
      session.inFlight++;
      try {
        return await runPrompt(session, prompt, {
          handlers,
          signal,
          log,
          compact: (options) => maybeCompact(session.agent, log, options),
        });
      } finally {
        session.inFlight--;
        session.lastUsed = Date.now();
      }
    },
  };
  return session;
}

// Idle sessions keep their MCP connections open for nothing; cap both how
// long one can sit unused and how many can exist at once.
const SESSION_IDLE_TTL_MS = 30 * 60 * 1000;
const SESSION_MAX_COUNT = 20;
const SESSION_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

const sessions = new Map<string, AgentSession>();
// In-flight session creations, keyed by conversationId — lets two concurrent
// requests for a brand-new conversation share one creation instead of each
// opening (and one of them leaking) its own MCP session.
const pendingSessions = new Map<string, Promise<AgentSession>>();

/** Same disposal path resetSessions()/disposeSession() use, for idle/LRU eviction too. */
function evictSession(conversationId: string, session: AgentSession): void {
  sessions.delete(conversationId);
  void session.toolset.close().catch((err: unknown) => {
    log.warn({ err, conversationId }, "closing an evicted session's MCP sessions failed");
  });
}

function sweepSessions(): void {
  const now = Date.now();
  for (const [conversationId, session] of sessions) {
    // A turn is running against this session; closing its toolset now would
    // pull the rug out from under an in-flight tool call.
    if (session.inFlight > 0) continue;
    if (now - session.lastUsed > SESSION_IDLE_TTL_MS) evictSession(conversationId, session);
  }
  if (sessions.size > SESSION_MAX_COUNT) {
    const evictable = [...sessions.entries()]
      .filter(([, session]) => session.inFlight === 0)
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [conversationId, session] of evictable.slice(0, sessions.size - SESSION_MAX_COUNT)) {
      evictSession(conversationId, session);
    }
  }
}

const sweepTimer = setInterval(sweepSessions, SESSION_SWEEP_INTERVAL_MS);
sweepTimer.unref();

/** Fixed at a balanced default, not user-configurable — "medium" wherever the model can reason at all. */
function resolveThinkingLevel(model: { reasoning: boolean }): "off" | "low" | "medium" | "high" {
  return model.reasoning ? "medium" : "off";
}

async function buildAgent(
  toolset: EmailToolset,
  history: Message[],
  caps: SessionCapabilities,
  /**
   * Forwarded to providers that support session-scoped caching or affinity
   * headers (see pi-ai's SimpleStreamOptions.sessionId). The conversation id
   * for pooled sessions; unset for throwaway automation sessions.
   */
  sessionId?: string,
): Promise<Agent> {
  // Active model comes from Settings (SQLite), falling back to .env.
  const model = await resolveActiveModel();
  // onOffice CRM tools (native, non-Pipedream): the read surface always,
  // plus whichever create/write surfaces the profile arms — the CRM
  // counterpart of the per-account permission grants. Empty when no onOffice
  // credentials are configured.
  const onOfficeTools = await loadOnOfficeTools({
    allowWrites: caps.onOffice.writes,
    allowCreates: caps.onOffice.creates,
  });
  // WhatsApp tools ride the local mirror (reads) and the live socket (send,
  // when the profile arms it). Empty while no personal account is paired.
  const whatsappTools = caps.whatsapp.linked
    ? buildWhatsAppTools({ allowSend: caps.whatsapp.sends })
    : [];
  // The file tools are interactive-only: an unattended run reads
  // attacker-controllable mail with nobody watching, so it never touches the
  // filesystem regardless of the grants. Empty while nothing is armed.
  const fileTools = caps.interactive ? await buildFileTools() : [];
  const agent = new Agent({
    initialState: {
      systemPrompt: await buildSystemPrompt(caps),
      model,
      thinkingLevel: resolveThinkingLevel(model),
      // Per-account MCP tools (live reads always; the rest per permission grant),
      // the local draft/attachment tools, web search/fetch, the memory/library
      // tools, the delegate fan-out tool (built around this session's read
      // subset so workers ride the same MCP sessions), and (interactive
      // sessions only) present_choices for disambiguating with the user
      // instead of guessing.
      tools: [
        listDraftsTool,
        ...toolset.tools,
        ...onOfficeTools,
        ...whatsappTools,
        ...fileTools,
        webSearchTool,
        webFetchTool,
        // An unattended run reads attacker-controllable mail with no human to
        // review a write, so it gets read-only knowledge tools (no memory or
        // library writes, no voice_learn): a memory or note persisted from a
        // malicious email would otherwise be injected into every later
        // session's system prompt. Same read-only surface delegate workers get.
        ...(caps.interactive ? buildKnowledgeTools() : buildKnowledgeReadTools()),
        // Automation management is interactive-only for the same reason: an
        // automation's instruction is a standing prompt executed unattended
        // on every tick, so mail content must never be able to plant or
        // alter one. Past-run reads are inert, so every session gets them.
        ...(caps.interactive ? automationManageTools : []),
        ...automationReadTools,
        // Lead rows are inert structured data (never executed), so intake and
        // updates stay available unattended — that's how mail becomes leads.
        // Deleting cascades over the lead's automations: interactive only.
        // The leads directory belongs to the real-estate workflow: without
        // CRM credentials the whole lead surface is absent.
        ...(caps.onOffice.configured ? leadTools : []),
        ...(caps.onOffice.configured && caps.interactive ? [leadDeleteTool] : []),
        buildDelegateTool(toolset.readTools),
        // Skills are read everywhere — unattended runs follow them too ("Follow
        // the skill 'x'" automations) — but written only interactively: a skill
        // is a standing instruction executed on later runs, so mail content
        // must never be able to plant or alter one.
        skillReadTool,
        ...(caps.interactive ? [skillWriteTool] : []),
        ...(caps.interactive ? [voiceLearnTool] : []),
        composeBriefingTool,
        ...(caps.interactive ? [presentChoicesTool] : []),
      ],
      messages: history,
    },
    // Route model calls through the registry so stored credentials apply
    // (subscription OAuth with auto-refresh, saved API keys, then env vars).
    streamFn: streamViaModelRegistry,
    sessionId,
  });
  // A tool-heavy run (a many-thread digest) can outgrow the context window
  // between the turns of one run, where runPrompt's pre-prompt compaction
  // can't reach. This hook runs after every turn inside a run: when the
  // loop's context nears the window, hand the loop a compacted replacement
  // and mirror it onto agent state so the durable transcript matches what
  // the model sees next. The state setter copies the array, so the loop's
  // context and the agent's transcript stay independent for later appends.
  agent.prepareNextTurnWithContext = async ({ context }, signal) => {
    const compacted = await compactedMessages(
      {
        systemPrompt: context.systemPrompt,
        model: agent.state.model,
        messages: context.messages,
      },
      undefined,
      { signal },
    );
    if (!compacted) return undefined;
    agent.state.messages = compacted;
    return { context: { ...context, messages: compacted } };
  };
  return agent;
}

/**
 * Rebuild a conversation's prior turns from the message log, so continuing an
 * older conversation (after a restart or session reset) keeps the agent's
 * memory. The model history is intentionally reconstructed as text; persisted
 * tool activity is presentation metadata for the chat UI.
 */
async function loadHistory(conversationId: string): Promise<Message[]> {
  const rows = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId))
    .orderBy(schema.messages.createdAt);
  if (rows.length === 0) return [];

  const model = await resolveActiveModel();
  const zeroUsage = () => ({
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  });

  const messages: Message[] = [];
  for (const row of rows) {
    let content = row.content.trim();
    if (!content) continue;
    const timestamp = Date.parse(row.createdAt) || Date.now();
    if (row.role === "user") {
      // The persisted row keeps `content` raw, but the model saw it with its
      // attached-email notes appended (turnRecorder.ts), so a rebuilt session
      // must see the same thing. The turn-time and focus notes are not
      // reconstructed: they described the moment the turn ran, and the next
      // live turn carries fresh ones.
      content = decoratePrompt(content, parseStoredRefs(row.refs));
      messages.push({ role: "user", content, timestamp });
    } else {
      // Tool results aren't persisted, but a turn's created drafts are (via
      // its cards) — reattach their ids so the rebuilt session can still
      // refer to "the draft" precisely when the user comes back to refine it.
      const draftNotes = (parseStoredCards(row.cards) ?? []).flatMap(({ card }) =>
        card.kind === "email_draft"
          ? [
              `[This turn created draft ${card.draft.draftId}` +
                (card.account ? ` in ${card.account.name}` : "") +
                (card.draft.threadId ? ` on thread ${card.draft.threadId}` : "") +
                `, subject "${card.draft.subject}".]`,
            ]
          : [],
      );
      if (draftNotes.length > 0) content += `\n\n${draftNotes.join("\n")}`;
      messages.push({
        role: "assistant",
        content: [{ type: "text", text: content }],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: zeroUsage(),
        stopReason: "stop",
        timestamp,
      });
    }
  }
  return messages;
}

/** One pi Agent per conversation; context lives in process memory. */
export async function getOrCreateSession(conversationId: string): Promise<AgentSession> {
  const existing = sessions.get(conversationId);
  if (existing) {
    existing.lastUsed = Date.now();
    // Memory/library/settings context can go stale on a long-lived session —
    // recompute the system prompt before every prompt. The rebuild is
    // byte-identical unless those inputs actually changed (buildSystemPrompt
    // holds no clock or per-request values), so the provider's cached prefix
    // survives every turn where nothing moved.
    existing.agent.state.systemPrompt = await buildSystemPrompt();
    return existing;
  }

  // Two concurrent requests for the same new conversationId must share one
  // creation — otherwise both pass the check above and each opens its own
  // MCP session, leaking whichever one loses the race to `sessions.set`.
  const inFlight = pendingSessions.get(conversationId);
  if (inFlight) return inFlight;

  const creation = (async (): Promise<AgentSession> => {
    const caps = await sessionCapabilities(true);
    const toolsetPromise = loadEmailTools({ providerWrites: caps.providerWrites });
    try {
      const [toolset, history] = await Promise.all([toolsetPromise, loadHistory(conversationId)]);
      const session = createAgentSession(
        await buildAgent(toolset, history, caps, conversationId),
        toolset,
      );
      sessions.set(conversationId, session);
      if (sessions.size > SESSION_MAX_COUNT) sweepSessions();
      return session;
    } catch (error) {
      // toolsetPromise may have resolved (live MCP connections open) even
      // though loadHistory or buildAgent failed — close it instead of
      // leaking those connections on every retry of a failing conversation.
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

/** Drop all in-memory agent sessions (e.g. after auth or model changes). */
export async function resetSessions(): Promise<void> {
  const all = [...sessions.values()];
  sessions.clear();
  await Promise.all(
    all.map((session) =>
      session.toolset.close().catch((err: unknown) => {
        log.warn({ err }, "closing a reset session's MCP sessions failed");
      }),
    ),
  );
}

export async function disposeSession(conversationId: string): Promise<void> {
  const session = sessions.get(conversationId);
  if (!session) return;
  sessions.delete(conversationId);
  await session.toolset.close();
}

/**
 * Create a throwaway session (used by scheduled automations). No human
 * reviews a scheduled run's actions before they happen, so the unattended
 * profile withholds every provider write tool while leaving draft tools
 * untouched (providerWrites, see loadEmailTools).
 */
export async function createEphemeralSession(): Promise<AgentSession> {
  const caps = await sessionCapabilities(false);
  const toolset = await loadEmailTools({ providerWrites: caps.providerWrites });
  try {
    return createAgentSession(await buildAgent(toolset, [], caps), toolset);
  } catch (error) {
    // buildAgent failing (bad model config, a settings read failing) must not
    // leak the MCP connections loadEmailTools already opened — this runs on
    // every scheduled automation tick.
    await toolset.close().catch((err: unknown) => {
      log.warn({ err }, "closing the ephemeral session's MCP sessions failed");
    });
    throw error;
  }
}
