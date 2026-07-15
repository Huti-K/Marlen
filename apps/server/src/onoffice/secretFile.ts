import { promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";
import { writeFileAtomic } from "../atomicFile.js";
import { env } from "../env.js";
import { moduleLogger } from "../logger.js";

const log = moduleLogger("onoffice-secret-file");

/**
 * The onOffice API credentials (an API user's token + secret), held in their
 * own file next to `data/auth.json` rather than in the SQLite settings table —
 * GET /api/backup streams the whole DB unauthenticated, and the secret must
 * not be in it. The token is stored alongside it so a single file holds the
 * complete credential pair. Writes go through atomicFile.ts's writeFileAtomic
 * (same discipline as pipedream/secretFile.ts); ENOENT reads as absent, and a
 * corrupt file fails loudly rather than silently reading as "no credentials".
 */

export interface OnOfficeSecret {
  token: string;
  secret: string;
}

// Stored next to the SQLite database (data/onoffice-secret.json by default).
// Exported so tests can assert the credentials never land anywhere else.
export const secretPath = resolve(
  dirname(resolve(process.cwd(), env.databasePath)),
  "onoffice-secret.json",
);

async function load(): Promise<OnOfficeSecret | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(secretPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    log.error({ err: error, secretPath }, "failed to read onOffice credential file");
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    // A corrupt file must never be treated as "no credentials" — saving new
    // ones on top of it would silently discard whatever it held.
    log.error({ err: error, secretPath }, "onOffice credential file is corrupt");
    throw error;
  }
  const p = parsed as Partial<OnOfficeSecret>;
  if (typeof p?.token !== "string" || typeof p?.secret !== "string") {
    throw new Error(`onOffice credential file at ${secretPath} is malformed`);
  }
  return { token: p.token, secret: p.secret };
}

export async function readOnOfficeSecret(): Promise<OnOfficeSecret | undefined> {
  return load();
}

export async function writeOnOfficeSecret(value: OnOfficeSecret): Promise<void> {
  // A crash or power loss mid-write must never leave a truncated/corrupt file —
  // load() would then fail loudly on the very next read. writeFileAtomic
  // (atomicFile.ts) makes the write atomic.
  await writeFileAtomic(secretPath, JSON.stringify(value satisfies OnOfficeSecret, null, 2));
}

export async function deleteOnOfficeSecret(): Promise<void> {
  try {
    await fs.unlink(secretPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
