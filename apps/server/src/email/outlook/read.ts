import { PipedreamError } from "@pipedream/sdk";
import type { ConnectedAccount } from "@trailin/shared";
import { proxyRequest } from "../../pipedream/connect.js";
import type { MailReadProvider, SentMessage } from "../read/readProviders.js";
import { stripHtml } from "../textUtils.js";
import { formatRecipients, GRAPH_API, type GraphRecipient } from "./message.js";

/**
 * Outlook MailReadProvider: live sent-mail reads via Microsoft Graph through
 * the Connect proxy. Pages follow @odata.nextLink verbatim (the link carries
 * the whole query) up to the caller's limit.
 */

const DEFAULT_LIMIT = 50;

const SENT_SELECT = "subject,toRecipients,sentDateTime,body,conversationId";

interface GraphSentMessage {
  id: string;
  conversationId?: string;
  subject?: string;
  toRecipients?: GraphRecipient[];
  sentDateTime?: string;
  body?: { contentType?: string; content?: string };
}

interface GraphListResponse {
  value?: GraphSentMessage[];
  "@odata.nextLink"?: string;
}

function bodyTextOf(message: GraphSentMessage): string {
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

export const outlookReadProvider: MailReadProvider = { listSentSince, getMessageBody };
