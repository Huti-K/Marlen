/**
 * WhatsApp integration types. The personal account links natively over the
 * WhatsApp Web multi-device protocol (QR pairing); chats are mirrored into
 * the local database because the protocol pushes state instead of answering
 * queries — nothing here ever leaves the machine.
 */

/**
 * The link's live socket state: "off" (no socket — never paired, pairing
 * expired, or unlinked), "pairing" (QR flow active), "connecting" (paired,
 * socket dialing), "open" (connected).
 */
export type WhatsAppConnection = "off" | "pairing" | "connecting" | "open";

/** WhatsApp link state, as shown in Settings. */
export interface WhatsAppStatus {
  /** A personal account is paired (credentials exist), connected or not. */
  linked: boolean;
  connection: WhatsAppConnection;
  /** The pairing QR code as an image data URL; only while pairing. */
  qrDataUrl: string | null;
  /** Phone number of the paired account (digits only), once linked. */
  phoneNumber: string | null;
  /** The paired account's own display name, once known. */
  pushName: string | null;
  /** Whether chat sessions may send messages (whatsapp_send_message armed). */
  sendAccess: boolean;
}
