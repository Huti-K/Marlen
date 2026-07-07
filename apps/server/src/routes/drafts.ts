import type { FastifyInstance } from "fastify";
import type { AccountDrafts } from "@trailin/shared";
import { listAccounts, pipedreamConfigured } from "../pipedream/connect.js";
import { deleteGmailDraft, getGmailDraftDetail, listGmailDrafts } from "../pipedream/gmailDrafts.js";
import { errorMessage } from "../util.js";

/** Resolve a connected Gmail account by its Pipedream account id. */
async function findGmailAccount(accountId: string) {
  const accounts = await listAccounts();
  return accounts.find((a) => a.id === accountId && a.app === "gmail");
}

export async function draftRoutes(app: FastifyInstance): Promise<void> {
  /** Live drafts per connected account (Gmail only for now). */
  app.get("/api/drafts", async (req, reply): Promise<AccountDrafts[] | void> => {
    if (!(await pipedreamConfigured())) return [];
    try {
      const accounts = (await listAccounts()).filter((a) => a.app === "gmail");
      return await Promise.all(
        accounts.map(async (account): Promise<AccountDrafts> => {
          try {
            return {
              account: account.name,
              accountId: account.id,
              drafts: await listGmailDrafts(account),
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
    } catch (error) {
      req.log.error(error, "listing drafts failed");
      return reply.code(502).send({ error: errorMessage(error) });
    }
  });

  /** Full draft content for the in-app viewer. */
  app.get<{ Params: { accountId: string; draftId: string } }>(
    "/api/drafts/:accountId/:draftId",
    async (req, reply) => {
      try {
        const account = await findGmailAccount(req.params.accountId);
        if (!account) return reply.code(404).send({ error: "account not found" });
        return await getGmailDraftDetail(account, req.params.draftId);
      } catch (error) {
        req.log.error(error, "reading draft failed");
        return reply.code(502).send({ error: errorMessage(error) });
      }
    },
  );

  /** Discard a draft (user-initiated from the UI; the agent has no such tool). */
  app.delete<{ Params: { accountId: string; draftId: string } }>(
    "/api/drafts/:accountId/:draftId",
    async (req, reply) => {
      try {
        const account = await findGmailAccount(req.params.accountId);
        if (!account) return reply.code(404).send({ error: "account not found" });
        await deleteGmailDraft(account, req.params.draftId);
        return { ok: true };
      } catch (error) {
        req.log.error(error, "deleting draft failed");
        return reply.code(502).send({ error: errorMessage(error) });
      }
    },
  );
}
