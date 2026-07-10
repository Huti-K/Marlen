import type { ConnectedAccount, EmailDraft, EmailThreadMessage } from "@trailin/shared";
import { proxyRequest } from "../pipedream/connect.js";
import { emitServerEvent } from "../events.js";
import { invalidateDraftsCache } from "./draftsService.js";
import {
  registerDraftProvider,
  type CreateDraftInput,
  type CreateDraftResult,
  type DraftProvider,
  type UpdateDraftPatch,
} from "./providers.js";

/**
 * Outlook / Microsoft 365 draft provider, via the Connect proxy against
 * Microsoft Graph v1.0 — the same proxy mechanism gmailDrafts.ts uses for
 * Gmail, just pointed at a different API. Registered under app slug
 * "microsoft_outlook" at the bottom of this file.
 *
 * `listOutlookDrafts` is a pure live fetch — no caching in here (see
 * ./draftsService.ts, the shared cache every provider's listDrafts sits
 * behind). Every mutation below invalidates that shared cache before
 * emitting "drafts", mirroring gmailDrafts.ts's flow.
 */

const GRAPH_API = "https://graph.microsoft.com/v1.0/me";

/** Fields fetched for both list and detail — see the list of properties Graph exposes on a message. */
const LIST_SELECT = "id,subject,toRecipients,ccRecipients,bodyPreview,body,lastModifiedDateTime,webLink";

/** Fields fetched for getOutlookThread — enough to build an EmailThreadMessage per message. */
const THREAD_SELECT = "id,from,toRecipients,ccRecipients,receivedDateTime,body";

interface GraphRecipient {
  emailAddress?: { name?: string; address?: string };
}

interface GraphMessage {
  id: string;
  subject?: string;
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  bccRecipients?: GraphRecipient[];
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  lastModifiedDateTime?: string;
  receivedDateTime?: string;
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

/** Bare addresses only, as an array — what EmailThreadMessage's to/cc want. */
function addressArrayOf(recipients: GraphRecipient[] | undefined): string[] {
  return (recipients ?? []).map(addressOf).filter((a): a is string => !!a);
}

function addressListOf(recipients: GraphRecipient[] | undefined): string {
  return addressArrayOf(recipients).join(", ");
}

/**
 * "Name <address>" the way a mail header would render it, for
 * EmailThreadMessage.from — Graph gives us the name and address as separate
 * fields rather than a single header string like Gmail's.
 */
function formatFrom(recipient: GraphRecipient | undefined): string {
  const address = recipient?.emailAddress?.address?.trim();
  const name = recipient?.emailAddress?.name?.trim();
  if (!address) return name ?? "";
  return name && name !== address ? `${name} <${address}>` : address;
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

async function listOutlookDrafts(account: ConnectedAccount, limit = 15): Promise<EmailDraft[]> {
  const res = (await proxyRequest(account.id, "get", `${GRAPH_API}/mailFolders/drafts/messages`, {
    params: {
      $select: LIST_SELECT,
      $top: String(limit),
      $orderby: "lastModifiedDateTime desc",
    },
  })) as ListMessagesResponse;

  return (res.value ?? []).map(toEmailDraft);
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
  invalidateDraftsCache(account.id);
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

  invalidateDraftsCache(account.id);
  emitServerEvent("drafts");
  return {
    draftId: res.id,
    messageId: res.id,
    threadId: res.conversationId ?? "",
    webUrl: res.webLink ?? outlookFallbackUrl(),
  };
}

/**
 * Save body/subject edits to an existing draft — the Outlook counterpart of
 * gmailDrafts.ts's updateGmailDraft. Graph's PATCH only touches the fields
 * sent, so (unlike Gmail's drafts.update, which replaces the whole message)
 * there's no need to first fetch and re-send the fields the caller didn't
 * change.
 */
async function updateOutlookDraft(
  account: ConnectedAccount,
  draftId: string,
  patch: UpdateDraftPatch,
): Promise<void> {
  const body: Record<string, unknown> = {};
  if (patch.subject !== undefined) body.subject = patch.subject;
  // Always Text, matching gmailDrafts.ts's updateGmailDraft — an edit made in
  // Trailin's plain-text editor should save as plain text, not silently
  // become (or stay) HTML.
  if (patch.body !== undefined) body.body = { contentType: "Text", content: patch.body };

  await proxyRequest(account.id, "patch", `${GRAPH_API}/messages/${draftId}`, { body });

  invalidateDraftsCache(account.id);
  emitServerEvent("drafts");
}

/**
 * The full thread a draft (or any message) belongs to, oldest message first —
 * the Outlook counterpart of gmailDrafts.ts's getGmailThread. Graph has no
 * single "get thread" call; conversationId is its rough equivalent of a
 * Gmail threadId, so this lists every message sharing it instead.
 *
 * `$orderby` is deliberately not combined with `$filter` here — Graph often
 * rejects that pairing as an inefficient query — so the ascending sort
 * happens in code instead, same as gmailDrafts.ts does for Gmail (which
 * already returns thread messages in order, but sorts explicitly anyway so a
 * future API quirk can't silently reorder the viewer).
 */
async function getOutlookThread(
  account: ConnectedAccount,
  threadId: string,
  opts: { excludeMessageId?: string } = {},
): Promise<EmailThreadMessage[]> {
  // OData string literals escape a single quote by doubling it.
  const escapedThreadId = threadId.replace(/'/g, "''");
  const res = (await proxyRequest(account.id, "get", `${GRAPH_API}/messages`, {
    params: {
      $filter: `conversationId eq '${escapedThreadId}'`,
      $select: THREAD_SELECT,
    },
  })) as ListMessagesResponse;

  const messages = (res.value ?? [])
    .filter((m) => !opts.excludeMessageId || m.id !== opts.excludeMessageId)
    .map((m): EmailThreadMessage => {
      const cc = addressArrayOf(m.ccRecipients);
      const raw = m.body?.content ?? "";
      const body = m.body?.contentType?.toLowerCase() === "html" ? stripHtml(raw) : raw.trim();
      return {
        from: formatFrom(m.from),
        to: addressArrayOf(m.toRecipients),
        ...(cc.length ? { cc } : {}),
        date: m.receivedDateTime ?? "",
        body,
      };
    });
  return messages.sort((a, b) => a.date.localeCompare(b.date));
}

export const outlookDraftProvider: DraftProvider = {
  listDrafts: listOutlookDrafts,
  getDraftDetail: getOutlookDraftDetail,
  createDraft: createOutlookDraft,
  deleteDraft: deleteOutlookDraft,
  updateDraft: updateOutlookDraft,
  getThread: getOutlookThread,
};

registerDraftProvider("microsoft_outlook", outlookDraftProvider);
