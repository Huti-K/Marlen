import { Agent, type AgentTool, type StreamFn } from "@earendil-works/pi-agent-core";
import { modelRegistry, resolveActiveModel } from "../llm/registry.js";
import { runPrompt } from "./run.js";

/**
 * Routes an Agent's model calls through the registry so stored credentials
 * apply (subscription OAuth with auto-refresh, saved API keys, then env
 * vars). Shared by runOneShot below and emailAgent.ts's persistent session,
 * which builds its Agent directly rather than through runOneShot.
 */
export const streamViaModelRegistry: StreamFn = (model, context, options) =>
  modelRegistry.streamSimple(model, context, options);

/**
 * Runs one prompt through a fresh, throwaway Agent and returns its final
 * text — the shape every one-shot sub-agent call in this app shares (the
 * draft humanizer, compaction's summarizer, delegate's parallel workers,
 * voice learning): build an Agent scoped to one system prompt and toolset,
 * run exactly one prompt through it, and discard it. Resolves the active
 * model itself on every call, since Settings can change it between calls.
 */
export async function runOneShot(opts: {
  systemPrompt: string;
  tools?: AgentTool[];
  prompt: string;
  signal?: AbortSignal;
}): Promise<string> {
  const model = await resolveActiveModel();
  const agent = new Agent({
    initialState: { systemPrompt: opts.systemPrompt, model, tools: opts.tools ?? [] },
    streamFn: streamViaModelRegistry,
  });
  return runPrompt({ agent }, opts.prompt, {}, opts.signal);
}
