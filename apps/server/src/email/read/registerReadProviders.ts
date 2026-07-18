import { gmailReadProvider } from "../gmail/read.js";
import { outlookReadProvider } from "../outlook/read.js";
import { registerMailReadProvider } from "./readProviders.js";

/**
 * The one place MailReadProviders are registered; app.ts imports this once
 * at build time, so every consumer of getMailReadProvider sees a populated
 * registry.
 */

registerMailReadProvider("gmail", gmailReadProvider);
registerMailReadProvider("microsoft_outlook", outlookReadProvider);
