import { gmailReadProvider } from "../gmail/read.js";
import { outlookReadProvider } from "../outlook/read.js";
import { registerMailReadProvider } from "./readProviders.js";

/**
 * The one place MailReadProviders are registered. Importing this module for
 * its side effect is how a consumer opts in (learn sweeps, voice learn).
 */

registerMailReadProvider("gmail", gmailReadProvider);
registerMailReadProvider("microsoft_outlook", outlookReadProvider);
