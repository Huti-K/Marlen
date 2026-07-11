import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { isLanguage, SUPPORTED_LANGUAGES } from "@trailin/shared";
import { resetSessions } from "../agent/emailAgent.js";
import { rescheduleAll } from "../automations/scheduler.js";
import {
  getAccountColors,
  getAccountDescriptions,
  getLanguageSetting,
  getTimezoneSetting,
  getWriteAccessAccounts,
  isValidTimezone,
  LANGUAGE_SETTING_KEY,
  setAccountColors,
  setAccountDescriptions,
  setSetting,
  setWriteAccessAccounts,
  TIMEZONE_SETTING_KEY,
} from "../db/settings.js";
import { badRequest } from "../errors.js";

const languageBody = Type.Object({ language: Type.String() });

const timezoneBody = Type.Object({ timezone: Type.String() });

const writeAccessBody = Type.Object({ accountIds: Type.Array(Type.String()) });

const accountColorsBody = Type.Object({
  colors: Type.Array(Type.Object({ accountId: Type.String(), hex: Type.String() })),
});

const accountDescriptionsBody = Type.Object({
  descriptions: Type.Array(Type.Object({ accountId: Type.String(), text: Type.String() })),
});

export const settingsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get("/api/settings/language", async () => ({ language: await getLanguageSetting() }));

  app.put("/api/settings/language", { schema: { body: languageBody } }, async (req) => {
    const language = req.body.language;
    if (!isLanguage(language)) {
      throw badRequest(`language must be one of: ${SUPPORTED_LANGUAGES.join(", ")}`);
    }
    await setSetting(LANGUAGE_SETTING_KEY, language);
    // The language lives in the system prompt, so drop in-memory agents —
    // new conversations (and scheduled runs) pick it up immediately.
    await resetSessions();
    return { language };
  });

  app.get("/api/settings/timezone", async () => ({ timezone: await getTimezoneSetting() }));

  app.put("/api/settings/timezone", { schema: { body: timezoneBody } }, async (req) => {
    const timezone = req.body.timezone;
    if (!isValidTimezone(timezone)) {
      throw badRequest("timezone must be a valid IANA timezone");
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

  app.get("/api/settings/write-access", async () => ({
    accountIds: await getWriteAccessAccounts(),
  }));

  app.put("/api/settings/write-access", { schema: { body: writeAccessBody } }, async (req) => {
    const accountIds = [...new Set(req.body.accountIds)];
    await setWriteAccessAccounts(accountIds);
    // The per-account gate decides which tools get registered — rebuild agent toolsets.
    await resetSessions();
    return { accountIds };
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
