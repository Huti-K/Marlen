import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { resetSessions } from "../agent/emailAgent.js";
import { badRequest } from "../errors.js";
import { clearOnOfficeConfig, getOnOfficeStatus, saveOnOfficeConfig } from "../onoffice/config.js";
import { errorMessage } from "../util.js";

// Either field may be omitted to keep the saved one (the secret is never
// returned to the browser, so an edit re-sends only what changed).
const onOfficeConfigBody = Type.Object({
  token: Type.Optional(Type.String()),
  secret: Type.Optional(Type.String()),
});

export const onOfficeRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get("/api/onoffice", async () => getOnOfficeStatus());

  app.put("/api/onoffice", { schema: { body: onOfficeConfigBody } }, async (req) => {
    try {
      await saveOnOfficeConfig({ token: req.body.token, secret: req.body.secret });
    } catch (error) {
      throw badRequest(errorMessage(error));
    }
    // Live agents hold an onOffice client built from the old credentials.
    await resetSessions();
    return getOnOfficeStatus();
  });

  app.delete("/api/onoffice", async () => {
    await clearOnOfficeConfig();
    await resetSessions();
    return getOnOfficeStatus();
  });
};
