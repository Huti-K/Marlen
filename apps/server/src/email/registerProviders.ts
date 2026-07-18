import { gmailDraftProvider } from "./gmail/drafts.js";
import { outlookDraftProvider } from "./outlook/drafts.js";
import { registerDraftProvider } from "./providers.js";

/**
 * The one place DraftProviders are registered; app.ts imports this once at
 * build time, so every consumer of getDraftProvider sees a populated
 * registry. Registration happens HERE, explicitly, not as an import side
 * effect in each provider file: with side-effect registration the winner
 * depends on module execution order, which ESM caching ties to whichever
 * module happens to import a provider file first.
 *
 * Adding a new provider (e.g. zoho_mail) is one new file implementing
 * DraftProvider plus one import + register line here — nothing else changes.
 */
registerDraftProvider("gmail", gmailDraftProvider);
registerDraftProvider("microsoft_outlook", outlookDraftProvider);
