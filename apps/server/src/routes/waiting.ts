import type { FastifyInstance } from "fastify";
import type { AccountWaiting } from "@trailin/shared";
import { listGmailWaiting } from "../pipedream/gmailWaiting.js";
import { listAccounts, pipedreamConfigured } from "../pipedream/connect.js";
import { errorMessage } from "../util.js";

export async function waitingRoutes(app: FastifyInstance): Promise<void> {
  /** Sent threads still awaiting a reply, per connected Gmail account, for the Home page. */
  app.get<{ Querystring: { refresh?: string } }>(
    "/api/waiting",
    async (req, reply): Promise<AccountWaiting[] | void> => {
      if (!(await pipedreamConfigured())) return [];
      const refresh = req.query.refresh === "1";
      try {
        const accounts = (await listAccounts()).filter((a) => a.app === "gmail");
        return await Promise.all(
          accounts.map(async (account): Promise<AccountWaiting> => {
            try {
              return {
                account: account.name,
                accountId: account.id,
                items: await listGmailWaiting(account, { refresh }),
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
