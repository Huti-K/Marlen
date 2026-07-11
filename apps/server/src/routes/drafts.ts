import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import type {
  AccountDrafts,
  ConnectedAccount,
  EmailDraft,
  EmailThread,
  EmailThreadMessage,
} from "@trailin/shared";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import "../email/registerProviders.js";
import { listDraftsCached } from "../email/draftsService.js";
import { type DraftProvider, getDraftProvider } from "../email/providers.js";
import { getThreadDetail } from "../email/sync/mailQuery.js";
import { AppError, badRequest, notFound, upstreamError, upstreamStatusCode } from "../errors.js";
import { listAccounts, pipedreamConfigured } from "../pipedream/connect.js";
import { errorMessage } from "../util.js";

/** Resolve a connected account (any app with a draft provider) by its Pipedream account id. */
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
 * A draft provider (reached via the Pipedream proxy) throwing 404 means the
 * id doesn't exist there anymore — that's a client-facing 404, not an
 * outage. Anything else genuinely failed upstream and stays a 502. An
 * AppError already thrown deliberately below (e.g. notFound("account not
 * found"), badRequest for an unsupported capability) passes through as-is.
 */
function toProviderError(error: unknown, notFoundMessage: string): AppError {
  if (error instanceof AppError) return error;
  if (upstreamStatusCode(error) === 404) return notFound(notFoundMessage);
  return upstreamError(errorMessage(error), error);
}

/**
 * Attach the conversation that created each draft (draft_links), so the UI's
 * refine action can reopen that exact chat. Joined against conversations so a
 * deleted chat degrades to "no link" instead of navigating into a dead id.
 */
async function attachConversationLinks(byAccount: AccountDrafts[]): Promise<AccountDrafts[]> {
  const draftIds = byAccount.flatMap((a) => a.drafts.map((d) => d.id));
  if (draftIds.length === 0) return byAccount;

  const links = await db
    .select({
      draftId: schema.draftLinks.draftId,
      conversationId: schema.draftLinks.conversationId,
    })
    .from(schema.draftLinks)
    .innerJoin(schema.conversations, eq(schema.conversations.id, schema.draftLinks.conversationId))
    .where(inArray(schema.draftLinks.draftId, draftIds));
  if (links.length === 0) return byAccount;

  const byDraftId = new Map(links.map((l) => [l.draftId, l.conversationId]));
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
const threadParams = Type.Object({ accountId: Type.String(), threadId: Type.String() });
const threadQuery = Type.Object({ excludeMessageId: Type.Optional(Type.String()) });

export const draftRoutes: FastifyPluginAsyncTypebox = async (app) => {
  /** Live drafts per connected account that has a DraftProvider (Gmail, Outlook, ...). */
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
        // Listing accounts is the one genuinely-upstream (Pipedream) step
        // here; attachConversationLinks below is a local DB join and must
        // not be misreported the same way if it fails.
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
      return attachConversationLinks(byAccount);
    },
  );

  /** Full draft content for the in-app viewer. */
  app.get("/api/drafts/:accountId/:draftId", { schema: { params: draftParams } }, async (req) => {
    try {
      const found = await findDraftAccount(req.params.accountId);
      if (!found) throw notFound("account not found");
      return await found.provider.getDraftDetail(found.account, req.params.draftId);
    } catch (error) {
      throw toProviderError(error, "draft not found");
    }
  });

  /** Discard a draft (user-initiated from the UI; the agent has no such tool). */
  app.delete(
    "/api/drafts/:accountId/:draftId",
    { schema: { params: draftParams } },
    async (req) => {
      try {
        const found = await findDraftAccount(req.params.accountId);
        if (!found) throw notFound("account not found");
        await found.provider.deleteDraft(found.account, req.params.draftId);
        return { ok: true };
      } catch (error) {
        throw toProviderError(error, "draft not found");
      }
    },
  );

  /**
   * Save body/subject edits to an existing draft, exactly as typed — no
   * humanizer, no signature (those only run in the agent's create-draft
   * tool). `updateDraft` is an optional DraftProvider capability — a provider
   * without one (no driver written yet) reports 400 rather than assuming
   * every provider supports it.
   */
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
        await found.provider.updateDraft(found.account, req.params.draftId, { body, subject });
        return { ok: true };
      } catch (error) {
        throw toProviderError(error, "draft not found");
      }
    },
  );

  /**
   * The full email thread a draft belongs to, for the in-app viewer — served
   * from the local mailbox mirror, so it works for every synced account
   * without a provider round-trip. 404 covers both a bad id and a thread
   * older than the mirror's backfill window. `excludeMessageId` omits one
   * message by provider id (drafts themselves are never mirrored, so the
   * draft's own message can't appear, but the parameter is honored).
   */
  app.get(
    "/api/threads/:accountId/:threadId",
    { schema: { params: threadParams, querystring: threadQuery } },
    async (req): Promise<EmailThread> => {
      const exclude = req.query.excludeMessageId?.trim();
      const detail = getThreadDetail(req.params.threadId, req.params.accountId);
      if (!detail) throw notFound("thread not found");
      const messages = detail.messages
        .filter((m) => !exclude || m.providerMessageId !== exclude)
        .map(
          (m): EmailThreadMessage => ({
            from: m.from,
            to: m.to,
            ...(m.cc.length > 0 ? { cc: m.cc } : {}),
            date: m.date,
            body: m.bodyText,
          }),
        );
      return { messages };
    },
  );
};
