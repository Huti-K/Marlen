import { randomUUID } from "node:crypto";
import type { DraftProposalStatus } from "@marlen/shared";
import { and, eq } from "drizzle-orm";
import { emitServerEvent } from "../core/events.js";
import { db, schema } from "./index.js";

/**
 * Chat draft proposals: what the interactive create-draft tool writes instead
 * of a provider draft. One row per proposed email; keeping it (the card's Keep
 * button or the agent's keep_draft tool) creates the real mailbox draft and
 * settles the row's status. Status changes emit "drafts" so the open card's
 * status query refetches.
 */

export interface DraftProposal {
  id: string;
  accountId: string;
  threadId: string | null;
  conversationId: string | null;
  subject: string;
  to: string[];
  cc: string[];
  bcc: string[];
  body: string;
  attachmentDocIds: string[];
  status: DraftProposalStatus;
  providerDraftId: string | null;
}

export interface DraftProposalInput {
  accountId: string;
  threadId?: string;
  subject: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  body: string;
  attachmentDocIds?: string[];
}

function toProposal(row: typeof schema.draftProposals.$inferSelect): DraftProposal {
  return {
    id: row.id,
    accountId: row.accountId,
    threadId: row.threadId,
    conversationId: row.conversationId,
    subject: row.subject,
    to: JSON.parse(row.toAddrs) as string[],
    cc: JSON.parse(row.ccAddrs) as string[],
    bcc: JSON.parse(row.bccAddrs) as string[],
    body: row.body,
    attachmentDocIds: JSON.parse(row.attachmentDocIds) as string[],
    status: row.status,
    providerDraftId: row.providerDraftId,
  };
}

export async function createDraftProposal(input: DraftProposalInput): Promise<string> {
  const now = new Date().toISOString();
  const id = randomUUID();
  await db.insert(schema.draftProposals).values({
    id,
    accountId: input.accountId,
    threadId: input.threadId ?? null,
    subject: input.subject,
    toAddrs: JSON.stringify(input.to),
    ccAddrs: JSON.stringify(input.cc ?? []),
    bccAddrs: JSON.stringify(input.bcc ?? []),
    body: input.body,
    attachmentDocIds: JSON.stringify(input.attachmentDocIds ?? []),
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function getDraftProposal(id: string): Promise<DraftProposal | null> {
  const [row] = await db
    .select()
    .from(schema.draftProposals)
    .where(eq(schema.draftProposals.id, id))
    .limit(1);
  return row ? toProposal(row) : null;
}

/** The still-proposed proposal on a thread, for the create tool's duplicate guard. */
export async function findProposedOnThread(
  accountId: string,
  threadId: string,
): Promise<{ id: string; subject: string } | null> {
  const [row] = await db
    .select({ id: schema.draftProposals.id, subject: schema.draftProposals.subject })
    .from(schema.draftProposals)
    .where(
      and(
        eq(schema.draftProposals.accountId, accountId),
        eq(schema.draftProposals.threadId, threadId),
        eq(schema.draftProposals.status, "proposed"),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Rewrite a proposal's content in place (the agent refining before it is kept). */
export async function updateDraftProposalContent(
  id: string,
  patch: { body?: string; subject?: string },
): Promise<boolean> {
  const result = await db
    .update(schema.draftProposals)
    .set({
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.subject !== undefined ? { subject: patch.subject } : {}),
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(schema.draftProposals.id, id), eq(schema.draftProposals.status, "proposed")));
  return result.changes > 0;
}

export async function linkDraftProposalConversation(
  id: string,
  conversationId: string,
): Promise<boolean> {
  const result = await db
    .update(schema.draftProposals)
    .set({ conversationId, updatedAt: new Date().toISOString() })
    .where(eq(schema.draftProposals.id, id));
  return result.changes > 0;
}

/**
 * Settle a proposal: kept/sent record the created mailbox draft, discarded
 * ends it. Only a still-proposed row settles, so a double click (or the agent
 * re-keeping) can't act twice; false reports the miss.
 */
export async function settleDraftProposal(
  id: string,
  status: Exclude<DraftProposalStatus, "proposed">,
  providerDraftId?: string,
): Promise<boolean> {
  const result = await db
    .update(schema.draftProposals)
    .set({
      status,
      ...(providerDraftId ? { providerDraftId } : {}),
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(schema.draftProposals.id, id), eq(schema.draftProposals.status, "proposed")));
  if (result.changes > 0) emitServerEvent("drafts");
  return result.changes > 0;
}
