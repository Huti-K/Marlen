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

const { gmailReadProvider } = await import("../../../src/email/gmail/read.js");

const ACCOUNT: ConnectedAccount = {
  id: "acct-1",
  app: "gmail",
  appName: "Gmail",
  name: "me@gmail.com",
  healthy: true,
  createdAt: "2026-01-01",
};

function b64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

function fullMessage(id: string, opts: { date: string; to?: string; body?: string }) {
  return {
    id,
    threadId: `t-${id}`,
    internalDate: String(Date.parse(opts.date)),
    payload: {
      mimeType: "text/plain",
      body: { data: b64(opts.body ?? `body of ${id}`) },
      headers: [
        { name: "Subject", value: `subject ${id}` },
        { name: "To", value: opts.to ?? "Ada <ada@example.com>" },
      ],
    },
  };
}

beforeEach(() => {
  proxyRequestMock.mockReset();
});

describe("gmailReadProvider.listSentSince", () => {
  it("queries in:sent with an epoch-seconds after: bound and maps full fetches, oldest first", async () => {
    const since = "2026-07-01T00:00:00.000Z";
    proxyRequestMock.mockImplementation(async (_acct, _method, url, opts) => {
      if (url.endsWith("/messages") && opts?.params?.q) {
        return { messages: [{ id: "m2" }, { id: "m1" }] };
      }
      if (url.endsWith("/messages/m1")) return fullMessage("m1", { date: "2026-07-02T10:00:00Z" });
      if (url.endsWith("/messages/m2")) return fullMessage("m2", { date: "2026-07-03T10:00:00Z" });
      throw new Error(`unexpected url ${url}`);
    });

    const sent = await gmailReadProvider.listSentSince(ACCOUNT, since, { limit: 10 });

    const listCall = proxyRequestMock.mock.calls.find(([, , url]) => url.endsWith("/messages"));
    expect(listCall?.[3]?.params).toEqual({
      q: `in:sent after:${Math.floor(Date.parse(since) / 1000)}`,
      maxResults: "10",
    });
    expect(sent.map((m) => m.providerMessageId)).toEqual(["m1", "m2"]);
    expect(sent[0]).toMatchObject({
      providerThreadId: "t-m1",
      subject: "subject m1",
      to: ["Ada <ada@example.com>"],
      bodyText: "body of m1",
      date: "2026-07-02T10:00:00.000Z",
    });
  });

  it("splits multi-recipient To headers before decoding", async () => {
    proxyRequestMock.mockImplementation(async (_acct, _method, url) => {
      if (url.endsWith("/messages")) return { messages: [{ id: "m1" }] };
      return fullMessage("m1", {
        date: "2026-07-02T10:00:00Z",
        to: "Ada <ada@example.com>, bob@example.com",
      });
    });

    const sent = await gmailReadProvider.listSentSince(ACCOUNT, "2026-07-01T00:00:00Z");
    expect(sent[0]?.to).toEqual(["Ada <ada@example.com>", "bob@example.com"]);
  });

  it("returns empty when nothing was sent in the window", async () => {
    proxyRequestMock.mockResolvedValueOnce({});
    const sent = await gmailReadProvider.listSentSince(ACCOUNT, "2026-07-01T00:00:00Z");
    expect(sent).toEqual([]);
    expect(proxyRequestMock).toHaveBeenCalledTimes(1);
  });
});

describe("gmailReadProvider.getMessageBody", () => {
  it("returns the plain-text body of a full fetch", async () => {
    proxyRequestMock.mockResolvedValueOnce(
      fullMessage("m9", { date: "2026-07-02T10:00:00Z", body: "hello there" }),
    );
    await expect(gmailReadProvider.getMessageBody(ACCOUNT, "m9")).resolves.toBe("hello there");
  });

  it("returns null when the message is gone (404)", async () => {
    proxyRequestMock.mockRejectedValueOnce(
      Object.assign(new Error("not found"), { statusCode: 404 }),
    );
    await expect(gmailReadProvider.getMessageBody(ACCOUNT, "gone")).resolves.toBeNull();
  });

  it("propagates non-404 failures", async () => {
    proxyRequestMock.mockRejectedValueOnce(Object.assign(new Error("boom"), { statusCode: 500 }));
    await expect(gmailReadProvider.getMessageBody(ACCOUNT, "m9")).rejects.toThrow("boom");
  });
});
