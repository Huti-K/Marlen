import { describe, expect, it } from "vitest";
import {
  decodeStringArray,
  type MailMessageRow,
  toMailMessage,
} from "../../../src/email/sync/rows.js";

describe("decodeStringArray", () => {
  it("parses a JSON array column into a string array", () => {
    expect(decodeStringArray('["a@example.com","b@example.com"]')).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
  });

  it("parses an empty JSON array into an empty array", () => {
    expect(decodeStringArray("[]")).toEqual([]);
  });
});

describe("toMailMessage", () => {
  const row: MailMessageRow = {
    providerMessageId: "m-1",
    fromAddr: "alice@example.com",
    toAddrs: '["bob@example.com"]',
    ccAddrs: '["carol@example.com"]',
    date: "2026-01-01T00:00:00.000Z",
    bodyText: "hello",
    isFromMe: 1,
    isUnread: 0,
  };

  it("maps snake_case-derived fields to their provider-neutral names", () => {
    const message = toMailMessage(row);
    expect(message.providerMessageId).toBe("m-1");
    expect(message.from).toBe("alice@example.com");
    expect(message.bodyText).toBe("hello");
    expect(message.date).toBe(row.date);
  });

  it("decodes to/cc as string arrays", () => {
    const message = toMailMessage(row);
    expect(message.to).toEqual(["bob@example.com"]);
    expect(message.cc).toEqual(["carol@example.com"]);
  });

  it("converts SQLite 0/1 integer flags to booleans", () => {
    expect(toMailMessage(row).isFromMe).toBe(true);
    expect(toMailMessage(row).isUnread).toBe(false);
    expect(toMailMessage({ ...row, isFromMe: 0, isUnread: 1 }).isFromMe).toBe(false);
    expect(toMailMessage({ ...row, isFromMe: 0, isUnread: 1 }).isUnread).toBe(true);
  });
});
