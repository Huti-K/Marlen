import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { deleteConversationCascade } from "../db/conversationStore.js";
import { db, schema, sqlite } from "../db/index.js";
import { badRequest, requireRow } from "../errors.js";
import { emitServerEvent } from "../events.js";
import { isValidCron, refreshSchedule, unschedule } from "./scheduler.js";

/**
 * Create/update/delete for automations, shared by the HTTP routes and the
 * agent's automation tools so both entry points get identical validation, the
 * pinned-row invariant, cron (re)scheduling, and the UI change event.
 * Validation failures throw AppErrors: the central handler renders them for
 * routes, and the agent tools surface the message as steering text
 * (catchToText).
 */

export type AutomationRow = typeof schema.automations.$inferSelect;

export interface AutomationInput {
  name: string;
  instruction: string;
  schedule: string;
  enabled?: boolean;
  showInActivity?: boolean;
  pinned?: boolean;
  /** Also run immediately when the mail probe sees new inbound mail (automations/mailProbe.ts). */
  runOnNewMail?: boolean;
  /** Show a desktop notification when a run of this automation finishes. */
  notifyOnCompletion?: boolean;
  /** Lead this automation belongs to; it is deleted with the lead (leads/manage.ts). */
  leadId?: string | null;
}

export interface AutomationPatch {
  name?: string;
  instruction?: string;
  schedule?: string;
  enabled?: boolean;
  showInActivity?: boolean;
  pinned?: boolean;
  runOnNewMail?: boolean;
  notifyOnCompletion?: boolean;
}

/**
 * Exactly one automation may be pinned. Clearing every other row and setting
 * this one happen as a single SQLite transaction so two concurrent "pin"
 * requests can never both leave a row pinned — whichever transaction commits
 * last wins, and the invariant (at most one pinned row) always holds.
 */
const pinExclusively = sqlite.transaction((id: string) => {
  sqlite.prepare("UPDATE automations SET pinned = 0 WHERE id != ?").run(id);
  sqlite.prepare("UPDATE automations SET pinned = 1 WHERE id = ?").run(id);
});

export async function createAutomation(input: AutomationInput): Promise<AutomationRow> {
  const name = input.name.trim();
  const instruction = input.instruction.trim();
  const schedule = input.schedule.trim();
  if (!name || !instruction || !schedule) {
    throw badRequest("name, instruction and schedule are required");
  }
  if (!isValidCron(schedule)) {
    throw badRequest(`invalid cron expression: ${input.schedule}`);
  }
  if (input.leadId) {
    const [lead] = await db
      .select({ id: schema.leads.id })
      .from(schema.leads)
      .where(eq(schema.leads.id, input.leadId));
    if (!lead) throw badRequest(`no lead with id ${input.leadId}`);
  }
  const automation: AutomationRow = {
    id: randomUUID(),
    name,
    instruction,
    schedule,
    enabled: input.enabled ?? true,
    showInActivity: input.showInActivity ?? true,
    pinned: input.pinned ?? false,
    runOnNewMail: input.runOnNewMail ?? false,
    notifyOnCompletion: input.notifyOnCompletion ?? false,
    leadId: input.leadId ?? null,
    createdAt: new Date().toISOString(),
  };
  await db.insert(schema.automations).values(automation);
  if (automation.pinned) pinExclusively(automation.id);
  await refreshSchedule(automation.id);
  emitServerEvent("automations");
  return automation;
}

export async function updateAutomation(id: string, patch: AutomationPatch): Promise<AutomationRow> {
  const updates: Partial<AutomationRow> = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw badRequest("name must not be empty");
    updates.name = name;
  }
  if (patch.instruction !== undefined) {
    const instruction = patch.instruction.trim();
    if (!instruction) throw badRequest("instruction must not be empty");
    updates.instruction = instruction;
  }
  if (patch.schedule !== undefined) {
    if (!isValidCron(patch.schedule.trim())) {
      throw badRequest(`invalid cron expression: ${patch.schedule}`);
    }
    updates.schedule = patch.schedule.trim();
  }
  if (patch.enabled !== undefined) updates.enabled = patch.enabled;
  if (patch.showInActivity !== undefined) updates.showInActivity = patch.showInActivity;
  if (patch.pinned !== undefined) updates.pinned = patch.pinned;
  if (patch.runOnNewMail !== undefined) updates.runOnNewMail = patch.runOnNewMail;
  if (patch.notifyOnCompletion !== undefined) {
    updates.notifyOnCompletion = patch.notifyOnCompletion;
  }
  if (Object.keys(updates).length === 0) throw badRequest("nothing to update");

  // Must run before any mutation: pinExclusively unpins every other row,
  // so an update for a nonexistent id must never reach it — otherwise a
  // pinned: true request for a bad id would unpin every real automation
  // and then still report not found.
  await requireRow(
    db
      .select({ id: schema.automations.id })
      .from(schema.automations)
      .where(eq(schema.automations.id, id)),
    "not found",
  );

  await db.update(schema.automations).set(updates).where(eq(schema.automations.id, id));
  if (updates.pinned === true) pinExclusively(id);
  await refreshSchedule(id);
  emitServerEvent("automations");

  return requireRow(
    db.select().from(schema.automations).where(eq(schema.automations.id, id)),
    "not found",
  );
}

/** Delete an automation and its whole run history. Returns false when no such automation exists. */
export async function deleteAutomation(id: string): Promise<boolean> {
  const [existing] = await db
    .select({ id: schema.automations.id })
    .from(schema.automations)
    .where(eq(schema.automations.id, id));

  unschedule(id);

  // Each run also created a conversation (id = run id) plus its user/
  // assistant message rows (see automations/runRecorder.ts) — nothing else
  // ever cleans those up, so without this they'd linger forever in the
  // chat sidebar's Automations section, orphaned from a deleted automation.
  // Each cascade is its own transaction (db/conversationStore.ts) — the
  // same atomicity guarantee routes/chat.ts gets for a single conversation,
  // applied once per run here.
  const runs = await db
    .select({ id: schema.automationRuns.id })
    .from(schema.automationRuns)
    .where(eq(schema.automationRuns.automationId, id));
  for (const run of runs) deleteConversationCascade(run.id);

  await db.delete(schema.automations).where(eq(schema.automations.id, id));
  await db.delete(schema.automationRuns).where(eq(schema.automationRuns.automationId, id));
  emitServerEvent("automations");
  return existing !== undefined;
}
