import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { type AccountVoice, type ConnectedAccount, EMAIL_APPS } from "@trailin/shared";
import { createMemory, deleteMemory, listMemories } from "../db/memories.js";
import { getAccountVoices, patchAccountVoice } from "../db/settings.js";
import {
  deleteVoiceLearnRun,
  failInterruptedVoiceLearnRuns,
  finishVoiceLearnRun,
  listVoiceLearnRuns,
  markVoiceLearnRunning,
} from "../db/voiceRuns.js";
import { normalizeAddressSet } from "../email/learn/addressSubject.js";
import { getMailReadProvider, type SentMessage } from "../email/read/readProviders.js";
import { activeModelConfigured } from "../llm/registry.js";
import { moduleLogger } from "../logger.js";
import { listAccounts } from "../pipedream/connect.js";
import { errorMessage } from "../utils/util.js";
import { type ReportToolSpec, runReportPrompt } from "./oneShot.js";
import { textResult, tool } from "./toolkit.js";

const log = moduleLogger("voiceLearn");

/**
 * Learns an account's writing voice from its own sent mail: the server
 * fetches a sample of the user's sent messages live from the provider
 * (email/read/), downselects it for variety, and hands the samples inline to
 * a report-tool one-shot (agent/oneShot.ts, runReportPrompt) whose report
 * tool is report_style. The style directives are saved as account-scoped
 * long-term memories (db/memories.ts), with their ids recorded on
 * AccountVoice.styleMemoryIds so the next learn run knows which ones to
 * replace.
 *
 * Entry points: voiceLearnTool (interactive chat), and the automatic runs in
 * the second half of this file — kicked off when an email account connects,
 * with a boot reconcile pass for accounts never attempted. All of them share
 * the per-account in-flight guard below: one learn per account at a time,
 * and each learn rewrites only its own account's voice slot
 * (patchAccountVoice), so overlapping learns for different accounts can't
 * erase each other's result.
 */

/** How far back and how much sent mail one learn run considers. */
const SAMPLE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const FETCH_LIMIT = 40;
const MAX_SAMPLES = 15;
const MAX_BODY_CHARS = 2000;

/** Accounts with a learn in flight — one learn per account, across every entry point. */
const inFlight = new Set<string>();

/**
 * Thrown when the account has no usable sent mail in the sample window.
 * recordedLearn treats it as a quiet skip rather than a failure: the
 * attempt row is deleted (nothing to retry by hand until the user writes
 * emails, so Settings shows no error badge) and the boot reconcile re-attempts
 * the account on a later start. The chat tool surfaces its message as-is.
 */
class NoSentMailError extends Error {}

/**
 * The guard and run-state recording every entry point shares: one learn per
 * account at a time — a second learn for an account already being worked on
 * is refused rather than run concurrently, since two overlapping learns
 * would race each other's memory writes — and every attempt's outcome lands
 * in db/voiceRuns.ts, so a failed learn shows up in Settings with a retry
 * button instead of vanishing, and a success clears any stale error badge.
 * The one exception is NoSentMailError, which deletes the attempt row
 * instead (see above). Rethrows the learn's error after recording it; the
 * outcome writes themselves are best-effort.
 */
async function recordedLearn<T>(accountId: string, learn: () => Promise<T>): Promise<T> {
  if (inFlight.has(accountId)) {
    throw new Error("a voice learn for this account is already running — wait for it to finish");
  }
  inFlight.add(accountId);
  try {
    await markVoiceLearnRunning(accountId);
    const result = await learn();
    await finishVoiceLearnRun(accountId);
    return result;
  } catch (error) {
    if (error instanceof NoSentMailError) {
      await deleteVoiceLearnRun(accountId).catch((recordError: unknown) => {
        log.warn({ err: recordError, accountId }, "failed to clear the skipped voice learn's row");
      });
    } else {
      await finishVoiceLearnRun(accountId, errorMessage(error)).catch((recordError: unknown) => {
        log.warn({ err: recordError, accountId }, "failed to record the voice learn's outcome");
      });
    }
    throw error;
  } finally {
    inFlight.delete(accountId);
  }
}

function systemPromptFor(accountName: string): string {
  return `You are a writing-style analyst for Trailin, a personal email assistant. Your only job is
to study the user's OWN sent messages from the connected account ${accountName} — provided below in
the prompt — and report back their writing style, nothing else. Study how the user writes: greeting,
sign-off, tone, length, language(s). When you are done, call the report_style tool exactly once with
your findings.`;
}

/**
 * Downselect the fetched sent mail for variety: newest first, at most one
 * message per thread, preferring unseen recipient sets while filling up —
 * fifteen one-on-one threads with fifteen different people beat fifteen
 * replies into the same thread when the goal is the user's range.
 */
function sampleSentMessages(sent: SentMessage[]): SentMessage[] {
  const newestFirst = [...sent].reverse();
  const seenThreads = new Set<string>();
  const seenRecipients = new Set<string>();
  const distinct: SentMessage[] = [];
  const fallback: SentMessage[] = [];
  for (const message of newestFirst) {
    if (!message.bodyText.trim()) continue;
    if (seenThreads.has(message.providerThreadId)) continue;
    seenThreads.add(message.providerThreadId);
    const recipientKey = [...normalizeAddressSet(message.to)].sort().join(",");
    if (seenRecipients.has(recipientKey)) {
      fallback.push(message);
      continue;
    }
    seenRecipients.add(recipientKey);
    distinct.push(message);
  }
  return [...distinct, ...fallback].slice(0, MAX_SAMPLES);
}

/** The one-shot's prompt: every sample numbered, with enough envelope to read register shifts. */
function renderSamples(accountName: string, samples: SentMessage[]): string {
  const blocks = samples.map((message, index) => {
    const body =
      message.bodyText.length > MAX_BODY_CHARS
        ? `${message.bodyText.slice(0, MAX_BODY_CHARS)}\n[truncated]`
        : message.bodyText;
    return `--- Message ${index + 1} ---
To: ${message.to.join(", ")}
Subject: ${message.subject}
Date: ${message.date}

${body}`;
  });
  return `Sent messages from ${accountName} (${samples.length} samples, newest first):

${blocks.join("\n\n")}

Report this account's writing style via report_style as instructed.`;
}

interface LearnedVoice {
  style: string[];
}

/**
 * The worker's structured-output report tool. The schema asks for a
 * non-empty array of style strings; narrow re-checks the shape (report
 * params are untrusted), trims each style entry, and drops any that turn
 * out blank.
 */
const reportStyleTool: ReportToolSpec<LearnedVoice> = {
  name: "report_style",
  label: "Report writing style",
  description:
    `Record the writing-style analysis for this account. Call this exactly once, after reading ` +
    `the sample messages, to finish the job.`,
  parameters: Type.Object({
    style: Type.Array(Type.String(), {
      minItems: 1,
      description:
        `3-6 short, self-contained directives another assistant can follow when drafting as ` +
        `this account, one aspect per entry — typical greeting, typical sign-off, ` +
        `formality/tone, typical message length, language(s) used and when, and any quirks or ` +
        `audience shifts (e.g. formal with clients, casual with colleagues). Each entry is ONE ` +
        `sentence, written as an instruction ("Greets clients with 'Hallo Herr/Frau <Nachname>' ` +
        `…"), not an observation about counts, and under 280 characters.`,
    }),
  }),
  narrow: (params) => {
    const { style } = (params ?? {}) as Record<string, unknown>;
    return {
      style: Array.isArray(style)
        ? style
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.trim())
            .filter(Boolean)
        : [],
    };
  },
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The sent-mail fetch, with a bounded retry for thrown transient failures
 * (the on-connect run can race freshly-created proxy credentials). A clean
 * answer — even an empty one — is returned as-is; retrying wouldn't change it.
 */
async function fetchSentSample(
  provider: NonNullable<ReturnType<typeof getMailReadProvider>>,
  account: ConnectedAccount,
  attempts: number,
  retryDelayMs: number,
): Promise<SentMessage[]> {
  const since = new Date(Date.now() - SAMPLE_WINDOW_MS).toISOString();
  for (let attempt = 1; ; attempt++) {
    try {
      return await provider.listSentSince(account, since, { limit: FETCH_LIMIT });
    } catch (error) {
      if (attempt >= attempts) throw error;
      log.warn(
        { err: errorMessage(error), accountId: account.id, attempt },
        "sent-mail fetch failed — retrying",
      );
      await sleep(retryDelayMs);
    }
  }
}

/**
 * The learn itself, unguarded: analyze one account's sent mail and persist
 * the learned style as account-scoped memories. Fetching the samples plus
 * one model round-trip — expect 10-60s. Every entry point routes through
 * here inside recordedLearn: the chat tool with a single fetch attempt, the
 * automatic runs with a bounded fetch retry.
 */
async function learnVoiceCore(
  accountId: string,
  fetchAttempts = 1,
  fetchRetryDelayMs = 0,
): Promise<AccountVoice> {
  const account = (await listAccounts()).find((a) => a.id === accountId);
  if (!account) throw new Error(`No connected account with id ${accountId}.`);
  if (!account.name.includes("@")) {
    throw new Error(`${account.name} is not an email account — voice learning needs sent mail.`);
  }
  const provider = getMailReadProvider(account.app);
  if (!provider) {
    throw new Error(`Voice learning isn't supported for ${account.appName} accounts yet.`);
  }

  const sent = await fetchSentSample(provider, account, fetchAttempts, fetchRetryDelayMs);
  const samples = sampleSentMessages(sent);
  if (samples.length === 0) {
    throw new NoSentMailError(
      `${account.name} has no recent sent mail to learn from — write a few emails first.`,
    );
  }

  const learned = await runReportPrompt({
    systemPrompt: systemPromptFor(account.name),
    tool: reportStyleTool,
    prompt: renderSamples(account.name, samples),
    missingReportError: "the style analysis finished without calling report_style — try again",
  });

  // Write-then-delete: create the new style memories and persist the voice
  // record pointing at them FIRST, and only then delete the previous learn
  // run's memories. Deleting first would mean a mid-run failure,
  // or a directive silently skipped below, could leave the account with
  // fewer/no style directives and styleMemoryIds pointing at nothing — an
  // orphaned old memory is recoverable by hand, a lost voice is not.
  const styleMemoryIds: string[] = [];
  for (const directive of learned.style) {
    try {
      // A dedup hit returns the existing entry instead of creating a new one
      // — still worth recording its id so a future re-learn replaces it too.
      const { entry } = await createMemory(directive, "agent", accountId);
      styleMemoryIds.push(entry.id);
    } catch {
      // Skip directives the model produced that don't fit memory's limits
      // (e.g. over-length) rather than failing the whole learn run.
    }
  }

  // patchAccountVoice swaps only this account's slot against the array as it
  // is on disk at write time, so a learn finishing for another account in
  // parallel can't be erased here (nor this one there). The previous entry is
  // captured from inside the patch — that's the freshest view of which style
  // memories the new ones replace.
  let previous: AccountVoice | undefined;
  const next = await patchAccountVoice(accountId, (existing) => {
    previous = existing;
    return {
      accountId,
      learnedAt: new Date().toISOString(),
      styleMemoryIds,
    };
  });

  // Only now replace the previous learn run's style directives, not any
  // memory the user wrote by hand — deleteMemory is a no-op for ids already
  // gone. Skip any id a dedup hit above reused for the new voice, and don't
  // let one bad delete abort the rest: the fresh voice above is already
  // saved either way, so a failure here just orphans a memory (recoverable
  // in Settings) rather than losing the voice.
  for (const id of previous?.styleMemoryIds ?? []) {
    if (styleMemoryIds.includes(id)) continue;
    try {
      await deleteMemory(id);
    } catch (error) {
      log.warn({ err: error, accountId, memoryId: id }, "failed to delete old style memory");
    }
  }

  return next;
}

export const voiceLearnTool: AgentTool = tool({
  name: "voice_learn",
  label: "Learn account voice",
  description:
    `Analyze an account's sent mail to learn the user's writing style, then save the style ` +
    `as memories scoped to that account (used for every future draft). Use when the user ` +
    `asks to learn or mimic their style from past emails.`,
  account: "required",
  accountDescription: "The connected account's email address to learn from.",
  params: {},
  catchToText: true,
  execute: async (_params, { account }) => {
    // recordedLearn keeps the per-account run state truthful for this path
    // too, and catchToText surfaces any thrown message (no sent mail,
    // already running, a failed learn) as the tool's result text.
    const voice = await recordedLearn(account.id, () => learnVoiceCore(account.id));

    // Look the saved directives back up by id so the reply can quote them
    // — the learn only returns the voice record, not their text.
    const memories = await listMemories();
    const byId = new Map(memories.map((m) => [m.id, m.content]));
    const styleLines = (voice.styleMemoryIds ?? [])
      .map((id) => byId.get(id))
      .filter((content): content is string => !!content)
      .map((content) => `- ${content}`);
    const styleText =
      styleLines.length > 0
        ? `Learned ${account.name}'s writing style, saved as memories for this account ` +
          `(review or edit them on the Knowledge page):\n${styleLines.join("\n")}`
        : `No consistent writing-style pattern was found for ${account.name}.`;

    return textResult(styleText);
  },
});

/**
 * Automatic writing-style learning for connected email accounts. Runs
 * without asking: the connect flow kicks it off for a freshly linked
 * account, and a boot reconcile pass picks up any email account that was
 * never attempted (a missed connect trigger, or an account linked before
 * this existed). Sent mail is read live from the provider, so it's available
 * the moment the account connects — the only wait here is the learn's own
 * bounded fetch retry for a transient proxy hiccup. Blocking or crashing the
 * connect flow is never acceptable: every failure path stays quiet and
 * best-effort.
 */

/** Fetch retries for the automatic runs' sent-mail sample. */
const CONNECT_FETCH_ATTEMPTS = 3;
const CONNECT_FETCH_RETRY_DELAY_MS = 10_000;

export interface VoiceLearnDeps {
  listAccounts: (opts?: { refresh?: boolean }) => Promise<ConnectedAccount[]>;
  modelConfigured: () => Promise<boolean>;
  learn: (accountId: string) => Promise<unknown>;
}

const defaultDeps: VoiceLearnDeps = {
  listAccounts: (opts) => listAccounts(opts),
  modelConfigured: () => activeModelConfigured(),
  // The unguarded core — recordedLearn holds the in-flight guard around the
  // whole run — with the bounded fetch retry.
  learn: (accountId) =>
    learnVoiceCore(accountId, CONNECT_FETCH_ATTEMPTS, CONNECT_FETCH_RETRY_DELAY_MS),
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
 * The full automatic learn for one account. Never throws — recordedLearn
 * records every outcome, and the failure modes only get logged here. Skips
 * (no LLM, not an email account) are thrown as errors so they stay visible
 * and retryable in Settings — except a concurrent duplicate, which belongs
 * to the learn already in flight and records nothing.
 */
export async function runVoiceLearnOnConnect(
  accountId: string,
  deps: VoiceLearnDeps = defaultDeps,
): Promise<void> {
  if (inFlight.has(accountId)) return;
  try {
    await recordedLearn(accountId, async () => {
      if (!(await deps.modelConfigured())) {
        throw new Error("no LLM configured — sign in under Settings → AI");
      }
      if (!(await resolveEmailAccount(accountId, deps))) {
        throw new Error("not a connected email account");
      }
      await deps.learn(accountId);
    });
    log.info({ accountId }, "voice learn finished");
  } catch (error) {
    if (error instanceof NoSentMailError) {
      log.info({ accountId }, "voice learn skipped: no sent mail to learn from");
    } else {
      log.warn({ err: errorMessage(error), accountId }, "voice learn failed");
    }
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
 * Boot catch-up: learn every connected email account with no attempt row
 * and no saved voice — a missed connect trigger, an account that predates
 * automatic learning, or one whose last attempt found no sent mail (that
 * skip leaves no row, so the account is quietly re-tried here each boot
 * until the user has written emails). Attempted-but-failed accounts are
 * deliberately left alone: their error rows are the user's to retry, and
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
