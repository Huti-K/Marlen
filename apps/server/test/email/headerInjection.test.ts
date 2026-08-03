import type { ConnectedAccount } from "@marlen/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A reply draft's In-Reply-To/References are copied verbatim off a message the
 * thread received, so a sender controls their bytes. If one carried a line
 * break it would close the header and open another, letting an inbound email
 * add a Bcc to a draft the user later sends by hand.
 */

const proxyCalls: { method: string; url: string; body?: unknown }[] = [];
let threadMessageId = "<clean@example.com>";

vi.mock("../../src/integrations/pipedream/connect.js", () => ({
  proxyRequest: async (
    _accountId: string,
    method: string,
    url: string,
    opts?: { body?: unknown },
  ) => {
    proxyCalls.push({ method, url, ...(opts?.body !== undefined ? { body: opts.body } : {}) });
    if (url.includes("/threads/")) {
      return {
        messages: [
          {
            id: "msg-0",
            labelIds: ["INBOX"],
            payload: { headers: [{ name: "Message-ID", value: threadMessageId }] },
          },
        ],
      };
    }
    return { id: "draft-1", message: { id: "msg-1", threadId: "thread-1" } };
  },
}));

import { gmailDraftProvider } from "../../src/email/gmail/drafts.js";

const account = { id: "acc-1", app: "gmail", name: "user@example.com" } as ConnectedAccount;

async function replyDraftMime(messageId: string): Promise<string> {
  proxyCalls.length = 0;
  threadMessageId = messageId;
  await gmailDraftProvider.createDraft(account, {
    to: ["empfaenger@example.com"],
    subject: "Re: Anfrage",
    body: "Gern, hier die Unterlagen.",
    threadId: "thread-1",
  });
  const create = proxyCalls.find((call) => call.method === "post");
  if (!create) throw new Error("no draft create call was proxied");
  const raw = (create.body as { message: { raw: string } }).message.raw;
  return Buffer.from(raw, "base64url").toString("utf8");
}

describe("gmail reply threading headers", () => {
  beforeEach(() => {
    proxyCalls.length = 0;
  });

  it("threads the reply to the message it answers", async () => {
    const mime = await replyDraftMime("<clean@example.com>");
    expect(mime).toContain("In-Reply-To: <clean@example.com>");
    expect(mime).toContain("References: <clean@example.com>");
  });

  it("drops a threading header the sender packed a second header into", async () => {
    const mime = await replyDraftMime("<evil@example.com>\r\nBcc: attacker@evil.example");
    expect(mime).not.toContain("attacker@evil.example");
    expect(mime).not.toContain("Bcc:");
    // Threading is what's lost, not the draft: it still addresses the right
    // recipient and rides the thread through Gmail's own threadId.
    expect(mime).not.toContain("In-Reply-To");
    expect(mime).toContain("To: empfaenger@example.com");
  });
});
