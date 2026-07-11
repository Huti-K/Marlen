import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { isLanguage, SUPPORTED_LANGUAGES } from "@trailin/shared";
import { resetSessions } from "../agent/emailAgent.js";
import { rescheduleAll } from "../automations/scheduler.js";
import {
  EMAIL_WRITE_SETTING_KEY,
  getAccountColors,
  getAccountDescriptions,
  getEmailWriteSetting,
  getLanguageSetting,
  getTimezoneSetting,
  isValidTimezone,
  LANGUAGE_SETTING_KEY,
  setAccountColors,
  setAccountDescriptions,
  setSetting,
  TIMEZONE_SETTING_KEY,
} from "../db/settings.js";

const languageBody = Type.Object({ language: Type.String() });

const timezoneBody = Type.Object({ timezone: Type.String() });

const emailWriteBody = Type.Object({ allowWrite: Type.Boolean() });

const accountColorsBody = Type.Object({
  colors: Type.Array(Type.Object({ accountId: Type.String(), hex: Type.String() })),
});

const accountDescriptionsBody = Type.Object({
  descriptions: Type.Array(Type.Object({ accountId: Type.String(), text: Type.String() })),
});

export const settingsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get("/api/settings/language", async () => ({ language: await getLanguageSetting() }));

  app.put("/api/settings/language", { schema: { body: languageBody } }, async (req, reply) => {
    const language = req.body.language;
    if (!isLanguage(language)) {
      return reply
        .code(400)
        .send({ error: `language must be one of: ${SUPPORTED_LANGUAGES.join(", ")}` });
    }
    await setSetting(LANGUAGE_SETTING_KEY, language);
    // The language lives in the system prompt, so drop in-memory agents —
    // new conversations (and scheduled runs) pick it up immediately.
    await resetSessions();
    return { language };
  });

  app.get("/api/settings/timezone", async () => ({ timezone: await getTimezoneSetting() }));

  app.put("/api/settings/timezone", { schema: { body: timezoneBody } }, async (req, reply) => {
    const timezone = req.body.timezone;
    if (!isValidTimezone(timezone)) {
      return reply.code(400).send({ error: "timezone must be a valid IANA timezone" });
    }
    await setSetting(TIMEZONE_SETTING_KEY, timezone);
    // node-cron bakes the timezone into each task when it is created, so the
    // existing tasks would keep firing on the old zone until a restart.
    await rescheduleAll();
    // The current time is baked into the system prompt, so drop in-memory
    // agents — the next prompt in every conversation picks up the change.
    await resetSessions();
    return { timezone };
  });

  app.get("/api/settings/email-write", async () => ({
    allowWrite: await getEmailWriteSetting(),
  }));

  app.put("/api/settings/email-write", { schema: { body: emailWriteBody } }, async (req) => {
    await setSetting(EMAIL_WRITE_SETTING_KEY, String(req.body.allowWrite));
    // The guard decides which tools get registered — rebuild agent toolsets.
    await resetSessions();
    return { allowWrite: req.body.allowWrite };
  });

  // ---- Account colors ----

  app.get("/api/settings/account-colors", async () => ({
    colors: await getAccountColors(),
  }));

  app.put("/api/settings/account-colors", { schema: { body: accountColorsBody } }, async (req) => {
    await setAccountColors(req.body.colors);
    return { colors: req.body.colors };
  });

  // ---- Account descriptions (the "what is this connection for" note) ----

  app.get("/api/settings/account-descriptions", async () => ({
    descriptions: await getAccountDescriptions(),
  }));

  app.put(
    "/api/settings/account-descriptions",
    { schema: { body: accountDescriptionsBody } },
    async (req) => {
      await setAccountDescriptions(req.body.descriptions);
      // Descriptions are baked into each tool's description string, so rebuild
      // in-memory agents to surface the new purpose to the model right away.
      await resetSessions();
      return { descriptions: req.body.descriptions };
    },
  );
};
