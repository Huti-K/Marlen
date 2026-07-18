import type { ConnectedAccount } from "@trailin/shared";
import { proxyRequest } from "../../pipedream/connect.js";
import type { AttachmentProvider, EmailAttachment } from "../attachmentProviders.js";
import { GRAPH_API } from "./message.js";

/**
 * Outlook AttachmentProvider: lists a message's attachments and downloads
 * their bytes through the Connect proxy (Microsoft Graph, same pattern as
 * ./drafts.ts). Attachment selection, extension validation and library
 * ingest live in the provider-neutral ../../agent/attachmentTool.ts;
 * this file only speaks Graph's wire format. Registered by
 * ../registerAttachmentProviders.ts.
 *
 * Only fileAttachments are surfaced — Graph's other kinds (itemAttachment:
 * an attached email, referenceAttachment: a OneDrive link) carry no file
 * bytes to save.
 */

const FILE_ATTACHMENT_TYPE = "#microsoft.graph.fileAttachment";

interface GraphAttachment {
  "@odata.type"?: string;
  id?: string;
  name?: string;
  contentType?: string;
  size?: number;
  /** Base64 file content; present only when a single attachment is fetched by id. */
  contentBytes?: string;
}

interface AttachmentsListResponse {
  value?: GraphAttachment[];
}

export const outlookAttachmentProvider: AttachmentProvider = {
  async listAttachments(account: ConnectedAccount, messageId: string): Promise<EmailAttachment[]> {
    // Metadata only — without $select Graph inlines every attachment's
    // base64 contentBytes into the list; bytes are fetched per attachment
    // in downloadAttachment instead.
    const list = (await proxyRequest(
      account.id,
      "get",
      `${GRAPH_API}/messages/${messageId}/attachments`,
      { params: { $select: "id,name,contentType,size" } },
    )) as AttachmentsListResponse;

    return (list.value ?? []).flatMap((attachment): EmailAttachment[] => {
      if (attachment["@odata.type"] !== FILE_ATTACHMENT_TYPE || !attachment.name || !attachment.id)
        return [];
      return [
        {
          filename: attachment.name,
          ...(attachment.contentType ? { mimeType: attachment.contentType } : {}),
          ...(attachment.size !== undefined ? { size: attachment.size } : {}),
          // Graph never inlines bytes in the $select'ed list, so every entry
          // downloads by ref (the attachment id).
          ref: attachment.id,
        },
      ];
    });
  },

  async downloadAttachment(
    account: ConnectedAccount,
    messageId: string,
    ref: string,
  ): Promise<Buffer> {
    const fetched = (await proxyRequest(
      account.id,
      "get",
      `${GRAPH_API}/messages/${messageId}/attachments/${ref}`,
    )) as GraphAttachment;
    if (!fetched.contentBytes) throw new Error("Outlook returned no data for this attachment.");
    return Buffer.from(fetched.contentBytes, "base64");
  },
};
