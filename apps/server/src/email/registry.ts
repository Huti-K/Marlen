/**
 * Generic name -> implementation registry, shared by every provider kind
 * (draft, attachment, read). Each kind's own file (./providers.ts,
 * ./attachmentProviders.ts, ./read/readProviders.ts) binds its own
 * `register`/`get` pair off one of these instead of hand-rolling the same
 * Map — the interface, doc comments, and registration call sites stay in
 * those files; this module only holds the storage.
 */

export interface ProviderRegistry<T> {
  /** Called once per provider module, at import time (see each kind's register*.ts). */
  register: (app: string, provider: T) => void;
  /** null when `app` has no driver of this kind yet — callers must handle that. */
  get: (app: string) => T | null;
}

export function createProviderRegistry<T>(): ProviderRegistry<T> {
  const registry = new Map<string, T>();
  return {
    register(app, provider) {
      registry.set(app, provider);
    },
    get(app) {
      return registry.get(app) ?? null;
    },
  };
}
