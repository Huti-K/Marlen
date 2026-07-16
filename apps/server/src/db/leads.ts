import { randomUUID } from "node:crypto";
import type { Lead, LeadScore, LeadSource, LeadStatus } from "@trailin/shared";
import { desc, eq } from "drizzle-orm";
import { emitServerEvent } from "../events.js";
import { db, schema } from "./index.js";

/**
 * Row-level store for the leads directory. Callers go through
 * leads/manage.ts, which layers email-keyed dedup and the automation cascade
 * on top; this module owns the rows themselves and emits the "leads" server
 * event on every mutation so the web app refetches.
 */

/** A lead's identity is its normalized address: trimmed, lowercased. */
export function normalizeLeadEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface LeadInput {
  email: string;
  name?: string;
  phone?: string;
  accountId?: string;
  source?: LeadSource;
  onofficeAddressId?: string | null;
  status?: LeadStatus;
  interest?: string;
  persona?: string;
  score?: LeadScore;
  notes?: string;
  lastInboundAt?: string | null;
  lastOutboundAt?: string | null;
}

/** Every field but the identity (email) and origin (source) is editable. */
export type LeadPatch = Omit<LeadInput, "email" | "source">;

/** All leads, most recently touched first, optionally narrowed to one status. */
export async function listLeads(filter: { status?: LeadStatus } = {}): Promise<Lead[]> {
  const base = db.select().from(schema.leads);
  const query = filter.status ? base.where(eq(schema.leads.status, filter.status)) : base;
  const rows = await query.orderBy(desc(schema.leads.updatedAt));
  return rows as Lead[];
}

export async function getLead(id: string): Promise<Lead | null> {
  const [row] = await db.select().from(schema.leads).where(eq(schema.leads.id, id));
  return (row as Lead | undefined) ?? null;
}

export async function findLeadByEmail(email: string): Promise<Lead | null> {
  const [row] = await db
    .select()
    .from(schema.leads)
    .where(eq(schema.leads.email, normalizeLeadEmail(email)));
  return (row as Lead | undefined) ?? null;
}

export async function createLead(input: LeadInput): Promise<Lead> {
  const now = new Date().toISOString();
  const lead: Lead = {
    id: randomUUID(),
    name: input.name?.trim() ?? "",
    email: normalizeLeadEmail(input.email),
    phone: input.phone?.trim() ?? "",
    accountId: input.accountId ?? "",
    source: input.source ?? "email",
    onofficeAddressId: input.onofficeAddressId ?? null,
    status: input.status ?? "new",
    interest: input.interest?.trim() ?? "",
    persona: input.persona?.trim() ?? "",
    score: input.score ?? "",
    notes: input.notes?.trim() ?? "",
    lastInboundAt: input.lastInboundAt ?? null,
    lastOutboundAt: input.lastOutboundAt ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(schema.leads).values(lead);
  emitServerEvent("leads");
  return lead;
}

/** Apply the defined fields of `patch`. Returns the updated row, or null when the id is unknown. */
export async function updateLead(id: string, patch: LeadPatch): Promise<Lead | null> {
  const existing = await getLead(id);
  if (!existing) return null;

  const updates: Partial<Lead> = {};
  if (patch.name !== undefined) updates.name = patch.name.trim();
  if (patch.phone !== undefined) updates.phone = patch.phone.trim();
  if (patch.accountId !== undefined) updates.accountId = patch.accountId;
  if (patch.onofficeAddressId !== undefined) updates.onofficeAddressId = patch.onofficeAddressId;
  if (patch.status !== undefined) updates.status = patch.status;
  if (patch.interest !== undefined) updates.interest = patch.interest.trim();
  if (patch.persona !== undefined) updates.persona = patch.persona.trim();
  if (patch.score !== undefined) updates.score = patch.score;
  if (patch.notes !== undefined) updates.notes = patch.notes.trim();
  if (patch.lastInboundAt !== undefined) updates.lastInboundAt = patch.lastInboundAt;
  if (patch.lastOutboundAt !== undefined) updates.lastOutboundAt = patch.lastOutboundAt;
  updates.updatedAt = new Date().toISOString();

  await db.update(schema.leads).set(updates).where(eq(schema.leads.id, id));
  emitServerEvent("leads");
  return { ...existing, ...updates };
}

/** Returns false when no lead has this id. */
export async function deleteLead(id: string): Promise<boolean> {
  const existing = await getLead(id);
  if (!existing) return false;
  await db.delete(schema.leads).where(eq(schema.leads.id, id));
  emitServerEvent("leads");
  return true;
}
