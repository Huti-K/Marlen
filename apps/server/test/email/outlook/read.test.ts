import { PipedreamError } from "@pipedream/sdk";
import type { ConnectedAccount } from "@trailin/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The provider drives every fetch through proxyRequest — stub it instead of
// hitting Pipedream's proxy for real.
const proxyRequestMock =
  vi.fn<
    (
      accountId: string,
      method: string,
      url: string,
      opts?: { params?: Record<string, string> },
    ) => Promise<unknown>
  >();
vi.mock("../../../src/pipedream/connect.js", () => ({
  proxyRequest: (...args: Parameters<typeof proxyRequestMock>) => proxyRequestMock(...args),
}));

const { outlookReadProvider } = await import("../../../src/email/outlook/read.js");

const ACCOUNT: ConnectedAccount = {
  id: "acct-1",
  app: "microsoft_outlook",
  appName: "Outlook",
  name: "me@contoso.com",
  healthy: true,
  createdAt: "2026-01-01",
};

function graphMessage(
  id: string,
  opts: { date?: string; html?: boolean; conversationId?: string } = {},
) {
  return {
    id,
    ...(opts.conversationId !== undefined ? { conversationId: opts.conversationId } : {}),
    subject: `subject ${id}`,
    toRecipients: [{ emailAddress: { name: "Ada", address: "ada@example.com" } }],
    sentDateTime: opts.date ?? "2026-07-02T10:00:00Z",
    body: opts.html
      ? { contentType: "html", content: "<p>hello <b>there</b></p>" }
      : { contentType: "text", content: `body of ${id}` },
  };
}

beforeEach(() => {
  proxyRequestMock.mockReset();
});

describe("outlookReadProvider.listSentSince", () => {
  it("filters sentitems by sentDateTime and maps recipients/threads", async () => {
    proxyRequestMock.mockResolvedValueOnce({
      value: [graphMessage("m1", { conversationId: "c1" })],
    });

    const since = "2026-07-01T00:00:00.000Z";
    const sent = await outlookReadProvider.listSentSince(ACCOUNT, since, { limit: 10 });

    const [, method, url, opts] = proxyRequestMock.mock.calls[0] ?? [];
    expect(method).toBe("get");
    expect(url).toContain("mailFolders('sentitems')/messages");
    expect(opts?.params).toMatchObject({
      $filter: `sentDateTime ge ${since}`,
      $orderby: "sentDateTime asc",
      $top: "10",
    });
    expect(sent[0]).toMatchObject({
      providerMessageId: "m1",
      providerThreadId: "c1",
      subject: "subject m1",
      to: ["Ada <ada@example.com>"],
      bodyText: "body of m1",
    });
  });

  it("follows @odata.nextLink verbatim and stops at the limit", async () => {
    const nextLink =
      "https://graph.microsoft.com/v1.0/me/mailFolders('sentitems')/messages?$skip=2";
    proxyRequestMock
      .mockResolvedValueOnce({
        value: [graphMessage("m1"), graphMessage("m2")],
        "@odata.nextLink": nextLink,
      })
      .mockResolvedValueOnce({ value: [graphMessage("m3"), graphMessage("m4")] });

    const sent = await outlookReadProvider.listSentSince(ACCOUNT, "2026-07-01T00:00:00Z", {
      limit: 3,
    });

    expect(proxyRequestMock.mock.calls[1]?.[2]).toBe(nextLink);
    expect(sent.map((m) => m.providerMessageId)).toEqual(["m1", "m2", "m3"]);
  });

  it("strips html bodies and falls back to the message id as thread id", async () => {
    proxyRequestMock.mockResolvedValueOnce({ value: [graphMessage("m1", { html: true })] });
    const sent = await outlookReadProvider.listSentSince(ACCOUNT, "2026-07-01T00:00:00Z");
    expect(sent[0]?.bodyText).toBe("hello there");
    expect(sent[0]?.providerThreadId).toBe("m1");
  });
});

describe("outlookReadProvider.getMessageBody", () => {
  it("returns the body text of one message", async () => {
    proxyRequestMock.mockResolvedValueOnce(graphMessage("m9"));
    await expect(outlookReadProvider.getMessageBody(ACCOUNT, "m9")).resolves.toBe("body of m9");
  });

  it("returns null when Graph 404s", async () => {
    proxyRequestMock.mockRejectedValueOnce(
      new PipedreamError({ message: "not found", statusCode: 404 }),
    );
    await expect(outlookReadProvider.getMessageBody(ACCOUNT, "gone")).resolves.toBeNull();
  });

  it("propagates non-404 failures", async () => {
    proxyRequestMock.mockRejectedValueOnce(
      new PipedreamError({ message: "throttled", statusCode: 429 }),
    );
    await expect(outlookReadProvider.getMessageBody(ACCOUNT, "m9")).rejects.toThrow("throttled");
  });
});
