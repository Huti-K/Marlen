import { gmailDraftProvider } from "./gmail/drafts.js";
import { outlookDraftProvider } from "./outlook/drafts.js";
import { registerDraftProvider } from "./providers.js";

/**
 * The one place DraftProviders are registered — anything that resolves
 * providers via getDraftProvider should import this first. Registration
 * happens HERE, explicitly, not as an import side effect in each provider
 * file: with side-effect registration the winner depends on module execution
 * order, which ESM caching ties to whichever module happens to import a
 * provider file first.
 *
 * Adding a new provider (e.g. zoho_mail) is one new file implementing
 * DraftProvider plus one import + register line here — nothing else changes.
 */
registerDraftProvider("gmail", gmailDraftProvider);
registerDraftProvider("microsoft_outlook", outlookDraftProvider);
