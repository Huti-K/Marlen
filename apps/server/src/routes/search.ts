import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import type { SearchResult } from "@trailin/shared";
import { likeContains } from "../db/like.js";
import {
  safeSource,
  searchChats,
  searchDocuments,
  searchDrafts,
  searchMemories,
  searchRuns,
} from "../search/sources.js";

/**
 * Global search across chats, automation runs (digests), drafts, library
 * documents, and memories — powers the web app's command palette (Cmd+K).
 * Everything is read-only and best-effort: a failure in one source (e.g. a
 * Pipedream outage while fetching live drafts) never breaks the others (see
 * search/sources.ts's safeSource).
 */

const searchQuery = Type.Object({ q: Type.Optional(Type.String()) });

export const searchRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get("/api/search", { schema: { querystring: searchQuery } }, async (req) => {
    const query = (req.query.q ?? "").trim();
    if (!query) return { results: [] };
    const pattern = likeContains(query);

    const [runs, chats, drafts, documents, memories] = await Promise.all([
      safeSource("runs", searchRuns(query, pattern)),
      safeSource("chats", searchChats(query, pattern)),
      safeSource("drafts", searchDrafts(query)),
      safeSource("documents", searchDocuments(query)),
      safeSource("memories", searchMemories(query)),
    ]);

    // Grouped by type in a fixed order: run, chat, draft, document, memory.
    const results: SearchResult[] = [...runs, ...chats, ...drafts, ...documents, ...memories];
    return { results };
  });
};
