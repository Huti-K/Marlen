import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AccountVoice } from "@trailin/shared";
import { createMemory, deleteMemory, listMemories } from "../db/memories.js";
import { getAccountVoices, setAccountVoices } from "../db/settings.js";
import { moduleLogger } from "../logger.js";
import { listAccounts } from "../pipedream/connect.js";
import { errorMessage } from "../util.js";
import { resolveRequiredAccountParam } from "./accounts.js";
import { buildMailReadTools } from "./mailTools.js";
import { runOneShot } from "./oneShot.js";
import { defineTool, textResult } from "./toolResult.js";

const log = moduleLogger("voiceLearn");

/**
 * Learns an account's writing voice from its own sent mail: a one-shot
 * ephemeral Agent (same pattern as delegate.ts) reads a sample of the user's
 * sent messages from the local mailbox mirror, then calls a local
 * report_style tool (terminate: true) to hand back its findings instead of
 * replying in prose — the structured-output pattern the pi framework's
 * AgentTool is meant for; a run that never calls the tool fails rather than
 * being parsed out of prose. The signature is saved on the account's
 * AccountVoice (the same record Settings edits and the create-draft tool,
 * pipedream/mcp.ts, reads at save time); the style directives are saved as
 * account-scoped long-term memories instead (db/memories.ts), with their ids
 * recorded on AccountVoice.styleMemoryIds so the next learn run knows which
 * ones to replace.
 */

function systemPromptFor(accountName: string): string {
  return `You are a writing-style analyst for Trailin, a personal email assistant. Your only job is
to study the user's OWN sent messages in the connected account ${accountName} and report back
their writing style — nothing else.

Steps:
1. Call list_sent_messages with account set to "${accountName}" to list the most recent messages
   the user sent from this account.
2. Read 8-15 of those messages across DIFFERENT threads and recipients: read_thread with each
   threadId, studying only the messages the user wrote (the ones sent by ${accountName}).
3. When you are done, call the report_style tool exactly once with your findings.`;
}

interface LearnedVoice {
  style: string[];
  signature: string;
}

/**
 * Runtime guard for the report_style tool's call. The JSON schema below only
 * constrains what the model is told to send, not what actually arrives —
 * this throws (the AgentTool contract: "throw on failure instead of
 * encoding errors in content") on anything malformed, so a bad call fails
 * the tool call itself before learnAccountVoice ever touches persistence.
 */
function validateReportStyleParams(value: unknown): LearnedVoice {
  if (typeof value !== "object" || value === null) {
    throw new Error("report_style: params must be an object with style and signature.");
  }
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.style) || v.style.length === 0) {
    throw new Error("report_style: style must be a non-empty array of style directives.");
  }
  const style = v.style.map((entry) => (typeof entry === "string" ? entry.trim() : ""));
  if (style.some((entry) => !entry)) {
    throw new Error("report_style: every style entry must be a non-empty string.");
  }
  if (typeof v.signature !== "string") {
    throw new Error('report_style: signature must be a string (use "" if there is none).');
  }
  return { style, signature: v.signature };
}

/**
 * The worker's structured-output tool: instead of parsing prose, it hands its
 * findings straight to `onReport` as validated params. `terminate: true`
 * tells the agent loop to stop after this tool batch rather than start
 * another turn — there is nothing left for the worker to do once it reports.
 */
function buildReportStyleTool(onReport: (report: LearnedVoice) => void): AgentTool {
  return defineTool({
    name: "report_style",
    label: "Report writing style",
    description:
      `Record the writing-style analysis for this account. Call this exactly once, after reading ` +
      `the sample messages, to finish the job.`,
    parameters: {
      type: "object",
      properties: {
        style: {
          type: "array",
          items: { type: "string" },
          description:
            `3-6 short, self-contained directives another assistant can follow when drafting as ` +
            `this account, one aspect per entry — typical greeting, typical sign-off, ` +
            `formality/tone, typical message length, language(s) used and when, and any quirks or ` +
            `audience shifts (e.g. formal with clients, casual with colleagues). Each entry is ONE ` +
            `sentence, written as an instruction ("Greets clients with 'Hallo Herr/Frau <Nachname>' ` +
            `…"), not an observation about counts, and under 280 characters.`,
        },
        signature: {
          type: "string",
          description:
            `The exact recurring signature block the user puts under their sign-off, verbatim ` +
            `including line breaks, WITHOUT the closing line itself ("Best," / "Beste Grüße," ` +
            `belongs to the body, not the signature). Use "" if there is no consistent block.`,
        },
      },
      required: ["style", "signature"],
    },
    execute: async (_id, params) => {
      const report = validateReportStyleParams(params);
      onReport(report);
      return {
        content: [{ type: "text", text: "Style report recorded." }],
        details: undefined,
        terminate: true,
      };
    },
  });
}

/**
 * Analyze one account's sent mail and persist the learned style (as
 * account-scoped memories) and signature (on AccountVoice). This runs
 * several tool round-trips against the model — expect 30-90s. File-local:
 * only voiceLearnTool's execute below calls it.
 */
async function learnAccountVoice(accountId: string): Promise<AccountVoice> {
  const account = (await listAccounts()).find((a) => a.id === accountId);
  if (!account) throw new Error(`No connected account with id ${accountId}.`);
  if (!account.name.includes("@")) {
    throw new Error(`${account.name} is not an email account — voice learning needs sent mail.`);
  }

  let captured: LearnedVoice | undefined;
  // Mirror-served reads only — no MCP session to open or close. The prompt
  // pins list_sent_messages to this account via its account param.
  await runOneShot({
    systemPrompt: systemPromptFor(account.name),
    tools: [...buildMailReadTools(), buildReportStyleTool((report) => (captured = report))],
    prompt: `Study ${account.name}'s sent mail and report its writing style and signature as instructed.`,
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

export const voiceLearnTool: AgentTool = defineTool({
  name: "voice_learn",
  label: "Learn account voice",
  description:
    `Analyze an account's sent mail to learn the user's writing style and extract their ` +
    `signature, then save the style as memories scoped to that account and the signature on ` +
    `its voice (visible in Settings and used for every future draft). Use when the user asks ` +
    `to learn or mimic their style, or set up their signature from past emails.`,
  parameters: {
    type: "object",
    properties: {
      account: {
        type: "string",
        description: "The connected account's email address to learn from.",
      },
    },
    required: ["account"],
  },
  execute: async (_id, params) => {
    const { account } = params as { account: string };
    try {
      const resolved = await resolveRequiredAccountParam(account);
      if (!resolved.account) return textResult(resolved.error);
      const voice = await learnAccountVoice(resolved.account.id);

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
          ? `Learned ${resolved.account.name}'s writing style, saved as memories for this account ` +
            `(review or edit them on the Knowledge page):\n${styleLines.join("\n")}`
          : `No consistent writing-style pattern was found for ${resolved.account.name}.`;
      const signatureText = voice.signature?.trim()
        ? `\n\nSignature saved:\n\n${voice.signature.trim()}`
        : "\n\nNo consistent signature block was found.";

      return textResult(`${styleText}${signatureText}`);
    } catch (error) {
      return textResult(errorMessage(error));
    }
  },
});
