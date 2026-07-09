/**
 * Side-effect-only module: importing this registers every DraftProvider
 * Trailin ships (each provider file calls registerDraftProvider itself at
 * module scope). Anything that resolves providers via getDraftProvider
 * should import this first so the registry is populated regardless of which
 * concrete provider module happened to be imported elsewhere already.
 *
 * Adding a new provider (e.g. zoho_mail) is one new file implementing
 * DraftProvider plus one import line here — nothing else changes.
 */
import "../pipedream/gmailDrafts.js";
import "./outlookDrafts.js";
