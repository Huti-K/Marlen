import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { formatFileSize, type MemoryEntry } from "@trailin/shared";
import { and, desc, eq, gte } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { likeContains, likePattern } from "../db/like.js";
import {
  createMemory,
  deleteMemory,
  listMemories,
  recordMemoryUse,
  updateMemory,
} from "../db/memories.js";
import { getLibraryDir, SUPPORTED_FORMATS, saveNote } from "../library/ingest.js";
import { getDocument, listDocuments, readDocumentChunks, searchChunks } from "../library/store.js";
import { collapseWhitespace } from "../search/snippets.js";
import { groupBy } from "../util.js";
import { fetchAccountNameMap, resolveAccountParam } from "./accounts.js";
import { clampLimit, textResult, tool } from "./toolkit.js";

/**
 * The agent's local knowledge tools: long-term memory plus the document
 * library (the drop folder). Everything is served from SQLite — no network,
 * no extra processes.
 */

/** Chunks per library_read part; ≈ 15k characters. Search hits cite these parts. */
const PART_CHUNKS = 8;

/** Lowercased, trimmed — matches how memories.contactId is normalized. */
function normalizeContactAddress(raw: string): string {
  return raw.trim().toLowerCase();
}

const memorySave: AgentTool = tool({
  name: "memory_save",
  label: "Save to memory",
  description:
    `Save one short, standing fact to long-term memory — a single self-contained sentence ` +
    `(people, sign-offs, recurring context). Saved entries appear in your system prompt in ` +
    `every future conversation, so keep them terse. Do not save one-off task details, whole ` +
    `emails, or things already in memory. Anything longer-form or document-shaped — ` +
    `correspondent background, a thread summary, research findings — belongs in the library ` +
    `instead: use library_write. The user can review and edit memory on the Knowledge page. ` +
    `Facts that only apply to one connected account — a client of one company, a per-inbox rule ` +
    `or preference — should be scoped to it with the account parameter, so they only surface ` +
    `when acting as that account. Facts about one correspondent — their tone, preferences, how ` +
    `they like to be addressed — should be scoped with the contact parameter instead. Leave both ` +
    `unset for facts that apply everywhere; set at most one, never both.`,
  params: {
    content: Type.String({
      description: "The fact to remember, as one short self-contained sentence.",
    }),
    account: Type.Optional(
      Type.String({
        description:
          `The email address of the connected account this fact is specific to (as shown in ` +
          `tool descriptions: "Acts as the connected account: …"); omit for facts that apply everywhere.`,
      }),
    ),
    contact: Type.Optional(
      Type.String({
        description:
          `Scope this fact to a specific correspondent — their email address — instead of an ` +
          `account. Use for facts about one person (tone, preferences, how they like to be ` +
          `addressed); do not combine with account.`,
      }),
    ),
  },
  execute: async ({ content, account, contact }) => {
    const accountRaw = account?.trim();
    const contactRaw = contact?.trim();
    if (accountRaw && contactRaw) {
      return textResult(
        "Scope a memory to an account or a contact, not both — pass only one, or leave both unset.",
      );
    }

    let accountId: string | null = null;
    let contactId: string | null = null;
    let scopeLabel = "general";
    if (accountRaw) {
      const resolved = await resolveAccountParam(accountRaw);
      if (resolved.error) return textResult(resolved.error);
      accountId = resolved.account?.id ?? null;
      scopeLabel = resolved.account?.name ?? "general";
    } else if (contactRaw) {
      contactId = normalizeContactAddress(contactRaw);
      scopeLabel = contactId;
    }

    const { entry, created } = await createMemory(content, "agent", accountId, contactId);
    return textResult(
      created
        ? `Saved to long-term memory (${scopeLabel}): ${entry.content}`
        : `Already in memory (${scopeLabel}): ${entry.content}`,
    );
  },
});

const memoryUpdate: AgentTool = tool({
  name: "memory_update",
  label: "Update memory",
  description:
    `Update one long-term memory entry when a fact has changed or the user corrects it — ` +
    `instead of saving a second, contradicting entry. Use the id shown in brackets in the ` +
    `Long-term memory list in your system prompt. Pass account to move the entry into a ` +
    `connected account's scope (facts specific to one inbox or client), or contact to scope ` +
    `this fact to a specific correspondent — their email address — instead of an account; pass ` +
    `either as "general" to make the entry apply everywhere. Omit both to keep the entry's ` +
    `current scope; never pass both account and contact with a real value.`,
  params: {
    id: Type.String({
      description: "The memory id (the bracketed id from the Long-term memory list).",
    }),
    content: Type.String({
      description: "The corrected fact, as one short self-contained sentence.",
    }),
    account: Type.Optional(
      Type.String({
        description:
          `The email address of the connected account to scope this entry to, or "general" to ` +
          `make it apply everywhere; omit to keep its current scope.`,
      }),
    ),
    contact: Type.Optional(
      Type.String({
        description:
          `The email address of the correspondent to scope this entry to, or "general" to make ` +
          `it apply everywhere; omit to keep its current scope. Do not combine with account.`,
      }),
    ),
  },
  execute: async ({ id, content, account, contact }) => {
    const accountRaw = account?.trim();
    const contactRaw = contact?.trim();
    const accountIsGeneral = accountRaw?.toLowerCase() === "general";
    const contactIsGeneral = contactRaw?.toLowerCase() === "general";
    if (accountRaw && contactRaw && !accountIsGeneral && !contactIsGeneral) {
      return textResult(
        "Scope a memory to an account or a contact, not both — pass only one, or leave both unset.",
      );
    }

    let accountId: string | null | undefined;
    let contactId: string | null | undefined;
    if (accountIsGeneral || contactIsGeneral) {
      // "general" on either parameter means the same thing: clear both scope axes.
      accountId = null;
      contactId = null;
    } else if (accountRaw) {
      const resolved = await resolveAccountParam(accountRaw);
      if (resolved.error) return textResult(resolved.error);
      accountId = resolved.account?.id;
      contactId = null;
    } else if (contactRaw) {
      contactId = normalizeContactAddress(contactRaw);
      accountId = null;
    }

    const entry = await updateMemory(id, content, accountId, contactId);
    if (!entry) {
      return textResult(
        `No memory found for id ${id} — use the id from the Long-term memory list.`,
      );
    }
    return textResult(`Memory updated: ${entry.content}`);
  },
});

const memoryDelete: AgentTool = tool({
  name: "memory_delete",
  label: "Delete memory",
  description:
    `Delete one long-term memory entry. Use only when the user asks to forget something or a ` +
    `fact is clearly obsolete — not to make room for an update, use memory_update for that. ` +
    `Use the id shown in brackets in the Long-term memory list in your system prompt.`,
  params: {
    id: Type.String({
      description: "The memory id (the bracketed id from the Long-term memory list).",
    }),
  },
  execute: async ({ id }) => {
    const deleted = await deleteMemory(id);
    if (!deleted) {
      return textResult(
        `No memory found for id ${id} — use the id from the Long-term memory list.`,
      );
    }
    return textResult(`Memory deleted.`);
  },
});

const memoryUsed: AgentTool = tool({
  name: "memory_used",
  label: "Note memory used",
  description:
    `Record which long-term memories you actually relied on this turn — pass the bracketed ids ` +
    `(from the Long-term memory list in your system prompt) of every entry whose content shaped ` +
    `your reply, draft, or decision. Call it once, at the end of the turn, and only for memories ` +
    `you genuinely used — not every entry shown, and skip it entirely when no saved memory was ` +
    `relevant. It has no user-visible effect; it only tracks which memories earn their place so ` +
    `unused ones can be pruned.`,
  params: {
    ids: Type.Array(Type.String(), {
      description: "Bracketed ids of the memories you relied on this turn.",
    }),
  },
  execute: async ({ ids }) => {
    const recorded = await recordMemoryUse(ids);
    return textResult(
      recorded.length > 0
        ? `Noted ${recorded.length} memor${recorded.length === 1 ? "y" : "ies"} as used.`
        : "No matching memories to note.",
    );
  },
});

const libraryList: AgentTool = tool({
  name: "library_list",
  label: "List library documents",
  description:
    `List every document in the user's local library (files they dropped into the library ` +
    `folder or uploaded in Settings). Returns each document's title and id for library_read.`,
  params: {},
  execute: async () => {
    const documents = await listDocuments();
    if (documents.length === 0) {
      return textResult(
        `The library is empty. The user can drop ${SUPPORTED_FORMATS} files into ` +
          `${getLibraryDir()} (or upload them on the Knowledge page).`,
      );
    }
    const lines = documents.map((d) => {
      const state =
        d.status === "error"
          ? ` — indexing failed: ${d.error ?? "unknown error"}`
          : `, ${Math.max(1, Math.ceil(d.chunkCount / PART_CHUNKS))} part(s)`;
      return `- ${d.title} (${d.ext}, ${formatFileSize(d.size)}${state}) — id: ${d.id}`;
    });
    return textResult(lines.join("\n"));
  },
});

const librarySearch: AgentTool = tool({
  name: "library_search",
  label: "Search library",
  description:
    `Keyword search across the user's local document library (PDFs, notes). Returns matching ` +
    `passages with their document id and part number — read the full context with ` +
    `library_read. Use distinctive keywords from the question; if nothing matches, retry ` +
    `with synonyms or fewer terms.`,
  params: {
    query: Type.String({ description: "Search terms (keywords, not a sentence)." }),
    limit: Type.Optional(Type.Number({ description: "Max results, 1–20 (default 8)." })),
  },
  execute: async ({ query, limit: limitRaw }) => {
    const limit = clampLimit(limitRaw, 8, 20);
    const hits = searchChunks(query, limit);
    if (hits.length === 0) {
      return textResult(`No matches for "${query}". Try other keywords, or library_list.`);
    }
    const lines = hits.map(
      (h) =>
        `[${h.title} — part ${Math.floor(h.seq / PART_CHUNKS) + 1}, id: ${h.documentId}]\n${h.snippet}`,
    );
    return textResult(lines.join("\n\n"));
  },
});

const libraryRead: AgentTool = tool({
  name: "library_read",
  label: "Read library document",
  description:
    `Read a document from the user's library by id (from library_search or library_list). ` +
    `Long documents come in parts of ~15k characters — pass "part" to continue reading.`,
  params: {
    documentId: Type.String({ description: "The document id." }),
    part: Type.Optional(Type.Number({ description: "1-based part to read (default 1)." })),
  },
  execute: async ({ documentId, part }) => {
    const doc = await getDocument(documentId);
    if (!doc) return textResult(`No document with id ${documentId} — check library_list.`);
    if (doc.status === "error") {
      return textResult(`"${doc.title}" could not be indexed: ${doc.error ?? "unknown error"}.`);
    }
    const chunks = readDocumentChunks(documentId);
    const totalParts = Math.max(1, Math.ceil(chunks.length / PART_CHUNKS));
    const wanted = Math.max(1, Math.min(totalParts, Math.round(part ?? 1)));
    const body = chunks.slice((wanted - 1) * PART_CHUNKS, wanted * PART_CHUNKS).join("");
    const header =
      `${doc.title} (${doc.path}) — part ${wanted}/${totalParts}` +
      (wanted < totalParts ? ` — call again with part: ${wanted + 1} for more` : "");
    return textResult(`${header}\n\n${body || "(empty document)"}`);
  },
});

const libraryWrite: AgentTool = tool({
  name: "library_write",
  label: "Write library note",
  description:
    `Save longer-form knowledge as a markdown note in the user's library — background on a ` +
    `correspondent, a thread summary, research findings, anything too long or document-shaped ` +
    `for memory. Writing the same title again overwrites the note, so use that to update it. ` +
    `Notes are indexed like any library document: find them later with library_search or read ` +
    `them with library_read. The user sees the note on the Knowledge page and can edit or ` +
    `delete it there. Not for one-sentence standing facts — use memory_save for those.`,
  params: {
    title: Type.String({
      description:
        "A short note title — becomes the file name (reuse an existing note's title to overwrite it).",
    }),
    content: Type.String({ description: "The note body, as markdown." }),
  },
  catchToText: true,
  execute: async ({ title, content }) => {
    const path = await saveNote(title, content);
    return textResult(
      `Saved note to the library at ${path} — it's now searchable with library_search.`,
    );
  },
});

const HISTORY_DEFAULT_DAYS = 14;
const HISTORY_DEFAULT_LIMIT = 20;
const HISTORY_MAX_LIMIT = 50;
const HISTORY_PREVIEW_CHARS = 200;

const automationHistory: AgentTool = tool({
  name: "automation_history",
  label: "Automation run history",
  description:
    `Past scheduled-automation runs (morning briefings, etc.) — use ` +
    `when the user references "your briefing", "you flagged X", or asks what an automation ` +
    `found or did on some day. Lists recent runs newest first with a short preview of each ` +
    `result; call automation_run_read with a run's id for the full text.`,
  params: {
    automationName: Type.Optional(
      Type.String({
        description:
          'Only runs of the automation whose name contains this (partial match), e.g. "Morgenbriefing".',
      }),
    ),
    days: Type.Optional(
      Type.Number({ description: `How many days back to look (default ${HISTORY_DEFAULT_DAYS}).` }),
    ),
    limit: Type.Optional(
      Type.Number({
        description: `Max runs to return, 1–${HISTORY_MAX_LIMIT} (default ${HISTORY_DEFAULT_LIMIT}).`,
      }),
    ),
  },
  execute: async ({ automationName, days, limit: limitRaw }) => {
    const windowDays = Math.max(1, Math.round(days ?? HISTORY_DEFAULT_DAYS));
    const limit = clampLimit(limitRaw, HISTORY_DEFAULT_LIMIT, HISTORY_MAX_LIMIT);
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

    const conditions = [gte(schema.automationRuns.startedAt, since)];
    const name = automationName?.trim();
    if (name) conditions.push(likePattern(schema.automations.name, likeContains(name)));

    const rows = await db
      .select({
        id: schema.automationRuns.id,
        name: schema.automations.name,
        status: schema.automationRuns.status,
        result: schema.automationRuns.result,
        startedAt: schema.automationRuns.startedAt,
      })
      .from(schema.automationRuns)
      .leftJoin(schema.automations, eq(schema.automations.id, schema.automationRuns.automationId))
      .where(and(...conditions))
      .orderBy(desc(schema.automationRuns.startedAt))
      .limit(limit);

    if (rows.length === 0) {
      return textResult(
        name
          ? `No automation runs matching "${name}" in the last ${windowDays} day(s).`
          : `No automation runs in the last ${windowDays} day(s).`,
      );
    }

    const lines = rows.map((r) => {
      const collapsed = collapseWhitespace(r.result);
      const preview = collapsed.slice(0, HISTORY_PREVIEW_CHARS);
      const suffix = collapsed.length > HISTORY_PREVIEW_CHARS ? "…" : "";
      return (
        `- [${r.id}] ${r.name ?? "(deleted automation)"} — ${r.status} — ${r.startedAt}` +
        (preview ? ` — ${preview}${suffix}` : "")
      );
    });
    return textResult(lines.join("\n"));
  },
});

const automationRunRead: AgentTool = tool({
  name: "automation_run_read",
  label: "Read automation run",
  description:
    `Read one past automation run in full — its complete result text plus the automation ` +
    `name, status, and timestamps. Use the run id shown in brackets by automation_history.`,
  params: {
    runId: Type.String({ description: "The run id (from automation_history)." }),
  },
  execute: async ({ runId }) => {
    const [row] = await db
      .select({
        name: schema.automations.name,
        status: schema.automationRuns.status,
        result: schema.automationRuns.result,
        startedAt: schema.automationRuns.startedAt,
        finishedAt: schema.automationRuns.finishedAt,
      })
      .from(schema.automationRuns)
      .leftJoin(schema.automations, eq(schema.automations.id, schema.automationRuns.automationId))
      .where(eq(schema.automationRuns.id, runId));

    if (!row) {
      return textResult(
        `No automation run found for id ${runId} — use automation_history to look up run ids.`,
      );
    }

    const header =
      `${row.name ?? "(deleted automation)"} — ${row.status} — started ${row.startedAt}` +
      (row.finishedAt ? `, finished ${row.finishedAt}` : "");
    return textResult(`${header}\n\n${row.result || "(empty result)"}`);
  },
});

export function buildKnowledgeTools(): AgentTool[] {
  return [
    memorySave,
    memoryUpdate,
    memoryDelete,
    memoryUsed,
    libraryList,
    librarySearch,
    libraryRead,
    libraryWrite,
    automationHistory,
    automationRunRead,
  ];
}

/**
 * Read-only subset of the knowledge tools — no memory or library content
 * writes — given to background delegate workers and unattended runs.
 * memory_used is included even though it mutates a row: it only bumps a usage
 * counter on an existing entry, so it can't inject attacker-controlled content
 * into a later session's prompt the way memory_save could, and background
 * drafting is a real consumer of memories whose use should still be counted.
 */
export function buildKnowledgeReadTools(): AgentTool[] {
  return [
    memoryUsed,
    libraryList,
    librarySearch,
    libraryRead,
    automationHistory,
    automationRunRead,
  ];
}

/** Library titles listed in the system prompt are capped so it can't grow unbounded. */
const LIBRARY_TOC_LIMIT = 100;

/**
 * The dynamic context sections shared by the main agent's and the background
 * workers' system prompts: saved memories plus the library table of contents.
 * Returns "" when there is nothing to show.
 */
export async function buildKnowledgeContext(): Promise<string> {
  let context = "";

  const memories = await listMemories();
  if (memories.length > 0) {
    const format = (list: MemoryEntry[]) =>
      list.map((m) => `- [${m.id.slice(0, 8)}] ${m.content}`).join("\n");

    const global = memories.filter((m) => m.accountId === null && m.contactId === null);
    const accountScoped = memories.filter((m) => m.accountId !== null);
    const contactScoped = memories.filter((m) => m.contactId !== null);

    const sections: string[] = [];
    if (global.length > 0) sections.push(format(global));

    if (accountScoped.length > 0) {
      const names = await fetchAccountNameMap();
      const byAccount = groupBy(accountScoped, (m) => m.accountId as string);
      for (const [accountId, entries] of byAccount) {
        const name = names.get(accountId) ?? accountId;
        sections.push(
          `Memory for ${name} (applies only when reading or writing as this account):\n${format(entries)}`,
        );
      }
    }

    if (contactScoped.length > 0) {
      const byContact = groupBy(contactScoped, (m) => m.contactId as string);
      for (const [address, entries] of byContact) {
        sections.push(
          `Memory about ${address} (applies only when corresponding with them):\n${format(entries)}`,
        );
      }
    }

    context += `\n\nLong-term memory (saved earlier; the user manages these on the Knowledge page):\n${sections.join("\n\n")}\n\nWhen one of these memories shapes your reply, draft, or decision this turn, call memory_used at the end with the bracketed id(s) of the ones you actually relied on — only those, and skip the call when none were relevant.`;
  }

  const indexed = (await listDocuments()).filter((d) => d.status === "indexed" && d.chunkCount > 0);
  if (indexed.length > 0) {
    const shown = indexed.slice(0, LIBRARY_TOC_LIMIT);
    const lines = shown.map((d) => `- ${d.title} (${d.ext})`);
    if (indexed.length > shown.length) {
      lines.push(`… and ${indexed.length - shown.length} more — use library_list.`);
    }
    context += `\n\nDocument library (search with library_search, read with library_read):\n${lines.join("\n")}`;
  }
  return context;
}
