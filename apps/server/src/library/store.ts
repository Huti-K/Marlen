import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { LibraryDocument } from "@trailin/shared";
import { db, schema, sqlite } from "../db/index.js";

/**
 * SQLite persistence for the document library. Document metadata lives in
 * library_documents; the extracted text lives as ordered chunks in the
 * library_chunks FTS5 table, which powers keyword search (BM25-ranked).
 * Chunks are contiguous slices, so joining them restores the full text.
 */

export interface DocumentInput {
  path: string;
  title: string;
  ext: string;
  size: number;
  mtimeMs: number;
  status: "indexed" | "error";
  error: string | null;
  textLength: number;
}

export interface SearchHit {
  documentId: string;
  path: string;
  title: string;
  /** Position of the matching chunk within the document (0-based). */
  seq: number;
  snippet: string;
}

const upsertDocumentStmt = sqlite.prepare(`
  INSERT INTO library_documents
    (id, path, title, ext, size, mtime_ms, status, error, chunk_count, text_length, indexed_at)
  VALUES
    (@id, @path, @title, @ext, @size, @mtimeMs, @status, @error, @chunkCount, @textLength, @indexedAt)
  ON CONFLICT(path) DO UPDATE SET
    title = excluded.title, ext = excluded.ext, size = excluded.size,
    mtime_ms = excluded.mtime_ms, status = excluded.status, error = excluded.error,
    chunk_count = excluded.chunk_count, text_length = excluded.text_length,
    indexed_at = excluded.indexed_at
`);
const selectIdByPath = sqlite.prepare(`SELECT id FROM library_documents WHERE path = ?`);
const deleteDocumentStmt = sqlite.prepare(`DELETE FROM library_documents WHERE id = ?`);
const insertChunkStmt = sqlite.prepare(
  `INSERT INTO library_chunks (content, doc_id, seq) VALUES (?, ?, ?)`,
);
const deleteChunksStmt = sqlite.prepare(`DELETE FROM library_chunks WHERE doc_id = ?`);
const selectChunksStmt = sqlite.prepare(
  `SELECT content FROM library_chunks WHERE doc_id = ? ORDER BY seq`,
);

/** Write a document and its chunks atomically, keeping the id stable across re-indexes. */
export const replaceDocument = sqlite.transaction(
  (doc: DocumentInput, chunks: string[]): string => {
    const existing = selectIdByPath.get(doc.path) as { id: string } | undefined;
    const id = existing?.id ?? randomUUID();
    upsertDocumentStmt.run({
      id,
      ...doc,
      chunkCount: chunks.length,
      indexedAt: new Date().toISOString(),
    });
    deleteChunksStmt.run(id);
    chunks.forEach((content, seq) => insertChunkStmt.run(content, id, seq));
    return id;
  },
);

export const removeDocument = sqlite.transaction((id: string): void => {
  deleteChunksStmt.run(id);
  deleteDocumentStmt.run(id);
});

function toShared(row: typeof schema.libraryDocuments.$inferSelect): LibraryDocument {
  return {
    id: row.id,
    path: row.path,
    title: row.title,
    ext: row.ext,
    size: row.size,
    status: row.status,
    error: row.error,
    chunkCount: row.chunkCount,
    textLength: row.textLength,
    modifiedAt: new Date(row.mtimeMs).toISOString(),
    indexedAt: row.indexedAt,
  };
}

export async function listDocuments(): Promise<LibraryDocument[]> {
  const rows = await db.select().from(schema.libraryDocuments).orderBy(schema.libraryDocuments.path);
  return rows.map(toShared);
}

export async function getDocument(id: string): Promise<LibraryDocument | null> {
  const [row] = await db
    .select()
    .from(schema.libraryDocuments)
    .where(eq(schema.libraryDocuments.id, id));
  return row ? toShared(row) : null;
}

/** Extracted text of one document, as its ordered chunks (join to restore the text). */
export function readDocumentChunks(id: string): string[] {
  const rows = selectChunksStmt.all(id) as { content: string }[];
  return rows.map((r) => r.content);
}

/** Turn free text into an FTS5 MATCH expression; null when it has no searchable terms. */
function buildMatch(query: string, operator: "AND" | "OR"): string | null {
  const terms = query.match(/[\p{L}\p{N}]+/gu)?.slice(0, 12);
  if (!terms || terms.length === 0) return null;
  return terms.map((t) => `"${t}"`).join(operator === "AND" ? " " : " OR ");
}

const searchStmt = sqlite.prepare(`
  SELECT c.doc_id AS documentId, c.seq AS seq, d.path AS path, d.title AS title,
         snippet(library_chunks, 0, '', '', ' … ', 24) AS snippet
  FROM library_chunks c
  JOIN library_documents d ON d.id = c.doc_id
  WHERE library_chunks MATCH ?
  ORDER BY bm25(library_chunks)
  LIMIT ?
`);

/** BM25 keyword search: all terms first, any term as the fallback. */
export function searchChunks(query: string, limit: number): SearchHit[] {
  const run = (match: string | null) =>
    match ? (searchStmt.all(match, limit) as SearchHit[]) : [];
  const strict = run(buildMatch(query, "AND"));
  if (strict.length > 0) return strict;
  return run(buildMatch(query, "OR"));
}
