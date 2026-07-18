import { extname } from "node:path";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { findAccount } from "../agent/accounts.js";
import { fetchAttachment } from "../email/attachmentFetch.js";
import { getMailReadProvider, type ThreadDetail } from "../email/read/readProviders.js";
import { badRequest, notFound, toProviderError } from "../errors.js";
import { saveUpload } from "../library/ingest.js";
import { listAccounts } from "../pipedream/connect.js";
import { contentDisposition, inlineForMime, mimeForExt } from "../utils/fileResponse.js";
import { errorMessage } from "../utils/util.js";

/**
 * On-demand mailbox access for the web UI: attachment bytes for the chat's
 * slide-over viewer, and a thread's conversation for the drafts' collapsible
 * history. Nothing is stored locally — every request reads live through the
 * account's provider (AttachmentProvider / MailReadProvider).
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

const threadQuery = Type.Object({
  accountId: Type.String(),
  threadId: Type.String(),
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
      const { filename: name, bytes } = await fetchAttachment(accountId, messageId, filename).catch(
        (error: unknown) => {
          // A provider 404 means the message is gone upstream; anything else
          // upstream is a 502 — never the raw SDK error, whose statusCode
          // (e.g. a Pipedream 401) would masquerade as this API's own.
          throw toProviderError(error, "attachment not found");
        },
      );

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
    const { filename: name, bytes } = await fetchAttachment(accountId, messageId, filename).catch(
      (error: unknown) => {
        throw toProviderError(error, "attachment not found");
      },
    );
    try {
      return { saved: await saveUpload(name, bytes) };
    } catch (error) {
      throw badRequest(errorMessage(error));
    }
  });

  // One thread's conversation (drafts excluded), read live — what a reply
  // draft's collapsible history expands into.
  app.get(
    "/api/mail/threads",
    { schema: { querystring: threadQuery } },
    async (req): Promise<ThreadDetail> => {
      const { accountId, threadId } = req.query;
      const account = findAccount(await listAccounts(), accountId);
      if (!account) throw notFound("connected account not found");

      const provider = getMailReadProvider(account.app);
      if (!provider?.getThread) throw badRequest(`${account.app} has no thread read support`);

      const thread = await provider.getThread(account, threadId).catch((error: unknown) => {
        throw toProviderError(error, "thread not found");
      });
      if (!thread) throw notFound("thread not found");
      return thread;
    },
  );
};
