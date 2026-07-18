import { env } from "../../env.js";
import { braveWebSearch } from "./brave.js";
import { exaWebSearch } from "./exa.js";

/**
 * Provider-neutral web search behind the agent's web_search tool. Works with
 * zero configuration: without a key, searches go through Exa's keyless public
 * MCP endpoint; with BRAVE_SEARCH_API_KEY set, the Brave Search API takes over
 * (a paid/contracted index with real freshness filtering).
 */

/** Coarse recency window; each provider maps it to its own filter. */
export type Freshness = "day" | "week" | "month" | "year";

export interface WebSearchResult {
  title: string;
  url: string;
  /** Snippet or page-text excerpt, plain text. */
  description?: string;
  /** Human-readable recency, e.g. "2 days ago", when the provider gives one. */
  age?: string;
}

export async function webSearch(opts: {
  query: string;
  count: number;
  freshness?: Freshness;
  signal?: AbortSignal;
}): Promise<WebSearchResult[]> {
  const apiKey = env.webSearch.braveApiKey;
  if (apiKey) return braveWebSearch({ ...opts, apiKey });
  return exaWebSearch(opts);
}
