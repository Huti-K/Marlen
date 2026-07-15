import type { AgentCard, BriefingItem, ChoiceOption, MessageCard } from "@trailin/shared";
import {
  buildAttachmentsCard,
  buildBriefingCard,
  buildChoicesCard,
  buildEmailDraftCard,
  buildEmailHitsCard,
  buildEmailThreadCard,
} from "../agent/card/kinds.js";
import {
  DEMO_PERSONAL_ACCOUNT_ID,
  DEMO_PERSONAL_CARD_ACCOUNT,
  DEMO_WORK_ACCOUNT_ID,
  DEMO_WORK_CARD_ACCOUNT,
} from "./accounts.js";

/**
 * Static "golden" chats: one saved conversation per card kind, so every card
 * renders in the app immediately without running the agent. The cards are
 * built with the same builders the live tools use (agent/card/kinds.ts), so a
 * seeded card is byte-for-byte what a real turn would have produced. Their
 * ids reference the demo mailbox (mailFixtures.ts), so a card's "open thread"
 * / "review draft" actions land on real mirror rows.
 *
 * These are for visual/UI coverage — design review and render-regression
 * catching. Evaluating how the agent actually handles a use case is the live
 * scenario runner's job (seed --live), not these canned turns.
 *
 * Fixture data — exempt from the source line cap (see CLAUDE.md).
 */

export interface DemoChatMessage {
  role: "user" | "assistant";
  content: string;
  cards?: MessageCard[];
}

export interface DemoChat {
  id: string;
  title: string;
  messages: DemoChatMessage[];
}

/** Wrap cards as the MessageCard[] the messages.cards column stores. */
function withCards(...cards: AgentCard[]): MessageCard[] {
  return cards.map((card, i) => ({ toolCallId: `demo-tool-${i}`, card }));
}

const HITS_CARD = buildEmailHitsCard({
  account: DEMO_WORK_CARD_ACCOUNT,
  query: "Acme Rechnung",
  truncated: false,
  hits: [
    {
      messageId: "acme-2291-2",
      threadId: "thread-acme-2291",
      accountId: DEMO_WORK_ACCOUNT_ID,
      subject: "Re: Rechnung #A-2291 – Zahlungserinnerung",
      from: "Thomas Brandt <t.brandt@acme-gmbh.de>",
      to: ["selin@nordwind-studio.de"],
      date: "2026-07-13T09:14:00.000Z",
      snippet:
        "Wir haben Ihre Rechnung noch nicht im System. Könnten Sie diese bis Freitag erneut senden?",
    },
    {
      messageId: "acme-2291-1",
      threadId: "thread-acme-2291",
      accountId: DEMO_WORK_ACCOUNT_ID,
      subject: "Re: Rechnung #A-2291 – Zahlungserinnerung",
      from: "Selin Kaya <selin@nordwind-studio.de>",
      to: ["t.brandt@acme-gmbh.de"],
      date: "2026-07-10T16:40:00.000Z",
      snippet: "Anbei nochmal die Rechnung #A-2291 als PDF. Zahlungsziel war der 30. Juni.",
    },
    {
      messageId: "acme-2204",
      threadId: "thread-acme-2204",
      accountId: DEMO_WORK_ACCOUNT_ID,
      subject: "Acme GmbH – Rechnung #A-2204",
      from: "Buchhaltung Acme <buchhaltung@acme-gmbh.de>",
      to: ["selin@nordwind-studio.de"],
      date: "2026-06-14T11:02:00.000Z",
      snippet: "Die Zahlung für Mai (#A-2204) wurde soeben veranlasst.",
    },
  ],
});

const EMPTY_HITS_CARD = buildEmailHitsCard({
  account: DEMO_PERSONAL_CARD_ACCOUNT,
  query: "Kündigungsbestätigung Fitnessstudio",
  truncated: false,
  hits: [],
});

const THREAD_CARD = buildEmailThreadCard({
  account: DEMO_PERSONAL_CARD_ACCOUNT,
  threadId: "thread-seeblick-august",
  subject: "Ferienwohnung Seeblick – Buchung im August",
  messages: [
    {
      from: "Sabine Möller <sabine.moeller@seeblick-ferien.de>",
      to: ["selin.kaya.mail@gmail.com"],
      date: "2026-06-28T10:15:00.000Z",
      body: "Liebe Frau Kaya,\n\ndie Wohnung ist vom 8. bis 15. August frei, 95 € pro Nacht inkl. Endreinigung.\n\nViele Grüße\nSabine Möller",
    },
    {
      from: "Selin Kaya <selin.kaya.mail@gmail.com>",
      to: ["sabine.moeller@seeblick-ferien.de"],
      date: "2026-06-28T14:32:00.000Z",
      body: "Hallo Frau Möller,\n\nwir würden gern die ganze Woche buchen. Ist eine Anzahlung nötig, und gibt es einen Parkplatz?\n\nViele Grüße\nSelin Kaya",
    },
    {
      from: "Sabine Möller <sabine.moeller@seeblick-ferien.de>",
      to: ["selin.kaya.mail@gmail.com"],
      date: "2026-06-29T08:03:00.000Z",
      body: "Liebe Frau Kaya,\n\n30 % Anzahlung reichen, Parkplatz inklusive. Schicken Sie mir bitte noch Ihre Adresse für die Buchungsbestätigung.\n\nViele Grüße\nSabine Möller",
    },
  ],
});

const DRAFT_CARD_OR_NONE = buildEmailDraftCard({
  account: DEMO_WORK_CARD_ACCOUNT,
  draft: {
    draftId: "demo-draft-acme-2291",
    threadId: "thread-acme-2291",
    subject: "Re: Rechnung #A-2291 – Zahlungserinnerung",
    to: ["t.brandt@acme-gmbh.de"],
    cc: ["buchhaltung@acme-gmbh.de"],
    body: "Hallo Herr Brandt,\n\nanbei nochmal Rechnung #A-2291 als PDF. Unser Zahlungsziel war der 30. Juni – bitte gleichen Sie den Betrag bis Freitag aus, dann entfällt die Mahngebühr.\n\nBeste Grüße\nSelin Kaya\nNordwind Studio — Design & Branding",
    webUrl: "https://mail.google.com/mail/#drafts",
    signatureAppended: true,
  },
});
// The fixture draft carries every required field, so the builder never returns
// undefined here — assert it so the card list stays AgentCard[].
if (!DRAFT_CARD_OR_NONE) throw new Error("demo draft fixture is missing a required field");
const DRAFT_CARD: AgentCard = DRAFT_CARD_OR_NONE;

const ATTACHMENTS_CARD = buildAttachmentsCard({
  account: DEMO_WORK_CARD_ACCOUNT,
  subject: "Re: Rechnung #A-2291 – Zahlungserinnerung",
  items: [
    {
      accountId: DEMO_WORK_ACCOUNT_ID,
      messageId: "acme-2291-2",
      filename: "Rechnung_A-2291.pdf",
      mimeType: "application/pdf",
      size: 148_213,
      viewable: true,
      saveable: true,
    },
    {
      accountId: DEMO_WORK_ACCOUNT_ID,
      messageId: "acme-2291-2",
      filename: "Angebot_Rebranding.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 21_004,
      viewable: false,
      saveable: true,
    },
  ],
});

const BRIEFING_ITEMS: BriefingItem[] = [
  {
    threadId: "thread-acme-2291",
    accountId: DEMO_WORK_ACCOUNT_ID,
    sender: "Thomas Brandt",
    senderEmail: "t.brandt@acme-gmbh.de",
    subject: "Re: Rechnung #A-2291 – Zahlungserinnerung",
    gist: "Bittet erneut um die Rechnung als PDF, sonst folgt eine Mahngebühr.",
    priority: "urgent",
    deadline: "Freitag 17:00",
    draftId: "demo-draft-acme-2291",
  },
  {
    threadId: "thread-seeblick-august",
    accountId: DEMO_PERSONAL_ACCOUNT_ID,
    sender: "Sabine Möller",
    subject: "Ferienwohnung Seeblick – Buchung im August",
    gist: "Fragt nach der Adresse für die Buchungsbestätigung.",
    priority: "reply",
  },
  {
    threadId: "thread-zahnarzt",
    accountId: DEMO_PERSONAL_ACCOUNT_ID,
    sender: "Zahnarztpraxis Dr. Yıldız",
    subject: "Terminerinnerung nächste Woche",
    gist: "Termin muss bis Mittwoch bestätigt oder abgesagt werden.",
    priority: "action",
    deadline: "Mittwoch",
  },
  {
    threadId: "thread-team-update",
    accountId: DEMO_WORK_ACCOUNT_ID,
    sender: "Team Nordwind",
    subject: "Wöchentliches Update",
    gist: "Kurzer Statusbericht, keine Rückmeldung nötig.",
    priority: "fyi",
  },
];

const BRIEFING_CARD = buildBriefingCard({
  headline: "Zwei Dinge brauchen dich heute.",
  periodLabel: "seit gestern Morgen",
  accounts: [DEMO_WORK_CARD_ACCOUNT, DEMO_PERSONAL_CARD_ACCOUNT],
  scanned: 43,
  items: BRIEFING_ITEMS,
  rollups: [
    {
      label: "Newsletter & Quittungen",
      items: [
        {
          threadId: "roll-spotify",
          accountId: DEMO_WORK_ACCOUNT_ID,
          sender: "Spotify",
          subject: "Dein Wochenmix ist da",
          gist: "Neue Playlist-Empfehlungen.",
          priority: "fyi",
        },
        {
          threadId: "roll-apple",
          accountId: DEMO_PERSONAL_ACCOUNT_ID,
          sender: "Apple",
          subject: "Deine Rechnung von Apple",
          gist: "iCloud+ 0,99 € abgebucht.",
          priority: "fyi",
        },
      ],
    },
  ],
});

const CHOICE_OPTIONS: ChoiceOption[] = [
  {
    label: "Rechnung #A-2291 – Zahlungserinnerung",
    detail: "Thomas Brandt · offen",
    ref: {
      threadId: "thread-acme-2291",
      accountId: DEMO_WORK_ACCOUNT_ID,
      accountName: "selin@nordwind-studio.de",
      subject: "Re: Rechnung #A-2291 – Zahlungserinnerung",
      from: "Thomas Brandt <t.brandt@acme-gmbh.de>",
    },
  },
  {
    label: "Rechnung #A-2204",
    detail: "Buchhaltung Acme · bezahlt",
    ref: {
      threadId: "thread-acme-2204",
      accountId: DEMO_WORK_ACCOUNT_ID,
      accountName: "selin@nordwind-studio.de",
      subject: "Acme GmbH – Rechnung #A-2204",
      from: "Buchhaltung Acme <buchhaltung@acme-gmbh.de>",
    },
  },
  {
    label: "Weder noch — zeig mir alle Rechnungen von Acme",
    reply: "Zeig mir alle Rechnungs-E-Mails von Acme GmbH über alle Konten.",
  },
];

const CHOICES_CARD = buildChoicesCard("Welche Rechnung von Acme meinst du?", CHOICE_OPTIONS);

const MARKDOWN_REPLY = `### Was heute wichtig ist

**Acme GmbH** hat auf die Zahlungserinnerung geantwortet — Thomas Brandt bittet um die Rechnung als PDF.

- Antwortentwurf liegt bereit
- Buchhaltung ist in Cc
- Zahlungsziel war der 30. Juni

Sag Bescheid, wenn ich den Entwurf abschicken soll.`;

/** All golden chats, newest-feeling first. Ids/titles are `demo-*`/`[demo]…` so the reset finds them. */
export function demoGoldenChats(): DemoChat[] {
  const chats: Array<{ slug: string; title: string; messages: DemoChatMessage[] }> = [
    {
      slug: "search-hits",
      title: "[demo] Rechnungen von Acme suchen",
      messages: [
        { role: "user", content: "Such mir alle Rechnungen von Acme." },
        {
          role: "assistant",
          content: "Drei Treffer — die offene #A-2291 ist die dringende.",
          cards: withCards(HITS_CARD),
        },
      ],
    },
    {
      slug: "thread",
      title: "[demo] Ferienwohnung Seeblick",
      messages: [
        { role: "user", content: "Zeig mir den Verlauf mit der Ferienwohnung." },
        {
          role: "assistant",
          content: "Hier der ganze Verlauf — Frau Möller wartet nur noch auf deine Adresse.",
          cards: withCards(THREAD_CARD),
        },
      ],
    },
    {
      slug: "draft",
      title: "[demo] Antwort an Acme entwerfen",
      messages: [
        { role: "user", content: "Entwirf eine Antwort an Herrn Brandt zur Rechnung." },
        {
          role: "assistant",
          content: "Entwurf liegt bereit, Buchhaltung ist in Cc.",
          cards: withCards(DRAFT_CARD),
        },
      ],
    },
    {
      slug: "attachments",
      title: "[demo] Anhänge der Acme-Rechnung",
      messages: [
        { role: "user", content: "Was hängt an der Acme-Mail dran?" },
        {
          role: "assistant",
          content: "Zwei Anhänge — die Rechnung als PDF und das Rebranding-Angebot.",
          cards: withCards(ATTACHMENTS_CARD),
        },
      ],
    },
    {
      slug: "briefing",
      title: "[demo] Morgen-Briefing",
      messages: [
        { role: "user", content: "Was ist heute wichtig?" },
        {
          role: "assistant",
          content:
            "Zwei Dinge brauchen dich zuerst: die Acme-Rechnung und die Adresse für Seeblick.",
          cards: withCards(BRIEFING_CARD),
        },
      ],
    },
    {
      slug: "choices",
      title: "[demo] Rückfrage: welche Rechnung",
      messages: [
        { role: "user", content: "Zeig mir die Acme-Rechnung." },
        {
          role: "assistant",
          content: "Welche meinst du?",
          cards: withCards(CHOICES_CARD),
        },
      ],
    },
    {
      slug: "empty-hits",
      title: "[demo] Suche ohne Treffer",
      messages: [
        { role: "user", content: "Hab ich eine Kündigungsbestätigung vom Fitnessstudio?" },
        {
          role: "assistant",
          content: "Dazu finde ich nichts in deinem Postfach.",
          cards: withCards(EMPTY_HITS_CARD),
        },
      ],
    },
    {
      slug: "markdown",
      title: "[demo] Formatierte Antwort",
      messages: [
        { role: "user", content: "Fass zusammen, was mit Acme los ist." },
        { role: "assistant", content: MARKDOWN_REPLY },
      ],
    },
  ];
  return chats.map((c) => ({ id: `demo-chat-${c.slug}`, title: c.title, messages: c.messages }));
}
