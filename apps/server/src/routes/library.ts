import type { FastifyInstance } from "fastify";
import type { LibraryStatus } from "@trailin/shared";
import { deleteDocument, libraryDir, saveUpload, scanLibrary } from "../library/ingest.js";
import { listDocuments } from "../library/store.js";
import { errorMessage } from "../util.js";

const UPLOAD_LIMIT = 64 * 1024 * 1024;

/** The document library: list, upload into the drop folder, rescan, delete. */
export async function libraryRoutes(app: FastifyInstance): Promise<void> {
  // Uploads arrive as the raw file body (application/octet-stream), the name
  // in the query string — no multipart dependency needed for one file.
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer", bodyLimit: UPLOAD_LIMIT },
    (_req, body, done) => done(null, body),
  );

  const status = async (): Promise<LibraryStatus> => ({
    folder: libraryDir,
    documents: await listDocuments(),
  });

  app.get("/api/library", async () => status());

  app.post("/api/library/scan", async () => {
    await scanLibrary();
    return status();
  });

  app.post<{ Querystring: { name?: string } }>(
    "/api/library/files",
    { bodyLimit: UPLOAD_LIMIT },
    async (req, reply) => {
      if (!Buffer.isBuffer(req.body)) {
        return reply.code(400).send({ error: "send the file as application/octet-stream" });
      }
      try {
        await saveUpload(req.query.name ?? "", req.body);
      } catch (error) {
        return reply.code(400).send({ error: errorMessage(error) });
      }
      return status();
    },
  );

  app.delete<{ Params: { id: string } }>("/api/library/documents/:id", async (req, reply) => {
    if (!(await deleteDocument(req.params.id))) {
      return reply.code(404).send({ error: "document not found" });
    }
    return status();
  });
}
