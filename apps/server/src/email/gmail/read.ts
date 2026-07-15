import type { ConnectedAccount } from "@trailin/shared";
import { mapWithConcurrency } from "../../jobs.js";
import { proxyRequest } from "../../pipedream/connect.js";
import type { MailReadProvider, SentMessage } from "../read/readProviders.js";
import { splitAddressList } from "../textUtils.js";
import {
  decodeHeaderText,
  GMAIL_API,
  headerLookup,
  type MessagePart,
  plainTextBody,
} from "./message.js";

/**
 * Gmail MailReadProvider: live sent-mail reads through the Connect proxy.
 * `after:` in a messages.list query takes epoch seconds; the per-id full
 * fetches that follow are capped so one call never fans out unboundedly.
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

export const gmailReadProvider: MailReadProvider = { listSentSince, getMessageBody };
