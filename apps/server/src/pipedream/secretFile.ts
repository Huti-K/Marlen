import { jsonSecretFile } from "../utils/jsonSecretFile.js";

/**
 * The custom Pipedream OAuth client secret, held in its own file next to
 * `data/auth.json` rather than in the SQLite settings table — GET /api/backup
 * streams the whole DB unauthenticated, and this secret must not be in it.
 * Storage discipline (atomic writes, ENOENT-as-absent, loud failure on a
 * corrupt file) is jsonSecretFile.ts's.
 */

interface SecretFile {
  clientSecret: string;
}

const store = jsonSecretFile<SecretFile>({
  filename: "pipedream-secret.json",
  label: "Pipedream client secret",
  narrow: (value): value is SecretFile =>
    typeof (value as Partial<SecretFile> | null)?.clientSecret === "string",
});

/**
 * Where the secret lives (data/pipedream-secret.json by default).
 * @internal
 */
export const secretPath = store.path;

export async function readClientSecret(): Promise<string | undefined> {
  return (await store.read())?.clientSecret;
}

export async function writeClientSecret(clientSecret: string): Promise<void> {
  await store.write({ clientSecret });
}

export async function deleteClientSecret(): Promise<void> {
  await store.delete();
}
