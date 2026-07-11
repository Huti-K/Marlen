import type { AgentCard, CardAccount } from "@trailin/shared";

/**
 * Sample data for the `/showcase` chat command: one turn per kind of thing the
 * assistant can render in chat — tool-activity chips, every card (including
 * the empty state), a formatted markdown reply, and the thinking shimmer.
 *
 * Email content is written in a consistent sample persona's voice: Selin
 * Kaya, Nordwind Studio co-founder, juggling a billing dispute with Acme
 * GmbH on her work inbox and a holiday booking on her personal one.
 * Commentary between samples is localized via `contentKey`. `imgSrc` is
 * left unset — this also exercises AccountChip's icon fallback.
 */

export type ShowcaseTurn = {
  /** i18n key for UI-language commentary; wins over `content`. */
  contentKey?: string;
  /** Literal sample content (sample-persona German). */
  content?: string;
  toolCalls?: { name: string; isError: boolean; done: boolean }[];
  cards?: AgentCard[];
  /** Renders the streaming "thinking…" state. */
  thinking?: boolean;
};

const WORK_ACCOUNT: CardAccount = {
  accountId: "demo-work",
  name: "selin@nordwind-studio.de",
  app: "gmail",
  appName: "Gmail",
};

const PERSONAL_ACCOUNT: CardAccount = {
  accountId: "demo-personal",
  name: "selin.kaya.mail@gmail.com",
  app: "gmail",
  appName: "Gmail",
};

const HITS_CARD: AgentCard = {
  kind: "email_hits",
  account: WORK_ACCOUNT,
  query: "Acme Rechnung",
  truncated: true,
  hits: [
    {
      messageId: "msg-acme-2291-2",
      threadId: "thread-acme-2291",
      subject: "Re: Rechnung #A-2291 – Zahlungserinnerung",
      from: "Thomas Brandt <t.brandt@acme-gmbh.de>",
      to: ["selin@nordwind-studio.de"],
      date: "2026-07-08T09:14:00.000Z",
      snippet:
        "Guten Tag Frau Kaya, wir haben Ihre Rechnung noch nicht im System, könnten Sie diese erneut senden?",
    },
    {
      messageId: "msg-acme-2291-1",
      threadId: "thread-acme-2291",
      subject: "Re: Rechnung #A-2291 – Zahlungserinnerung",
      from: "Selin Kaya <selin@nordwind-studio.de>",
      to: ["t.brandt@acme-gmbh.de"],
      date: "2026-07-07T16:40:00.000Z",
      snippet:
        "Hallo Herr Brandt, anbei nochmal die Rechnung als PDF. Zahlungsziel war der 30. Juni.",
    },
    {
      messageId: "msg-acme-2204",
      threadId: "thread-acme-2204",
      subject: "Acme GmbH – Rechnung #A-2204",
      from: "Buchhaltung Acme <buchhaltung@acme-gmbh.de>",
      to: ["selin@nordwind-studio.de"],
      date: "2026-06-14T11:02:00.000Z",
      snippet: "Vielen Dank für die Zusammenarbeit. Die Zahlung für Mai wurde soeben veranlasst.",
    },
  ],
};

/** Zero hits — exercises the card's empty branch. */
const EMPTY_HITS_CARD: AgentCard = {
  kind: "email_hits",
  account: PERSONAL_ACCOUNT,
  query: "Kündigungsbestätigung Fitnessstudio",
  truncated: false,
  hits: [],
};

const THREAD_CARD: AgentCard = {
  kind: "email_thread",
  account: PERSONAL_ACCOUNT,
  threadId: "thread-seeblick-august",
  subject: "Ferienwohnung Seeblick – Buchung im August",
  messages: [
    {
      from: "Sabine Möller <sabine.moeller@seeblick-ferien.de>",
      to: ["selin.kaya.mail@gmail.com"],
      date: "2026-06-28T10:15:00.000Z",
      body: "Liebe Frau Kaya,\n\nvielen Dank für Ihre Anfrage. Die Wohnung ist vom 8. bis 15. August noch frei. Der Preis liegt bei 95 € pro Nacht inkl. Endreinigung.\n\nViele Grüße\nSabine Möller",
    },
    {
      from: "Selin Kaya <selin.kaya.mail@gmail.com>",
      to: ["sabine.moeller@seeblick-ferien.de"],
      date: "2026-06-28T14:32:00.000Z",
      body: "Hallo Frau Möller,\n\ndas klingt gut, wir würden gerne für die ganze Woche buchen. Ist eine Anzahlung nötig, und gibt es einen Parkplatz vor Ort?\n\nViele Grüße\nSelin Kaya",
    },
    {
      from: "Sabine Möller <sabine.moeller@seeblick-ferien.de>",
      to: ["selin.kaya.mail@gmail.com"],
      date: "2026-06-29T08:03:00.000Z",
      body: "Liebe Frau Kaya,\n\nsehr gerne, ich reserviere die Woche für Sie. Eine Anzahlung von 30 % (rund 200 €) reicht, der Rest ist bei Anreise fällig. Ein Parkplatz direkt am Haus ist inklusive.\n\nSchicken Sie mir gern noch Ihre Adresse für die Buchungsbestätigung.\n\nViele Grüße\nSabine Möller",
    },
  ],
};

const DRAFT_CARD: AgentCard = {
  kind: "email_draft",
  account: WORK_ACCOUNT,
  draft: {
    draftId: "draft-acme-2291-reply",
    threadId: "thread-acme-2291",
    subject: "Re: Rechnung #A-2291 – Zahlungserinnerung",
    to: ["t.brandt@acme-gmbh.de"],
    cc: ["buchhaltung@acme-gmbh.de"],
    body: "Hallo Herr Brandt,\n\nanbei nochmal Rechnung #A-2291 als PDF. Unser Zahlungsziel war der 30. Juni. Bitte gleichen Sie den Betrag bis Ende der Woche aus, sonst müssen wir eine Mahngebühr berechnen.\n\nBeste Grüße\nSelin Kaya\nNordwind Studio — Design & Branding\nnordwind-studio.de",
    webUrl:
      "https://mail.google.com/mail/?authuser=selin%40nordwind-studio.de#drafts?compose=draft-acme-2291-reply",
    signatureAppended: true,
  },
};

/** The structured Morning-briefing card — flat and cross-account, mixing the
 *  work and personal demo inboxes so the priority-first layout has something
 *  to prove. Reuses the Acme thread/draft ids from HITS_CARD/DRAFT_CARD and
 *  the Seeblick thread id from THREAD_CARD, so the "Review draft"/"Ask about
 *  this" quick actions land on the same demo data those cards already show. */
const BRIEFING_CARD: AgentCard = {
  kind: "briefing",
  headline: "Zwei Dinge brauchen dich heute.",
  periodLabel: "seit gestern Morgen",
  accounts: [WORK_ACCOUNT, PERSONAL_ACCOUNT],
  scanned: 43,
  items: [
    {
      threadId: "thread-acme-2291",
      accountId: "demo-work",
      sender: "Thomas Brandt",
      senderEmail: "t.brandt@acme-gmbh.de",
      subject: "Re: Rechnung #A-2291 – Zahlungserinnerung",
      gist: "Bittet erneut um die Rechnung als PDF, sonst folgt eine Mahngebühr.",
      priority: "urgent",
      deadline: "Freitag 17:00",
      draftId: "draft-acme-2291-reply",
    },
    {
      threadId: "thread-seeblick-august",
      accountId: "demo-personal",
      sender: "Sabine Möller",
      senderEmail: "sabine.moeller@seeblick-ferien.de",
      subject: "Ferienwohnung Seeblick – Buchung im August",
      gist: "Fragt nach der Adresse für die Buchungsbestätigung.",
      priority: "reply",
    },
    {
      threadId: "thread-rebrand-elif",
      accountId: "demo-work",
      sender: "Elif Aydın",
      subject: "Angebot Rebranding – Rückfragen",
      gist: "Möchte vor der Freigabe zwei Layout-Varianten sehen.",
      priority: "reply",
    },
    {
      threadId: "thread-zahnarzt",
      accountId: "demo-personal",
      sender: "Zahnarztpraxis Dr. Yıldız",
      subject: "Terminerinnerung nächste Woche",
      gist: "Termin muss bis Mittwoch bestätigt oder abgesagt werden.",
      priority: "action",
      deadline: "Mittwoch",
    },
    {
      threadId: "thread-team-update",
      accountId: "demo-work",
      sender: "Team Nordwind",
      subject: "Wöchentliches Update",
      gist: "Kurzer Statusbericht, keine Rückmeldung nötig.",
      priority: "fyi",
    },
    {
      threadId: "thread-fitzone-hours",
      accountId: "demo-personal",
      sender: "FitZone Studio",
      subject: "Neue Öffnungszeiten ab August",
      gist: "Reine Information, keine Handlung nötig.",
      priority: "fyi",
    },
  ],
  rollups: [
    {
      accountId: "demo-work",
      label: "Newsletter & Angebote",
      count: 12,
      examples: ["Spotify", "Duolingo", "Zalando"],
    },
    {
      accountId: "demo-personal",
      label: "Quittungen",
      count: 5,
    },
  ],
};

/** A clarifying question the agent asks when a request is ambiguous — one
 *  option per candidate email plus a third that opts out of both, reusing
 *  the Acme invoice thread ids from HITS_CARD so its ref points at real
 *  demo data. */
const CHOICES_CARD: AgentCard = {
  kind: "choices",
  question: "Welche Rechnung von Acme meinst du?",
  options: [
    {
      label: "Rechnung #A-2291 – Zahlungserinnerung",
      detail: "Thomas Brandt · 8. Juli",
      ref: {
        threadId: "thread-acme-2291",
        accountId: "demo-work",
        accountName: "selin@nordwind-studio.de",
        subject: "Re: Rechnung #A-2291 – Zahlungserinnerung",
        from: "Thomas Brandt <t.brandt@acme-gmbh.de>",
        date: "2026-07-08T09:14:00.000Z",
      },
    },
    {
      label: "Rechnung #A-2204",
      detail: "Buchhaltung Acme · 14. Juni",
      ref: {
        threadId: "thread-acme-2204",
        accountId: "demo-work",
        accountName: "selin@nordwind-studio.de",
        subject: "Acme GmbH – Rechnung #A-2204",
        from: "Buchhaltung Acme <buchhaltung@acme-gmbh.de>",
        date: "2026-06-14T11:02:00.000Z",
      },
    },
    {
      label: "Weder noch — zeig mir alle Rechnungen von Acme",
      reply: "Zeig mir alle Rechnungs-E-Mails von Acme GmbH über alle meine Konten hinweg.",
    },
  ],
};

/** A digest-style reply exercising the markdown vocabulary: heading, bold, mailto, list, table, link. */
const MARKDOWN_SAMPLE = `### Was heute wichtig ist

**Acme GmbH** hat auf die Zahlungserinnerung geantwortet — Thomas Brandt ([t.brandt@acme-gmbh.de](mailto:t.brandt@acme-gmbh.de)) bittet um die Rechnung als PDF.

- Antwortentwurf liegt in deinem Postfach bereit
- Buchhaltung ist in Cc
- Zahlungsziel war der 30. Juni

| Konto | Ungelesen | Entwürfe |
| --- | ---: | ---: |
| Arbeit | 4 | 1 |
| Privat | 2 | 1 |

Mehr Kontext steht auf [nordwind-studio.de](https://nordwind-studio.de).`;

export const SHOWCASE_TURNS: ShowcaseTurn[] = [
  { contentKey: "chat.showcase.intro" },
  {
    contentKey: "chat.showcase.toolsNote",
    toolCalls: [
      { name: "gmail-find-email", isError: false, done: true },
      { name: "outlook-list-drafts", isError: false, done: false },
      { name: "notion-search-pages", isError: true, done: true },
    ],
  },
  { cards: [HITS_CARD, THREAD_CARD, DRAFT_CARD, EMPTY_HITS_CARD] },
  { cards: [BRIEFING_CARD] },
  { cards: [CHOICES_CARD] },
  { content: MARKDOWN_SAMPLE },
  { thinking: true },
];
