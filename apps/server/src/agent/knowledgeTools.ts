import type { AgentTool } from "@earendil-works/pi-agent-core";
import { createMemory } from "../db/memories.js";
import { libraryDir } from "../library/ingest.js";
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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const memorySave: AgentTool = {
  name: "memory_save",
  label: "Save to memory",
  description:
    `Save one lasting fact to long-term memory. Saved entries appear in your system prompt ` +
    `in every future conversation. Use it when the user asks you to remember something or ` +
    `states a stable fact or preference (people, sign-offs, recurring context). Do not save ` +
    `one-off task details, whole emails, or things already in memory. The user can review ` +
    `and edit memory under Settings.`,
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
    const entry = await createMemory(content, "agent");
    return text(`Saved to long-term memory: ${entry.content}`);
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
        `The library is empty. The user can drop PDF, Markdown or text files into ` +
          `${libraryDir} (or upload them under Settings → Documents).`,
      );
    }
    const lines = documents.map((d) => {
      const state =
        d.status === "error"
          ? ` — indexing failed: ${d.error ?? "unknown error"}`
          : `, ${Math.max(1, Math.ceil(d.chunkCount / PART_CHUNKS))} part(s)`;
      return `- ${d.title} (${d.ext}, ${formatSize(d.size)}${state}) — id: ${d.id}`;
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

export function buildKnowledgeTools(): AgentTool[] {
  return [memorySave, libraryList, librarySearch, libraryRead];
}
