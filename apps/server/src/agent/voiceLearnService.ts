import type { ConnectedAccount } from "@trailin/shared";
import { EMAIL_APPS } from "@trailin/shared";
import { getMailReadProvider } from "../email/read/readProviders.js";
// Side-effect import: populates the MailReadProvider registry.
import "../email/read/registerReadProviders.js";
import { activeModelConfigured } from "../llm/registry.js";
import { moduleLogger } from "../logger.js";
import { listAccounts } from "../pipedream/connect.js";
import { errorMessage } from "../util.js";
import { learnAccountVoice } from "./voiceLearn.js";

const log = moduleLogger("voiceLearnService");

/**
 * Fire-and-forget writing-style learning for a freshly connected email
 * account, launched when the user accepts the prompt shown right after
 * linking. Sent mail is read live from the provider, so it's available the
 * moment the account connects — the only wait here is a short bounded retry
 * for a transient proxy hiccup on the probe.
 *
 * Dropping a learn run is fine (the user can still run it from chat, and the
 * nightly draft-vs-sent loop keeps learning); blocking or crashing the connect
 * flow is not — every failure path here stays quiet and best-effort.
 */

/** Probe retries for "does this account have any sent mail at all". */
const PROBE_ATTEMPTS = 3;
const PROBE_RETRY_DELAY_MS = 10_000;

/** How far back the probe looks for a single sent message. */
const PROBE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

/** Accounts with a learn already in flight, so a double-accept (or a retry) is a no-op. */
const inFlight = new Set<string>();

export interface VoiceLearnDeps {
  listAccounts: (opts?: { refresh?: boolean }) => Promise<ConnectedAccount[]>;
  hasSentMail: (account: ConnectedAccount) => Promise<boolean>;
  modelConfigured: () => Promise<boolean>;
  learn: (accountId: string) => Promise<unknown>;
  sleep: (ms: number) => Promise<void>;
}

async function defaultHasSentMail(account: ConnectedAccount): Promise<boolean> {
  const provider = getMailReadProvider(account.app);
  if (!provider) return false;
  const since = new Date(Date.now() - PROBE_WINDOW_MS).toISOString();
  const sent = await provider.listSentSince(account, since, { limit: 1 });
  return sent.length > 0;
}

const defaultDeps: VoiceLearnDeps = {
  listAccounts: (opts) => listAccounts(opts),
  hasSentMail: (account) => defaultHasSentMail(account),
  modelConfigured: () => activeModelConfigured(),
  learn: (accountId) => learnAccountVoice(accountId),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** The connected account for `accountId`, refreshed so a just-linked one is visible. */
async function resolveEmailAccount(
  accountId: string,
  deps: VoiceLearnDeps,
): Promise<ConnectedAccount | null> {
  const accounts = await deps.listAccounts({ refresh: true });
  const account = accounts.find((a) => a.id === accountId);
  if (!account) return null;
  return (EMAIL_APPS as readonly string[]).includes(account.app) ? account : null;
}

/**
 * True once the account demonstrably has sent mail. A thrown probe (proxy
 * timeout, transient provider failure) is retried a couple of times; a clean
 * "no sent mail" answer is final — retrying wouldn't change it.
 */
async function probeSentMail(account: ConnectedAccount, deps: VoiceLearnDeps): Promise<boolean> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await deps.hasSentMail(account);
    } catch (error) {
      if (attempt >= PROBE_ATTEMPTS) {
        log.warn(
          { err: errorMessage(error), accountId: account.id },
          "sent-mail probe kept failing — skipping voice learn",
        );
        return false;
      }
      await deps.sleep(PROBE_RETRY_DELAY_MS);
    }
  }
}

/** The full accept-on-connect run; exported for tests. Never throws. */
export async function runVoiceLearnOnConnect(
  accountId: string,
  deps: VoiceLearnDeps = defaultDeps,
): Promise<void> {
  if (inFlight.has(accountId)) return;
  inFlight.add(accountId);
  try {
    if (!(await deps.modelConfigured())) {
      log.info({ accountId }, "voice learn on connect skipped: no LLM configured");
      return;
    }
    const account = await resolveEmailAccount(accountId, deps);
    if (!account) {
      log.info({ accountId }, "voice learn on connect skipped: not a connected email account");
      return;
    }
    if (!(await probeSentMail(account, deps))) {
      log.info({ accountId }, "voice learn on connect skipped: no sent mail to learn from");
      return;
    }
    await deps.learn(accountId);
    log.info({ accountId }, "voice learn on connect finished");
  } catch (error) {
    log.warn({ err: errorMessage(error), accountId }, "voice learn on connect failed");
  } finally {
    inFlight.delete(accountId);
  }
}

/**
 * Kick off the accept-on-connect learn without blocking the caller (the HTTP
 * route returns immediately). The run manages its own lifetime and never
 * rejects, so nothing is awaited here.
 */
export function startVoiceLearnOnConnect(accountId: string): void {
  void runVoiceLearnOnConnect(accountId);
}
