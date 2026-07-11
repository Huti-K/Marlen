import { describe, expect, it } from "vitest";
import { parseOpaqueCursor } from "../../../src/email/sync/syncProviders.js";

interface PhaseCursor {
  phase: string;
}

const isPhaseCursor = (v: unknown): v is PhaseCursor =>
  typeof v === "object" && v !== null && typeof (v as { phase?: unknown }).phase === "string";

describe("parseOpaqueCursor", () => {
  it("returns null for a null cursor", () => {
    expect(parseOpaqueCursor(null, isPhaseCursor)).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseOpaqueCursor("not json{", isPhaseCursor)).toBeNull();
  });

  it("returns null when valid JSON is rejected by the validator", () => {
    expect(parseOpaqueCursor(JSON.stringify({ notPhase: 1 }), isPhaseCursor)).toBeNull();
  });

  it("returns the parsed, typed value when valid JSON is accepted by the validator", () => {
    const cursor = JSON.stringify({ phase: "backfill" });
    expect(parseOpaqueCursor(cursor, isPhaseCursor)).toEqual({ phase: "backfill" });
  });
});
