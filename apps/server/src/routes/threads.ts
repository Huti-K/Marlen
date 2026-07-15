import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import type {
  ConnectedAccount,
  EmailThread,
  EmailThreadMessage,
  MailThreadOverview,
} from "@trailin/shared";
import { MAIL_THREAD_FILTERS } from "@trailin/shared";
import type { FastifyBaseLogger } from "fastify";
import { getThreadDetail, listThreadOverviews } from "../email/sync/mailQuery.js";
import { threadWebUrl } from "../email/webLinks.js";
import { notFound } from "../errors.js";
import { listAccounts } from "../pipedream/connect.js";

/**
 * Thread reading, served entirely from the local mailbox mirror
 * (email/sync/mailQuery.ts) — no provider round-trips, so these routes answer
 * for every synced account even when Pipedream is unreachable. Connected
 * accounts are consulted only to build webmail deep links, and that lookup
 * failing degrades the links to "" rather than failing the request: the data
 * source here is local SQLite and must keep working offline.
 */

async function accountsById(log: FastifyBaseLogger): Promise<Map<string, ConnectedAccount>> {
  try {
    const accounts = await listAccounts();
    return new Map(accounts.map((account) => [account.id, account]));
  } catch (error) {
    log.warn({ err: error }, "account lookup for webmail links failed");
    return new Map();
  }
}

const DEFAULT_LIMIT = 30;

const threadListQuery = Type.Object({
  accountId: Type.Optional(Type.String()),
  filter: Type.Optional(Type.Union(MAIL_THREAD_FILTERS.map((filter) => Type.Literal(filter)))),
  sinceDays: Type.Optional(Type.Integer({ minimum: 1 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
});
const threadParams = Type.Object({ accountId: Type.String(), threadId: Type.String() });
const threadQuery = Type.Object({ excludeMessageId: Type.Optional(Type.String()) });

export const threadRoutes: FastifyPluginAsyncTypebox = async (app) => {
  /** Mirror thread overviews, newest first — the Email page's inbox list. */
  app.get(
    "/api/threads",
    { schema: { querystring: threadListQuery } },
    async (req): Promise<{ items: MailThreadOverview[] }> => {
      const overviews = listThreadOverviews({
        accountId: req.query.accountId,
        filter: req.query.filter,
        sinceDays: req.query.sinceDays,
        limit: req.query.limit ?? DEFAULT_LIMIT,
      });
      const accounts = overviews.length > 0 ? await accountsById(req.log) : new Map();
      const items = overviews.map((overview): MailThreadOverview => {
        const account = accounts.get(overview.accountId);
        return {
          accountId: overview.accountId,
          threadId: overview.providerThreadId,
          subject: overview.subject,
          participants: overview.participants,
          messageCount: overview.messageCount,
          lastMessageAt: overview.lastMessageAt,
          hasUnread: overview.hasUnread,
          lastFromMe: overview.lastFromMe,
          gist: overview.gist,
          triage: overview.triage,
          urgency: overview.urgency,
          deadline: overview.deadline,
          webUrl: account ? threadWebUrl(account, overview.providerThreadId) : "",
        };
      });
      return { items };
    },
  );

  /**
   * One full thread for the in-app viewer. 404 covers both a bad id and a
   * thread older than the mirror's backfill window. `excludeMessageId` omits
   * one message by provider id (drafts themselves are never mirrored, so a
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
            id: m.providerMessageId,
            from: m.from,
            to: m.to,
            ...(m.cc.length > 0 ? { cc: m.cc } : {}),
            date: m.date,
            body: m.bodyText,
            subject: m.subject,
            isUnread: m.isUnread,
            isFromMe: m.isFromMe,
          }),
        );
      const account = (await accountsById(req.log)).get(detail.accountId);
      return {
        messages,
        subject: detail.subject,
        webUrl: account ? threadWebUrl(account, detail.providerThreadId) : "",
      };
    },
  );
};
