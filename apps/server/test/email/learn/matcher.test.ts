import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConnectedAccount } from "@trailin/shared";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { SentMessage } from "../../../src/email/read/readProviders.js";

// db/index.ts runs its DDL as an import-time side effect and resolves its
// path through env.ts's DATABASE_PATH read, also at import time — point
// DATABASE_PATH at a fresh temp file before anything pulls db/index.ts in,
// then import everything dynamically. The DB holds only the draft snapshots;
// sent-mail candidates come through the injected reader seam.
const tempDir = mkdtempSync(join(tmpdir(), "trailin-learn-match-"));
const originalDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(tempDir, "test.db");

const { sqlite } = await import("../../../src/db/index.js");
const { createDraftSnapshot, getDraftStatus } = await import("../../../src/db/draftStore.js");
const { runMatchSweep } = await import("../../../src/email/learn/matcher.js");
type SweepDeps = NonNullable<Parameters<typeof runMatchSweep>[0]>;
type TiebreakInput = Parameters<NonNullable<SweepDeps["tiebreak"]>>[0];

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

/** Fills in every SentMessage field a fixture doesn't care about. Dates default
 *  to 2030 so they always postdate a snapshot's real-clock createdAt. */
function message(
  overrides: Partial<SentMessage> & Pick<SentMessage, "providerMessageId" | "providerThreadId">,
): SentMessage {
  return {
    subject: "",
    to: ["them@example.com"],
    date: "2030-01-01T00:00:00.000Z",
    bodyText: "",
    ...overrides,
  };
}

/** A timestamp `offsetMs` after the real clock — standalone drafts only match within a
 *  7-day window of their (real-clock) createdAt, so their candidates can't use the fixed
 *  far-future dates the thread-match tests use (no such window applies to those). */
function soon(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

/** Fails the test loudly if the deterministic rules ever fall through to the tiebreak seam. */
async function neverCalledTiebreak(): Promise<string | null> {
  throw new Error("tiebreak should not have been called for a deterministic match");
}

/** Sweep with candidates served per account id; unknown accounts are simply absent from listAccounts. */
function sweep(
  candidatesByAccount: Record<string, SentMessage[]>,
  tiebreak: SweepDeps["tiebreak"] = neverCalledTiebreak,
): ReturnType<typeof runMatchSweep> {
  return runMatchSweep({
    tiebreak,
    listAccounts: async () => Object.keys(candidatesByAccount).map(account),
    readerFor: () => ({
      listSentSince: async (acct) => candidatesByAccount[acct.id] ?? [],
      getMessageBody: async () => null,
    }),
  });
}

describe("runMatchSweep — reply drafts (thread match)", () => {
  const accountId = "acct-thread-match";

  it("matches the earliest sent message in the same thread, ignoring a later one and other threads", async () => {
    await createDraftSnapshot({
      accountId,
      providerDraftId: "draft-thread-1",
      threadId: "thread-1",
      subject: "Re: Project update",
      to: ["them@example.com"],
      signature: null,
      body: "Draft body.",
    });

    await sweep({
      [accountId]: [
        message({
          providerMessageId: "m-thread-early",
          providerThreadId: "thread-1",
          date: "2030-01-02T00:00:00.000Z",
        }),
        message({
          providerMessageId: "m-thread-late",
          providerThreadId: "thread-1",
          date: "2030-01-03T00:00:00.000Z",
        }),
        message({
          providerMessageId: "m-other-thread",
          providerThreadId: "thread-2",
          date: "2030-01-01T00:00:00.000Z",
        }),
      ],
    });

    expect(await getDraftStatus(accountId, "draft-thread-1")).toEqual({
      status: "sent",
      sentMessageId: "m-thread-early",
    });
  });

  it("leaves a reply draft open when nothing has landed in its thread yet", async () => {
    await createDraftSnapshot({
      accountId,
      providerDraftId: "draft-thread-2",
      threadId: "thread-unanswered",
      subject: "Re: Still pending",
      to: ["them@example.com"],
      signature: null,
      body: "Draft body.",
    });

    await sweep({ [accountId]: [] });

    expect(await getDraftStatus(accountId, "draft-thread-2")).toEqual({ status: "open" });
  });
});

describe("runMatchSweep — standalone drafts (recipients + subject match)", () => {
  const accountId = "acct-standalone-match";

  it("matches on normalized recipients and subject despite display names, case, and a reply prefix", async () => {
    await createDraftSnapshot({
      accountId,
      providerDraftId: "draft-standalone-1",
      subject: "Invoice for March",
      to: ["Alice <alice@example.com>", "bob@example.com"],
      signature: null,
      body: "Draft body.",
    });

    await sweep({
      [accountId]: [
        message({
          providerMessageId: "m-standalone-hit",
          providerThreadId: "thread-x",
          subject: "Re: Invoice for March",
          to: ["ALICE@Example.com", "Bob <bob@example.com>"],
          date: soon(1_000),
        }),
        message({
          providerMessageId: "m-standalone-miss-subject",
          providerThreadId: "thread-y",
          subject: "Unrelated",
          to: ["alice@example.com", "bob@example.com"],
          date: soon(1_000),
        }),
        message({
          providerMessageId: "m-standalone-miss-recipient",
          providerThreadId: "thread-z",
          subject: "Invoice for March",
          to: ["carol@example.com"],
          date: soon(1_000),
        }),
      ],
    });

    expect(await getDraftStatus(accountId, "draft-standalone-1")).toEqual({
      status: "sent",
      sentMessageId: "m-standalone-hit",
    });
  });

  it("stays open when no candidate has been sent at all", async () => {
    await createDraftSnapshot({
      accountId,
      providerDraftId: "draft-standalone-2",
      subject: "Nothing sent yet",
      to: ["dana@example.com"],
      signature: null,
      body: "Draft body.",
    });

    await sweep({ [accountId]: [] });

    expect(await getDraftStatus(accountId, "draft-standalone-2")).toEqual({ status: "open" });
  });
});

describe("runMatchSweep — ambiguous standalone match falls to the injected tiebreak seam", () => {
  const accountId = "acct-tiebreak";

  function ambiguousCandidates(providerDraftId: string): SentMessage[] {
    return [
      message({
        providerMessageId: `${providerDraftId}-cand-a`,
        providerThreadId: "t-a",
        subject: "Quick question",
        to: ["dana@example.com"],
        date: soon(1_000),
        bodyText: "Body A",
      }),
      message({
        providerMessageId: `${providerDraftId}-cand-b`,
        providerThreadId: "t-b",
        subject: "Quick question",
        to: ["dana@example.com"],
        date: soon(2_000),
        bodyText: "Body B",
      }),
    ];
  }

  async function seedAmbiguousDraft(providerDraftId: string): Promise<void> {
    await createDraftSnapshot({
      accountId,
      providerDraftId,
      subject: "Quick question",
      to: ["dana@example.com"],
      signature: null,
      body: "Are we still on for Friday?",
    });
  }

  it("marks the candidate the seam picks, passing it the snapshot's latest body and every candidate", async () => {
    const providerDraftId = "draft-tiebreak-pick";
    await seedAmbiguousDraft(providerDraftId);

    let received: TiebreakInput | undefined;
    await sweep({ [accountId]: ambiguousCandidates(providerDraftId) }, async (input) => {
      received = input;
      return `${providerDraftId}-cand-b`;
    });

    expect(received?.latestBody).toBe("Are we still on for Friday?");
    expect(received?.candidates.map((c) => c.providerMessageId).sort()).toEqual(
      [`${providerDraftId}-cand-a`, `${providerDraftId}-cand-b`].sort(),
    );
    expect(
      received?.candidates.find((c) => c.providerMessageId === `${providerDraftId}-cand-b`)?.body,
    ).toBe("Body B");

    expect(await getDraftStatus(accountId, providerDraftId)).toEqual({
      status: "sent",
      sentMessageId: `${providerDraftId}-cand-b`,
    });
  });

  it("leaves the draft open when the seam reports no confident match", async () => {
    const providerDraftId = "draft-tiebreak-none";
    await seedAmbiguousDraft(providerDraftId);

    await sweep({ [accountId]: ambiguousCandidates(providerDraftId) }, async () => null);

    expect(await getDraftStatus(accountId, providerDraftId)).toEqual({ status: "open" });
  });

  it("leaves the draft open (and keeps sweeping other drafts) when the seam throws", async () => {
    const providerDraftId = "draft-tiebreak-error";
    await seedAmbiguousDraft(providerDraftId);

    // A second, deterministic draft in the same sweep proves one seam's
    // failure doesn't abort the rest of the sweep.
    await createDraftSnapshot({
      accountId,
      providerDraftId: "draft-alongside-error",
      threadId: "thread-alongside",
      subject: "Re: Separate thread",
      to: ["dana@example.com"],
      signature: null,
      body: "Draft body.",
    });

    await sweep(
      {
        [accountId]: [
          ...ambiguousCandidates(providerDraftId),
          message({
            providerMessageId: "m-alongside",
            providerThreadId: "thread-alongside",
            date: "2030-03-01T00:00:00.000Z",
          }),
        ],
      },
      async () => {
        throw new Error("boom");
      },
    );

    expect(await getDraftStatus(accountId, providerDraftId)).toEqual({ status: "open" });
    expect(await getDraftStatus(accountId, "draft-alongside-error")).toEqual({
      status: "sent",
      sentMessageId: "m-alongside",
    });
  });
});

describe("runMatchSweep — live-fetch batching and per-account failure isolation", () => {
  it("makes one listSentSince call per account, anchored at that account's oldest open draft", async () => {
    const accountId = "acct-batching";
    await createDraftSnapshot({
      accountId,
      providerDraftId: "draft-batch-1",
      threadId: "thread-b1",
      subject: "Re: One",
      to: ["a@example.com"],
      signature: null,
      body: "Draft body.",
    });
    await createDraftSnapshot({
      accountId,
      providerDraftId: "draft-batch-2",
      threadId: "thread-b2",
      subject: "Re: Two",
      to: ["b@example.com"],
      signature: null,
      body: "Draft body.",
    });

    const listSentSince = vi.fn(async () => [
      message({ providerMessageId: "m-b1", providerThreadId: "thread-b1" }),
      message({ providerMessageId: "m-b2", providerThreadId: "thread-b2" }),
    ]);
    await runMatchSweep({
      tiebreak: neverCalledTiebreak,
      listAccounts: async () => [account(accountId)],
      readerFor: () => ({ listSentSince, getMessageBody: async () => null }),
    });

    const callsForAccount = listSentSince.mock.calls.length;
    expect(callsForAccount).toBe(1);
    expect(await getDraftStatus(accountId, "draft-batch-1")).toMatchObject({ status: "sent" });
    expect(await getDraftStatus(accountId, "draft-batch-2")).toMatchObject({ status: "sent" });
  });

  it("skips an account whose fetch throws without aborting the others", async () => {
    const failing = "acct-fetch-fails";
    const healthy = "acct-fetch-works";
    await createDraftSnapshot({
      accountId: failing,
      providerDraftId: "draft-failing",
      threadId: "thread-f",
      subject: "Re: Failing",
      to: ["a@example.com"],
      signature: null,
      body: "Draft body.",
    });
    await createDraftSnapshot({
      accountId: healthy,
      providerDraftId: "draft-healthy",
      threadId: "thread-h",
      subject: "Re: Healthy",
      to: ["b@example.com"],
      signature: null,
      body: "Draft body.",
    });

    await runMatchSweep({
      tiebreak: neverCalledTiebreak,
      listAccounts: async () => [account(failing), account(healthy)],
      readerFor: () => ({
        listSentSince: async (acct) => {
          if (acct.id === failing) throw new Error("proxy timeout");
          return [message({ providerMessageId: "m-h", providerThreadId: "thread-h" })];
        },
        getMessageBody: async () => null,
      }),
    });

    expect(await getDraftStatus(failing, "draft-failing")).toEqual({ status: "open" });
    expect(await getDraftStatus(healthy, "draft-healthy")).toEqual({
      status: "sent",
      sentMessageId: "m-h",
    });
  });

  it("skips accounts that are disconnected or lack a read driver", async () => {
    const gone = "acct-disconnected";
    const unsupported = "acct-no-driver";
    await createDraftSnapshot({
      accountId: gone,
      providerDraftId: "draft-gone",
      threadId: "thread-g",
      subject: "Re: Gone",
      to: ["a@example.com"],
      signature: null,
      body: "Draft body.",
    });
    await createDraftSnapshot({
      accountId: unsupported,
      providerDraftId: "draft-unsupported",
      threadId: "thread-u",
      subject: "Re: Unsupported",
      to: ["b@example.com"],
      signature: null,
      body: "Draft body.",
    });

    await runMatchSweep({
      tiebreak: neverCalledTiebreak,
      listAccounts: async () => [account(unsupported)],
      readerFor: () => null,
    });

    expect(await getDraftStatus(gone, "draft-gone")).toEqual({ status: "open" });
    expect(await getDraftStatus(unsupported, "draft-unsupported")).toEqual({ status: "open" });
  });
});
