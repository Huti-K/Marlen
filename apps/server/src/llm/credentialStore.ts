import type { Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import { KeyedJobs } from "../utils/jobs.js";
import { type JsonSecretFile, jsonSecretFile } from "../utils/jsonSecretFile.js";
import { isRecord } from "../utils/util.js";

/**
 * File-backed pi-ai CredentialStore (pi-ai only ships an in-memory one).
 * Holds one credential per provider id; pi-ai reads it on every model call
 * and writes refreshed OAuth tokens back through `modify`.
 *
 * Storage discipline is jsonSecretFile.ts's: atomic writes, absent file as
 * "no credentials", and loud failure on a corrupt file — which must never be
 * treated as empty, or modify()/delete() would save over it and permanently
 * wipe every other provider's saved credential. All access is serialized
 * through one queue so concurrent read-modify-write cycles can't interleave.
 */
class FileCredentialStore implements CredentialStore {
  private readonly jobs = new KeyedJobs();

  constructor(private readonly file: JsonSecretFile<Record<string, Credential>>) {}

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return this.jobs.enqueue(this.file.path, fn);
  }

  private async load(): Promise<Record<string, Credential>> {
    return (await this.file.read()) ?? {};
  }

  read(providerId: string): Promise<Credential | undefined> {
    return this.enqueue(async () => (await this.load())[providerId]);
  }

  list(): Promise<readonly CredentialInfo[]> {
    return this.enqueue(async () =>
      Object.entries(await this.load()).map(([providerId, credential]) => ({
        providerId,
        type: credential.type,
      })),
    );
  }

  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    return this.enqueue(async () => {
      const all = await this.load();
      const next = await fn(all[providerId]);
      if (next === undefined) {
        delete all[providerId];
      } else {
        all[providerId] = next;
      }
      await this.file.write(all);
      return next;
    });
  }

  delete(providerId: string): Promise<void> {
    return this.enqueue(async () => {
      const all = await this.load();
      delete all[providerId];
      await this.file.write(all);
    });
  }
}

// Stored next to the SQLite database (data/auth.json by default).
export const credentialStore = new FileCredentialStore(
  jsonSecretFile({
    filename: "auth.json",
    label: "LLM credential store",
    narrow: (value): value is Record<string, Credential> => isRecord(value),
  }),
);
