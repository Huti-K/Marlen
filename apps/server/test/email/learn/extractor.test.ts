import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConnectedAccount } from "@trailin/shared";
import { afterAll, describe, expect, it } from "vitest";

// Same DATABASE_PATH isolation dance as matcher.test.ts: point it at a fresh
// temp file before anything pulls db/index.ts in. The DB holds only the
// draft snapshots; sent bodies come through the injected reader seam.
const tempDir = mkdtempSync(join(tmpdir(), "trailin-learn-extract-"));
const originalDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(tempDir, "test.db");

const { sqlite } = await import("../../../src/db/index.js");
const { createDraftSnapshot, markDraftStatus, listUnlearnedSentDrafts } = await import(
  "../../../src/db/draftStore.js"
);
const { listMemories } = await import("../../../src/db/memories.js");
const { runExtractionSweep } = await import("../../../src/email/learn/extractor.js");
type SweepDeps = NonNullable<Parameters<typeof runExtractionSweep>[0]>;

afterAll(() => {
  sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
});

function account(id: string): ConnectedAccount {
  return {
    id,
    app: "gmail",
    appName: "Gmail",
    name: `${id}@example.com`,
    healthy: true,
    createdAt: "2026-01-01",
  };
}

/** Creates a snapshot, then moves it straight to sent+unlearned via markDraftStatus, as the matcher would. */
async function seedSentSnapshot(input: {
  accountId: string;
  providerDraftId: string;
  signature: string | null;
  draftBody: string;
  sentMessageId: string;
}): Promise<void> {
  await createDraftSnapshot({
    accountId: input.accountId,
    providerDraftId: input.providerDraftId,
    subject: "Subject",
    to: ["them@example.com"],
    signature: input.signature,
    body: input.draftBody,
  });
  await markDraftStatus(input.accountId, input.providerDraftId, "sent", input.sentMessageId);
}

async function neverCalledExtract(): Promise<string[]> {
  throw new Error("extract should not have been called for this sweep");
}

/** Sweep with sent bodies served per account id from an in-memory map keyed by provider message id. */
function sweep(
  accountIds: string[],
  bodiesByMessageId: Record<string, string>,
  extract: SweepDeps["extract"] = neverCalledExtract,
): Promise<void> {
  return runExtractionSweep({
    extract,
    listAccounts: async () => accountIds.map(account),
    readerFor: () => ({
      listSentSince: async () => [],
      getMessageBody: async (_acct, providerMessageId) =>
        bodiesByMessageId[providerMessageId] ?? null,
    }),
  });
}

describe("runExtractionSweep — identical pair", () => {
  it("stamps learned_at without calling the LLM seam or writing a memory, ignoring whitespace differences", async () => {
    const accountId = "acct-extract-identical";
    const providerDraftId = "draft-identical-1";
    const signature = "Best,\nAlice";

    await seedSentSnapshot({
      accountId,
      providerDraftId,
      signature,
      draftBody: "Hello there.\n\nBest,\nAlice",
      sentMessageId: "sent-identical-1",
    });

    // The sent copy differs only in whitespace — still "identical" once both
    // sides are whitespace-normalized and the signature is stripped.
    await sweep([accountId], { "sent-identical-1": "Hello   there.\n\n\nBest,\nAlice" });

    const pending = await listUnlearnedSentDrafts();
    expect(pending.some((p) => p.providerDraftId === providerDraftId)).toBe(false);

    const memories = await listMemories();
    expect(memories.some((m) => m.accountId === accountId)).toBe(false);
  });
});

describe("runExtractionSweep — differing pair", () => {
  it("writes each reported directive as an account-scoped memory and stamps learned_at", async () => {
    const accountId = "acct-extract-differing";
    const providerDraftId = "draft-differing-1";

    await seedSentSnapshot({
      accountId,
      providerDraftId,
      signature: null,
      draftBody: "Hi, please find the report attached. Let me know if you have questions.",
      sentMessageId: "sent-differing-1",
    });

    let receivedAccountName: string | undefined;
    let receivedPairCount: number | undefined;
    await sweep(
      [accountId],
      { "sent-differing-1": "Hey! Report's attached — shout if anything's unclear." },
      async (input) => {
        receivedAccountName = input.accountName;
        receivedPairCount = input.pairs.length;
        return ['Opens casually ("Hey!") rather than formally.'];
      },
    );

    expect(receivedPairCount).toBe(1);
    expect(receivedAccountName).toBeTruthy();

    const pending = await listUnlearnedSentDrafts();
    expect(pending.some((p) => p.providerDraftId === providerDraftId)).toBe(false);

    const memories = await listMemories();
    const written = memories.find(
      (m) =>
        m.accountId === accountId && m.content === 'Opens casually ("Hey!") rather than formally.',
    );
    expect(written).toBeDefined();
    expect(written?.source).toBe("agent");
  });

  it("stamps learned_at on every pair in the batch even when the seam reports zero directives", async () => {
    const accountId = "acct-extract-empty-directives";
    const providerDraftId = "draft-differing-empty";

    await seedSentSnapshot({
      accountId,
      providerDraftId,
      signature: null,
      draftBody: "Draft body one.",
      sentMessageId: "sent-empty-1",
    });

    await sweep([accountId], { "sent-empty-1": "Sent body one, quite different." }, async () => []);

    const pending = await listUnlearnedSentDrafts();
    expect(pending.some((p) => p.providerDraftId === providerDraftId)).toBe(false);
  });
});

describe("runExtractionSweep — unresolved sent message", () => {
  it("leaves the pair pending (and never calls the seam) when the provider no longer serves the sent message", async () => {
    const accountId = "acct-extract-unresolved";
    const providerDraftId = "draft-unresolved-1";

    await seedSentSnapshot({
      accountId,
      providerDraftId,
      signature: null,
      draftBody: "Draft body.",
      sentMessageId: "sent-gone",
    });

    // The reader map has no entry for this id — getMessageBody returns null.
    await sweep([accountId], {});

    const pending = await listUnlearnedSentDrafts();
    expect(pending.some((p) => p.providerDraftId === providerDraftId)).toBe(true);
  });

  it("leaves the pair pending when the body fetch throws, without aborting the sweep", async () => {
    const accountId = "acct-extract-fetch-fails";
    const providerDraftId = "draft-fetch-fails";

    await seedSentSnapshot({
      accountId,
      providerDraftId,
      signature: null,
      draftBody: "Draft body.",
      sentMessageId: "sent-timeout",
    });

    await runExtractionSweep({
      extract: neverCalledExtract,
      listAccounts: async () => [account(accountId)],
      readerFor: () => ({
        listSentSince: async () => [],
        getMessageBody: async () => {
          throw new Error("proxy timeout");
        },
      }),
    });

    const pending = await listUnlearnedSentDrafts();
    expect(pending.some((p) => p.providerDraftId === providerDraftId)).toBe(true);
  });

  it("leaves the pair pending when the account is disconnected or has no read driver", async () => {
    const accountId = "acct-extract-disconnected";
    const providerDraftId = "draft-disconnected";

    await seedSentSnapshot({
      accountId,
      providerDraftId,
      signature: null,
      draftBody: "Draft body.",
      sentMessageId: "sent-x",
    });

    await runExtractionSweep({
      extract: neverCalledExtract,
      listAccounts: async () => [],
      readerFor: () => null,
    });

    const pending = await listUnlearnedSentDrafts();
    expect(pending.some((p) => p.providerDraftId === providerDraftId)).toBe(true);
  });
});
