import { randomUUID } from "node:crypto";
import type { LearnRun } from "@marlen/shared";
import { desc, eq, inArray } from "drizzle-orm";
import { emitServerEvent } from "../core/events.js";
import { db, schema } from "./index.js";

/** Retained per reason: a burst of boot catch-ups can never evict the nightly history. */
const KEEP_RUNS_PER_REASON = 10;

export async function listLearnRuns(): Promise<LearnRun[]> {
  const rows = await db.select().from(schema.learnRuns).orderBy(desc(schema.learnRuns.startedAt));
  return rows as LearnRun[];
}

export async function recordLearnRun(input: Omit<LearnRun, "id">): Promise<LearnRun> {
  const entry: LearnRun = { id: randomUUID(), ...input };
  await db.insert(schema.learnRuns).values(entry);

  const rows = await db
    .select({ id: schema.learnRuns.id })
    .from(schema.learnRuns)
    .where(eq(schema.learnRuns.reason, entry.reason))
    .orderBy(desc(schema.learnRuns.startedAt));
  const excess = rows.slice(KEEP_RUNS_PER_REASON).map((row) => row.id);
  if (excess.length > 0) {
    await db.delete(schema.learnRuns).where(inArray(schema.learnRuns.id, excess));
  }

  emitServerEvent("learn");
  return entry;
}
