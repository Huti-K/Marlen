import type { ConnectedAccount } from "@marlen/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Gmail raw MIME shape is where broken signature images would silently
 * come back: without multipart/related + Content-ID parts, cid: references in
 * the html dangle and recipients see broken image boxes.
 */

const proxyCalls: { method: string; url: string; body?: unknown }[] = [];

vi.mock("../../src/integrations/pipedream/connect.js", () => ({
  proxyRequest: async (
    _accountId: string,
    method: string,
    url: string,
    opts?: { body?: unknown },
  ) => {
    proxyCalls.push({ method, url, ...(opts?.body !== undefined ? { body: opts.body } : {}) });
    return { id: "draft-1", message: { id: "msg-1", threadId: "thread-1" } };
  },
}));

import { gmailDraftProvider } from "../../src/email/gmail/drafts.js";
import { htmlBodyWithSignature } from "../../src/email/textUtils.js";

const account = { id: "acc-1", app: "gmail", name: "user@example.com" } as ConnectedAccount;

function sentRawMime(): string {
  const create = proxyCalls.find((call) => call.method === "post");
  if (!create) throw new Error("no draft create call was proxied");
  const raw = (create.body as { message: { raw: string } }).message.raw;
  return Buffer.from(raw, "base64url").toString("utf8");
}

describe("gmail drafts with inline signature images", () => {
  beforeEach(() => {
    proxyCalls.length = 0;
  });

  it("embeds cid images as multipart/related parts referenced by the html body", async () => {
    const pixel = "iVBORw0KGgoAAAANSUhEUg==";
    const { html, images } = htmlBodyWithSignature(
      "Hallo Frau Beispiel",
      `<p>Max Mustermann</p><img src="data:image/png;base64,${pixel}">`,
    );

    await gmailDraftProvider.createDraft(account, {
      to: ["empfaenger@example.com"],
      subject: "Exposé",
      body: html,
      bodyFormat: "html",
      inlineImages: images,
    });

    const mime = sentRawMime();
    expect(mime).toContain('Content-Type: multipart/related; boundary="');
    expect(mime).toContain(`Content-ID: <${images[0]?.contentId}>`);
    expect(mime).toContain("Content-Disposition: inline;");
    // The html body part is a single base64 line; decoded it references the cid.
    expect(mime).toContain(Buffer.from(html, "utf8").toString("base64"));
    expect(html).toContain(`cid:${images[0]?.contentId}`);
    expect(mime).toContain(images[0]?.content.toString("base64"));
  });

  it("nests the related body inside multipart/mixed when files are attached", async () => {
    const { html, images } = htmlBodyWithSignature(
      "Anbei das Exposé.",
      '<p>Max</p><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==">',
    );

    await gmailDraftProvider.createDraft(account, {
      to: ["empfaenger@example.com"],
      subject: "Exposé",
      body: html,
      bodyFormat: "html",
      inlineImages: images,
      attachments: [
        { filename: "expose.pdf", mimeType: "application/pdf", content: Buffer.from("pdf") },
      ],
    });

    const mime = sentRawMime();
    expect(mime).toContain('Content-Type: multipart/mixed; boundary="');
    expect(mime).toContain('Content-Type: multipart/related; boundary="');
    expect(mime.indexOf("multipart/mixed")).toBeLessThan(mime.indexOf("multipart/related"));
    expect(mime).toContain('Content-Disposition: attachment; filename="expose.pdf"');
  });
});
