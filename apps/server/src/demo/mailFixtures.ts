import type { EnrichmentResult } from "../email/enrich/enrichStore.js";
import type { SyncPage } from "../email/sync/syncProviders.js";
import {
  DEMO_PERSONAL_ACCOUNT_ID,
  DEMO_PERSONAL_FROM,
  DEMO_WORK_ACCOUNT_ID,
  DEMO_WORK_FROM,
} from "./accounts.js";

/**
 * The demo mailbox: a hand-authored set of threads across the two demo
 * accounts (accounts.ts), one per email use case the agent handles, in the
 * Selin Kaya / Nordwind Studio persona. `demoSyncPages` turns them into the
 * `applySyncPage` inputs that populate the mirror; `demoEnrichments` supplies
 * the canned per-thread triage the offline seed writes so the briefing /
 * triage / waiting lanes light up without an LLM.
 *
 * Provider ids are stable strings (thread/message ids the golden chats also
 * reference), so the mirror, the cards, and thread drill-downs all address the
 * same rows. Dates are anchored to a passed-in `now`; most actionable threads
 * sit within the last 24 hours so the Morning-briefing digest (which filters
 * to `sinceDays 1`) has a full spread of items, while the waiting-on-others
 * and settled receipt threads stay deliberately older.
 *
 * Fixture data — exempt from the source line cap (see CLAUDE.md).
 */

type DemoAccount = "work" | "personal";

interface DemoMessage {
  providerMessageId: string;
  /** Sender in "Name <addr>" form; when it equals the account owner it is `isFromMe`. */
  from: string;
  to: string[];
  cc?: string[];
  /** Offset back from `now`. */
  ago: { days?: number; hours?: number };
  body: string;
  isUnread?: boolean;
  listUnsubscribe?: string;
  listUnsubscribePost?: boolean;
  labels?: string[];
}

interface DemoThread {
  account: DemoAccount;
  providerThreadId: string;
  subject: string;
  /** Which agent use case this thread exercises — for the seed summary only. */
  useCase: string;
  messages: DemoMessage[];
  /** Canned triage written by the offline seed; omit to leave the thread for live enrichment. */
  enrichment?: EnrichmentResult;
}

const OWNER: Record<DemoAccount, string> = {
  work: DEMO_WORK_FROM,
  personal: DEMO_PERSONAL_FROM,
};

const ACCOUNT_ID: Record<DemoAccount, string> = {
  work: DEMO_WORK_ACCOUNT_ID,
  personal: DEMO_PERSONAL_ACCOUNT_ID,
};

const LIST_UNSUB = (address: string) =>
  `<mailto:${address}>, <https://${address.split("@")[1]}/unsub>`;

const THREADS: DemoThread[] = [
  // WORK — needs reply, urgent, with attachments and a deadline.
  {
    account: "work",
    providerThreadId: "thread-acme-2291",
    subject: "Re: Rechnung #A-2291 – Zahlungserinnerung",
    useCase: "needs-reply · urgent · attachments · deadline",
    messages: [
      {
        providerMessageId: "acme-2291-1",
        from: DEMO_WORK_FROM,
        to: ["t.brandt@acme-gmbh.de"],
        cc: ["buchhaltung@acme-gmbh.de"],
        ago: { days: 5 },
        body: "Hallo Herr Brandt,\n\nanbei nochmal die Rechnung #A-2291 als PDF. Zahlungsziel war der 30. Juni.\n\nBeste Grüße\nSelin Kaya",
      },
      {
        providerMessageId: "acme-2291-2",
        from: "Thomas Brandt <t.brandt@acme-gmbh.de>",
        to: [`Selin Kaya <selin@nordwind-studio.de>`],
        ago: { hours: 5 },
        isUnread: true,
        body: "Guten Tag Frau Kaya,\n\nwir haben Ihre Rechnung noch nicht im System. Könnten Sie diese bitte bis Freitag erneut senden? Andernfalls müssen wir eine Mahngebühr verbuchen.\n\nMit freundlichen Grüßen\nThomas Brandt\nAcme GmbH",
      },
    ],
    enrichment: {
      gist: "Bittet erneut um die Rechnung als PDF, sonst folgt eine Mahngebühr.",
      summary:
        "Acme hat die zugesandte Rechnung #A-2291 nicht im System und bittet um erneute Zusendung bis Freitag, sonst wird eine Mahngebühr fällig.",
      actionItems: ["Rechnung #A-2291 erneut als PDF senden", "Buchhaltung in Cc halten"],
      triage: "needs_reply",
      urgency: "high",
      deadline: "Freitag 17:00",
      awaitingReply: false,
    },
  },
  // WORK — done / receipt, no action.
  {
    account: "work",
    providerThreadId: "thread-acme-2204",
    subject: "Acme GmbH – Rechnung #A-2204",
    useCase: "done · receipt",
    messages: [
      {
        providerMessageId: "acme-2204",
        from: "Buchhaltung Acme <buchhaltung@acme-gmbh.de>",
        to: [`Selin Kaya <selin@nordwind-studio.de>`],
        ago: { days: 31 },
        body: "Vielen Dank für die Zusammenarbeit. Die Zahlung für Mai (#A-2204) wurde soeben veranlasst.",
      },
    ],
    enrichment: {
      gist: "Zahlungsbestätigung für Rechnung #A-2204 – erledigt.",
      summary: "Acmes Buchhaltung bestätigt die Zahlung der Mai-Rechnung. Keine Handlung nötig.",
      actionItems: [],
      triage: "done",
      urgency: "low",
      awaitingReply: false,
    },
  },
  // WORK — needs reply, a client rückfrage.
  {
    account: "work",
    providerThreadId: "thread-rebrand-elif",
    subject: "Angebot Rebranding – Rückfragen",
    useCase: "needs-reply",
    messages: [
      {
        providerMessageId: "rebrand-elif-1",
        from: "Elif Aydın <elif.aydin@kreativhaus.de>",
        to: [`Selin Kaya <selin@nordwind-studio.de>`],
        ago: { hours: 8 },
        isUnread: true,
        body: "Hallo Selin,\n\ndanke für das Angebot! Bevor wir freigeben, würden wir gern zwei Layout-Varianten für die Startseite sehen. Ist das machbar?\n\nViele Grüße\nElif",
      },
    ],
    enrichment: {
      gist: "Möchte vor der Freigabe zwei Layout-Varianten der Startseite sehen.",
      summary:
        "Elif will das Rebranding-Angebot freigeben, bittet aber vorher um zwei Startseiten-Layoutvarianten.",
      actionItems: ["Zwei Layout-Varianten der Startseite vorbereiten und senden"],
      triage: "needs_reply",
      urgency: "normal",
      awaitingReply: false,
    },
  },
  // WORK — waiting on the other side (you asked, no reply yet).
  {
    account: "work",
    providerThreadId: "thread-waiting-mueller",
    subject: "Freigabe Website-Relaunch – warten auf Ihr OK",
    useCase: "waiting-on",
    messages: [
      {
        providerMessageId: "waiting-mueller-1",
        from: DEMO_WORK_FROM,
        to: ["m.mueller@mueller-partner.de"],
        ago: { days: 6 },
        body: "Hallo Herr Müller,\n\nder Relaunch ist bereit für den Livegang. Können Sie mir bitte bis Anfang der Woche Ihr finales OK geben, dann schalten wir frei?\n\nBeste Grüße\nSelin Kaya",
      },
    ],
    enrichment: {
      gist: "Du wartest auf Herrn Müllers Freigabe für den Livegang.",
      summary:
        "Du hast Herrn Müller um das finale OK für den Website-Relaunch gebeten; seit sechs Tagen keine Antwort.",
      actionItems: ["Ggf. bei Herrn Müller nachfassen"],
      triage: "waiting_on",
      urgency: "normal",
      awaitingReply: true,
    },
  },
  // WORK — fyi team update.
  {
    account: "work",
    providerThreadId: "thread-team-update",
    subject: "Wöchentliches Update",
    useCase: "fyi",
    messages: [
      {
        providerMessageId: "team-update-1",
        from: "Team Nordwind <team@nordwind-studio.de>",
        to: [`Selin Kaya <selin@nordwind-studio.de>`],
        ago: { hours: 12 },
        body: "Kurzer Statusbericht der Woche: Projekt Acme in Rechnungsklärung, Rebranding wartet auf Kundenfeedback, Relaunch startklar. Keine Rückmeldung nötig.",
      },
    ],
    enrichment: {
      gist: "Wöchentlicher Statusbericht, keine Rückmeldung nötig.",
      summary: "Interner Wochenstatus zu den laufenden Projekten. Rein informativ.",
      actionItems: [],
      triage: "fyi",
      urgency: "low",
      awaitingReply: false,
    },
  },
  // WORK — newsletter with a real List-Unsubscribe header.
  {
    account: "work",
    providerThreadId: "roll-spotify",
    subject: "Dein Wochenmix ist da",
    useCase: "newsletter · unsubscribe",
    messages: [
      {
        providerMessageId: "spotify-1",
        from: "Spotify <no-reply@spotify.com>",
        to: [`Selin Kaya <selin@nordwind-studio.de>`],
        ago: { hours: 18 },
        body: "Deine wöchentlichen Playlist-Empfehlungen sind da. Viel Spaß beim Hören!",
        listUnsubscribe: LIST_UNSUB("unsubscribe@spotify.com"),
        listUnsubscribePost: true,
      },
    ],
    enrichment: {
      gist: "Playlist-Empfehlungen von Spotify.",
      summary: "Wöchentlicher Musik-Newsletter. Rein informativ.",
      actionItems: [],
      triage: "fyi",
      urgency: "low",
      awaitingReply: false,
    },
  },

  // PERSONAL — needs reply, multi-message booking thread.
  {
    account: "personal",
    providerThreadId: "thread-seeblick-august",
    subject: "Ferienwohnung Seeblick – Buchung im August",
    useCase: "needs-reply · long thread",
    messages: [
      {
        providerMessageId: "seeblick-1",
        from: "Sabine Möller <sabine.moeller@seeblick-ferien.de>",
        to: [`Selin Kaya <selin.kaya.mail@gmail.com>`],
        ago: { hours: 22 },
        body: "Liebe Frau Kaya,\n\nvielen Dank für Ihre Anfrage. Die Wohnung ist vom 8. bis 15. August noch frei, 95 € pro Nacht inkl. Endreinigung.\n\nViele Grüße\nSabine Möller",
      },
      {
        providerMessageId: "seeblick-2",
        from: DEMO_PERSONAL_FROM,
        to: ["sabine.moeller@seeblick-ferien.de"],
        ago: { hours: 20 },
        body: "Hallo Frau Möller,\n\ndas klingt gut, wir würden gern die ganze Woche buchen. Ist eine Anzahlung nötig, und gibt es einen Parkplatz?\n\nViele Grüße\nSelin Kaya",
      },
      {
        providerMessageId: "seeblick-3",
        from: "Sabine Möller <sabine.moeller@seeblick-ferien.de>",
        to: [`Selin Kaya <selin.kaya.mail@gmail.com>`],
        ago: { hours: 14 },
        isUnread: true,
        body: "Liebe Frau Kaya,\n\nsehr gerne, ich reserviere die Woche. 30 % Anzahlung (rund 200 €) reichen, Parkplatz ist inklusive. Schicken Sie mir bitte noch Ihre Adresse für die Buchungsbestätigung.\n\nViele Grüße\nSabine Möller",
      },
    ],
    enrichment: {
      gist: "Fragt nach der Adresse für die Buchungsbestätigung.",
      summary:
        "Die Ferienwohnung ist für die Woche reserviert; Frau Möller braucht noch deine Adresse für die Bestätigung, Anzahlung 30 %.",
      actionItems: ["Adresse für die Buchungsbestätigung senden"],
      triage: "needs_reply",
      urgency: "normal",
      awaitingReply: false,
    },
  },
  // PERSONAL — needs action with a deadline.
  {
    account: "personal",
    providerThreadId: "thread-zahnarzt",
    subject: "Terminerinnerung nächste Woche",
    useCase: "needs-action · deadline",
    messages: [
      {
        providerMessageId: "zahnarzt-1",
        from: "Zahnarztpraxis Dr. Yıldız <praxis@zahnarzt-yildiz.de>",
        to: [`Selin Kaya <selin.kaya.mail@gmail.com>`],
        ago: { hours: 10 },
        isUnread: true,
        body: "Guten Tag Frau Kaya,\n\nwir erinnern an Ihren Kontrolltermin am kommenden Donnerstag um 09:30. Bitte bestätigen oder stornieren Sie bis Mittwoch.\n\nIhre Praxis Dr. Yıldız",
      },
    ],
    enrichment: {
      gist: "Termin muss bis Mittwoch bestätigt oder abgesagt werden.",
      summary: "Kontrolltermin am Donnerstag 09:30; Bestätigung oder Absage bis Mittwoch nötig.",
      actionItems: ["Zahnarzttermin bis Mittwoch bestätigen oder absagen"],
      triage: "needs_action",
      urgency: "normal",
      deadline: "Mittwoch",
      awaitingReply: false,
    },
  },
  // PERSONAL — newsletter with unsubscribe.
  {
    account: "personal",
    providerThreadId: "thread-fitzone-hours",
    subject: "Neue Öffnungszeiten ab August",
    useCase: "newsletter · unsubscribe",
    messages: [
      {
        providerMessageId: "fitzone-1",
        from: "FitZone Studio <news@fitzone.de>",
        to: [`Selin Kaya <selin.kaya.mail@gmail.com>`],
        ago: { days: 2 },
        body: "Ab August gelten neue Öffnungszeiten: Mo–Fr 6–23 Uhr, Sa/So 8–20 Uhr. Reine Information.",
        listUnsubscribe: LIST_UNSUB("abmelden@fitzone.de"),
      },
    ],
    enrichment: {
      gist: "Neue Öffnungszeiten – reine Information.",
      summary: "FitZone informiert über geänderte Öffnungszeiten ab August. Keine Handlung nötig.",
      actionItems: [],
      triage: "fyi",
      urgency: "low",
      awaitingReply: false,
    },
  },
  // PERSONAL — newsletter with unsubscribe.
  {
    account: "personal",
    providerThreadId: "roll-duolingo",
    subject: "Vergiss deinen Streak nicht!",
    useCase: "newsletter · unsubscribe",
    messages: [
      {
        providerMessageId: "duolingo-1",
        from: "Duolingo <hallo@duolingo.com>",
        to: [`Selin Kaya <selin.kaya.mail@gmail.com>`],
        ago: { hours: 20 },
        body: "Vergiss deinen Streak nicht – übe heute noch fünf Minuten Spanisch!",
        listUnsubscribe: LIST_UNSUB("unsubscribe@duolingo.com"),
        listUnsubscribePost: true,
      },
    ],
    enrichment: {
      gist: "Erinnerung, heute zu üben.",
      summary: "Automatische Lern-Erinnerung. Rein informativ.",
      actionItems: [],
      triage: "fyi",
      urgency: "low",
      awaitingReply: false,
    },
  },
  // PERSONAL — receipt.
  {
    account: "personal",
    providerThreadId: "roll-apple",
    subject: "Deine Rechnung von Apple",
    useCase: "receipt",
    messages: [
      {
        providerMessageId: "apple-1",
        from: "Apple <no_reply@email.apple.com>",
        to: [`Selin Kaya <selin.kaya.mail@gmail.com>`],
        ago: { hours: 16 },
        body: "Deine Rechnung: iCloud+ 50 GB, 0,99 €. Vielen Dank für deinen Einkauf.",
      },
    ],
    enrichment: {
      gist: "iCloud+ 0,99 € abgebucht.",
      summary: "Monatliche Apple-Rechnung für iCloud+. Beleg, keine Handlung nötig.",
      actionItems: [],
      triage: "done",
      urgency: "low",
      awaitingReply: false,
    },
  },
];

/** Anchor a DemoMessage's offset to an absolute ISO timestamp. */
function isoFromAgo(now: Date, ago: { days?: number; hours?: number }): string {
  const ms = (ago.days ?? 0) * 86_400_000 + (ago.hours ?? 0) * 3_600_000;
  return new Date(now.getTime() - ms).toISOString();
}

function snippetOf(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > 140 ? `${flat.slice(0, 139)}…` : flat;
}

/** One `applySyncPage` input per demo account, ready to mirror. */
export function demoSyncPages(now: Date): Array<{ accountId: string; page: SyncPage }> {
  const byAccount = new Map<string, SyncPage>();
  for (const account of ["work", "personal"] as const) {
    byAccount.set(ACCOUNT_ID[account], { upserts: [], deletes: [], cursor: "", hasMore: false });
  }
  for (const thread of THREADS) {
    const accountId = ACCOUNT_ID[thread.account];
    const page = byAccount.get(accountId);
    if (!page) continue;
    for (const m of thread.messages) {
      page.upserts.push({
        providerMessageId: m.providerMessageId,
        providerThreadId: thread.providerThreadId,
        subject: thread.subject,
        from: m.from,
        to: m.to,
        cc: m.cc ?? [],
        date: isoFromAgo(now, m.ago),
        snippet: snippetOf(m.body),
        bodyText: m.body,
        isFromMe: m.from === OWNER[thread.account],
        isUnread: m.isUnread ?? false,
        labels: m.labels ?? [],
        ...(m.listUnsubscribe ? { listUnsubscribe: m.listUnsubscribe } : {}),
        ...(m.listUnsubscribePost !== undefined
          ? { listUnsubscribePost: m.listUnsubscribePost }
          : {}),
      });
    }
  }
  return [...byAccount.entries()].map(([accountId, page]) => ({ accountId, page }));
}

/** Canned per-thread triage, keyed by mirror thread id (`accountId:providerThreadId`). */
export function demoEnrichments(): Array<{
  accountId: string;
  providerThreadId: string;
  result: EnrichmentResult;
}> {
  return THREADS.filter((t) => t.enrichment !== undefined).map((t) => ({
    accountId: ACCOUNT_ID[t.account],
    providerThreadId: t.providerThreadId,
    result: t.enrichment as EnrichmentResult,
  }));
}

/** Human-readable coverage list for the seed summary. */
export function demoUseCaseSummary(): Array<{ thread: string; useCase: string }> {
  return THREADS.map((t) => ({ thread: t.subject, useCase: t.useCase }));
}
