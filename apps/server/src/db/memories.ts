import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { MemoryEntry } from "@trailin/shared";
import { db, schema } from "./index.js";
import { encrypt, decrypt } from "./crypto.js";

/**
 * Long-term memory: small standing facts ("the user's landlord is …",
 * "always sign off with 'Beste Grüße'"). All entries are injected into the
 * agent's system prompt, so the store is deliberately capped — it holds
 * notes, not documents (those belong in the library).
 */

export const MEMORY_MAX_LENGTH = 2000;
export const MEMORY_MAX_COUNT = 200;

export async function listMemories(): Promise<MemoryEntry[]> {
  const rows = await db.select().from(schema.memories).orderBy(schema.memories.createdAt);
  return rows.map((row) => ({
    ...row,
    content: decrypt(row.content),
  })) as MemoryEntry[];
}

export async function createMemory(
  content: string,
  source: MemoryEntry["source"],
): Promise<MemoryEntry> {
  const trimmed = content.trim();
  if (!trimmed) throw new Error("memory content must not be empty");
  if (trimmed.length > MEMORY_MAX_LENGTH) {
    throw new Error(`memory content must be at most ${MEMORY_MAX_LENGTH} characters`);
  }
  const count = (await db.select({ id: schema.memories.id }).from(schema.memories)).length;
  if (count >= MEMORY_MAX_COUNT) {
    throw new Error(`memory is full (${MEMORY_MAX_COUNT} entries) — delete some in Settings`);
  }
  const now = new Date().toISOString();
  const entry: MemoryEntry = {
    id: randomUUID(),
    content: trimmed,
    source,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(schema.memories).values({
    ...entry,
    content: encrypt(trimmed),
  });
  return entry;
}

export async function updateMemory(id: string, content: string): Promise<MemoryEntry | null> {
  const trimmed = content.trim();
  if (!trimmed) throw new Error("memory content must not be empty");
  if (trimmed.length > MEMORY_MAX_LENGTH) {
    throw new Error(`memory content must be at most ${MEMORY_MAX_LENGTH} characters`);
  }
  await db
    .update(schema.memories)
    .set({ content: encrypt(trimmed), updatedAt: new Date().toISOString() })
    .where(eq(schema.memories.id, id));
  const [row] = await db.select().from(schema.memories).where(eq(schema.memories.id, id));
  if (!row) return null;
  return { ...row, content: decrypt(row.content) } as MemoryEntry;
}

export async function deleteMemory(id: string): Promise<void> {
  await db.delete(schema.memories).where(eq(schema.memories.id, id));
}
