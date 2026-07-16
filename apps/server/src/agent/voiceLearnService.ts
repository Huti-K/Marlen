import type { ConnectedAccount } from "@trailin/shared";
import { EMAIL_APPS } from "@trailin/shared";
import { getMailReadProvider } from "../email/read/readProviders.js";
// Side-effect import: populates the MailReadProvider registry.
import "../email/read/registerReadProviders.js";
import { getAccountVoices } from "../db/settings.js";
import {
  failInterruptedVoiceLearnRuns,
  finishVoiceLearnRun,
  listVoiceLearnRuns,
  markVoiceLearnRunning,
} from "../db/voiceRuns.js";
import { activeModelConfigured } from "../llm/registry.js";
import { moduleLogger } from "../logger.js";
import { listAccounts } from "../pipedream/connect.js";
import { errorMessage } from "../util.js";
import { learnAccountVoice } from "./voiceLearn.js";

const log = moduleLogger("voiceLearnService");

/**
 * Automatic writing-style learning for connected email accounts. Runs
 * without asking: the connect flow kicks it off for a freshly linked
 * account, and a boot reconcile pass picks up any email account that was
 * never attempted (a missed connect trigger, or an account linked before
 * this existed). Sent mail is read live from the provider, so it's available
 * the moment the account connects — the only wait here is a short bounded
 * retry for a transient proxy hiccup on the probe.
 *
 * Every attempt's outcome — including the skips — lands in db/voiceRuns.ts,
 * so a learn that failed or found nothing to read shows up in Settings with
 * a retry button instead of vanishing. Blocking or crashing the connect flow
 * is never acceptable: every failure path stays quiet and best-effort.
 */

/** Probe retries for "does this account have any sent mail at all". */
const PROBE_ATTEMPTS = 3;
const PROBE_RETRY_DELAY_MS = 10_000;

/** How far back the probe looks for a single sent message. */
const PROBE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

/** Accounts with a learn already in flight, so a double-trigger (or a retry) is a no-op. */
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

/**
 * The full automatic learn for one account, recording its outcome; exported
 * for tests. Never throws. Skips (no LLM, not an email account, no sent
 * mail) are recorded as errors so they stay visible and retryable — except
 * a concurrent duplicate, which belongs to the run already in flight.
 */
export async function runVoiceLearnOnConnect(
  accountId: string,
  deps: VoiceLearnDeps = defaultDeps,
): Promise<void> {
  if (inFlight.has(accountId)) return;
  inFlight.add(accountId);
  try {
    await markVoiceLearnRunning(accountId);
    if (!(await deps.modelConfigured())) {
      log.info({ accountId }, "voice learn skipped: no LLM configured");
      await finishVoiceLearnRun(accountId, "no LLM configured — sign in under Settings → AI");
      return;
    }
    const account = await resolveEmailAccount(accountId, deps);
    if (!account) {
      log.info({ accountId }, "voice learn skipped: not a connected email account");
      await finishVoiceLearnRun(accountId, "not a connected email account");
      return;
    }
    if (!(await probeSentMail(account, deps))) {
      log.info({ accountId }, "voice learn skipped: no sent mail to learn from");
      await finishVoiceLearnRun(accountId, "no sent mail found to learn from");
      return;
    }
    await deps.learn(accountId);
    await finishVoiceLearnRun(accountId);
    log.info({ accountId }, "voice learn finished");
  } catch (error) {
    log.warn({ err: errorMessage(error), accountId }, "voice learn failed");
    await finishVoiceLearnRun(accountId, errorMessage(error)).catch((recordError: unknown) => {
      log.warn({ err: recordError, accountId }, "failed to record the voice learn's failure");
    });
  } finally {
    inFlight.delete(accountId);
  }
}

/**
 * Kick off the automatic learn without blocking the caller (the HTTP route
 * returns immediately). The run manages its own lifetime and never rejects,
 * so nothing is awaited here.
 */
export function startVoiceLearnOnConnect(accountId: string): void {
  void runVoiceLearnOnConnect(accountId);
}

/**
 * Boot catch-up: learn every connected email account that was never
 * attempted and has no saved voice — a missed connect trigger, or an
 * account that predates automatic learning. Attempted-but-failed accounts
 * are deliberately left alone: their error rows are the user's to retry, and
 * auto-retrying them every boot could hammer a permanently broken account.
 * Runs accounts sequentially — each learn is a full model call, and a burst
 * of parallel ones would spike provider and LLM rate limits at boot.
 *
 * Skipped entirely (recording nothing) while no LLM is configured, so the
 * pass simply happens on a later boot once one is set up. Never throws.
 */
export async function reconcileVoiceLearns(deps: VoiceLearnDeps = defaultDeps): Promise<void> {
  try {
    await failInterruptedVoiceLearnRuns();
    if (!(await deps.modelConfigured())) {
      log.info("voice-learn reconcile skipped: no LLM configured");
      return;
    }
    const [accounts, runs, voices] = await Promise.all([
      deps.listAccounts(),
      listVoiceLearnRuns(),
      getAccountVoices(),
    ]);
    const attempted = new Set(runs.map((run) => run.accountId));
    const learned = new Set(voices.map((voice) => voice.accountId));
    for (const account of accounts) {
      if (!(EMAIL_APPS as readonly string[]).includes(account.app)) continue;
      if (attempted.has(account.id) || learned.has(account.id)) continue;
      log.info({ accountId: account.id }, "voice-learn reconcile: learning account");
      await runVoiceLearnOnConnect(account.id, deps);
    }
  } catch (error) {
    log.warn({ err: errorMessage(error) }, "voice-learn reconcile failed");
  }
}
