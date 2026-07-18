import type { Api, Model } from "@earendil-works/pi-ai";
import { MEMORY_MAX_LENGTH } from "@trailin/shared";
import { type ReportToolSpec, runReportPrompt } from "../../agent/oneShot.js";
import { prompts } from "../../prompts.js";

/**
 * The nightly extraction LLM call (extractor.ts): one account's pending
 * draft-vs-sent pairs go in, an array of GENERAL style directives comes out
 * via the report-tool one-shot (agent/oneShot.ts, runReportPrompt).
 * Directives must never repeat content from any one pair (names, dates,
 * deals) — only transferable writing-style adjustments a future draft for
 * this account should follow, the same shape voiceLearn.ts's report_style
 * produces from sent mail alone.
 */

export interface ExtractionPair {
  draftBody: string;
  sentBody: string;
}

const reportLessonsTool: ReportToolSpec<string[]> = {
  name: "report_lessons",
  label: "Report style lessons",
  description: "Record the general style directives learned from these pairs. Call exactly once.",
  parameters: {
    type: "object",
    properties: {
      directives: {
        type: "array",
        items: { type: "string" },
        description:
          `0-6 general, content-free style directives (tone, greeting/sign-off habits, length, ` +
          `phrasing), each a single self-contained instruction another assistant could follow, ` +
          `under ${MEMORY_MAX_LENGTH} characters. Empty when no consistent pattern shows up.`,
      },
    },
    required: ["directives"],
  },
  narrow: (params) => {
    const raw = (params as Record<string, unknown>).directives;
    return Array.isArray(raw)
      ? raw
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.trim().slice(0, MEMORY_MAX_LENGTH))
          .filter(Boolean)
      : [];
  },
};

function renderPairs(pairs: ExtractionPair[], accountName: string): string {
  const blocks = pairs.map(
    (pair, index) =>
      `Pair ${index + 1}:\n\nDrafted:\n${pair.draftBody}\n\nActually sent:\n${pair.sentBody}`,
  );
  return [`Account: ${accountName}`, "", blocks.join("\n\n---\n\n")].join("\n");
}

/** Hard cap on one extraction call — a stuck provider can't wedge the nightly sweep. */
const EXTRACT_TIMEOUT_MS = 60_000;

/**
 * Extract style lessons from one account's pending pairs. Throws when the
 * model never produced a usable report (including on timeout) — the caller
 * (extractor.ts) leaves the pairs unstamped so they're retried the next
 * night rather than silently losing the comparison.
 */
export async function extractLessons(
  pairs: ExtractionPair[],
  accountName: string,
  model: Model<Api>,
  timeoutMs = EXTRACT_TIMEOUT_MS,
): Promise<string[]> {
  return runReportPrompt({
    systemPrompt: prompts.voiceExtract,
    tool: reportLessonsTool,
    prompt: renderPairs(pairs, accountName),
    model,
    timeoutMs,
  });
}
