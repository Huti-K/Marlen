import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { isLanguage, SUPPORTED_LANGUAGES } from "@marlen/shared";
import { Type } from "@sinclair/typebox";
import { resetSessions } from "../agent/sessionCache.js";
import { badRequest } from "../core/errors.js";
import { emitServerEvent } from "../core/events.js";
import {
  getAccountColors,
  getAccountPermissions,
  getAccountSignatures,
  getFileAccessSettings,
  getLanguageSetting,
  getTimezoneSetting,
  isValidTimezone,
  LANGUAGE_SETTING_KEY,
  setAccountColors,
  setAccountPermissions,
  setAccountSignatures,
  setFileAccessSettings,
  setSetting,
  TIMEZONE_SETTING_KEY,
} from "../db/settings.js";
import { rescheduleNightlyLearn } from "../email/learn/service.js";
import { rescheduleAll } from "../services/automations/scheduler.js";
import { rescheduleNightlySuggest } from "../services/automations/suggest.js";

const languageBody = Type.Object({ language: Type.String() });

const timezoneBody = Type.Object({ timezone: Type.String() });

const accountPermissionsBody = Type.Object({
  permissions: Type.Array(
    Type.Object({
      accountId: Type.String(),
      write: Type.Boolean(),
      send: Type.Boolean(),
      delete: Type.Boolean(),
    }),
  ),
});

const fileAccessBody = Type.Object({
  read: Type.Boolean(),
  write: Type.Boolean(),
  bash: Type.Boolean(),
});

const accountColorsBody = Type.Object({
  colors: Type.Array(Type.Object({ accountId: Type.String(), hex: Type.String() })),
});

// Generous cap: a pasted signature can carry an inline data-URI image.
const accountSignaturesBody = Type.Object({
  signatures: Type.Array(
    Type.Object({ accountId: Type.String(), html: Type.String({ maxLength: 500_000 }) }),
  ),
});

/** Tags whose content is never signature markup; both the element and what it wraps go. */
const ACTIVE_ELEMENTS = "script|style|iframe|object|embed|form|template|noscript";

/**
 * Drops active content (scripts, handlers, script-bearing URLs) while keeping
 * the layout tables, fonts and colors a pasted mail-client signature depends on.
 *
 * Deliberately a denylist over tag soup rather than a parser: an allowlist would
 * have to reproduce what Gmail and Outlook emit, and stripping a real signature
 * to markup Marlen approves of is a worse outcome than the residual risk here.
 * Signatures are author-only (no agent tool writes one) and render inside the
 * app's own origin, so the threat is a user pasting markup that attacks
 * themselves. The browser-side editor (SignatureEditor.tsx) parses properly and
 * is the primary filter; this is the boundary that must not be bypassable by
 * calling the API directly.
 */
function sanitizeSignatureHtml(html: string): string {
  return (
    html
      // Paired active elements, content and all.
      .replace(new RegExp(`<(${ACTIVE_ELEMENTS})\\b[\\s\\S]*?<\\/\\1\\s*>`, "gi"), "")
      // The same tags left unclosed, plus the ones that never have a body and
      // can redirect or refresh the page.
      .replace(new RegExp(`<\\/?(?:${ACTIVE_ELEMENTS}|base|meta|link)\\b[^>]*>`, "gi"), "")
      // Event handlers. The boundary before `on…` is any attribute separator,
      // not just whitespace: `<svg/onload=…>` is valid HTML.
      .replace(/[\s/]+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      // Script-bearing URL values, quoted or bare. Entities, NUL and whitespace
      // between the scheme's letters are all ways browsers still resolve
      // `javascript:`, so the value is normalized before it is judged.
      .replace(
        /\b(href|src|action|formaction|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
        (whole, attribute: string, quoted?: string, single?: string, bare?: string) =>
          isScriptUrl(quoted ?? single ?? bare ?? "") ? `${attribute}="#"` : whole,
      )
  );
}

/** One numeric character reference, or nothing when it names no character. */
function decodeCodePoint(raw: string, base: number): string {
  const code = Number.parseInt(raw, base);
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  return String.fromCodePoint(code);
}

/** True for a URL a browser would execute rather than fetch, after undoing the usual obfuscations. */
function isScriptUrl(value: string): boolean {
  const normalized = value
    // `&#x6a;avascript:` and `&#106;avascript:` both resolve before navigation.
    .replace(/&#x([0-9a-f]+);?/gi, (_whole, hex: string) => decodeCodePoint(hex, 16))
    .replace(/&#(\d+);?/g, (_whole, dec: string) => decodeCodePoint(dec, 10))
    // Control characters and spaces are ignored inside a scheme, so they must
    // not hide one from this check either.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
    .replace(/[\x00-\x20\x7f]/g, "")
    .toLowerCase();
  return normalized.startsWith("javascript:") || normalized.startsWith("vbscript:");
}

export const settingsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get("/api/settings/language", async () => ({ language: await getLanguageSetting() }));

  app.put("/api/settings/language", { schema: { body: languageBody } }, async (req) => {
    const language = req.body.language;
    if (!isLanguage(language)) {
      throw badRequest(`language must be one of: ${SUPPORTED_LANGUAGES.join(", ")}`);
    }
    await setSetting(LANGUAGE_SETTING_KEY, language);
    // The language lives in the system prompt, so drop in-memory agents; new conversations pick it up.
    resetSessions();
    return { language };
  });

  app.get("/api/settings/timezone", async () => ({ timezone: await getTimezoneSetting() }));

  app.put("/api/settings/timezone", { schema: { body: timezoneBody } }, async (req) => {
    const timezone = req.body.timezone;
    if (!isValidTimezone(timezone)) {
      throw badRequest("timezone must be a valid IANA timezone");
    }
    await setSetting(TIMEZONE_SETTING_KEY, timezone);
    // node-cron bakes the timezone into each task at creation, so every schedule
    // (user automations plus the nightly learn and suggest jobs) is rebuilt;
    // otherwise they keep firing on the old zone until a restart.
    await rescheduleAll();
    await rescheduleNightlyLearn();
    await rescheduleNightlySuggest();
    // The current time is baked into the system prompt, so drop in-memory agents.
    resetSessions();
    return { timezone };
  });

  app.get("/api/settings/permissions", async () => ({
    permissions: await getAccountPermissions(),
  }));

  app.put(
    "/api/settings/permissions",
    { schema: { body: accountPermissionsBody } },
    async (req) => {
      // Last entry wins per account; all-false records are dropped so absence
      // means the read-only default.
      const byId = new Map(req.body.permissions.map((p) => [p.accountId, p]));
      const permissions = [...byId.values()].filter((p) => p.write || p.send || p.delete);
      await setAccountPermissions(permissions);
      // Per-account grants decide which tools get registered; rebuild agent toolsets.
      resetSessions();
      emitServerEvent("accounts");
      return { permissions };
    },
  );

  app.get("/api/settings/file-access", async () => ({
    fileAccess: await getFileAccessSettings(),
  }));

  app.put("/api/settings/file-access", { schema: { body: fileAccessBody } }, async (req) => {
    const fileAccess = req.body;
    await setFileAccessSettings(fileAccess);
    // The grants decide which file tools buildAgent mounts and the prompt text; rebuild sessions.
    resetSessions();
    return { fileAccess };
  });

  app.get("/api/settings/account-colors", async () => ({
    colors: await getAccountColors(),
  }));

  app.put("/api/settings/account-colors", { schema: { body: accountColorsBody } }, async (req) => {
    await setAccountColors(req.body.colors);
    emitServerEvent("accounts");
    return { colors: req.body.colors };
  });

  app.get("/api/settings/account-signatures", async () => ({
    signatures: await getAccountSignatures(),
  }));

  app.put(
    "/api/settings/account-signatures",
    { schema: { body: accountSignaturesBody } },
    async (req) => {
      // Last entry wins per account; an empty signature removes the record.
      const byId = new Map(
        req.body.signatures.map((s) => [
          s.accountId,
          { accountId: s.accountId, html: sanitizeSignatureHtml(s.html).trim() },
        ]),
      );
      const signatures = [...byId.values()].filter((s) => s.html);
      await setAccountSignatures(signatures);
      // The draft tools' descriptions mention the signature; rebuild agent toolsets.
      resetSessions();
      emitServerEvent("accounts");
      return { signatures };
    },
  );
};
