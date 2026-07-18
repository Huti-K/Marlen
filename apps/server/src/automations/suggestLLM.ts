import type { Api, Model } from "@earendil-works/pi-ai";
import { type ReportToolSpec, runReportPrompt } from "../agent/oneShot.js";
import { prompts } from "../prompts.js";

/**
 * The suggestion sweep's LLM call (suggestService.ts): the user's recent
 * chat requests go in, 0-3 proposed automations come out via the report-tool
 * one-shot (agent/oneShot.ts, runReportPrompt). The caller validates each
 * proposal's cron before storing it; this module only shapes and captures
 * the model's output.
 */

export interface SuggestedAutomation {
  name: string;
  instruction: string;
  schedule: string;
  rationale: string;
}

/** Most proposals one report may carry; anything beyond is dropped in order. */
const MAX_SUGGESTIONS = 3;

function asSuggestion(entry: unknown): SuggestedAutomation | null {
  if (typeof entry !== "object" || entry === null) return null;
  const { name, instruction, schedule, rationale } = entry as Record<string, unknown>;
  if (
    typeof name !== "string" ||
    typeof instruction !== "string" ||
    typeof schedule !== "string" ||
    typeof rationale !== "string"
  ) {
    return null;
  }
  const trimmed = {
    name: name.trim(),
    instruction: instruction.trim(),
    schedule: schedule.trim(),
    rationale: rationale.trim(),
  };
  if (!trimmed.name || !trimmed.instruction || !trimmed.schedule || !trimmed.rationale) return null;
  return trimmed;
}

const reportSuggestionsTool: ReportToolSpec<SuggestedAutomation[]> = {
  name: "report_suggestions",
  label: "Report automation suggestions",
  description: "Record the proposed automations. Call exactly once.",
  parameters: {
    type: "object",
    properties: {
      suggestions: {
        type: "array",
        description: `0-${MAX_SUGGESTIONS} proposed automations. Empty when no request pattern recurs.`,
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Short display name for the automation." },
            instruction: {
              type: "string",
              description: "Complete, self-contained instruction the unattended run will execute.",
            },
            schedule: {
              type: "string",
              description: "Five-field cron expression in the user's timezone.",
            },
            rationale: {
              type: "string",
              description: "One or two sentences to the user naming the recurring pattern seen.",
            },
          },
          required: ["name", "instruction", "schedule", "rationale"],
        },
      },
    },
    required: ["suggestions"],
  },
  narrow: (params) => {
    const raw = (params as Record<string, unknown>).suggestions;
    return Array.isArray(raw)
      ? raw
          .map(asSuggestion)
          .filter((entry): entry is SuggestedAutomation => entry !== null)
          .slice(0, MAX_SUGGESTIONS)
      : [];
  },
};

/** Hard cap on one suggestion call — a stuck provider can't wedge the nightly sweep. */
const SUGGEST_TIMEOUT_MS = 90_000;

/**
 * Propose automations from the rendered sweep input (suggestService.ts builds
 * it). Throws when the model never produced a usable report (including on
 * timeout) — the caller leaves the sweep unstamped so it retries later rather
 * than silently skipping a night.
 */
export async function proposeAutomations(
  prompt: string,
  model: Model<Api>,
  timeoutMs = SUGGEST_TIMEOUT_MS,
): Promise<SuggestedAutomation[]> {
  return runReportPrompt({
    systemPrompt: prompts.automationSuggest,
    tool: reportSuggestionsTool,
    prompt,
    model,
    timeoutMs,
  });
}
