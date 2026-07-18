import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/** Imported dynamically after DATABASE_PATH points at a scratch file — env.ts reads it at import. */
let store: typeof import("../../src/whatsapp/store.js");

const at = (seconds: number) => new Date(seconds * 1000).toISOString();

function textMessage(
  chatJid: string,
  id: string,
  text: string,
  seconds: number,
  extra: Partial<{ fromMe: boolean; participant: string; pushName: string }> = {},
) {
  return {
    key: {
      remoteJid: chatJid,
      id,
      fromMe: extra.fromMe ?? false,
      participant: extra.participant ?? null,
    },
    pushName: extra.pushName ?? null,
    messageTimestamp: seconds,
    message: { conversation: text },
  };
}

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "trailin-wa-"));
  process.env.DATABASE_PATH = join(dir, "test.db");
  store = await import("../../src/whatsapp/store.js");
});

describe("messageTextOf", () => {
  it("returns plain and extended text", () => {
    expect(store.messageTextOf({ conversation: "Hallo" })).toBe("Hallo");
    expect(store.messageTextOf({ extendedTextMessage: { text: "Hi there" } })).toBe("Hi there");
  });

  it("renders media as bracketed markers with captions", () => {
    expect(store.messageTextOf({ imageMessage: { caption: "Exposé" } })).toBe("[image] Exposé");
    expect(store.messageTextOf({ imageMessage: {} })).toBe("[image]");
    expect(store.messageTextOf({ audioMessage: { ptt: true } })).toBe("[voice message]");
    expect(store.messageTextOf({ documentMessage: { fileName: "expose.pdf" } })).toBe(
      "[document] expose.pdf",
    );
  });

  it("unwraps ephemeral/view-once wrappers", () => {
    expect(store.messageTextOf({ ephemeralMessage: { message: { conversation: "secret" } } })).toBe(
      "secret",
    );
  });

  it("skips protocol events that render as nothing", () => {
    expect(store.messageTextOf({ reactionMessage: { text: "👍" } })).toBeNull();
    expect(store.messageTextOf({ protocolMessage: {} })).toBeNull();
    expect(store.messageTextOf(undefined)).toBeNull();
  });
});

describe("ingest and read", () => {
  const hans = "4917111111@s.whatsapp.net";
  const group = "1234567-987@g.us";

  it("ingests a history sync and lists chats with resolved names", async () => {
    store.ingestHistory({
      chats: [
        { id: hans, conversationTimestamp: 1_000 },
        { id: group, name: "Musterstraße 12", conversationTimestamp: 900 },
        { id: "status@broadcast", conversationTimestamp: 2_000 },
      ],
      contacts: [{ id: hans, name: "Hans Meier", notify: "Hans" }],
      messages: [
        textMessage(hans, "m1", "Ist die Wohnung noch frei?", 1_000, { pushName: "Hans" }),
        textMessage(group, "g1", "Besichtigung am Freitag", 900, {
          participant: "4917222222@s.whatsapp.net",
          pushName: "Petra",
        }),
      ],
    });

    const chats = store.listChats({ limit: 10 });
    expect(chats.map((c) => c.jid)).toEqual([hans, group]);
    expect(chats[0]?.name).toBe("Hans Meier");
    expect(chats[0]?.lastMessageText).toBe("Ist die Wohnung noch frei?");
    expect(chats[1]?.name).toBe("Musterstraße 12");
    expect(chats[1]?.isGroup).toBe(true);
    // The status broadcast pseudo-chat is never mirrored.
    expect(store.listChats({ query: "status", limit: 10 })).toHaveLength(0);
  });

  it("filters chats by name and number", () => {
    expect(store.listChats({ query: "muster", limit: 10 }).map((c) => c.jid)).toEqual([group]);
    expect(store.listChats({ query: "4917111111", limit: 10 }).map((c) => c.jid)).toEqual([hans]);
  });

  it("records live messages, keeps chronology and pages backwards", async () => {
    store.ingestMessages([
      textMessage(hans, "m2", "Ja, ist sie", 1_100, { fromMe: true }),
      textMessage(hans, "m3", "Super, wann kann ich vorbei?", 1_200, { pushName: "Hans" }),
    ]);

    const all = await store.readMessages(hans, { limit: 10 });
    expect(all.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
    expect(all[1]?.fromMe).toBe(true);

    const paged = await store.readMessages(hans, { limit: 10, before: at(1_100) });
    expect(paged.map((m) => m.id)).toEqual(["m1"]);

    const chats = store.listChats({ limit: 1 });
    expect(chats[0]?.lastMessageAt).toBe(at(1_200));
    expect(chats[0]?.lastMessageFromMe).toBe(false);
  });

  it("searches contacts by name and number fragment", async () => {
    store.ingestContacts([{ id: "4917333333@s.whatsapp.net", notify: "Klaus" }]);
    const byName = await store.searchContacts("hans", 10);
    expect(byName.map((c) => c.jid)).toEqual([hans]);
    expect(byName[0]?.phoneNumber).toBe("4917111111");
    const byNumber = await store.searchContacts("333333", 10);
    expect(byNumber.map((c) => c.notify)).toEqual(["Klaus"]);
  });

  it("keeps only the newest messages of a chat", async () => {
    const flood = "4917444444@s.whatsapp.net";
    store.ingestMessages(
      Array.from({ length: 520 }, (_, i) => textMessage(flood, `f${i}`, `msg ${i}`, 2_000 + i)),
    );
    const kept = await store.readMessages(flood, { limit: 1_000 });
    expect(kept).toHaveLength(500);
    expect(kept[0]?.text).toBe("msg 20");
    expect(kept.at(-1)?.text).toBe("msg 519");
  });

  it("wipes everything on clear", async () => {
    await store.clearWhatsAppStore();
    expect(store.listChats({ limit: 10 })).toHaveLength(0);
    expect(await store.searchContacts("hans", 10)).toHaveLength(0);
  });
});
