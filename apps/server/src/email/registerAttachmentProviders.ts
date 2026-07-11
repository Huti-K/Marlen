import { registerAttachmentProvider } from "./attachmentProviders.js";
import { gmailAttachmentProvider } from "./gmail/attachments.js";
import { outlookAttachmentProvider } from "./outlook/attachments.js";

/**
 * The one place AttachmentProviders are registered — mirrors
 * ./registerProviders.ts (and its rationale for registering HERE explicitly
 * rather than as an import side effect in each provider file).
 */
registerAttachmentProvider("gmail", gmailAttachmentProvider);
registerAttachmentProvider("microsoft_outlook", outlookAttachmentProvider);
