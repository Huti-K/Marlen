import {
  DEMO_PERSONAL_ACCOUNT_ID,
  DEMO_UNI_ACCOUNT_ID,
  DEMO_WORK_ACCOUNT_ID,
} from "./accounts.js";

/**
 * All hand-authored demo content: a consistent cast reused across digests,
 * drafts, chats, memories and library docs so continuity questions in the
 * demo ("what happened with the Acme invoice?") have a real answer.
 *
 * Cast — personal (selin.kaya.mail@gmail.com): Ayşe Kaya (mother), Deniz Kaya
 * (brother), Elif Aydın (friend), Kerem Aksu (friend), Sabine Möller
 * (landlord, Ferienwohnung Seeblick), Lena Vogt (recruiter, TalentBridge).
 * Work (selin@nordwind-studio.de, Nordwind Studio — co-founder Jonas Weber):
 * Thomas Brandt (Acme GmbH, a difficult client with a recurring billing
 * dispute), Mara Lindqvist (freelance accountant), Felix Rieger (Kaltwasser
 * & Rieger Architekten, a slow-paying client), Yusuf Demir (freelance dev),
 * Meredith Voss / Robert Fenner (prospects). University
 * (s.kaya@student.tu-berlin.de): Prof. Dr. Steiner (thesis supervisor),
 * Yeliz Aksoy / Matteo Rossi (fellow students).
 *
 * All dates are computed relative to `Date.now()` at seed time (server boot)
 * — nothing here is a hardcoded calendar date.
 */

export const CAST = {
  user: "Selin Kaya",
  personalEmail: "selin.kaya.mail@gmail.com",
  workEmail: "selin@nordwind-studio.de",
  uniEmail: "s.kaya@student.tu-berlin.de",
} as const;

/** A timestamp `days` ago at the given time of day — clamped so it can never land in the future. */
export function daysAgo(days: number, hour: number, minute = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  const now = new Date();
  return d > now ? new Date(now.getTime() - 5 * 60_000) : d;
}

/** Which of the last 20 days each automation actually ran on, and how. */
export type RunOutcome = "success" | "error" | "skip";
export interface DayPlan {
  daysAgo: number;
  morning: RunOutcome;
  evening: RunOutcome;
}

// Skips a few days (a quiet Sunday, a day the scheduler-equivalent history
// just has nothing for) and includes 3 error runs with plausible causes —
// hardcoded rather than dice-rolled so the demo is exactly reproducible.
export const DAY_PLAN: DayPlan[] = [
  { daysAgo: 20, morning: "success", evening: "success" },
  { daysAgo: 19, morning: "success", evening: "success" },
  { daysAgo: 18, morning: "success", evening: "success" },
  { daysAgo: 17, morning: "error", evening: "success" },
  { daysAgo: 16, morning: "success", evening: "success" },
  { daysAgo: 15, morning: "success", evening: "success" },
  { daysAgo: 14, morning: "skip", evening: "skip" },
  { daysAgo: 13, morning: "success", evening: "success" },
  { daysAgo: 12, morning: "success", evening: "skip" },
  { daysAgo: 11, morning: "success", evening: "success" },
  { daysAgo: 10, morning: "success", evening: "success" },
  { daysAgo: 9, morning: "success", evening: "error" },
  { daysAgo: 8, morning: "success", evening: "success" },
  { daysAgo: 7, morning: "skip", evening: "skip" },
  { daysAgo: 6, morning: "success", evening: "success" },
  { daysAgo: 5, morning: "success", evening: "success" },
  { daysAgo: 4, morning: "error", evening: "success" },
  { daysAgo: 3, morning: "success", evening: "skip" },
  { daysAgo: 2, morning: "success", evening: "success" },
  { daysAgo: 1, morning: "success", evening: "success" },
];

export const MORNING_ERROR_TEXT: Record<number, string> = {
  17: "Gmail API rate limit exceeded for s.kaya@student.tu-berlin.de (429 — too many requests after the other two accounts' runs backed up). Nothing was reviewed for this account; try again or wait for tomorrow's run.",
  4: "Pipedream request to selin@nordwind-studio.de timed out after 30s (Gmail API 503, upstream unavailable). The personal and university accounts were reviewed normally — see below.\n\n**selin.kaya.mail@gmail.com (Personal)**\n- Keine dringenden Nachrichten seit gestern, nur Newsletter.\n\n**s.kaya@student.tu-berlin.de (Universität)**\n- **Bibliothek TU Berlin** — Fällige Medien — 2 Bücher sind in 3 Tagen fällig, keine Aktion nötig.",
};

export const EVENING_ERROR_TEXT: Record<number, string> = {
  9: "Model request failed: upstream provider returned 529 (overloaded) after 2 retries. No mail was reviewed and no memory was updated for this run — the next scheduled run picks up where this left off.",
};

/** One digest bullet: sender/subject bolded, gist after the dash, ⚠️ for urgent. */
function bullet(who: string, subject: string, gist: string, urgent = false): string {
  return `- **${who}** — ${subject} — ${urgent ? "⚠️ " : ""}${gist}`;
}

interface AccountDigest {
  heading: string;
  items: string[];
  newsletterCount: number;
  newsletterExamples: string[];
}

function accountSection(d: AccountDigest): string {
  const lines = [...d.items];
  if (d.newsletterCount > 0) {
    lines.push(
      `- ${d.newsletterCount} Newsletter/Angebote nicht aufgeführt: ${d.newsletterExamples.join(", ")}.`,
    );
  }
  return `**${d.heading}**\n${lines.join("\n")}`;
}

interface MorningDay {
  personal: AccountDigest;
  work: AccountDigest;
  uni: AccountDigest;
  drafted: { who: string; note: string }[];
  skipped?: string;
  report: string;
}

/** Hand-authored morning briefings for every day the automation succeeded. */
const MORNING_DAYS: Record<number, MorningDay> = {
  20: {
    personal: {
      heading: "selin.kaya.mail@gmail.com (Personal)",
      items: [
        bullet(
          "Ayşe Kaya",
          "Geburtstag von Opa",
          "erinnert daran, dass Opas 80. Geburtstag in drei Wochen ist, und fragt, ob Selin dabei ist.",
        ),
        bullet(
          "Kerem Aksu",
          "Fotos vom Wochenende",
          "teilt einen Google-Photos-Link vom Ausflug letztes Wochenende, keine Antwort nötig.",
        ),
      ],
      newsletterCount: 3,
      newsletterExamples: ["Zalando Sale", "Duolingo", "Spotify"],
    },
    work: {
      heading: "selin@nordwind-studio.de (Nordwind Studio)",
      items: [
        bullet(
          "Thomas Brandt (Acme GmbH)",
          "Rückfrage zur Rechnung #A-1042",
          "findet die abgerechneten 40 Stunden für den Website-Relaunch zu hoch und bittet um eine Aufschlüsselung.",
          true,
        ),
        bullet(
          "Mara Lindqvist",
          "Rechnung 2031 verschickt",
          "bestätigt, dass Rechnung #2031 an Kaltwasser & Rieger Architekten raus ist, fällig in 14 Tagen.",
        ),
      ],
      newsletterCount: 2,
      newsletterExamples: ["Adobe Creative Cloud", "LinkedIn"],
    },
    uni: {
      heading: "s.kaya@student.tu-berlin.de (Universität)",
      items: [
        bullet(
          "Prüfungsamt TU Berlin",
          "Rückmeldung Wintersemester",
          "Rückmeldefrist mit Zahlung des Semesterbeitrags läuft am 15. ab.",
          true,
        ),
        bullet(
          "Prof. Dr. Steiner",
          "Kapitel 3 erhalten",
          "bestätigt den Erhalt des Methodik-Kapitels, Rückmeldung folgt innerhalb von zwei Wochen.",
        ),
      ],
      newsletterCount: 2,
      newsletterExamples: ["Fachschaft Informatik", "DAAD Newsletter"],
    },
    drafted: [],
    report:
      "12 Nachrichten über drei Konten gesichtet, keine Entwürfe erstellt. Die Rückmeldefrist der Uni und die Rückfrage von Acme sind die einzigen zeitkritischen Punkte, beide warten auf eine Antwort von dir.",
  },
  19: {
    personal: {
      heading: "selin.kaya.mail@gmail.com (Personal)",
      items: [
        bullet(
          "Sabine Möller",
          "Verfügbarkeit Ferienwohnung",
          "die Ferienwohnung Seeblick ist für die angefragte Woche im August frei, bittet um Bestätigung.",
        ),
      ],
      newsletterCount: 2,
      newsletterExamples: ["Deutsche Bahn Angebote", "N26 Monatsübersicht"],
    },
    work: {
      heading: "selin@nordwind-studio.de (Nordwind Studio)",
      items: [
        bullet(
          "Yusuf Demir",
          "Rechnung Acme-Projekt",
          "schickt seine Freelancer-Rechnung für die Entwicklungsarbeit am Acme-Projekt, 1.200 €.",
        ),
        bullet(
          "IONOS",
          "Domain-Verlängerung",
          "nordwind-studio.de läuft in 30 Tagen ab, automatische Verlängerung ist aktiv.",
        ),
      ],
      newsletterCount: 1,
      newsletterExamples: ["Slack Digest"],
    },
    uni: {
      heading: "s.kaya@student.tu-berlin.de (Universität)",
      items: [
        bullet(
          "Kommilitonin Yeliz Aksoy",
          "Gruppenarbeit Statistik",
          "schlägt eine gemeinsame Arbeitssitzung für die Statistik-Aufgabe vor.",
        ),
      ],
      newsletterCount: 2,
      newsletterExamples: ["Bibliotheks-Newsletter", "TU Berlin Career Service"],
    },
    drafted: [],
    report:
      "9 Nachrichten gesichtet. Die Ferienwohnung-Anfrage ist bestätigungsbereit, aber keine Antwort dringend genug für einen automatischen Entwurf.",
  },
  18: {
    personal: {
      heading: "selin.kaya.mail@gmail.com (Personal)",
      items: [
        bullet(
          "Hausverwaltung Nettbach",
          `Nebenkostenabrechnung ${new Date().getFullYear() - 1}`,
          "die jährliche Betriebskostenabrechnung ist da, eine Nachzahlung von 42 € ist fällig.",
        ),
      ],
      newsletterCount: 3,
      newsletterExamples: ["Netflix", "Zalando Sale", "Fitness Studio FitFirst"],
    },
    work: {
      heading: "selin@nordwind-studio.de (Nordwind Studio)",
      items: [
        bullet(
          "Jonas Weber",
          "Re: Acme Rechnung",
          "denkt, Acme versucht die Rechnung nur runterzuhandeln, schlägt vor, bei den 40 Stunden zu bleiben.",
          true,
        ),
        bullet(
          "Nina Krause",
          "Danke & Update",
          "bedankt sich für die Praktikumszeit bei Nordwind, hat jetzt eine Stelle bei einer Agentur.",
        ),
      ],
      newsletterCount: 2,
      newsletterExamples: ["IHK Berlin Newsletter", "Figma Updates"],
    },
    uni: {
      heading: "s.kaya@student.tu-berlin.de (Universität)",
      items: [
        bullet(
          "Auslandsamt TU Berlin",
          "Erasmus-Infoabend",
          "Einladung zu einem Infoabend, vermutlich nicht relevant.",
        ),
      ],
      newsletterCount: 2,
      newsletterExamples: ["DAAD Newsletter", "Fachschaft Informatik"],
    },
    drafted: [],
    report:
      "8 Nachrichten gesichtet, nichts Dringendes außer der internen Acme-Einschätzung von Jonas — die betrifft aber ihn und dich direkt, kein Entwurf nötig.",
  },
  16: {
    personal: {
      heading: "selin.kaya.mail@gmail.com (Personal)",
      items: [
        bullet(
          "Sabine Möller",
          "Buchungsbestätigung & Anzahlung",
          "die Ferienwohnung ist gebucht, Anzahlung von 150 € innerhalb von 5 Tagen fällig.",
          true,
        ),
      ],
      newsletterCount: 2,
      newsletterExamples: ["Deutsche Bahn Angebote", "Duolingo"],
    },
    work: {
      heading: "selin@nordwind-studio.de (Nordwind Studio)",
      items: [
        bullet(
          "Thomas Brandt (Acme GmbH)",
          "Rechnung weiterhin strittig",
          "bestreitet formal 8 der 40 abgerechneten Stunden und verlangt eine korrigierte Rechnung.",
          true,
        ),
      ],
      newsletterCount: 2,
      newsletterExamples: ["Adobe Creative Cloud", "LinkedIn"],
    },
    uni: {
      heading: "s.kaya@student.tu-berlin.de (Universität)",
      items: [
        bullet(
          "Bibliothek TU Berlin",
          "Fällige Medien",
          "2 Bücher sind in 3 Tagen fällig.",
        ),
      ],
      newsletterCount: 1,
      newsletterExamples: ["TU Berlin Career Service"],
    },
    drafted: [
      {
        who: "Sabine Möller",
        note: "Re: Buchungsbestätigung & Anzahlung — bestätigt, dass die Anzahlung heute überwiesen wird.",
      },
    ],
    report:
      "7 Nachrichten gesichtet, 1 Entwurf erstellt (Anzahlungsbestätigung an Sabine Möller). Der Acme-Streit braucht eine durchdachte Antwort, kein automatischer Entwurf — das übernimmst du besser selbst mit Jonas zusammen.",
  },
  15: {
    personal: {
      heading: "selin.kaya.mail@gmail.com (Personal)",
      items: [
        bullet(
          "Lena Vogt (TalentBridge Recruiting)",
          "Spannende Rolle als Lead Product Designer",
          "Kaltakquise zu einer Rolle bei einem Fintech-Startup, unaufgefordert.",
        ),
      ],
      newsletterCount: 2,
      newsletterExamples: ["N26 Monatsübersicht", "Berlin.de Newsletter"],
    },
    work: {
      heading: "selin@nordwind-studio.de (Nordwind Studio)",
      items: [
        bullet(
          "Robert Fenner (Fenner Immobilien)",
          "Website Relaunch Anfrage",
          "neue Anfrage, interessiert an einem Website-Relaunch, bittet um Budgetrahmen und Zeitplan.",
        ),
      ],
      newsletterCount: 1,
      newsletterExamples: ["Slack Digest"],
    },
    uni: {
      heading: "s.kaya@student.tu-berlin.de (Universität)",
      items: [
        bullet(
          "Prof. Dr. Steiner",
          "Rückmeldung Kapitel 3",
          "die Methodik braucht eine klarere Begründung der Stichprobengröße, einige Zitate fehlen.",
          true,
        ),
      ],
      newsletterCount: 1,
      newsletterExamples: ["DAAD Newsletter"],
    },
    drafted: [],
    report:
      "6 Nachrichten gesichtet, kein Entwurf. Die neue Anfrage von Robert Fenner und das Feedback von Prof. Steiner brauchen beide eine überlegte, individuelle Antwort.",
  },
  13: {
    personal: {
      heading: "selin.kaya.mail@gmail.com (Personal)",
      items: [
        bullet(
          "Elif Aydın",
          "Konzert am Freitag?",
          "fragt, ob Selin am Freitag zum Konzert im Astra mitkommt.",
        ),
        bullet(
          "Sabine Möller",
          "Zahlungseingang bestätigt",
          "die Anzahlung ist angekommen, keine Aktion nötig.",
        ),
      ],
      newsletterCount: 2,
      newsletterExamples: ["Zalando Sale", "Netflix"],
    },
    work: {
      heading: "selin@nordwind-studio.de (Nordwind Studio)",
      items: [
        bullet(
          "Thomas Brandt (Acme GmbH)",
          "Einbindung unserer Rechtsabteilung",
          "droht damit, die eigene Rechtsabteilung einzuschalten, falls die Rechnung nicht angepasst wird.",
          true,
        ),
        bullet(
          "Handelskammer Berlin",
          "Einladung Netzwerktreffen",
          "Sommer-Netzwerktreffen für Kreativunternehmen am 24., mit Anmeldung.",
        ),
      ],
      newsletterCount: 2,
      newsletterExamples: ["Adobe Creative Cloud", "IHK Berlin Newsletter"],
    },
    uni: {
      heading: "s.kaya@student.tu-berlin.de (Universität)",
      items: [
        bullet(
          "Kommilitonin Yeliz Aksoy",
          "Re: Gruppenarbeit Statistik",
          "schlägt Donnerstag 16 Uhr in der Bibliothek vor.",
        ),
      ],
      newsletterCount: 1,
      newsletterExamples: ["Fachschaft Informatik"],
    },
    drafted: [],
    report:
      "7 Nachrichten gesichtet, kein Entwurf. Die Drohung von Acme mit der Rechtsabteilung ist der wichtigste Punkt heute — das braucht eine abgestimmte Antwort mit Jonas, nicht etwas, das automatisch rausgeht.",
  },
  12: {
    personal: {
      heading: "selin.kaya.mail@gmail.com (Personal)",
      items: [
        bullet(
          "Elif Aydın",
          "Kurze Frage",
          "fragt, ob am Wochenende Zeit für einen Kaffee ist.",
        ),
      ],
      newsletterCount: 2,
      newsletterExamples: ["Zalando Sale", "Fitness Studio FitFirst"],
    },
    work: {
      heading: "selin@nordwind-studio.de (Nordwind Studio)",
      items: [
        bullet(
          "Mara Lindqvist",
          "Rechnung 2031 überfällig",
          "Rechnung an Kaltwasser & Rieger ist jetzt 3 Tage überfällig, bittet um eine freundliche Erinnerung.",
          true,
        ),
        bullet(
          "Jonas Weber",
          "Kurze Frage",
          "fragt, ob am Donnerstag kurz Zeit für ein Kunden-Telefonat ist.",
        ),
      ],
      newsletterCount: 1,
      newsletterExamples: ["Slack Digest"],
    },
    uni: {
      heading: "s.kaya@student.tu-berlin.de (Universität)",
      items: [
        bullet(
          "Bibliothek TU Berlin",
          "Online-Verlängerung möglich",
          "Hinweis, dass die aktuelle Ausleihe online verlängert werden kann.",
        ),
      ],
      newsletterCount: 2,
      newsletterExamples: ["TU Berlin Career Service", "Fachschaft Informatik"],
    },
    drafted: [
      {
        who: "Felix Rieger",
        note: "Freundliche Erinnerung: Rechnung 2031 — kurze, sachliche Zahlungserinnerung, Mara in CC.",
      },
    ],
    report:
      "6 Nachrichten gesichtet, 1 Entwurf erstellt (Zahlungserinnerung an Felix Rieger, cc Mara). Sonst nichts Dringendes.",
  },
  11: {
    personal: {
      heading: "selin.kaya.mail@gmail.com (Personal)",
      items: [
        bullet(
          "Ayşe Kaya",
          "Geschenk-Idee",
          "schlägt vor, sich mit Deniz ein gemeinsames Geschenk für Opas 80. zu teilen.",
        ),
      ],
      newsletterCount: 3,
      newsletterExamples: ["Duolingo", "Spotify", "Airbnb"],
    },
    work: {
      heading: "selin@nordwind-studio.de (Nordwind Studio)",
      items: [
        bullet(
          "Jonas Weber",
          "Entwurf Antwort Acme",
          "hat eine feste Antwort mit der detaillierten Zeiterfassung vorbereitet, bittet um dein Review vor dem Versand.",
          true,
        ),
      ],
      newsletterCount: 1,
      newsletterExamples: ["LinkedIn"],
    },
    uni: {
      heading: "s.kaya@student.tu-berlin.de (Universität)",
      items: [
        bullet(
          "Prof. Dr. Steiner",
          "Terminvorschlag",
          "schlägt zwei Termine vor, um die Überarbeitung von Kapitel 3 zu besprechen.",
        ),
      ],
      newsletterCount: 1,
      newsletterExamples: ["TU Berlin Career Service"],
    },
    drafted: [],
    report:
      "6 Nachrichten gesichtet, kein Entwurf. Jonas' Antwortentwurf an Acme wartet auf dein Review, das kann dir keiner abnehmen.",
  },
  10: {
    personal: {
      heading: "selin.kaya.mail@gmail.com (Personal)",
      items: [
        bullet(
          "Lena Vogt (TalentBridge Recruiting)",
          "Kurzes Follow-up",
          "fragt sanft nach, ob ein 15-minütiges Gespräch zur Rolle interessant wäre.",
        ),
      ],
      newsletterCount: 2,
      newsletterExamples: ["Deutsche Bahn Angebote", "N26 Monatsübersicht"],
    },
    work: {
      heading: "selin@nordwind-studio.de (Nordwind Studio)",
      items: [
        bullet(
          "Felix Rieger (Kaltwasser & Rieger)",
          "Entschuldigung, Zahlung verzögert",
          "entschuldigt sich, Zahlung von Rechnung 2031 ist urlaubsbedingt verzögert, kommt bis Ende der Woche.",
        ),
      ],
      newsletterCount: 2,
      newsletterExamples: ["Adobe Creative Cloud", "Slack Digest"],
    },
    uni: {
      heading: "s.kaya@student.tu-berlin.de (Universität)",
      items: [
        bullet(
          "TU Berlin Career Service",
          "Workshop Bewerbungsunterlagen",
          "Einladung zu einem Workshop zu Bewerbungsunterlagen, optional.",
        ),
      ],
      newsletterCount: 2,
      newsletterExamples: ["DAAD Newsletter", "Bibliotheks-Newsletter"],
    },
    drafted: [
      {
        who: "Yusuf Demir",
        note: "Re: Rechnung Acme-Projekt — bestätigt Erhalt der Rechnung, Zahlung innerhalb von 14 Tagen.",
      },
    ],
    report:
      "6 Nachrichten gesichtet, 1 Entwurf erstellt (Rechnungsbestätigung an Yusuf Demir). Bei Lena Vogt und Felix Rieger reicht ein späterer Blick, nichts davon ist zeitkritisch.",
  },
  9: {
    personal: {
      heading: "selin.kaya.mail@gmail.com (Personal)",
      items: [
        bullet(
          "Sabine Möller",
          "Anreisezeiten",
          "fragt nach Ankunftszeit und Anzahl der Gäste für die Ferienwohnung.",
        ),
      ],
      newsletterCount: 2,
      newsletterExamples: ["Zalando Sale", "Yoga Studio Mitte"],
    },
    work: {
      heading: "selin@nordwind-studio.de (Nordwind Studio)",
      items: [
        bullet(
          "Thomas Brandt (Acme GmbH)",
          "Rechnung akzeptiert — teilweise",
          "akzeptiert 90% der Rechnung, bittet aber um einen kleinen Kulanzrabatt auf die restlichen Stunden.",
          true,
        ),
      ],
      newsletterCount: 1,
      newsletterExamples: ["IHK Berlin Newsletter"],
    },
    uni: {
      heading: "s.kaya@student.tu-berlin.de (Universität)",
      items: [
        bullet(
          "Kommilitone Matteo Rossi",
          "Skript Woche 12",
          "teilt seine Mitschrift von der verpassten Vorlesung letzte Woche.",
        ),
      ],
      newsletterCount: 1,
      newsletterExamples: ["Fachschaft Informatik"],
    },
    drafted: [],
    report:
      "5 Nachrichten gesichtet, kein Entwurf. Acmes Teilzahlungsangebot ist ein kleiner Fortschritt, verdient aber eine überlegte Antwort statt eines automatischen Entwurfs.",
  },
  8: {
    personal: {
      heading: "selin.kaya.mail@gmail.com (Personal)",
      items: [
        bullet(
          "Deniz Kaya",
          "Re: Geschenk",
          "bestellt das gemeinsame Geschenk für Opa, bittet um deinen Anteil per PayPal.",
        ),
      ],
      newsletterCount: 2,
      newsletterExamples: ["Netflix", "Fitness Studio FitFirst"],
    },
    work: {
      heading: "selin@nordwind-studio.de (Nordwind Studio)",
      items: [
        bullet(
          "Design & Code Meetup Berlin",
          "Speaker-Anfrage September",
          "fragt, ob Jonas oder Selin im September einen Vortrag beim Meetup halten möchten.",
        ),
      ],
      newsletterCount: 1,
      newsletterExamples: ["LinkedIn"],
    },
    uni: {
      heading: "s.kaya@student.tu-berlin.de (Universität)",
      items: [
        bullet(
          "Prof. Dr. Steiner (Sekretariat)",
          "Terminbestätigung",
          "bestätigt den Termin für Donnerstag 14:00 Uhr, Raum H 3005.",
        ),
      ],
      newsletterCount: 1,
      newsletterExamples: ["TU Berlin Career Service"],
    },
    drafted: [
      {
        who: "Design & Code Meetup Berlin",
        note: "Re: Speaker-Anfrage September — Jonas sagt zu, fragt nach dem gewünschten Thema.",
      },
    ],
    report:
      "5 Nachrichten gesichtet, 1 Entwurf erstellt (Zusage an das Meetup). Deniz' PayPal-Bitte ist privat und braucht keinen automatischen Entwurf.",
  },
  6: {
    personal: {
      heading: "selin.kaya.mail@gmail.com (Personal)",
      items: [
        bullet(
          "Zahnarztpraxis Dr. Bloch",
          "Terminerinnerung",
          "Kontrolltermin nächsten Dienstag 10:00 Uhr.",
        ),
      ],
      newsletterCount: 3,
      newsletterExamples: ["Deutsche Bahn Angebote", "Duolingo", "Spotify"],
    },
    work: {
      heading: "selin@nordwind-studio.de (Nordwind Studio)",
      items: [
        bullet(
          "Thomas Brandt (Acme GmbH)",
          "Zahlung veranlasst",
          "bestätigt, die reduzierte Zahlung ist unterwegs.",
        ),
        bullet(
          "Meredith Voss (Voss & Kline Consulting)",
          "Interest in rebranding",
          "would like an initial call next week about a rebrand project, English.",
        ),
      ],
      newsletterCount: 1,
      newsletterExamples: ["Adobe Creative Cloud"],
    },
    uni: {
      heading: "s.kaya@student.tu-berlin.de (Universität)",
      items: [
        bullet(
          "Kommilitone Matteo Rossi",
          "Uni-Sport Anmeldung",
          "fragt, ob Selin Lust auf den Squash-Kurs im nächsten Semester hat.",
        ),
      ],
      newsletterCount: 1,
      newsletterExamples: ["DAAD Newsletter"],
    },
    drafted: [],
    report:
      "6 Nachrichten gesichtet, kein Entwurf. Guter Tag: Acme zahlt — braucht nur eine kurze, persönliche Antwort von dir.",
  },
  5: {
    personal: {
      heading: "selin.kaya.mail@gmail.com (Personal)",
      items: [
        bullet(
          "Sabine Möller",
          "Parkplatz & Haustiere",
          "beantwortet die Frage zum Parkplatz und bestätigt, dass Haustiere gegen eine Gebühr von 15 € erlaubt sind.",
        ),
      ],
      newsletterCount: 2,
      newsletterExamples: ["N26 Monatsübersicht", "Airbnb"],
    },
    work: {
      heading: "selin@nordwind-studio.de (Nordwind Studio)",
      items: [
        bullet(
          "Mara Lindqvist",
          "Zahlungseingang Rechnung 2031",
          "bestätigt, die Zahlung von Kaltwasser & Rieger ist vollständig eingegangen.",
        ),
        bullet(
          "IHK Berlin",
          "Bestätigung Netzwerktreffen",
          "bestätigt die Anmeldung für Jonas und Selin zum Sommer-Netzwerktreffen.",
        ),
      ],
      newsletterCount: 1,
      newsletterExamples: ["LinkedIn"],
    },
    uni: {
      heading: "s.kaya@student.tu-berlin.de (Universität)",
      items: [
        bullet(
          "Prof. Dr. Steiner",
          "Überarbeitung sieht gut aus",
          "zufrieden mit der überarbeiteten Fassung von Kapitel 3, nur noch kleine Anmerkungen zu Zitierweise und Formatierung.",
        ),
      ],
      newsletterCount: 1,
      newsletterExamples: ["Fachschaft Informatik"],
    },
    drafted: [],
    report:
      "6 Nachrichten gesichtet, kein Entwurf. Guter Tag: Zahlungseingang bei Kaltwasser & Rieger und ein zufriedener Prof. Steiner, beides braucht nur eine kurze, persönliche Antwort von dir.",
  },
  3: {
    personal: {
      heading: "selin.kaya.mail@gmail.com (Personal)",
      items: [
        bullet(
          "Ayşe Kaya",
          "Uhrzeit steht fest",
          "das Geburtstagsessen für Opa ist auf Samstag 18:00 Uhr terminiert, bittet Selin, einen Salat mitzubringen.",
        ),
      ],
      newsletterCount: 2,
      newsletterExamples: ["Zalando Sale", "N26 Monatsübersicht"],
    },
    work: {
      heading: "selin@nordwind-studio.de (Nordwind Studio)",
      items: [
        bullet(
          "Thomas Brandt (Acme GmbH)",
          "Anfrage Rabatt für Q3",
          "bittet um 10% Rabatt auf den Q3-Retainer, mit Verweis auf 'die ganze Rechnungssache'.",
          true,
        ),
      ],
      newsletterCount: 2,
      newsletterExamples: ["IHK Berlin Newsletter", "Slack Digest"],
    },
    uni: {
      heading: "s.kaya@student.tu-berlin.de (Universität)",
      items: [
        bullet(
          "Prof. Dr. Steiner (Sekretariat)",
          "Sprechstunde verschoben",
          "die Sprechstunde diese Woche verschiebt sich um einen Tag.",
        ),
      ],
      newsletterCount: 1,
      newsletterExamples: ["Fachschaft Informatik"],
    },
    drafted: [],
    report:
      "5 Nachrichten gesichtet, kein Entwurf. Acmes neue Rabattanfrage ist der einzige Punkt, der eine Strategieentscheidung braucht, bevor irgendetwas rausgeht.",
  },
  2: {
    personal: {
      heading: "selin.kaya.mail@gmail.com (Personal)",
      items: [
        bullet(
          "Sabine Möller",
          "Endgültige Informationen",
          "schickt die letzten Check-in-Infos, der Türcode kommt zwei Tage vor Anreise.",
        ),
      ],
      newsletterCount: 2,
      newsletterExamples: ["Netflix", "Duolingo"],
    },
    work: {
      heading: "selin@nordwind-studio.de (Nordwind Studio)",
      items: [
        bullet(
          "Mara Lindqvist",
          "Quartalsabschluss Q2",
          "braucht die restlichen Q2-Belege bis Freitag für den Quartalsabschluss.",
          true,
        ),
      ],
      newsletterCount: 1,
      newsletterExamples: ["Adobe Creative Cloud"],
    },
    uni: {
      heading: "s.kaya@student.tu-berlin.de (Universität)",
      items: [
        bullet(
          "Prof. Dr. Steiner",
          "Abgabetermin Erinnerung",
          "erinnert daran, dass der vollständige Entwurf in drei Wochen fällig ist, möchte vorab die finale Kapitelgliederung sehen.",
          true,
        ),
      ],
      newsletterCount: 1,
      newsletterExamples: ["DAAD Newsletter"],
    },
    drafted: [
      {
        who: "Sabine Möller",
        note: "Anzahlung überwiesen — bestätigt die Überweisung mit Referenznummer.",
      },
    ],
    report:
      "5 Nachrichten gesichtet, 1 Entwurf erstellt. Zwei echte Fristen heute: Maras Belege bis Freitag und Prof. Steiners Kapitelgliederung, beide brauchen dich persönlich.",
  },
  1: {
    personal: {
      heading: "selin.kaya.mail@gmail.com (Personal)",
      items: [
        bullet(
          "Ayşe Kaya",
          "Danke & Fotos",
          "bedankt sich bei allen für den schönen Abend und hängt Fotos vom Essen an.",
        ),
      ],
      newsletterCount: 2,
      newsletterExamples: ["Spotify", "Berlin.de Newsletter"],
    },
    work: {
      heading: "selin@nordwind-studio.de (Nordwind Studio)",
      items: [
        bullet(
          "Jonas Weber",
          "Re: Acme Rabatt",
          "ist gegen den Rabatt, möchte vorher kurz eure Strategie für Q3 abstimmen.",
          true,
        ),
      ],
      newsletterCount: 2,
      newsletterExamples: ["LinkedIn", "IHK Berlin Newsletter"],
    },
    uni: {
      heading: "s.kaya@student.tu-berlin.de (Universität)",
      items: [
        bullet(
          "Kommilitone Matteo Rossi",
          "Re: Skript Woche 12",
          "fragt, ob die Mitschrift angekommen ist, keine Eile.",
        ),
      ],
      newsletterCount: 1,
      newsletterExamples: ["TU Berlin Career Service"],
    },
    drafted: [],
    report:
      "5 Nachrichten gesichtet, kein Entwurf. Jonas' Punkt zur Acme-Strategie ist der einzige, der eine Entscheidung von dir braucht, am besten kurz mit ihm sprechen statt schreiben.",
  },
};

/** Renders one morning-briefing run's full markdown result. */
export function buildMorningResult(day: number): string {
  const d = MORNING_DAYS[day];
  if (!d) throw new Error(`no morning content authored for day ${day}`);

  const summary = [accountSection(d.personal), accountSection(d.work), accountSection(d.uni)].join(
    "\n\n",
  );

  const draftsSection =
    d.drafted.length > 0
      ? `Erstellt ${d.drafted.length === 1 ? "1 Entwurf" : `${d.drafted.length} Entwürfe`}:\n${d.drafted
          .map((x) => `- **${x.who}** — ${x.note}`)
          .join("\n")}`
      : "Keine Entwürfe erstellt — nichts hat heute eine Antwort von dir gebraucht, die schon feststeht.";

  return `## Zusammenfassung\n\n${summary}\n\n## Entwürfe\n\n${draftsSection}\n\n## Bericht\n\n${d.report}`;
}

/** Evening (End-of-day learnings) content: narrative + which memory (if any) was saved. */
interface EveningDay {
  text: string;
  /** Index into MEMORIES for the entry this run saved, if any. */
  memoryIndex?: number;
}

const EVENING_DAYS: Record<number, EveningDay> = {
  20: {
    text: `Gesendete Mails und offene Entwürfe des Tages verglichen.\n\n**Nordwind Studio** — Der tatsächlich an einen Interessenten gesendete Text war kürzer als der vorbereitete Entwurf: die Schlussfloskel "Bei Fragen einfach melden" wurde gestrichen, der Rest blieb nahezu gleich.\n\n**Gelernt:** Bei deutschsprachigen Geschäftskontakten schließt du mit "Beste Grüße", bei englischsprachigen Threads mit "Best,". Als neue Erinnerung gespeichert.`,
    memoryIndex: 0,
  },
  19: {
    text: `Heute wurde nichts gesendet, das mit einem vorbereiteten Entwurf verglichen werden konnte. Kurzer Blick in die Drafts: nichts Neues seit gestern.\n\nKeine neue Erinnerung gespeichert.`,
  },
  18: {
    text: `**Nordwind Studio** — Die gesendete Antwort an einen Acme-Kontakt war deutlich knapper als sonst: keine Höflichkeitsfloskeln, nur Fakten und Zahlen.\n\n**Gelernt:** Bei Acme GmbH bleibst du bewusst sachlich und kurz, ohne Small Talk — sie lesen alles wörtlich und suchen nach Angriffsflächen. Als neue Erinnerung gespeichert.`,
    memoryIndex: 1,
  },
  17: {
    text: `Wenig gesendet heute (Rate-Limit hat den Morgenlauf für die Uni-Adresse blockiert, siehe die Morning-Briefing-Fehlermeldung). Was gesendet wurde, entsprach dem vorbereiteten Entwurf fast wörtlich.\n\nKeine neue Erinnerung gespeichert.`,
  },
  16: {
    text: `**Universität** — Der an Prof. Steiners Sekretariat gesendete Terminvorschlag schlug zwei konkrete Zeiten vor, statt nach Verfügbarkeit zu fragen — das kam offenbar gut an, die Antwort war eine der beiden vorgeschlagenen Zeiten.\n\n**Gelernt:** Du schlägst grundsätzlich zwei feste Termine vor statt "wann passt es dir?" zu fragen. Als neue Erinnerung gespeichert.`,
    memoryIndex: 2,
  },
  15: {
    text: `Ruhiger Tag, ein kurzer privater Dank wurde gesendet, kein Vergleich mit einem Entwurf möglich (spontan geschrieben).\n\nKeine neue Erinnerung gespeichert.`,
  },
  13: {
    text: `**Personal** — Die gesendete Antwort an ein Familienmitglied unterschied sich vom vorbereiteten Entwurf nur in der Schlussformel: "Liebe Grüße, Selin" statt des generischeren "Viele Grüße" im Entwurf. An eine Freundin ging im gleichen Zeitraum nur "LG" raus.\n\n**Gelernt:** Familie bekommt "Liebe Grüße, Selin", Freunde nur "LG". Als neue Erinnerung gespeichert.`,
    memoryIndex: 3,
  },
  11: {
    text: `**Personal** — In der Korrespondenz mit der Vermieterin der Ferienwohnung fiel auf: du wiederholst in jeder Mail erneut die Anzahl der Gäste, obwohl das schon zweimal genannt wurde.\n\n**Gelernt:** Sabine Möller (Ferienwohnung Seeblick) verliert offenbar den Überblick über Details aus früheren Mails — Gästezahl in jeder neuen Mail zur Sicherheit wiederholen. Als neue Erinnerung gespeichert.`,
    memoryIndex: 4,
  },
  10: {
    text: `Nichts Auffälliges heute, die gesendeten Mails entsprachen den Entwürfen praktisch 1:1.\n\nKeine neue Erinnerung gespeichert.`,
  },
  8: {
    text: `**Universität** — Der Termin mit Prof. Steiner wurde für Donnerstagvormittag bestätigt; ein Blick auf frühere Threads zeigt, dass Antworten von ihm auf Dienstag/Mittwoch-Vormittag-Mails am schnellsten kommen, auf Freitagsmails so gut wie nie vor Montag.\n\n**Gelernt:** Prof. Steiner antwortet am schnellsten auf Dienstag/Mittwoch-Vormittag-Mails, kaum auf Freitagsmails. Als neue Erinnerung gespeichert.`,
    memoryIndex: 5,
  },
  6: {
    text: `**Nordwind Studio** — Die Antwort an Thomas Brandt (Acme) enthielt keine konkrete Zusage zum gewünschten Rabatt, nur "wir prüfen das intern und melden uns" — das taucht jetzt zum dritten Mal in ähnlicher Form auf.\n\n**Gelernt:** Bei Acme sagst du nie direkt per Mail einen Rabatt zu, sondern verweist immer erst auf eine interne Abstimmung. Als neue Erinnerung gespeichert.`,
    memoryIndex: 6,
  },
  5: {
    text: `Kein Vergleichsfall heute, die gesendeten Mails waren allesamt kurze Bestätigungen ohne vorherigen Entwurf.\n\nKeine neue Erinnerung gespeichert.`,
  },
  4: {
    text: `**Nordwind Studio** — Mara Lindqvists Erinnerungsmails wurden nochmal durchgesehen: sie schickt inzwischen eine einzelne Sammel-Mail pro Monat statt einzelner Pings pro Rechnung, seit du sie einmal darauf angesprochen hast.\n\n**Gelernt:** Mara Lindqvist bevorzugt eine monatliche Sammel-Mail statt einzelner Pings pro Rechnung. Als neue Erinnerung gespeichert.`,
    memoryIndex: 7,
  },
  2: {
    text: `**Universität** — Die an Prof. Steiner gesendete Mail hatte "Kapitel 3 – finale Gliederung" als Betreff, konsistent mit früheren Mails im selben Thread, die alle die Kapitelnummer im Betreff tragen.\n\n**Gelernt:** Mails an Prof. Steiner sollten immer die Kapitelnummer im Betreff nennen, damit er Threads richtig zuordnet. Als neue Erinnerung gespeichert.`,
    memoryIndex: 8,
  },
  1: {
    text: `Ruhiger Ausklang, nichts Neues zu lernen — die gesendeten Mails folgten durchgehend den bereits gespeicherten Mustern (Grußformeln, Tonfall) ohne Abweichung.\n\nKeine neue Erinnerung gespeichert.`,
  },
};

export function buildEveningResult(day: number): string {
  const entry = EVENING_DAYS[day];
  if (!entry) throw new Error(`no evening content authored for day ${day}`);
  return entry.text;
}

/**
 * ---- Long-term memory (15 entries: 9 agent-saved evening-run learnings, 3
 * user-stated in chat, 3 agent-saved writing-style directives for the work
 * account, standing in for a past voice-learn run). All but one are scoped to
 * the account their storyline belongs to (work = Acme/Nordwind, personal =
 * family/Ferienwohnung, uni = Prof. Steiner) so the demo shows the
 * account-tag model; the scheduling habit stays global on purpose. ----
 */

export interface MemorySeed {
  content: string;
  source: "user" | "agent";
  daysAgo: number;
  /** Scopes the memory to one connected account; omit for a global fact. */
  accountId?: string;
}

export const MEMORIES: MemorySeed[] = [
  {
    content:
      "Schließt deutschsprachige Geschäftsmails mit \"Beste Grüße\", englischsprachige mit \"Best,\".",
    source: "agent",
    daysAgo: 20,
    accountId: DEMO_WORK_ACCOUNT_ID,
  },
  {
    content:
      "Bleibt bei Acme GmbH bewusst sachlich und kurz, ohne Small Talk — sie lesen alles wörtlich.",
    source: "agent",
    daysAgo: 18,
    accountId: DEMO_WORK_ACCOUNT_ID,
  },
  // The one deliberately global entry: a habit that holds across all inboxes.
  {
    content: "Schlägt bei Terminen immer zwei konkrete Zeiten vor statt nach Verfügbarkeit zu fragen.",
    source: "agent",
    daysAgo: 16,
  },
  {
    content: "Schreibt Familie \"Liebe Grüße, Selin\", engen Freunden nur \"LG\".",
    source: "agent",
    daysAgo: 13,
    accountId: DEMO_PERSONAL_ACCOUNT_ID,
  },
  {
    content:
      "Sabine Möller (Ferienwohnung Seeblick) verliert Details aus früheren Mails — Gästezahl in jeder neuen Mail wiederholen.",
    source: "agent",
    daysAgo: 11,
    accountId: DEMO_PERSONAL_ACCOUNT_ID,
  },
  {
    content: "Prof. Steiner antwortet am schnellsten auf Dienstag/Mittwoch-Vormittag-Mails, kaum am Freitag.",
    source: "agent",
    daysAgo: 8,
    accountId: DEMO_UNI_ACCOUNT_ID,
  },
  {
    content: "Sagt Acme nie direkt einen Rabatt per Mail zu, verweist immer erst auf interne Abstimmung.",
    source: "agent",
    daysAgo: 6,
    accountId: DEMO_WORK_ACCOUNT_ID,
  },
  {
    content: "Mara Lindqvist bevorzugt eine monatliche Sammel-Mail statt einzelner Pings pro Rechnung.",
    source: "agent",
    daysAgo: 4,
    accountId: DEMO_WORK_ACCOUNT_ID,
  },
  {
    content: "Mails an Prof. Steiner sollten immer die Kapitelnummer im Betreff nennen.",
    source: "agent",
    daysAgo: 2,
    accountId: DEMO_UNI_ACCOUNT_ID,
  },
  {
    content: "Bei allem, was Acme-GmbH-Rechnungen betrifft, Jonas Weber (jonas@nordwind-studio.de) in CC setzen.",
    source: "user",
    daysAgo: 17,
    accountId: DEMO_WORK_ACCOUNT_ID,
  },
  {
    content:
      "Nutzt \"Sehr geehrte/r\" nur beim ersten Kontakt mit einem neuen Kunden, danach \"Hallo\".",
    source: "user",
    daysAgo: 14,
    accountId: DEMO_WORK_ACCOUNT_ID,
  },
  {
    content:
      "Vor Weiterleitung einer Freelancer-Rechnung (z. B. von Yusuf Demir) an Mara immer die Bankdaten gegenprüfen.",
    source: "user",
    daysAgo: 9,
    accountId: DEMO_WORK_ACCOUNT_ID,
  },
  // Writing-style directives for the work account — what a past voice-learn
  // run would have saved (see agent/voiceLearn.ts), scoped to that account.
  {
    content: "Kurz und direkt, keine Floskeln.",
    source: "agent",
    daysAgo: 19,
    accountId: DEMO_WORK_ACCOUNT_ID,
  },
  {
    content: "Du-Form mit Freelancern, Sie-Form mit Kunden.",
    source: "agent",
    daysAgo: 19,
    accountId: DEMO_WORK_ACCOUNT_ID,
  },
  {
    content: "Auf Deutsch, außer der Kunde schreibt Englisch.",
    source: "agent",
    daysAgo: 19,
    accountId: DEMO_WORK_ACCOUNT_ID,
  },
];

/** ---- Drafts: 25 across the 3 accounts, ages spread over 20 days ---- */

export interface DraftSeed {
  accountId: string;
  daysAgo: number;
  hour: number;
  to: string;
  cc?: string;
  subject: string;
  body: string;
  /** DemoThread.id (mailbox.ts) this draft replies to, when the thread exists there. */
  threadId?: string;
  /**
   * Stable handle a ChatSeed can point at (draftLinkKey) to mark this draft
   * as written by that chat — the seeder then links the two (draft_links) and
   * puts the draft's card on the chat's closing assistant turn, exactly what
   * a live create-draft turn produces.
   */
  linkKey?: string;
}

export const DRAFTS: DraftSeed[] = [
  // ---- Work (12) ----
  {
    accountId: DEMO_WORK_ACCOUNT_ID,
    daysAgo: 12,
    hour: 17,
    to: "t.brandt@acme-gmbh.de",
    subject: "Re: Rechnung weiterhin strittig",
    threadId: "th-work-acme-strittig",
    body: `Hallo Herr Brandt,

danke für die Rückmeldung. Wir haben die Zeiterfassung für den Website-Relaunch nochmal im Detail durchgesehen, die 40 Stunden verteilen sich wie folgt:

[Stundenaufstellung hier einfügen — siehe Acme-Zeiterfassung.md]

Wir sind offen, das gemeinsam durchzugehen, sehen aber aktuell keinen Grund, die Rechnung zu`,
  },
  {
    accountId: DEMO_WORK_ACCOUNT_ID,
    daysAgo: 6,
    hour: 11,
    to: "meredith@vossandkline.com",
    subject: "Re: Interest in rebranding",
    threadId: "th-work-voss",
    body: `Hi Meredith,

Thanks for reaching out. Happy to jump on a call, how about Tuesday or Wednesday next week, afternoon?

Best,
Selin`,
  },
  {
    accountId: DEMO_WORK_ACCOUNT_ID,
    daysAgo: 11,
    hour: 9,
    to: "f.rieger@kaltwasser-rieger.de",
    cc: "mara.lindqvist@lindqvist-buchhaltung.de",
    subject: "Freundliche Erinnerung: Rechnung 2031",
    threadId: "th-work-rieger-2031",
    body: `Hallo Herr Rieger,

kurze Erinnerung: Rechnung #2031 vom letzten Monat ist noch offen. Falls das schon in Bearbeitung ist, bitte ignorieren, ansonsten freuen wir uns über eine kurze Rückmeldung, wann wir mit dem Zahlungseingang rechnen können.

Beste Grüße,
Selin`,
  },
  {
    accountId: DEMO_WORK_ACCOUNT_ID,
    daysAgo: 4,
    hour: 15,
    to: "jonas@nordwind-studio.de",
    subject: "Portfolio Feedback",
    threadId: "th-work-jonas-portfolio",
    body: `Hi Jonas,

Die drei neuen Case Studies sehen gut aus. Bei der Acme-Case Study würde ich das strittige Rechnungsthema komplett raushalten, sonst nichts. Bei der zweiten fehlt noch ein Vorher-Bild.

Beste Grüße,
Selin`,
  },
  {
    accountId: DEMO_WORK_ACCOUNT_ID,
    daysAgo: 2,
    hour: 10,
    to: "nina.krause@gmail.com",
    subject: "Re: Danke & Update",
    threadId: "th-work-nina",
    body: `Hallo Nina,

Freut uns total für dich, herzlichen Glückwunsch zur neuen Stelle! Du warst eine super Praktikantin, meld dich gerne, wenn du mal ein Referenzschreiben brauchst.

Beste Grüße,
Selin`,
  },
  {
    accountId: DEMO_WORK_ACCOUNT_ID,
    daysAgo: 9,
    hour: 16,
    to: "yusuf.demir.dev@gmail.com",
    subject: "Re: Rechnung Acme-Projekt",
    threadId: "th-work-yusuf-invoice",
    body: `Hi Yusuf,

Rechnung ist angekommen, danke. Zahlung geht wie üblich innerhalb von 14 Tagen raus, Mara hat sie schon zur Bearbeitung.

Beste Grüße,
Selin`,
  },
  {
    accountId: DEMO_WORK_ACCOUNT_ID,
    daysAgo: 1,
    hour: 18,
    to: "t.brandt@acme-gmbh.de",
    cc: "jonas@nordwind-studio.de",
    subject: "Re: Anfrage Rabatt für Q3",
    threadId: "th-work-acme-q3",
    body: `Hallo Herr Brandt,

danke für die Anfrage. Wir schätzen die`,
  },
  {
    accountId: DEMO_WORK_ACCOUNT_ID,
    daysAgo: 7,
    hour: 13,
    to: "hello@designcodeberlin.de",
    subject: "Re: Speaker-Anfrage September",
    threadId: "th-work-meetup",
    body: `Hallo zusammen,

Jonas übernimmt das gerne als Speaker im September, ich bin als Backup mit dabei, falls kurzfristig was dazwischenkommt. Habt ihr schon eine grobe Themenrichtung im Kopf, oder ist das frei wählbar? Wir würden gerne etwas rund um Markenarbeit für kleine Studios zeigen, konkrete Beispiele statt Theorie.

Beste Grüße,
Selin`,
  },
  {
    accountId: DEMO_WORK_ACCOUNT_ID,
    daysAgo: 14,
    hour: 10,
    to: "r.fenner@fenner-immobilien.de",
    cc: "jonas@nordwind-studio.de",
    subject: "Re: Website Relaunch Anfrage",
    threadId: "th-work-fenner",
    body: `Hallo Herr Fenner,

danke für Ihre Anfrage. Für einen Relaunch in der Größenordnung, die Sie beschreiben (bestehende Seite, ca. 15 Unterseiten, neues Buchungssystem), rechnen wir grob mit 6-8 Wochen und einem Budget zwischen 12.000 € und 18.000 €, je nachdem wie viel vom Content-Bestand übernommen werden kann.

Der Ablauf wäre bei uns typischerweise:

1. Kickoff & Bestandsaufnahme (1 Woche)
2. Konzept & Wireframes (2 Wochen)
3. Design & Entwicklung (3-4 Wochen)
4. Testing & Launch (1 Woche)

Gerne stellen wir Ihnen das in einem kurzen Call genauer vor, wenn Interesse besteht. Über Referenzen aus der Immobilienbranche verfügen wir ebenfalls.

Beste Grüße,
Selin Kaya
Nordwind Studio`,
  },
  {
    accountId: DEMO_WORK_ACCOUNT_ID,
    daysAgo: 17,
    hour: 12,
    to: "support@ionos.de",
    subject: "Frage zur Domain-Verlängerung",
    threadId: "th-work-ionos",
    body: `Hallo,

zu unserer Domain nordwind-studio.de: können Sie uns die Rechnung für die anstehende Verlängerung`,
  },
  {
    accountId: DEMO_WORK_ACCOUNT_ID,
    daysAgo: 5,
    hour: 14,
    to: "events@ihk-berlin.de",
    subject: "Re: Netzwerktreffen Anmeldung",
    body: `Hallo,

wir kommen gerne, bitte mit zwei Personen einplanen (Jonas Weber und Selin Kaya).

Beste Grüße,
Selin`,
  },
  {
    accountId: DEMO_WORK_ACCOUNT_ID,
    daysAgo: 0,
    hour: 8,
    to: "mara.lindqvist@lindqvist-buchhaltung.de",
    subject: "Q2 Belege",
    threadId: "th-work-mara-q2",
    body: `Hallo Mara,

hier die letzten fehlenden Belege für Q2, den Rest schicke ich dir bis`,
  },
  // ---- Personal (9) ----
  {
    // Written by the "Höfliche Absage an die Recruiterin" chat (see CHATS) —
    // the pair demos the draft → originating-conversation link.
    accountId: DEMO_PERSONAL_ACCOUNT_ID,
    daysAgo: 2,
    hour: 11,
    to: "l.vogt@talentbridge-recruiting.de",
    subject: "Re: Spannende Rolle als Lead Product Designer",
    threadId: "th-pers-lena-vogt",
    linkKey: "vogt-absage",
    body: `Hallo Frau Vogt,

danke fürs Nachfassen und für das freundliche Angebot. Aktuell bin ich mit Nordwind Studio sehr zufrieden und suche nicht aktiv. Falls sich das ändert, melde ich mich gerne bei Ihnen.

Liebe Grüße
Selin`,
  },
  {
    accountId: DEMO_PERSONAL_ACCOUNT_ID,
    daysAgo: 4,
    hour: 20,
    to: "sabine.moeller@ferienwohnung-seeblick.de",
    subject: "Re: Parkplatz & Haustiere",
    threadId: "th-pers-sabine-anreise",
    body: `Hallo Frau Möller,

super, danke für die Info. Wir bringen unseren Hund mit, die 15 € Gebühr sind kein Problem. Zwei Erwachsene, ein Hund, wie besprochen.

Liebe Grüße,
Selin`,
  },
  {
    accountId: DEMO_PERSONAL_ACCOUNT_ID,
    daysAgo: 10,
    hour: 21,
    to: "ayse.kaya1968@gmail.com",
    subject: "Re: Geschenk-Idee",
    threadId: "th-pers-mama-geschenk",
    body: `Liebe Mama,

klingt gut, ich beteilige mich gerne mit 40 €. Sag mir einfach Bescheid, wenn Deniz was bestellt hat.

Liebe Grüße,
Selin`,
  },
  {
    accountId: DEMO_PERSONAL_ACCOUNT_ID,
    daysAgo: 13,
    hour: 19,
    to: "elif.aydin89@gmail.com",
    subject: "Re: Konzert am Freitag?",
    threadId: "th-pers-elif-konzert",
    body: `Hey Elif,

bin dabei! Wo treffen wir uns, direkt vor der Astra oder vorher irgendwo essen?

LG
Selin`,
  },
  {
    accountId: DEMO_PERSONAL_ACCOUNT_ID,
    daysAgo: 9,
    hour: 18,
    to: "deniz.kaya.b@gmail.com",
    subject: "Re: Geschenk",
    threadId: "th-pers-deniz-geschenk",
    body: `Hey Deniz,

hab dir gerade meinen Anteil überwiesen, sollte gleich ankommen. Danke, dass du dich drum kümmerst!

LG
Selin`,
  },
  {
    accountId: DEMO_PERSONAL_ACCOUNT_ID,
    daysAgo: 6,
    hour: 8,
    to: "praxis@zahnarzt-bloch-berlin.de",
    subject: "Terminverschiebung",
    threadId: "th-pers-zahnarzt",
    body: `Guten Tag,

könnten wir den Termin am Dienstag auf`,
  },
  {
    accountId: DEMO_PERSONAL_ACCOUNT_ID,
    daysAgo: 16,
    hour: 12,
    to: "verwaltung@nettbach-hausverwaltung.de",
    subject: "Frage zur Nebenkostenabrechnung",
    threadId: "th-pers-hausverwaltung",
    body: `Guten Tag,

danke für die Betriebskostenabrechnung. Eine Position ist mir nicht ganz klar: die Position "Sonstige Kosten" mit 84 € ist im Vergleich zum Vorjahr fast doppelt so hoch. Könnten Sie kurz aufschlüsseln, was darin enthalten ist? Die Nachzahlung von 42 € an sich ist kein Problem, ich möchte nur verstehen, wo der Anstieg herkommt.

Vielen Dank,
Selin Kaya`,
  },
  {
    accountId: DEMO_PERSONAL_ACCOUNT_ID,
    daysAgo: 2,
    hour: 22,
    to: "kerem.aksu@web.de",
    subject: "Re: Fotos vom Wochenende",
    threadId: "th-pers-kerem-fotos",
    body: `Hey Kerem,

danke fürs Teilen, richtig schöne Bilder dabei! Vor allem`,
  },
  {
    accountId: DEMO_PERSONAL_ACCOUNT_ID,
    daysAgo: 15,
    hour: 17,
    to: "sabine.moeller@ferienwohnung-seeblick.de",
    subject: "Anzahlung überwiesen",
    threadId: "th-pers-sabine-buchung",
    body: `Hallo Frau Möller,

die Anzahlung von 150 € ist raus, Referenznummer FW-2291. Ich melde mich nochmal wegen der genauen Anreisezeit.

Liebe Grüße,
Selin`,
  },
  // ---- University (5) ----
  {
    accountId: DEMO_UNI_ACCOUNT_ID,
    daysAgo: 9,
    hour: 20,
    to: "steiner@tu-berlin.de",
    subject: "Kapitel 3 – überarbeitete Fassung",
    threadId: "th-uni-thesis",
    body: `Sehr geehrter Herr Prof. Dr. Steiner,

vielen Dank für Ihr Feedback zu Kapitel 3. Ich habe die Stichprobengröße nun ausführlicher begründet (Abschnitt 3.2) und die fehlenden Zitate ergänzt (Müller 2019, Fischer & Bauer 2021). Die überarbeitete Fassung finden Sie im Anhang.

Über eine kurze Rückmeldung, ob die Änderungen in die richtige Richtung gehen, würde ich mich sehr freuen.

Mit freundlichen Grüßen,
Selin Kaya`,
  },
  {
    accountId: DEMO_UNI_ACCOUNT_ID,
    daysAgo: 14,
    hour: 16,
    to: "yeliz.aksoy@campus.tu-berlin.de",
    subject: "Re: Gruppenarbeit Statistik",
    threadId: "th-uni-yeliz-statistik",
    body: `Hey Yeliz,

Donnerstag 16 Uhr in der Bibliothek passt mir gut, bringe meine Notizen zu Aufgabe 3 mit.

LG
Selin`,
  },
  {
    accountId: DEMO_UNI_ACCOUNT_ID,
    daysAgo: 18,
    hour: 11,
    to: "pruefungsamt@tu-berlin.de",
    subject: "Frage zur Rückmeldung",
    threadId: "th-uni-pruefungsamt",
    body: `Guten Tag,

ich wollte fragen, ob die Rückmeldefrist zum 15. auch für Studierende gilt, die aktuell im`,
  },
  {
    accountId: DEMO_UNI_ACCOUNT_ID,
    daysAgo: 5,
    hour: 21,
    to: "matteo.rossi@campus.tu-berlin.de",
    subject: "Re: Skript Woche 12",
    threadId: "th-uni-matteo-skript",
    body: `Hey Matteo,

danke fürs Teilen, hat mir echt geholfen! Schulde dir was.

LG
Selin`,
  },
  {
    accountId: DEMO_UNI_ACCOUNT_ID,
    daysAgo: 7,
    hour: 9,
    to: "steiner@tu-berlin.de",
    subject: "Terminbestätigung Sprechstunde",
    threadId: "th-uni-thesis",
    body: `Sehr geehrter Herr Prof. Dr. Steiner,

danke für den Terminvorschlag, Donnerstag 14:00 Uhr passt mir gut. Ich bringe die aktualisierte Kapitelgliederung mit.

Mit freundlichen Grüßen,
Selin Kaya`,
  },
  // ---- Additional Drafts (15) ----
  {
    accountId: DEMO_WORK_ACCOUNT_ID,
    daysAgo: 0,
    hour: 9,
    to: "julia.koch@kreativagentur.de",
    subject: "Re: Abstimmung Termin",
    body: `Hallo Julia,

passt! Lass uns am Donnerstag um 14 Uhr telefonieren. Ich schicke dir gleich noch einen Kalender-Invite.

Beste Grüße,
Selin`,
  },
  {
    accountId: DEMO_WORK_ACCOUNT_ID,
    daysAgo: 8,
    hour: 14,
    to: "buchhaltung@nordwind-studio.de",
    subject: "Reisekostenabrechnung",
    body: `Hallo zusammen,

im Anhang findet ihr die Reisekostenabrechnung für den Termin bei Acme letzte Woche. Die Hotelrechnung ist ebenfalls dabei.

Beste Grüße,
Selin`,
  },
  {
    accountId: DEMO_WORK_ACCOUNT_ID,
    daysAgo: 1,
    hour: 16,
    to: "m.bauer@bauer-logistics.de",
    subject: "Feedback Logo-Entwürfe",
    body: `Hallo Herr Bauer,

vielen Dank für Ihr ausführliches Feedback. Wir können die vorgeschlagenen Änderungen (Fokus auf Blautöne, reduziertere Schriftart) gerne in der nächsten Iteration umsetzen. Wir melden uns Anfang nächster Woche mit den neuen Entwürfen.

Beste Grüße,
Selin Kaya
Nordwind Studio`,
  },
  {
    accountId: DEMO_WORK_ACCOUNT_ID,
    daysAgo: 0,
    hour: 11,
    to: "info@druckerei-schmidt.berlin",
    subject: "Anfrage Visitenkarten",
    body: `Guten Tag,

wir bräuchten für einen Kunden ein Angebot für den Druck von 500 Visitenkarten (4/4-farbig, 300g/m² Bilderdruck matt, Softfeel-Kaschierung). Druckdaten können wir ab Montag liefern. Bis wann wäre die Produktion machbar?

Beste Grüße,
Selin Kaya`,
  },
  {
    accountId: DEMO_WORK_ACCOUNT_ID,
    daysAgo: 12,
    hour: 13,
    to: "jonas@nordwind-studio.de",
    subject: "Kundenpräsentation",
    body: `Hey Jonas,

die Präsentation für morgen sieht soweit super aus. Sollen wir Folie 12 noch etwas einkürzen? Wirkt ein bisschen textlastig.

LG,
Selin`,
  },
  {
    accountId: DEMO_PERSONAL_ACCOUNT_ID,
    daysAgo: 2,
    hour: 18,
    to: "kundenservice@bahn.de",
    subject: "Erstattung ICE 842",
    body: `Guten Tag,

ich möchte eine Erstattung für meine Fahrt mit dem ICE 842 am vergangenen Freitag beantragen. Der Zug hatte über 120 Minuten Verspätung. Mein Fahrgastrechte-Formular finden Sie im Anhang.

Vielen Dank,
Selin Kaya`,
  },
  {
    accountId: DEMO_PERSONAL_ACCOUNT_ID,
    daysAgo: 0,
    hour: 20,
    to: "deniz.kaya.b@gmail.com",
    subject: "Re: Grillen am Samstag",
    threadId: "th-pers-deniz-grillen",
    body: `Hey Deniz,

ich bringe den Kartoffelsalat mit! Soll ich noch was zu trinken besorgen?

LG
Selin`,
  },
  {
    accountId: DEMO_PERSONAL_ACCOUNT_ID,
    daysAgo: 5,
    hour: 9,
    to: "info@yogastudiomitte.de",
    subject: "Probetraining",
    body: `Hallo,

ich interessiere mich für den Vinyasa-Kurs am Mittwochabend um 19 Uhr. Ist es möglich, dafür ein Probetraining zu vereinbaren?

Viele Grüße,
Selin Kaya`,
  },
  {
    accountId: DEMO_PERSONAL_ACCOUNT_ID,
    daysAgo: 11,
    hour: 15,
    to: "max.schulz88@web.de",
    subject: "Re: Umzugskartons",
    threadId: "th-pers-max-kartons",
    body: `Hey Max,

danke fürs Angebot! Ich könnte morgen nach der Arbeit gegen 18 Uhr vorbeikommen und die Kartons abholen. Passt dir das?

LG
Selin`,
  },
  {
    accountId: DEMO_PERSONAL_ACCOUNT_ID,
    daysAgo: 0,
    hour: 10,
    to: "support@spotify.com",
    subject: "Frage zu Premium Family",
    body: `Hallo,

wir haben aktuell ein Premium Duo Abo und würden gerne auf Premium Family upgraden. Bleiben unsere Playlists beim Upgrade erhalten?

Danke und Grüße,
Selin`,
  },
  {
    accountId: DEMO_UNI_ACCOUNT_ID,
    daysAgo: 8,
    hour: 14,
    to: "bibliothek@tu-berlin.de",
    subject: "Frage zu Fernleihe",
    body: `Sehr geehrte Damen und Herren,

ich habe vor zwei Wochen ein Buch über die Fernleihe bestellt (Bestellnummer: FL-8921) und wollte fragen, ob absehbar ist, wann dieses eintrifft?

Mit freundlichen Grüßen,
Selin Kaya`,
  },
  {
    accountId: DEMO_UNI_ACCOUNT_ID,
    daysAgo: 0,
    hour: 12,
    to: "matthias.weber@campus.tu-berlin.de",
    subject: "Zusammenfassung VL 4",
    body: `Hey Matthias,

hier wie besprochen meine Zusammenfassung der vierten Vorlesung. Sag Bescheid, falls du etwas nicht lesen kannst.

LG,
Selin`,
  },
  {
    accountId: DEMO_UNI_ACCOUNT_ID,
    daysAgo: 6,
    hour: 16,
    to: "sekretariat@wiwi.tu-berlin.de",
    subject: "Anmeldung Masterarbeit",
    body: `Guten Tag,

können Sie mir bitte das Formular zur Anmeldung der Masterarbeit zukommen lassen? Prof. Steiner hat der Betreuung bereits zugestimmt.

Vielen Dank im Voraus!

Mit freundlichen Grüßen,
Selin Kaya`,
  },
  {
    accountId: DEMO_UNI_ACCOUNT_ID,
    daysAgo: 10,
    hour: 10,
    to: "astrid.meyer@tu-berlin.de",
    subject: "Re: Präsentation am Dienstag",
    body: `Hallo Frau Meyer,

die Präsentationsfolien schicke ich Ihnen wie vereinbart am Montagvormittag. Brauchen Sie das Handout auch vorab als PDF oder reicht es, wenn ich das ausgedruckt mitbringe?

Beste Grüße,
Selin Kaya`,
  },
  {
    accountId: DEMO_UNI_ACCOUNT_ID,
    daysAgo: 2,
    hour: 19,
    to: "mensa@studentenwerk-berlin.de",
    subject: "Feedback veganes Angebot",
    body: `Guten Tag,

ich wollte ein kurzes Feedback dalassen: Die veganen Gerichte in der Mensa am Ernst-Reuter-Platz sind in letzter Zeit super! Weiter so!

Viele Grüße,
Selin`,
  }
];

/** ---- Chats: ~18 conversations with realistic multi-turn exchanges ---- */

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}
export interface ChatSeed {
  title: string;
  daysAgo: number;
  hour: number;
  turns: ChatTurn[];
  /**
   * linkKey of the DRAFTS entry this chat wrote, if any. The seeder links the
   * draft to this conversation and attaches its email_draft card to the last
   * assistant turn, mirroring a live create-draft turn.
   */
  draftLinkKey?: string;
}

export const CHATS: ChatSeed[] = [
  {
    title: "Erinnere dich: Acme-Rechnungen immer mit Jonas in CC",
    daysAgo: 17,
    hour: 9,
    turns: [
      {
        role: "user",
        content: "Merk dir bitte: bei allem, was Acme-Rechnungen betrifft, immer Jonas in CC setzen.",
      },
      {
        role: "assistant",
        content: "Gespeichert: bei Acme-GmbH-Rechnungen setze ich Jonas Weber standardmäßig in CC.",
      },
    ],
  },
  {
    title: "Ab wann 'Hallo' statt 'Sehr geehrte/r'?",
    daysAgo: 14,
    hour: 11,
    turns: [
      {
        role: "user",
        content:
          "Ich nutze 'Sehr geehrte/r' eigentlich nur beim allerersten Kontakt mit einem neuen Kunden, danach wechsle ich zu 'Hallo'. Merk dir das für Entwürfe.",
      },
      {
        role: "assistant",
        content:
          "Notiert: förmliche Anrede nur beim Erstkontakt mit neuen Kunden, danach 'Hallo'. Gilt ab jetzt für alle Entwürfe.",
      },
    ],
  },
  {
    title: "Vor Weiterleitung an Mara: Bankdaten prüfen",
    daysAgo: 9,
    hour: 15,
    turns: [
      {
        role: "user",
        content:
          "Bevor du eine Freelancer-Rechnung wie die von Yusuf an Mara weiterleitest, prüf bitte immer erst die Bankdaten drauf.",
      },
      {
        role: "assistant",
        content: "Verstanden und gespeichert. Ich prüfe Bankdaten künftig, bevor eine Freelancer-Rechnung an Mara geht.",
      },
    ],
  },
  {
    title: "Fasse den Acme-Thread zusammen",
    daysAgo: 16,
    hour: 10,
    turns: [
      { role: "user", content: "Fass mir kurz zusammen, wo wir mit Acme gerade stehen." },
      {
        role: "assistant",
        content:
          "Der Streit dreht sich um Rechnung #A-1042 (Website-Relaunch, 40 Stunden). Thomas Brandt bestreitet 8 der Stunden und hat mit der Rechtsabteilung gedroht, wenn die Rechnung nicht angepasst wird. Jonas bereitet gerade eine Antwort mit der vollständigen Zeiterfassung vor, die noch dein Review braucht, bevor sie rausgeht.",
      },
    ],
  },
  {
    title: "Alles von Mara zu den Q2-Rechnungen",
    daysAgo: 12,
    hour: 13,
    turns: [
      { role: "user", content: "Zeig mir alles, was Mara zu den Q2-Rechnungen geschrieben hat." },
      {
        role: "assistant",
        content:
          "Drei Mails in den letzten zwei Wochen: sie hat Rechnung #2031 an Kaltwasser & Rieger verschickt, dann als überfällig gemeldet (Felix Rieger hatte urlaubsbedingt verzögert), und den Zahlungseingang bestätigt, sobald er kam. Aktuell wartet sie außerdem auf deine restlichen Q2-Belege für den Quartalsabschluss.",
      },
    ],
  },
  {
    title: "Ungelesene Mails im Arbeitskonto?",
    daysAgo: 7,
    hour: 20,
    turns: [
      { role: "user", content: "Wie viele ungelesene Mails hab ich gerade im Arbeits-Postfach?" },
      {
        role: "assistant",
        content:
          "Dazu hab ich im Moment keinen Zugriff auf dein Postfach — die Morning-Briefing-Zusammenfassungen auf der Startseite sind aktuell die beste Übersicht.",
      },
    ],
  },
  {
    title: "Entwurf für Prof. Steiner zu Kapitel 3",
    daysAgo: 19,
    hour: 18,
    turns: [
      {
        role: "user",
        content: "Schreib mir einen Entwurf für eine Antwort an Prof. Steiner, dass ich Kapitel 3 überarbeite.",
      },
      {
        role: "assistant",
        content:
          "Vorschlag:\n\n\"Sehr geehrter Herr Prof. Dr. Steiner, vielen Dank für die Rückmeldung zu Kapitel 3. Ich überarbeite die Stichprobenbegründung und ergänze die fehlenden Zitate, die aktualisierte Fassung reiche ich Ende der Woche ein. Mit freundlichen Grüßen, Selin Kaya\"\n\nSoll ich noch etwas anpassen, bevor du ihn absendest?",
      },
      { role: "user", content: "Passt so, danke." },
      { role: "assistant", content: "Sehr gerne." },
    ],
  },
  {
    title: "Stand bei der Thesis-Rückmeldung",
    daysAgo: 5,
    hour: 9,
    turns: [
      { role: "user", content: "Was ist der aktuelle Stand bei meiner Thesis-Rückmeldung von Prof. Steiner?" },
      {
        role: "assistant",
        content:
          "Er hat die überarbeitete Fassung von Kapitel 3 durchgesehen und ist zufrieden, es gibt nur noch kleine Anmerkungen zu Zitierweise und Formatierung. Der Termin dazu war für Donnerstag 14:00 Uhr in Raum H 3005 bestätigt.",
      },
    ],
  },
  {
    title: "Kurze Zusammenfassung der Woche",
    daysAgo: 20,
    hour: 19,
    turns: [
      { role: "user", content: "Fass mir die Woche kurz zusammen, über alle drei Konten." },
      {
        role: "assistant",
        content:
          "Arbeit: Acme streitet weiter über Rechnung #A-1042, die Rückmeldefrist der Uni läuft bald ab. Persönlich: nichts Dringendes, nur die übliche Newsletter-Flut. Uni: Prof. Steiner hat Kapitel 3 erhalten und meldet sich in den nächsten zwei Wochen mit Feedback.",
      },
    ],
  },
  {
    title: "E-Mail von Meredith Voss finden",
    daysAgo: 6,
    hour: 14,
    turns: [
      { role: "user", content: "Finde die Mail von Meredith Voss, worum ging's nochmal?" },
      {
        role: "assistant",
        content:
          "Meredith Voss von Voss & Kline Consulting hat wegen eines Rebranding-Projekts geschrieben und um ein erstes Gespräch nächste Woche gebeten. Ein Entwurf mit einem Terminvorschlag liegt schon bei den Drafts.",
      },
    ],
  },
  {
    title: "Wer ist Felix Rieger nochmal?",
    daysAgo: 15,
    hour: 16,
    turns: [
      { role: "user", content: "Wer ist Felix Rieger nochmal, sagt mir grad nichts." },
      {
        role: "assistant",
        content:
          "Felix Rieger ist bei Kaltwasser & Rieger Architekten, einem eurer Kunden. Es geht um Rechnung #2031 fürs Branding-Projekt, die zuletzt urlaubsbedingt verspätet bezahlt wurde.",
      },
    ],
  },
  {
    title: "Yusufs Rechnung bestätigt?",
    daysAgo: 10,
    hour: 17,
    turns: [
      { role: "user", content: "Haben wir Yusufs Rechnung fürs Acme-Projekt schon bestätigt bekommen?" },
      {
        role: "assistant",
        content: "Ja, die Rechnung über 1.200 € ist angekommen und ein Bestätigungsentwurf liegt bereit — Zahlung läuft wie üblich innerhalb von 14 Tagen.",
      },
    ],
  },
  {
    title: "Recruiter-Call mit Lena Vogt?",
    daysAgo: 13,
    hour: 21,
    turns: [
      { role: "user", content: "Soll ich den Call mit der Recruiterin Lena Vogt machen? Bin unschlüssig." },
      {
        role: "assistant",
        content:
          "Kommt drauf an, wie neugierig du gerade bist. Sie hat zweimal geschrieben (Erstkontakt und ein sanftes Follow-up), wirkt also ernsthaft interessiert, nicht nur Massen-Mail. Ein unverbindliches 15-Minuten-Gespräch kostet wenig und du erfährst wenigstens, um welche Rolle und welches Gehalt es geht.",
      },
    ],
  },
  {
    title: "Alle offenen Entwürfe auflisten",
    daysAgo: 3,
    hour: 12,
    turns: [
      { role: "user", content: "Zeig mir kurz, wie viele offene Entwürfe ich gerade in jedem Konto habe." },
      {
        role: "assistant",
        content:
          "Auf der Home-Seite unter „Wartet auf deine Prüfung“ siehst du alle live, grob verteilt über Arbeit, Privat und Uni. Am meisten offen ist im Arbeitskonto, dort häufen sich die Acme- und Kunden-Threads.",
      },
    ],
  },
  {
    title: "Höfliche Absage an die Recruiterin",
    daysAgo: 2,
    hour: 11,
    draftLinkKey: "vogt-absage",
    turns: [
      { role: "user", content: "Schreib mir eine kurze, höfliche Absage an Lena Vogt." },
      {
        role: "assistant",
        content:
          "Erledigt, der Entwurf liegt in deinem privaten Postfach als Antwort auf ihre Anfrage: kurze, freundliche Absage mit offener Tür für später. Schau kurz drüber, bevor du ihn abschickst.",
      },
    ],
  },
  {
    title: "Was sagt Jonas zum Acme-Rabatt?",
    daysAgo: 1,
    hour: 20,
    turns: [
      { role: "user", content: "Was hat Jonas nochmal zum Rabatt-Wunsch von Acme gesagt?" },
      {
        role: "assistant",
        content: "Er ist dagegen und möchte erst eure Q3-Strategie kurz abstimmen, bevor irgendetwas an Acme rausgeht.",
      },
    ],
  },
  {
    title: "Übliche Schlussformel bei Freunden",
    daysAgo: 11,
    hour: 22,
    turns: [
      { role: "user", content: "Was sag ich normalerweise zum Schluss bei privaten Mails an Freunde?" },
      { role: "assistant", content: "Bei Freunden schließt du meist knapp mit \"LG\", bei Familie eher mit \"Liebe Grüße, Selin\"." },
    ],
  },
  {
    title: "Stand der Ferienwohnung-Buchung",
    daysAgo: 18,
    hour: 19,
    turns: [
      { role: "user", content: "Fass kurz zusammen, wie's mit der Ferienwohnung bisher lief." },
      {
        role: "assistant",
        content:
          "Verfügbarkeit war bestätigt, dann die Buchung mit einer fälligen Anzahlung von 150 €, die inzwischen bezahlt und bestätigt ist. Offen sind noch die genaue Anreisezeit und die Gästezahl, danach schickt Sabine Möller den Türcode kurz vor Anreise.",
      },
    ],
  },
];

/** ---- Library: ~12 plausible documents dropped into the demo library ---- */

export interface LibraryDocSeed {
  filename: string;
  content: string;
}

export const LIBRARY_DOCS: LibraryDocSeed[] = [
  {
    filename: "Vertragsentwurf-Nordwind-Acme.md",
    content: `# Vertragsentwurf: Nordwind Studio × Acme GmbH

**Projekt:** Website-Relaunch
**Zeitraum:** laufend
**Stundensatz:** 95 €/h

## Leistungsumfang

- Konzept & Wireframes
- UI-Design (Desktop + Mobile)
- Frontend-Entwicklung
- Content-Migration (ca. 40 Seiten)
- Testing & Launch-Begleitung

## Abrechnung

Monatliche Rechnung nach tatsächlichem Aufwand, Zeiterfassung wird auf Anfrage mitgeliefert. Zahlungsziel 14 Tage netto.

## Notiz (intern)

Acme fragt bei praktisch jeder Rechnung nach einer detaillierten Aufschlüsselung — künftig direkt mitschicken statt erst auf Nachfrage.`,
  },
  {
    filename: `Rechnungsuebersicht-${new Date().getFullYear()}-Q2.md`,
    content: `# Rechnungsübersicht Q2 ${new Date().getFullYear()} — Nordwind Studio

| Kunde | Rechnung | Betrag | Status |
|---|---|---|---|
| Acme GmbH | #A-1042 | 3.800 € | teilweise bezahlt (90%), Rest strittig |
| Kaltwasser & Rieger Architekten | #2031 | 2.450 € | bezahlt |
| Voss & Kline Consulting | — | — | Angebot ausstehend |
| Fenner Immobilien | — | — | Anfrage, noch kein Angebot |

Freelancer-Rechnungen (Weiterberechnung an Projekte):
- Yusuf Demir — 1.200 € (Acme-Projekt) — in Bearbeitung

Von Mara für den Quartalsabschluss benötigt: alle Belege bis Ende der letzten Juniwoche.`,
  },
  {
    filename: "Thesis-Gliederung.md",
    content: `# Gliederung — Masterarbeit (Arbeitstitel)

1. Einleitung
2. Theoretischer Hintergrund
3. Methodik
   - 3.1 Forschungsdesign
   - 3.2 Stichprobe und Auswahlkriterien (überarbeitet nach Feedback von Prof. Steiner)
   - 3.3 Erhebungsinstrumente
4. Ergebnisse
5. Diskussion
6. Fazit & Ausblick

**Nächste Schritte:** Kapitel 4 (Ergebnisse) bis Ende des Monats, Rohfassung Kapitel 5 danach. Abgabetermin des vollständigen Entwurfs: in drei Wochen.`,
  },
  {
    filename: "Meeting-Notizen-Jonas.md",
    content: `# Meeting-Notizen — Roadmap-Gespräch mit Jonas

**Themen:**
- Acme-Situation: bei den 40 Stunden bleiben, notfalls Zeiterfassung offenlegen
- Neue Anfragen (Voss & Kline, Fenner Immobilien) — beide vielversprechend, Kapazität ab nächstem Monat prüfen
- Speaker-Slot beim Design & Code Meetup im September — Jonas übernimmt, Thema: Markenarbeit für kleine Studios
- Freelancer-Pool erweitern, Yusuf war zuverlässig, evtl. für größere Projekte fest einplanen

**Offene Punkte:** Preisliste für ${new Date().getFullYear() + 1} vor Jahresende aktualisieren.`,
  },
  {
    filename: "Ferienwohnung-Seeblick-Buchung.txt",
    content: `Ferienwohnung Seeblick
Vermieterin: Sabine Möller
Anzahlung: 150 € (bezahlt, Referenz FW-2291)
Gäste: 2 Erwachsene + 1 Hund (15 € Gebühr)

Noch offen: genaue Anreisezeit, Türcode kommt 2 Tage vor Anreise per Mail.

Adresse und Details folgen nach vollständiger Bestätigung.`,
  },
  {
    filename: "Freelancer-Kontakte.md",
    content: `# Freelancer-Kontakte — Nordwind Studio

## Yusuf Demir — Entwicklung
- E-Mail: yusuf.demir.dev@gmail.com
- Satz: ca. 65 €/h
- Zuverlässig, meist eingesetzt bei größeren Backend-Aufgaben (zuletzt Acme-Projekt)

## Weitere
- Noch kein zweiter fester Freelancer für Design-Vertretung — offener Punkt aus dem letzten Roadmap-Gespräch.`,
  },
  {
    filename: "Acme-Zeiterfassung.md",
    content: `# Zeiterfassung — Acme GmbH Website-Relaunch (Rechnung #A-1042)

| Phase | Stunden |
|---|---|
| Konzept & Wireframes | 8 |
| UI-Design | 12 |
| Frontend-Entwicklung | 14 |
| Content-Migration | 4 |
| Testing | 2 |
| **Gesamt** | **40** |

Die von Acme bestrittenen 8 Stunden entfallen auf die Content-Migration und einen Teil des Testings — beides ist in den ursprünglichen Absprachen mit Thomas Brandt vom Kickoff-Meeting dokumentiert.`,
  },
  {
    filename: "Steiner-Feedback-Kapitel3.md",
    content: `# Notizen zu Prof. Steiners Feedback — Kapitel 3

**Ursprüngliches Feedback:**
- Stichprobengröße unzureichend begründet
- Fehlende Zitate: Müller 2019, Fischer & Bauer 2021

**Vorgenommene Änderungen:**
- Abschnitt 3.2 um eine Begründung der Stichprobengröße erweitert (Power-Analyse ergänzt)
- Fehlende Zitate eingefügt und Literaturverzeichnis aktualisiert

**Rückmeldung danach:** überwiegend zufrieden, nur noch kleine Anmerkungen zu Zitierweise und Formatierung offen.`,
  },
  {
    filename: "Nordwind-Markenrichtlinien.md",
    content: `# Nordwind Studio — kurze Markenrichtlinien (intern)

**Ton:** direkt, sachlich, wenig Floskeln. Kein "Wir freuen uns riesig".
**Farben:** Tiefblau (#1B2A4A), Sandbeige (#E8DFD0), Akzent Terrakotta (#C46A4A).
**Schrift:** Sans-Serif für digitale Anwendungen, Serife nur für Print-Angebote.

Gilt für alle nach außen gehende Materialien, auch Kundenangebote und Case Studies.`,
  },
  {
    filename: "Reise-Berlin-Ruegen.txt",
    content: `Reisenotizen — Ausflug Rügen (Ferienwohnung Seeblick)

Anreise: Auto, ca. 3 Std. von Berlin
Gepäck: Fahrräder mitnehmen, Strandweg direkt an der Wohnung
Einkaufen: kleiner Supermarkt im Ort, 5 Min. Fußweg
Zu klären: genaue Ankunftszeit an Sabine Möller melden, sobald feststeht`,
  },
  {
    filename: "Steuerunterlagen-Checkliste.md",
    content: `# Checkliste — Unterlagen für Mara (Quartalsabschluss)

- [ ] Alle Ausgangsrechnungen Q2 (inkl. Acme, Kaltwasser & Rieger)
- [ ] Eingangsrechnungen Freelancer (Yusuf Demir)
- [ ] Belege Software-Abos (Adobe, Figma, Slack)
- [ ] Kontoauszüge Geschäftskonto Q2
- [ ] Reisekosten (falls vorhanden)

Frist: Freitag dieser Woche, laut Maras letzter Mail.`,
  },
  {
    filename: "Team-Onboarding-Notizen.md",
    content: `# Onboarding-Notizen — neue Freelancer bei Nordwind Studio

1. Zugang zu Figma-Team und Slack-Workspace einrichten
2. Markenrichtlinien-Dokument teilen (siehe Nordwind-Markenrichtlinien.md)
3. Aktuellen Projektstand kurz vorstellen (aktuell: Acme, Kaltwasser & Rieger)
4. Rechnungsprozess erklären: Rechnung an Mara Lindqvist, Zahlungsziel 14 Tage
5. Ansprechpartner für Rückfragen: Jonas Weber (technisch), Selin Kaya (Kunden/Projekt)`,
  },
];
