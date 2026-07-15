import type { ConnectedAccount } from "@trailin/shared";
import { EMAIL_APPS } from "@trailin/shared";
import { listSentMessages } from "../email/sync/mailQuery.js";
import { syncAccount } from "../email/sync/syncEngine.js";
import { activeModelConfigured } from "../llm/registry.js";
import { moduleLogger } from "../logger.js";
import { listAccounts } from "../pipedream/connect.js";
import { errorMessage } from "../util.js";
import { learnAccountVoice } from "./voiceLearn.js";

const log = moduleLogger("voiceLearnService");

/**
 * Fire-and-forget writing-style learning for a freshly connected email account,
 * launched when the user accepts the prompt shown right after linking. It can't
 * run the instant the account connects: learnAccountVoice reads the local
 * mailbox mirror, and a brand-new account has no sent mail there until the sync
 * engine backfills it. So this orchestrator forces syncs and waits (bounded)
 * for the account's sent mail to appear, then hands off to learnAccountVoice.
 *
 * Dropping a learn run is fine (the user can still run it from chat, and the
 * nightly draft-vs-sent loop keeps learning); blocking or crashing the connect
 * flow is not — every failure path here stays quiet and best-effort.
 */

/** Poll cadence and ceiling while waiting for the first backfill to surface sent mail. */
const POLL_INTERVAL_MS = 15_000;
const MAX_WAIT_MS = 5 * 60_000;

/** How many recent sent messages are enough to bother analyzing a voice. */
const MIN_SENT_MESSAGES = 1;

/** Accounts with a learn already in flight, so a double-accept (or a retry) is a no-op. */
const inFlight = new Set<string>();

export interface VoiceLearnDeps {
  listAccounts: (opts?: { refresh?: boolean }) => Promise<ConnectedAccount[]>;
  syncAccount: (account: ConnectedAccount) => Promise<void>;
  countSentMessages: (accountId: string) => number;
  modelConfigured: () => Promise<boolean>;
  learn: (accountId: string) => Promise<unknown>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

const defaultDeps: VoiceLearnDeps = {
  listAccounts: (opts) => listAccounts(opts),
  syncAccount: (account) => syncAccount(account),
  countSentMessages: (accountId) => listSentMessages(accountId, MIN_SENT_MESSAGES).length,
  modelConfigured: () => activeModelConfigured(),
  learn: (accountId) => learnAccountVoice(accountId),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
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
 * Force syncs until the mirror holds some of this account's sent mail, or the
 * wait window elapses. Returns true once sent mail is present. A sync failure
 * is swallowed — the next poll retries, and the deadline still bounds the wait.
 */
async function waitForSentMail(account: ConnectedAccount, deps: VoiceLearnDeps): Promise<boolean> {
  const deadline = deps.now() + MAX_WAIT_MS;
  for (;;) {
    await deps.syncAccount(account).catch(() => {});
    if (deps.countSentMessages(account.id) >= MIN_SENT_MESSAGES) return true;
    if (deps.now() >= deadline) return false;
    await deps.sleep(POLL_INTERVAL_MS);
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
    if (!(await waitForSentMail(account, deps))) {
      log.info(
        { accountId },
        "voice learn on connect gave up: no sent mail mirrored within the wait window",
      );
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
