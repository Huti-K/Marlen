import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConnectedAccount } from "@trailin/shared";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { SyncMessage } from "../../src/email/sync/syncProviders.js";

// db/index.ts runs its DDL as an import-time side effect resolved via
// env.ts's DATABASE_PATH read — same pattern as test/email/sync/mailQuery.test.ts
// — so this suite gets its own scratch database.
const tempDir = mkdtempSync(join(tmpdir(), "trailin-mail-tools-"));
const originalDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(tempDir, "test.db");

// read_thread/lookup_contact resolve the `account` param the same way every
// other agent tool does — via listAccounts() — so it's stubbed the same way
// test/agent/accounts.test.ts stubs it, instead of hitting Pipedream.
const listAccountsMock = vi.fn<() => Promise<ConnectedAccount[]>>();
vi.mock("../../src/pipedream/connect.js", () => ({
  listAccounts: () => listAccountsMock(),
}));

// refreshMirror judges freshness by the sync-state row AFTER the attempt (a
// failed runSync records "error" there rather than rejecting), so the attempt
// itself is stubbed to a no-op and each test writes the post-attempt state it
// wants via markSyncStatus.
vi.mock("../../src/email/sync/syncEngine.js", () => ({
  syncAccount: vi.fn(async () => {}),
}));

// read_thread's fullHistory path resolves its provider through
// getSyncProvider; steered here per app slug so the capability, its absence,
// and its failure are all exercisable without real providers (registering a
// fake is reserved for register*.ts files by the conventions check).
const fetchThreadMock = vi.fn<() => Promise<SyncMessage[]>>();
vi.mock("../../src/email/sync/syncProviders.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/email/sync/syncProviders.js")>();
  const unused = async () => {
    throw new Error("fetchChanges is not under test");
  };
  return {
    ...original,
    getSyncProvider: (app: string) => {
      if (app === "gmail") return { fetchChanges: unused, fetchThread: () => fetchThreadMock() };
      if (app === "microsoft_outlook") return { fetchChanges: unused };
      return null;
    },
  };
});

const { db, schema, sqlite } = await import("../../src/db/index.js");
const { applySyncPage, markSyncStatus } = await import("../../src/email/sync/mailStore.js");
const { createMemory } = await import("../../src/db/memories.js");
const { buildMailReadTools } = await import("../../src/agent/mailTools.js");

afterAll(() => {
  sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
});

function account(id: string, name: string): ConnectedAccount {
  return { id, app: "gmail", appName: "Gmail", name, healthy: true, createdAt: "2026-01-01" };
}

async function seedContact(
  address: string,
  overrides: Partial<typeof schema.contacts.$inferInsert> = {},
) {
  await db.insert(schema.contacts).values({
    address,
    displayName: "",
    kind: "person",
    category: "other",
    categorySource: "auto",
    gist: "",
    accounts: "[]",
    messageCount: 3,
    sentCount: 1,
    lastContactAt: "2026-01-01T00:00:00.000Z",
    inputHash: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  });
}

/** Fills in every SyncMessage field a fixture doesn't care about. */
function message(
  overrides: Partial<SyncMessage> & Pick<SyncMessage, "providerMessageId" | "providerThreadId">,
): SyncMessage {
  return {
    subject: "",
    from: "sender@example.com",
    to: ["recipient@example.com"],
    cc: [],
    date: "2026-01-01T00:00:00.000Z",
    snippet: "",
    bodyText: "",
    isFromMe: false,
    isUnread: false,
    labels: [],
    ...overrides,
  };
}

function seed(accountId: string, upserts: SyncMessage[]): void {
  applySyncPage(accountId, { upserts, deletes: [], cursor: "seed", hasMore: false });
}

const tools = buildMailReadTools();
const readThread = tools.find((t) => t.name === "read_thread");
const lookupContact = tools.find((t) => t.name === "lookup_contact");
const searchMailTool = tools.find((t) => t.name === "search_mail");
if (!readThread || !lookupContact || !searchMailTool) {
  throw new Error("read_thread/lookup_contact/search_mail not registered");
}

function textOf(result: { content: { type: string; text?: string }[] }): string {
  return result.content.map((c) => c.text ?? "").join("");
}

describe("read_thread — known-contact injection", () => {
  const acct = "acct-known-contact";

  it("appends nothing when no participant is known", async () => {
    listAccountsMock.mockResolvedValue([account(acct, "work@example.com")]);
    seed(acct, [
      message({
        providerMessageId: "m-unknown-1",
        providerThreadId: "t-unknown",
        from: "stranger@example.com",
        to: ["work@example.com"],
      }),
    ]);
    const result = await readThread.execute("call-1", { threadId: "t-unknown" } as never);
    expect(textOf(result)).not.toContain("Known contact");
  });

  it("appends a compact block for a participant with a person contact row", async () => {
    await seedContact("anna@firm.de", {
      displayName: "Anna Becker",
      gist: "your accountant; formal tone",
    });
    await createMemory("Prefers Du", "user", null, "anna@firm.de");

    seed(acct, [
      message({
        providerMessageId: "m-known-1",
        providerThreadId: "t-known",
        from: "anna@firm.de",
        to: ["work@example.com"],
        bodyText: "Please send the invoice.",
      }),
    ]);
    const result = await readThread.execute("call-2", { threadId: "t-known" } as never);
    const text = textOf(result);
    expect(text).toContain(
      "[Known contact: Anna Becker <anna@firm.de> — your accountant; formal tone. Notes: Prefers Du.]",
    );
  });

  it("skips a participant with a bulk contact row even if it has a gist", async () => {
    await seedContact("newsletter@brand.com", { kind: "bulk", gist: "weekly digest" });
    seed(acct, [
      message({
        providerMessageId: "m-bulk-1",
        providerThreadId: "t-bulk",
        from: "newsletter@brand.com",
        to: ["work@example.com"],
      }),
    ]);
    const result = await readThread.execute("call-3", { threadId: "t-bulk" } as never);
    expect(textOf(result)).not.toContain("Known contact");
  });

  it("covers every from/to/cc participant, not just the sender", async () => {
    await seedContact("cc-person@example.com", { displayName: "Cc Person", gist: "vendor rep" });
    seed(acct, [
      message({
        providerMessageId: "m-cc-1",
        providerThreadId: "t-cc",
        from: "stranger2@example.com",
        to: ["work@example.com"],
        cc: ["cc-person@example.com"],
      }),
    ]);
    const result = await readThread.execute("call-4", { threadId: "t-cc" } as never);
    expect(textOf(result)).toContain("Cc Person <cc-person@example.com> — vendor rep");
  });

  it("caps quoted contact memories at 5", async () => {
    await seedContact("chatty@example.com", { displayName: "Chatty" });
    for (let i = 0; i < 7; i++) {
      await createMemory(`Note number ${i}`, "user", null, "chatty@example.com");
    }
    seed(acct, [
      message({
        providerMessageId: "m-chatty-1",
        providerThreadId: "t-chatty",
        from: "chatty@example.com",
        to: ["work@example.com"],
      }),
    ]);
    const result = await readThread.execute("call-5", { threadId: "t-chatty" } as never);
    const text = textOf(result);
    expect(text).toContain("Note number 0");
    expect(text).toContain("Note number 4");
    expect(text).not.toContain("Note number 5");
    expect(text).not.toContain("Note number 6");
  });
});

describe("lookup_contact", () => {
  it("returns a not-found message for no match", async () => {
    const result = await lookupContact.execute("call-6", { query: "nobody-at-all" } as never);
    expect(textOf(result)).toContain("No local contact matches");
  });

  it("matches by address or name fragment and includes aggregates and memories", async () => {
    await seedContact("lookup-a@example.com", {
      displayName: "Lookup Target",
      gist: "long-time client",
      category: "client_business",
      messageCount: 12,
      sentCount: 4,
      lastContactAt: "2026-02-01T00:00:00.000Z",
    });
    await createMemory("Always wants a call, not email", "user", null, "lookup-a@example.com");

    const result = await lookupContact.execute("call-7", { query: "Lookup Target" } as never);
    const text = textOf(result);
    expect(text).toContain("Lookup Target <lookup-a@example.com> — person, client_business");
    expect(text).toContain("long-time client");
    expect(text).toContain("12 message(s), 4 sent");
    expect(text).toContain("Always wants a call, not email");
  });

  it("sorts person contacts before bulk contacts", async () => {
    await seedContact("sort-person@dup.com", { displayName: "Sort Person", kind: "person" });
    await seedContact("sort-bulk@dup.com", { displayName: "Sort Bulk", kind: "bulk" });
    const result = await lookupContact.execute("call-8", { query: "dup.com" } as never);
    const text = textOf(result);
    expect(text.indexOf("Sort Person")).toBeLessThan(text.indexOf("Sort Bulk"));
  });

  it("requires a non-empty query", async () => {
    const result = await lookupContact.execute("call-9", { query: "  " } as never);
    expect(textOf(result)).toContain("Provide an email address or name");
  });
});

describe("read_thread — fullHistory", () => {
  const acct = "acct-history";

  // Only the recent tail of a years-long conversation is in the mirror.
  seed(acct, [
    message({
      providerMessageId: "m-hist-recent",
      providerThreadId: "t-hist",
      from: "old-client@example.com",
      to: ["work@example.com"],
      subject: "Projekt Alpha",
      bodyText: "Latest reply in a long conversation",
      date: "2026-07-10T00:00:00.000Z",
    }),
  ]);

  it("fetches the complete history, persists it, and serves the merged thread", async () => {
    listAccountsMock.mockResolvedValue([account(acct, "work@example.com")]);
    fetchThreadMock.mockResolvedValueOnce([
      message({
        providerMessageId: "m-hist-old",
        providerThreadId: "t-hist",
        from: "old-client@example.com",
        to: ["work@example.com"],
        subject: "Projekt Alpha",
        bodyText: "Original agreement from years ago",
        date: "2023-03-01T00:00:00.000Z",
      }),
    ]);

    const result = await readThread.execute("call-h1", {
      threadId: "t-hist",
      fullHistory: true,
    } as never);
    const text = textOf(result);
    expect(text).toContain("Original agreement from years ago");
    expect(text).toContain("Latest reply in a long conversation");
    expect(text).toContain("2 message(s)");
    expect(text).not.toContain("Full history unavailable");

    // Write-through persisted: a later plain read serves both messages.
    const again = await readThread.execute("call-h2", { threadId: "t-hist" } as never);
    expect(textOf(again)).toContain("2 message(s)");
  });

  it("notes the missing capability and still serves the mirrored messages", async () => {
    const outlookAcct = "acct-history-outlook";
    listAccountsMock.mockResolvedValue([
      { ...account(outlookAcct, "work@o365.example"), app: "microsoft_outlook" },
    ]);
    seed(outlookAcct, [
      message({
        providerMessageId: "m-hist-o1",
        providerThreadId: "t-hist-o",
        bodyText: "Mirrored Outlook message",
      }),
    ]);

    const result = await readThread.execute("call-h3", {
      threadId: "t-hist-o",
      fullHistory: true,
    } as never);
    const text = textOf(result);
    expect(text).toContain("Full history unavailable");
    expect(text).toContain("no thread-history fetch");
    expect(text).toContain("Mirrored Outlook message");
  });

  it("notes a failed live fetch and still serves the mirrored messages", async () => {
    listAccountsMock.mockResolvedValue([account(acct, "work@example.com")]);
    fetchThreadMock.mockRejectedValueOnce(new Error("proxy down"));

    const result = await readThread.execute("call-h4", {
      threadId: "t-hist",
      fullHistory: true,
    } as never);
    const text = textOf(result);
    expect(text).toContain("Full history unavailable");
    expect(text).toContain("proxy down");
    expect(text).toContain("Latest reply in a long conversation");
  });
});

describe("search_mail — freshness warning on failed refresh", () => {
  const acct = "acct-freshness";

  seed(acct, [
    message({
      providerMessageId: "m-fresh-1",
      providerThreadId: "t-fresh-1",
      subject: "Freshness probe",
      bodyText: "zx-freshness-probe details",
      to: ["owner@fresh.example"],
    }),
  ]);

  it("prepends a warning naming the account and its last successful sync", async () => {
    listAccountsMock.mockResolvedValue([account(acct, "owner@fresh.example")]);
    // A prior good sync stamps last_synced_at; the failed attempt keeps it
    // (markSyncStatus COALESCEs it on error) and flips status to "error".
    markSyncStatus(acct, "idle");
    markSyncStatus(acct, "error", "Gmail API 401");

    const result = await searchMailTool.execute("call-f1", {
      query: "zx-freshness-probe",
      refresh: true,
    } as never);
    const text = textOf(result);
    expect(text).toContain("Freshness warning");
    expect(text).toContain("owner@fresh.example");
    expect(text).toContain("mail current as of");
    // The hits themselves still follow the warning.
    expect(text).toContain("Freshness probe");
  });

  it("adds nothing when the refresh leaves the account idle", async () => {
    listAccountsMock.mockResolvedValue([account(acct, "owner@fresh.example")]);
    markSyncStatus(acct, "idle");

    const result = await searchMailTool.execute("call-f2", {
      query: "zx-freshness-probe",
      refresh: true,
    } as never);
    expect(textOf(result)).not.toContain("Freshness warning");
  });

  it("adds nothing without the refresh flag even while the account is in error", async () => {
    listAccountsMock.mockResolvedValue([account(acct, "owner@fresh.example")]);
    markSyncStatus(acct, "error", "Gmail API 401");

    const result = await searchMailTool.execute("call-f3", {
      query: "zx-freshness-probe",
    } as never);
    expect(textOf(result)).not.toContain("Freshness warning");
  });
});
