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

function graphThreadMessage(
  id: string,
  opts: { date?: string; isDraft?: boolean; cc?: boolean; html?: boolean } = {},
) {
  return {
    id,
    subject: `subject ${id}`,
    from: { emailAddress: { name: "Ada", address: "ada@example.com" } },
    toRecipients: [{ emailAddress: { name: "Me", address: "me@contoso.com" } }],
    ...(opts.cc ? { ccRecipients: [{ emailAddress: { address: "bob@example.com" } }] } : {}),
    receivedDateTime: opts.date ?? "2026-07-02T10:00:00Z",
    body: opts.html
      ? { contentType: "html", content: "<p>hello <b>there</b></p>" }
      : { contentType: "text", content: `body of ${id}` },
    isDraft: opts.isDraft ?? false,
  };
}

describe("outlookReadProvider.getThread", () => {
  it("filters by conversationId (quotes doubled), culls drafts, oldest first", async () => {
    proxyRequestMock.mockResolvedValueOnce({
      value: [
        graphThreadMessage("m2", { date: "2026-07-03T10:00:00Z" }),
        graphThreadMessage("m1", { date: "2026-07-02T10:00:00Z", cc: true }),
        graphThreadMessage("d1", { date: "2026-07-04T10:00:00Z", isDraft: true }),
      ],
    });

    const thread = await outlookReadProvider.getThread?.(ACCOUNT, "c'1");

    const [, method, url, opts] = proxyRequestMock.mock.calls[0] ?? [];
    expect(method).toBe("get");
    expect(url).toContain("/messages");
    expect(opts?.params?.$filter).toBe("conversationId eq 'c''1'");
    expect(thread?.subject).toBe("subject m1");
    expect(thread?.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(thread?.messages[0]).toMatchObject({
      from: "Ada <ada@example.com>",
      to: ["Me <me@contoso.com>"],
      cc: ["bob@example.com"],
      body: "body of m1",
      date: "2026-07-02T10:00:00Z",
    });
    expect(thread?.messages[1]?.cc).toBeUndefined();
  });

  it("follows @odata.nextLink to gather the whole conversation", async () => {
    const nextLink = "https://graph.microsoft.com/v1.0/me/messages?$skip=1";
    proxyRequestMock
      .mockResolvedValueOnce({
        value: [graphThreadMessage("m1")],
        "@odata.nextLink": nextLink,
      })
      .mockResolvedValueOnce({ value: [graphThreadMessage("m2", { html: true })] });

    const thread = await outlookReadProvider.getThread?.(ACCOUNT, "c1");

    expect(proxyRequestMock.mock.calls[1]?.[2]).toBe(nextLink);
    expect(thread?.messages).toHaveLength(2);
    expect(thread?.messages[1]?.body).toBe("hello there");
  });

  it("returns null when the conversation matches nothing or only drafts", async () => {
    proxyRequestMock.mockResolvedValueOnce({ value: [] });
    await expect(outlookReadProvider.getThread?.(ACCOUNT, "c-empty")).resolves.toBeNull();

    proxyRequestMock.mockResolvedValueOnce({
      value: [graphThreadMessage("d1", { isDraft: true })],
    });
    await expect(outlookReadProvider.getThread?.(ACCOUNT, "c-draft")).resolves.toBeNull();
  });
});

describe("outlookReadProvider.newestInbound", () => {
  it("asks the inbox for the single newest message's id and date in one Graph call", async () => {
    proxyRequestMock.mockResolvedValueOnce({
      value: [{ id: "m7", receivedDateTime: "2026-07-16T09:30:00Z" }],
    });

    const newest = await outlookReadProvider.newestInbound(ACCOUNT, { knownId: "elsewhere" });

    expect(newest).toEqual({ id: "m7", date: "2026-07-16T09:30:00Z" });
    expect(proxyRequestMock).toHaveBeenCalledTimes(1);
    const [, method, url, opts] = proxyRequestMock.mock.calls[0] ?? [];
    expect(method).toBe("get");
    expect(url).toContain("mailFolders('inbox')/messages");
    expect(opts?.params).toEqual({
      $select: "id,receivedDateTime",
      $orderby: "receivedDateTime desc",
      $top: "1",
    });
  });

  it("returns null for an empty inbox", async () => {
    proxyRequestMock.mockResolvedValueOnce({ value: [] });
    await expect(outlookReadProvider.newestInbound(ACCOUNT)).resolves.toBeNull();
    expect(proxyRequestMock).toHaveBeenCalledTimes(1);
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
