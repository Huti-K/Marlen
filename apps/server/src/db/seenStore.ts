import type { SeenState } from "@trailin/shared";
import { ne } from "drizzle-orm";
import { emitServerEvent } from "../core/events.js";
import { db, schema } from "./index.js";

/**
 * What the user has already seen on Home. Per-item marks ("todo:<id>",
 * "run:<id>", …) plus a floor timestamp: an item created at or before the
 * floor is seen regardless of marks, which is what keeps the table from
 * growing one row per item forever.
 */

const FLOOR_KEY = "__floor__";

export async function getSeenState(): Promise<SeenState> {
  const rows = await db.select().from(schema.seenMarks);
  let floor = "";
  const keys: string[] = [];
  for (const row of rows) {
    if (row.key === FLOOR_KEY) floor = row.seenAt;
    else keys.push(row.key);
  }
  return { floor, keys };
}

/** Idempotent upsert of one or more per-item marks. */
export async function markSeen(keys: string[]): Promise<void> {
  const clean = keys.map((key) => key.trim()).filter((key) => key && key !== FLOOR_KEY);
  if (clean.length === 0) return;
  const seenAt = new Date().toISOString();
  await db
    .insert(schema.seenMarks)
    .values(clean.map((key) => ({ key, seenAt })))
    .onConflictDoNothing();
  emitServerEvent("seen");
}

/** "Seen all": raise the floor to now, which subsumes every per-item mark. */
export async function markAllSeen(): Promise<void> {
  const seenAt = new Date().toISOString();
  await db.delete(schema.seenMarks).where(ne(schema.seenMarks.key, FLOOR_KEY));
  await db
    .insert(schema.seenMarks)
    .values({ key: FLOOR_KEY, seenAt })
    .onConflictDoUpdate({ target: schema.seenMarks.key, set: { seenAt } });
  emitServerEvent("seen");
}
