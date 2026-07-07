import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ConnectedAccount } from "@trailin/shared";
import { getEmailWriteSetting } from "../db/settings.js";
import {
  getConnectConfig,
  getPipedreamAccessToken,
  listAccounts,
  type ConnectConfig,
} from "./connect.js";
import { buildGmailDraftTool } from "./gmailDrafts.js";

const MCP_BASE_URL = "https://remote.mcp.pipedream.net/v3";

interface McpSession {
  client: McpClient;
  close: () => Promise<void>;
}

/**
 * Open an MCP session pinned to ONE connected account. "tools-only" mode
 * exposes tools with real structured parameters (no sub-agent indirection);
 * x-pd-account-id makes every tool act as exactly this account, which is what
 * lets several Gmail/Outlook accounts coexist in one agent.
 */
async function connectForAccount(
  account: ConnectedAccount,
  config: ConnectConfig,
  accessToken: string,
): Promise<McpSession> {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_BASE_URL), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "x-pd-project-id": config.projectId,
        "x-pd-environment": config.environment,
        "x-pd-external-user-id": config.externalUserId,
        "x-pd-app-slug": account.app,
        "x-pd-account-id": account.id,
        "x-pd-tool-mode": "tools-only",
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

/**
 * Read-only guard: unless the user allows changes, only tools that cannot
 * touch anything pass — reading/searching/downloading, plus explicit
 * draft-creation tools (they never dispatch mail). Everything else (send,
 * delete, label, move, update, …) is never registered, so the model cannot
 * call it even by accident.
 */
const SAFE_VERBS = /^(find|get|list|search|download|fetch|retrieve)(-|$)/;
const DRAFT_ONLY = /^create-draft(-|$)/;

function allowedInReadOnly(mcpToolName: string): boolean {
  // Strip the app-slug prefix: "gmail-find-email" -> "find-email".
  const action = mcpToolName.replace(/^[a-z0-9_]+-/, "");
  return SAFE_VERBS.test(action) || DRAFT_ONLY.test(action);
}

/** Short per-account tool-name suffix, e.g. "kadim" from kadim@gmail.com. */
function accountSlug(account: ConnectedAccount): string {
  const local = account.name.split("@")[0] ?? account.name;
  const slug = local.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24).toLowerCase();
  return slug || account.id.replace(/[^a-zA-Z0-9]/g, "").slice(-6);
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

/** Wrap every tool of one account's session as a pi AgentTool. */
async function bridgeAccountTools(
  session: McpSession,
  account: ConnectedAccount,
  needsSuffix: boolean,
  seenNames: Set<string>,
  allowWrite: boolean,
): Promise<AgentTool[]> {
  const tools: AgentTool[] = [];
  const { tools: mcpTools } = await session.client.listTools();
  const suffix = needsSuffix ? `__${accountSlug(account)}` : "";

  for (const mcpTool of mcpTools) {
    // Pipedream's Gmail draft component needs a paid workspace (File Stash);
    // Trailin registers its own proxy-based replacement under the same name.
    if (account.app === "gmail" && mcpTool.name === "gmail-create-draft") continue;
    if (!allowWrite && !allowedInReadOnly(mcpTool.name)) continue;
    let name = sanitizeToolName(`${mcpTool.name}${suffix}`);
    if (seenNames.has(name)) name = sanitizeToolName(`${mcpTool.name}__${account.id}`);
    if (seenNames.has(name)) continue;
    seenNames.add(name);

    tools.push({
      name,
      label: mcpTool.title ?? mcpTool.name,
      description: `${mcpTool.description ?? mcpTool.name}\n\nActs as the connected account: ${account.name}.`,
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
  return tools;
}

export interface EmailToolset {
  tools: AgentTool[];
  close: () => Promise<void>;
}

const EMPTY_TOOLSET: EmailToolset = { tools: [], close: async () => {} };

/**
 * Load the agent's email tools: one pinned MCP session per connected account.
 * With several accounts of the same app, tool names get an account suffix
 * (gmail-send-email__work vs gmail-send-email__personal). Accounts that fail
 * to connect are skipped — the agent works with what's left.
 */
export async function loadEmailTools(): Promise<EmailToolset> {
  const config = await getConnectConfig();
  if (!config) return EMPTY_TOOLSET;

  let accounts: ConnectedAccount[];
  let accessToken: string;
  let allowWrite: boolean;
  try {
    [accounts, accessToken, allowWrite] = await Promise.all([
      listAccounts(),
      getPipedreamAccessToken(),
      getEmailWriteSetting(),
    ]);
  } catch (error) {
    console.warn("[mcp] listing Pipedream accounts failed:", error);
    return EMPTY_TOOLSET;
  }
  if (accounts.length === 0) return EMPTY_TOOLSET;

  const perApp = new Map<string, number>();
  for (const account of accounts) perApp.set(account.app, (perApp.get(account.app) ?? 0) + 1);

  const sessions: McpSession[] = [];
  const tools: AgentTool[] = [];
  const seenNames = new Set<string>();

  for (const account of accounts) {
    let session: McpSession;
    try {
      session = await connectForAccount(account, config, accessToken);
    } catch (error) {
      console.warn(`[mcp] session failed for ${account.app} (${account.name}):`, error);
      continue;
    }
    sessions.push(session);
    const needsSuffix = (perApp.get(account.app) ?? 0) > 1;
    try {
      tools.push(
        ...(await bridgeAccountTools(session, account, needsSuffix, seenNames, allowWrite)),
      );
    } catch (error) {
      console.warn(`[mcp] listing tools failed for ${account.app} (${account.name}):`, error);
    }
    if (account.app === "gmail") {
      const suffix = needsSuffix ? `__${accountSlug(account)}` : "";
      const name = sanitizeToolName(`gmail-create-draft${suffix}`);
      if (!seenNames.has(name)) {
        seenNames.add(name);
        tools.push(buildGmailDraftTool(account, name));
      }
    }
  }

  return {
    tools,
    close: async () => {
      await Promise.all(sessions.map((s) => s.close()));
    },
  };
}
