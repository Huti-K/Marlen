import { PipedreamError } from "@pipedream/sdk";
import type { ConnectedAccount, EmailThreadMessage } from "@trailin/shared";
import { proxyRequest } from "../../pipedream/connect.js";
import type { MailReadProvider, SentMessage, ThreadDetail } from "../read/readProviders.js";
import { stripHtml } from "../textUtils.js";
import { formatRecipient, formatRecipients, GRAPH_API, type GraphRecipient } from "./message.js";

/**
 * Outlook MailReadProvider: live sent-mail and conversation reads via
 * Microsoft Graph through the Connect proxy. Pages follow @odata.nextLink
 * verbatim (the link carries the whole query) up to the caller's limit.
 */

const DEFAULT_LIMIT = 50;

const SENT_SELECT = "subject,toRecipients,sentDateTime,body,conversationId";

const THREAD_SELECT = "subject,from,toRecipients,ccRecipients,receivedDateTime,body,isDraft";

/** Messages a conversation view shows at most — a display cap, not a paging unit. */
const THREAD_LIMIT = 50;

interface GraphSentMessage {
  id: string;
  conversationId?: string;
  subject?: string;
  toRecipients?: GraphRecipient[];
  sentDateTime?: string;
  body?: { contentType?: string; content?: string };
}

interface GraphThreadMessage {
  id: string;
  subject?: string;
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  receivedDateTime?: string;
  body?: { contentType?: string; content?: string };
  isDraft?: boolean;
}

interface GraphListResponse {
  value?: GraphSentMessage[];
  "@odata.nextLink"?: string;
}

interface GraphThreadListResponse {
  value?: GraphThreadMessage[];
  "@odata.nextLink"?: string;
}

function bodyTextOf(message: { body?: { contentType?: string; content?: string } }): string {
  const rawBody = message.body?.content ?? "";
  return message.body?.contentType?.toLowerCase() === "html" ? stripHtml(rawBody) : rawBody.trim();
}

function toSentMessage(message: GraphSentMessage): SentMessage {
  return {
    providerMessageId: message.id,
    providerThreadId: message.conversationId ?? message.id,
    subject: message.subject ?? "",
    to: formatRecipients(message.toRecipients),
    date: message.sentDateTime ?? new Date().toISOString(),
    bodyText: bodyTextOf(message),
  };
}

async function listSentSince(
  account: ConnectedAccount,
  sinceIso: string,
  opts?: { limit?: number; signal?: AbortSignal },
): Promise<SentMessage[]> {
  const limit = opts?.limit ?? DEFAULT_LIMIT;
  const messages: SentMessage[] = [];

  let page = (await proxyRequest(
    account.id,
    "get",
    `${GRAPH_API}/mailFolders('sentitems')/messages`,
    {
      params: {
        $select: SENT_SELECT,
        $filter: `sentDateTime ge ${sinceIso}`,
        $orderby: "sentDateTime asc",
        $top: String(Math.min(limit, DEFAULT_LIMIT)),
      },
      signal: opts?.signal,
    },
  )) as GraphListResponse;

  for (;;) {
    for (const message of page.value ?? []) {
      messages.push(toSentMessage(message));
      if (messages.length >= limit) return messages;
    }
    const next = page["@odata.nextLink"];
    if (!next) return messages;
    page = (await proxyRequest(account.id, "get", next, {
      signal: opts?.signal,
    })) as GraphListResponse;
  }
}

async function newestInbound(
  account: ConnectedAccount,
  opts?: { knownId?: string; signal?: AbortSignal },
): Promise<{ id: string; date: string | null } | null> {
  // Always one Graph call: id and receivedDateTime come back together, so
  // there is no second fetch for opts.knownId to short-circuit.
  const page = (await proxyRequest(
    account.id,
    "get",
    `${GRAPH_API}/mailFolders('inbox')/messages`,
    {
      params: {
        $select: "id,receivedDateTime",
        $orderby: "receivedDateTime desc",
        $top: "1",
      },
      signal: opts?.signal,
    },
  )) as GraphThreadListResponse;
  const newest = page.value?.[0];
  if (!newest) return null;
  return { id: newest.id, date: newest.receivedDateTime ?? null };
}

async function getMessageBody(
  account: ConnectedAccount,
  providerMessageId: string,
  signal?: AbortSignal,
): Promise<string | null> {
  let message: GraphSentMessage;
  try {
    message = (await proxyRequest(account.id, "get", `${GRAPH_API}/messages/${providerMessageId}`, {
      params: { $select: "id,body" },
      signal,
    })) as GraphSentMessage;
  } catch (error) {
    if (error instanceof PipedreamError && error.statusCode === 404) return null;
    throw error;
  }
  return bodyTextOf(message);
}

function toThreadMessage(message: GraphThreadMessage): EmailThreadMessage {
  return {
    id: message.id,
    from: formatRecipient(message.from) ?? "",
    to: formatRecipients(message.toRecipients),
    ...(message.ccRecipients?.length ? { cc: formatRecipients(message.ccRecipients) } : {}),
    date: message.receivedDateTime ?? "",
    body: bodyTextOf(message),
  };
}

async function getThread(
  account: ConnectedAccount,
  providerThreadId: string,
  signal?: AbortSignal,
): Promise<ThreadDetail | null> {
  // OData string literals escape a quote by doubling it.
  const conversationId = providerThreadId.replace(/'/g, "''");
  const messages: GraphThreadMessage[] = [];

  let page = (await proxyRequest(account.id, "get", `${GRAPH_API}/messages`, {
    params: {
      $select: THREAD_SELECT,
      $filter: `conversationId eq '${conversationId}'`,
      $top: String(THREAD_LIMIT),
    },
    signal,
  })) as GraphThreadListResponse;
  for (;;) {
    messages.push(...(page.value ?? []));
    const next = page["@odata.nextLink"];
    if (!next || messages.length >= THREAD_LIMIT) break;
    page = (await proxyRequest(account.id, "get", next, { signal })) as GraphThreadListResponse;
  }

  // Unsent drafts sit inside the conversation they answer — the view shows
  // only what was actually exchanged. isDraft is culled here rather than in
  // the OData $filter, which rejects some property combinations as
  // inefficient; an unknown conversation simply matches nothing, so empty
  // means "gone" the same way a 404 does elsewhere.
  const exchanged = messages
    .filter((m) => !m.isDraft)
    .sort((a, b) => (a.receivedDateTime ?? "").localeCompare(b.receivedDateTime ?? ""));
  if (exchanged.length === 0) return null;

  return { subject: exchanged[0]?.subject ?? "", messages: exchanged.map(toThreadMessage) };
}

export const outlookReadProvider: MailReadProvider = {
  newestInbound,
  listSentSince,
  getMessageBody,
  getThread,
};
