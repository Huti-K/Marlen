import type { ConnectedAccount, EmailDraft } from "@trailin/shared";
import { proxyRequest } from "../pipedream/connect.js";
import { emitServerEvent } from "../events.js";
import {
  DraftsCache,
  registerDraftProvider,
  type CreateDraftInput,
  type CreateDraftResult,
  type DraftProvider,
} from "./providers.js";

/**
 * Outlook / Microsoft 365 draft provider, via the Connect proxy against
 * Microsoft Graph v1.0 — the same proxy mechanism gmailDrafts.ts uses for
 * Gmail, just pointed at a different API. Registered under app slug
 * "microsoft_outlook" at the bottom of this file.
 */

const GRAPH_API = "https://graph.microsoft.com/v1.0/me";

/** Fields fetched for both list and detail — see the list of properties Graph exposes on a message. */
const LIST_SELECT = "id,subject,toRecipients,ccRecipients,bodyPreview,body,lastModifiedDateTime,webLink";

interface GraphRecipient {
  emailAddress?: { name?: string; address?: string };
}

interface GraphMessage {
  id: string;
  subject?: string;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  bccRecipients?: GraphRecipient[];
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  lastModifiedDateTime?: string;
  webLink?: string;
  /** Graph's rough equivalent of a Gmail threadId. */
  conversationId?: string;
}

interface ListMessagesResponse {
  value?: GraphMessage[];
}

function addressOf(recipient: GraphRecipient | undefined): string | undefined {
  const address = recipient?.emailAddress?.address;
  return address?.trim() || undefined;
}

function addressListOf(recipients: GraphRecipient[] | undefined): string {
  return (recipients ?? [])
    .map(addressOf)
    .filter((a): a is string => !!a)
    .join(", ");
}

function toRecipientsPayload(addresses: string[]): { emailAddress: { address: string } }[] {
  return addresses.map((address) => ({ emailAddress: { address } }));
}

const SNIPPET_MAX_LENGTH = 140;

/** One-line preview for list rows: collapse whitespace, cap length. */
function snippetFromPreview(preview: string): string {
  const collapsed = preview.replace(/\s+/g, " ").trim();
  if (collapsed.length <= SNIPPET_MAX_LENGTH) return collapsed;
  return `${collapsed.slice(0, SNIPPET_MAX_LENGTH)}…`;
}

/** Crude but serviceable: strip tags for display when the stored body is HTML. */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .trim();
}

/**
 * Graph is documented to return `webLink` on every message resource by
 * default, including the one echoed back from a create/update call — but if
 * a future API change ever omits it, land on the Drafts folder itself rather
 * than a broken deep link to the specific message.
 */
function outlookFallbackUrl(): string {
  return "https://outlook.office.com/mail/drafts";
}

const draftsCache = new DraftsCache();

function toEmailDraft(message: GraphMessage): EmailDraft {
  const snippet = message.bodyPreview ? snippetFromPreview(message.bodyPreview) : "";
  return {
    id: message.id,
    // Outlook doesn't distinguish a "draft id" from the message id the way
    // Gmail does — a draft is just a message sitting in the Drafts folder.
    messageId: message.id,
    threadId: message.conversationId ?? "",
    subject: message.subject ?? "",
    to: addressListOf(message.toRecipients),
    date: message.lastModifiedDateTime ?? "",
    webUrl: message.webLink ?? outlookFallbackUrl(),
    ...(snippet ? { snippet } : {}),
  };
}

async function listOutlookDrafts(
  account: ConnectedAccount,
  limit = 15,
  opts: { refresh?: boolean } = {},
): Promise<EmailDraft[]> {
  if (!opts.refresh) {
    const cached = draftsCache.get(account.id);
    if (cached) return cached;
  }

  const res = (await proxyRequest(account.id, "get", `${GRAPH_API}/mailFolders/drafts/messages`, {
    params: {
      $select: LIST_SELECT,
      $top: String(limit),
      $orderby: "lastModifiedDateTime desc",
    },
  })) as ListMessagesResponse;

  const drafts = (res.value ?? []).map(toEmailDraft);
  draftsCache.set(account.id, drafts);
  return drafts;
}

async function getOutlookDraftDetail(
  account: ConnectedAccount,
  draftId: string,
): Promise<{ body: string; cc: string; bcc: string }> {
  const message = (await proxyRequest(account.id, "get", `${GRAPH_API}/messages/${draftId}`, {
    params: { $select: "body,ccRecipients,bccRecipients" },
  })) as GraphMessage;

  const raw = message.body?.content ?? "";
  const body = message.body?.contentType?.toLowerCase() === "html" ? stripHtml(raw) : raw.trim();
  return {
    body,
    cc: addressListOf(message.ccRecipients),
    bcc: addressListOf(message.bccRecipients),
  };
}

async function deleteOutlookDraft(account: ConnectedAccount, draftId: string): Promise<void> {
  await proxyRequest(account.id, "delete", `${GRAPH_API}/messages/${draftId}`);
  draftsCache.invalidate(account.id);
  emitServerEvent("drafts");
}

async function createOutlookDraft(
  account: ConnectedAccount,
  input: CreateDraftInput,
): Promise<CreateDraftResult> {
  // Graph has no equivalent of "create this draft attached to threadId" for a
  // brand-new message (replying-in-thread is a separate createReply flow) —
  // threadId is accepted for interface parity with Gmail but has no effect here.
  const res = (await proxyRequest(account.id, "post", `${GRAPH_API}/messages`, {
    body: {
      subject: input.subject,
      body: { contentType: "Text", content: input.body },
      toRecipients: toRecipientsPayload(input.to),
      ...(input.cc?.length ? { ccRecipients: toRecipientsPayload(input.cc) } : {}),
      ...(input.bcc?.length ? { bccRecipients: toRecipientsPayload(input.bcc) } : {}),
    },
  })) as GraphMessage;

  draftsCache.invalidate(account.id);
  emitServerEvent("drafts");
  return {
    draftId: res.id,
    messageId: res.id,
    threadId: res.conversationId ?? "",
    webUrl: res.webLink ?? outlookFallbackUrl(),
  };
}

export const outlookDraftProvider: DraftProvider = {
  listDrafts: listOutlookDrafts,
  getDraftDetail: getOutlookDraftDetail,
  createDraft: createOutlookDraft,
  deleteDraft: deleteOutlookDraft,
  invalidateCache: (accountId) => draftsCache.invalidate(accountId),
};

registerDraftProvider("microsoft_outlook", outlookDraftProvider);
