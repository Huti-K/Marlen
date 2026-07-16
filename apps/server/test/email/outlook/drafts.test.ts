import type { ConnectedAccount } from "@trailin/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DraftAttachment } from "../../../src/email/providers.js";

// outlookDraftProvider drives every fetch through proxyRequest — stub it the
// same way ./sync.test.ts does, instead of hitting Pipedream's proxy for real.
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

const { outlookDraftProvider } = await import("../../../src/email/outlook/drafts.js");

function account(name: string): ConnectedAccount {
  return {
    id: "acct-1",
    app: "microsoft_outlook",
    appName: "Outlook",
    name,
    healthy: true,
    createdAt: "2026-01-01",
  };
}

const WEB_LINK = "https://outlook.office365.com/owa/?ItemID=AAMk%2Bx%3D&exvsurl=1";

function listResponse(webLink?: string) {
  return { value: [{ id: "d1", subject: "Hi", ...(webLink ? { webLink } : {}) }] };
}

describe("listOutlookDrafts — webUrl per account class", () => {
  it("pins Graph's webLink to a work account via login_hint", async () => {
    proxyRequestMock.mockResolvedValueOnce(listResponse(WEB_LINK));
    const drafts = await outlookDraftProvider.listDrafts(account("a@contoso.com"));
    expect(drafts[0]?.webUrl).toBe(`${WEB_LINK}&login_hint=a%40contoso.com`);
  });

  it("ignores webLink for a personal account and lands on the consumer Drafts folder", async () => {
    proxyRequestMock.mockResolvedValueOnce(listResponse(WEB_LINK));
    const drafts = await outlookDraftProvider.listDrafts(account("a@hotmail.com"));
    expect(drafts[0]?.webUrl).toBe(
      "https://outlook.live.com/mail/0/drafts?login_hint=a%40hotmail.com",
    );
  });

  it("falls back to the work Drafts folder when Graph omits webLink", async () => {
    proxyRequestMock.mockResolvedValueOnce(listResponse());
    const drafts = await outlookDraftProvider.listDrafts(account("a@contoso.com"));
    expect(drafts[0]?.webUrl).toBe(
      "https://outlook.office.com/mail/drafts?login_hint=a%40contoso.com",
    );
  });
});

function attachment(filename: string, content: Buffer): DraftAttachment {
  return { filename, mimeType: "application/pdf", content };
}

describe("createOutlookDraft — attachments", () => {
  beforeEach(() => {
    proxyRequestMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs one fileAttachment per small file after creating the draft", async () => {
    proxyRequestMock.mockImplementation(async (_accountId, method, url) => {
      if (method === "post" && url.endsWith("/messages")) return { id: "d9" };
      return {};
    });

    await outlookDraftProvider.createDraft(account("a@contoso.com"), {
      to: ["b@example.com"],
      subject: "Files",
      body: "See attached",
      attachments: [
        attachment("a.pdf", Buffer.from("PDF-A")),
        attachment("b.pdf", Buffer.from("PDF-B")),
      ],
    });

    const attachCalls = proxyRequestMock.mock.calls.filter(
      ([, method, url]) => method === "post" && url.endsWith("/messages/d9/attachments"),
    );
    expect(attachCalls).toHaveLength(2);
    expect(attachCalls[0]?.[3]?.body).toEqual({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: "a.pdf",
      contentType: "application/pdf",
      contentBytes: Buffer.from("PDF-A").toString("base64"),
    });
    expect(attachCalls[1]?.[3]?.body).toMatchObject({ name: "b.pdf" });
  });

  it("uploads a >3 MB file through an upload session in 320 KiB-aligned chunks", async () => {
    const big = Buffer.alloc(4 * 1024 * 1024, 7);
    proxyRequestMock.mockImplementation(async (_accountId, method, url) => {
      if (method === "post" && url.endsWith("/messages")) return { id: "d9" };
      if (method === "post" && url.endsWith("/attachments/createUploadSession")) {
        return { uploadUrl: "https://upload.example/session-1" };
      }
      return {};
    });
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await outlookDraftProvider.createDraft(account("a@contoso.com"), {
      to: ["b@example.com"],
      subject: "Big file",
      body: "See attached",
      attachments: [attachment("big.pdf", big)],
    });

    // No plain fileAttachment POST for the large file.
    expect(
      proxyRequestMock.mock.calls.some(([, , url]) => url.endsWith("/messages/d9/attachments")),
    ).toBe(false);

    // 4 MiB in 3_276_800-byte chunks: one full chunk, then the remainder.
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls).toHaveLength(2);
    expect(calls[0]?.[0]).toBe("https://upload.example/session-1");
    const total = big.length;
    const headers0 = calls[0]?.[1]?.headers as Record<string, string>;
    const headers1 = calls[1]?.[1]?.headers as Record<string, string>;
    expect(calls[0]?.[1]?.method).toBe("PUT");
    expect(headers0["Content-Range"]).toBe(`bytes 0-3276799/${total}`);
    expect(headers1["Content-Range"]).toBe(`bytes 3276800-${total - 1}/${total}`);
    const body0 = calls[0]?.[1]?.body as Uint8Array | undefined;
    const body1 = calls[1]?.[1]?.body as Uint8Array | undefined;
    expect(body0?.length).toBe(3_276_800);
    expect(body1?.length).toBe(total - 3_276_800);
  });

  it("names the draft and the not-yet-attached files when attaching fails mid-way", async () => {
    proxyRequestMock.mockImplementation(async (_accountId, method, url) => {
      if (method === "post" && url.endsWith("/messages")) return { id: "d9" };
      if (method === "post" && url.endsWith("/messages/d9/attachments")) {
        throw new Error("Graph says no");
      }
      return {};
    });

    await expect(
      outlookDraftProvider.createDraft(account("a@contoso.com"), {
        to: ["b@example.com"],
        subject: "Files",
        body: "x",
        attachments: [
          attachment("a.pdf", Buffer.from("PDF-A")),
          attachment("b.pdf", Buffer.from("PDF-B")),
        ],
      }),
    ).rejects.toThrow(/Draft d9 .*"a\.pdf", "b\.pdf".*Graph says no/);
  });
});
