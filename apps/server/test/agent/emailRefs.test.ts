import type { EmailRef } from "@trailin/shared";
import { describe, expect, it } from "vitest";
import {
  decoratePrompt,
  parseEmailRef,
  parseStoredRefs,
  renderRefNotes,
  serializeRefs,
} from "../../src/agent/emailRefs.js";

const ref: EmailRef = {
  threadId: "t1",
  accountId: "acc-1",
  accountName: "work@example.com",
  messageId: "m1",
  subject: "Contract renewal",
  from: "Ayşe Kaya <ayse@example.com>",
  date: "2026-07-01T00:00:00.000Z",
};

describe("serializeRefs / parseStoredRefs round-trip", () => {
  it("round-trips a full ref", () => {
    const stored = serializeRefs([ref]);
    expect(stored).not.toBeNull();
    expect(parseStoredRefs(stored)).toEqual([ref]);
  });

  it("serializes an empty/undefined list to null", () => {
    expect(serializeRefs(undefined)).toBeNull();
    expect(serializeRefs([])).toBeNull();
  });

  it("parses null/undefined/empty-string storage to undefined", () => {
    expect(parseStoredRefs(null)).toBeUndefined();
    expect(parseStoredRefs(undefined)).toBeUndefined();
    expect(parseStoredRefs("")).toBeUndefined();
  });

  it("returns undefined for malformed JSON instead of throwing", () => {
    expect(parseStoredRefs("{not json")).toBeUndefined();
  });

  it("returns undefined when the parsed JSON isn't an array", () => {
    expect(parseStoredRefs(JSON.stringify({ threadId: "t1", accountId: "a1" }))).toBeUndefined();
  });

  it("drops entries missing threadId or accountId, keeping the valid ones", () => {
    const stored = JSON.stringify([
      ref,
      { accountId: "acc-2", subject: "no threadId" },
      { threadId: "t2", subject: "no accountId" },
      { threadId: "", accountId: "acc-3" },
      { threadId: "t3", accountId: "" },
    ]);
    expect(parseStoredRefs(stored)).toEqual([ref]);
  });

  it("returns undefined when every entry is malformed", () => {
    const stored = JSON.stringify([{ subject: "nope" }, { threadId: "" }]);
    expect(parseStoredRefs(stored)).toBeUndefined();
  });
});

describe("parseEmailRef", () => {
  it("keeps only non-empty optional string fields", () => {
    const parsed = parseEmailRef({
      threadId: "t1",
      accountId: "acc-1",
      accountName: "",
      subject: "  ",
      from: "alice@example.com",
    });
    expect(parsed).toEqual({ threadId: "t1", accountId: "acc-1", from: "alice@example.com" });
  });

  it("drops non-record input", () => {
    expect(parseEmailRef("nope")).toBeUndefined();
    expect(parseEmailRef(null)).toBeUndefined();
  });
});

describe("renderRefNotes", () => {
  it("includes threadId, account name, and the authoritative wording", () => {
    const note = renderRefNotes([ref]);
    expect(note).toContain("t1");
    expect(note).toContain("work@example.com");
    expect(note).toContain("authoritative");
    expect(note).toContain("thread read tool");
    expect(note).toContain('subject "Contract renewal"');
    expect(note).toContain("from Ayşe Kaya <ayse@example.com>");
    expect(note).toContain("date 2026-07-01T00:00:00.000Z");
  });

  it("falls back to accountId when accountName is absent", () => {
    const { accountName: _omit, ...bare } = ref;
    const note = renderRefNotes([bare]);
    expect(note).toContain("in acc-1");
  });

  it("omits subject/from/date fragments when absent", () => {
    const note = renderRefNotes([{ threadId: "t1", accountId: "acc-1" }]);
    expect(note).not.toContain("subject");
    expect(note).not.toContain("from ");
    expect(note).not.toContain("date ");
    expect(note).toContain("authoritative");
  });

  it("joins multiple refs with one bracketed note per line", () => {
    const second: EmailRef = { threadId: "t2", accountId: "acc-2" };
    const notes = renderRefNotes([ref, second]);
    expect(notes.split("\n")).toHaveLength(2);
  });
});

describe("decoratePrompt", () => {
  it("returns the content unchanged when there are no refs", () => {
    expect(decoratePrompt("hello", undefined)).toBe("hello");
    expect(decoratePrompt("hello", [])).toBe("hello");
  });

  it("appends the ref notes after a blank line when refs are given", () => {
    const decorated = decoratePrompt("Reply to this please", [ref]);
    expect(decorated.startsWith("Reply to this please\n\n[Attached email:")).toBe(true);
    expect(decorated).toContain("authoritative");
  });
});
