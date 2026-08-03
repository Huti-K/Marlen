import de from "../../web/src/locales/de.json" with { type: "json" };
import en from "../../web/src/locales/en.json" with { type: "json" };

/**
 * The app's own translation files, read the way the app reads them, so a
 * selector never hardcodes a German string that a copy edit will silently
 * break. Tests write `t("connections.emailAccounts")`, not "Verbundene Konten".
 */

const BUNDLES = { de, en } as const;

export type TestLanguage = keyof typeof BUNDLES;

/** The language the fixtures pin the app to; German is the app's own default. */
export const TEST_LANGUAGE: TestLanguage = "de";

function lookup(bundle: unknown, key: string): string {
  let node: unknown = bundle;
  for (const segment of key.split(".")) {
    if (typeof node !== "object" || node === null) return "";
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === "string" ? node : "";
}

/**
 * One translated string, with i18next's `{{name}}` interpolation. Throws on a
 * missing key: a test asserting on copy that no longer exists is a bug in the
 * test, not a reason to match the empty string against everything.
 */
export function t(key: string, vars: Record<string, string | number> = {}): string {
  const raw = lookup(BUNDLES[TEST_LANGUAGE], key) || lookup(BUNDLES.en, key);
  if (!raw) throw new Error(`no translation for "${key}" in ${TEST_LANGUAGE} or en`);
  return raw.replace(/\{\{(\w+)\}\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}
