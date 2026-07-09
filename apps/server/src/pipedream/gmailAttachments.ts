import { extname } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { formatFileSize, type ConnectedAccount } from "@trailin/shared";
import { LIBRARY_EXTENSIONS, saveUpload, SUPPORTED_FORMATS } from "../library/ingest.js";
import { errorMessage } from "../util.js";
import { proxyRequest } from "./connect.js";

/**
 * "Save attachment to library" tool: downloads one Gmail attachment through
 * the Connect proxy (plain Gmail REST API, same pattern as gmailDrafts.ts)
 * and hands the bytes to the library's saveUpload, so the file gets indexed
 * exactly like anything dropped into the library folder.
 *
 * Live Gmail accounts only — the caller (pipedream/mcp.ts) only wires this
 * tool for a real connected account; demo mode has no live messages to
 * download attachments from, so there is no demo branch here.
 */

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

const text = (value: string) => ({
  content: [{ type: "text" as const, text: value }],
  details: undefined,
});

/** One Gmail MIME part — as much of it as attachment-walking needs. */
interface MessagePart {
  filename?: string;
  mimeType?: string;
  body?: { attachmentId?: string; data?: string; size?: number };
  parts?: MessagePart[];
}

interface Attachment {
  filename: string;
  mimeType?: string;
  size?: number;
  attachmentId?: string;
  /** Present when Gmail inlines the bytes directly in the part (small attachments). */
  data?: string;
}

/**
 * Depth-first walk collecting every part with a non-empty filename — Gmail's
 * own definition of "this part is an attachment". Mirrors findPart's
 * recursion in gmailDrafts.ts, just collecting instead of stopping at a hit.
 */
function collectAttachments(part: MessagePart | undefined, out: Attachment[]): void {
  if (!part) return;
  if (part.filename) {
    out.push({
      filename: part.filename,
      mimeType: part.mimeType,
      size: part.body?.size,
      attachmentId: part.body?.attachmentId,
      data: part.body?.data,
    });
  }
  for (const child of part.parts ?? []) collectAttachments(child, out);
}

function hasSupportedExt(filename: string): boolean {
  return LIBRARY_EXTENSIONS.has(extname(filename).toLowerCase());
}

interface MessageGetResponse {
  payload?: MessagePart;
}

interface AttachmentGetResponse {
  data?: string;
}

/**
 * One connected Gmail account's "save attachment to library" tool. Copy the
 * shape of buildDraftTool in mcp.ts — the caller wires this once per live
 * Gmail account, alongside the MCP-bridged tools.
 */
export function buildSaveAttachmentTool(account: ConnectedAccount, name: string): AgentTool {
  return {
    name,
    label: "Save attachment to library",
    description:
      `Download an attachment from an email in this account and save it into the user's local ` +
      `document library, where it is indexed — afterwards it can be found with library_search, ` +
      `read with library_read (library_list shows its id). Only these formats can be saved: ` +
      `${SUPPORTED_FORMATS}. Pass the messageId from find/list/get email tools; if the message ` +
      `has several attachments, call this once per attachment with its filename.\n\n` +
      `Acts as the connected account: ${account.name}.`,
    parameters: {
      type: "object",
      properties: {
        messageId: {
          type: "string",
          description: "The Gmail message id, from find/list/get email tools.",
        },
        filename: {
          type: "string",
          description:
            "Which attachment to save, by filename. Omit when the message has exactly one supported attachment.",
        },
      },
      required: ["messageId"],
    } as AgentTool["parameters"],
    execute: async (_toolCallId, params) => {
      const { messageId, filename } = params as { messageId: string; filename?: string };

      // Hard failure on a bad messageId or a proxy error — thrown as-is; pi
      // turns it into an error tool result.
      const message = (await proxyRequest(account.id, "get", `${GMAIL_API}/messages/${messageId}`, {
        params: { format: "full" },
      })) as MessageGetResponse;

      const attachments: Attachment[] = [];
      collectAttachments(message.payload, attachments);
      if (attachments.length === 0) return text("This message has no attachments.");

      let picked: Attachment;
      if (filename?.trim()) {
        const wanted = filename.trim().toLowerCase();
        const match = attachments.find((a) => a.filename.toLowerCase() === wanted);
        if (!match) {
          return text(
            `No attachment named "${filename}" on this message. Attachments: ` +
              `${attachments.map((a) => a.filename).join(", ")}.`,
          );
        }
        picked = match;
      } else if (attachments.length === 1) {
        picked = attachments[0]!;
      } else {
        const supported = attachments.filter((a) => hasSupportedExt(a.filename));
        if (supported.length !== 1) {
          return text(
            `This message has several attachments: ${attachments.map((a) => a.filename).join(", ")}. ` +
              `Call again with filename set to the one to save.`,
          );
        }
        picked = supported[0]!;
      }

      // Check the extension before downloading anything.
      if (!hasSupportedExt(picked.filename)) {
        return text(
          `"${picked.filename}" is not a format the library can save. Only these formats can be ` +
            `saved: ${SUPPORTED_FORMATS}.`,
        );
      }

      let data = picked.data;
      if (!data) {
        if (!picked.attachmentId) {
          throw new Error(`Attachment "${picked.filename}" has no downloadable data.`);
        }
        const fetched = (await proxyRequest(
          account.id,
          "get",
          `${GMAIL_API}/messages/${messageId}/attachments/${picked.attachmentId}`,
        )) as AttachmentGetResponse;
        data = fetched.data;
      }
      if (!data) throw new Error(`Could not download "${picked.filename}" — Gmail returned no data.`);

      const buffer = Buffer.from(data, "base64url");
      let stored: string;
      try {
        stored = await saveUpload(picked.filename, buffer);
      } catch (error) {
        throw new Error(`Could not save "${picked.filename}" to the library: ${errorMessage(error)}`);
      }

      return text(
        `Saved "${stored}" (${formatFileSize(buffer.length)}) to the document library; it is being ` +
          `indexed and will be searchable with library_search / readable with library_read momentarily.`,
      );
    },
  };
}
