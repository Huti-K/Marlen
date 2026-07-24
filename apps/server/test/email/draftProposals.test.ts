import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConnectedAccount } from "@marlen/shared";
import { beforeAll, describe, expect, it } from "vitest";
import type { CreateDraftInput, DraftProvider } from "../../src/email/providers.js";

/**
 * The proposal → keep pipeline is what stands between a chat-composed draft
 * and the user's real mailbox: nothing may reach the provider before keep, and
 * keeping must produce the full bookkeeping (snapshot, conversation link,
 * settled proposal) that Home's approval list and the learning loop rely on.
 */

let proposalStore: typeof import("../../src/db/draftProposalStore.js");
let draftStore: typeof import("../../src/db/draftStore.js");
let conversationStore: typeof import("../../src/db/conversationStore.js");
let service: typeof import("../../src/services/draftProposals.js");
let draftTools: typeof import("../../src/agent/draftTools.js");

const account: ConnectedAccount = {
  id: "acc-1",
  app: "fakemail",
  name: "test@example.com",
  healthy: true,
  createdAt: new Date().toISOString(),
};

const createdInputs: CreateDraftInput[] = [];
const sentDraftIds: string[] = [];

const provider: DraftProvider = {
  listDrafts: async () => [],
  getDraftDetail: async () => ({ body: "", cc: "", bcc: "" }),
  createDraft: async (_account, input) => {
    createdInputs.push(input);
    const n = createdInputs.length;
    return { draftId: `pd-${n}`, messageId: `m-${n}`, threadId: `t-${n}`, webUrl: "" };
  },
  deleteDraft: async () => {},
  sendDraft: async (_account, draftId) => {
    sentDraftIds.push(draftId);
    return { sentMessageId: `sm-${sentDraftIds.length}` };
  },
};

const deps = { listAccounts: async () => [account], providerFor: () => provider };

beforeAll(async () => {
  const scratch = await mkdtemp(join(tmpdir(), "marlen-proposals-test-"));
  process.env.AGENT_HOME_PATH = join(scratch, "Marlen");
  process.env.DATABASE_PATH = join(scratch, "test.db");
  proposalStore = await import("../../src/db/draftProposalStore.js");
  draftStore = await import("../../src/db/draftStore.js");
  conversationStore = await import("../../src/db/conversationStore.js");
  service = await import("../../src/services/draftProposals.js");
  draftTools = await import("../../src/agent/draftTools.js");
});

/** Run the create-draft tool as one session profile would. */
async function runCreateTool(
  interactive: boolean,
  opts: { sendArmed?: boolean; send?: boolean } = {},
) {
  const createTool = draftTools.buildDraftTool(
    account,
    "fakemail-create-draft",
    provider,
    opts.sendArmed ?? false,
    false,
    interactive,
  );
  const result = await createTool.execute(
    "call-1",
    {
      to: ["someone@example.com"],
      subject: "Termin",
      body: "Passt Dienstag?",
      ...(opts.send !== undefined ? { send: opts.send } : {}),
    },
    undefined as never,
    undefined,
  );
  const card = result.details as { draft?: { draftId?: string; proposalId?: string } } | undefined;
  return { text: result.content[0]?.type === "text" ? result.content[0].text : "", card };
}

describe("draft proposals", () => {
  it("keeping creates the mailbox draft with full bookkeeping; nothing exists before", async () => {
    await conversationStore.ensureConversation("conv-1", { type: "chat", title: "test" });
    const proposalId = await proposalStore.createDraftProposal({
      accountId: account.id,
      subject: "Hello",
      to: ["someone@example.com"],
      body: "Guten Tag,\n\nbis morgen.",
    });
    await proposalStore.linkDraftProposalConversation(proposalId, "conv-1");
    expect(createdInputs).toHaveLength(0);

    const outcome = await service.keepDraftProposal(proposalId, {}, deps);
    expect(outcome.sent).toBe(false);
    expect(createdInputs).toHaveLength(1);
    expect(createdInputs[0]).toMatchObject({
      to: ["someone@example.com"],
      subject: "Hello",
      body: "Guten Tag,\n\nbis morgen.",
    });

    const proposal = await proposalStore.getDraftProposal(proposalId);
    expect(proposal?.status).toBe("kept");
    expect(proposal?.providerDraftId).toBe(outcome.draftId);
    // Snapshot + conversation link exist, so Home attributes the draft and
    // the learning loop can track it.
    expect(await draftStore.getDraftStatus(account.id, outcome.draftId)).toMatchObject({
      status: "open",
    });
    const links = await draftStore.getDraftConversationLinks([outcome.draftId]);
    expect(links.get(outcome.draftId)).toBe("conv-1");
  });

  it("a settled proposal cannot be kept again", async () => {
    const proposalId = await proposalStore.createDraftProposal({
      accountId: account.id,
      subject: "Twice",
      to: ["someone@example.com"],
      body: "x",
    });
    await service.keepDraftProposal(proposalId, {}, deps);
    const providerCalls = createdInputs.length;
    await expect(service.keepDraftProposal(proposalId, {}, deps)).rejects.toThrow(/already kept/);
    expect(createdInputs).toHaveLength(providerCalls);
  });

  it("a discarded proposal never reaches the provider", async () => {
    const proposalId = await proposalStore.createDraftProposal({
      accountId: account.id,
      subject: "Dropped",
      to: ["someone@example.com"],
      body: "x",
    });
    expect(await proposalStore.settleDraftProposal(proposalId, "discarded")).toBe(true);
    const providerCalls = createdInputs.length;
    await expect(service.keepDraftProposal(proposalId, {}, deps)).rejects.toThrow(
      /already discarded/,
    );
    expect(createdInputs).toHaveLength(providerCalls);
    // Discarding again reports the miss instead of settling twice.
    expect(await proposalStore.settleDraftProposal(proposalId, "discarded")).toBe(false);
  });

  it("an unattended create-draft (automation run) writes the mailbox draft directly", async () => {
    const providerCalls = createdInputs.length;
    const { text, card } = await runCreateTool(false);
    expect(createdInputs).toHaveLength(providerCalls + 1);
    expect(createdInputs.at(-1)).toMatchObject({ subject: "Termin", to: ["someone@example.com"] });
    expect(text).toContain("Draft created");
    // The card fronts the real mailbox draft, with its snapshot in place.
    const draftId = card?.draft?.draftId as string;
    expect(draftId).toBeTruthy();
    expect(card?.draft?.proposalId).toBeUndefined();
    expect(await draftStore.getDraftStatus(account.id, draftId)).toMatchObject({ status: "open" });
  });

  it("an interactive create-draft only proposes; the provider is untouched", async () => {
    const providerCalls = createdInputs.length;
    const { text, card } = await runCreateTool(true);
    expect(createdInputs).toHaveLength(providerCalls);
    expect(text).toContain("Draft proposed");
    const proposalId = card?.draft?.proposalId as string;
    expect(proposalId).toBeTruthy();
    expect(card?.draft?.draftId).toBeUndefined();
    expect((await proposalStore.getDraftProposal(proposalId))?.status).toBe("proposed");
  });

  it("keep with send dispatches and records the sent fate", async () => {
    const proposalId = await proposalStore.createDraftProposal({
      accountId: account.id,
      subject: "Send now",
      to: ["someone@example.com"],
      body: "x",
    });
    const outcome = await service.keepDraftProposal(proposalId, { send: true }, deps);
    expect(outcome.sent).toBe(true);
    expect(sentDraftIds).toContain(outcome.draftId);
    expect((await proposalStore.getDraftProposal(proposalId))?.status).toBe("sent");
    expect(await draftStore.getDraftStatus(account.id, outcome.draftId)).toMatchObject({
      status: "sent",
      sentMessageId: "sm-1",
    });
  });

  it("an unattended send=true dispatches when the account is send-armed", async () => {
    const sentBefore = sentDraftIds.length;
    const { text, card } = await runCreateTool(false, { sendArmed: true, send: true });
    const draftId = card?.draft?.draftId as string;
    expect(draftId).toBeTruthy();
    // The real draft was created and then actually sent through the provider.
    expect(sentDraftIds).toHaveLength(sentBefore + 1);
    expect(sentDraftIds.at(-1)).toBe(draftId);
    expect(text).toContain("Sent from");
    expect(await draftStore.getDraftStatus(account.id, draftId)).toMatchObject({ status: "sent" });
  });

  it("an unattended send=true stays a draft when the account is not send-armed", async () => {
    const sentBefore = sentDraftIds.length;
    const { text, card } = await runCreateTool(false, { sendArmed: false, send: true });
    const draftId = card?.draft?.draftId as string;
    expect(draftId).toBeTruthy();
    // Nothing dispatched: the grant is the gate, not the send=true flag alone.
    expect(sentDraftIds).toHaveLength(sentBefore);
    expect(text).toContain("isn't send-armed");
    expect(await draftStore.getDraftStatus(account.id, draftId)).toMatchObject({ status: "open" });
  });
});
