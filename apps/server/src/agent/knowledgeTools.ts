import type { AgentTool } from "@earendil-works/pi-agent-core";
import { formatFileSize } from "@trailin/shared";
import { createMemory, deleteMemory, listMemories, updateMemory } from "../db/memories.js";
import { getLibraryDir, saveNote, SUPPORTED_FORMATS } from "../library/ingest.js";
import { errorMessage } from "../util.js";
import {
  getDocument,
  listDocuments,
  readDocumentChunks,
  searchChunks,
} from "../library/store.js";

/**
 * The agent's local knowledge tools: long-term memory plus the document
 * library (the drop folder). Everything is served from SQLite — no network,
 * no extra processes.
 */

/** Chunks per library_read part; ≈ 15k characters. Search hits cite these parts. */
const PART_CHUNKS = 8;

const text = (value: string) => ({
  content: [{ type: "text" as const, text: value }],
  details: undefined,
});

const memorySave: AgentTool = {
  name: "memory_save",
  label: "Save to memory",
  description:
    `Save one short, standing fact to long-term memory — a single self-contained sentence ` +
    `(people, sign-offs, recurring context). Saved entries appear in your system prompt in ` +
    `every future conversation, so keep them terse. Do not save one-off task details, whole ` +
    `emails, or things already in memory. Anything longer-form or document-shaped — ` +
    `correspondent background, a thread summary, research findings — belongs in the library ` +
    `instead: use library_write. The user can review and edit memory on the Knowledge page.`,
  parameters: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "The fact to remember, as one short self-contained sentence.",
      },
    },
    required: ["content"],
  } as AgentTool["parameters"],
  execute: async (_id, params) => {
    const { content } = params as { content: string };
    const { entry, created } = await createMemory(content, "agent");
    return text(
      created
        ? `Saved to long-term memory: ${entry.content}`
        : `Already in memory: ${entry.content}`,
    );
  },
};

const memoryUpdate: AgentTool = {
  name: "memory_update",
  label: "Update memory",
  description:
    `Update one long-term memory entry when a fact has changed or the user corrects it — ` +
    `instead of saving a second, contradicting entry. Use the id shown in brackets in the ` +
    `Long-term memory list in your system prompt.`,
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "The memory id (the bracketed id from the Long-term memory list).",
      },
      content: {
        type: "string",
        description: "The corrected fact, as one short self-contained sentence.",
      },
    },
    required: ["id", "content"],
  } as AgentTool["parameters"],
  execute: async (_id, params) => {
    const { id, content } = params as { id: string; content: string };
    const entry = await updateMemory(id, content);
    if (!entry) {
      return text(`No memory found for id ${id} — use the id from the Long-term memory list.`);
    }
    return text(`Memory updated: ${entry.content}`);
  },
};

const memoryDelete: AgentTool = {
  name: "memory_delete",
  label: "Delete memory",
  description:
    `Delete one long-term memory entry. Use only when the user asks to forget something or a ` +
    `fact is clearly obsolete — not to make room for an update, use memory_update for that. ` +
    `Use the id shown in brackets in the Long-term memory list in your system prompt.`,
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "The memory id (the bracketed id from the Long-term memory list).",
      },
    },
    required: ["id"],
  } as AgentTool["parameters"],
  execute: async (_id, params) => {
    const { id } = params as { id: string };
    const deleted = await deleteMemory(id);
    if (!deleted) {
      return text(`No memory found for id ${id} — use the id from the Long-term memory list.`);
    }
    return text(`Memory deleted.`);
  },
};

const libraryList: AgentTool = {
  name: "library_list",
  label: "List library documents",
  description:
    `List every document in the user's local library (files they dropped into the library ` +
    `folder or uploaded in Settings). Returns each document's title and id for library_read.`,
  parameters: { type: "object", properties: {} } as AgentTool["parameters"],
  execute: async () => {
    const documents = await listDocuments();
    if (documents.length === 0) {
      return text(
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
    return text(lines.join("\n"));
  },
};

const librarySearch: AgentTool = {
  name: "library_search",
  label: "Search library",
  description:
    `Keyword search across the user's local document library (PDFs, notes). Returns matching ` +
    `passages with their document id and part number — read the full context with ` +
    `library_read. Use distinctive keywords from the question; if nothing matches, retry ` +
    `with synonyms or fewer terms.`,
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search terms (keywords, not a sentence)." },
      limit: { type: "number", description: "Max results, 1–20 (default 8)." },
    },
    required: ["query"],
  } as AgentTool["parameters"],
  execute: async (_id, params) => {
    const { query, limit } = params as { query: string; limit?: number };
    const capped = Math.max(1, Math.min(20, Math.round(limit ?? 8)));
    const hits = searchChunks(query, capped);
    if (hits.length === 0) {
      return text(`No matches for "${query}". Try other keywords, or library_list.`);
    }
    const lines = hits.map(
      (h) =>
        `[${h.title} — part ${Math.floor(h.seq / PART_CHUNKS) + 1}, id: ${h.documentId}]\n${h.snippet}`,
    );
    return text(lines.join("\n\n"));
  },
};

const libraryRead: AgentTool = {
  name: "library_read",
  label: "Read library document",
  description:
    `Read a document from the user's library by id (from library_search or library_list). ` +
    `Long documents come in parts of ~15k characters — pass "part" to continue reading.`,
  parameters: {
    type: "object",
    properties: {
      documentId: { type: "string", description: "The document id." },
      part: { type: "number", description: "1-based part to read (default 1)." },
    },
    required: ["documentId"],
  } as AgentTool["parameters"],
  execute: async (_id, params) => {
    const { documentId, part } = params as { documentId: string; part?: number };
    const doc = await getDocument(documentId);
    if (!doc) return text(`No document with id ${documentId} — check library_list.`);
    if (doc.status === "error") {
      return text(`"${doc.title}" could not be indexed: ${doc.error ?? "unknown error"}.`);
    }
    const chunks = readDocumentChunks(documentId);
    const totalParts = Math.max(1, Math.ceil(chunks.length / PART_CHUNKS));
    const wanted = Math.max(1, Math.min(totalParts, Math.round(part ?? 1)));
    const body = chunks.slice((wanted - 1) * PART_CHUNKS, wanted * PART_CHUNKS).join("");
    const header =
      `${doc.title} (${doc.path}) — part ${wanted}/${totalParts}` +
      (wanted < totalParts ? ` — call again with part: ${wanted + 1} for more` : "");
    return text(`${header}\n\n${body || "(empty document)"}`);
  },
};

const libraryWrite: AgentTool = {
  name: "library_write",
  label: "Write library note",
  description:
    `Save longer-form knowledge as a markdown note in the user's library — background on a ` +
    `correspondent, a thread summary, research findings, anything too long or document-shaped ` +
    `for memory. Writing the same title again overwrites the note, so use that to update it. ` +
    `Notes are indexed like any library document: find them later with library_search or read ` +
    `them with library_read. The user sees the note on the Knowledge page and can edit or ` +
    `delete it there. Not for one-sentence standing facts — use memory_save for those.`,
  parameters: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description:
          "A short note title — becomes the file name (reuse an existing note's title to overwrite it).",
      },
      content: {
        type: "string",
        description: "The note body, as markdown.",
      },
    },
    required: ["title", "content"],
  } as AgentTool["parameters"],
  execute: async (_id, params) => {
    const { title, content } = params as { title: string; content: string };
    try {
      const path = await saveNote(title, content);
      return text(
        `Saved note to the library at ${path} — it's now searchable with library_search.`,
      );
    } catch (error) {
      return text(errorMessage(error));
    }
  },
};

export function buildKnowledgeTools(): AgentTool[] {
  return [
    memorySave,
    memoryUpdate,
    memoryDelete,
    libraryList,
    librarySearch,
    libraryRead,
    libraryWrite,
  ];
}

/**
 * Read-only subset of the knowledge tools — no memory writes, no
 * library_write — given to background delegate workers.
 */
export function buildKnowledgeReadTools(): AgentTool[] {
  return [libraryList, librarySearch, libraryRead];
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
    context += `\n\nLong-term memory (saved earlier; the user manages these on the Knowledge page):\n${memories
      .map((m) => `- [${m.id.slice(0, 8)}] ${m.content}`)
      .join("\n")}`;
  }

  const indexed = (await listDocuments()).filter(
    (d) => d.status === "indexed" && d.chunkCount > 0,
  );
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
