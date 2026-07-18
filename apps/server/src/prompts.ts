import { readFileSync } from "node:fs";

/**
 * LLM prompt prose, loaded from the .md files in prompts/ — one file per
 * prompt, keyed below. Loaded eagerly at module init so a missing or renamed
 * file fails at startup, not mid-turn. The files are raw prompt text: every
 * character ships to the model, so they carry no comments or front matter.
 *
 * Paths resolve against import.meta.url: in dev and tests this module sits
 * beside prompts/ in src/; in the packaged desktop app the server bundles to
 * server/bundle.mjs and the build copies prompts/ next to it
 * (apps/desktop/scripts/build.mjs).
 */

function read(name: string): string {
  return readFileSync(new URL(`./prompts/${name}.md`, import.meta.url), "utf8").trim();
}

/**
 * The writing patterns that mark text as machine-written
 * (prompts/ai-writing-tells.md), spliced into both the system prompt (as
 * guidance while writing) and the humanizer prompt (as an edit checklist)
 * through their {{ai-writing-tells}} placeholder — extend that file, never
 * one prompt only.
 */
const aiWritingTells = read("ai-writing-tells");

function withTells(text: string): string {
  return text.replaceAll("{{ai-writing-tells}}", aiWritingTells);
}

export const prompts = {
  /** The email agent's base system prompt; buildSystemPrompt appends the conditional sections. */
  system: withTells(read("system")),
  /** The draft copy-editor pass (agent/composition.ts). */
  humanizer: withTells(read("humanizer")),
  /** The delegate tool's background research worker (agent/delegate.ts). */
  delegateWorker: read("delegate-worker"),
  /** The conversation-compaction summarizer (agent/compaction.ts). */
  compaction: read("compaction"),
  /** The automation-suggestion scout (automations/suggestLLM.ts). */
  automationSuggest: read("automation-suggest"),
  /** The draft-vs-sent style-lesson extractor (email/learn/extractLLM.ts). */
  voiceExtract: read("voice-extract"),
  /** The ambiguous-draft-match tiebreak (email/learn/matchLLM.ts). */
  voiceMatch: read("voice-match"),
} as const;
