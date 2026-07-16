import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import { streamViaModelRegistry } from "../agent/oneShot.js";
import { runPrompt } from "../agent/run.js";
import { defineTool } from "../agent/toolkit.js";

/**
 * The suggestion sweep's LLM call (suggestService.ts): the user's recent
 * chat requests go in, 0-3 proposed automations come out via the report-tool
 * pattern (email/learn/extractLLM.ts) — a one-shot ephemeral Agent whose
 * only tool is report_suggestions with terminate: true. The caller validates
 * each proposal's cron before storing it; this module only shapes and
 * captures the model's output.
 */

const SYSTEM_PROMPT = `You are an automation scout for Trailin, a personal email assistant. You are shown the
user's own requests to the assistant from recent chat conversations (with timestamps in the user's
timezone), the scheduled automations that already exist, and every suggestion already made. Find
RECURRING request patterns — the same kind of task the user keeps asking for manually (a daily inbox
check, a weekly status lookup, a recurring summary) — and propose automations for them. Call
report_suggestions EXACTLY ONCE.

Rules:
- Only propose a pattern backed by at least three similar requests. One-off tasks and merely related
  topics are not a pattern. When nothing recurs, report an empty list — never invent.
- Never duplicate an existing automation or an earlier suggestion, INCLUDING dismissed ones — a
  dismissed suggestion means the user already said no to that idea.
- schedule is a five-field cron expression in the user's timezone, matching when the user tends to
  make the request (their morning asks → a morning schedule).
- instruction must be fully self-contained: the run executes it with no memory of any conversation,
  so spell out what to do, over which accounts, and what to report. Unattended runs can read mail
  and create drafts but never send, reply, forward, label or delete — phrase actions accordingly.
- rationale is one or two sentences addressed to the user, naming the pattern you saw ("You asked
  for X on three mornings this week").`;

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

function buildSuggestionsReportTool(
  onReport: (suggestions: SuggestedAutomation[]) => void,
): AgentTool {
  return defineTool({
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
                description:
                  "Complete, self-contained instruction the unattended run will execute.",
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
    execute: async (_id, params) => {
      const raw = (params as Record<string, unknown>).suggestions;
      const suggestions = Array.isArray(raw)
        ? raw
            .map(asSuggestion)
            .filter((entry): entry is SuggestedAutomation => entry !== null)
            .slice(0, MAX_SUGGESTIONS)
        : [];
      onReport(suggestions);
      return {
        content: [{ type: "text", text: "Suggestions recorded." }],
        details: undefined,
        terminate: true,
      };
    },
  });
}

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
  let captured: SuggestedAutomation[] | undefined;
  const agent = new Agent({
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      model,
      tools: [buildSuggestionsReportTool((suggestions) => (captured = suggestions))],
    },
    streamFn: streamViaModelRegistry,
  });
  await runPrompt({ agent }, prompt, {}, AbortSignal.timeout(timeoutMs));
  if (!captured) throw new Error("model finished without calling report_suggestions");
  return captured;
}
