import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { EmailApp } from "@trailin/shared";
import { env } from "../env.js";
import { getPipedreamAccessToken } from "./client.js";

const MCP_BASE_URL = "https://remote.mcp.pipedream.net/v3";

interface McpSession {
  client: McpClient;
  close: () => Promise<void>;
}

/** Open an MCP session against Pipedream's remote MCP server for one app. */
async function connectToApp(app: EmailApp): Promise<McpSession> {
  const accessToken = await getPipedreamAccessToken();
  const transport = new StreamableHTTPClientTransport(new URL(MCP_BASE_URL), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "x-pd-project-id": env.pipedream.projectId!,
        "x-pd-environment": env.pipedream.environment,
        "x-pd-external-user-id": env.pipedream.externalUserId,
        "x-pd-app-slug": app,
      },
    },
  });
  const client = new McpClient({ name: "trailin-email-agent", version: "0.1.0" });
  await client.connect(transport);
  return {
    client,
    close: async () => {
      await client.close().catch(() => {});
    },
  };
}

/** Tool names must satisfy the LLM providers' [a-zA-Z0-9_-]{1,128} constraint. */
function sanitizeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 128);
}

function mcpContentToText(content: unknown): string {
  if (!Array.isArray(content)) return JSON.stringify(content ?? "");
  return content
    .map((block) => {
      if (block && typeof block === "object" && "type" in block) {
        const b = block as { type: string; text?: string };
        if (b.type === "text" && typeof b.text === "string") return b.text;
      }
      return JSON.stringify(block);
    })
    .join("\n");
}

export interface EmailToolset {
  tools: AgentTool[];
  close: () => Promise<void>;
}

/**
 * Discover the tools Pipedream's MCP server exposes for the given apps and
 * wrap each one as a pi AgentTool. Apps that fail to connect are skipped
 * (e.g. no account linked yet) — the agent still works with what's left.
 */
export async function loadEmailTools(apps: readonly EmailApp[]): Promise<EmailToolset> {
  const sessions: McpSession[] = [];
  const tools: AgentTool[] = [];
  const seenNames = new Set<string>();

  for (const app of apps) {
    let session: McpSession;
    try {
      session = await connectToApp(app);
    } catch (error) {
      console.warn(`[mcp] could not connect for app "${app}":`, error);
      continue;
    }
    sessions.push(session);

    const { tools: mcpTools } = await session.client.listTools();
    for (const mcpTool of mcpTools) {
      let name = sanitizeToolName(mcpTool.name);
      if (seenNames.has(name)) name = sanitizeToolName(`${app}_${mcpTool.name}`);
      if (seenNames.has(name)) continue;
      seenNames.add(name);

      tools.push({
        name,
        label: mcpTool.title ?? mcpTool.name,
        description: mcpTool.description ?? mcpTool.name,
        // MCP input schemas are plain JSON Schema, which is exactly what
        // TypeBox schemas compile to — pass through as-is.
        parameters: mcpTool.inputSchema as AgentTool["parameters"],
        execute: async (_toolCallId, params, signal) => {
          const result = await session.client.callTool(
            { name: mcpTool.name, arguments: (params ?? {}) as Record<string, unknown> },
            undefined,
            { signal },
          );
          const text = mcpContentToText(result.content);
          if (result.isError) {
            throw new Error(text || `Tool ${mcpTool.name} failed`);
          }
          return { content: [{ type: "text", text }], details: undefined };
        },
      });
    }
  }

  return {
    tools,
    close: async () => {
      await Promise.all(sessions.map((s) => s.close()));
    },
  };
}
