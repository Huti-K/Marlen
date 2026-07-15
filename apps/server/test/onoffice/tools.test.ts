import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * loadOnOfficeTools resolves one client (config.getOnOfficeClient) and wraps
 * the CRM actions as validated AgentTools. Stub the client at the config
 * boundary so these tests cover the gating policy and the toolkit validation
 * path without any network.
 */

/** The text of a tool result's first content block (every onOffice tool returns one). */
function firstText(result: AgentToolResult<unknown>): string {
  const block = result.content[0];
  if (block?.type !== "text") throw new Error("expected a text result block");
  return block.text;
}
const actionMock = vi.fn();
const callMock = vi.fn();
const getClientMock = vi.fn<() => Promise<unknown>>();

vi.mock("../../src/onoffice/config.js", () => ({
  getOnOfficeClient: () => getClientMock(),
}));

const { loadOnOfficeTools } = await import("../../src/onoffice/tools.js");

const fakeClient = { action: actionMock, call: callMock };

beforeEach(() => {
  actionMock.mockReset();
  callMock.mockReset();
  getClientMock.mockReset();
  getClientMock.mockResolvedValue(fakeClient);
});

describe("loadOnOfficeTools — gating", () => {
  it("returns nothing when no credentials are configured", async () => {
    getClientMock.mockResolvedValue(null);
    expect(await loadOnOfficeTools()).toEqual([]);
  });

  it("exposes the read + write surface by default", async () => {
    const names = (await loadOnOfficeTools()).map((t) => t.name);
    expect(names).toContain("onoffice_read");
    expect(names).toContain("onoffice_get_fields");
    expect(names).toContain("onoffice_modify");
    expect(names).toContain("onoffice_delete");
    expect(names).toContain("onoffice_send_email");
    expect(names).toContain("onoffice_create_appointment");
  });

  it("withholds every mutating tool when writes are disallowed", async () => {
    const names = (await loadOnOfficeTools({ allowWrites: false })).map((t) => t.name);
    // Reads stay.
    expect(names).toContain("onoffice_read");
    expect(names).toContain("onoffice_read_estates");
    expect(names).toContain("onoffice_get");
    // Nothing that writes to or sends from the CRM.
    for (const write of [
      "onoffice_create",
      "onoffice_modify",
      "onoffice_delete",
      "onoffice_do",
      "onoffice_raw_request",
      "onoffice_send_email",
      "onoffice_create_address",
      "onoffice_create_relation",
      "onoffice_create_appointment",
      "onoffice_create_task",
    ]) {
      expect(names).not.toContain(write);
    }
  });
});

describe("loadOnOfficeTools — execution", () => {
  it("routes onoffice_read through client.action and renders the results", async () => {
    actionMock.mockResolvedValue({ response: { results: [{ resourceid: "42" }] } });
    const tools = await loadOnOfficeTools();
    const read = tools.find((t) => t.name === "onoffice_read");
    if (!read) throw new Error("onoffice_read missing");

    const result = await read.execute("call-1", { resourcetype: "estate" }, undefined);

    expect(actionMock).toHaveBeenCalledWith(
      "read",
      "estate",
      expect.objectContaining({ parameters: expect.any(Object) }),
      undefined,
    );
    expect(firstText(result)).toContain("42");
  });

  it("rejects parameters that miss a required field", async () => {
    const tools = await loadOnOfficeTools();
    const read = tools.find((t) => t.name === "onoffice_read");
    if (!read) throw new Error("onoffice_read missing");

    const result = await read.execute("call-1", {}, undefined);
    expect(firstText(result)).toMatch(/Invalid onoffice_read parameters/);
    expect(actionMock).not.toHaveBeenCalled();
  });

  it("returns an onOffice failure as steering text rather than throwing", async () => {
    actionMock.mockRejectedValue(new Error("onOffice action error: [3] no such field"));
    const tools = await loadOnOfficeTools();
    const read = tools.find((t) => t.name === "onoffice_read");
    if (!read) throw new Error("onoffice_read missing");

    const result = await read.execute("call-1", { resourcetype: "estate" }, undefined);
    expect(firstText(result)).toContain("no such field");
  });
});
