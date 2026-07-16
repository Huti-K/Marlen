import { deleteConversationCascade, ensureConversation } from "../db/conversationStore.js";
import { db, schema } from "../db/index.js";
import { logger } from "../logger.js";
import { resetDemoActivity, seedDemoActivity } from "./activity.js";
import { demoGoldenChats } from "./goldenChats.js";

/**
 * Seeds (or clears) the demo dataset: one golden chat per card kind, plus
 * the activity fixtures (automations with a week of runs, pending
 * suggestions, memories, learn/voice history, recurring morning chats,
 * library notes — see demo/activity.ts). Run with
 *
 *   pnpm --filter @trailin/server seed:demo             # seed everything
 *   pnpm --filter @trailin/server seed:demo --reset     # remove all demo data
 *
 * Idempotent: all demo rows are cleared and re-inserted each run, so
 * re-seeding never duplicates. Writes straight to the stores —
 * no Pipedream, no LLM.
 *
 * Start the server with TRAILIN_DEMO=1 so the demo accounts appear in the UI
 * (see demo/accounts.ts and pipedream/connect.ts).
 */

/** Remove every demo row: golden chats, activity fixtures, and their messages. */
async function resetDemo(): Promise<void> {
  for (const chat of demoGoldenChats()) deleteConversationCascade(chat.id);
  await resetDemoActivity();
}

/** Insert one golden chat's conversation row and its message rows (with cards). */
async function insertGoldenChat(chat: ReturnType<typeof demoGoldenChats>[number]): Promise<void> {
  await ensureConversation(chat.id, { type: "chat", title: chat.title });
  const base = Date.now();
  await db.insert(schema.messages).values(
    chat.messages.map((m, i) => ({
      id: `${chat.id}-m${i}`,
      conversationId: chat.id,
      role: m.role,
      content: m.content,
      cards: m.cards && m.cards.length > 0 ? JSON.stringify(m.cards) : null,
      toolCalls: null,
      error: null,
      refs: null,
      // Space rows out so the user turn always sorts before its assistant turn.
      createdAt: new Date(base + i * 1000).toISOString(),
    })),
  );
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));

  if (args.has("--reset")) {
    await resetDemo();
    logger.info("demo: reset — all demo data removed");
    return;
  }

  // Clear first so a re-seed is clean (fixed demo ids would otherwise
  // collide or duplicate their message rows).
  await resetDemo();

  const chats = demoGoldenChats();
  for (const chat of chats) await insertGoldenChat(chat);
  await seedDemoActivity();

  logger.info(
    { chats: chats.length },
    "demo: golden chats + activity seeded — start the server with TRAILIN_DEMO=1",
  );
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    logger.fatal({ err: error }, "demo seed failed");
    process.exit(1);
  },
);
