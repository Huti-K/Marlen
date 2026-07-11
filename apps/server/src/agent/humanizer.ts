import { Agent } from "@earendil-works/pi-agent-core";
import { modelRegistry, resolveActiveModel } from "../llm/registry.js";
import { moduleLogger } from "../logger.js";
import { runPrompt } from "./run.js";

const log = moduleLogger("humanizer");

/**
 * Copy-edit pass for outgoing email draft bodies. Runs as a one-shot,
 * tool-less LLM call (same pattern as delegate.ts) right before a draft is
 * saved, in buildDraftTool's execute (pipedream/mcp.ts) — so every surface
 * that creates a draft (chat, automations) gets the same
 * de-AI-ification, not just the ones the main agent's own system prompt
 * happens to steer well.
 */

const SYSTEM_PROMPT = `You are a copy editor for outgoing email drafts. Rewrite the body ONLY as
far as needed to remove AI-tell writing; if the draft already reads like a person wrote it, return
it VERBATIM.

Preserve exactly: the language it is written in (German stays German), the meaning, every fact,
name, number, date and URL, the greeting and sign-off, the paragraph structure, and roughly the
length (never pad it out).

Remove or fix:
- Filler openers and closers ("I hope this email finds you well", "I wanted to reach out", "Let me
  know if you have any questions" used as a hollow closer).
- Sycophancy ("Great question", "Thanks so much for reaching out" when it isn't earned).
- LLM vocabulary: delve, leverage, utilize, foster, seamless, robust, streamline, underscore,
  testament, navigate, boasts, vibrant, "stands/serves as" (just say "is" or "has").
- Em and en dashes — use a comma, period, colon, or parentheses instead.
- Forced groups of three, and "not just X but Y" parallelisms.
- "-ing" tails that fake depth ("...ensuring...", "...highlighting...").
- Over-hedging, false ranges, synonym-cycling the same noun, bolded inline-header lists, and
  generic upbeat closers.

Output ONLY the rewritten body text: no commentary, no code fences, no subject line.`;

export interface HumanizeDraftBodyInput {
  body: string;
  subject?: string;
}

export interface HumanizeDraftBodyResult {
  body: string;
  changed: boolean;
}

/** Strips a wrapping ``` fence if the model added one despite being told not to. */
function stripCodeFence(text: string): string {
  const match = text.match(/^```[^\n]*\n([\s\S]*)\n```$/);
  return match ? (match[1] ?? "").trim() : text;
}

/**
 * Copy-edits one draft body to remove AI-tell writing, or returns it
 * unchanged if it already reads naturally. Fails open: any error, or an
 * empty model result, falls back to the original body untouched.
 */
export async function humanizeDraftBody(
  input: HumanizeDraftBodyInput,
): Promise<HumanizeDraftBodyResult> {
  const original = input.body;
  const trimmedOriginal = original.trim();
  if (!trimmedOriginal) {
    return { body: original, changed: false };
  }

  try {
    const model = await resolveActiveModel();
    const agent = new Agent({
      initialState: { systemPrompt: SYSTEM_PROMPT, model, tools: [] },
      streamFn: (m, c, o) => modelRegistry.streamSimple(m, c, o),
    });
    const userMessage = input.subject ? `Subject: ${input.subject}\n\n${original}` : original;
    const raw = await runPrompt({ agent }, userMessage);
    const rewritten = stripCodeFence(raw.trim());

    if (!rewritten) {
      log.warn("model returned an empty result, keeping original body");
      return { body: original, changed: false };
    }

    return { body: rewritten, changed: rewritten !== trimmedOriginal };
  } catch (error) {
    log.warn({ err: error }, "failed, keeping original body");
    return { body: original, changed: false };
  }
}
