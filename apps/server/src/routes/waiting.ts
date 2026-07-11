import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import type { AccountWaiting } from "@trailin/shared";
import { accountSupportsWaiting, listWaiting } from "../email/waiting.js";
import { upstreamError } from "../errors.js";
import { listAccounts, pipedreamConfigured } from "../pipedream/connect.js";
import { errorMessage } from "../util.js";

const waitingQuery = Type.Object({ refresh: Type.Optional(Type.String()) });

export const waitingRoutes: FastifyPluginAsyncTypebox = async (app) => {
  /** Sent threads still awaiting a reply, computed from the mailbox mirror, per synced account, for the Home page. */
  app.get(
    "/api/waiting",
    { schema: { querystring: waitingQuery } },
    async (req): Promise<AccountWaiting[]> => {
      if (!(await pipedreamConfigured())) return [];
      const refresh = req.query.refresh === "1";
      try {
        const accounts = (await listAccounts()).filter((a) => accountSupportsWaiting(a.app));
        return await Promise.all(
          accounts.map(async (account): Promise<AccountWaiting> => {
            try {
              return {
                account: account.name,
                accountId: account.id,
                items: await listWaiting(account, { refresh }),
              };
            } catch (error) {
              return {
                account: account.name,
                accountId: account.id,
                items: [],
                error: errorMessage(error),
              };
            }
          }),
        );
      } catch (error) {
        throw upstreamError(errorMessage(error), error);
      }
    },
  );
};
