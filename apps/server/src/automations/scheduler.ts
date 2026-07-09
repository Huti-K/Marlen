import { randomUUID } from "node:crypto";
import cron, { type ScheduledTask } from "node-cron";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { createEphemeralSession, runPrompt } from "../agent/emailAgent.js";
import { getTimezoneSetting } from "../db/settings.js";
import { emitServerEvent } from "../events.js";
import { errorMessage } from "../util.js";

const tasks = new Map<string, ScheduledTask>();

export function isValidCron(expression: string): boolean {
  return cron.validate(expression);
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
    // Let's set the type to 'automation' manually via raw query since drizzle schema update is not strictly needed for insert if we don't map it.
    // Actually, we need to map it in schema.ts so Drizzle can insert it.

    session = await createEphemeralSession();
    const instructionMessage = `Scheduled automation "${automation.name}". Execute this instruction now and report the outcome:\n\n${automation.instruction}`;
    
    await db.insert(schema.messages).values({
      id: randomUUID(),
      conversationId: runId,
      role: "user",
      content: instructionMessage,
      createdAt: new Date().toISOString(),
    });

    const text = await runPrompt(session, instructionMessage);

    await db.insert(schema.messages).values({
      id: randomUUID(),
      conversationId: runId,
      role: "assistant",
      content: text,
      createdAt: new Date().toISOString(),
    });
    emitServerEvent("conversations");

    await db
      .update(schema.automationRuns)
      .set({ status: "success", result: text, finishedAt: new Date().toISOString() })
      .where(eq(schema.automationRuns.id, runId));
    emitServerEvent("runs");
  } catch (error) {
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
    await session?.toolset.close().catch(() => {});
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
      runAutomation(automation.id).catch((error) =>
        console.error(`[scheduler] automation ${automation.id} failed:`, error),
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
  const all = await db.select().from(schema.automations);
  for (const automation of all) {
    if (automation.enabled && isValidCron(automation.schedule)) {
      await schedule(automation);
    }
  }
  console.log(`[scheduler] ${tasks.size} automation(s) scheduled`);
}
