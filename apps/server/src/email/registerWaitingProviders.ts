/**
 * Side-effect-only module: importing this registers every WaitingProvider
 * Trailin ships (each provider file calls registerWaitingProvider itself at
 * module scope). Mirrors registerProviders.ts's role for DraftProvider.
 *
 * Adding a new provider is one new file implementing WaitingProvider plus one
 * import line here — nothing else changes.
 */
import "../pipedream/gmailWaiting.js";
