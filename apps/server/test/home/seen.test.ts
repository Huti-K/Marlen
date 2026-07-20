import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SeenState } from "@trailin/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Home's "new since you last looked" state. The floor is the part that hurts
 * when it breaks: without one, every item that predates the feature reads as
 * new and the whole page lights up.
 */

let app: Awaited<ReturnType<typeof import("../../src/app.js").buildApp>>;

beforeAll(async () => {
  const scratch = await mkdtemp(join(tmpdir(), "trailin-seen-test-"));
  process.env.AGENT_HOME_PATH = join(scratch, "Trailin");
  process.env.DATABASE_PATH = join(scratch, "test.db");
  app = await (await import("../../src/app.js")).buildApp();
});

afterAll(async () => {
  await app?.close();
});

const getSeen = async (): Promise<SeenState> =>
  (await app.inject({ method: "GET", url: "/api/seen" })).json<SeenState>();

const post = async (payload: Record<string, unknown>): Promise<SeenState> =>
  (await app.inject({ method: "POST", url: "/api/seen", payload })).json<SeenState>();

describe("seen marks", () => {
  it("starts with an install-time floor, so nothing that predates it is new", async () => {
    const state = await getSeen();
    expect(Date.parse(state.floor)).toBeLessThanOrEqual(Date.now());
    expect(state.keys).toEqual([]);
  });

  it("marks items seen idempotently and clears them all with a raised floor", async () => {
    await post({ keys: ["todo:a", "run:b"] });
    const marked = await post({ keys: ["todo:a"] });
    expect(marked.keys.sort()).toEqual(["run:b", "todo:a"]);

    const before = await getSeen();
    const all = await post({ all: true });
    // The floor subsumes the per-item marks, so they go rather than accumulate.
    expect(all.keys).toEqual([]);
    expect(Date.parse(all.floor)).toBeGreaterThanOrEqual(Date.parse(before.floor));
  });
});
