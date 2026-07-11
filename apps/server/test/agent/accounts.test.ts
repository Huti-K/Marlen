import type { ConnectedAccount } from "@trailin/shared";
import { describe, expect, it, vi } from "vitest";

// resolveAccountParam/resolveRequiredAccountParam/fetchAccountNameMap all go
// through listAccounts() — stub it instead of hitting the real Pipedream API
// (test/setup.ts neutralizes the Pipedream credentials, so a real call would
// just fail differently depending on the SDK's own error path).
const listAccountsMock = vi.fn<() => Promise<ConnectedAccount[]>>();
vi.mock("../../src/pipedream/connect.js", () => ({
  listAccounts: () => listAccountsMock(),
}));

const {
  findAccount,
  accountNotFoundText,
  resolveAccountParam,
  resolveRequiredAccountParam,
  accountNameMap,
  fetchAccountNameMap,
} = await import("../../src/agent/accounts.js");

function account(id: string, name: string): ConnectedAccount {
  return { id, app: "gmail", appName: "Gmail", name, healthy: true, createdAt: "2026-01-01" };
}

const work = account("acc-work", "work@example.com");
const personal = account("acc-personal", "personal@example.com");

describe("findAccount", () => {
  it("matches by exact id", () => {
    expect(findAccount([work, personal], "acc-personal")).toBe(personal);
  });

  it("matches by name case-insensitively", () => {
    expect(findAccount([work, personal], "WORK@EXAMPLE.COM")).toBe(work);
  });

  it("trims the input before matching", () => {
    expect(findAccount([work, personal], "  work@example.com  ")).toBe(work);
  });

  it("returns undefined for no match", () => {
    expect(findAccount([work, personal], "nobody@example.com")).toBeUndefined();
  });
});

describe("accountNotFoundText", () => {
  it("lists connected account names", () => {
    expect(accountNotFoundText("bad", [work, personal])).toBe(
      'No connected account matches "bad". Connected accounts: work@example.com, personal@example.com.',
    );
  });

  it("says nothing is connected when the list is empty", () => {
    expect(accountNotFoundText("bad", [])).toBe(
      'No connected account matches "bad". Connected accounts: no accounts are connected.',
    );
  });
});

describe("resolveAccountParam", () => {
  it("resolves every account when raw is undefined", async () => {
    listAccountsMock.mockResolvedValue([work, personal]);
    const result = await resolveAccountParam(undefined);
    expect(result.account).toBeUndefined();
    expect(result.error).toBeUndefined();
    expect(result.accounts).toEqual([work, personal]);
  });

  it("resolves every account when raw is a blank string", async () => {
    listAccountsMock.mockResolvedValue([work, personal]);
    const result = await resolveAccountParam("   ");
    expect(result.account).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  it("resolves the named account when raw matches", async () => {
    listAccountsMock.mockResolvedValue([work, personal]);
    const result = await resolveAccountParam("personal@example.com");
    expect(result.account).toBe(personal);
    expect(result.error).toBeUndefined();
  });

  it("returns error text for an unresolvable raw value", async () => {
    listAccountsMock.mockResolvedValue([work, personal]);
    const result = await resolveAccountParam("nobody@example.com");
    expect(result.account).toBeUndefined();
    expect(result.error).toContain("nobody@example.com");
  });

  it("ignores non-string raw values, same as unset", async () => {
    listAccountsMock.mockResolvedValue([work, personal]);
    const result = await resolveAccountParam(42);
    expect(result.account).toBeUndefined();
    expect(result.error).toBeUndefined();
  });
});

describe("resolveRequiredAccountParam", () => {
  it("resolves the named account when raw matches", async () => {
    listAccountsMock.mockResolvedValue([work, personal]);
    const result = await resolveRequiredAccountParam("work@example.com");
    expect(result.error).toBeUndefined();
    expect(result.account).toBe(work);
  });

  it("errors on a blank raw value instead of falling back to every account", async () => {
    listAccountsMock.mockResolvedValue([work, personal]);
    const result = await resolveRequiredAccountParam("");
    expect(result.account).toBeUndefined();
    expect(result.error).toBeDefined();
  });

  it("errors on an unresolvable raw value", async () => {
    listAccountsMock.mockResolvedValue([work, personal]);
    const result = await resolveRequiredAccountParam("nobody@example.com");
    expect(result.account).toBeUndefined();
    expect(result.error).toContain("nobody@example.com");
  });
});

describe("accountNameMap", () => {
  it("maps ids to display names", () => {
    const map = accountNameMap([work, personal]);
    expect(map.get("acc-work")).toBe("work@example.com");
    expect(map.get("acc-personal")).toBe("personal@example.com");
    expect(map.size).toBe(2);
  });
});

describe("fetchAccountNameMap", () => {
  it("fetches and maps the connected accounts", async () => {
    listAccountsMock.mockResolvedValue([work, personal]);
    const map = await fetchAccountNameMap();
    expect(map.get("acc-work")).toBe("work@example.com");
  });

  it("falls back to an empty map when listAccounts fails", async () => {
    listAccountsMock.mockRejectedValue(new Error("Pipedream is down"));
    const map = await fetchAccountNameMap();
    expect(map.size).toBe(0);
  });
});
