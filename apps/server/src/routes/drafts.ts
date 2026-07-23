import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type {
  AccountDrafts,
  ConnectedAccount,
  DraftProposalStatusResult,
  EmailDraft,
  EmailDraftDetail,
  KeepDraftProposalResult,
} from "@marlen/shared";
import { Type } from "@sinclair/typebox";
import { isTurnInFlight } from "../agent/turnRecorder.js";
import { badRequest, notFound, toProviderError, upstreamError } from "../core/errors.js";
import { errorMessage } from "../core/utils/util.js";
import { getDraftProposal, settleDraftProposal } from "../db/draftProposalStore.js";
import {
  appendDraftVersion,
  getDraftConversationLinks,
  getDraftStatus,
  markDraftStatus,
} from "../db/draftStore.js";
import { listDraftsCached } from "../email/draftsCache.js";
import { type DraftProvider, getDraftProvider } from "../email/providers.js";
import { accountSignatureHtml, outgoingBody } from "../email/signature.js";
import { detachSignature, stripHtml } from "../email/textUtils.js";
import { listAccounts, pipedreamConfigured } from "../integrations/pipedream/connect.js";
import { keepDraftProposal } from "../services/draftProposals.js";

async function findDraftAccount(
  accountId: string,
): Promise<{ account: ConnectedAccount; provider: DraftProvider } | null> {
  const accounts = await listAccounts();
  const account = accounts.find((a) => a.id === accountId);
  if (!account) return null;
  const provider = getDraftProvider(account.app);
  return provider ? { account, provider } : null;
}

/**
 * Attach each agent draft's conversation for the refine button. Every mailbox
 * draft belongs in the approval list: automation-born ones directly, chat-born
 * ones because they only exist once the user explicitly kept their proposal.
 */
async function attachConversationLinks(byAccount: AccountDrafts[]): Promise<AccountDrafts[]> {
  const draftIds = byAccount.flatMap((a) => a.drafts.map((d) => d.id));
  if (draftIds.length === 0) return byAccount;

  const byDraftId = await getDraftConversationLinks(draftIds);
  if (byDraftId.size === 0) return byAccount;

  return byAccount.map((account) => ({
    ...account,
    drafts: account.drafts.map((draft): EmailDraft => {
      const conversationId = byDraftId.get(draft.id);
      return conversationId ? { ...draft, conversationId } : draft;
    }),
  }));
}

const draftsQuery = Type.Object({ refresh: Type.Optional(Type.String()) });
const draftParams = Type.Object({ accountId: Type.String(), draftId: Type.String() });
const draftPatchBody = Type.Object({
  body: Type.Optional(Type.String()),
  subject: Type.Optional(Type.String()),
});
const proposalParams = Type.Object({ proposalId: Type.String() });
const keepProposalBody = Type.Object({ send: Type.Optional(Type.Boolean()) });
export const draftRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/api/drafts",
    { schema: { querystring: draftsQuery } },
    async (req): Promise<AccountDrafts[]> => {
      if (!(await pipedreamConfigured())) return [];
      const refresh = req.query.refresh === "1";
      let accounts: ConnectedAccount[];
      try {
        accounts = (await listAccounts()).filter((a) => getDraftProvider(a.app) !== null);
      } catch (error) {
        // Only listAccounts is genuinely upstream; a failure in the local DB
        // join below is not misreported as an upstream error.
        throw upstreamError(errorMessage(error), error);
      }
      const byAccount = await Promise.all(
        accounts.map(async (account): Promise<AccountDrafts> => {
          try {
            return {
              account: account.name,
              accountId: account.id,
              drafts: await listDraftsCached(account, { refresh }),
            };
          } catch (error) {
            return {
              account: account.name,
              accountId: account.id,
              drafts: [],
              error: errorMessage(error),
            };
          }
        }),
      );
      // A draft whose conversation still has a turn running may yet be
      // rewritten by it; withhold it until the turn ends (endTurn re-emits
      // "drafts"), so only final versions reach the approval list.
      const linked = await attachConversationLinks(byAccount);
      return linked.map((account) => ({
        ...account,
        drafts: account.drafts.filter(
          (draft) => !draft.conversationId || !isTurnInFlight(draft.conversationId),
        ),
      }));
    },
  );

  // The signature is detached from the body so the UI edits prose only and
  // renders the signature as the fixed block it is; a body that doesn't end
  // with the configured signature (hand-written, or pre-configuration) is
  // returned whole, with no signature field.
  app.get(
    "/api/drafts/:accountId/:draftId",
    { schema: { params: draftParams } },
    async (req): Promise<EmailDraftDetail> => {
      try {
        const found = await findDraftAccount(req.params.accountId);
        if (!found) throw notFound("account not found");
        const detail = await found.provider.getDraftDetail(found.account, req.params.draftId);
        const signatureHtml = await accountSignatureHtml(found.account.id);
        if (!signatureHtml) return detail;
        const detached = detachSignature(detail.body, stripHtml(signatureHtml));
        return detached
          ? { ...detail, body: detached.body, signature: detached.signature }
          : detail;
      } catch (error) {
        throw toProviderError(error, "draft not found");
      }
    },
  );

  app.delete(
    "/api/drafts/:accountId/:draftId",
    { schema: { params: draftParams } },
    async (req) => {
      try {
        const found = await findDraftAccount(req.params.accountId);
        if (!found) throw notFound("account not found");
        await found.provider.deleteDraft(found.account, req.params.draftId);
        // Best-effort: the provider delete already succeeded, so report success
        // even if the local snapshot mark fails.
        await markDraftStatus(req.params.accountId, req.params.draftId, "discarded").catch(
          (error: unknown) =>
            req.log.warn({ err: error }, "marking draft snapshot discarded failed"),
        );
        return { ok: true };
      } catch (error) {
        throw toProviderError(error, "draft not found");
      }
    },
  );

  /**
   * Human-initiated only (the in-app Send button): per-account write arming is
   * deliberately not consulted. The explicit click is the authorization, and
   * the agent has no tool over this route.
   */
  app.post(
    "/api/drafts/:accountId/:draftId/send",
    { schema: { params: draftParams } },
    async (req) => {
      try {
        const found = await findDraftAccount(req.params.accountId);
        if (!found) throw notFound("account not found");
        if (!found.provider.sendDraft) {
          throw badRequest("sending a draft is not supported for this account");
        }
        const result = await found.provider.sendDraft(found.account, req.params.draftId);
        // Best-effort, as with discard; recording the exact sent message id
        // spares the learning loop a match.
        await markDraftStatus(
          req.params.accountId,
          req.params.draftId,
          "sent",
          result.sentMessageId,
        ).catch((error: unknown) =>
          req.log.warn({ err: error }, "marking draft snapshot sent failed"),
        );
        return { ok: true };
      } catch (error) {
        throw toProviderError(error, "draft not found");
      }
    },
  );

  app.get(
    "/api/drafts/:accountId/:draftId/status",
    { schema: { params: draftParams } },
    async (req) => {
      const status = await getDraftStatus(req.params.accountId, req.params.draftId);
      if (!status) throw notFound("draft snapshot not found");
      return status;
    },
  );

  /**
   * Human-initiated only (the proposal card's Keep/Send buttons): like the
   * draft send route, the click is the authorization, so send consults no
   * grant. The agent's path is keep_draft, which does.
   */
  app.post(
    "/api/draft-proposals/:proposalId/keep",
    { schema: { params: proposalParams, body: keepProposalBody } },
    async (req): Promise<KeepDraftProposalResult> => {
      const outcome = await keepDraftProposal(req.params.proposalId, {
        send: req.body.send === true,
      });
      return {
        ok: true,
        accountId: outcome.accountId,
        draftId: outcome.draftId,
        ...(outcome.webUrl ? { webUrl: outcome.webUrl } : {}),
        sent: outcome.sent,
      };
    },
  );

  app.delete(
    "/api/draft-proposals/:proposalId",
    { schema: { params: proposalParams } },
    async (req) => {
      if (!(await settleDraftProposal(req.params.proposalId, "discarded"))) {
        throw notFound("draft proposal not found or already settled");
      }
      return { ok: true };
    },
  );

  app.get(
    "/api/draft-proposals/:proposalId/status",
    { schema: { params: proposalParams } },
    async (req): Promise<DraftProposalStatusResult> => {
      const proposal = await getDraftProposal(req.params.proposalId);
      if (!proposal) throw notFound("draft proposal not found");
      return {
        status: proposal.status,
        accountId: proposal.accountId,
        ...(proposal.providerDraftId ? { draftId: proposal.providerDraftId } : {}),
      };
    },
  );

  // Saved exactly as typed; the humanizer runs only in the agent's create-draft
  // tool. When the draft carried the account signature (the detail GET detached
  // it, so the edited text is prose only), the new body is re-wrapped above the
  // same signature — an in-app edit never strips, doubles, or de-styles it.
  app.patch(
    "/api/drafts/:accountId/:draftId",
    { schema: { params: draftParams, body: draftPatchBody } },
    async (req) => {
      try {
        const found = await findDraftAccount(req.params.accountId);
        if (!found) throw notFound("account not found");
        if (!found.provider.updateDraft) {
          throw badRequest("editing a draft is not supported for this account");
        }
        const { body, subject } = req.body;
        let bodyPatch: { body?: string } | ReturnType<typeof outgoingBody> = { body };
        if (body !== undefined) {
          const signatureHtml = await accountSignatureHtml(found.account.id);
          if (signatureHtml) {
            const current = await found.provider.getDraftDetail(found.account, req.params.draftId);
            if (detachSignature(current.body, stripHtml(signatureHtml))) {
              bodyPatch = outgoingBody(body, signatureHtml);
            }
          }
        }
        await found.provider.updateDraft(found.account, req.params.draftId, {
          ...bodyPatch,
          subject,
        });
        // Best-effort: the provider save succeeded, so report success even if
        // appending the user-authored snapshot version fails.
        await appendDraftVersion(req.params.accountId, req.params.draftId, "user", {
          body,
          subject,
        }).catch((error: unknown) =>
          req.log.warn({ err: error }, "appending user draft version failed"),
        );
        return { ok: true };
      } catch (error) {
        throw toProviderError(error, "draft not found");
      }
    },
  );
};
