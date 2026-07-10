import type { FastifyInstance } from "fastify";
import type { AccountWaiting } from "@trailin/shared";
import "../email/registerWaitingProviders.js";
import { getWaitingProvider } from "../email/waitingProviders.js";
import { listAccounts, pipedreamConfigured } from "../pipedream/connect.js";
import { errorMessage } from "../util.js";

export async function waitingRoutes(app: FastifyInstance): Promise<void> {
  /** Sent threads still awaiting a reply, per connected account with a WaitingProvider (Gmail today), for the Home page. */
  app.get<{ Querystring: { refresh?: string } }>(
    "/api/waiting",
    async (req, reply): Promise<AccountWaiting[] | void> => {
      if (!(await pipedreamConfigured())) return [];
      const refresh = req.query.refresh === "1";
      try {
        const accounts = (await listAccounts()).filter((a) => getWaitingProvider(a.app) !== null);
        return await Promise.all(
          accounts.map(async (account): Promise<AccountWaiting> => {
            // Filtered above, so this is never null — non-null asserted for TS.
            const provider = getWaitingProvider(account.app)!;
            try {
              return {
                account: account.name,
                accountId: account.id,
                items: await provider.listWaiting(account, { refresh }),
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
        req.log.error(error, "listing waiting threads failed");
        return reply.code(502).send({ error: errorMessage(error) });
      }
    },
  );
}
