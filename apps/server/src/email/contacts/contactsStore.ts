import type { Contact, ContactCategory, ContactKind, MemoryEntry } from "@trailin/shared";
import { lazyStatement, sqlite } from "../../db/index.js";
import { likeContains } from "../../db/like.js";
import { upsertSql } from "../../db/sql.js";
import { groupBy } from "../../util.js";
import { decodeStringArray } from "../sync/rows.js";
import { isEmailLike, parseAddressEntry } from "./addressMatch.js";

/**
 * Aggregation (deterministic, re-derivable) and CRUD side of the contacts
 * core: one row per correspondent address, built from the mailbox mirror.
 * deriveContacts() only ever writes display_name/accounts/message_count/
 * sent_count/last_contact_at/updated_at — kind/category/category_source/
 * gist/input_hash/model/error/enriched_at are owned by contactsEnrichStore.ts
 * and never touched here. A contact whose messages later disappear (a
 * deleted sync page) keeps its row rather than being pruned, so an
 * enrichment or a user's category override is never silently lost.
 *
 * The manual overrides — category_source="user", display_name_override, and
 * the hidden_at soft delete — are written only by the explicit CRUD helpers
 * below (PATCH/POST/DELETE); derivation never sets or clears them, so a user's
 * edits and hides survive every re-derivation.
 *
 * getContactContexts and searchContacts also join the agent-domain memories
 * table (contact-scoped facts, memories.contact_id = contacts.address) —
 * they're the only reads that know about it, so a caller never has to query
 * contacts and memories separately to answer "what do we know about X".
 */

interface RawMessageRow {
  accountId: string;
  fromAddr: string;
  toAddrs: string;
  date: string;
  isFromMe: number;
}

const selectAllMessages = lazyStatement(`
  SELECT account_id AS accountId, from_addr AS fromAddr, to_addrs AS toAddrs, date, is_from_me AS isFromMe
  FROM mail_messages
`);

interface ContactAggregate {
  displayName: string;
  displayNameLen: number;
  accounts: Set<string>;
  messageCount: number;
  sentCount: number;
  lastContactAt: string;
}

/** Longer beats shorter — the fullest name seen for an address wins. */
function considerName(agg: ContactAggregate, name: string): void {
  if (name.length > agg.displayNameLen) {
    agg.displayName = name;
    agg.displayNameLen = name.length;
  }
}

/**
 * Full recompute of every contact from the mirror. Candidates are exactly
 * the two forms the task defines: the sender of an inbound message, and
 * every recipient of an outbound (from-me) message. The account's own
 * address(es) are told apart from a genuine contact by the from_addr column
 * alone (never to_addrs, which is where a candidate itself comes from — a
 * check built from the same column a candidate is drawn from could never
 * fire): an address that is from_addr on some from-me row AND NEVER
 * from_addr on an inbound row is presumed to be the owner's own identity,
 * excluded even if it also turns up as a to_addrs recipient (a self-cc, or a
 * second connected account the owner emailed). An address that DOES appear
 * as from_addr on an inbound row (someone genuinely mailed the owner from
 * it) is a real correspondent regardless of any from-me row sharing it.
 * Returns how many addresses' aggregates actually changed.
 */
export function deriveContacts(): number {
  const rows = selectAllMessages().all() as RawMessageRow[];

  const ownFromMe = new Set<string>();
  const inboundSenders = new Set<string>();
  for (const row of rows) {
    const { address } = parseAddressEntry(row.fromAddr);
    if (!isEmailLike(address)) continue;
    if (row.isFromMe === 1) ownFromMe.add(address);
    else inboundSenders.add(address);
  }
  const ownAddresses = new Set([...ownFromMe].filter((address) => !inboundSenders.has(address)));

  const agg = new Map<string, ContactAggregate>();
  const touch = (
    address: string,
    name: string,
    accountId: string,
    date: string,
    isSent: boolean,
  ): void => {
    if (!isEmailLike(address) || ownAddresses.has(address)) return;
    let entry = agg.get(address);
    if (!entry) {
      entry = {
        displayName: "",
        displayNameLen: 0,
        accounts: new Set(),
        messageCount: 0,
        sentCount: 0,
        lastContactAt: "",
      };
      agg.set(address, entry);
    }
    considerName(entry, name);
    entry.accounts.add(accountId);
    entry.messageCount++;
    if (isSent) entry.sentCount++;
    if (date > entry.lastContactAt) entry.lastContactAt = date;
  };

  for (const row of rows) {
    if (row.isFromMe === 1) {
      for (const raw of decodeStringArray(row.toAddrs)) {
        const { address, name } = parseAddressEntry(raw);
        touch(address, name, row.accountId, row.date, true);
      }
    } else {
      const { address, name } = parseAddressEntry(row.fromAddr);
      touch(address, name, row.accountId, row.date, false);
    }
  }

  return writeContactAggregates(agg);
}

interface ExistingAggregateRow {
  address: string;
  displayName: string;
  accounts: string;
  messageCount: number;
  sentCount: number;
  lastContactAt: string;
}

const selectExistingAggregates = lazyStatement(`
  SELECT address, display_name AS displayName, accounts, message_count AS messageCount,
         sent_count AS sentCount, last_contact_at AS lastContactAt
  FROM contacts
`);

const upsertAggregate = lazyStatement(
  upsertSql({
    table: "contacts",
    conflict: ["address"],
    insertOnly: ["created_at"],
    update: [
      "display_name",
      "accounts",
      "message_count",
      "sent_count",
      "last_contact_at",
      "updated_at",
    ],
  }),
);

/**
 * Writes only the addresses whose aggregate actually changed, so an
 * unaffected contact's `updated_at` never moves — that keeps the enrichment
 * staleness prefilter (contactsEnrichStore.ts: `updated_at > enriched_at`)
 * meaningful instead of tripping on every derivation cycle.
 */
function writeContactAggregates(agg: Map<string, ContactAggregate>): number {
  const existing = new Map(
    (selectExistingAggregates().all() as ExistingAggregateRow[]).map((row) => [row.address, row]),
  );
  const nowIso = new Date().toISOString();
  let touched = 0;
  const txn = sqlite.transaction(() => {
    for (const [address, entry] of agg) {
      const accountsJson = JSON.stringify([...entry.accounts].sort());
      const prior = existing.get(address);
      const unchanged =
        prior !== undefined &&
        prior.displayName === entry.displayName &&
        prior.accounts === accountsJson &&
        prior.messageCount === entry.messageCount &&
        prior.sentCount === entry.sentCount &&
        prior.lastContactAt === entry.lastContactAt;
      if (unchanged) continue;
      upsertAggregate().run({
        address,
        createdAt: nowIso,
        displayName: entry.displayName,
        accounts: accountsJson,
        messageCount: entry.messageCount,
        sentCount: entry.sentCount,
        lastContactAt: entry.lastContactAt,
        updatedAt: nowIso,
      });
      touched++;
    }
  });
  txn();
  return touched;
}

interface ContactRow {
  address: string;
  displayName: string;
  kind: ContactKind;
  category: ContactCategory;
  categorySource: "auto" | "user";
  gist: string;
  accounts: string;
  messageCount: number;
  sentCount: number;
  lastContactAt: string;
  model: string | null;
  error: string | null;
  enrichedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * The effective display name: a user's manual override wins over the derived
 * name, so reads surface the edited name everywhere (list, lookup, drafting
 * context) while deriveContacts keeps refreshing the underlying derived column.
 */
const DISPLAY_NAME_EXPR = "COALESCE(NULLIF(display_name_override, ''), display_name)";

const CONTACT_COLUMNS = `
  address, ${DISPLAY_NAME_EXPR} AS displayName, kind, category, category_source AS categorySource,
  gist, accounts, message_count AS messageCount, sent_count AS sentCount,
  last_contact_at AS lastContactAt, model, error, enriched_at AS enrichedAt,
  created_at AS createdAt, updated_at AS updatedAt
`;

function toContact(row: ContactRow): Contact {
  return { ...row, accounts: decodeStringArray(row.accounts) };
}

const selectByAddress = lazyStatement(`SELECT ${CONTACT_COLUMNS} FROM contacts WHERE address = ?`);

export function getContact(address: string): Contact | null {
  const row = selectByAddress().get(address) as ContactRow | undefined;
  return row ? toContact(row) : null;
}

const MEMORY_COLUMNS = `
  id, content, source, account_id AS accountId, contact_id AS contactId,
  created_at AS createdAt, updated_at AS updatedAt
`;

/**
 * Contact-scoped memories for a set of addresses, grouped by contact_id. No
 * ORDER BY — a plain scan of the (small, unindexed-on-contact_id) memories
 * table returns rows in insertion order, so a caller that caps the list
 * keeps the oldest notes first.
 */
function memoriesByContactId(addresses: string[]): Map<string, MemoryEntry[]> {
  if (addresses.length === 0) return new Map();
  const placeholders = addresses.map(() => "?").join(", ");
  const rows = sqlite
    .prepare(`SELECT ${MEMORY_COLUMNS} FROM memories WHERE contact_id IN (${placeholders})`)
    .all(...addresses) as MemoryEntry[];
  return groupBy(rows, (row) => row.contactId as string);
}

export interface ContactContext {
  address: string;
  /** The address's "person" contact row; null when there is none, or it's "bulk". */
  contact: Contact | null;
  /** Contact-scoped memories for this address (possibly empty). */
  memories: MemoryEntry[];
}

/**
 * Per-participant context for a thread: one entry per input address, in the
 * same order, pairing its "person" contact row (bulk/newsletter senders
 * never count as a known contact here) with its contact-scoped memories.
 */
export function getContactContexts(addresses: string[]): ContactContext[] {
  if (addresses.length === 0) return [];
  const placeholders = addresses.map(() => "?").join(", ");
  const contactRows = sqlite
    .prepare(
      `SELECT ${CONTACT_COLUMNS} FROM contacts WHERE address IN (${placeholders}) AND kind = 'person'`,
    )
    .all(...addresses) as ContactRow[];
  const contactByAddress = new Map(contactRows.map((row) => [row.address, toContact(row)]));
  const memories = memoriesByContactId(addresses);
  return addresses.map((address) => ({
    address,
    contact: contactByAddress.get(address) ?? null,
    memories: memories.get(address) ?? [],
  }));
}

export interface ListContactsFilter {
  kind?: ContactKind;
  category?: ContactCategory;
  q?: string;
}

/**
 * GET /api/contacts: every filter is optional and ANDed; newest contact first.
 * Soft-hidden contacts are always excluded — the row survives for its
 * enrichment and overrides, but the lists never surface it again.
 */
export function listContacts(filter: ListContactsFilter): Contact[] {
  const clauses: string[] = ["hidden_at IS NULL"];
  const params: Record<string, unknown> = {};
  if (filter.kind) {
    clauses.push("kind = @kind");
    params.kind = filter.kind;
  }
  if (filter.category) {
    clauses.push("category = @category");
    params.category = filter.category;
  }
  if (filter.q) {
    clauses.push(`(${DISPLAY_NAME_EXPR} LIKE @q ESCAPE '\\' OR address LIKE @q ESCAPE '\\')`);
    params.q = likeContains(filter.q);
  }
  const rows = sqlite
    .prepare(
      `SELECT ${CONTACT_COLUMNS} FROM contacts WHERE ${clauses.join(" AND ")} ORDER BY last_contact_at DESC`,
    )
    .all(params) as ContactRow[];
  return rows.map(toContact);
}

export interface ContactMatch {
  contact: Contact;
  memories: MemoryEntry[];
}

/**
 * lookup_contact's read: address or display-name substring match (either
 * side), newest contact first, capped at `limit` — then within that cap,
 * real correspondents ("person") sort ahead of bulk/newsletter senders, each
 * paired with its contact-scoped memories.
 */
export function searchContacts(query: string, limit: number): ContactMatch[] {
  const needle = likeContains(query.toLowerCase());
  const rows = sqlite
    .prepare(
      `SELECT ${CONTACT_COLUMNS} FROM contacts WHERE hidden_at IS NULL AND ` +
        `(address LIKE ? ESCAPE '\\' OR ${DISPLAY_NAME_EXPR} LIKE ? ESCAPE '\\') ` +
        `ORDER BY last_contact_at DESC LIMIT ?`,
    )
    .all(needle, needle, limit) as ContactRow[];
  const sorted = [...rows].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "person" ? -1 : 1));
  const contacts = sorted.map(toContact);
  const memories = memoriesByContactId(contacts.map((c) => c.address));
  return contacts.map((contact) => ({ contact, memories: memories.get(contact.address) ?? [] }));
}

const overrideCategoryStmt = lazyStatement(`
  UPDATE contacts SET category = @category, category_source = 'user', updated_at = @updatedAt
  WHERE address = @address
`);

/**
 * PATCH /api/contacts/:address's one write: pins category_source to "user"
 * so future enrichment judgments never overwrite it again. Returns null
 * (route 404s) when the address has no contact row.
 */
export function setContactCategory(address: string, category: ContactCategory): Contact | null {
  const result = overrideCategoryStmt().run({
    address,
    category,
    updatedAt: new Date().toISOString(),
  });
  if (result.changes === 0) return null;
  return getContact(address);
}

const setNameStmt = lazyStatement(`
  UPDATE contacts SET display_name_override = @displayName, updated_at = @updatedAt
  WHERE address = @address
`);

/**
 * PATCH /api/contacts/:address's name write: stores a manual override that
 * wins over the derived name (see DISPLAY_NAME_EXPR) and is never touched by
 * deriveContacts. A blank name clears the override, falling back to derived.
 * Returns null (route 404s) when the address has no contact row.
 */
export function setContactName(address: string, displayName: string): Contact | null {
  const trimmed = displayName.trim();
  const result = setNameStmt().run({
    address,
    displayName: trimmed === "" ? null : trimmed,
    updatedAt: new Date().toISOString(),
  });
  if (result.changes === 0) return null;
  return getContact(address);
}

const hideStmt = lazyStatement(`
  UPDATE contacts SET hidden_at = @hiddenAt, updated_at = @updatedAt WHERE address = @address
`);

/**
 * DELETE /api/contacts/:address's soft delete: stamps hidden_at so the lists
 * stop surfacing the contact while its row, enrichment, and any category/name
 * override survive — a re-derivation never resurrects it. Returns false (route
 * 404s) when the address has no contact row.
 */
export function hideContact(address: string): boolean {
  const now = new Date().toISOString();
  return hideStmt().run({ address, hiddenAt: now, updatedAt: now }).changes > 0;
}

const insertContactStmt = lazyStatement(`
  INSERT INTO contacts (address, display_name_override, created_at, updated_at)
  VALUES (@address, @displayName, @now, @now)
`);

/**
 * POST /api/contacts's manual create: a contact for an address the mirror
 * hasn't seen yet (aggregates stay at zero until mail arrives). The name is
 * stored as an override so a later derivation for the same address augments
 * the aggregates without clobbering the user's chosen name. The caller
 * guarantees the address is new.
 */
export function createContact(address: string, displayName: string): Contact {
  const trimmed = displayName.trim();
  const now = new Date().toISOString();
  insertContactStmt().run({ address, displayName: trimmed === "" ? null : trimmed, now });
  const contact = getContact(address);
  if (!contact) throw new Error(`createContact: row missing after insert for ${address}`);
  return contact;
}
