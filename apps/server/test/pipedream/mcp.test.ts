import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { ConnectedAccount } from "@trailin/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * loadEmailTools opens one Pipedream MCP session per account
 * (pipedream/mcp.ts's connectForAccount: a StreamableHTTPClientTransport plus
 * an MCP Client). Fake both at the SDK boundary instead of a real HTTP
 * handshake — the fake client keys its listTools() response off the
 * x-pd-account-id header the real transport carries, so each connected
 * account gets its own fixed tool list no matter what order Promise.all
 * resolves the per-account connects in.
 */
const toolsByAccountId = new Map<
  string,
  { name: string; description?: string; inputSchema: { type: "object"; properties: object } }[]
>();
let connectCallCount = 0;
const closedAccountIds: string[] = [];
// Scriptable per-test callTool behavior; null falls back to a plain success.
let callToolImpl:
  | ((accountId: string, name: string) => Promise<{ content: unknown[]; isError: boolean }>)
  | null = null;
let callToolCount = 0;

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@modelcontextprotocol/sdk/client/streamableHttp.js")>();
  return {
    // Spread keeps StreamableHTTPError real — mcp.ts's transport-error
    // classifier does instanceof checks against it.
    ...actual,
    // A plain `function`, not an arrow: connectForAccount calls this with
    // `new`, and only a real function (or class) lets the returned object
    // override the constructed `this` the way vi.fn()'s own default doesn't.
    // biome-ignore lint/complexity/useArrowFunction: must stay a real function so `new` works (see above)
    StreamableHTTPClientTransport: vi.fn(function (
      _url: URL,
      opts: { requestInit?: { headers?: Record<string, string> } },
    ) {
      return { accountId: opts?.requestInit?.headers?.["x-pd-account-id"] ?? "" };
    }),
  };
});

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => {
  class FakeMcpClient {
    private accountId = "";
    async connect(transport: { accountId?: string }): Promise<void> {
      connectCallCount++;
      this.accountId = transport.accountId ?? "";
    }
    async listTools() {
      return { tools: toolsByAccountId.get(this.accountId) ?? [] };
    }
    async close(): Promise<void> {
      closedAccountIds.push(this.accountId);
    }
    async callTool(params: { name: string }) {
      callToolCount++;
      if (callToolImpl) return callToolImpl(this.accountId, params.name);
      return { content: [], isError: false };
    }
  }
  return { Client: FakeMcpClient };
});

// listAccounts/getConnectConfig/getPipedreamAccessToken are stubbed the same
// way test/agent/accounts.test.ts stubs them — spread the real module so the
// gmail/outlook draft and attachment providers pulled in transitively still
// resolve. proxyRequest is stubbed too, so the create-draft tool tests below
// can serve the provider's Gmail round-trips.
const listAccountsMock = vi.fn<() => Promise<ConnectedAccount[]>>();
const proxyRequestMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock("../../src/pipedream/connect.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/pipedream/connect.js")>();
  return {
    ...actual,
    getConnectConfig: async () => ({
      clientId: "client-id",
      clientSecret: "client-secret",
      projectId: "proj_test",
      environment: "development" as const,
      externalUserId: "user-1",
      source: "settings" as const,
    }),
    getPipedreamAccessToken: async () => "fake-token",
    listAccounts: () => listAccountsMock(),
    proxyRequest: (...args: unknown[]) => proxyRequestMock(...args),
  };
});

const writeAccessMock = vi.fn<() => Promise<string[]>>();
vi.mock("../../src/db/settings.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/db/settings.js")>();
  return {
    ...actual,
    getWriteAccessAccounts: () => writeAccessMock(),
  };
});

// The create-draft tool's collaborators, faked so executing the tool touches
// neither the database nor a humanizer model call: composition passes the
// body through unchanged, snapshots are no-ops, and the library attachment
// resolver is scripted per test.
const resolveLibraryAttachmentsMock =
  vi.fn<(ids: string[]) => Promise<import("../../src/email/providers.js").DraftAttachment[]>>();
vi.mock("../../src/library/draftAttachments.js", () => ({
  resolveLibraryAttachments: (ids: string[]) => resolveLibraryAttachmentsMock(ids),
}));
vi.mock("../../src/agent/composition.js", () => ({
  composeDraftBody: async (_accountId: string, input: { body: string }) => ({
    body: input.body,
    humanized: false,
    signatureAppended: false,
    signature: null,
  }),
}));
vi.mock("../../src/db/draftStore.js", () => ({
  createDraftSnapshot: async () => {},
  appendDraftVersion: async () => {},
  getDraftCardDetails: async () => null,
}));

const { loadEmailTools } = await import("../../src/pipedream/mcp.js");
const { isMcpTimeoutError, isMcpTransportError } = await import(
  "../../src/pipedream/mcpSession.js"
);

function account(id: string, app: string, name: string): ConnectedAccount {
  return { id, app, appName: app, name, healthy: true, createdAt: "2026-01-01" };
}

function tool(name: string) {
  return { name, description: name, inputSchema: { type: "object" as const, properties: {} } };
}

beforeEach(() => {
  toolsByAccountId.clear();
  closedAccountIds.length = 0;
  connectCallCount = 0;
  callToolImpl = null;
  callToolCount = 0;
  listAccountsMock.mockReset();
  writeAccessMock.mockReset();
  proxyRequestMock.mockReset();
  resolveLibraryAttachmentsMock.mockReset();
});

describe("loadEmailTools — read/write registration policy", () => {
  it("registers reads and writes for a write-armed account, excluding download verbs", async () => {
    const acc = account("acc-slack", "slack", "workspace");
    listAccountsMock.mockResolvedValue([acc]);
    writeAccessMock.mockResolvedValue([acc.id]);
    toolsByAccountId.set(acc.id, [
      tool("slack-find-message"),
      tool("slack-send-message"),
      tool("slack-create-draft"),
      tool("slack-download-file"),
    ]);

    const { tools, readTools, close } = await loadEmailTools();
    const names = tools.map((t) => t.name);
    await close();

    expect(names).toContain("slack-find-message");
    expect(names).toContain("slack-send-message");
    expect(names).toContain("slack-create-draft");
    expect(names).not.toContain("slack-download-file");
    expect(readTools.map((t) => t.name)).toEqual(["slack-find-message"]);
  });

  it("registers reads for a read-only account while withholding writes", async () => {
    const acc = account("acc-slack-ro", "slack", "workspace");
    listAccountsMock.mockResolvedValue([acc]);
    writeAccessMock.mockResolvedValue([]);
    toolsByAccountId.set(acc.id, [
      tool("slack-find-message"),
      tool("slack-list-channels"),
      tool("slack-send-message"),
    ]);

    const { tools, readTools, close } = await loadEmailTools();
    const names = tools.map((t) => t.name);
    await close();

    expect(names).toContain("slack-find-message");
    expect(names).toContain("slack-list-channels");
    expect(names).not.toContain("slack-send-message");
    expect(readTools).toHaveLength(2);
  });

  it("keeps reads and drafts but no writes when providerWrites is false, even for a write-armed account", async () => {
    const acc = account("acc-slack-pw", "slack", "workspace");
    listAccountsMock.mockResolvedValue([acc]);
    // Same DB state as the armed test above — providerWrites: false must
    // override Settings → Permissions for this run regardless.
    writeAccessMock.mockResolvedValue([acc.id]);
    toolsByAccountId.set(acc.id, [
      tool("slack-find-message"),
      tool("slack-send-message"),
      tool("slack-create-draft"),
    ]);

    const { tools, readTools, close } = await loadEmailTools({ providerWrites: false });
    const names = tools.map((t) => t.name);
    await close();

    expect(names).toContain("slack-find-message");
    expect(names).toContain("slack-create-draft");
    expect(names).not.toContain("slack-send-message");
    expect(readTools.map((t) => t.name)).toEqual(["slack-find-message"]);
  });

  it("opens an MCP session even for a read-only account with a DraftProvider — its reads live there", async () => {
    const acc = account("acc-gmail", "gmail", "kadim@gmail.com");
    listAccountsMock.mockResolvedValue([acc]);
    writeAccessMock.mockResolvedValue([acc.id]);
    toolsByAccountId.set(acc.id, [tool("gmail-find-email"), tool("gmail-send-email")]);

    const { tools, close } = await loadEmailTools({ providerWrites: false });
    const names = tools.map((t) => t.name);
    await close();

    expect(connectCallCount).toBe(1);
    expect(closedAccountIds).toHaveLength(1);
    expect(names).toContain("gmail-find-email");
    expect(names).not.toContain("gmail-send-email");
    // Local (non-MCP) tools ride along: Trailin's own draft tool supersedes
    // Pipedream's create-draft for apps with a DraftProvider.
    expect(names).toContain("gmail-create-draft");
    expect(names).toContain("gmail-save-attachment");
  });

  it("suffixes tool names per account when two accounts share an app", async () => {
    const work = account("acc-work", "gmail", "work@gmail.com");
    const personal = account("acc-personal", "gmail", "personal@gmail.com");
    listAccountsMock.mockResolvedValue([work, personal]);
    writeAccessMock.mockResolvedValue([]);
    toolsByAccountId.set(work.id, [tool("gmail-find-email")]);
    toolsByAccountId.set(personal.id, [tool("gmail-find-email")]);

    const { readTools, close } = await loadEmailTools();
    await close();

    expect(readTools.map((t) => t.name).sort()).toEqual([
      "gmail-find-email__personal",
      "gmail-find-email__work",
    ]);
  });
});

describe("loadEmailTools — session revival and call bounds", () => {
  async function loadOneReadTool() {
    const acc = account("acc-heal", "slack", "workspace");
    listAccountsMock.mockResolvedValue([acc]);
    writeAccessMock.mockResolvedValue([]);
    toolsByAccountId.set(acc.id, [tool("slack-find-message")]);
    const toolset = await loadEmailTools();
    const read = toolset.tools.find((t) => t.name === "slack-find-message");
    expect(read).toBeDefined();
    return { toolset, read };
  }

  it("reconnects and replays a read call after a transport failure", async () => {
    const { toolset, read } = await loadOneReadTool();
    let calls = 0;
    callToolImpl = async () => {
      calls++;
      if (calls === 1) throw new McpError(ErrorCode.ConnectionClosed, "Connection closed");
      return { content: [{ type: "text", text: "found it" }], isError: false };
    };

    const result = await read?.execute("call-1", {}, undefined, undefined);

    expect(result?.content).toEqual([{ type: "text", text: "found it" }]);
    expect(calls).toBe(2);
    // Initial connect plus the revival connect.
    expect(connectCallCount).toBe(2);
    await toolset.close();
  });

  it("never replays a write across a transport failure — it reports uncertainty instead", async () => {
    const acc = account("acc-heal-w", "slack", "workspace");
    listAccountsMock.mockResolvedValue([acc]);
    writeAccessMock.mockResolvedValue([acc.id]);
    toolsByAccountId.set(acc.id, [tool("slack-send-message")]);
    callToolImpl = async () => {
      throw new McpError(ErrorCode.ConnectionClosed, "Connection closed");
    };

    const { tools, close } = await loadEmailTools();
    const send = tools.find((t) => t.name === "slack-send-message");
    expect(send).toBeDefined();

    await expect(send?.execute("call-1", {}, undefined, undefined)).rejects.toThrow(
      /may or may not have taken effect/,
    );
    expect(callToolCount).toBe(1);
    await close();
  });

  it("turns a request timeout into narrow-the-query guidance without reconnecting", async () => {
    const { toolset, read } = await loadOneReadTool();
    callToolImpl = async () => {
      throw new McpError(ErrorCode.RequestTimeout, "Request timed out");
    };

    await expect(read?.execute("call-1", {}, undefined, undefined)).rejects.toThrow(
      /narrower query/,
    );
    expect(connectCallCount).toBe(1);
    await toolset.close();
  });

  it("does not resurrect connections after the toolset is closed", async () => {
    const { toolset, read } = await loadOneReadTool();
    await toolset.close();
    callToolImpl = async () => {
      throw new McpError(ErrorCode.ConnectionClosed, "Connection closed");
    };

    await expect(read?.execute("call-1", {}, undefined, undefined)).rejects.toThrow(
      /Connection closed/,
    );
    expect(connectCallCount).toBe(1);
  });
});

describe("MCP error classification", () => {
  it("classifies timeouts apart from transport faults", () => {
    expect(isMcpTimeoutError(new McpError(ErrorCode.RequestTimeout, "x"))).toBe(true);
    expect(isMcpTimeoutError(new Error("timed out"))).toBe(false);
    expect(isMcpTransportError(new McpError(ErrorCode.RequestTimeout, "x"))).toBe(false);
  });

  it("treats dropped connections, discarded sessions, and server failures as healable", () => {
    expect(isMcpTransportError(new McpError(ErrorCode.ConnectionClosed, "x"))).toBe(true);
    expect(isMcpTransportError(new StreamableHTTPError(404, "session gone"))).toBe(true);
    expect(isMcpTransportError(new StreamableHTTPError(502, "bad gateway"))).toBe(true);
    expect(isMcpTransportError(new StreamableHTTPError(undefined, "no response"))).toBe(true);
    expect(isMcpTransportError(new Error("fetch failed"))).toBe(true);
  });

  it("passes auth rejections and tool-level errors through unhealed", () => {
    expect(isMcpTransportError(new StreamableHTTPError(401, "unauthorized"))).toBe(false);
    expect(isMcpTransportError(new StreamableHTTPError(403, "forbidden"))).toBe(false);
    expect(isMcpTransportError(new Error("No matching thread found"))).toBe(false);
    expect(isMcpTransportError("not even an error")).toBe(false);
  });
});

describe("create-draft tool — library attachments", () => {
  async function loadCreateDraftTool() {
    const acc = account("acc-gmail-att", "gmail", "kadim@gmail.com");
    listAccountsMock.mockResolvedValue([acc]);
    writeAccessMock.mockResolvedValue([]);
    toolsByAccountId.set(acc.id, []);
    const toolset = await loadEmailTools();
    const create = toolset.tools.find((t) => t.name === "gmail-create-draft");
    expect(create).toBeDefined();
    return { toolset, create };
  }

  it("declares attachLibraryDocumentIds in the tool schema and description", async () => {
    const { toolset, create } = await loadCreateDraftTool();
    await toolset.close();

    const parameters = create?.parameters as { properties?: Record<string, unknown> } | undefined;
    expect(parameters?.properties?.attachLibraryDocumentIds).toMatchObject({
      type: "array",
      items: { type: "string" },
    });
    expect(create?.description).toContain("attachLibraryDocumentIds");
  });

  it("returns the resolver's steering text without creating a draft when an id is bad", async () => {
    const { toolset, create } = await loadCreateDraftTool();
    resolveLibraryAttachmentsMock.mockRejectedValue(
      new Error('No library document with id "nope" — use library_list.'),
    );

    const result = await create?.execute(
      "call-1",
      { to: ["a@example.com"], subject: "S", body: "B", attachLibraryDocumentIds: ["nope"] },
      undefined,
      undefined,
    );
    await toolset.close();

    expect(result?.content).toEqual([
      { type: "text", text: 'No library document with id "nope" — use library_list.' },
    ]);
    // The draft was never created: no provider round-trip at all.
    expect(proxyRequestMock).not.toHaveBeenCalled();
  });

  it("passes resolved attachments to the provider and reports them in text and card", async () => {
    const { toolset, create } = await loadCreateDraftTool();
    resolveLibraryAttachmentsMock.mockResolvedValue([
      { filename: "expose.pdf", mimeType: "application/pdf", content: Buffer.from("PDF") },
    ]);
    proxyRequestMock.mockResolvedValue({
      id: "draft-1",
      message: { id: "m1", threadId: "t1" },
    });

    const result = await create?.execute(
      "call-1",
      { to: ["a@example.com"], subject: "S", body: "B", attachLibraryDocumentIds: ["d-pdf"] },
      undefined,
      undefined,
    );
    await toolset.close();

    expect(resolveLibraryAttachmentsMock).toHaveBeenCalledWith(["d-pdf"]);
    const content = result?.content as { type: string; text: string }[] | undefined;
    expect(content?.[0]?.text).toContain("Attached: expose.pdf (3 B).");

    // The provider received the attachment: the raw Gmail message is multipart
    // and carries the file.
    const postCall = proxyRequestMock.mock.calls.find(
      (call) => call[1] === "post" && String(call[2]).includes("/drafts"),
    );
    expect(postCall).toBeDefined();
    const opts = postCall?.[3] as { body: { message: { raw: string } } } | undefined;
    const decoded = Buffer.from(opts?.body.message.raw ?? "", "base64url").toString("utf8");
    expect(decoded).toContain("multipart/mixed");
    expect(decoded).toContain('name="expose.pdf"');

    // The card lists the attachment for the human's pre-send review.
    const card = result?.details as
      | { draft?: { attachments?: { filename: string; size?: number }[] } }
      | undefined;
    expect(card?.draft?.attachments).toEqual([{ filename: "expose.pdf", size: 3 }]);
  });
});
