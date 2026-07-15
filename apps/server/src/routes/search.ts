import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import type { MailSuggestion, SearchResult } from "@trailin/shared";
import { likeContains } from "../db/like.js";
import { listThreadOverviews, searchMail } from "../email/sync/mailQuery.js";
import {
  safeSource,
  searchChats,
  searchDocuments,
  searchDrafts,
  searchMailHits,
  searchMemories,
  searchRuns,
} from "../search/sources.js";

/**
 * Global search across chats, automation runs (digests), drafts, local mail,
 * library documents, and memories — powers the web app's command palette
 * (Cmd+K). Everything is read-only and best-effort: a failure in one source
 * (e.g. a Pipedream outage while fetching live drafts) never breaks the
 * others (see search/sources.ts's safeSource).
 *
 * Also serves GET /api/mail/suggest, the composer's @-mention autocomplete:
 * a much narrower, mail-only lookup that returns MailSuggestion rows the
 * client turns straight into EmailRefs, rather than SearchResult rows meant
 * for the command palette.
 */

const searchQuery = Type.Object({ q: Type.Optional(Type.String()) });

const suggestQuery = Type.Object({
  q: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Integer()),
});

const DEFAULT_SUGGEST_LIMIT = 8;
const MAX_SUGGEST_LIMIT = 20;

function clampSuggestLimit(raw: number | undefined): number {
  const n =
    typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : DEFAULT_SUGGEST_LIMIT;
  return Math.min(Math.max(n, 1), MAX_SUGGEST_LIMIT);
}

export const searchRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get("/api/search", { schema: { querystring: searchQuery } }, async (req) => {
    const query = (req.query.q ?? "").trim();
    if (!query) return { results: [] };
    const pattern = likeContains(query);

    const [runs, chats, drafts, mail, documents, memories] = await Promise.all([
      safeSource("runs", searchRuns(query, pattern)),
      safeSource("chats", searchChats(query, pattern)),
      safeSource("drafts", searchDrafts(query)),
      safeSource("mail", searchMailHits(query)),
      safeSource("documents", searchDocuments(query)),
      safeSource("memories", searchMemories(query)),
    ]);

    // Grouped by type in a fixed order: run, chat, draft, mail, document, memory.
    const results: SearchResult[] = [
      ...runs,
      ...chats,
      ...drafts,
      ...mail,
      ...documents,
      ...memories,
    ];
    return { results };
  });

  app.get("/api/mail/suggest", { schema: { querystring: suggestQuery } }, async (req) => {
    const q = (req.query.q ?? "").trim();
    const limit = clampSuggestLimit(req.query.limit);

    if (!q) {
      // No query yet (composer just opened the @-mention picker): recent
      // threads across every account, newest first — no messageId or
      // snippet, since a thread-level row has neither.
      const overviews = listThreadOverviews({ filter: "recent", limit });
      const items: MailSuggestion[] = overviews.map((t) => ({
        threadId: t.providerThreadId,
        accountId: t.accountId,
        subject: t.subject,
        from: t.participants[0] ?? "",
        date: t.lastMessageAt,
      }));
      return { items };
    }

    // Over-fetch (3x) before dedupe: a keyword match can hit several messages
    // in the same thread, and the composer wants one row per thread, not per
    // message — dropping duplicates first is what makes `limit` rows land.
    const hits = searchMail(q, { limit: limit * 3 });
    const seen = new Set<string>();
    const items: MailSuggestion[] = [];
    for (const hit of hits) {
      const key = `${hit.accountId}:${hit.providerThreadId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        threadId: hit.providerThreadId,
        accountId: hit.accountId,
        messageId: hit.providerMessageId,
        subject: hit.subject,
        from: hit.from,
        date: hit.date,
        snippet: hit.snippet,
      });
      if (items.length >= limit) break;
    }
    return { items };
  });
};
