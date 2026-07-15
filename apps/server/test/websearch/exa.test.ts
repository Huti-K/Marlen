import { afterEach, describe, expect, it, vi } from "vitest";
import { EXA_MCP_URL, exaWebSearch } from "../../src/websearch/exa.js";

/**
 * The keyless provider speaks one JSON-RPC tools/call against Exa's public
 * MCP endpoint and parses the "Title:/URL:/Text:" text blob it answers with —
 * which may arrive as plain JSON or wrapped in an SSE stream. Fake fetch at
 * the global boundary.
 */

afterEach(() => vi.restoreAllMocks());

function mockFetch(body: string, status = 200): ReturnType<typeof vi.spyOn> {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(body, { status, headers: { "content-type": "text/plain" } }));
}

function rpcBody(text: string): string {
  return JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text }] } });
}

const twoResults = [
  "Title: First page",
  "URL: https://example.com/one",
  "Text: Body of the first result.",
  "---",
  "Title: Second page",
  "URL: https://example.com/two",
  "Text: Body of the second result.",
].join("\n");

describe("exaWebSearch", () => {
  it("posts a web_search_exa tools/call and parses the result blocks", async () => {
    const fetchSpy = mockFetch(rpcBody(twoResults));
    const rows = await exaWebSearch({ query: "trailin", count: 2 });

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(EXA_MCP_URL);
    const request = JSON.parse(init.body as string);
    expect(request.method).toBe("tools/call");
    expect(request.params.name).toBe("web_search_exa");
    expect(request.params.arguments).toMatchObject({ query: "trailin", numResults: 2 });

    expect(rows).toEqual([
      {
        title: "First page",
        url: "https://example.com/one",
        description: "Body of the first result.",
      },
      {
        title: "Second page",
        url: "https://example.com/two",
        description: "Body of the second result.",
      },
    ]);
  });

  it("appends the freshness hint to the query text", async () => {
    const fetchSpy = mockFetch(rpcBody(twoResults));
    await exaWebSearch({ query: "trailin", count: 2, freshness: "week" });
    const request = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(request.params.arguments.query).toBe("trailin past week");
  });

  it("reads the RPC payload out of an SSE-framed reply", async () => {
    mockFetch(`event: message\ndata: ${rpcBody(twoResults)}\n\n`);
    const rows = await exaWebSearch({ query: "q", count: 2 });
    expect(rows).toHaveLength(2);
  });

  it("throws on an RPC error and on a tool-level error result", async () => {
    mockFetch(
      JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -1, message: "rate limited" } }),
    );
    await expect(exaWebSearch({ query: "q", count: 2 })).rejects.toThrow(/rate limited/);

    mockFetch(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { isError: true, content: [{ type: "text", text: "backend down" }] },
      }),
    );
    await expect(exaWebSearch({ query: "q", count: 2 })).rejects.toThrow(/backend down/);
  });

  it("throws with the HTTP status on a failed request", async () => {
    mockFetch("gateway error", 502);
    await expect(exaWebSearch({ query: "q", count: 2 })).rejects.toThrow(/502/);
  });

  it("falls back to the Highlights section and reads a real Published date", async () => {
    const block = [
      "Title: Some page",
      "URL: https://example.com/hl",
      "Published: 2026-07-01",
      "Author: N/A",
      "Highlights:",
      "First fragment.",
      "...",
      "Second fragment.",
    ].join("\n");
    mockFetch(rpcBody(block));
    expect(await exaWebSearch({ query: "q", count: 1 })).toEqual([
      {
        title: "Some page",
        url: "https://example.com/hl",
        description: "First fragment. … Second fragment.",
        age: "2026-07-01",
      },
    ]);
  });

  it("drops blocks without a URL and returns [] for unparseable text", async () => {
    mockFetch(rpcBody("Title: no url here\nText: orphan"));
    expect(await exaWebSearch({ query: "q", count: 2 })).toEqual([]);
  });
});
