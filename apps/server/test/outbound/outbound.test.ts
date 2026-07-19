import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OutboundDraft, ServerEvent } from "@trailin/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Outbound drafts through the real API + store: the agent files them (store
 * seam), Home lists and approves them (routes). Locks the approval loop the
 * web relies on — open list, human send through the channel registry, and the
 * "outbound" events that drive query invalidation.
 */

let store: typeof import("../../src/db/outboundStore.js");
let events: typeof import("../../src/core/events.js");
let app: Awaited<ReturnType<typeof import("../../src/app.js").buildApp>>;
const sends: OutboundDraft[] = [];

beforeAll(async () => {
  const scratch = await mkdtemp(join(tmpdir(), "trailin-outbound-test-"));
  process.env.AGENT_HOME_PATH = join(scratch, "Trailin");
  process.env.DATABASE_PATH = join(scratch, "test.db");
  store = await import("../../src/db/outboundStore.js");
  events = await import("../../src/core/events.js");
  app = await (await import("../../src/app.js")).buildApp();
  const { registerOutboundChannel } = await import("../../src/services/outbound/registry.js");
  registerOutboundChannel("test-channel", {
    label: "Test",
    isArmed: async () => false,
    send: async (draft) => {
      sends.push(draft);
      return { sentRef: `ref-${sends.length}` };
    },
  });
});

afterAll(async () => {
  await app?.close();
});

const listOpen = async (): Promise<OutboundDraft[]> =>
  (await app.inject({ method: "GET", url: "/api/outbound?status=open" })).json<OutboundDraft[]>();

/** Run `fn` and return the "outbound" events it emitted synchronously. */
async function outboundEvents(fn: () => Promise<unknown>): Promise<ServerEvent[]> {
  const seen: ServerEvent[] = [];
  const off = events.onServerEvent((e) => {
    if (e.topic === "outbound") seen.push(e);
  });
  try {
    await fn();
  } finally {
    off();
  }
  return seen;
}

describe("outbound drafts", () => {
  it("lists a created draft as open and emits the outbound event", async () => {
    let draft: OutboundDraft | undefined;
    const emitted = await outboundEvents(async () => {
      draft = await store.createOutboundDraft({
        channel: "test-channel",
        target: "491700000001@s.whatsapp.net",
        targetLabel: "Testkontakt",
        body: "Hallo, passt der Termin am Freitag?",
      });
    });
    expect(emitted).toHaveLength(1);

    const open = await listOpen();
    const listed = open.find((d) => d.id === draft?.id);
    expect(listed).toMatchObject({
      channel: "test-channel",
      targetLabel: "Testkontakt",
      status: "open",
      sentRef: null,
    });
  });

  it("human send dispatches through the channel, marks sent, and leaves the open list", async () => {
    const { id } = await store.createOutboundDraft({
      channel: "test-channel",
      target: "491700000002@s.whatsapp.net",
      body: "Nachricht zwei",
    });

    const emitted = await outboundEvents(async () => {
      const res = await app.inject({ method: "POST", url: `/api/outbound/${id}/send` });
      expect(res.statusCode).toBe(200);
    });
    expect(emitted.length).toBeGreaterThan(0);
    expect(sends.some((d) => d.id === id)).toBe(true);

    expect((await listOpen()).some((d) => d.id === id)).toBe(false);
    const status = (await app.inject({ method: "GET", url: `/api/outbound/${id}/status` })).json<{
      status: string;
      sentRef?: string;
    }>();
    expect(status.status).toBe("sent");
    expect(status.sentRef).toBeDefined();

    // Sending an already-sent draft is a no-op, not a double dispatch.
    const sendsBefore = sends.length;
    await app.inject({ method: "POST", url: `/api/outbound/${id}/send` });
    expect(sends.length).toBe(sendsBefore);
  });

  it("rewriting a draft updates it in place instead of adding a second one", async () => {
    const { id } = await store.createOutboundDraft({
      channel: "test-channel",
      target: "491700000005@s.whatsapp.net",
      targetLabel: "Testkontakt",
      body: "Erster Wurf",
    });
    const openBefore = (await listOpen()).length;

    const emitted = await outboundEvents(async () => {
      await store.updateOutboundDraft(id, { body: "Zweiter Wurf" });
    });
    expect(emitted).toHaveLength(1);

    const open = await listOpen();
    expect(open).toHaveLength(openBefore);
    expect(open.find((d) => d.id === id)?.body).toBe("Zweiter Wurf");
  });

  it("discard removes the draft from the open list", async () => {
    const { id } = await store.createOutboundDraft({
      channel: "test-channel",
      target: "491700000003@s.whatsapp.net",
      body: "Nachricht drei",
    });
    const res = await app.inject({ method: "DELETE", url: `/api/outbound/${id}` });
    expect(res.statusCode).toBe(200);
    expect((await listOpen()).some((d) => d.id === id)).toBe(false);
    expect(
      (await app.inject({ method: "GET", url: `/api/outbound/${id}/status` })).json<{
        status: string;
      }>().status,
    ).toBe("discarded");
  });

  it("400s a send on an unregistered channel and keeps the draft open", async () => {
    const { id } = await store.createOutboundDraft({
      channel: "carrier-pigeon",
      target: "somewhere",
      body: "coo",
    });
    const res = await app.inject({ method: "POST", url: `/api/outbound/${id}/send` });
    expect(res.statusCode).toBe(400);
    expect((await listOpen()).some((d) => d.id === id)).toBe(true);
  });
});
