import {
  getOnOfficeAutomationCreates,
  getOnOfficeWriteAccess,
  getWhatsAppSendAccess,
} from "../db/settings.js";
import { getOnOfficeConfig } from "../integrations/onoffice/config.js";
import { getWhatsAppBusinessAccount } from "../integrations/whatsapp/dispatch.js";
import { isWhatsAppLinked } from "../integrations/whatsapp/session.js";

/**
 * The capability profile a session runs under. Both the toolset wiring
 * (buildAgent, loadEmailTools) and the system-prompt prose (buildSystemPrompt)
 * derive from this one record, so what the tools can do and what the prompt
 * says about them cannot drift apart.
 */
export interface SessionCapabilities {
  /**
   * False for unattended scheduled runs: no human reviews an action before it
   * happens, so write surfaces and standing-instruction tools are withheld.
   */
  interactive: boolean;
  providerWrites: boolean;
  onOffice: {
    configured: boolean;
    /** The CRM modify/delete/send surface is armed; never for unattended runs. */
    writes: boolean;
    creates: boolean;
  };
  whatsapp: {
    /** Some send transport exists: the personal link or a Business account. */
    linked: boolean;
    /** The personal link's chat mirror exists, so the read tools work. */
    mirror: boolean;
    /** Autosend is armed in Settings: a send=true message dispatches now. */
    sends: boolean;
  };
}

export async function sessionCapabilities(interactive: boolean): Promise<SessionCapabilities> {
  const configured = (await getOnOfficeConfig()) !== null;
  const whatsappMirror = isWhatsAppLinked();
  const whatsappLinked = whatsappMirror || (await getWhatsAppBusinessAccount()) !== null;
  return {
    interactive,
    providerWrites: interactive,
    onOffice: {
      configured,
      writes: configured && interactive && (await getOnOfficeWriteAccess()),
      creates: configured && (interactive || (await getOnOfficeAutomationCreates())),
    },
    whatsapp: {
      linked: whatsappLinked,
      mirror: whatsappMirror,
      sends: whatsappLinked && (await getWhatsAppSendAccess()),
    },
  };
}
