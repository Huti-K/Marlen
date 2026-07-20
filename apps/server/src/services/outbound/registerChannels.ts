import { getWhatsAppSendAccess } from "../../db/settings.js";
import { sendWhatsApp } from "../../integrations/whatsapp/dispatch.js";
import { registerOutboundChannel } from "./registry.js";

/**
 * The one place outbound channels are registered (explicit, like the email
 * providers), so the winner never depends on module load order.
 */

registerOutboundChannel("whatsapp", {
  label: "WhatsApp",
  isArmed: () => getWhatsAppSendAccess(),
  send: async (draft) => sendWhatsApp(draft.target, draft.body),
});
