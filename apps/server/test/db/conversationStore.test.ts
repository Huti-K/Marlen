import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// db/index.ts runs its DDL as an import-time side effect against
// env.ts's DATABASE_PATH — point it at a fresh temp file before anything
// imports the store (same pattern as test/db/draftStore.test.ts).
const tempDir = mkdtempSync(join(tmpdir(), "trailin-conversation-store-"));
const originalDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(tempDir, "test.db");

const { db, schema, closeDb } = await import("../../src/db/index.js");
const { deleteConversationCascade, ensureConversation } = await import(
  "../../src/db/conversationStore.js"
);
const { eq } = await import("drizzle-orm");

afterAll(() => {
  closeDb();
  rmSync(tempDir, { recursive: true, force: true });
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
});

async function conversationRow(id: string) {
  const [row] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, id));
  return row;
}

async function messageRows(conversationId: string) {
  return db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId));
}

describe("ensureConversation", () => {
  it("creates the row with the given type/title and reports it as newly created", async () => {
    const id = randomUUID();
    const created = await ensureConversation(id, { type: "chat", title: "First message" });
    expect(created).toBe(true);

    const row = await conversationRow(id);
    expect(row?.type).toBe("chat");
    expect(row?.title).toBe("First message");
  });

  it("is idempotent: a second call for the same id is a no-op and reports false", async () => {
    const id = randomUUID();
    await ensureConversation(id, { type: "automation", title: "Run: Daily digest" });

    const created = await ensureConversation(id, {
      type: "automation",
      title: "A different title",
    });
    expect(created).toBe(false);

    // The row keeps whatever the first call wrote — a later call never
    // overwrites it, matching onConflictDoNothing semantics.
    const row = await conversationRow(id);
    expect(row?.title).toBe("Run: Daily digest");
  });

  it("tolerates concurrent-looking calls for the same id (a client-supplied conversationId reused after a delete)", async () => {
    const id = randomUUID();
    const results = await Promise.all([
      ensureConversation(id, { type: "chat", title: "a" }),
      ensureConversation(id, { type: "chat", title: "b" }),
      ensureConversation(id, { type: "chat", title: "c" }),
    ]);
    // Exactly one of the three calls actually created the row.
    expect(results.filter(Boolean)).toHaveLength(1);
    const row = await conversationRow(id);
    expect(row).toBeTruthy();
  });
});

describe("deleteConversationCascade", () => {
  it("deletes the conversation and its messages together", async () => {
    const id = randomUUID();
    await ensureConversation(id, { type: "chat", title: "To be deleted" });
    await db.insert(schema.messages).values([
      {
        id: randomUUID(),
        conversationId: id,
        role: "user",
        content: "hi",
        createdAt: new Date().toISOString(),
      },
      {
        id: randomUUID(),
        conversationId: id,
        role: "assistant",
        content: "hello",
        createdAt: new Date().toISOString(),
      },
    ]);
    expect(await messageRows(id)).toHaveLength(2);

    deleteConversationCascade(id);

    expect(await conversationRow(id)).toBeUndefined();
    expect(await messageRows(id)).toHaveLength(0);
  });

  it("leaves an agent_drafts row's conversation link dangling rather than deleting the draft", async () => {
    const id = randomUUID();
    await ensureConversation(id, { type: "chat", title: "Draft's conversation" });
    const draftId = randomUUID();
    const now = new Date().toISOString();
    await db.insert(schema.agentDrafts).values({
      id: draftId,
      accountId: "acct-1",
      providerDraftId: "provider-draft-1",
      conversationId: id,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.agentDraftVersions).values({
      draftId,
      version: 1,
      author: "agent",
      body: "draft body",
      createdAt: now,
    });

    deleteConversationCascade(id);

    expect(await conversationRow(id)).toBeUndefined();
    const [draftRow] = await db
      .select()
      .from(schema.agentDrafts)
      .where(eq(schema.agentDrafts.id, draftId));
    // The draft snapshot survives — only its conversationId now points at a
    // conversation that no longer exists (db/draftStore.ts's
    // getDraftConversationLinks degrades that to "no link" at read time).
    expect(draftRow).toBeTruthy();
    expect(draftRow?.conversationId).toBe(id);
  });
});
