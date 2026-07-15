import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSearchResult } from "../../src/websearch/search.js";

// Importing webSearchTool.ts pulls db/index.ts in transitively (via
// toolkit.ts → accounts.ts → db/settings.ts), which runs its DDL as an
// import-time side effect resolved via env.ts's DATABASE_PATH read — point
// DATABASE_PATH at a fresh temp file before anything pulls it in.
const tempDir = mkdtempSync(join(tmpdir(), "trailin-web-search-tool-"));
const originalDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(tempDir, "test.db");

const webSearchMock = vi.fn<(opts: unknown) => Promise<WebSearchResult[]>>();
vi.mock("../../src/websearch/search.js", () => ({
  webSearch: (opts: unknown) => webSearchMock(opts),
}));

const { sqlite } = await import("../../src/db/index.js");
const { webSearchTool } = await import("../../src/agent/webSearchTool.js");

afterAll(() => {
  sqlite.close();
  rmSync(tempDir, { recursive: true, force: true });
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
});

// Braces matter: mockReset() returns the mock, and a function returned from
// beforeEach runs as teardown — which would *call the mock* after each test.
beforeEach(() => {
  webSearchMock.mockReset();
});

async function run(params: unknown): Promise<string> {
  const result = await webSearchTool.execute("call-1", params as never);
  return result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
}

describe("web_search tool", () => {
  it("renders results as a numbered list with url, age and snippet", async () => {
    webSearchMock.mockResolvedValue([
      { title: "First", url: "https://a.example", description: "Alpha.", age: "3 days ago" },
      { title: "", url: "https://b.example" },
    ]);
    const text = await run({ query: "trailin" });
    expect(webSearchMock).toHaveBeenCalledWith(
      expect.objectContaining({ query: "trailin", count: 5 }),
    );
    expect(text).toContain("1. First");
    expect(text).toContain("https://a.example (3 days ago)");
    expect(text).toContain("Alpha.");
    // A result without a title falls back to its URL as the head line.
    expect(text).toContain("2. https://b.example");
  });

  it("clamps count and forwards freshness", async () => {
    webSearchMock.mockResolvedValue([{ title: "t", url: "https://a.example" }]);
    await run({ query: "q", count: 50, freshness: "day" });
    expect(webSearchMock).toHaveBeenCalledWith(
      expect.objectContaining({ count: 10, freshness: "day" }),
    );
  });

  it("answers plainly on a blank query and on zero results", async () => {
    expect(await run({ query: "   " })).toContain("query was empty");
    expect(webSearchMock).not.toHaveBeenCalled();
    webSearchMock.mockResolvedValue([]);
    expect(await run({ query: "nothing" })).toContain('No web results for "nothing"');
  });

  it("returns a provider failure as result text instead of throwing", async () => {
    webSearchMock.mockRejectedValue(new Error("Brave Search request failed: 429"));
    expect(await run({ query: "q" })).toContain("429");
  });
});
