import type { Api, Model } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import type { ThreadSnapshot } from "../../../src/email/enrich/enrichStore.js";

/**
 * Never yields a stream event and never settles on its own — stands in for a
 * provider whose response hangs. Rejects once `signal` fires, the same way a
 * real fetch-based stream aborts, so it exercises the abort wiring rather
 * than just timing out the test itself.
 */
async function* hangUntilAborted(signal?: AbortSignal): AsyncGenerator<never, void, unknown> {
  await new Promise<void>((_resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
}

// enrichThread only ever touches modelRegistry.streamSimple (via its
// streamFn) — the rest of enrichLLM.ts's imports from this module belong to
// resolveEnrichModel, which this suite doesn't exercise.
vi.mock("../../../src/llm/registry.js", () => ({
  modelRegistry: {
    streamSimple: (_model: unknown, _context: unknown, options?: { signal?: AbortSignal }) =>
      hangUntilAborted(options?.signal),
  },
}));

const { enrichThread } = await import("../../../src/email/enrich/enrichLLM.js");

const fakeModel = {
  id: "test-model",
  name: "Test model",
  api: "anthropic-messages",
  provider: "anthropic",
  baseUrl: "",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 4096,
} as unknown as Model<Api>;

const fakeSnapshot: ThreadSnapshot = {
  threadId: "acct:t1",
  accountId: "acct",
  subject: "Test thread",
  inputHash: "hash",
  takenAt: "2026-01-01T00:00:00.000Z",
  messages: [
    {
      from: "alice@example.com",
      to: ["bob@example.com"],
      date: "2026-01-01T00:00:00.000Z",
      bodyText: "Are we still on for Friday?",
      isFromMe: false,
    },
  ],
};

describe("enrichThread timeout", () => {
  it("aborts a hung model call after timeoutMs instead of hanging forever", async () => {
    await expect(enrichThread(fakeSnapshot, "Owner", fakeModel, 30)).rejects.toThrow();
  });

  it("rejects with a real Error the caller's errorMessage()/saveEnrichmentError path can record", async () => {
    await expect(enrichThread(fakeSnapshot, "Owner", fakeModel, 30)).rejects.toBeInstanceOf(Error);
  });

  it("does not fire before timeoutMs elapses", async () => {
    // The hang-forever stream must still be pending partway through the
    // window, then reject once the window closes — proving the abort is
    // time-gated rather than immediate.
    let settled = false;
    const pending = enrichThread(fakeSnapshot, "Owner", fakeModel, 100).finally(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    await expect(pending).rejects.toThrow();
    expect(settled).toBe(true);
  });
});
