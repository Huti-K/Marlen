import { promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";
import { env } from "../env.js";
import { moduleLogger } from "../logger.js";

const log = moduleLogger("pipedream-secret-file");

/**
 * The custom Pipedream OAuth client secret, held in its own file next to
 * `data/auth.json` rather than in the SQLite settings table — GET /api/backup
 * streams the whole DB unauthenticated, and this secret must not be in it.
 * Same file-handling discipline as llm/credentialStore.ts: atomic write
 * (temp file + fsync + rename), mode 0o600, ENOENT reads as absent, and a
 * corrupt file fails loudly rather than silently reading as "no secret".
 */

interface SecretFile {
  clientSecret: string;
}

// Stored next to the SQLite database (data/pipedream-secret.json by default).
// Exported so tests can assert the secret never lands anywhere else.
export const secretPath = resolve(
  dirname(resolve(process.cwd(), env.databasePath)),
  "pipedream-secret.json",
);

async function load(): Promise<SecretFile | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(secretPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    log.error({ err: error, secretPath }, "failed to read Pipedream client secret file");
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    // A corrupt file must never be treated as "no secret" — saving new
    // settings on top of it would silently discard whatever it held.
    log.error({ err: error, secretPath }, "Pipedream client secret file is corrupt");
    throw error;
  }
  if (typeof (parsed as Partial<SecretFile>)?.clientSecret !== "string") {
    throw new Error(`Pipedream client secret file at ${secretPath} is malformed`);
  }
  return parsed as SecretFile;
}

export async function readClientSecret(): Promise<string | undefined> {
  return (await load())?.clientSecret;
}

export async function writeClientSecret(clientSecret: string): Promise<void> {
  await fs.mkdir(dirname(secretPath), { recursive: true });
  // Atomic write: a crash or power loss mid-write must never leave a
  // truncated/corrupt file — load() would then fail loudly on the very next
  // read. Write to a temp file in the same directory, fsync it, then rename
  // over the target (same-filesystem rename is atomic).
  const tempPath = `${secretPath}.tmp`;
  const handle = await fs.open(tempPath, "w", 0o600);
  try {
    await handle.writeFile(JSON.stringify({ clientSecret } satisfies SecretFile, null, 2));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tempPath, secretPath);
}

export async function deleteClientSecret(): Promise<void> {
  try {
    await fs.unlink(secretPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
