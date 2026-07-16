import type { ConnectedAccount, EmailThreadMessage } from "@trailin/shared";
import { mapWithConcurrency } from "../../jobs.js";
import { proxyRequest } from "../../pipedream/connect.js";
import type { MailReadProvider, SentMessage, ThreadDetail } from "../read/readProviders.js";
import { splitAddressList } from "../textUtils.js";
import {
  decodeHeaderText,
  GMAIL_API,
  headerLookup,
  type MessagePart,
  plainTextBody,
  type ThreadGetMessage,
  type ThreadGetResponse,
} from "./message.js";

/**
 * Gmail MailReadProvider: live sent-mail and thread reads through the Connect
 * proxy. `after:` in a messages.list query takes epoch seconds; the per-id
 * full fetches that follow are capped so one call never fans out unboundedly.
 */

/** Concurrency cap for the per-message GET calls behind one listSentSince. */
const BATCH_CONCURRENCY = 5;

const DEFAULT_LIMIT = 50;

interface MessagesListResponse {
  messages?: { id: string }[];
}

interface GmailMessageFull {
  id: string;
  threadId: string;
  internalDate?: string;
  payload?: MessagePart & { headers?: { name: string; value: string }[] };
}

/** Duck-typed HTTP status off whatever proxyRequest's underlying SDK throws (see PipedreamError in @pipedream/sdk). */
function statusCodeOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const status = (error as { statusCode?: unknown }).statusCode;
  return typeof status === "number" ? status : undefined;
}

function toSentMessage(msg: GmailMessageFull): SentMessage {
  const header = headerLookup(msg.payload);
  return {
    providerMessageId: msg.id,
    providerThreadId: msg.threadId,
    subject: decodeHeaderText(header("Subject")),
    // Encoded-words decode AFTER the list is split: a decoded display name
    // may legitimately contain a comma, which must not create a bogus entry.
    to: splitAddressList(header("To")).map(decodeHeaderText),
    date: msg.internalDate
      ? new Date(Number(msg.internalDate)).toISOString()
      : new Date().toISOString(),
    bodyText: plainTextBody(msg.payload),
  };
}

async function listSentSince(
  account: ConnectedAccount,
  sinceIso: string,
  opts?: { limit?: number; signal?: AbortSignal },
): Promise<SentMessage[]> {
  const limit = opts?.limit ?? DEFAULT_LIMIT;
  const afterEpochSeconds = Math.floor(Date.parse(sinceIso) / 1000);
  const list = (await proxyRequest(account.id, "get", `${GMAIL_API}/messages`, {
    params: {
      q: `in:sent after:${afterEpochSeconds}`,
      maxResults: String(limit),
    },
    signal: opts?.signal,
  })) as MessagesListResponse;
  const ids = (list.messages ?? []).map((m) => m.id);

  const full = await mapWithConcurrency(ids, BATCH_CONCURRENCY, async (id) => {
    return (await proxyRequest(account.id, "get", `${GMAIL_API}/messages/${id}`, {
      params: { format: "full" },
      signal: opts?.signal,
    })) as GmailMessageFull;
  });

  return full.map(toSentMessage).sort((a, b) => a.date.localeCompare(b.date));
}

async function newestInbound(
  account: ConnectedAccount,
  opts?: { knownId?: string; signal?: AbortSignal },
): Promise<{ id: string; date: string | null } | null> {
  const list = (await proxyRequest(account.id, "get", `${GMAIL_API}/messages`, {
    params: { q: "in:inbox", maxResults: "1" },
    signal: opts?.signal,
  })) as MessagesListResponse;
  const id = list.messages?.[0]?.id;
  if (!id) return null;
  // Steady state, one call: the newest message is the one the caller already
  // knows, so its date needn't be fetched again (the contract lets date be
  // null exactly when id === knownId).
  if (id === opts?.knownId) return { id, date: null };
  const msg = (await proxyRequest(account.id, "get", `${GMAIL_API}/messages/${id}`, {
    params: { format: "minimal" },
    signal: opts?.signal,
  })) as GmailMessageFull;
  return {
    id,
    // internalDate is a millisecond epoch carried as a string.
    date: msg.internalDate
      ? new Date(Number(msg.internalDate)).toISOString()
      : new Date().toISOString(),
  };
}

async function getMessageBody(
  account: ConnectedAccount,
  providerMessageId: string,
  signal?: AbortSignal,
): Promise<string | null> {
  let msg: GmailMessageFull;
  try {
    msg = (await proxyRequest(account.id, "get", `${GMAIL_API}/messages/${providerMessageId}`, {
      params: { format: "full" },
      signal,
    })) as GmailMessageFull;
  } catch (error) {
    if (statusCodeOf(error) === 404) return null;
    throw error;
  }
  return plainTextBody(msg.payload);
}

function toThreadMessage(msg: ThreadGetMessage): EmailThreadMessage {
  const header = headerLookup(msg.payload);
  const cc = splitAddressList(header("Cc")).map(decodeHeaderText);
  return {
    ...(msg.id ? { id: msg.id } : {}),
    from: decodeHeaderText(header("From")),
    to: splitAddressList(header("To")).map(decodeHeaderText),
    ...(cc.length > 0 ? { cc } : {}),
    date: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : "",
    body: plainTextBody(msg.payload),
  };
}

async function getThread(
  account: ConnectedAccount,
  providerThreadId: string,
  signal?: AbortSignal,
): Promise<ThreadDetail | null> {
  let res: ThreadGetResponse;
  try {
    res = (await proxyRequest(
      account.id,
      "get",
      `${GMAIL_API}/threads/${encodeURIComponent(providerThreadId)}`,
      { params: { format: "full" }, signal },
    )) as ThreadGetResponse;
  } catch (error) {
    if (statusCodeOf(error) === 404) return null;
    throw error;
  }
  // Unsent drafts sit inside the thread they answer — the conversation view
  // must not echo them back as if they had been sent.
  const messages = (res.messages ?? [])
    .filter((m) => !m.labelIds?.includes("DRAFT"))
    .sort((a, b) => Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0));
  if (messages.length === 0) return null;

  return {
    subject: decodeHeaderText(headerLookup(messages[0]?.payload)("Subject")),
    messages: messages.map(toThreadMessage),
  };
}

export const gmailReadProvider: MailReadProvider = {
  newestInbound,
  listSentSince,
  getMessageBody,
  getThread,
};
