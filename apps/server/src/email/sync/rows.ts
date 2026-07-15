/**
 * Shared decode helpers for reads off mail_messages. Every query that hands
 * back one message in provider-neutral form re-derives it from the same
 * couple of steps — parse a JSON string-array column (to_addrs, cc_addrs,
 * mail_threads.participants) and turn snake_case SQLite columns into the
 * camelCase shape callers use — so those steps live here once instead of
 * being re-inlined per query. Queries whose column list actually matches
 * MailMessageRow use toMailMessage directly; queries with their own,
 * narrower projection (mailStore's thread recompute, enrichStore's
 * snapshot read) still call decodeStringArray for the JSON column(s) they do
 * carry.
 */

/** Raw shape of one mail_messages row, aliased to camelCase in the SELECT (see MAIL_MESSAGE_ROW_COLUMNS). */
export interface MailMessageRow {
  providerMessageId: string;
  subject: string;
  fromAddr: string;
  toAddrs: string;
  ccAddrs: string;
  date: string;
  bodyText: string;
  isFromMe: number;
  isUnread: number;
}

/** SELECT column list/aliases producing MailMessageRow — splice into a query's SQL. */
export const MAIL_MESSAGE_ROW_COLUMNS = `
  provider_message_id AS providerMessageId,
  subject,
  from_addr AS fromAddr,
  to_addrs AS toAddrs,
  cc_addrs AS ccAddrs,
  date,
  body_text AS bodyText,
  is_from_me AS isFromMe,
  is_unread AS isUnread
`;

/** Decode a JSON string-array column (to_addrs, cc_addrs, participants). */
export function decodeStringArray(json: string): string[] {
  return JSON.parse(json) as string[];
}

/** One mail_messages row in provider-neutral form. */
export interface MailMessage {
  providerMessageId: string;
  subject: string;
  from: string;
  to: string[];
  cc: string[];
  date: string;
  bodyText: string;
  isFromMe: boolean;
  isUnread: boolean;
}

/** Map a MAIL_MESSAGE_ROW_COLUMNS row to its provider-neutral form. */
export function toMailMessage(row: MailMessageRow): MailMessage {
  return {
    providerMessageId: row.providerMessageId,
    subject: row.subject,
    from: row.fromAddr,
    to: decodeStringArray(row.toAddrs),
    cc: decodeStringArray(row.ccAddrs),
    date: row.date,
    bodyText: row.bodyText,
    isFromMe: row.isFromMe === 1,
    isUnread: row.isUnread === 1,
  };
}
