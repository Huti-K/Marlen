import type { ConnectedAccount } from "@trailin/shared";
import { proxyRequest } from "../../pipedream/connect.js";

/**
 * Microsoft Graph message helpers shared by the Outlook drivers (drafts.ts,
 * read.ts): the GraphRecipient type, "Name <addr>" formatting, and
 * conversation paging — one provider's wire format in one place.
 */

export const GRAPH_API = "https://graph.microsoft.com/v1.0/me";

/** Page size for fetchConversationMessages — Graph's own default (10) is too small for an active thread. */
const CONVERSATION_PAGE_SIZE = 50;

interface GraphMessagePage<T> {
  value?: T[];
  "@odata.nextLink"?: string;
}

/**
 * Messages of one conversation, paging through `@odata.nextLink` up to `cap`
 * (enforced exactly — the last page is trimmed). `T` names the shape the
 * caller's `select` produces.
 *
 * `$orderby` is deliberately not combined with `$filter` here — Graph often
 * rejects that pairing as an inefficient query — so the caller orders the
 * result itself; Graph's per-page order isn't otherwise guaranteed. An
 * unknown conversation simply matches nothing and comes back empty.
 */
export async function fetchConversationMessages<T>(
  account: ConnectedAccount,
  threadId: string,
  select: string,
  cap: number,
  signal?: AbortSignal,
): Promise<T[]> {
  // OData string literals escape a single quote by doubling it.
  const escapedThreadId = threadId.replace(/'/g, "''");
  const messages: T[] = [];
  let url = `${GRAPH_API}/messages`;
  let params: Record<string, string> | undefined = {
    $filter: `conversationId eq '${escapedThreadId}'`,
    $select: select,
    $top: String(Math.min(cap, CONVERSATION_PAGE_SIZE)),
  };

  while (messages.length < cap) {
    const res = (await proxyRequest(account.id, "get", url, {
      params,
      signal,
    })) as GraphMessagePage<T>;
    messages.push(...(res.value ?? []));
    const nextLink = res["@odata.nextLink"];
    if (!nextLink) break;
    // nextLink is already a full URL carrying the escaped $filter/$select/$top
    // as its query string — passing params again would duplicate them.
    url = nextLink;
    params = undefined;
  }
  return messages.slice(0, cap);
}

export interface GraphRecipient {
  emailAddress?: { name?: string; address?: string };
}

/** Bare address of one recipient; undefined when Graph gave none. */
function recipientAddress(recipient: GraphRecipient | undefined): string | undefined {
  const address = recipient?.emailAddress?.address;
  return address?.trim() || undefined;
}

/** Bare addresses only, as an array. */
function recipientAddresses(recipients: GraphRecipient[] | undefined): string[] {
  return (recipients ?? []).map(recipientAddress).filter((a): a is string => !!a);
}

/** Bare addresses joined the way a mail header would list them. */
export function addressListOf(recipients: GraphRecipient[] | undefined): string {
  return recipientAddresses(recipients).join(", ");
}

/**
 * "Name <address>" the way a mail header would render it — Graph gives name
 * and address as separate fields rather than a single header string like
 * Gmail's. Bare address (or name) when the other half is missing; undefined
 * when there's nothing at all.
 */
export function formatRecipient(recipient: GraphRecipient | undefined): string | undefined {
  const address = recipient?.emailAddress?.address?.trim();
  const name = recipient?.emailAddress?.name?.trim();
  if (!address) return name || undefined;
  return name && name !== address ? `${name} <${address}>` : address;
}

/** "Name <address>" per entry, dropping recipients Graph left empty. */
export function formatRecipients(recipients: GraphRecipient[] | undefined): string[] {
  return (recipients ?? []).map(formatRecipient).filter((r): r is string => !!r);
}

/**
 * The item with the lexicographically latest `receivedDateTime` (ISO-8601
 * sorts correctly as plain strings, the same assumption read.ts's thread
 * date sorts make). Undefined for an empty list; an item missing the field
 * sorts as if it were the oldest.
 *
 * Used to find "the newest message in a conversation" — e.g. the target for
 * a Graph createReply call — without requiring the whole page to already be
 * date-sorted.
 */
export function newestByReceivedDate<T extends { receivedDateTime?: string }>(
  items: T[],
): T | undefined {
  return items.reduce<T | undefined>((newest, item) => {
    if (!newest) return item;
    return (item.receivedDateTime ?? "").localeCompare(newest.receivedDateTime ?? "") > 0
      ? item
      : newest;
  }, undefined);
}
