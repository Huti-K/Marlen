import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  formatFileSize,
  MEMORY_MAX_COUNT,
  MEMORY_MAX_LENGTH,
  type MemoryEntry,
} from "@marlen/shared";
import { Type } from "@sinclair/typebox";
import { groupBy } from "../core/utils/util.js";
import { getLibraryDir, SUPPORTED_FORMATS } from "../storage/library/ingest.js";
import {
  getDocument,
  listDocuments,
  readDocumentChunks,
  searchChunks,
} from "../storage/library/store.js";
import {
  createMemory,
  deleteMemory,
  listMemories,
  recordMemoryUse,
  updateMemory,
} from "../storage/memories/store.js";
import { fetchAccountNameMap, resolveAccountParam } from "./accounts.js";
import { clampLimit, textResult, tool } from "./toolkit.js";

/** Chunks per library_read part, ≈ 15k characters. */
const PART_CHUNKS = 8;

interface MemoryScope {
  accountId: string | null;
  contactId: string | null;
  label: string;
}

/** contact:<address> is lowercased to match how memories.contactId is normalized. */
async function resolveMemoryScope(raw: string): Promise<MemoryScope | { error: string }> {
  const trimmed = raw.trim();
  if (trimmed.toLowerCase() === "general") {
    return { accountId: null, contactId: null, label: "general" };
  }
  const separator = trimmed.indexOf(":");
  const prefix = separator === -1 ? "" : trimmed.slice(0, separator).trim().toLowerCase();
  const value = separator === -1 ? "" : trimmed.slice(separator + 1).trim();
  if (prefix === "account" && value) {
    const { account, error } = await resolveAccountParam(value, "required");
    if (!account) return { error: error ?? `No connected account matches "${value}".` };
    return { accountId: account.id, contactId: null, label: account.name };
  }
  if (prefix === "contact" && value) {
    const contactId = value.toLowerCase();
    return { accountId: null, contactId, label: contactId };
  }
  return {
    error: `Unrecognized scope "${trimmed}" — use "general", "account:<address>" or "contact:<address>".`,
  };
}

const SCOPE_FORMS =
  `"general" (applies everywhere), "account:<address>" (one connected account) or ` +
  `"contact:<address>" (one correspondent)`;

const memorySave: AgentTool = tool({
  name: "memory_save",
  label: "Save to memory",
  description:
    `Save a NEW standing fact to long-term memory. ALWAYS check the Long-term memory list in ` +
    `your system prompt first: if any existing entry can be rewritten to also cover the new ` +
    `info (same person, same topic, or a broader rule it fits under), rewrite that entry with ` +
    `memory_update instead — memory_save is only for facts no existing entry can absorb. One ` +
    `entry per person or topic, a handful of short lines at most (people, sign-offs, recurring ` +
    `context); saved entries appear in your system prompt in every future conversation, so keep ` +
    `them terse. Do not save one-off task details, whole emails, or things already in memory. ` +
    `Anything longer-form or document-shaped — correspondent background, a thread summary, ` +
    `research findings — belongs in your knowledge folder instead: write it as a markdown note ` +
    `under knowledge/notes/ with file_write, and it gets indexed for library_search. The user ` +
    `can review and edit memory on the Knowledge page. When you file a longer note that should ` +
    `be remembered proactively, also save a one-line memory naming it.`,
  params: {
    content: Type.String({
      description:
        "The fact(s) to remember: a short self-contained sentence, or a few short lines when " +
        "several facts about the same person or topic arrive together.",
    }),
    scope: Type.Optional(
      Type.String({
        description:
          `Where the fact applies; omit for facts that apply everywhere. "account:<address>" ` +
          `scopes it to that connected account (a client of one company, a per-inbox rule or ` +
          `preference) so it only surfaces when acting as that account; "contact:<address>" ` +
          `scopes it to one correspondent (their tone, preferences, how they like to be ` +
          `addressed) so it only surfaces when corresponding with them.`,
      }),
    ),
  },
  execute: async ({ content, scope }) => {
    let target: MemoryScope = { accountId: null, contactId: null, label: "general" };
    if (scope?.trim()) {
      const resolved = await resolveMemoryScope(scope);
      if ("error" in resolved) return textResult(resolved.error);
      target = resolved;
    }
    const { entry, created } = await createMemory(
      content,
      "agent",
      target.accountId,
      target.contactId,
    );
    return textResult(
      created
        ? `Saved to long-term memory (${target.label}): ${entry.content}`
        : `Already in memory (${target.label}): ${entry.content}`,
    );
  },
});

const memoryUpdate: AgentTool = tool({
  name: "memory_update",
  label: "Update memory",
  description:
    `Update one long-term memory entry: when a fact has changed or the user corrects it, and ` +
    `when a new fact belongs to a person or topic the entry already covers — extend the entry ` +
    `rather than saving a second one. Use the id shown in brackets in the Long-term memory ` +
    `list in your system prompt. Pass scope to move the entry — ${SCOPE_FORMS} — or omit it ` +
    `to keep the entry's current scope.`,
  params: {
    id: Type.String({
      description: "The memory id (the bracketed id from the Long-term memory list).",
    }),
    content: Type.String({
      description:
        "The entry's full replacement content — the existing facts (minus anything obsolete) " +
        "plus the correction or addition, as a few short lines at most.",
    }),
    scope: Type.Optional(
      Type.String({
        description: `Move the entry: ${SCOPE_FORMS}. Omit to keep the current scope.`,
      }),
    ),
  },
  execute: async ({ id, content, scope }) => {
    // undefined = keep the entry's current scope (updateMemory's contract).
    let accountId: string | null | undefined;
    let contactId: string | null | undefined;
    if (scope?.trim()) {
      const resolved = await resolveMemoryScope(scope);
      if ("error" in resolved) return textResult(resolved.error);
      accountId = resolved.accountId;
      contactId = resolved.contactId;
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

export function buildKnowledgeTools(): AgentTool[] {
  return [
    memorySave,
    memoryUpdate,
    memoryDelete,
    memoryUsed,
    libraryList,
    librarySearch,
    libraryRead,
  ];
}

/**
 * Read-only subset for background workers and unattended runs. memory_used is
 * included though it mutates: it only bumps a usage counter, so it can't
 * inject attacker-controlled content into a later prompt the way memory_save
 * could.
 */
export function buildKnowledgeReadTools(): AgentTool[] {
  return [memoryUsed, libraryList, librarySearch, libraryRead];
}

/** Caps library titles in the system prompt so it can't grow unbounded. */
const LIBRARY_TOC_LIMIT = 100;

/**
 * One entry as the prompt carries it. Entries are files the user and the agent
 * can also write from outside the app, so the length a memory is allowed to be
 * is enforced here on the way in, not only in createMemory: one hand-edited
 * file cannot take the block over on its own.
 */
function memoryText(entry: MemoryEntry): string {
  const content = entry.content.trim();
  if (content.length <= MEMORY_MAX_LENGTH) return content;
  return `${content.slice(0, MEMORY_MAX_LENGTH)}\n[Cut off here. Read the whole entry with file_read on memory/${entry.id}.md.]`;
}

/** One entry as it is rendered into the block; also what it costs the budget. */
function memoryLine(entry: MemoryEntry): string {
  const text = memoryText(entry);
  return text.includes("\n")
    ? `- [${entry.id}]\n  ${text.split("\n").join("\n  ")}`
    : `- [${entry.id}] ${text}`;
}

/** Which section an entry renders under; a new key costs its header too. */
function memoryScope(entry: MemoryEntry): string {
  if (entry.accountId !== null) return `account:${entry.accountId}`;
  if (entry.contactId !== null) return `contact:${entry.contactId}`;
  return "global";
}

/**
 * The entries the prompt can carry, returned in the caller's original order.
 * Both caps are applied over the same most-recently-touched-first pass, so
 * what gets left out is always the stalest thing and a memory saved a moment
 * ago is never the one that goes: the count bounds a folder holding more files
 * than createMemory would allow, the budget bounds files longer than it would
 * allow. Costed on the rendered text, headers included, so the block really
 * does fit. Nothing is deleted: what does not fit stays on disk, and the file
 * tools still reach it.
 */
function withinMemoryBudget(
  memories: MemoryEntry[],
  budget: number,
  headerCost: (scope: string) => number,
): { shown: MemoryEntry[]; omitted: number } {
  const fitting = new Set<string>();
  const scopesSeen = new Set<string>();
  let used = 0;
  for (const entry of [...memories].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    if (fitting.size >= MEMORY_MAX_COUNT) break;
    const scope = memoryScope(entry);
    // +1 for the newline joining this line to the previous one.
    let cost = memoryLine(entry).length + 1;
    if (!scopesSeen.has(scope)) cost += headerCost(scope);
    if (used + cost > budget) break;
    used += cost;
    scopesSeen.add(scope);
    fitting.add(entry.id);
  }
  return {
    shown: memories.filter((entry) => fitting.has(entry.id)),
    omitted: memories.length - fitting.size,
  };
}

const MEMORY_BLOCK_HEADER =
  "\n\nLong-term memory (saved earlier; the user manages these on the Knowledge page):\n";

const MEMORY_BLOCK_FOOTER =
  "\n\nWhen one of these memories shapes your reply, draft, or decision this turn, call memory_used at the end with the bracketed id(s) of the ones you actually relied on — only those, and skip the call when none were relevant.";

/**
 * What the block costs before a single entry: its framing, plus the note that
 * appears when entries had to be left out. Charged up front so the budget the
 * entries are measured against is the room they will actually have.
 */
function memoryFramingCost(): number {
  return MEMORY_BLOCK_HEADER.length + MEMORY_BLOCK_FOOTER.length + omittedNote(999).length;
}

/** The housekeeping note for entries left out; "" when none were. */
function omittedNote(omitted: number): string {
  if (omitted === 0) return "";
  // Memory outgrowing its share is the agent's own housekeeping: it wrote most
  // of these, and it is the only thing positioned to tell which of them are now
  // the same fact said twice. Stated as work to do, since nothing else will do it.
  return `\n\n${omitted} further ${omitted === 1 ? "memory is" : "memories are"} saved but not shown: memory has outgrown the room it gets in this prompt, and these are the least recently touched. They are files under memory/ — find them with file_ls, read one with file_read. Tidy up when you next save or update a memory: merge entries covering the same topic into one with memory_update, and delete with memory_delete what has been superseded or no longer holds. Fewer, fuller entries are the goal, never a longer list.`;
}

/**
 * Memory and the library index, held to `budget` characters between them (the
 * share of the system prompt's ceiling left over by prompt.ts). The library
 * index is measured first: it is already bounded by LIBRARY_TOC_LIMIT, and
 * memory is the section that grows without one.
 */
export async function buildKnowledgeContext(budget: number): Promise<string> {
  const library = await buildLibraryContext();

  const all = await listMemories();
  const names = await fetchAccountNameMap();
  const scopeHeader = (scope: string): string => {
    if (scope === "global") return "";
    const [kind, ...rest] = scope.split(":");
    const id = rest.join(":");
    return kind === "account"
      ? `Memory for ${names.get(id) ?? id} (applies only when reading or writing as this account):\n`
      : `Memory about ${id} (applies only when corresponding with them):\n`;
  };

  const entryBudget = Math.max(0, budget - library.length - memoryFramingCost());
  const { shown: memories, omitted } = withinMemoryBudget(
    all,
    entryBudget,
    // +2 for the blank line separating this section from the previous one.
    (scope) => scopeHeader(scope).length + 2,
  );
  if (memories.length === 0) return library;

  // Multi-line entries render as an id line with the body indented beneath it,
  // so a combined topic file stays one list item.
  const format = (list: MemoryEntry[]) => list.map(memoryLine).join("\n");

  const global = memories.filter((m) => m.accountId === null && m.contactId === null);
  const accountScoped = memories.filter((m) => m.accountId !== null);
  const contactScoped = memories.filter((m) => m.contactId !== null);

  const sections: string[] = [];
  if (global.length > 0) sections.push(format(global));
  for (const [accountId, entries] of groupBy(accountScoped, (m) => m.accountId as string)) {
    sections.push(scopeHeader(`account:${accountId}`) + format(entries));
  }
  for (const [address, entries] of groupBy(contactScoped, (m) => m.contactId as string)) {
    sections.push(scopeHeader(`contact:${address}`) + format(entries));
  }

  return (
    MEMORY_BLOCK_HEADER +
    sections.join("\n\n") +
    omittedNote(omitted) +
    MEMORY_BLOCK_FOOTER +
    library
  );
}

/** The library index: already bounded by LIBRARY_TOC_LIMIT titles, one line each. */
async function buildLibraryContext(): Promise<string> {
  const indexed = (await listDocuments()).filter((d) => d.status === "indexed" && d.chunkCount > 0);
  if (indexed.length === 0) return "";
  const shown = indexed.slice(0, LIBRARY_TOC_LIMIT);
  const lines = shown.map((d) => `- ${d.title} (${d.ext})`);
  if (indexed.length > shown.length) {
    lines.push(`… and ${indexed.length - shown.length} more — use library_list.`);
  }
  return `\n\nDocument library (search with library_search, read with library_read):\n${lines.join("\n")}`;
}
