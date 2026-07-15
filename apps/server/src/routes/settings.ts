import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { isLanguage, SUPPORTED_LANGUAGES } from "@trailin/shared";
import { resetSessions } from "../agent/emailAgent.js";
import { rescheduleAll } from "../automations/scheduler.js";
import {
  getAccountColors,
  getAccountVoices,
  getLanguageSetting,
  getTimezoneSetting,
  getWriteAccessAccounts,
  isValidTimezone,
  LANGUAGE_SETTING_KEY,
  setAccountColors,
  setAccountVoices,
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

const accountVoicesBody = Type.Object({
  voices: Type.Array(
    Type.Object({
      accountId: Type.String(),
      signature: Type.Optional(Type.String({ maxLength: 20_000 })),
      signatureHtml: Type.Optional(Type.String({ maxLength: 100_000 })),
    }),
  ),
});

function sanitizeSignatureHtml(html: string): string {
  return html
    .replace(/<(script|style|iframe|object|embed|form)[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/((?:href|src)\s*=\s*["'])\s*javascript:/gi, "$1");
}

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

  app.get("/api/settings/account-voices", async () => ({ voices: await getAccountVoices() }));

  app.put("/api/settings/account-voices", { schema: { body: accountVoicesBody } }, async (req) => {
    const stored = await getAccountVoices();
    const voices = req.body.voices.map((voice) => {
      const existing = stored.find((item) => item.accountId === voice.accountId);
      return {
        ...voice,
        ...(voice.signatureHtml !== undefined
          ? { signatureHtml: sanitizeSignatureHtml(voice.signatureHtml) }
          : {}),
        ...(existing?.learnedAt ? { learnedAt: existing.learnedAt } : {}),
        ...(existing?.styleMemoryIds ? { styleMemoryIds: existing.styleMemoryIds } : {}),
      };
    });
    await setAccountVoices(voices);
    return { voices };
  });
};
