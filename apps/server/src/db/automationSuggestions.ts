import { randomUUID } from "node:crypto";
import type { AutomationSuggestion } from "@trailin/shared";
import { desc, eq, inArray, ne } from "drizzle-orm";
import { emitServerEvent } from "../events.js";
import { db, schema } from "./index.js";

/**
 * Store for the suggestion sweep's proposals (automations/suggestService.ts).
 * Pending rows are the user-facing queue on the Automations page; decided
 * rows (accepted/dismissed) are kept — pruned to a recent window — purely as
 * dedup context so a later sweep doesn't re-suggest something the user
 * already answered.
 */

/** Decided rows kept as dedup context; the oldest beyond this are pruned on insert. */
const KEEP_DECIDED = 50;

export async function listPendingSuggestions(): Promise<AutomationSuggestion[]> {
  const rows = await db
    .select()
    .from(schema.automationSuggestions)
    .where(eq(schema.automationSuggestions.status, "pending"))
    .orderBy(desc(schema.automationSuggestions.createdAt));
  return rows as AutomationSuggestion[];
}

/** Every stored suggestion, newest first — the sweep's dedup context. */
export async function listAllSuggestions(): Promise<AutomationSuggestion[]> {
  const rows = await db
    .select()
    .from(schema.automationSuggestions)
    .orderBy(desc(schema.automationSuggestions.createdAt));
  return rows as AutomationSuggestion[];
}

export async function createSuggestion(input: {
  name: string;
  instruction: string;
  schedule: string;
  rationale: string;
}): Promise<AutomationSuggestion> {
  const entry: AutomationSuggestion = {
    id: randomUUID(),
    name: input.name,
    instruction: input.instruction,
    schedule: input.schedule,
    rationale: input.rationale,
    status: "pending",
    createdAt: new Date().toISOString(),
    decidedAt: null,
  };
  await db.insert(schema.automationSuggestions).values(entry);

  const decided = await db
    .select({ id: schema.automationSuggestions.id })
    .from(schema.automationSuggestions)
    .where(ne(schema.automationSuggestions.status, "pending"))
    .orderBy(desc(schema.automationSuggestions.createdAt));
  const excess = decided.slice(KEEP_DECIDED).map((row) => row.id);
  if (excess.length > 0) {
    await db
      .delete(schema.automationSuggestions)
      .where(inArray(schema.automationSuggestions.id, excess));
  }

  emitServerEvent("automations");
  return entry;
}

/**
 * Stamp a pending suggestion accepted or dismissed. Returns the updated row,
 * or null when no pending suggestion has this id (unknown, or already
 * decided — deciding is one-way).
 */
export async function decideSuggestion(
  id: string,
  status: "accepted" | "dismissed",
): Promise<AutomationSuggestion | null> {
  const [row] = await db
    .select()
    .from(schema.automationSuggestions)
    .where(eq(schema.automationSuggestions.id, id));
  if (row?.status !== "pending") return null;

  const decided = { ...row, status, decidedAt: new Date().toISOString() };
  await db
    .update(schema.automationSuggestions)
    .set({ status, decidedAt: decided.decidedAt })
    .where(eq(schema.automationSuggestions.id, id));
  emitServerEvent("automations");
  return decided as AutomationSuggestion;
}
