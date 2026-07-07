import { eq } from "drizzle-orm";
import { isLanguage, type Language } from "@trailin/shared";
import { db, schema } from "./index.js";

/** Simple key/value settings persisted in SQLite. */

export async function getSetting(key: string): Promise<string | undefined> {
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, key));
  return row?.value;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(schema.settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value } });
}

export async function deleteSetting(key: string): Promise<void> {
  await db.delete(schema.settings).where(eq(schema.settings.key, key));
}

export const LANGUAGE_SETTING_KEY = "app.language";

/** The chosen language, or null until the web app first sets one from the browser locale. */
export async function getLanguageSetting(): Promise<Language | null> {
  const value = await getSetting(LANGUAGE_SETTING_KEY);
  return isLanguage(value) ? value : null;
}

export const EMAIL_WRITE_SETTING_KEY = "agent.allowEmailWrite";

/**
 * Whether the agent gets tools that send or change anything. Defaults to
 * false: read-only (plus drafts) until the user explicitly allows more.
 */
export async function getEmailWriteSetting(): Promise<boolean> {
  return (await getSetting(EMAIL_WRITE_SETTING_KEY)) === "true";
}

export const LIBRARY_FOLDER_SETTING_KEY = "library.folder";

/** The user-chosen library drop folder, or null to fall back to the LIBRARY_PATH env default. */
export async function getLibraryFolderSetting(): Promise<string | null> {
  return (await getSetting(LIBRARY_FOLDER_SETTING_KEY)) ?? null;
}

export const ACCOUNT_COLORS_SETTING_KEY = "account.colors";

/** All persisted account color assignments. */
export async function getAccountColors(): Promise<import("@trailin/shared").AccountColor[]> {
  const raw = await getSetting(ACCOUNT_COLORS_SETTING_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function setAccountColors(colors: import("@trailin/shared").AccountColor[]): Promise<void> {
  await setSetting(ACCOUNT_COLORS_SETTING_KEY, JSON.stringify(colors));
}
