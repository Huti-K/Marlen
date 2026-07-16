import type { VoiceLearnRun } from "@trailin/shared";
import { eq } from "drizzle-orm";
import { emitServerEvent } from "../events.js";
import { db, schema } from "./index.js";

/**
 * Per-account voice-learn attempt state: one row per account holding only
 * the latest attempt (a retry overwrites it). An "error" row persists until
 * a rerun succeeds — that persistence is what makes a failed or skipped
 * learn visible and retryable in Settings instead of silently lost.
 */

export async function listVoiceLearnRuns(): Promise<VoiceLearnRun[]> {
  const rows = await db.select().from(schema.voiceLearnRuns);
  return rows as VoiceLearnRun[];
}

/** Stamp the attempt as started; replaces any previous attempt's row. */
export async function markVoiceLearnRunning(accountId: string): Promise<void> {
  const row: VoiceLearnRun = {
    accountId,
    status: "running",
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  await db
    .insert(schema.voiceLearnRuns)
    .values(row)
    .onConflictDoUpdate({
      target: schema.voiceLearnRuns.accountId,
      set: { status: row.status, error: null, startedAt: row.startedAt, finishedAt: null },
    });
  emitServerEvent("learn");
}

/** Close the running attempt: ok when `error` is null, error (with the reason) otherwise. */
export async function finishVoiceLearnRun(
  accountId: string,
  error: string | null = null,
): Promise<void> {
  await db
    .update(schema.voiceLearnRuns)
    .set({
      status: error === null ? "ok" : "error",
      error,
      finishedAt: new Date().toISOString(),
    })
    .where(eq(schema.voiceLearnRuns.accountId, accountId));
  emitServerEvent("learn");
}

/** Forget an account's attempt state (the account was disconnected). */
export async function deleteVoiceLearnRun(accountId: string): Promise<void> {
  await db.delete(schema.voiceLearnRuns).where(eq(schema.voiceLearnRuns.accountId, accountId));
  emitServerEvent("learn");
}

/**
 * Close out attempts left "running" by a mid-run restart, so they surface as
 * retryable errors rather than spinning forever. Called once at boot before
 * the reconcile pass.
 */
export async function failInterruptedVoiceLearnRuns(): Promise<void> {
  const rows = await db
    .select()
    .from(schema.voiceLearnRuns)
    .where(eq(schema.voiceLearnRuns.status, "running"));
  for (const row of rows) {
    await finishVoiceLearnRun(row.accountId, "interrupted by a server restart");
  }
}
