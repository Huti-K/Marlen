import { deleteConversationCascade, ensureConversation } from "../db/conversationStore.js";
import { db, schema, sqlite } from "../db/index.js";
import { saveEnrichment, snapshotThread } from "../email/enrich/enrichStore.js";
import { applySyncPage, markSyncStatus } from "../email/sync/mailStore.js";
import { logger } from "../logger.js";
import { DEMO_ACCOUNT_IDS } from "./accounts.js";
import { demoGoldenChats } from "./goldenChats.js";
import { demoEnrichments, demoSyncPages, demoUseCaseSummary } from "./mailFixtures.js";

/**
 * Seeds (or clears) the demo dataset: the two synthetic mailboxes, their
 * canned per-thread triage, and one golden chat per card kind. Run with
 *
 *   pnpm --filter @trailin/server seed:demo            # seed everything (offline, canned)
 *   pnpm --filter @trailin/server seed:demo --live     # seed mail + chats, leave triage to the running server's enrichment
 *   pnpm --filter @trailin/server seed:demo --reset     # remove all demo data
 *
 * Idempotent: mail upserts by deterministic id, and golden chats are cleared
 * and re-inserted each run, so re-seeding never duplicates. Writes straight to
 * the mirror and the conversation store — no Pipedream, no LLM (unless --live,
 * where the running server enriches the seeded mail on its next cycle).
 *
 * Start the server with TRAILIN_DEMO=1 so the demo accounts appear in the UI
 * (see demo/accounts.ts and pipedream/connect.ts).
 */

/** Provider message ids per demo account — the handle for the mirror's delete path. */
function demoDeletePages(now: Date): Array<{ accountId: string; providerMessageIds: string[] }> {
  return demoSyncPages(now).map(({ accountId, page }) => ({
    accountId,
    providerMessageIds: page.upserts.map((m) => m.providerMessageId),
  }));
}

const deleteThreadStateForAccount = sqlite.prepare(
  "DELETE FROM mail_thread_state WHERE account_id = ?",
);
const deleteSyncStateForAccount = sqlite.prepare(
  "DELETE FROM mail_sync_state WHERE account_id = ?",
);

/** Remove every demo row: golden chats, mailbox messages/threads (via the mirror's own delete), and canned triage. */
function resetDemo(now: Date): void {
  for (const chat of demoGoldenChats()) deleteConversationCascade(chat.id);
  for (const { accountId, providerMessageIds } of demoDeletePages(now)) {
    applySyncPage(accountId, {
      upserts: [],
      deletes: providerMessageIds,
      cursor: "",
      hasMore: false,
    });
  }
  for (const accountId of DEMO_ACCOUNT_IDS) {
    deleteThreadStateForAccount.run(accountId);
    deleteSyncStateForAccount.run(accountId);
  }
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

function seedMail(now: Date): number {
  let messages = 0;
  for (const { accountId, page } of demoSyncPages(now)) {
    messages += applySyncPage(accountId, page);
    // The sync engine never touches demo accounts, so mark the mirror synced
    // here — otherwise the UI reads them as a first import that never finishes.
    markSyncStatus(accountId, "idle");
  }
  return messages;
}

/** Write the canned triage so briefing / triage / waiting lanes work offline. */
function seedEnrichment(): number {
  let enriched = 0;
  for (const { accountId, providerThreadId, result } of demoEnrichments()) {
    const snapshot = snapshotThread(`${accountId}:${providerThreadId}`, accountId);
    if (!snapshot) continue;
    saveEnrichment(snapshot, result, "demo-seed");
    enriched++;
  }
  return enriched;
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const now = new Date();

  if (args.has("--reset")) {
    resetDemo(now);
    logger.info("demo: reset — all demo mail, triage and chats removed");
    return;
  }

  // Clear first so a re-seed is clean (golden chats would otherwise duplicate
  // their message rows; mail upserts are already idempotent).
  resetDemo(now);

  const messages = seedMail(now);
  const live = args.has("--live");
  const enriched = live ? 0 : seedEnrichment();
  const chats = demoGoldenChats();
  for (const chat of chats) await insertGoldenChat(chat);

  logger.info(
    { messages, enriched, chats: chats.length, mode: live ? "live" : "canned" },
    "demo: seeded",
  );
  logger.info(
    { useCases: demoUseCaseSummary() },
    live
      ? "demo: mail seeded; start the server (TRAILIN_DEMO=1) and its enrichment will triage these threads"
      : "demo: mail, canned triage and golden chats seeded — start the server with TRAILIN_DEMO=1",
  );
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    logger.fatal({ err: error }, "demo seed failed");
    process.exit(1);
  },
);
