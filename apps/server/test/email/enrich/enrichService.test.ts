import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { EnrichmentResult, ThreadSnapshot } from "../../../src/email/enrich/enrichStore.js";
import type { SyncMessage } from "../../../src/email/sync/syncProviders.js";

// db/index.ts runs its DDL as an import-time side effect and resolves its
// path through env.ts's DATABASE_PATH read, also at import time — same
// pattern as test/email/contacts/contactsService.test.ts. The active-model
// check inside runCycle is mocked so the cycle always reaches the enrich
// seam without needing real LLM credentials configured.
const tempDir = mkdtempSync(join(tmpdir(), "trailin-enrich-service-"));
const originalDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(tempDir, "test.db");

// runCycle resolves its model via llm/registry.js's resolveCheapModel
// directly, mocked below to a fixed fake model — it is never called for a
// real credential; runCycle only calls it when there is at least one stale
// candidate, and that path is exercised below.
vi.mock("../../../src/llm/registry.js", () => ({
  activeModelConfigured: vi.fn(async () => true),
  resolveCheapModel: async () => fakeModel,
}));

// fetchAccountNameMap (agent/accounts.js) calls through to this, unmocked.
vi.mock("../../../src/pipedream/connect.js", () => ({
  listAccounts: async () => [],
}));

vi.mock("../../../src/email/enrich/enrichLLM.js", () => ({
  enrichThread: async () => {
    throw new Error(
      "enrichThread should never be called directly; tests inject their own enrich fn",
    );
  },
}));

const fakeModel = { id: "test-model" } as unknown as Model<Api>;

const { sqlite } = await import("../../../src/db/index.js");
const { applySyncPage } = await import("../../../src/email/sync/mailStore.js");
const { runCycle } = await import("../../../src/email/enrich/enrichService.js");

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
    to: ["recipient@example.com"],
    cc: [],
    date: "2026-01-01T00:00:00.000Z",
    snippet: "Hi there",
    bodyText: "Hi there",
    isFromMe: false,
    isUnread: false,
    labels: [],
    ...overrides,
  };
}

function seed(accountId: string, upserts: SyncMessage[]): void {
  applySyncPage(accountId, { upserts, deletes: [], cursor: "seed", hasMore: false });
}

function state(threadId: string):
  | {
      gist: string;
      triage: string;
      error: string | null;
      model: string | null;
      enrichedAt: string;
      inputHash: string;
    }
  | undefined {
  return sqlite
    .prepare(
      `SELECT gist, triage, error, model, enriched_at AS enrichedAt, input_hash AS inputHash
       FROM mail_thread_state WHERE thread_id = ?`,
    )
    .get(threadId) as
    | {
        gist: string;
        triage: string;
        error: string | null;
        model: string | null;
        enrichedAt: string;
        inputHash: string;
      }
    | undefined;
}

/**
 * Backdates a thread's enriched_at so the timestamp prefilter is unambiguous
 * regardless of how many milliseconds these fast tests actually took (a
 * within-the-same-millisecond enriched_at from a previous test would
 * otherwise make `updated_at > enriched_at` a coin flip).
 */
function backdate(threadId: string): void {
  sqlite
    .prepare(
      "UPDATE mail_thread_state SET enriched_at = '2020-01-01T00:00:00.000Z' WHERE thread_id = ?",
    )
    .run(threadId);
}

function result(overrides: Partial<EnrichmentResult> = {}): EnrichmentResult {
  return {
    gist: "a gist",
    summary: "a summary",
    actionItems: [],
    triage: "fyi",
    urgency: "normal",
    awaitingReply: false,
    ...overrides,
  };
}

describe("runCycle", () => {
  const acct = "acct-cycle";
  const threadId = `${acct}:t-greta`;

  it("enriches a newly-stale thread and persists the report", async () => {
    seed(acct, [
      message({
        providerMessageId: "m-greta-1",
        providerThreadId: "t-greta",
        from: "greta@example.com",
        date: "2026-05-01T00:00:00.000Z",
      }),
    ]);

    const enrich = vi.fn(async (_snapshot: ThreadSnapshot) => result({ gist: "first pass" }));
    const cycleResult = await runCycle(enrich);
    expect(cycleResult.enriched).toBe(1);
    expect(enrich).toHaveBeenCalledTimes(1);

    const row = state(threadId);
    expect(row).toMatchObject({
      gist: "first pass",
      triage: "fyi",
      error: null,
      model: "test-model",
    });
  });

  it("does not re-enrich a thread whose content hasn't changed (nothing left stale)", async () => {
    // greta's updated_at predates the enriched_at just stamped above, so the
    // timestamp prefilter finds nothing to look at at all.
    const enrich = vi.fn(async () => result());
    const cycleResult = await runCycle(enrich);
    expect(cycleResult.enriched).toBe(0);
    expect(cycleResult.untouched).toBe(0);
    expect(enrich).not.toHaveBeenCalled();
    expect(state(threadId)?.gist).toBe("first pass");
  });

  it("skips the LLM and only touches enriched_at when a re-sync leaves the message-id hash unchanged", async () => {
    backdate(threadId);
    const before = state(threadId);
    // Same message id, only the unread flag flips — recomputeThread bumps
    // mail_threads.updated_at without adding a message, so the input hash
    // (which hashes message ids only) stays identical.
    seed(acct, [
      message({
        providerMessageId: "m-greta-1",
        providerThreadId: "t-greta",
        from: "greta@example.com",
        date: "2026-05-01T00:00:00.000Z",
        isUnread: true,
      }),
    ]);

    const enrich = vi.fn(async () => result({ gist: "should not be used" }));
    const cycleResult = await runCycle(enrich);
    expect(cycleResult.untouched).toBe(1);
    expect(cycleResult.enriched).toBe(0);
    expect(enrich).not.toHaveBeenCalled();

    const after = state(threadId);
    expect(after?.gist).toBe("first pass"); // untouched content
    expect(after?.inputHash).toBe(before?.inputHash);
    expect(after?.enrichedAt).not.toBe(before?.enrichedAt); // timestamp refreshed
  });

  it("re-enriches once new mail changes the thread's hash", async () => {
    backdate(threadId);
    seed(acct, [
      message({
        providerMessageId: "m-greta-2",
        providerThreadId: "t-greta",
        from: "greta@example.com",
        subject: "Second message",
        date: "2026-05-02T00:00:00.000Z",
      }),
    ]);

    const enrich = vi.fn(async (snapshot: ThreadSnapshot) => {
      expect(snapshot.messages).toHaveLength(2);
      return result({ gist: "second pass" });
    });
    const cycleResult = await runCycle(enrich);
    expect(cycleResult.enriched).toBe(1);
    expect(enrich).toHaveBeenCalledTimes(1);
    expect(state(threadId)?.gist).toBe("second pass");
  });

  it("records a failed enrichment's error without losing the previous good gist, and backs off retrying it", async () => {
    backdate(threadId);
    seed(acct, [
      message({
        providerMessageId: "m-greta-3",
        providerThreadId: "t-greta",
        from: "greta@example.com",
        subject: "Third message",
        date: "2026-05-03T00:00:00.000Z",
      }),
    ]);

    const failing = vi.fn(async () => {
      throw new Error("model unavailable");
    });
    const cycleResult = await runCycle(failing);
    expect(cycleResult.failed).toBe(1);

    const row = state(threadId);
    expect(row?.error).toBe("model unavailable");
    expect(row?.gist).toBe("second pass"); // stale beats none

    // Immediately re-running must not retry — still inside the backoff window.
    const retry = vi.fn(async () => result());
    await runCycle(retry);
    expect(retry).not.toHaveBeenCalled();
  });

  it("retries a failed thread once the backoff elapses, even with unchanged content", async () => {
    // The thread is still in `error` state from the previous test, its
    // message-id hash unchanged. Backdate enriched_at past the 10-minute
    // error backoff so the candidate query surfaces it again — an errored row
    // must NOT be treated as "content still current" and touch-skipped.
    backdate(threadId);

    const recovered = vi.fn(async () => result({ gist: "recovered gist" }));
    const cycleResult = await runCycle(recovered);
    expect(recovered).toHaveBeenCalledTimes(1);
    expect(cycleResult.enriched).toBe(1);

    const row = state(threadId);
    expect(row?.error).toBeNull();
    expect(row?.gist).toBe("recovered gist");
  });

  it("does nothing when no LLM is configured", async () => {
    const { activeModelConfigured } = await import("../../../src/llm/registry.js");
    vi.mocked(activeModelConfigured).mockResolvedValueOnce(false);
    const enrich = vi.fn(async () => result());
    const cycleResult = await runCycle(enrich);
    expect(cycleResult).toEqual({ enriched: 0, failed: 0, untouched: 0 });
    expect(enrich).not.toHaveBeenCalled();
  });
});
