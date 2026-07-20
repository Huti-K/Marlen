import { createFetchCache } from "../../core/utils/fetchCache.js";
import { getAccountCredentials, listAccounts } from "../pipedream/connect.js";
import { dispatchWhatsApp, isWhatsAppLinked } from "./session.js";

/**
 * Transport routing for outbound WhatsApp: the personal link (Baileys) when
 * paired, else a WhatsApp Business (Cloud API) account connected through
 * Pipedream. The personal link wins because it can message anyone; Cloud API
 * free-form texts only reach recipients inside Meta's 24-hour service window.
 */

const GRAPH_BASE = "https://graph.facebook.com/v23.0";

export async function getWhatsAppBusinessAccount(): Promise<{ id: string; name: string } | null> {
  try {
    const account = (await listAccounts()).find((a) => a.app === "whatsapp_business" && a.healthy);
    return account ? { id: account.id, name: account.name } : null;
  } catch {
    // Pipedream unconfigured or unreachable: no business transport.
    return null;
  }
}

async function graphRequest(token: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${GRAPH_BASE}/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    error?: { message?: string; code?: number };
  };
  if (!res.ok) {
    let message = payload.error?.message ?? `WhatsApp Business API request failed (${res.status})`;
    // 131047: free-form message outside the 24-hour service window.
    if (payload.error?.code === 131047) {
      message +=
        " — the recipient is outside WhatsApp's 24-hour service window; they must message " +
        "this number first, or an approved template is required";
    }
    throw new Error(message);
  }
  return payload;
}

const senderCache = createFetchCache<{ token: string; phoneNumberId: string }>({
  ttlMs: 60 * 60_000,
});

/** Token + sending number of the business account; numbers change rarely, so cached long. */
async function businessSender(
  accountId: string,
): Promise<{ token: string; phoneNumberId: string }> {
  const outcome = await senderCache.fetch(accountId, async () => {
    const creds = await getAccountCredentials(accountId);
    const token = creds.permanent_access_token;
    const wabaId = creds.business_account_id;
    if (!token || !wabaId) {
      throw new Error(
        "the WhatsApp Business account is missing its access token or business account id",
      );
    }
    const numbers = (await graphRequest(token, `${wabaId}/phone_numbers`)) as {
      data?: Array<{ id?: string }>;
    };
    const phoneNumberId = numbers.data?.[0]?.id;
    if (!phoneNumberId) {
      throw new Error("the WhatsApp Business account has no registered phone number");
    }
    return { token, phoneNumberId };
  });
  return outcome.value;
}

async function dispatchBusiness(
  accountId: string,
  target: string,
  text: string,
): Promise<{ sentRef?: string }> {
  if (target.endsWith("@g.us")) {
    throw new Error("the WhatsApp Business API cannot message groups");
  }
  const digits = target.split("@")[0]?.replace(/\D/g, "") ?? "";
  if (!digits) throw new Error(`"${target}" is not a phone number the Business API can message`);
  const { token, phoneNumberId } = await businessSender(accountId);
  const result = (await graphRequest(token, `${phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: digits,
    type: "text",
    text: { preview_url: false, body: text },
  })) as { messages?: Array<{ id?: string }> };
  return { sentRef: result.messages?.[0]?.id };
}

/** The one outbound send point (card click, armed autosend, tool send=true). */
export async function sendWhatsApp(target: string, text: string): Promise<{ sentRef?: string }> {
  if (isWhatsAppLinked()) return dispatchWhatsApp(target, text);
  const business = await getWhatsAppBusinessAccount();
  if (business) return dispatchBusiness(business.id, target, text);
  throw new Error("WhatsApp is not connected");
}
