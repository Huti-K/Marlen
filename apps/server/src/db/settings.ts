import type {
  AccountColor,
  AccountPermissions,
  AccountVoice,
  FileAccessSettings,
} from "@trailin/shared";
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

/** All persisted per-account voice-learn records (style-memory bookkeeping). */
export const getAccountVoices = accountVoicesSetting.get;
export const setAccountVoices = accountVoicesSetting.set;

// Serializes patchAccountVoice calls: the voices live as one JSON array under
// one key, so two unserialized read-modify-write cycles interleaving across
// their awaits would each write the array as they read it — last writer wins,
// erasing the other account's update.
let accountVoicePatchChain: Promise<unknown> = Promise.resolve();

/**
 * Replace (or append) exactly one account's voice, leaving every other slot
 * as it is on disk at write time: the current array is re-read inside the
 * serialized critical section, `update` receives that account's current entry
 * (undefined when absent), and only its slot is swapped for the returned
 * voice. Voice-learn runs for different accounts can therefore overlap freely.
 * Returns the voice as written.
 */
export async function patchAccountVoice(
  accountId: string,
  update: (existing: AccountVoice | undefined) => AccountVoice,
): Promise<AccountVoice> {
  const run = accountVoicePatchChain.then(async () => {
    const voices = await accountVoicesSetting.get();
    const index = voices.findIndex((voice) => voice.accountId === accountId);
    const next = update(index >= 0 ? voices[index] : undefined);
    const updated =
      index >= 0 ? voices.map((voice, i) => (i === index ? next : voice)) : [...voices, next];
    await accountVoicesSetting.set(updated);
    return next;
  });
  // The chain only sequences; each caller still sees its own failure via `run`.
  accountVoicePatchChain = run.catch(() => {});
  return run;
}

const ONOFFICE_AUTOMATION_CREATES_KEY = "onoffice.automationCreates";

/**
 * Whether unattended automation runs may use onOffice's create tools
 * (address, appointment, task, relation). Off by default — mail content
 * reaching an unattended run could otherwise plant records in the live CRM —
 * so the user arms it explicitly on the onOffice row in Settings'
 * connected-accounts list. Modify, delete and send stay interactive-only
 * regardless of this flag.
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
 * on the onOffice row in Settings' connected-accounts list, mirroring the
 * per-account grants below. Unattended runs never get these tools
 * regardless of this flag.
 */
export async function getOnOfficeWriteAccess(): Promise<boolean> {
  return (await getSetting(ONOFFICE_WRITE_ACCESS_KEY)) === "true";
}

export async function setOnOfficeWriteAccess(enabled: boolean): Promise<void> {
  await setSetting(ONOFFICE_WRITE_ACCESS_KEY, enabled ? "true" : "false");
}

const WHATSAPP_SEND_ACCESS_KEY = "whatsapp.sendAccess";

/**
 * Whether interactive chat sessions may use whatsapp_send_message. Off by
 * default — a WhatsApp message dispatches immediately with no draft stage,
 * so sending stays read-only until the user arms it on the WhatsApp row in
 * Settings' connected-accounts list, mirroring the per-account email send
 * grants. Unattended runs never get the send tool regardless of this flag.
 */
export async function getWhatsAppSendAccess(): Promise<boolean> {
  return (await getSetting(WHATSAPP_SEND_ACCESS_KEY)) === "true";
}

export async function setWhatsAppSendAccess(enabled: boolean): Promise<void> {
  await setSetting(WHATSAPP_SEND_ACCESS_KEY, enabled ? "true" : "false");
}

const FILES_READ_KEY = "files.read";
const FILES_WRITE_KEY = "files.write";
const FILES_BASH_KEY = "files.bash";

/** The agent's filesystem grants (see FileAccessSettings in shared). All off by default. */
export async function getFileAccessSettings(): Promise<FileAccessSettings> {
  return {
    read: (await getSetting(FILES_READ_KEY)) === "true",
    write: (await getSetting(FILES_WRITE_KEY)) === "true",
    bash: (await getSetting(FILES_BASH_KEY)) === "true",
  };
}

export async function setFileAccessSettings(next: FileAccessSettings): Promise<void> {
  await setSetting(FILES_READ_KEY, next.read ? "true" : "false");
  await setSetting(FILES_WRITE_KEY, next.write ? "true" : "false");
  await setSetting(FILES_BASH_KEY, next.bash ? "true" : "false");
}

const ACCOUNT_PERMISSIONS_SETTING_KEY = "account.permissions";
const accountPermissionsSetting = jsonArraySetting<AccountPermissions>(
  ACCOUNT_PERMISSIONS_SETTING_KEY,
);

/**
 * Per-account permission grants (write / send / delete) for the agent's
 * provider tools. An account without a record is read-only; drafts are
 * always allowed regardless. Armed per account from its row in Settings'
 * connected-accounts list.
 */
export const getAccountPermissions = accountPermissionsSetting.get;
export const setAccountPermissions = accountPermissionsSetting.set;
