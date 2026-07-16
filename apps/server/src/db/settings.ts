import type { AccountColor, AccountVoice } from "@trailin/shared";
import { isLanguage, type Language } from "@trailin/shared";
import { eq } from "drizzle-orm";
import { db, dbGeneration, schema } from "./index.js";

/**
 * Key/value settings persisted in SQLite, read through a whole-table
 * in-memory cache: settings are consulted on every prompt and every model
 * call, and the table is a handful of rows. All reads and writes in the
 * process go through this module (nothing else touches schema.settings), so
 * write-through keeps the cache exact; the generation check reloads it after
 * closeDb() (test teardown). A second *process* writing the same database
 * file is not reflected until restart — acceptable for a single-user app.
 */

let cache: { entries: Map<string, string>; generation: number } | null = null;

async function loadCache(): Promise<Map<string, string>> {
  const generation = dbGeneration();
  if (!cache || cache.generation !== generation) {
    const rows = await db.select().from(schema.settings);
    cache = { entries: new Map(rows.map((row) => [row.key, row.value])), generation };
  }
  return cache.entries;
}

export async function getSetting(key: string): Promise<string | undefined> {
  return (await loadCache()).get(key);
}

export async function setSetting(key: string, value: string): Promise<void> {
  const entries = await loadCache();
  await db
    .insert(schema.settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value } });
  entries.set(key, value);
}

export async function deleteSetting(key: string): Promise<void> {
  const entries = await loadCache();
  await db.delete(schema.settings).where(eq(schema.settings.key, key));
  entries.delete(key);
}

export const LANGUAGE_SETTING_KEY = "app.language";

/** The chosen language, or null until the web app first sets one from the browser locale. */
export async function getLanguageSetting(): Promise<Language | null> {
  const value = await getSetting(LANGUAGE_SETTING_KEY);
  return isLanguage(value) ? value : null;
}

export const TIMEZONE_SETTING_KEY = "app.timezone";

/** True for a string Intl recognizes as an IANA timezone identifier. */
export function isValidTimezone(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The chosen IANA timezone, or null until the web app first sets one from the browser. */
export async function getTimezoneSetting(): Promise<string | null> {
  const value = await getSetting(TIMEZONE_SETTING_KEY);
  return isValidTimezone(value) ? value : null;
}

export const LIBRARY_FOLDER_SETTING_KEY = "library.folder";

/** The user-chosen library drop folder, or null to fall back to the LIBRARY_PATH env default. */
export async function getLibraryFolderSetting(): Promise<string | null> {
  return (await getSetting(LIBRARY_FOLDER_SETTING_KEY)) ?? null;
}

/**
 * A settings value stored as a JSON array under one key: read parses it back
 * (missing or unparseable data reads as `[]` rather than throwing), write
 * serializes the whole array over the previous value.
 */
function jsonArraySetting<T>(key: string): {
  get: () => Promise<T[]>;
  set: (values: T[]) => Promise<void>;
} {
  return {
    async get(): Promise<T[]> {
      const raw = await getSetting(key);
      if (!raw) return [];
      try {
        return JSON.parse(raw) as T[];
      } catch {
        return [];
      }
    },
    async set(values: T[]): Promise<void> {
      await setSetting(key, JSON.stringify(values));
    },
  };
}

const ACCOUNT_COLORS_SETTING_KEY = "account.colors";
const accountColorsSetting = jsonArraySetting<AccountColor>(ACCOUNT_COLORS_SETTING_KEY);

/** All persisted account color assignments. */
export const getAccountColors = accountColorsSetting.get;
export const setAccountColors = accountColorsSetting.set;

const ACCOUNT_VOICES_SETTING_KEY = "account.voices";
const accountVoicesSetting = jsonArraySetting<AccountVoice>(ACCOUNT_VOICES_SETTING_KEY);

/** All persisted per-account voices (signature + style notes for drafting). */
export const getAccountVoices = accountVoicesSetting.get;
export const setAccountVoices = accountVoicesSetting.set;

const ONOFFICE_AUTOMATION_CREATES_KEY = "onoffice.automationCreates";

/**
 * Whether unattended automation runs may use onOffice's create tools
 * (address, appointment, task, relation). Off by default — mail content
 * reaching an unattended run could otherwise plant records in the live CRM —
 * so the user arms it explicitly under Settings → Permissions. Modify,
 * delete and send stay interactive-only regardless of this flag.
 */
export async function getOnOfficeAutomationCreates(): Promise<boolean> {
  return (await getSetting(ONOFFICE_AUTOMATION_CREATES_KEY)) === "true";
}

export async function setOnOfficeAutomationCreates(enabled: boolean): Promise<void> {
  await setSetting(ONOFFICE_AUTOMATION_CREATES_KEY, enabled ? "true" : "false");
}

const ONOFFICE_WRITE_ACCESS_KEY = "onoffice.writeAccess";

/**
 * Whether interactive chat sessions may use onOffice's modify/delete/send
 * tools (and raw batches). Off by default — the CRM is live business data,
 * so the destructive surface stays read-plus-create until the user arms it
 * under Settings → Permissions, mirroring the per-account email write access
 * below. Unattended runs never get these tools regardless of this flag.
 */
export async function getOnOfficeWriteAccess(): Promise<boolean> {
  return (await getSetting(ONOFFICE_WRITE_ACCESS_KEY)) === "true";
}

export async function setOnOfficeWriteAccess(enabled: boolean): Promise<void> {
  await setSetting(ONOFFICE_WRITE_ACCESS_KEY, enabled ? "true" : "false");
}

const WRITE_ACCESS_SETTING_KEY = "account.writeAccess";
const writeAccessSetting = jsonArraySetting<string>(WRITE_ACCESS_SETTING_KEY);

/**
 * Connected-account ids the agent may send or change as. Every other
 * connected account stays read-only (drafts are always allowed regardless).
 */
export const getWriteAccessAccounts = writeAccessSetting.get;
export const setWriteAccessAccounts = writeAccessSetting.set;
