import { moduleLogger } from "../logger.js";
import { prompts } from "../prompts.js";
import { runOneShot } from "./oneShot.js";

const log = moduleLogger("composition");

/**
 * Draft composition — everything between "the model wrote a body" and "the
 * provider saves a draft" lives here: the humanizer copy-edit (prompt text in
 * prompts/humanizer.md). One module so every surface that saves a draft
 * (chat, automations) composes identically.
 */

/** Strips a wrapping \`\`\` fence if the model added one despite being told not to. */
function stripCodeFence(text: string): string {
  const match = text.match(/^```[^\n]*\n([\s\S]*)\n```$/);
  return match ? (match[1] ?? "").trim() : text;
}

export interface ComposedDraftBody {
  body: string;
  /** The humanizer pass changed the text. */
  humanized: boolean;
}

/**
 * The full compose pipeline for a draft body: copy-edits it to remove AI-tell
 * writing, or returns it unchanged if it already reads naturally. Fails open:
 * any error, or an empty model result, falls back to the original body
 * untouched.
 */
export async function composeDraftBody(input: {
  body: string;
  subject?: string;
}): Promise<ComposedDraftBody> {
  const original = input.body;
  const trimmedOriginal = original.trim();
  if (!trimmedOriginal) {
    return { body: original, humanized: false };
  }

  try {
    const userMessage = input.subject ? `Subject: ${input.subject}\n\n${original}` : original;
    const raw = await runOneShot({ systemPrompt: prompts.humanizer, prompt: userMessage });
    const rewritten = stripCodeFence(raw.trim());

    if (!rewritten) {
      log.warn("humanizer returned an empty result, keeping original body");
      return { body: original, humanized: false };
    }

    return { body: rewritten, humanized: rewritten !== trimmedOriginal };
  } catch (error) {
    log.warn({ err: error }, "humanizer failed, keeping original body");
    return { body: original, humanized: false };
  }
}
