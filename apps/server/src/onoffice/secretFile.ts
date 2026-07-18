import { jsonSecretFile } from "../utils/jsonSecretFile.js";

/**
 * The onOffice API credentials (an API user's token + secret), held in their
 * own file next to `data/auth.json` rather than in the SQLite settings table —
 * GET /api/backup streams the whole DB unauthenticated, and the secret must
 * not be in it. The token is stored alongside it so a single file holds the
 * complete credential pair. Storage discipline (atomic writes,
 * ENOENT-as-absent, loud failure on a corrupt file) is jsonSecretFile.ts's.
 */

export interface OnOfficeSecret {
  token: string;
  secret: string;
}

const store = jsonSecretFile<OnOfficeSecret>({
  filename: "onoffice-secret.json",
  label: "onOffice credential",
  narrow: (value): value is OnOfficeSecret => {
    const p = value as Partial<OnOfficeSecret> | null;
    return typeof p?.token === "string" && typeof p?.secret === "string";
  },
});

/**
 * Where the credentials live (data/onoffice-secret.json by default).
 * @internal
 */
export const secretPath = store.path;

export async function readOnOfficeSecret(): Promise<OnOfficeSecret | undefined> {
  return store.read();
}

export async function writeOnOfficeSecret(value: OnOfficeSecret): Promise<void> {
  await store.write(value);
}

export async function deleteOnOfficeSecret(): Promise<void> {
  await store.delete();
}
