import { randomUUID } from "node:crypto";
import cron, { type ScheduledTask } from "node-cron";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { createEphemeralSession, runPrompt } from "../agent/emailAgent.js";
import { collectTurnCards, serializeTurnCards } from "../agent/turnCards.js";
import { getTimezoneSetting } from "../db/settings.js";
import { emitServerEvent } from "../events.js";
import { moduleLogger } from "../logger.js";
import { errorMessage } from "../util.js";

const log = moduleLogger("scheduler");

const tasks = new Map<string, ScheduledTask>();

export function isValidCron(expression: string): boolean {
  return cron.validate(expression);
}

/** Next scheduled fire time for an automation, or null when it isn't scheduled (disabled/invalid). */
export function getNextRunAt(automationId: string): string | null {
  const next = tasks.get(automationId)?.getNextRun();
  return next ? next.toISOString() : null;
}

/** True for the client's "specific date" schedule shape: a fixed day-of-month
 *  and month, matched on any weekday. Plain cron has no year field, so left
 *  alone this would recur annually — the caller disables the automation
 *  after this first run so it behaves as a one-time schedule. */
function isOneOffSchedule(expression: string): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [, , dom, month, dow] = parts;
  return dom !== "*" && month !== "*" && dow === "*";
}

/** Execute one automation now (used by the scheduler and the "Run now" button). */
export async function runAutomation(automationId: string): Promise<void> {
  const [automation] = await db
    .select()
    .from(schema.automations)
    .where(eq(schema.automations.id, automationId));
  if (!automation) throw new Error(`automation ${automationId} not found`);

  const runId = randomUUID();
  // Nobody is watching a 06:00 briefing. Every line this run produces carries
  // the run id, so a failure can be traced back through the log afterwards.
  const runLog = log.child({ runId, automationId, automation: automation.name });
  const startedAt = Date.now();
  runLog.info("automation run started");

  await db.insert(schema.automationRuns).values({
    id: runId,
    automationId,
    status: "running",
    result: "",
    startedAt: new Date().toISOString(),
  });
  emitServerEvent("runs");

  let session;
  try {
    // Create a conversation for the automation run
    await db.insert(schema.conversations).values({
      id: runId,
      title: `Run: ${automation.name}`,
      type: "automation",
      createdAt: new Date().toISOString(),
    });
    emitServerEvent("conversations");

    session = await createEphemeralSession();
    const instructionMessage = `Scheduled automation "${automation.name}". Execute this instruction now and report the outcome:\n\n${automation.instruction}`;
    
    await db.insert(schema.messages).values({
      id: randomUUID(),
      conversationId: runId,
      role: "user",
      content: instructionMessage,
      createdAt: new Date().toISOString(),
    });

    // The run id is the conversation id, so drafts created by this run link
    // back to the run's transcript and its cards render when it's reopened.
    const turnCards = collectTurnCards(runId);
    const text = await runPrompt(
      session,
      instructionMessage,
      { onCard: turnCards.onCard },
      undefined,
      runLog,
    );

    const cards = serializeTurnCards(turnCards.cards);
    await db.insert(schema.messages).values({
      id: randomUUID(),
      conversationId: runId,
      role: "assistant",
      content: text,
      cards,
      createdAt: new Date().toISOString(),
    });
    emitServerEvent("conversations");

    await db
      .update(schema.automationRuns)
      .set({
        status: "success",
        result: text,
        cards,
        finishedAt: new Date().toISOString(),
      })
      .where(eq(schema.automationRuns.id, runId));
    emitServerEvent("runs");
    runLog.info({ durationMs: Date.now() - startedAt }, "automation run finished");
  } catch (error) {
    // The run's row records the message for the UI; the log keeps the stack,
    // which is the only place it survives for an unattended run.
    runLog.error({ err: error, durationMs: Date.now() - startedAt }, "automation run failed");
    await db
      .update(schema.automationRuns)
      .set({
        status: "error",
        result: errorMessage(error),
        finishedAt: new Date().toISOString(),
      })
      .where(eq(schema.automationRuns.id, runId));
    emitServerEvent("runs");
  } finally {
    await session?.toolset.close().catch((error: unknown) => {
      runLog.warn({ err: error }, "closing the run's MCP sessions failed");
    });
  }

  if (isOneOffSchedule(automation.schedule)) {
    await db
      .update(schema.automations)
      .set({ enabled: false })
      .where(eq(schema.automations.id, automationId));
    unschedule(automationId);
  }
}

async function schedule(automation: { id: string; schedule: string }): Promise<void> {
  // "0 6 * * *" should mean 6am in the user's timezone, not the server's.
  const timezone = (await getTimezoneSetting()) ?? undefined;
  const task = cron.schedule(
    automation.schedule,
    () => {
      // runAutomation records its own failures; this only catches the ones it
      // couldn't (a database write that failed on the way in or out).
      runAutomation(automation.id).catch((error: unknown) =>
        log.error({ err: error, automationId: automation.id }, "scheduled automation failed"),
      );
    },
    timezone ? { timezone } : undefined,
  );
  tasks.set(automation.id, task);
}

export function unschedule(automationId: string): void {
  const task = tasks.get(automationId);
  if (task) {
    // destroy() (not stop()) also removes the task from node-cron's registry.
    void task.destroy();
    tasks.delete(automationId);
  }
}

/** (Re)register the cron job for an automation based on its current state. */
export async function refreshSchedule(automationId: string): Promise<void> {
  unschedule(automationId);
  const [automation] = await db
    .select()
    .from(schema.automations)
    .where(eq(schema.automations.id, automationId));
  if (automation?.enabled && isValidCron(automation.schedule)) {
    await schedule(automation);
  }
}

/** Called once on boot: schedule every enabled automation. */
export async function startScheduler(): Promise<void> {
  // Runs only live inside this process, so a row still "running" at boot
  // belongs to a process that died mid-run and would spin in the UI forever.
  const orphaned = await db
    .update(schema.automationRuns)
    .set({
      status: "error",
      result: "Interrupted by a server restart before the run could finish.",
      finishedAt: new Date().toISOString(),
    })
    .where(eq(schema.automationRuns.status, "running"))
    .returning({ id: schema.automationRuns.id });
  if (orphaned.length > 0) {
    log.warn({ count: orphaned.length }, "orphaned in-flight automation runs marked as error");
  }

  const all = await db.select().from(schema.automations);
  for (const automation of all) {
    if (automation.enabled && isValidCron(automation.schedule)) {
      await schedule(automation);
    }
  }
  log.info({ count: tasks.size }, "automations scheduled");
}
