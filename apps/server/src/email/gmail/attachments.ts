import type { ConnectedAccount } from "@trailin/shared";
import { proxyRequest } from "../../pipedream/connect.js";
import type { AttachmentProvider, EmailAttachment } from "../attachmentProviders.js";
import { forEachAttachmentPart, GMAIL_API, type MessagePart } from "./message.js";

/**
 * Gmail AttachmentProvider: lists a message's attachments and downloads
 * their bytes through the Connect proxy (plain Gmail REST API, same pattern
 * as ./drafts.ts). Everything user-facing — attachment selection,
 * extension validation, library ingest — lives in the provider-neutral
 * ../../agent/attachmentTool.ts; this file only speaks Gmail's wire
 * format. Registered by ./registerAttachmentProviders.ts.
 */

interface MessageGetResponse {
  payload?: MessagePart;
}

interface AttachmentGetResponse {
  data?: string;
}

/**
 * Bytes of one non-inline attachment, downloaded by its Gmail attachmentId
 * and base64url-decoded — the one download path for this provider and for
 * ./drafts.ts's attachment re-embedding. `label` names the attachment in the
 * failure message.
 */
export async function downloadGmailAttachment(
  account: ConnectedAccount,
  messageId: string,
  attachmentId: string,
  label = "this attachment",
): Promise<Buffer> {
  const fetched = (await proxyRequest(
    account.id,
    "get",
    `${GMAIL_API}/messages/${messageId}/attachments/${attachmentId}`,
  )) as AttachmentGetResponse;
  if (!fetched.data) throw new Error(`Gmail returned no data for ${label}.`);
  return Buffer.from(fetched.data, "base64url");
}

export const gmailAttachmentProvider: AttachmentProvider = {
  async listAttachments(account: ConnectedAccount, messageId: string): Promise<EmailAttachment[]> {
    const message = (await proxyRequest(account.id, "get", `${GMAIL_API}/messages/${messageId}`, {
      params: { format: "full" },
    })) as MessageGetResponse;
    const attachments: EmailAttachment[] = [];
    forEachAttachmentPart(message.payload, (part, filename) => {
      attachments.push({
        filename,
        ...(part.mimeType ? { mimeType: part.mimeType } : {}),
        ...(part.body?.size !== undefined ? { size: part.body.size } : {}),
        // Small attachments arrive inline as base64url; larger ones only carry
        // an attachmentId, packed into the opaque `ref` for downloadAttachment.
        ...(part.body?.attachmentId ? { ref: part.body.attachmentId } : {}),
        ...(part.body?.data ? { data: Buffer.from(part.body.data, "base64url") } : {}),
      });
    });
    return attachments;
  },

  async downloadAttachment(
    account: ConnectedAccount,
    messageId: string,
    ref: string,
  ): Promise<Buffer> {
    return downloadGmailAttachment(account, messageId, ref);
  },
};
