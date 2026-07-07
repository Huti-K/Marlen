import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ConnectedAccount, EmailDraft } from "@trailin/shared";
import { proxyRequest } from "./connect.js";

/**
 * Gmail drafts via the Connect proxy (plain Gmail REST API). Pipedream's
 * prebuilt create-draft component requires a paid workspace (File Stash);
 * the proxy works on every plan and returns clean JSON.
 */

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

/**
 * Deep link that opens a specific draft in the Gmail web UI.
 *
 * `authuser=<email>` is what makes this survive multiple signed-in Google
 * accounts: Gmail resolves it to the right account regardless of login order.
 * We deliberately avoid the `/mail/u/<N>/` path form — `N` is a per-browser
 * login-order index (not stable), and putting the email there (URL-encoded,
 * so `@` becomes `%40`) 404s when more than one account is signed in.
 * `authuser` must sit before the `#` fragment or Gmail's server never sees it.
 */
function gmailDraftUrl(accountName: string, messageId: string): string {
  const auth = accountName.includes("@")
    ? `?authuser=${encodeURIComponent(accountName)}`
    : "";
  return `https://mail.google.com/mail/${auth}#drafts?compose=${messageId}`;
}

interface DraftsListResponse {
  drafts?: { id: string; message: { id: string; threadId: string } }[];
}

interface DraftGetResponse {
  message?: {
    id: string;
    threadId: string;
    internalDate?: string;
    payload?: { headers?: { name: string; value: string }[] };
  };
}

export async function listGmailDrafts(
  account: ConnectedAccount,
  limit = 15,
): Promise<EmailDraft[]> {
  const list = (await proxyRequest(account.id, "get", `${GMAIL_API}/drafts`, {
    params: { maxResults: String(limit) },
  })) as DraftsListResponse;

  // Fetch each draft's metadata in parallel — these are independent Gmail
  // round-trips, so serializing them made the Home page wait on the sum of
  // all of them instead of the slowest one.
  const settled = await Promise.all(
    (list.drafts ?? []).map(async (entry): Promise<EmailDraft | null> => {
      try {
        const full = (await proxyRequest(account.id, "get", `${GMAIL_API}/drafts/${entry.id}`, {
          params: { format: "metadata" },
        })) as DraftGetResponse;
        const headers = full.message?.payload?.headers ?? [];
        const header = (name: string) =>
          headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
        return {
          id: entry.id,
          messageId: entry.message.id,
          threadId: entry.message.threadId,
          subject: header("Subject") ?? "",
          to: header("To") ?? "",
          date: full.message?.internalDate
            ? new Date(Number(full.message.internalDate)).toISOString()
            : "",
          webUrl: gmailDraftUrl(account.name, entry.message.id),
        };
      } catch {
        // Skip a single unreadable draft rather than failing the whole list.
        return null;
      }
    }),
  );
  // Newest first.
  return settled
    .filter((d): d is EmailDraft => d !== null)
    .sort((a, b) => b.date.localeCompare(a.date));
}

interface MessagePart {
  mimeType?: string;
  body?: { data?: string };
  parts?: MessagePart[];
}

/** Depth-first search for the first part of the wanted MIME type. */
function findPart(part: MessagePart | undefined, mimeType: string): MessagePart | undefined {
  if (!part) return undefined;
  if (part.mimeType === mimeType && part.body?.data) return part;
  for (const child of part.parts ?? []) {
    const hit = findPart(child, mimeType);
    if (hit) return hit;
  }
  return undefined;
}

function decodeBody(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

/** Full content of one draft, for the in-app viewer. */
export async function getGmailDraftDetail(
  account: ConnectedAccount,
  draftId: string,
): Promise<{ body: string; cc: string; bcc: string }> {
  const full = (await proxyRequest(account.id, "get", `${GMAIL_API}/drafts/${draftId}`, {
    params: { format: "full" },
  })) as {
    message?: { payload?: MessagePart & { headers?: { name: string; value: string }[] } };
  };
  const payload = full.message?.payload;
  const headers = payload?.headers ?? [];
  const header = (name: string) =>
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

  const plain = findPart(payload, "text/plain");
  let body = plain?.body?.data ? decodeBody(plain.body.data) : "";
  if (!body) {
    const html = findPart(payload, "text/html");
    if (html?.body?.data) {
      // Crude but serviceable: strip tags for display.
      body = decodeBody(html.body.data)
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n\n")
        .replace(/<[^>]+>/g, "")
        .trim();
    }
  }
  return { body, cc: header("Cc"), bcc: header("Bcc") };
}

export async function deleteGmailDraft(
  account: ConnectedAccount,
  draftId: string,
): Promise<void> {
  await proxyRequest(account.id, "delete", `${GMAIL_API}/drafts/${draftId}`);
}

/** RFC 2047 B-encoding — safe for any subject, including umlauts. */
function encodeHeaderWord(value: string): string {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

export interface CreateDraftInput {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  threadId?: string;
}

export async function createGmailDraft(
  account: ConnectedAccount,
  input: CreateDraftInput,
): Promise<{ draftId: string; messageId: string; threadId: string }> {
  const lines = [
    `To: ${input.to.join(", ")}`,
    ...(input.cc?.length ? [`Cc: ${input.cc.join(", ")}`] : []),
    ...(input.bcc?.length ? [`Bcc: ${input.bcc.join(", ")}`] : []),
    `Subject: ${encodeHeaderWord(input.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(input.body, "utf8").toString("base64"),
  ];
  const raw = Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");

  const res = (await proxyRequest(account.id, "post", `${GMAIL_API}/drafts`, {
    body: { message: { raw, ...(input.threadId ? { threadId: input.threadId } : {}) } },
  })) as { id: string; message: { id: string; threadId: string } };

  return { draftId: res.id, messageId: res.message.id, threadId: res.message.threadId };
}

/**
 * Trailin's own create-draft tool for one Gmail account. Replaces Pipedream's
 * component (paid-gated) with the same name, so prompts stay natural. Drafts
 * never send anything — allowed even in read-only mode.
 */
export function buildGmailDraftTool(account: ConnectedAccount, name: string): AgentTool {
  return {
    name,
    label: "Create Gmail draft",
    description:
      `Create an unsent draft email in Gmail. The draft is saved to the Drafts folder — ` +
      `nothing is sent; the user reviews and sends it themselves. Pass threadId to attach ` +
      `the draft to an existing conversation (use the thread's id from find/list tools).\n\n` +
      `Acts as the connected account: ${account.name}.`,
    parameters: {
      type: "object",
      properties: {
        to: { type: "array", items: { type: "string" }, description: "Recipient email addresses." },
        cc: { type: "array", items: { type: "string" }, description: "Cc addresses." },
        bcc: { type: "array", items: { type: "string" }, description: "Bcc addresses." },
        subject: { type: "string", description: "Subject line." },
        body: { type: "string", description: "Plain-text body of the draft." },
        threadId: {
          type: "string",
          description: "Optional Gmail thread id to attach this draft to (for replies).",
        },
      },
      required: ["to", "subject", "body"],
    } as AgentTool["parameters"],
    execute: async (_toolCallId, params) => {
      const input = params as unknown as CreateDraftInput;
      const result = await createGmailDraft(account, input);
      return {
        content: [
          {
            type: "text",
            text: `Draft created in ${account.name} (draft id ${result.draftId}, thread ${result.threadId}). It is unsent — the user can review it on the Drafts page or in Gmail.`,
          },
        ],
        details: undefined,
      };
    },
  };
}
