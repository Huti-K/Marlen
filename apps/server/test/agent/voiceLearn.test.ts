import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ConnectedAccount } from "@trailin/shared";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MailReadProvider, SentMessage } from "../../src/email/read/readProviders.js";

// Importing voiceLearn.ts pulls the db DDL in transitively — isolate first.
const tempDir = mkdtempSync(join(tmpdir(), "trailin-voicelearn-sampling-"));
const originalDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(tempDir, "test.db");

const accounts: ConnectedAccount[] = [];
vi.mock("../../src/pipedream/connect.js", () => ({
  listAccounts: async () => accounts,
}));

let provider: MailReadProvider | null = null;
vi.mock("../../src/email/read/readProviders.js", () => ({
  getMailReadProvider: () => provider,
  registerMailReadProvider: () => {},
}));

/** Captures the one-shot's inputs and answers via its report_style tool. */
const oneShotCalls: Array<{ systemPrompt: string; prompt: string; toolNames: string[] }> = [];
vi.mock("../../src/agent/oneShot.js", () => ({
  runOneShot: async (opts: { systemPrompt: string; prompt: string; tools?: AgentTool[] }) => {
    oneShotCalls.push({
      systemPrompt: opts.systemPrompt,
      prompt: opts.prompt,
      toolNames: (opts.tools ?? []).map((t) => t.name),
    });
    const report = (opts.tools ?? []).find((t) => t.name === "report_style");
    if (report) {
      await report.execute(
        "call-1",
        { style: ["Signs off with 'Cheers'."], signature: "Alice" },
        undefined as never,
        undefined as never,
      );
    }
    return "done";
  },
}));

const { learnAccountVoice } = await import("../../src/agent/voiceLearn.js");
const { sqlite } = await import("../../src/db/index.js");

afterAll(() => {
  sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
});

const gmailAccount: ConnectedAccount = {
  id: "acc_gmail",
  app: "gmail",
  appName: "Gmail",
  name: "me@example.com",
  healthy: true,
  createdAt: "2026-01-01T00:00:00.000Z",
};

function sent(
  overrides: Partial<SentMessage> & Pick<SentMessage, "providerMessageId">,
): SentMessage {
  return {
    providerThreadId: `t-${overrides.providerMessageId}`,
    subject: "Subject",
    to: ["them@example.com"],
    date: "2026-07-01T00:00:00.000Z",
    bodyText: `body of ${overrides.providerMessageId}`,
    ...overrides,
  };
}

beforeEach(() => {
  accounts.length = 0;
  accounts.push(gmailAccount);
  provider = null;
  oneShotCalls.length = 0;
});

describe("learnAccountVoice — live sampling", () => {
  it("fetches ~90 days of sent mail, dedupes by thread, and hands samples to a report-only one-shot", async () => {
    let receivedSince = "";
    let receivedLimit: number | undefined;
    provider = {
      listSentSince: async (_account, sinceIso, opts) => {
        receivedSince = sinceIso;
        receivedLimit = opts?.limit;
        return [
          sent({ providerMessageId: "m1", providerThreadId: "t-shared" }),
          sent({ providerMessageId: "m2", providerThreadId: "t-shared" }),
          sent({ providerMessageId: "m3", to: ["other@example.com"] }),
          sent({ providerMessageId: "m-empty", bodyText: "   " }),
        ];
      },
      getMessageBody: async () => null,
    };

    await learnAccountVoice("acc_gmail");

    const sinceAgeDays = (Date.now() - Date.parse(receivedSince)) / (24 * 60 * 60 * 1000);
    expect(sinceAgeDays).toBeGreaterThan(89);
    expect(sinceAgeDays).toBeLessThan(91);
    expect(receivedLimit).toBe(40);

    const call = oneShotCalls[0];
    expect(call?.toolNames).toEqual(["report_style"]);
    // t-shared contributes one sample (newest wins), m3 another; the blank body is dropped.
    expect(call?.prompt).toContain("2 samples");
    expect(call?.prompt).not.toContain("body of m-empty");
    // No tool-driven reading: the samples ride in the prompt itself.
    expect(call?.prompt).toContain("body of m3");
  });

  it("truncates oversized bodies in the prompt", async () => {
    provider = {
      listSentSince: async () => [
        sent({ providerMessageId: "m-long", bodyText: `start-${"x".repeat(5000)}-end` }),
      ],
      getMessageBody: async () => null,
    };

    await learnAccountVoice("acc_gmail");

    const prompt = oneShotCalls[0]?.prompt ?? "";
    expect(prompt).toContain("[truncated]");
    expect(prompt).not.toContain("-end");
  });

  it("fails with a friendly error when the app has no read driver", async () => {
    provider = null;
    await expect(learnAccountVoice("acc_gmail")).rejects.toThrow(/isn't supported/);
    expect(oneShotCalls).toHaveLength(0);
  });

  it("fails with a friendly error when there is no recent sent mail", async () => {
    provider = { listSentSince: async () => [], getMessageBody: async () => null };
    await expect(learnAccountVoice("acc_gmail")).rejects.toThrow(/no recent sent mail/);
    expect(oneShotCalls).toHaveLength(0);
  });
});
