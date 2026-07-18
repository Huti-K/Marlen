import { and, desc, eq, gte } from "drizzle-orm";
import {
  createSuggestion,
  listAllSuggestions,
  listPendingSuggestions,
} from "../db/automationSuggestions.js";
import { db, schema } from "../db/index.js";
import { getSetting, getTimezoneSetting, setSetting } from "../db/settings.js";
import { resolveCheapModel } from "../llm/registry.js";
import { moduleLogger } from "../logger.js";
import { NightlyJob } from "../utils/jobs.js";
import { isValidCron } from "./scheduler.js";
import { proposeAutomations, type SuggestedAutomation } from "./suggestLLM.js";

const log = moduleLogger("suggest");

/**
 * The automation-suggestion sweep: nightly (and once at boot), read the
 * user's own chat requests from the last two weeks, ask a cheap model for
 * recurring request patterns (suggestLLM.ts), and store the valid proposals
 * as pending suggestions for the Automations page's accept/dismiss queue.
 *
 * Guards keep it quiet and cheap: at most one LLM call per ~day (a settings
 * timestamp, so dev restarts don't burn calls), nothing runs while the
 * pending queue is full, and too little chat history skips the call
 * entirely. A failed sweep leaves the timestamp unstamped so the next boot
 * or nightly tick retries it.
 */

const NIGHTLY_CRON = "30 3 * * *"; // offset from the 03:00 learning sweep
const LAST_SWEEP_KEY = "automations.suggestLastSweepAt";
const MIN_SWEEP_GAP_MS = 20 * 60 * 60 * 1000;

const WINDOW_DAYS = 14;
/** Newest user messages the sweep reads; an unusually chatty fortnight is truncated, not fatal. */
const MAX_MESSAGES = 300;
/** Per-message cap in the rendered prompt. */
const MESSAGE_CHARS = 400;
/** Fewer requests than this can't contain a ≥3-ask pattern worth an LLM call. */
const MIN_MESSAGES = 6;
/** Most suggestions allowed to sit undecided; the sweep pauses while the queue is full. */
const MAX_PENDING = 3;

/** Injectable seam: the proposal model call, so tests never hit an LLM. */
export interface SuggestSweepDeps {
  propose?: (prompt: string) => Promise<SuggestedAutomation[]>;
}

export interface SuggestSweepResult {
  /** False when a guard stopped the sweep before it counted as run. */
  ran: boolean;
  /** Which guard stopped it, when ran is false. */
  skipped?: "recent-sweep" | "pending-full";
  /** Proposals the model reported. */
  proposed: number;
  /** Proposals that survived validation/dedup and were stored as pending. */
  stored: number;
}

async function defaultPropose(prompt: string): Promise<SuggestedAutomation[]> {
  const model = await resolveCheapModel();
  return proposeAutomations(prompt, model);
}

interface UserMessage {
  content: string;
  createdAt: string;
}

/** The user's chat requests in the window, oldest first (automation-run conversations excluded). */
async function recentUserMessages(): Promise<UserMessage[]> {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const rows = await db
    .select({ content: schema.messages.content, createdAt: schema.messages.createdAt })
    .from(schema.messages)
    .innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
    .where(
      and(
        eq(schema.conversations.type, "chat"),
        eq(schema.messages.role, "user"),
        gte(schema.messages.createdAt, since),
      ),
    )
    .orderBy(desc(schema.messages.createdAt))
    .limit(MAX_MESSAGES);
  return rows.reverse();
}

/** e.g. "Tue, Jul 14, 08:12" in the user's timezone — the recurrence signal the model reads. */
function timestampLabel(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

function truncate(text: string, max: number): string {
  const collapsed = text.trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}

async function renderPrompt(messages: UserMessage[], timezone: string): Promise<string> {
  const automations = await db.select().from(schema.automations);
  const automationLines =
    automations.length > 0
      ? automations
          .map((a) => `- "${a.name}" — ${a.schedule} — ${truncate(a.instruction, 200)}`)
          .join("\n")
      : "(none)";

  const prior = await listAllSuggestions();
  const priorLines =
    prior.length > 0
      ? prior.map((s) => `- [${s.status}] "${s.name}" — ${truncate(s.rationale, 200)}`).join("\n")
      : "(none)";

  const messageLines = messages
    .map((m) => `[${timestampLabel(m.createdAt, timezone)}] ${truncate(m.content, MESSAGE_CHARS)}`)
    .join("\n");

  return [
    `The user's timezone: ${timezone}.`,
    "",
    "Existing automations:",
    automationLines,
    "",
    "Suggestions already made (never repeat these, whatever their status):",
    priorLines,
    "",
    `The user's requests to the assistant over the last ${WINDOW_DAYS} days, oldest first:`,
    messageLines,
  ].join("\n");
}

/**
 * One sweep. Throws when the model call itself fails (the caller logs and
 * leaves LAST_SWEEP_KEY unstamped, so the sweep retries at the next boot or
 * nightly tick); every completed sweep — including "nothing recurs" — stamps
 * the timestamp.
 */
export async function runSuggestSweep(deps: SuggestSweepDeps = {}): Promise<SuggestSweepResult> {
  const lastAt = await getSetting(LAST_SWEEP_KEY);
  if (lastAt && Date.now() - Date.parse(lastAt) < MIN_SWEEP_GAP_MS) {
    return { ran: false, skipped: "recent-sweep", proposed: 0, stored: 0 };
  }
  const pending = await listPendingSuggestions();
  if (pending.length >= MAX_PENDING) {
    return { ran: false, skipped: "pending-full", proposed: 0, stored: 0 };
  }

  const messages = await recentUserMessages();
  if (messages.length < MIN_MESSAGES) {
    await setSetting(LAST_SWEEP_KEY, new Date().toISOString());
    return { ran: true, proposed: 0, stored: 0 };
  }

  const timezone = (await getTimezoneSetting()) ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const prompt = await renderPrompt(messages, timezone);
  const proposals = await (deps.propose ?? defaultPropose)(prompt);

  // Dedup by normalized name against everything the user already has or has
  // already answered — the prompt forbids repeats, but the store enforces it.
  const automations = await db.select({ name: schema.automations.name }).from(schema.automations);
  const taken = new Set(
    [...automations.map((a) => a.name), ...(await listAllSuggestions()).map((s) => s.name)].map(
      (name) => name.trim().toLowerCase(),
    ),
  );

  let stored = 0;
  for (const proposal of proposals) {
    if (pending.length + stored >= MAX_PENDING) break;
    if (!isValidCron(proposal.schedule)) {
      log.warn({ schedule: proposal.schedule }, "suggestion dropped — invalid cron");
      continue;
    }
    if (taken.has(proposal.name.trim().toLowerCase())) continue;
    await createSuggestion(proposal);
    taken.add(proposal.name.trim().toLowerCase());
    stored++;
  }

  await setSetting(LAST_SWEEP_KEY, new Date().toISOString());
  if (stored > 0) log.info({ proposed: proposals.length, stored }, "automation suggestions stored");
  return { ran: true, proposed: proposals.length, stored };
}

const nightly = new NightlyJob({
  name: "suggest",
  cron: NIGHTLY_CRON,
  run: async () => {
    await runSuggestSweep();
  },
});

export async function startNightlySuggest(): Promise<void> {
  nightly.start((await getTimezoneSetting()) ?? undefined);
}

/** Rebuild the nightly cron against the current timezone setting (see
 *  routes/settings.ts's timezone route); a no-op while the job is stopped. */
export async function rescheduleNightlySuggest(): Promise<void> {
  nightly.reschedule((await getTimezoneSetting()) ?? undefined);
}

/** Stop the nightly cron; a sweep already running finishes on its own. */
export function stopNightlySuggest(): void {
  nightly.stop();
}
