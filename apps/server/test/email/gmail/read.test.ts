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

function threadMessage(
  id: string,
  opts: { date: string; from?: string; cc?: string; body?: string; labelIds?: string[] },
) {
  return {
    id,
    internalDate: String(Date.parse(opts.date)),
    ...(opts.labelIds ? { labelIds: opts.labelIds } : {}),
    payload: {
      mimeType: "text/plain",
      body: { data: b64(opts.body ?? `body of ${id}`) },
      headers: [
        { name: "Subject", value: `subject ${id}` },
        { name: "From", value: opts.from ?? "Ada <ada@example.com>" },
        { name: "To", value: "me@gmail.com" },
        ...(opts.cc ? [{ name: "Cc", value: opts.cc }] : []),
      ],
    },
  };
}

describe("gmailReadProvider.getThread", () => {
  it("maps the conversation oldest-first and excludes unsent drafts", async () => {
    proxyRequestMock.mockResolvedValueOnce({
      messages: [
        threadMessage("m2", { date: "2026-07-03T10:00:00Z" }),
        threadMessage("m1", { date: "2026-07-02T10:00:00Z", cc: "Bob <bob@example.com>" }),
        threadMessage("d1", { date: "2026-07-04T10:00:00Z", labelIds: ["DRAFT"] }),
      ],
    });

    const thread = await gmailReadProvider.getThread?.(ACCOUNT, "t-1");

    const [, method, url, opts] = proxyRequestMock.mock.calls[0] ?? [];
    expect(method).toBe("get");
    expect(url).toContain("/threads/t-1");
    expect(opts?.params).toMatchObject({ format: "full" });
    expect(thread?.subject).toBe("subject m1");
    expect(thread?.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(thread?.messages[0]).toMatchObject({
      from: "Ada <ada@example.com>",
      to: ["me@gmail.com"],
      cc: ["Bob <bob@example.com>"],
      body: "body of m1",
      date: "2026-07-02T10:00:00.000Z",
    });
    expect(thread?.messages[1]?.cc).toBeUndefined();
  });

  it("returns null when the thread holds only the unsent draft", async () => {
    proxyRequestMock.mockResolvedValueOnce({
      messages: [threadMessage("d1", { date: "2026-07-04T10:00:00Z", labelIds: ["DRAFT"] })],
    });
    await expect(gmailReadProvider.getThread?.(ACCOUNT, "t-1")).resolves.toBeNull();
  });

  it("returns null when the thread is gone (404)", async () => {
    proxyRequestMock.mockRejectedValueOnce(
      Object.assign(new Error("not found"), { statusCode: 404 }),
    );
    await expect(gmailReadProvider.getThread?.(ACCOUNT, "gone")).resolves.toBeNull();
  });

  it("propagates non-404 failures", async () => {
    proxyRequestMock.mockRejectedValueOnce(Object.assign(new Error("boom"), { statusCode: 500 }));
    await expect(gmailReadProvider.getThread?.(ACCOUNT, "t-1")).rejects.toThrow("boom");
  });
});

describe("gmailReadProvider.newestInbound", () => {
  it("lists in:inbox with maxResults 1 and fetches the newest message's date minimally", async () => {
    proxyRequestMock.mockImplementation(async (_acct, _method, url, opts) => {
      if (url.endsWith("/messages") && opts?.params?.q === "in:inbox") {
        return { messages: [{ id: "m7" }] };
      }
      if (url.endsWith("/messages/m7")) {
        return {
          id: "m7",
          threadId: "t-m7",
          internalDate: String(Date.parse("2026-07-16T09:30:00Z")),
        };
      }
      throw new Error(`unexpected url ${url}`);
    });

    const newest = await gmailReadProvider.newestInbound(ACCOUNT, { knownId: "elsewhere" });

    expect(newest).toEqual({ id: "m7", date: "2026-07-16T09:30:00.000Z" });
    expect(proxyRequestMock).toHaveBeenCalledTimes(2);
    expect(proxyRequestMock.mock.calls[0]?.[3]?.params).toEqual({
      q: "in:inbox",
      maxResults: "1",
    });
    expect(proxyRequestMock.mock.calls[1]?.[2]).toContain("/messages/m7");
    expect(proxyRequestMock.mock.calls[1]?.[3]?.params).toEqual({ format: "minimal" });
  });

  it("short-circuits on knownId with a null date and no second call", async () => {
    proxyRequestMock.mockResolvedValueOnce({ messages: [{ id: "m7" }] });

    const newest = await gmailReadProvider.newestInbound(ACCOUNT, { knownId: "m7" });

    expect(newest).toEqual({ id: "m7", date: null });
    expect(proxyRequestMock).toHaveBeenCalledTimes(1);
  });

  it("returns null for an empty inbox", async () => {
    proxyRequestMock.mockResolvedValueOnce({});
    await expect(gmailReadProvider.newestInbound(ACCOUNT)).resolves.toBeNull();
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
