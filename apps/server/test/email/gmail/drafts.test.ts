import type { ConnectedAccount } from "@trailin/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DraftAttachment } from "../../../src/email/providers.js";

// gmailDraftProvider drives every fetch through proxyRequest — stub it the
// same way ../outlook/drafts.test.ts does, instead of hitting Pipedream's
// proxy for real.
const proxyRequestMock =
  vi.fn<
    (
      accountId: string,
      method: string,
      url: string,
      opts?: { params?: Record<string, string>; body?: unknown },
    ) => Promise<unknown>
  >();
vi.mock("../../../src/pipedream/connect.js", () => ({
  proxyRequest: (...args: Parameters<typeof proxyRequestMock>) => proxyRequestMock(...args),
}));

const { gmailDraftProvider } = await import("../../../src/email/gmail/drafts.js");

const account: ConnectedAccount = {
  id: "acct-1",
  app: "gmail",
  appName: "Gmail",
  name: "kadim@gmail.com",
  healthy: true,
  createdAt: "2026-01-01",
};

const CREATE_RESPONSE = { id: "draft-1", message: { id: "msg-1", threadId: "thread-1" } };

/** The `message.raw` sent to Gmail on the given call, decoded to the RFC822 text. */
function sentRaw(callIndex = 0): string {
  const call = proxyRequestMock.mock.calls.filter(
    ([, method, url]) => (method === "post" || method === "put") && url.includes("/drafts"),
  )[callIndex];
  expect(call).toBeDefined();
  const body = call?.[3]?.body as { message: { raw: string } };
  return Buffer.from(body.message.raw, "base64url").toString("utf8");
}

function attachment(filename: string, content: string, mimeType = "application/pdf") {
  return { filename, mimeType, content: Buffer.from(content, "utf8") } satisfies DraftAttachment;
}

/** Boundary declared by a multipart/mixed raw message. */
function boundaryOf(raw: string): string {
  const match = raw.match(/Content-Type: multipart\/mixed; boundary="([^"]+)"/);
  expect(match).not.toBeNull();
  return match?.[1] ?? "";
}

beforeEach(() => {
  proxyRequestMock.mockReset();
});

describe("createGmailDraft — raw message assembly", () => {
  it("keeps the single-part layout byte-identical when no attachments are passed", async () => {
    proxyRequestMock.mockResolvedValueOnce(CREATE_RESPONSE);

    await gmailDraftProvider.createDraft(account, {
      to: ["a@example.com"],
      cc: ["c@example.com"],
      subject: "Hello",
      body: "Hi there",
    });

    const expected = [
      "To: a@example.com",
      "Cc: c@example.com",
      `Subject: =?UTF-8?B?${Buffer.from("Hello", "utf8").toString("base64")}?=`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from("Hi there", "utf8").toString("base64"),
    ].join("\r\n");
    expect(sentRaw()).toBe(expected);
  });

  it("builds multipart/mixed with the text part first and round-tripping attachment bytes", async () => {
    proxyRequestMock.mockResolvedValueOnce(CREATE_RESPONSE);

    await gmailDraftProvider.createDraft(account, {
      to: ["a@example.com"],
      subject: "Files",
      body: "See attached",
      attachments: [
        attachment("Exposé.pdf", "PDFBYTES"),
        attachment("plan.txt", "TXT", "text/plain; charset=utf-8"),
      ],
    });

    const raw = sentRaw();
    const boundary = boundaryOf(raw);
    const [headers, ...parts] = raw.split(`--${boundary}`);

    // Recipients and subject stay top-level headers of the multipart message.
    expect(headers).toContain("To: a@example.com");
    expect(headers).toContain("MIME-Version: 1.0");

    // Text part first, unchanged encoding.
    expect(parts[0]).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(parts[0]).toContain("Content-Transfer-Encoding: base64");
    expect(parts[0]).toContain(Buffer.from("See attached", "utf8").toString("base64"));

    // Non-ASCII filename: ASCII fallback in `filename`/`name`, exact name via RFC 6266 filename*.
    expect(parts[1]).toContain('Content-Type: application/pdf; name="Expos_.pdf"');
    expect(parts[1]).toContain(
      `Content-Disposition: attachment; filename="Expos_.pdf"; filename*=UTF-8''${encodeURIComponent("Exposé.pdf")}`,
    );
    expect(parts[1]).toContain("Content-Transfer-Encoding: base64");
    const encoded = parts[1]?.trim().split("\r\n\r\n")[1] ?? "";
    expect(Buffer.from(encoded.trim(), "base64").toString("utf8")).toBe("PDFBYTES");

    expect(parts[2]).toContain('Content-Type: text/plain; charset=utf-8; name="plan.txt"');

    // Closing delimiter after the last part.
    expect(raw.trimEnd().endsWith(`--${boundary}--`)).toBe(true);
  });

  it("keeps threading headers top-level when a reply draft carries attachments", async () => {
    proxyRequestMock.mockImplementation(async (_accountId, method, url) => {
      if (method === "get" && url.includes("/threads/")) {
        return {
          messages: [
            {
              labelIds: ["INBOX"],
              payload: { headers: [{ name: "Message-ID", value: "<orig@mail>" }] },
            },
          ],
        };
      }
      return CREATE_RESPONSE;
    });

    await gmailDraftProvider.createDraft(account, {
      to: ["a@example.com"],
      subject: "Re: Files",
      body: "Reply",
      threadId: "thread-1",
      attachments: [attachment("a.pdf", "PDF")],
    });

    const raw = sentRaw();
    const boundary = boundaryOf(raw);
    const topHeaders = raw.split(`--${boundary}`)[0] ?? "";
    expect(topHeaders).toContain("In-Reply-To: <orig@mail>");
    expect(topHeaders).toContain("References: <orig@mail>");
  });

  it("rejects a filename containing CR/LF instead of smuggling a header", async () => {
    await expect(
      gmailDraftProvider.createDraft(account, {
        to: ["a@example.com"],
        subject: "Evil",
        body: "x",
        attachments: [attachment("evil\r\nBcc: x@y.com.pdf", "X")],
      }),
    ).rejects.toThrow(/attachment filename.*control character/);
    expect(proxyRequestMock).not.toHaveBeenCalled();
  });
});

describe("updateGmailDraft — attachment preservation", () => {
  it("re-embeds the existing attachment parts when rebuilding the raw message", async () => {
    const bodyData = Buffer.from("Old body", "utf8").toString("base64url");
    proxyRequestMock.mockImplementation(async (_accountId, method, url) => {
      if (method === "get" && url.endsWith("/drafts/draft-1")) {
        return {
          message: {
            id: "msg-1",
            threadId: "thread-1",
            payload: {
              mimeType: "multipart/mixed",
              headers: [
                { name: "To", value: "a@example.com" },
                { name: "Subject", value: "Files" },
                { name: "In-Reply-To", value: "<orig@mail>" },
              ],
              parts: [
                { mimeType: "text/plain", body: { data: bodyData } },
                {
                  filename: "a.pdf",
                  mimeType: "application/pdf",
                  body: { attachmentId: "att-1", size: 8 },
                },
                {
                  filename: "inline.txt",
                  mimeType: "text/plain",
                  body: { data: Buffer.from("INLINE", "utf8").toString("base64url") },
                },
              ],
            },
          },
        };
      }
      if (method === "get" && url.endsWith("/messages/msg-1/attachments/att-1")) {
        return { data: Buffer.from("PDFBYTES", "utf8").toString("base64url") };
      }
      return {};
    });

    await gmailDraftProvider.updateDraft?.(account, "draft-1", { body: "New body" });

    const putCall = proxyRequestMock.mock.calls.find(([, method]) => method === "put");
    expect(putCall?.[2]).toContain("/drafts/draft-1");
    // The ref-only attachment was downloaded before the rebuild.
    expect(
      proxyRequestMock.mock.calls.some(([, , url]) => url.endsWith("/attachments/att-1")),
    ).toBe(true);

    const raw = sentRaw();
    const boundary = boundaryOf(raw);
    const parts = raw.split(`--${boundary}`);
    expect(parts[1]).toContain(Buffer.from("New body", "utf8").toString("base64"));
    expect(parts[2]).toContain('Content-Type: application/pdf; name="a.pdf"');
    expect(parts[2]).toContain(Buffer.from("PDFBYTES", "utf8").toString("base64"));
    expect(parts[3]).toContain('name="inline.txt"');
    expect(parts[3]).toContain(Buffer.from("INLINE", "utf8").toString("base64"));
    // Preserved threading header stays top-level.
    expect(parts[0]).toContain("In-Reply-To: <orig@mail>");
  });

  it("rebuilds text-only drafts as single-part, unchanged", async () => {
    proxyRequestMock.mockImplementation(async (_accountId, method, url) => {
      if (method === "get" && url.endsWith("/drafts/draft-2")) {
        return {
          message: {
            id: "msg-2",
            threadId: "",
            payload: {
              mimeType: "text/plain",
              headers: [
                { name: "To", value: "a@example.com" },
                { name: "Subject", value: "Plain" },
              ],
              body: { data: Buffer.from("Old", "utf8").toString("base64url") },
            },
          },
        };
      }
      return {};
    });

    await gmailDraftProvider.updateDraft?.(account, "draft-2", { body: "New" });

    const raw = sentRaw();
    expect(raw).not.toContain("multipart/mixed");
    expect(raw).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(raw).toContain(Buffer.from("New", "utf8").toString("base64"));
  });
});
