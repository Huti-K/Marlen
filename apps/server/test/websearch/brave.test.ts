import { afterEach, describe, expect, it, vi } from "vitest";
import { BRAVE_SEARCH_URL, braveWebSearch } from "../../src/websearch/brave.js";

/**
 * The client authenticates with the subscription-token header, encodes the
 * query parameters Brave expects, and narrows the provider-shaped response to
 * plain rows. Fake fetch at the global boundary.
 */

afterEach(() => vi.restoreAllMocks());

function mockFetch(payload: unknown, status = 200): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

const oneResult = {
  web: {
    results: [
      {
        title: "The <strong>Answer</strong>",
        url: "https://example.com/a",
        description: "It&#39;s &lt;b&gt; &amp; snippets",
        age: "2 days ago",
      },
    ],
  },
};

describe("braveWebSearch", () => {
  it("sends the token header and encodes query, count and freshness", async () => {
    const fetchSpy = mockFetch(oneResult);
    await braveWebSearch({ apiKey: "key-1", query: "trailin app", count: 3, freshness: "week" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(url.startsWith(BRAVE_SEARCH_URL)).toBe(true);
    expect(parsed.searchParams.get("q")).toBe("trailin app");
    expect(parsed.searchParams.get("count")).toBe("3");
    expect(parsed.searchParams.get("freshness")).toBe("pw");
    expect((init.headers as Record<string, string>)["X-Subscription-Token"]).toBe("key-1");
  });

  it("strips highlight markup and entities from titles and snippets", async () => {
    mockFetch(oneResult);
    const rows = await braveWebSearch({ apiKey: "k", query: "q", count: 5 });
    expect(rows).toEqual([
      {
        title: "The Answer",
        url: "https://example.com/a",
        description: "It's <b> & snippets",
        age: "2 days ago",
      },
    ]);
  });

  it("drops rows without a title or url and tolerates a missing web section", async () => {
    mockFetch({ web: { results: [{ title: "no url" }, 42] } });
    expect(await braveWebSearch({ apiKey: "k", query: "q", count: 5 })).toEqual([]);
    mockFetch({ unexpected: true });
    expect(await braveWebSearch({ apiKey: "k", query: "q", count: 5 })).toEqual([]);
  });

  it("throws with the HTTP status on a failed request", async () => {
    mockFetch({ error: "quota" }, 429);
    await expect(braveWebSearch({ apiKey: "k", query: "q", count: 5 })).rejects.toThrow(/429/);
  });
});
