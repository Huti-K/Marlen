import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConnectedAccount, EmailDraft } from "@trailin/shared";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Importing draftTools.ts pulls the db DDL in transitively — isolate first.
const tempDir = mkdtempSync(join(tmpdir(), "trailin-draft-tools-"));
const originalDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(tempDir, "test.db");

// The tool resolves its optional `account` param via listAccounts() (through
// toolkit.ts) — stub it instead of hitting Pipedream.
const listAccountsMock = vi.fn<() => Promise<ConnectedAccount[]>>();
vi.mock("../../src/pipedream/connect.js", () => ({
  listAccounts: () => listAccountsMock(),
}));

const listDraftsCachedMock = vi.fn<(account: ConnectedAccount) => Promise<EmailDraft[]>>();
vi.mock("../../src/email/draftsService.js", () => ({
  listDraftsCached: (account: ConnectedAccount) => listDraftsCachedMock(account),
}));

// Populates the DraftProvider registry so gmail counts as drafts-capable.
await import("../../src/email/registerProviders.js");
const { listDraftsTool } = await import("../../src/agent/draftTools.js");
const { sqlite } = await import("../../src/db/index.js");

afterAll(() => {
  sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
});

function account(id: string, app: string, name: string): ConnectedAccount {
  return { id, app, appName: app, name, healthy: true, createdAt: "2026-01-01" };
}

const gmail = account("acc-gmail", "gmail", "me@gmail.com");
const slack = account("acc-slack", "slack", "workspace");

function draft(id: string, overrides: Partial<EmailDraft> = {}): EmailDraft {
  return {
    id,
    messageId: `msg-${id}`,
    threadId: "",
    subject: `subject ${id}`,
    to: "them@example.com",
    date: "2026-07-01T00:00:00Z",
    webUrl: "",
    snippet: "snippet",
    ...overrides,
  };
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((c) => (c.type === "text" ? (c.text ?? "") : "")).join("");
}

beforeEach(() => {
  listAccountsMock.mockReset();
  listDraftsCachedMock.mockReset();
});

describe("list_drafts", () => {
  it("lists drafts per drafts-capable account, with draftId and threadId lines", async () => {
    listAccountsMock.mockResolvedValue([gmail, slack]);
    listDraftsCachedMock.mockResolvedValue([draft("d1", { threadId: "t-9" })]);

    const result = await listDraftsTool.execute("call-1", {});
    const text = textOf(result);

    // Only the gmail account has a DraftProvider; slack is filtered out.
    expect(listDraftsCachedMock).toHaveBeenCalledTimes(1);
    expect(text).toContain("me@gmail.com:");
    expect(text).toContain("draftId: d1 | threadId: t-9");
    expect(text).not.toContain("workspace");
  });

  it("reports a per-account failure without dropping the other accounts", async () => {
    const second = account("acc-gmail-2", "gmail", "two@gmail.com");
    listAccountsMock.mockResolvedValue([gmail, second]);
    listDraftsCachedMock.mockImplementation(async (a) => {
      if (a.id === gmail.id) throw new Error("proxy timeout");
      return [draft("d2")];
    });

    const text = textOf(await listDraftsTool.execute("call-1", {}));
    expect(text).toContain("me@gmail.com: listing drafts failed (proxy timeout)");
    expect(text).toContain("two@gmail.com:");
    expect(text).toContain("draftId: d2");
  });

  it("says so when no connected account supports drafts", async () => {
    listAccountsMock.mockResolvedValue([slack]);
    const text = textOf(await listDraftsTool.execute("call-1", {}));
    expect(text).toContain("No connected account supports drafts");
  });
});
