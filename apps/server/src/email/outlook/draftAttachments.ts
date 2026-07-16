import type { ConnectedAccount } from "@trailin/shared";
import { proxyRequest } from "../../pipedream/connect.js";
import { errorMessage } from "../../util.js";
import type { DraftAttachment } from "../providers.js";
import { GRAPH_API } from "./message.js";

/**
 * Attach files to an existing Outlook draft message via Microsoft Graph.
 * Graph has no way to create a message with attachments in one call, so
 * ./drafts.ts creates the draft first and then calls addOutlookAttachments —
 * small files as a single fileAttachment POST, large ones through Graph's
 * upload-session protocol.
 */

/** Graph's limit for a single fileAttachment POST; larger files need an upload session. */
const SMALL_ATTACHMENT_MAX = 3 * 1024 * 1024;

/**
 * Upload-session chunk size. Graph requires every non-final chunk to be a
 * multiple of 320 KiB; this is 10 of them (~3.1 MB), comfortably under
 * Graph's 4 MB per-request ceiling.
 */
const UPLOAD_CHUNK_SIZE = 3_276_800;

async function attachSmall(
  account: ConnectedAccount,
  messageId: string,
  attachment: DraftAttachment,
): Promise<void> {
  await proxyRequest(account.id, "post", `${GRAPH_API}/messages/${messageId}/attachments`, {
    body: {
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: attachment.filename,
      contentType: attachment.mimeType,
      contentBytes: attachment.content.toString("base64"),
    },
  });
}

/**
 * Large-file path: create an upload session through the Connect proxy, then
 * PUT the raw bytes in chunks straight to the session's uploadUrl with
 * `fetch` — the URL is pre-authenticated by Graph, so it must NOT go through
 * the proxy (which would add credentials Graph rejects on that endpoint).
 */
async function attachViaUploadSession(
  account: ConnectedAccount,
  messageId: string,
  attachment: DraftAttachment,
): Promise<void> {
  const session = (await proxyRequest(
    account.id,
    "post",
    `${GRAPH_API}/messages/${messageId}/attachments/createUploadSession`,
    {
      body: {
        AttachmentItem: {
          attachmentType: "file",
          name: attachment.filename,
          size: attachment.content.length,
        },
      },
    },
  )) as { uploadUrl?: string };
  if (!session.uploadUrl) {
    throw new Error(`Graph returned no upload URL for "${attachment.filename}".`);
  }

  const total = attachment.content.length;
  for (let start = 0; start < total; start += UPLOAD_CHUNK_SIZE) {
    const end = Math.min(start + UPLOAD_CHUNK_SIZE, total);
    const chunk = attachment.content.subarray(start, end);
    const res = await fetch(session.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(chunk.length),
        "Content-Range": `bytes ${start}-${end - 1}/${total}`,
      },
      body: new Uint8Array(chunk),
    });
    if (!res.ok) {
      throw new Error(
        `Uploading "${attachment.filename}" failed at bytes ${start}-${end - 1}: HTTP ${res.status}.`,
      );
    }
  }
}

/**
 * Attach every file to the draft, in order. On a failure the already-attached
 * files stay on the draft and the error names the draft and what is still
 * missing, so the caller can surface a recoverable state — the draft is never
 * deleted here.
 */
export async function addOutlookAttachments(
  account: ConnectedAccount,
  messageId: string,
  attachments: DraftAttachment[],
): Promise<void> {
  for (let i = 0; i < attachments.length; i++) {
    const attachment = attachments[i];
    if (!attachment) continue;
    try {
      if (attachment.content.length <= SMALL_ATTACHMENT_MAX) {
        await attachSmall(account, messageId, attachment);
      } else {
        await attachViaUploadSession(account, messageId, attachment);
      }
    } catch (error) {
      const missing = attachments.slice(i).map((a) => `"${a.filename}"`);
      throw new Error(
        `Draft ${messageId} was created, but attaching ${missing.join(", ")} failed: ` +
          `${errorMessage(error)}. ` +
          `The draft exists without ${missing.length === 1 ? "this file" : "these files"} — ` +
          `the user can attach ${missing.length === 1 ? "it" : "them"} in Outlook, or the draft can be recreated.`,
      );
    }
  }
}
