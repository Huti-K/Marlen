import { getAccountSignatures } from "../db/settings.js";
import { htmlBodyWithSignature } from "./textUtils.js";

/**
 * The account's configured signature HTML at call time (settings are cached in
 * memory), or undefined. The signature is appended at the provider boundary
 * only: snapshots, cards, and the learning loop all keep the clean body.
 */
export async function accountSignatureHtml(accountId: string): Promise<string | undefined> {
  const signatures = await getAccountSignatures();
  return signatures.find((s) => s.accountId === accountId)?.html;
}

/** Provider body fields for a draft body: the styled html wrapper plus its cid images when the account has a signature, the plain body untouched otherwise. */
export function outgoingBody(body: string, signatureHtml: string | undefined) {
  if (!signatureHtml) return { body };
  const { html, images } = htmlBodyWithSignature(body, signatureHtml);
  return { body: html, bodyFormat: "html" as const, inlineImages: images };
}
