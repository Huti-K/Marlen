import { eq } from "drizzle-orm";
import { isLanguage, type Language } from "@trailin/shared";
import { db, schema } from "./index.js";
import { encrypt, decrypt } from "./crypto.js";

/** Simple key/value settings persisted in SQLite. */

export async function getSetting(key: string): Promise<string | undefined> {
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, key));
  return row?.value ? decrypt(row.value) : undefined;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const encryptedValue = encrypt(value);
  await db
    .insert(schema.settings)
    .values({ key, value: encryptedValue })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: encryptedValue } });
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

export const AGENT_INSTRUCTIONS_SETTING_KEY = "agent.customInstructions";

/** Standing instructions the agent follows in every conversation; "" until the user sets one. */
export async function getAgentInstructionsSetting(): Promise<string> {
  return (await getSetting(AGENT_INSTRUCTIONS_SETTING_KEY)) ?? "";
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
