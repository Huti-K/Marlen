import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { AccountVoice } from "@trailin/shared";
import { createMemory, deleteMemory, listMemories } from "../db/memories.js";
import { getAccountVoices, setAccountVoices } from "../db/settings.js";
import { finishVoiceLearnRun, markVoiceLearnRunning } from "../db/voiceRuns.js";
import { normalizeAddressSet } from "../email/learn/addressSubject.js";
import { getMailReadProvider, type SentMessage } from "../email/read/readProviders.js";
import { errorMessage } from "../util.js";
// Side-effect import: populates the MailReadProvider registry.
import "../email/read/registerReadProviders.js";
import { moduleLogger } from "../logger.js";
import { listAccounts } from "../pipedream/connect.js";
import { runOneShot } from "./oneShot.js";
import { textResult, tool } from "./toolkit.js";

const log = moduleLogger("voiceLearn");

/**
 * Learns an account's writing voice from its own sent mail: the server
 * fetches a sample of the user's sent messages live from the provider
 * (email/read/), downselects it for variety, and hands the samples inline to
 * a one-shot ephemeral Agent whose only tool is report_style (terminate:
 * true) — the structured-output pattern the pi framework's AgentTool is
 * meant for; a run that never calls the tool fails rather than being parsed
 * out of prose. The signature is saved on the account's AccountVoice (the
 * same record Settings edits and the create-draft tool, pipedream/mcp.ts,
 * reads at save time); the style directives are saved as account-scoped
 * long-term memories instead (db/memories.ts), with their ids recorded on
 * AccountVoice.styleMemoryIds so the next learn run knows which ones to
 * replace.
 */

/** How far back and how much sent mail one learn run considers. */
const SAMPLE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const FETCH_LIMIT = 40;
const MAX_SAMPLES = 15;
const MAX_BODY_CHARS = 2000;

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

Report this account's writing style and signature via report_style as instructed.`;
}

interface LearnedVoice {
  style: string[];
  signature: string;
}

/**
 * The worker's structured-output tool: instead of parsing prose, it hands its
 * findings straight to `onReport`. The schema guarantees a non-empty array of
 * strings and a string signature before execute ever runs; execute still
 * trims each style entry and drops any that turn out blank, since that's
 * sanitization (not a shape the schema can express) rather than validation.
 * `terminate: true` tells the agent loop to stop after this tool batch rather
 * than start another turn — there is nothing left for the worker to do once
 * it reports.
 */
function buildReportStyleTool(onReport: (report: LearnedVoice) => void): AgentTool {
  return tool({
    name: "report_style",
    label: "Report writing style",
    description:
      `Record the writing-style analysis for this account. Call this exactly once, after reading ` +
      `the sample messages, to finish the job.`,
    params: {
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
      signature: Type.String({
        description:
          `The exact recurring signature block the user puts under their sign-off, verbatim ` +
          `including line breaks, WITHOUT the closing line itself ("Best," / "Beste Grüße," ` +
          `belongs to the body, not the signature). Use "" if there is no consistent block.`,
      }),
    },
    execute: async ({ style, signature }) => {
      const trimmedStyle = style.map((entry) => entry.trim()).filter(Boolean);
      onReport({ style: trimmedStyle, signature });
      return { ...textResult("Style report recorded."), terminate: true };
    },
  });
}

/**
 * Analyze one account's sent mail and persist the learned style (as
 * account-scoped memories) and signature (on AccountVoice). Fetching the
 * samples plus one model round-trip — expect 10-60s. Called by
 * voiceLearnTool's execute below (interactive chat) and by voiceLearnService
 * (the automatic on-connect and boot-reconcile background runs).
 */
export async function learnAccountVoice(accountId: string): Promise<AccountVoice> {
  const account = (await listAccounts()).find((a) => a.id === accountId);
  if (!account) throw new Error(`No connected account with id ${accountId}.`);
  if (!account.name.includes("@")) {
    throw new Error(`${account.name} is not an email account — voice learning needs sent mail.`);
  }
  const provider = getMailReadProvider(account.app);
  if (!provider) {
    throw new Error(`Voice learning isn't supported for ${account.appName} accounts yet.`);
  }

  const since = new Date(Date.now() - SAMPLE_WINDOW_MS).toISOString();
  const sent = await provider.listSentSince(account, since, { limit: FETCH_LIMIT });
  const samples = sampleSentMessages(sent);
  if (samples.length === 0) {
    throw new Error(
      `${account.name} has no recent sent mail to learn from — write a few emails first.`,
    );
  }

  let captured: LearnedVoice | undefined;
  await runOneShot({
    systemPrompt: systemPromptFor(account.name),
    tools: [buildReportStyleTool((report) => (captured = report))],
    prompt: renderSamples(account.name, samples),
  });
  if (!captured) {
    throw new Error("the style analysis finished without calling report_style — try again");
  }
  const learned: LearnedVoice = captured;

  const voices = await getAccountVoices();
  const existing = voices.find((v) => v.accountId === accountId);

  // Write-then-delete: create the new style memories and persist the voice
  // record pointing at them FIRST, and only then delete the previous learn
  // run's memories. Deleting first would mean a mid-run failure,
  // or a directive silently skipped below, could leave the account with
  // fewer/no style directives and styleMemoryIds pointing at nothing — an
  // orphaned old memory is recoverable by hand, a lost voice is not.
  const styleMemoryIds: string[] = [];
  for (const directive of learned.style) {
    const trimmed = directive.trim();
    if (!trimmed) continue;
    try {
      // A dedup hit returns the existing entry instead of creating a new one
      // — still worth recording its id so a future re-learn replaces it too.
      const { entry } = await createMemory(trimmed, "agent", accountId);
      styleMemoryIds.push(entry.id);
    } catch {
      // Skip directives the model produced that don't fit memory's limits
      // (e.g. over-length) rather than failing the whole learn run.
    }
  }

  const signature = learned.signature.trim();
  const next: AccountVoice = {
    accountId,
    // Keep any existing manually-set signature when nothing consistent was found.
    signature: signature || existing?.signature,
    learnedAt: new Date().toISOString(),
    styleMemoryIds,
  };
  const index = voices.findIndex((v) => v.accountId === accountId);
  const updated = index >= 0 ? voices.map((v, i) => (i === index ? next : v)) : [...voices, next];
  await setAccountVoices(updated);

  // Only now replace the previous learn run's style directives, not any
  // memory the user wrote by hand — deleteMemory is a no-op for ids already
  // gone. Skip any id a dedup hit above reused for the new voice, and don't
  // let one bad delete abort the rest: the fresh voice above is already
  // saved either way, so a failure here just orphans a memory (recoverable
  // in Settings) rather than losing the voice.
  for (const id of existing?.styleMemoryIds ?? []) {
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
    `Analyze an account's sent mail to learn the user's writing style and extract their ` +
    `signature, then save the style as memories scoped to that account and the signature on ` +
    `its voice (visible in Settings and used for every future draft). Use when the user asks ` +
    `to learn or mimic their style, or set up their signature from past emails.`,
  account: "required",
  accountDescription: "The connected account's email address to learn from.",
  params: {},
  catchToText: true,
  execute: async (_params, { account }) => {
    // Keep the per-account run state (db/voiceRuns.ts) truthful for this
    // path too: a chat-initiated learn that succeeds must clear a stale
    // error badge in Settings, and one that fails must show up there.
    await markVoiceLearnRunning(account.id);
    let voice: AccountVoice;
    try {
      voice = await learnAccountVoice(account.id);
    } catch (error) {
      await finishVoiceLearnRun(account.id, errorMessage(error));
      throw error;
    }
    await finishVoiceLearnRun(account.id);

    // Look the saved directives back up by id so the reply can quote them
    // — learnAccountVoice only returns the voice record, not their text.
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
    const signatureText = voice.signature?.trim()
      ? `\n\nSignature saved:\n\n${voice.signature.trim()}`
      : "\n\nNo consistent signature block was found.";

    return textResult(`${styleText}${signatureText}`);
  },
});
