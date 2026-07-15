import { extname } from "node:path";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { fetchAttachment } from "../email/attachmentFetch.js";
import { badRequest } from "../errors.js";
import { saveUpload } from "../library/ingest.js";
import { errorMessage } from "../util.js";
import { contentDisposition, inlineForMime, mimeForExt } from "./fileResponse.js";

/**
 * On-demand email-attachment access for the chat's slide-over viewer. The
 * mailbox mirror stores no attachment bytes, so both routes fetch live through
 * the account's AttachmentProvider (email/attachmentFetch.ts) — `open` streams
 * the bytes for the viewer, `save` ingests them into the document library.
 */

const attachmentQuery = Type.Object({
  accountId: Type.String(),
  messageId: Type.String(),
  filename: Type.String(),
});

const attachmentBody = Type.Object({
  accountId: Type.String(),
  messageId: Type.String(),
  filename: Type.String(),
});

export const mailRoutes: FastifyPluginAsyncTypebox = async (app) => {
  // Stream one attachment's bytes so the browser can render it. The served
  // MIME is derived from the filename extension (never the provider's declared
  // type), so foreign content can't be served as executable text/html; PDFs,
  // text and images open inline, everything else downloads.
  app.get(
    "/api/mail/attachments/open",
    { schema: { querystring: attachmentQuery } },
    async (req, reply) => {
      const { accountId, messageId, filename } = req.query;
      const { filename: name, bytes } = await fetchAttachment(accountId, messageId, filename);

      const mime = mimeForExt(extname(name));
      const disposition = contentDisposition(inlineForMime(mime) ? "inline" : "attachment", name);
      return reply
        .header("Content-Type", mime)
        .header("Content-Disposition", disposition)
        .send(bytes);
    },
  );

  // Ingest one attachment into the document library, where it is indexed and
  // becomes searchable/readable — the viewer's "Save to library" action.
  app.post("/api/mail/attachments/save", { schema: { body: attachmentBody } }, async (req) => {
    const { accountId, messageId, filename } = req.body;
    const { filename: name, bytes } = await fetchAttachment(accountId, messageId, filename);
    try {
      return { saved: await saveUpload(name, bytes) };
    } catch (error) {
      throw badRequest(errorMessage(error));
    }
  });
};
