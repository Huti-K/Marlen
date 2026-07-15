import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import { repairToolArguments, textResult, tool } from "../../src/agent/toolkit.js";

const schema = Type.Object({
  query: Type.String(),
  tasks: Type.Optional(Type.Array(Type.String())),
  filter: Type.Optional(Type.Object({ sender: Type.Optional(Type.String()) })),
});

describe("repairToolArguments", () => {
  it("returns valid arguments untouched, by reference", () => {
    const args = { query: "invoices", tasks: ["a"] };
    expect(repairToolArguments(schema, args)).toBe(args);
  });

  it("parses the whole arguments object sent as one JSON string", () => {
    const repaired = repairToolArguments(schema, '{"query": "invoices"}');
    expect(repaired).toEqual({ query: "invoices" });
  });

  it("parses a JSON-encoded string where an array parameter belongs", () => {
    const repaired = repairToolArguments(schema, { query: "q", tasks: '["a", "b"]' });
    expect(repaired).toEqual({ query: "q", tasks: ["a", "b"] });
  });

  it("wraps a bare element where an array parameter belongs", () => {
    const repaired = repairToolArguments(schema, { query: "q", tasks: "look up invoices" });
    expect(repaired).toEqual({ query: "q", tasks: ["look up invoices"] });
  });

  it("parses a JSON-encoded string where an object parameter belongs", () => {
    const repaired = repairToolArguments(schema, { query: "q", filter: '{"sender": "ayse"}' });
    expect(repaired).toEqual({ query: "q", filter: { sender: "ayse" } });
  });

  it("leaves shapes it cannot confidently repair unchanged", () => {
    // Not JSON, not object-shaped: validation reports it, repair stays out.
    expect(repairToolArguments(schema, "just words")).toBe("just words");
    expect(repairToolArguments(schema, 42)).toBe(42);
    // A JSON string for an object param that parses to an array is ambiguous.
    const args = { query: "q", filter: '["not", "an", "object"]' };
    expect(repairToolArguments(schema, args)).toEqual(args);
  });

  it("is wired into tool() as pi's prepareArguments hook", () => {
    const t = tool({
      name: "test_tool",
      label: "Test tool",
      description: "test",
      params: { tasks: Type.Array(Type.String()) },
      execute: async () => textResult("ok"),
    });
    expect(t.prepareArguments?.({ tasks: "one task" })).toEqual({ tasks: ["one task"] });
  });
});
