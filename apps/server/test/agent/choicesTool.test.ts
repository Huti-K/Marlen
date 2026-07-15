import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentCard, ChoiceOption, ConnectedAccount } from "@trailin/shared";
import { afterAll, describe, expect, it, vi } from "vitest";

// Importing choicesTool.ts pulls db/index.ts in transitively, which runs its
// DDL as an import-time side effect resolved via env.ts's DATABASE_PATH read —
// point DATABASE_PATH at a fresh temp file before anything pulls it in.
const tempDir = mkdtempSync(join(tmpdir(), "trailin-choices-tool-"));
const originalDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(tempDir, "test.db");

// presentChoicesTool resolves the `account` param the same way every other
// agent tool does — via listAccounts() — so it's stubbed the same way
// test/agent/accounts.test.ts stubs it, instead of hitting Pipedream.
const listAccountsMock = vi.fn<() => Promise<ConnectedAccount[]>>();
vi.mock("../../src/pipedream/connect.js", () => ({
  listAccounts: () => listAccountsMock(),
}));

const { sqlite } = await import("../../src/db/index.js");
const { presentChoicesTool } = await import("../../src/agent/choicesTool.js");

afterAll(() => {
  sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
});

function account(id: string, name: string): ConnectedAccount {
  return { id, app: "gmail", appName: "Gmail", name, healthy: true, createdAt: "2026-01-01" };
}

const work = account("acc-work", "work@example.com");
const personal = account("acc-personal", "personal@example.com");

function callChoices(params: unknown) {
  return presentChoicesTool.execute("call-1", params as never);
}

function textOf(result: Awaited<ReturnType<typeof callChoices>>): string {
  return result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
}

function cardOf(result: Awaited<ReturnType<typeof callChoices>>): AgentCard | undefined {
  return result.details as AgentCard | undefined;
}

const twoPlainOptions = [{ label: "First option" }, { label: "Second option" }];

describe("present_choices — validation", () => {
  it("errors on a blank question, without a card", async () => {
    listAccountsMock.mockResolvedValue([]);
    const result = await callChoices({ question: "  ", options: twoPlainOptions });
    expect(textOf(result)).toContain("non-empty question");
    expect(cardOf(result)).toBeUndefined();
  });

  it("errors on fewer than 2 options", async () => {
    const result = await callChoices({ question: "Pick one", options: [{ label: "Only one" }] });
    expect(textOf(result)).toContain("at least 2");
    expect(cardOf(result)).toBeUndefined();
  });

  it("errors on more than 6 options", async () => {
    const options = Array.from({ length: 7 }, (_, i) => ({ label: `Option ${i}` }));
    const result = await callChoices({ question: "Pick one", options });
    expect(textOf(result)).toContain("at most 6");
    expect(cardOf(result)).toBeUndefined();
  });

  it("drops options missing a label, erroring if fewer than 2 remain", async () => {
    const result = await callChoices({
      question: "Pick one",
      options: [{ label: "Only labeled one" }, { detail: "no label here" }],
    });
    expect(textOf(result)).toContain("at least 2 options with a label");
    expect(cardOf(result)).toBeUndefined();
  });
});

describe("present_choices — card and text output", () => {
  it("keeps options with neither threadId nor account, attaching no ref", async () => {
    listAccountsMock.mockResolvedValue([]);
    const result = await callChoices({ question: "Pick one", options: twoPlainOptions });
    const card = cardOf(result);
    expect(card?.kind).toBe("choices");
    const options = (card as { kind: "choices"; options: ChoiceOption[] }).options;
    expect(options).toHaveLength(2);
    expect(options.every((o) => o.ref === undefined)).toBe(true);
  });

  it("carries detail/reply through to the card", async () => {
    listAccountsMock.mockResolvedValue([]);
    const result = await callChoices({
      question: "Pick one",
      options: [
        { label: "First", detail: "some detail", reply: "Go with the first." },
        { label: "Second" },
      ],
    });
    const card = cardOf(result) as { kind: "choices"; options: ChoiceOption[] };
    expect(card.options[0]).toMatchObject({
      label: "First",
      detail: "some detail",
      reply: "Go with the first.",
    });
    expect(card.options[1]?.detail).toBeUndefined();
  });

  it("produces model-facing text naming the option count and labels", async () => {
    listAccountsMock.mockResolvedValue([]);
    const result = await callChoices({ question: "Pick one", options: twoPlainOptions });
    const text = textOf(result);
    expect(text).toContain("Presented 2 choices to the user: First option, Second option");
    expect(text).toContain("End your turn with a short question");
  });

  it("resolves accounts with exactly one listAccounts() fetch regardless of option count", async () => {
    listAccountsMock.mockClear();
    listAccountsMock.mockResolvedValue([work, personal]);
    await callChoices({
      question: "Which account?",
      options: [
        { label: "Work", account: "work@example.com" },
        { label: "Personal", account: "personal@example.com" },
      ],
    });
    expect(listAccountsMock).toHaveBeenCalledTimes(1);
  });
});

describe("present_choices — building refs", () => {
  it("attaches a bare ref (threadId + accountId + accountName) when the account resolves", async () => {
    listAccountsMock.mockResolvedValue([work, personal]);
    const result = await callChoices({
      question: "Which thread?",
      options: [
        { label: "Contract renewal", threadId: "t-1", account: "work@example.com" },
        { label: "Something else" },
      ],
    });
    const card = cardOf(result) as { kind: "choices"; options: ChoiceOption[] };
    expect(card.options[0]?.ref).toEqual({
      threadId: "t-1",
      accountId: "acc-work",
      accountName: "work@example.com",
    });
    expect(card.options[1]?.ref).toBeUndefined();
  });

  it("keeps the option with no ref when its account doesn't resolve", async () => {
    listAccountsMock.mockResolvedValue([]);
    const result = await callChoices({
      question: "Which thread?",
      options: [{ label: "Some thread", threadId: "t-1" }, { label: "Other" }],
    });
    const card = cardOf(result) as { kind: "choices"; options: ChoiceOption[] };
    expect(card.options[0]?.label).toBe("Some thread");
    expect(card.options[0]?.ref).toBeUndefined();
  });

  it("keeps the option with no ref when it names an account that isn't connected", async () => {
    listAccountsMock.mockResolvedValue([work]);
    const result = await callChoices({
      question: "Which thread?",
      options: [
        { label: "Elsewhere", threadId: "t-2", account: "gone@example.com" },
        { label: "Other" },
      ],
    });
    const card = cardOf(result) as { kind: "choices"; options: ChoiceOption[] };
    expect(card.options[0]?.ref).toBeUndefined();
  });
});
