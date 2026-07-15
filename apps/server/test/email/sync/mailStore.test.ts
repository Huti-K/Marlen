import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { SyncMessage } from "../../../src/email/sync/syncProviders.js";

// db/index.ts runs its DDL as an import-time side effect and resolves its path
// through env.ts's DATABASE_PATH read, also at import time — same pattern as
// test/email/contacts/contactsService.test.ts.
const tempDir = mkdtempSync(join(tmpdir(), "trailin-mailstore-"));
const originalDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(tempDir, "test.db");

const { sqlite } = await import("../../../src/db/index.js");
const { applySyncPage } = await import("../../../src/email/sync/mailStore.js");
const { persistMessageHeaders } = await import("../../../src/email/unsubscribe/store.js");

afterAll(() => {
  sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
});

/** Fills in every SyncMessage field a fixture doesn't care about. */
function message(
  overrides: Partial<SyncMessage> & Pick<SyncMessage, "providerMessageId" | "providerThreadId">,
): SyncMessage {
  return {
    subject: "Hello",
    from: "sender@example.com",
    to: ["owner@example.com"],
    cc: [],
    date: "2026-01-01T00:00:00.000Z",
    snippet: "Hi",
    bodyText: "Hi",
    isFromMe: false,
    isUnread: false,
    labels: [],
    ...overrides,
  };
}

function headerOf(
  accountId: string,
  providerMessageId: string,
): { list_unsubscribe: string | null; list_unsubscribe_post: number | null } {
  return sqlite
    .prepare(
      "SELECT list_unsubscribe, list_unsubscribe_post FROM mail_messages " +
        "WHERE account_id = ? AND provider_message_id = ?",
    )
    .get(accountId, providerMessageId) as {
    list_unsubscribe: string | null;
    list_unsubscribe_post: number | null;
  };
}

function seed(accountId: string, upserts: SyncMessage[], cursor: string): void {
  applySyncPage(accountId, { upserts, deletes: [], cursor, hasMore: false });
}

describe("applySyncPage — List-Unsubscribe header preservation", () => {
  const acct = "acct-hdr";

  it("keeps a lazily-resolved header when a later sync page doesn't re-supply it", () => {
    // A provider that carries no headers on the sync page (the Outlook shape).
    seed(acct, [message({ providerMessageId: "m1", providerThreadId: "t1" })], "c1");
    expect(headerOf(acct, "m1").list_unsubscribe).toBeNull();

    // The unsubscribe pipeline resolves and writes the header back.
    persistMessageHeaders(acct, "m1", {
      listUnsubscribe: "https://l.example.com/u",
      listUnsubscribePost: true,
    });
    expect(headerOf(acct, "m1")).toMatchObject({
      list_unsubscribe: "https://l.example.com/u",
      list_unsubscribe_post: 1,
    });

    // A later page touches the same message (e.g. a read-flip) but still carries
    // no header — the resolved value must survive, not be clobbered back to null.
    seed(
      acct,
      [message({ providerMessageId: "m1", providerThreadId: "t1", isUnread: true })],
      "c2",
    );
    expect(headerOf(acct, "m1")).toMatchObject({
      list_unsubscribe: "https://l.example.com/u",
      list_unsubscribe_post: 1,
    });
  });

  it("still lets a provider that does supply a header overwrite the stored value", () => {
    seed(
      acct,
      [
        message({
          providerMessageId: "m2",
          providerThreadId: "t2",
          listUnsubscribe: "https://old.example.com/u",
          listUnsubscribePost: false,
        }),
      ],
      "c3",
    );
    expect(headerOf(acct, "m2").list_unsubscribe).toBe("https://old.example.com/u");

    // A re-sync carrying a real (new) header replaces it — COALESCE only guards
    // against a null incoming value, never a present one.
    seed(
      acct,
      [
        message({
          providerMessageId: "m2",
          providerThreadId: "t2",
          listUnsubscribe: "https://new.example.com/u",
          listUnsubscribePost: true,
        }),
      ],
      "c4",
    );
    expect(headerOf(acct, "m2")).toMatchObject({
      list_unsubscribe: "https://new.example.com/u",
      list_unsubscribe_post: 1,
    });
  });
});
