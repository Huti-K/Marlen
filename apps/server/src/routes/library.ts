import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import type { LibrarySearchHit, LibraryStatus } from "@trailin/shared";
import { badRequest, notFound } from "../errors.js";
import { deleteDocument, getLibraryDir, saveUpload, setLibraryFolder } from "../library/ingest.js";
import { pickFolder } from "../library/pickFolder.js";
import { getDocument, listDocuments, type SearchHit, searchChunks } from "../library/store.js";
import { trimSnippet } from "../search/snippets.js";
import { errorMessage } from "../utils/util.js";
import { contentDisposition, inlineForMime, mimeForExt } from "./fileResponse.js";

const UPLOAD_LIMIT = 64 * 1024 * 1024;

// Over-fetch chunk-level hits so collapsing them to one entry per document
// still leaves close to SEARCH_DOC_LIMIT distinct documents.
const SEARCH_DOC_LIMIT = 20;
const SEARCH_CHUNK_LIMIT = 80;

/** BM25 chunk search collapsed to one best-ranked hit per document. */
function searchDocuments(q: string): LibrarySearchHit[] {
  let hits: SearchHit[];
  try {
    hits = searchChunks(q, SEARCH_CHUNK_LIMIT);
  } catch {
    // buildMatch() already quotes extracted terms, but guard here too in
    // case the FTS5 engine still rejects the input — retry sanitized rather
    // than letting the request 500.
    try {
      hits = searchChunks(q.replace(/[^\p{L}\p{N}\s]/gu, " "), SEARCH_CHUNK_LIMIT);
    } catch {
      hits = [];
    }
  }

  const seen = new Set<string>();
  const results: LibrarySearchHit[] = [];
  for (const hit of hits) {
    if (seen.has(hit.documentId)) continue;
    seen.add(hit.documentId);
    results.push({
      id: hit.documentId,
      title: hit.title,
      path: hit.path,
      ext: hit.ext,
      snippet: trimSnippet(hit.snippet),
    });
    if (results.length >= SEARCH_DOC_LIMIT) break;
  }
  return results;
}

const librarySearchQuery = Type.Object({ q: Type.Optional(Type.String()) });
const libraryFolderBody = Type.Object({ folder: Type.Optional(Type.String()) });
const libraryFilesQuery = Type.Object({ name: Type.Optional(Type.String()) });
const documentIdParams = Type.Object({ id: Type.String() });

/** The document library: list, upload into the drop folder, rescan, delete. */
export const libraryRoutes: FastifyPluginAsyncTypebox = async (app) => {
  // Uploads arrive as the raw file body (application/octet-stream), the name
  // in the query string — no multipart dependency needed for one file.
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer", bodyLimit: UPLOAD_LIMIT },
    (_req, body, done) => done(null, body),
  );

  const status = async (): Promise<LibraryStatus> => ({
    folder: getLibraryDir(),
    documents: await listDocuments(),
  });

  app.get("/api/library", async () => status());

  app.get("/api/library/search", { schema: { querystring: librarySearchQuery } }, async (req) => {
    const q = (req.query.q ?? "").trim();
    if (!q) return { results: [] };
    return { results: searchDocuments(q) };
  });

  app.put("/api/library/folder", { schema: { body: libraryFolderBody } }, async (req) => {
    try {
      await setLibraryFolder(req.body.folder ?? "");
    } catch (error) {
      throw badRequest(errorMessage(error));
    }
    return status();
  });

  // Opens the OS's native folder-picker dialog on the server's machine and,
  // unless the user cancels, applies the chosen folder — same validation as
  // the manual PUT above, since setLibraryFolder does the actual switching.
  app.post("/api/library/folder/pick", async () => {
    try {
      const picked = await pickFolder();
      if ("canceled" in picked) return { canceled: true };
      await setLibraryFolder(picked.path);
    } catch (error) {
      throw badRequest(errorMessage(error));
    }
    return status();
  });

  app.post(
    "/api/library/files",
    { bodyLimit: UPLOAD_LIMIT, schema: { querystring: libraryFilesQuery } },
    async (req) => {
      if (!Buffer.isBuffer(req.body)) {
        throw badRequest("send the file as application/octet-stream");
      }
      try {
        await saveUpload(req.query.name ?? "", req.body);
      } catch (error) {
        throw badRequest(errorMessage(error));
      }
      return status();
    },
  );

  // Stream the original file so the browser can view/download it.
  app.get(
    "/api/library/documents/:id/open",
    { schema: { params: documentIdParams } },
    async (req, reply) => {
      const doc = await getDocument(req.params.id);
      if (!doc) throw notFound("document not found");

      const absPath = join(getLibraryDir(), doc.path);
      try {
        await stat(absPath);
      } catch {
        throw notFound("file not found on disk");
      }

      const mime = mimeForExt(doc.ext);
      // PDFs, plain text (html/htm mapped to text/plain so they render as inert
      // source) and images open in-browser; everything else downloads.
      const disposition = contentDisposition(
        inlineForMime(mime) ? "inline" : "attachment",
        `${doc.title}.${doc.ext}`,
      );

      return reply
        .header("Content-Type", mime)
        .header("Content-Disposition", disposition)
        .send(createReadStream(absPath));
    },
  );

  app.delete(
    "/api/library/documents/:id",
    { schema: { params: documentIdParams } },
    async (req) => {
      if (!(await deleteDocument(req.params.id))) {
        throw notFound("document not found");
      }
      return status();
    },
  );
};
