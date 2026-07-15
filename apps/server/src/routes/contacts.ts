import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import {
  CONTACT_CATEGORIES,
  CONTACT_KINDS,
  type Contact,
  type ContactCategory,
  type ContactDetail,
  type ContactKind,
} from "@trailin/shared";
import { isEmailLike, parseAddressEntry } from "../email/contacts/addressMatch.js";
import {
  createContact,
  getContact,
  hideContact,
  listContacts,
  setContactCategory,
  setContactName,
} from "../email/contacts/contactsStore.js";
import { recentThreadsForContact } from "../email/contacts/contactsThreads.js";
import { badRequest, notFound } from "../errors.js";
import { emitServerEvent } from "../events.js";

const listQuery = Type.Object({
  kind: Type.Optional(Type.String()),
  category: Type.Optional(Type.String()),
  q: Type.Optional(Type.String()),
});

const addressParams = Type.Object({ address: Type.String() });
const patchBody = Type.Object({
  category: Type.Optional(Type.String()),
  displayName: Type.Optional(Type.String()),
});
const createBody = Type.Object({
  address: Type.String(),
  displayName: Type.Optional(Type.String()),
});

function isContactKind(value: string): value is ContactKind {
  return (CONTACT_KINDS as readonly string[]).includes(value);
}

function isContactCategory(value: string): value is ContactCategory {
  return (CONTACT_CATEGORIES as readonly string[]).includes(value);
}

/**
 * The contacts core (email/contacts/): one row per correspondent address,
 * aggregated from the mailbox mirror and judged by the enrichment pipeline.
 * Reads plus the manual overrides — a category/name edit (PATCH), a manual
 * add (POST), and a soft-delete/hide (DELETE) — each of which persists against
 * the derivation and enrichment jobs.
 */
export const contactRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get("/api/contacts", { schema: { querystring: listQuery } }, async (req) => {
    const { kind, category, q } = req.query;
    if (kind !== undefined && !isContactKind(kind)) throw badRequest(`invalid kind "${kind}"`);
    if (category !== undefined && !isContactCategory(category)) {
      throw badRequest(`invalid category "${category}"`);
    }
    return listContacts({ kind, category, q });
  });

  app.get(
    "/api/contacts/:address",
    { schema: { params: addressParams } },
    async (req): Promise<ContactDetail> => {
      const address = req.params.address.trim().toLowerCase();
      const contact = getContact(address);
      if (!contact) throw notFound("contact not found");
      const recentThreads = await recentThreadsForContact(address);
      return { ...contact, recentThreads };
    },
  );

  /** Manual create for an address the mirror hasn't produced a contact for yet. */
  app.post("/api/contacts", { schema: { body: createBody } }, async (req): Promise<Contact> => {
    const address = req.body.address.trim().toLowerCase();
    if (!isEmailLike(address)) throw badRequest(`invalid address "${req.body.address}"`);
    if (getContact(address)) throw badRequest("a contact with this address already exists");
    // Prefer the display part of a "Name <addr>" paste, else the given name.
    const parsed = parseAddressEntry(req.body.displayName ?? "");
    const contact = createContact(address, parsed.name || (req.body.displayName ?? ""));
    emitServerEvent("contacts");
    return contact;
  });

  /**
   * The manual overrides: category pins category_source to "user" and
   * displayName stores a name override — both survive later enrichment and
   * derivation. Either field may be sent; each provided one is applied.
   */
  app.patch(
    "/api/contacts/:address",
    { schema: { params: addressParams, body: patchBody } },
    async (req): Promise<Contact> => {
      const address = req.params.address.trim().toLowerCase();
      const { category, displayName } = req.body;
      if (category === undefined && displayName === undefined) {
        throw badRequest("nothing to update");
      }
      let updated = getContact(address);
      if (!updated) throw notFound("contact not found");
      if (category !== undefined) {
        if (!isContactCategory(category)) throw badRequest(`invalid category "${category}"`);
        updated = setContactCategory(address, category);
      }
      if (displayName !== undefined) {
        updated = setContactName(address, displayName);
      }
      if (!updated) throw notFound("contact not found");
      emitServerEvent("contacts");
      return updated;
    },
  );

  /** Soft delete: hides the contact from the lists, keeping the row (and its enrichment/overrides). */
  app.delete("/api/contacts/:address", { schema: { params: addressParams } }, async (req) => {
    const address = req.params.address.trim().toLowerCase();
    if (!hideContact(address)) throw notFound("contact not found");
    emitServerEvent("contacts");
    return { ok: true };
  });
};
