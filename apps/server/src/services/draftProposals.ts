import type { ConnectedAccount } from "@marlen/shared";
import { badRequest, notFound } from "../core/errors.js";
import { moduleLogger } from "../core/logger.js";
import { getDraftProposal, settleDraftProposal } from "../db/draftProposalStore.js";
import { createDraftSnapshot, linkDraftConversation, markDraftStatus } from "../db/draftStore.js";
import { type DraftProvider, getDraftProvider } from "../email/providers.js";
import { accountSignatureHtml, outgoingBody } from "../email/signature.js";
import { stripDuplicateSignoff, stripHtml } from "../email/textUtils.js";
import { listAccounts } from "../integrations/pipedream/connect.js";
import { resolveLibraryAttachments } from "../storage/library/draftAttachments.js";

const log = moduleLogger("draft-proposals");

/** Test seam, matcher-style: production callers pass nothing. */
export interface KeepProposalDeps {
  listAccounts?: () => Promise<ConnectedAccount[]>;
  providerFor?: (app: string) => DraftProvider | null;
}

export interface KeepProposalOutcome {
  accountId: string;
  accountName: string;
  draftId: string;
  webUrl?: string;
  sent: boolean;
}

/**
 * Turn a chat proposal into the real mailbox draft: signature applied at the
 * provider boundary, snapshot + conversation link recorded synchronously (the
 * kept draft appears on Home correctly attributed at once), then optionally
 * sent. Send authorization is the CALLER's duty: the route's click is its own
 * authorization, the agent tool checks the account's send grant first.
 */
export async function keepDraftProposal(
  proposalId: string,
  opts: { send?: boolean } = {},
  deps: KeepProposalDeps = {},
): Promise<KeepProposalOutcome> {
  const proposal = await getDraftProposal(proposalId);
  if (!proposal) throw notFound("draft proposal not found");
  if (proposal.status !== "proposed") {
    throw badRequest(`this draft was already ${proposal.status}`);
  }

  const accounts = await (deps.listAccounts ?? listAccounts)();
  const account = accounts.find((a) => a.id === proposal.accountId);
  if (!account) throw notFound("the proposal's account is no longer connected");
  const provider = (deps.providerFor ?? getDraftProvider)(account.app);
  if (!provider) throw badRequest("this account no longer supports drafts");
  if (opts.send && !provider.sendDraft) {
    throw badRequest("sending is not supported for this account");
  }

  // Re-resolved at keep time: a library document deleted since the proposal
  // fails loudly here instead of silently dropping an attachment.
  const attachments =
    proposal.attachmentDocIds.length > 0
      ? await resolveLibraryAttachments(proposal.attachmentDocIds)
      : [];

  // The proposal body is already sign-off-stripped, but the signature may have
  // been configured after it was proposed; stripping again is idempotent.
  const signatureHtml = await accountSignatureHtml(account.id);
  const body = signatureHtml
    ? stripDuplicateSignoff(proposal.body, stripHtml(signatureHtml))
    : proposal.body;

  const created = await provider.createDraft(account, {
    to: proposal.to,
    ...(proposal.cc.length > 0 ? { cc: proposal.cc } : {}),
    ...(proposal.bcc.length > 0 ? { bcc: proposal.bcc } : {}),
    subject: proposal.subject,
    ...(proposal.threadId ? { threadId: proposal.threadId } : {}),
    ...outgoingBody(body, signatureHtml),
    ...(attachments.length > 0 ? { attachments } : {}),
  });

  // Best-effort bookkeeping: the mailbox draft exists either way.
  try {
    await createDraftSnapshot({
      accountId: account.id,
      providerDraftId: created.draftId,
      providerMessageId: created.messageId,
      threadId: proposal.threadId ?? (created.threadId || undefined),
      subject: proposal.subject,
      to: proposal.to,
      cc: proposal.cc,
      bcc: proposal.bcc,
      body,
    });
    if (proposal.conversationId) {
      await linkDraftConversation(account.id, created.draftId, proposal.conversationId);
    }
  } catch (error) {
    log.warn({ err: error, proposalId, draftId: created.draftId }, "recording kept draft failed");
  }

  let sent = false;
  if (opts.send && provider.sendDraft) {
    const sendResult = await provider.sendDraft(account, created.draftId);
    await markDraftStatus(account.id, created.draftId, "sent", sendResult.sentMessageId).catch(
      (error: unknown) => log.warn({ err: error }, "marking kept draft sent failed"),
    );
    sent = true;
  }

  await settleDraftProposal(proposalId, sent ? "sent" : "kept", created.draftId);

  return {
    accountId: account.id,
    accountName: account.name,
    draftId: created.draftId,
    ...(created.webUrl ? { webUrl: created.webUrl } : {}),
    sent,
  };
}
