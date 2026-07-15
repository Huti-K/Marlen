import type { ChoiceOption } from "@trailin/shared";
import { describe, expect, it } from "vitest";
import {
  buildAttachmentsCard,
  buildBriefingCard,
  buildChoicesCard,
  buildEmailDraftCard,
  buildEmailHitsCard,
  buildEmailThreadCard,
  CARD_KINDS,
  coerceAttachmentItem,
  coerceBriefingItem,
  coerceBriefingRollup,
  coerceChoiceOption,
  coerceDraftPreview,
  coerceEmailHit,
  coerceEmailThreadMessage,
} from "../../../src/agent/card/kinds.js";
import { parseAgentCard } from "../../../src/agent/cards.js";

// Drift-prevention coverage, one describe block per card kind: build a card
// exactly as its emitting tool would, then confirm parseAgentCard — the same
// function that re-hydrates a stored or wire-crossed card — reproduces it
// unchanged. Both sides funnel through the shared coerce/build functions, so
// each round-trip is really asserting that shared function is idempotent on
// its own output. Per-kind focus rules are asserted through the kind's
// CARD_KINDS entry; focusFromCard's dispatch has its own coverage in
// test/agent/focus.test.ts.

const account = { accountId: "acc-1", name: "work@example.com", app: "gmail" };

describe("email_hits", () => {
  const rawHit = {
    messageId: "m1",
    threadId: "t1",
    accountId: "acc-1",
    subject: "Hello",
    from: "alice@example.com",
    to: ["bob@example.com"],
    date: "2026-01-01T00:00:00.000Z",
    snippet: "snippet text",
  };

  it("round-trips a card search_mail would build, including truncation", () => {
    const card = buildEmailHitsCard({ account, query: "invoice", hits: [rawHit], truncated: true });
    expect(parseAgentCard(card)).toEqual(card);
  });

  it("round-trips a card with no account and no truncation", () => {
    const card = buildEmailHitsCard({ query: "", hits: [rawHit] });
    expect(parseAgentCard(card)).toEqual(card);
  });

  it("drops a hit missing a required field without failing the whole card", () => {
    const card = buildEmailHitsCard({ hits: [rawHit, { subject: "no ids" }] });
    expect(card.hits).toHaveLength(1);
    expect(parseAgentCard(card)).toEqual(card);
  });

  it("coerceEmailHit requires messageId, threadId and from", () => {
    expect(coerceEmailHit({ ...rawHit, messageId: undefined })).toBeUndefined();
    expect(coerceEmailHit({ ...rawHit, threadId: undefined })).toBeUndefined();
    expect(coerceEmailHit({ ...rawHit, from: undefined })).toBeUndefined();
  });

  it("coerceEmailHit keeps the accountId only when it's a non-empty string", () => {
    expect(coerceEmailHit({ ...rawHit, accountId: "" })?.accountId).toBeUndefined();
    expect(coerceEmailHit(rawHit)?.accountId).toBe("acc-1");
  });

  it("focus sets the account and clears the thread", () => {
    const card = buildEmailHitsCard({ account, hits: [] });
    expect(CARD_KINDS.email_hits.focus(card)).toEqual({ accountId: "acc-1", threadId: null });
  });

  it("focus is null without an account", () => {
    const card = buildEmailHitsCard({ hits: [] });
    expect(CARD_KINDS.email_hits.focus(card)).toBeNull();
  });
});

describe("email_thread", () => {
  const rawMessage = {
    from: "alice@example.com",
    to: ["bob@example.com"],
    cc: ["carol@example.com"],
    date: "2026-01-01T00:00:00.000Z",
    body: "Hello there",
  };

  it("round-trips a card read_thread would build", () => {
    const card = buildEmailThreadCard({
      account,
      threadId: "t1",
      subject: "Re: Hello",
      messages: [rawMessage],
    });
    expect(parseAgentCard(card)).toEqual(card);
  });

  it("round-trips a card with no account and an empty subject", () => {
    const card = buildEmailThreadCard({ threadId: "t2", messages: [] });
    expect(parseAgentCard(card)).toEqual(card);
  });

  it("drops a message missing a required field without failing the whole card", () => {
    const card = buildEmailThreadCard({
      threadId: "t1",
      messages: [rawMessage, { to: ["nobody"] }],
    });
    expect(card.messages).toHaveLength(1);
    expect(parseAgentCard(card)).toEqual(card);
  });

  it("coerceEmailThreadMessage requires from and body", () => {
    expect(coerceEmailThreadMessage({ ...rawMessage, from: undefined })).toBeUndefined();
    expect(coerceEmailThreadMessage({ ...rawMessage, body: undefined })).toBeUndefined();
  });

  it("focus sets both the account and the thread", () => {
    const card = buildEmailThreadCard({
      account,
      threadId: "t9",
      subject: "Re: X",
      messages: [],
    });
    expect(CARD_KINDS.email_thread.focus(card)).toEqual({
      accountId: "acc-1",
      threadId: "t9",
      subject: "Re: X",
    });
  });

  it("focus is null without an account", () => {
    const card = buildEmailThreadCard({ threadId: "t9", messages: [] });
    expect(CARD_KINDS.email_thread.focus(card)).toBeNull();
  });
});

describe("email_draft", () => {
  const rawDraft = {
    draftId: "d1",
    threadId: "t1",
    subject: "Re: Hello",
    to: ["bob@example.com"],
    cc: ["carol@example.com"],
    body: "Thanks!",
    webUrl: "https://mail.example.com/d1",
    signatureAppended: true,
  };

  it("round-trips a card the create/update draft tools would build", () => {
    const card = buildEmailDraftCard({ account, draft: rawDraft });
    expect(card).toBeDefined();
    expect(parseAgentCard(card)).toEqual(card);
  });

  it("round-trips a card with no account and a minimal draft", () => {
    const card = buildEmailDraftCard({ draft: { draftId: "d2", subject: "S", body: "B" } });
    expect(parseAgentCard(card)).toEqual(card);
  });

  it("returns undefined when the draft is missing a required field", () => {
    expect(buildEmailDraftCard({ account, draft: { subject: "no id or body" } })).toBeUndefined();
  });

  it("coerceDraftPreview requires draftId, subject and body", () => {
    expect(coerceDraftPreview({ ...rawDraft, draftId: undefined })).toBeUndefined();
    expect(coerceDraftPreview({ ...rawDraft, subject: undefined })).toBeUndefined();
    expect(coerceDraftPreview({ ...rawDraft, body: undefined })).toBeUndefined();
  });

  it("focus follows the draft's own thread", () => {
    const card = buildEmailDraftCard({ account, draft: rawDraft });
    expect(card && CARD_KINDS.email_draft.focus(card)).toEqual({
      accountId: "acc-1",
      threadId: "t1",
      subject: "Re: Hello",
    });
  });

  it("focus is null without an account", () => {
    const card = buildEmailDraftCard({ draft: rawDraft });
    expect(card && CARD_KINDS.email_draft.focus(card)).toBeNull();
  });
});

describe("attachments", () => {
  const rawItem = {
    accountId: "acc-1",
    messageId: "m1",
    filename: "invoice.pdf",
    mimeType: "application/pdf",
    size: 1234,
    viewable: true,
    saveable: true,
  };

  it("round-trips a card the list-attachments tool would build", () => {
    const card = buildAttachmentsCard({ account, subject: "Re: Hello", items: [rawItem] });
    expect(parseAgentCard(card)).toEqual(card);
  });

  it("drops items missing a required handle but keeps the good ones", () => {
    const card = buildAttachmentsCard({
      items: [rawItem, { messageId: "m1", filename: "orphan.pdf", viewable: true, saveable: true }],
    });
    expect(card.items).toHaveLength(1);
    expect(card.items[0]?.filename).toBe("invoice.pdf");
  });

  it("coerceAttachmentItem requires accountId, messageId and filename, and defaults the flags", () => {
    expect(coerceAttachmentItem({ ...rawItem, accountId: undefined })).toBeUndefined();
    expect(coerceAttachmentItem({ ...rawItem, messageId: "" })).toBeUndefined();
    expect(coerceAttachmentItem({ ...rawItem, filename: undefined })).toBeUndefined();
    const minimal = coerceAttachmentItem({ accountId: "a", messageId: "m", filename: "f.bin" });
    expect(minimal).toMatchObject({ viewable: false, saveable: false });
  });

  it("focus stays null — a listing is an aside, not a focus move", () => {
    const card = buildAttachmentsCard({ account, items: [rawItem] });
    expect(CARD_KINDS.attachments.focus(card)).toBeNull();
  });
});

describe("choices", () => {
  const ref = { threadId: "t1", accountId: "acc-1", accountName: "work@example.com" };

  it("round-trips a card present_choices would build, including an option's ref", () => {
    // present_choices resolves each option's ref from the local mirror; the
    // parser reads it back off the option's own `ref` field — this round-trip
    // exercises the parser's path, since that's what round-trips.
    const options = [
      coerceChoiceOption(
        { label: "Work", detail: "Contract renewal", reply: "The work one, please." },
        ref,
      ),
      coerceChoiceOption({ label: "Personal" }, undefined),
    ].filter((o): o is ChoiceOption => o !== undefined);
    const card = buildChoicesCard("Which account do you mean?", options);
    expect(parseAgentCard(card)).toEqual(card);
  });

  it("coerceChoiceOption requires a non-empty label", () => {
    expect(coerceChoiceOption({ detail: "no label" }, undefined)).toBeUndefined();
    expect(coerceChoiceOption({ label: "" }, undefined)).toBeUndefined();
  });

  it("coerceChoiceOption omits the ref when none is given", () => {
    expect(coerceChoiceOption({ label: "A" }, undefined)?.ref).toBeUndefined();
  });

  it("focus never moves", () => {
    const card = buildChoicesCard("Pick one", [{ label: "A" }]);
    expect(CARD_KINDS.choices.focus(card)).toBeNull();
  });
});

describe("briefing", () => {
  const rawItem = {
    threadId: "t1",
    sender: "Ayşe Kaya",
    subject: "Contract renewal",
    gist: "Wants to renew before Friday.",
    priority: "urgent",
  };
  const rawRollupItem = {
    threadId: "n1",
    sender: "Stratechery",
    subject: "Weekly digest",
    gist: "Nothing needed.",
  };

  it("round-trips a card compose_briefing would build", () => {
    const item = coerceBriefingItem(
      rawItem,
      "acc-1",
      "https://mail.google.com/mail/?authuser=work%40example.com#all/t1",
    );
    const rollupItem = coerceBriefingItem(rawRollupItem, "acc-1", undefined);
    const rollup = coerceBriefingRollup({ label: "Newsletters" }, rollupItem ? [rollupItem] : []);
    const card = buildBriefingCard({
      headline: "Two things need you today",
      periodLabel: "since yesterday morning",
      accounts: [account],
      items: item ? [item] : [],
      rollups: rollup ? [rollup] : [],
      scanned: 42,
    });
    expect(parseAgentCard(card)).toEqual(card);
  });

  it("round-trips an empty briefing", () => {
    const card = buildBriefingCard({ items: [] });
    expect(parseAgentCard(card)).toEqual(card);
  });

  it("focus never moves", () => {
    const card = buildBriefingCard({ items: [] });
    expect(CARD_KINDS.briefing.focus(card)).toBeNull();
  });
});
