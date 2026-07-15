/*
 * Static fixtures the showcase's feature components render. Part of the DEV
 * showcase; safe to delete with the folder.
 */

import type {
  AccountColor,
  AccountDrafts,
  Automation,
  EmailThreadMessage,
  OpenConversations,
} from "@trailin/shared";

const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000).toISOString();

/** Account ids match `samples.ts`, so the chat cards pick these dots up. */
export const DEMO_COLORS: AccountColor[] = [
  { accountId: "demo-work", hex: "#4f46e5" },
  { accountId: "demo-personal", hex: "#0d9488" },
];

export const DEMO_DRAFTS: AccountDrafts[] = [
  {
    account: "selin@nordwind-studio.de",
    accountId: "demo-work",
    drafts: [
      {
        id: "draft-acme-2291-reply",
        messageId: "msg-acme-2291-2",
        threadId: "thread-acme-2291",
        subject: "Re: Rechnung #A-2291 – Zahlungserinnerung",
        to: "t.brandt@acme-gmbh.de",
        date: hoursAgo(3),
        webUrl: "#",
        snippet: "Anbei nochmal Rechnung #A-2291 als PDF. Unser Zahlungsziel war der 30. Juni.",
      },
    ],
  },
];

export const DEMO_WAITING: OpenConversations = {
  waitingOnYou: [
    {
      account: "selin@nordwind-studio.de",
      accountId: "demo-work",
      items: [
        {
          threadId: "thread-onboarding-elif",
          accountId: "demo-work",
          subject: "Re: Onboarding-Termin nächste Woche",
          counterpart: "Elif Aydın",
          gist: "Fragt nach einem Termin für das Onboarding-Gespräch am Donnerstag.",
          urgency: "high",
          webUrl: "#",
        },
      ],
    },
  ],
  waitingOnOthers: [
    {
      account: "selin@nordwind-studio.de",
      accountId: "demo-work",
      items: [
        {
          threadId: "thread-rebrand-elif",
          subject: "Angebot Rebranding – Rückfragen",
          counterpart: "Elif Aydın",
          lastSentAt: hoursAgo(72),
          webUrl: "#",
        },
      ],
    },
    {
      account: "selin.kaya.mail@gmail.com",
      accountId: "demo-personal",
      items: [
        {
          threadId: "thread-seeblick-august",
          subject: "Ferienwohnung Seeblick – Buchung im August",
          counterpart: "Sabine Möller",
          lastSentAt: hoursAgo(30),
          webUrl: "#",
        },
      ],
    },
  ],
};

export const DEMO_AUTOMATIONS: Automation[] = [
  {
    id: "auto-briefing",
    name: "Morning briefing",
    instruction: "Summarise what needs my attention across both inboxes.",
    schedule: "0 8 * * 1-5",
    enabled: true,
    showInActivity: true,
    pinned: true,
    createdAt: hoursAgo(720),
    nextRunAt: new Date(Date.now() + 5 * 3_600_000).toISOString(),
  },
];

export const DEMO_THREAD: EmailThreadMessage[] = [
  {
    from: "Sabine Möller <sabine.moeller@seeblick-ferien.de>",
    to: ["selin.kaya.mail@gmail.com"],
    date: hoursAgo(52),
    body: "Die Wohnung ist vom 8. bis 15. August noch frei — 95 € pro Nacht inkl. Endreinigung.",
  },
  {
    from: "Selin Kaya <selin.kaya.mail@gmail.com>",
    to: ["sabine.moeller@seeblick-ferien.de"],
    date: hoursAgo(48),
    body: "Das klingt gut, wir würden gerne für die ganze Woche buchen. Ist eine Anzahlung nötig?",
  },
  {
    from: "Sabine Möller <sabine.moeller@seeblick-ferien.de>",
    to: ["selin.kaya.mail@gmail.com"],
    date: hoursAgo(30),
    body: "Sehr gerne — 30 % Anzahlung reicht, der Rest ist bei Anreise fällig.",
  },
];

/** The file-type ink family. The hue is the only thing that varies per format. */
export const FILETYPES: { label: string; hue: number }[] = [
  { label: "PDF", hue: 25 },
  { label: "DOCX", hue: 256 },
  { label: "XLSX", hue: 150 },
  { label: "PNG", hue: 300 },
  { label: "MD", hue: 70 },
];

export const MARKDOWN_DEMO = `### What the assistant's replies render as

**Acme GmbH** replied to the payment reminder — Thomas Brandt
([t.brandt@acme-gmbh.de](mailto:t.brandt@acme-gmbh.de)) wants the invoice as a PDF.

- A reply draft is waiting in your mailbox
- Accounting is in Cc
- Payment was due 30 June

| Account | Unread | Drafts |
| --- | ---: | ---: |
| Work | 4 | 1 |
| Personal | 2 | 1 |

More context lives at [nordwind-studio.de](https://nordwind-studio.de).`;
