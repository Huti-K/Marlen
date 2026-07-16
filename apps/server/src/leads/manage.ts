import type { Lead } from "@trailin/shared";
import { eq } from "drizzle-orm";
import { deleteAutomation } from "../automations/manage.js";
import { db, schema } from "../db/index.js";
import {
  createLead,
  deleteLead,
  findLeadByEmail,
  type LeadInput,
  normalizeLeadEmail,
  updateLead,
} from "../db/leads.js";
import { badRequest } from "../errors.js";

/**
 * Lead intake and removal, shared by the HTTP routes and the agent's lead
 * tools so both entry points get identical validation, email-keyed dedup,
 * and the cascade over a lead's automations. Validation failures throw
 * AppErrors: the central handler renders them for routes, and the agent
 * tools surface the message as steering text (catchToText).
 */

/** Loose shape check — enough to reject names, phone numbers, or free text in the email slot. */
const EMAILISH = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The intake upsert: create the lead, or merge into the row already keyed by
 * this address. Merging is deliberately conservative — repeat intake must
 * never regress what's already known, so it only fills empty fields, keeps
 * status untouched (updateLead/PATCH is the explicit editor), and advances
 * the two last-message timestamps monotonically.
 */
export async function recordLead(input: LeadInput): Promise<{ lead: Lead; created: boolean }> {
  const email = normalizeLeadEmail(input.email);
  if (!EMAILISH.test(email)) throw badRequest(`not an email address: ${input.email}`);

  const existing = await findLeadByEmail(email);
  if (!existing) {
    return { lead: await createLead({ ...input, email }), created: true };
  }

  const lead = await updateLead(existing.id, {
    name: fillEmpty(existing.name, input.name),
    phone: fillEmpty(existing.phone, input.phone),
    accountId: fillEmpty(existing.accountId, input.accountId),
    interest: fillEmpty(existing.interest, input.interest),
    persona: fillEmpty(existing.persona, input.persona),
    score: existing.score === "" ? input.score : undefined,
    notes: fillEmpty(existing.notes, input.notes),
    onofficeAddressId: existing.onofficeAddressId ?? input.onofficeAddressId,
    lastInboundAt: latest(existing.lastInboundAt, input.lastInboundAt),
    lastOutboundAt: latest(existing.lastOutboundAt, input.lastOutboundAt),
  });
  if (!lead) throw new Error(`lead ${existing.id} vanished during merge`);
  return { lead, created: false };
}

/** Delete a lead and every automation attached to it. Returns false when the id is unknown. */
export async function removeLead(id: string): Promise<boolean> {
  const attached = await db
    .select({ id: schema.automations.id })
    .from(schema.automations)
    .where(eq(schema.automations.leadId, id));
  for (const automation of attached) await deleteAutomation(automation.id);
  return deleteLead(id);
}

function fillEmpty(current: string, incoming: string | undefined): string | undefined {
  if (current !== "") return undefined;
  return incoming;
}

/** ISO timestamps compare correctly as strings; undefined/null never win. */
function latest(current: string | null, incoming: string | null | undefined): string | undefined {
  if (!incoming) return undefined;
  if (current && current >= incoming) return undefined;
  return incoming;
}
