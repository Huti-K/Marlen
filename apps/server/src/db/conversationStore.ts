import { emitServerEvent } from "../events.js";
import { db, lazyTransaction, schema, sqlite } from "./index.js";

/**
 * Owns the Conversation row's lifecycle (create/delete) and the
 * "conversations" server-event emits that belong to it. A conversation is
 * either a chat (routes/chat.ts, id = a fresh or client-supplied uuid) or an
 * automation run mirror (automations/runRecorder.ts, id = the run id) — see
 * CONTEXT.md for the vocabulary. Every other conversation-table read/update
 * (search, title patch, focus) stays where it is; only creation and deletion
 * — the two places a caller must get the row's existence and its children
 * right — are concentrated here.
 */

export interface EnsureConversationInput {
  type: "chat" | "automation";
  title: string;
}

/**
 * Idempotently create the parent Conversation row. Safe to call for an id
 * that may already exist (a client-supplied chat id reused after a delete,
 * or a second call for the same run) — onConflictDoNothing makes repeat
 * calls no-ops. Returns true only when this call actually created the row,
 * which is also the only case that emits "conversations".
 */
export async function ensureConversation(
  id: string,
  input: EnsureConversationInput,
): Promise<boolean> {
  const result = await db
    .insert(schema.conversations)
    .values({ id, title: input.title, type: input.type, createdAt: new Date().toISOString() })
    .onConflictDoNothing({ target: schema.conversations.id });
  const created = result.changes > 0;
  if (created) emitServerEvent("conversations");
  return created;
}

// Deletes a conversation and every row that references it. One SQLite
// transaction so a crash or error between the two deletes can never leave a
// conversation gone with its messages still around, or vice versa — the
// same idiom as automations/manage.ts's pinExclusively. agent_drafts rows are deliberately
// left alone: a draft snapshot's conversationId is a navigation link, not an
// ownership edge (db/draftStore.ts), and a dangling link degrades to "no
// link" at read time (draftStore.ts's getDraftConversationLinks) rather than
// needing to be cleaned up here.
const deleteConversationRows = lazyTransaction((id: string) => {
  sqlite.prepare("DELETE FROM messages WHERE conversation_id = ?").run(id);
  sqlite.prepare("DELETE FROM conversations WHERE id = ?").run(id);
});

/** Delete a conversation and its messages transactionally, then emit "conversations". */
export function deleteConversationCascade(id: string): void {
  deleteConversationRows(id);
  emitServerEvent("conversations");
}
