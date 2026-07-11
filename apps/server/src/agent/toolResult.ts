import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AgentCard } from "@trailin/shared";

/** The plain-text AgentTool result every local tool returns. */
export function textResult(value: string, card?: AgentCard) {
  return {
    content: [{ type: "text" as const, text: value }],
    details: card,
  };
}

/**
 * Identity helper for declaring a tool literal. pi's `AgentTool["parameters"]`
 * is typed as its typebox `TSchema`, an empty interface any JSON Schema
 * object already satisfies structurally — so a tool literal passed through
 * this function's `AgentTool` parameter type needs no `as AgentTool["parameters"]`
 * cast on its `parameters` block; it's inferred from context like any other
 * typed literal.
 */
export function defineTool(tool: AgentTool): AgentTool {
  return tool;
}
