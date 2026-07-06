import { randomUUID } from "node:crypto";
import cron, { type ScheduledTask } from "node-cron";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { createEphemeralSession, runPrompt } from "../agent/emailAgent.js";

const tasks = new Map<string, ScheduledTask>();

export function isValidCron(expression: string): boolean {
  return cron.validate(expression);
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

  let session;
  try {
    session = await createEphemeralSession();
    const text = await runPrompt(
      session,
      `Scheduled automation "${automation.name}". Execute this instruction now and report the outcome:\n\n${automation.instruction}`,
    );
    await db
      .update(schema.automationRuns)
      .set({ status: "success", result: text, finishedAt: new Date().toISOString() })
      .where(eq(schema.automationRuns.id, runId));
  } catch (error) {
    await db
      .update(schema.automationRuns)
      .set({
        status: "error",
        result: error instanceof Error ? error.message : String(error),
        finishedAt: new Date().toISOString(),
      })
      .where(eq(schema.automationRuns.id, runId));
  } finally {
    await session?.toolset.close().catch(() => {});
  }
}

function schedule(automation: { id: string; schedule: string }): void {
  const task = cron.schedule(automation.schedule, () => {
    runAutomation(automation.id).catch((error) =>
      console.error(`[scheduler] automation ${automation.id} failed:`, error),
    );
  });
  tasks.set(automation.id, task);
}

export function unschedule(automationId: string): void {
  const task = tasks.get(automationId);
  if (task) {
    task.stop();
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
    schedule(automation);
  }
}

/** Called once on boot: schedule every enabled automation. */
export async function startScheduler(): Promise<void> {
  const all = await db.select().from(schema.automations);
  for (const automation of all) {
    if (automation.enabled && isValidCron(automation.schedule)) {
      schedule(automation);
    }
  }
  console.log(`[scheduler] ${tasks.size} automation(s) scheduled`);
}
