import { gmailSyncProvider } from "../gmail/sync.js";
import { outlookSyncProvider } from "../outlook/sync.js";
import { registerSyncProvider } from "./syncProviders.js";

/**
 * The one place SyncProviders are registered — mirrors ../registerProviders.ts
 * and, like it, registers HERE explicitly rather than as an import side
 * effect in each provider file, so the winner can't depend on which module
 * happens to import a provider file first (see registerProviders.ts).
 *
 * Adding a new provider is one new file implementing SyncProvider plus one
 * import + register line here — nothing else changes.
 */
registerSyncProvider("gmail", gmailSyncProvider);
registerSyncProvider("microsoft_outlook", outlookSyncProvider);
