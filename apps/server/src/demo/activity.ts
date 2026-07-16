import type { AgentCard, BriefingItem, MessageCard } from "@trailin/shared";
import { eq, inArray } from "drizzle-orm";
import { buildBriefingCard } from "../agent/card/kinds.js";
import { deleteConversationCascade } from "../db/conversationStore.js";
import { db, schema } from "../db/index.js";
import {
  deleteDocument,
  getLibraryDir,
  saveNote,
  startLibrary,
  stopLibrary,
} from "../library/ingest.js";
import { listDocuments } from "../library/store.js";
import { logger } from "../logger.js";
import {
  DEMO_PERSONAL_ACCOUNT_ID,
  DEMO_PERSONAL_CARD_ACCOUNT,
  DEMO_WORK_ACCOUNT_ID,
  DEMO_WORK_CARD_ACCOUNT,
} from "./accounts.js";

/**
 * Demo activity fixtures: everything beyond the golden chats — automations
 * with a week of runs (including the pinned Home lead card), pending
 * automation suggestions, memories in every scope, learning-activity
 * history, per-account voice-learn state, a stretch of recurring morning
 * chats (they double as real input for the suggestion sweep), and two
 * library notes. Every id and visible name carries a demo marker so
 * resetDemoActivity() can remove exactly what seedDemoActivity() wrote.
 *
 * Fixture data — exempt from the source line cap (see CLAUDE.md).
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** ISO timestamp `days` back at the given local wall-clock hour/minute. */
function daysAgoAt(days: number, hour: number, minute: number): string {
  const date = new Date(Date.now() - days * DAY_MS);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

/** Wrap agent cards the way a stored turn does (MessageCard[] as JSON). */
function serializeCards(...cards: AgentCard[]): string {
  const wrapped: MessageCard[] = cards.map((card, i) => ({
    toolCallId: `demo-activity-tool-${i}`,
    card,
  }));
  return JSON.stringify(wrapped);
}

// ---------------------------------------------------------------------------
// Automations + runs
// ---------------------------------------------------------------------------

const DIGEST_AUTOMATION_ID = "demo-automation-digest";
const WEEKLY_AUTOMATION_ID = "demo-automation-weekly";
const PAUSED_AUTOMATION_ID = "demo-automation-invoices";
const DEMO_AUTOMATION_IDS = [DIGEST_AUTOMATION_ID, WEEKLY_AUTOMATION_ID, PAUSED_AUTOMATION_ID];

const DIGEST_INSTRUCTION = `Sieh alle verbundenen Konten durch und fasse die E-Mails der letzten 24 Stunden zusammen: wer wartet auf eine Antwort, welche Fristen laufen, was kann weg. Erstelle für Threads, die eine Antwort von mir brauchen, einen Entwurf. Niemals senden — nur Entwürfe.`;

const WEEKLY_INSTRUCTION = `Erstelle freitags einen Wochenrückblick über alle Konten: erledigte Themen, offene Antworten, Rechnungen und Termine der kommenden Woche. Veröffentliche das Ergebnis als strukturiertes Briefing (compose_briefing).`;

const INVOICE_INSTRUCTION = `Suche montags in allen Konten nach unbezahlten Rechnungen, deren Zahlungsziel überschritten ist, und lege für jede eine freundliche Zahlungserinnerung als Entwurf an.`;

interface DemoRun {
  id: string;
  automationId: string;
  automationName: string;
  instruction: string;
  status: "success" | "error";
  result: string;
  cards?: string;
  startedAt: string;
  durationMinutes: number;
}

const WEEKLY_BRIEFING_ITEMS: BriefingItem[] = [
  {
    threadId: "thread-acme-2291",
    accountId: DEMO_WORK_ACCOUNT_ID,
    sender: "Thomas Brandt",
    senderEmail: "t.brandt@acme-gmbh.de",
    subject: "Re: Rechnung #A-2291 – Zahlungserinnerung",
    gist: "Rechnung noch offen — Antwortentwurf liegt bereit, Frist Freitag.",
    priority: "urgent",
    deadline: "Freitag 17:00",
    draftId: "demo-draft-acme-2291",
  },
  {
    threadId: "thread-relaunch-brief",
    accountId: DEMO_WORK_ACCOUNT_ID,
    sender: "Miriam Weber",
    subject: "Relaunch-Briefing für die Website",
    gist: "Wartet auf Feedback zum Zeitplan — zwei Tage alt.",
    priority: "reply",
  },
  {
    threadId: "thread-seeblick-august",
    accountId: DEMO_PERSONAL_ACCOUNT_ID,
    sender: "Sabine Möller",
    subject: "Ferienwohnung Seeblick – Buchung im August",
    gist: "Adresse für die Buchungsbestätigung fehlt noch.",
    priority: "action",
  },
];

const WEEKLY_BRIEFING_CARD = buildBriefingCard({
  headline: "Ruhige Woche — eine Rechnung braucht dich noch.",
  periodLabel: "diese Woche",
  accounts: [DEMO_WORK_CARD_ACCOUNT, DEMO_PERSONAL_CARD_ACCOUNT],
  scanned: 87,
  items: WEEKLY_BRIEFING_ITEMS,
  rollups: [
    {
      label: "Newsletter & Quittungen",
      items: [
        {
          threadId: "roll-figma",
          accountId: DEMO_WORK_ACCOUNT_ID,
          sender: "Figma",
          subject: "What's new in Figma",
          gist: "Produkt-Update.",
          priority: "fyi",
        },
        {
          threadId: "roll-bahn",
          accountId: DEMO_PERSONAL_ACCOUNT_ID,
          sender: "Deutsche Bahn",
          subject: "Ihre Buchungsbestätigung",
          gist: "Ticket nach Hamburg, 42,90 €.",
          priority: "fyi",
        },
      ],
    },
  ],
});

/** Digest results for the last days — newest first is not required; ids fix the order. */
const DIGEST_RESULTS = [
  `**3 neue Threads seit gestern.**\n\n- **Thomas Brandt (Acme):** bittet erneut um Rechnung #A-2291 als PDF — Entwurf liegt bereit.\n- **Miriam Weber:** Relaunch-Briefing, wartet auf dein Feedback zum Zeitplan.\n- **Newsletter:** 4 Stück, nichts Dringendes.`,
  `**Ruhiger Morgen.**\n\n- **Sabine Möller:** braucht noch deine Adresse für die Buchungsbestätigung (Seeblick).\n- **Quittungen:** Apple iCloud+ 0,99 €.`,
  `**2 Antworten stehen aus.**\n\n- **Acme #A-2291:** weiterhin offen, Zahlungsziel überschritten.\n- **Zahnarztpraxis Dr. Yıldız:** Termin bis Mittwoch bestätigen.`,
  `**Nichts Dringendes.**\n\n- 6 Newsletter, 2 Quittungen — alles in den Rollups.\n- Kein Thread wartet auf dich.`,
  `**1 neuer Auftrag im Anflug.**\n\n- **Jonas Petersen:** fragt nach einem Angebot für ein Logo-Redesign — Entwurf mit Rückfragen liegt bereit.\n- **Team Nordwind:** Wochen-Update, keine Rückmeldung nötig.`,
] as const;

function demoRuns(): DemoRun[] {
  const runs: DemoRun[] = [];

  // Daily digest: the newest run is minutes old and successful, so boot
  // catch-up sees today's slot as covered and never auto-executes the demo
  // automation with a real LLM call.
  DIGEST_RESULTS.forEach((result, i) => {
    runs.push({
      id: `demo-run-digest-${i}`,
      automationId: DIGEST_AUTOMATION_ID,
      automationName: "[demo] Posteingang-Digest",
      instruction: DIGEST_INSTRUCTION,
      status: "success",
      result,
      startedAt:
        i === 0 ? new Date(Date.now() - 10 * 60 * 1000).toISOString() : daysAgoAt(i, 8, 31 + i),
      durationMinutes: 2,
    });
  });
  runs.push({
    id: "demo-run-digest-error",
    automationId: DIGEST_AUTOMATION_ID,
    automationName: "[demo] Posteingang-Digest",
    instruction: DIGEST_INSTRUCTION,
    status: "error",
    result: "Run stopped after exceeding the 300s time limit.",
    startedAt: daysAgoAt(6, 8, 30),
    durationMinutes: 5,
  });

  // Weekly review: one rich run with a briefing card — the pinned Home lead.
  runs.push({
    id: "demo-run-weekly-0",
    automationId: WEEKLY_AUTOMATION_ID,
    automationName: "[demo] Wochenrückblick",
    instruction: WEEKLY_INSTRUCTION,
    status: "success",
    result:
      "Wochenrückblick: 87 Mails gesichtet, ein Thema offen — die Acme-Rechnung. Details im Briefing.",
    cards: serializeCards(WEEKLY_BRIEFING_CARD),
    startedAt: new Date(Date.now() - 1 * HOUR_MS).toISOString(),
    durationMinutes: 3,
  });

  return runs;
}

// ---------------------------------------------------------------------------
// Suggestions, memories, learn + voice activity
// ---------------------------------------------------------------------------

const DEMO_SUGGESTION_IDS = ["demo-suggestion-followup", "demo-suggestion-evening"];

function demoSuggestions() {
  return [
    {
      id: "demo-suggestion-followup",
      name: "[demo] Angebots-Nachfass montags",
      instruction:
        "Suche in allen verbundenen Konten nach Angeboten, die vor mehr als fünf Tagen verschickt wurden und auf die keine Antwort kam. Lege für jedes eine kurze, freundliche Nachfass-E-Mail als Entwurf an (niemals senden) und fasse zusammen, welche Angebote noch offen sind.",
      schedule: "0 9 * * 1",
      rationale:
        "Du hast in den letzten zwei Wochen dreimal montags nach offenen Angeboten gefragt.",
      status: "pending" as const,
      createdAt: daysAgoAt(1, 3, 30),
      decidedAt: null,
    },
    {
      id: "demo-suggestion-evening",
      name: "[demo] Feierabend-Check",
      instruction:
        "Prüfe werktags um 18 Uhr alle Konten: Liste jede E-Mail von heute auf, die noch eine Antwort von mir braucht, mit Absender, Betreff und einer Zeile Kontext. Wenn nichts offen ist, sag das ausdrücklich.",
      schedule: "0 18 * * 1-5",
      rationale:
        "Du fragst abends regelmäßig, ob noch etwas Wichtiges im Posteingang liegt — zuletzt viermal in zwei Wochen.",
      status: "pending" as const,
      createdAt: daysAgoAt(1, 3, 30),
      decidedAt: null,
    },
  ];
}

const DEMO_MEMORY_IDS = [
  "demo-memory-language",
  "demo-memory-signoff",
  "demo-memory-invoices",
  "demo-memory-brandt",
];

function demoMemories() {
  return [
    {
      id: "demo-memory-language",
      content: "Antworten immer auf Deutsch verfassen, auch wenn die eingehende Mail Englisch ist.",
      source: "user" as const,
      accountId: null,
      contactId: null,
      usedCount: 6,
      lastUsedAt: daysAgoAt(1, 9, 12),
      createdAt: daysAgoAt(21, 10, 0),
      updatedAt: daysAgoAt(21, 10, 0),
    },
    {
      id: "demo-memory-signoff",
      content: 'Geschäftliche Mails enden mit "Viele Grüße, Selin Kaya".',
      source: "agent" as const,
      accountId: null,
      contactId: null,
      usedCount: 3,
      lastUsedAt: daysAgoAt(2, 8, 40),
      createdAt: daysAgoAt(14, 3, 5),
      updatedAt: daysAgoAt(14, 3, 5),
    },
    {
      id: "demo-memory-invoices",
      content: "Rechnungen an Acme GmbH gehen immer in Kopie an buchhaltung@acme-gmbh.de.",
      source: "agent" as const,
      accountId: DEMO_WORK_ACCOUNT_ID,
      contactId: null,
      usedCount: 2,
      lastUsedAt: daysAgoAt(3, 16, 40),
      createdAt: daysAgoAt(10, 11, 20),
      updatedAt: daysAgoAt(10, 11, 20),
    },
    {
      id: "demo-memory-brandt",
      content: "Thomas Brandt bevorzugt kurze, direkte Antworten ohne Smalltalk.",
      source: "agent" as const,
      accountId: null,
      contactId: "t.brandt@acme-gmbh.de",
      usedCount: 1,
      lastUsedAt: daysAgoAt(4, 9, 2),
      createdAt: daysAgoAt(9, 9, 0),
      updatedAt: daysAgoAt(9, 9, 0),
    },
  ];
}

const DEMO_LEARN_RUN_IDS = ["demo-learn-0", "demo-learn-1", "demo-learn-2"];

function demoLearnRuns() {
  return [
    {
      id: "demo-learn-0",
      reason: "scheduled" as const,
      status: "ok" as const,
      matched: 2,
      pending: 3,
      identical: 1,
      learned: 2,
      lessons: 2,
      error: null,
      startedAt: daysAgoAt(1, 3, 0),
      finishedAt: daysAgoAt(1, 3, 1),
    },
    {
      id: "demo-learn-1",
      reason: "scheduled" as const,
      status: "ok" as const,
      matched: 0,
      pending: 0,
      identical: 0,
      learned: 0,
      lessons: 0,
      error: null,
      startedAt: daysAgoAt(2, 3, 0),
      finishedAt: daysAgoAt(2, 3, 0),
    },
    {
      id: "demo-learn-2",
      reason: "boot" as const,
      status: "error" as const,
      matched: 1,
      pending: 2,
      identical: 0,
      learned: 0,
      lessons: 0,
      error: "model call timed out after 60s",
      startedAt: daysAgoAt(3, 7, 45),
      finishedAt: daysAgoAt(3, 7, 46),
    },
  ];
}

function demoVoiceRuns() {
  return [
    {
      accountId: DEMO_WORK_ACCOUNT_ID,
      status: "ok" as const,
      error: null,
      startedAt: daysAgoAt(5, 14, 2),
      finishedAt: daysAgoAt(5, 14, 3),
    },
    {
      accountId: DEMO_PERSONAL_ACCOUNT_ID,
      status: "error" as const,
      error: "no sent mail to learn from yet",
      startedAt: daysAgoAt(5, 14, 2),
      finishedAt: daysAgoAt(5, 14, 2),
    },
  ];
}

// ---------------------------------------------------------------------------
// Recurring morning chats — visible history AND real input for the
// suggestion sweep (≥6 similar user requests inside its 14-day window).
// ---------------------------------------------------------------------------

const RECURRING_CHAT_COUNT = 8;

function demoRecurringChats() {
  const asks = [
    "Fass mir bitte den Posteingang von heute Morgen zusammen.",
    "Was ist über Nacht reingekommen? Nur das Wichtige.",
    "Gib mir die Morgenübersicht über beide Konten.",
    "Was liegt heute im Posteingang an?",
    "Kurzer Überblick bitte: neue Mails seit gestern Abend.",
    "Fass den Posteingang zusammen, bevor ich ins Meeting gehe.",
    "Was kam heute Morgen rein, worauf muss ich antworten?",
    "Morgenzusammenfassung bitte — was ist dringend?",
  ];
  const replies = [
    "Drei neue Threads — nur die Acme-Rechnung ist dringend.",
    "Nichts Dringendes über Nacht, zwei Newsletter.",
    "Beide Konten ruhig; Frau Möller wartet weiter auf deine Adresse.",
    "Ein neuer Auftragskontakt, Rest ist Routine.",
    "Zwei Antworten stehen aus, keine Fristen heute.",
    "Alles Unkritische in den Rollups — du bist meeting-bereit.",
    "Eine Mail braucht dich: das Relaunch-Briefing von Miriam.",
    "Nichts brennt; die Acme-Rechnung bleibt der offene Punkt.",
  ];
  return asks.map((ask, i) => {
    // Spread over ~10 days, always mid-morning, skipping some days so the
    // pattern looks organic rather than machine-stamped.
    const day = Math.min(9, Math.round((i * 10) / RECURRING_CHAT_COUNT) + 1);
    const at = daysAgoAt(day, 8, 5 + i * 3);
    return {
      id: `demo-recurring-${i}`,
      title: `[demo] Morgenübersicht ${i + 1}`,
      ask,
      reply: replies[i] ?? "Erledigt.",
      createdAt: at,
    };
  });
}

// ---------------------------------------------------------------------------
// Library notes
// ---------------------------------------------------------------------------

const DEMO_NOTE_TITLE_PREFIX = "[demo] ";

const DEMO_NOTES = [
  {
    title: "[demo] Preisliste Nordwind Studio",
    content: `# Preisliste Nordwind Studio (Stand Juli 2026)

| Leistung | Preis |
| --- | --- |
| Logo-Design (3 Entwürfe, 2 Runden) | 2.400 € |
| Corporate Design Paket | 6.800 € |
| Website-Design (bis 8 Seiten) | 9.500 € |
| Tagessatz Beratung | 1.100 € |

Alle Preise netto. Zahlungsziel 14 Tage, bei Projekten über 5.000 € sind 30 % Anzahlung fällig.`,
  },
  {
    title: "[demo] Onboarding-Checkliste Neukunden",
    content: `# Onboarding-Checkliste Neukunden

1. Kennenlern-Call (30 min) und Briefing-Dokument anlegen
2. Angebot mit Zahlungsplan verschicken — Vorlage im Ordner "Angebote"
3. Nach Auftragsbestätigung: Anzahlungsrechnung (30 %)
4. Kickoff-Termin und gemeinsamen Projektordner einrichten
5. Wöchentliches Status-Update jeden Freitag per Mail`,
  },
];

// ---------------------------------------------------------------------------
// Seed / reset
// ---------------------------------------------------------------------------

async function seedAutomations(): Promise<void> {
  // At most one automation may be pinned; only lead Home with the demo
  // weekly review when the user hasn't pinned one of their own.
  const [alreadyPinned] = await db
    .select({ id: schema.automations.id })
    .from(schema.automations)
    .where(eq(schema.automations.pinned, true));

  await db.insert(schema.automations).values([
    {
      id: DIGEST_AUTOMATION_ID,
      name: "[demo] Posteingang-Digest",
      instruction: DIGEST_INSTRUCTION,
      schedule: "30 8 * * *",
      enabled: true,
      showInActivity: true,
      pinned: false,
      createdAt: daysAgoAt(12, 9, 0),
    },
    {
      id: WEEKLY_AUTOMATION_ID,
      name: "[demo] Wochenrückblick",
      instruction: WEEKLY_INSTRUCTION,
      schedule: "0 17 * * 5",
      enabled: true,
      showInActivity: true,
      pinned: !alreadyPinned,
      createdAt: daysAgoAt(12, 9, 1),
    },
    {
      id: PAUSED_AUTOMATION_ID,
      name: "[demo] Rechnungs-Erinnerungen",
      instruction: INVOICE_INSTRUCTION,
      schedule: "0 9 * * 1",
      enabled: false,
      showInActivity: true,
      pinned: false,
      createdAt: daysAgoAt(12, 9, 2),
    },
  ]);

  for (const run of demoRuns()) {
    const finishedAt = new Date(
      Date.parse(run.startedAt) + run.durationMinutes * 60 * 1000,
    ).toISOString();
    await db.insert(schema.automationRuns).values({
      id: run.id,
      automationId: run.automationId,
      status: run.status,
      result: run.result,
      cards: run.cards ?? null,
      startedAt: run.startedAt,
      finishedAt,
    });

    // Mirror runRecorder.ts: each run owns a conversation (id = run id) whose
    // two messages are the instruction prompt and the run's report, so the
    // "open in chat" button on every demo run works.
    await db.insert(schema.conversations).values({
      id: run.id,
      title: `Run: ${run.automationName}`,
      type: "automation",
      createdAt: run.startedAt,
    });
    await db.insert(schema.messages).values([
      {
        id: `${run.id}-m0`,
        conversationId: run.id,
        role: "user",
        content: `Scheduled automation "${run.automationName}". Execute this instruction now and report the outcome:\n\n${run.instruction}`,
        createdAt: run.startedAt,
      },
      {
        id: `${run.id}-m1`,
        conversationId: run.id,
        role: "assistant",
        content: run.result,
        cards: run.cards ?? null,
        error: run.status === "error" ? run.result : null,
        createdAt: finishedAt,
      },
    ]);
  }
}

async function seedRecurringChats(): Promise<void> {
  for (const chat of demoRecurringChats()) {
    await db.insert(schema.conversations).values({
      id: chat.id,
      title: chat.title,
      type: "chat",
      createdAt: chat.createdAt,
    });
    await db.insert(schema.messages).values([
      {
        id: `${chat.id}-m0`,
        conversationId: chat.id,
        role: "user",
        content: chat.ask,
        createdAt: chat.createdAt,
      },
      {
        id: `${chat.id}-m1`,
        conversationId: chat.id,
        role: "assistant",
        content: chat.reply,
        createdAt: new Date(Date.parse(chat.createdAt) + 20_000).toISOString(),
      },
    ]);
  }
}

/** Insert everything demo beyond the golden chats. Callers reset first — inserts assume clean ids. */
export async function seedDemoActivity(): Promise<void> {
  await seedAutomations();
  await seedRecurringChats();
  await db.insert(schema.automationSuggestions).values(demoSuggestions());
  await db.insert(schema.memories).values(demoMemories());
  await db.insert(schema.learnRuns).values(demoLearnRuns());
  await db.insert(schema.voiceLearnRuns).values(demoVoiceRuns());

  // startLibrary points the module at the user's saved drop folder and runs
  // the initial scan; saveNote then writes and indexes each note in place.
  await startLibrary((message) => logger.info(message));
  try {
    for (const note of DEMO_NOTES) await saveNote(note.title, note.content);
  } finally {
    stopLibrary();
  }
  logger.info({ folder: getLibraryDir() }, "demo: notes saved into the library folder");
}

/** Remove exactly what seedDemoActivity() wrote; safe when nothing was seeded. */
export async function resetDemoActivity(): Promise<void> {
  // Runs and recurring chats each own a conversation + messages.
  const runs = await db
    .select({ id: schema.automationRuns.id })
    .from(schema.automationRuns)
    .where(inArray(schema.automationRuns.automationId, DEMO_AUTOMATION_IDS));
  for (const run of runs) deleteConversationCascade(run.id);
  for (const chat of demoRecurringChats()) deleteConversationCascade(chat.id);

  await db
    .delete(schema.automationRuns)
    .where(inArray(schema.automationRuns.automationId, DEMO_AUTOMATION_IDS));
  await db.delete(schema.automations).where(inArray(schema.automations.id, DEMO_AUTOMATION_IDS));
  await db
    .delete(schema.automationSuggestions)
    .where(inArray(schema.automationSuggestions.id, DEMO_SUGGESTION_IDS));
  await db.delete(schema.memories).where(inArray(schema.memories.id, DEMO_MEMORY_IDS));
  await db.delete(schema.learnRuns).where(inArray(schema.learnRuns.id, DEMO_LEARN_RUN_IDS));
  await db
    .delete(schema.voiceLearnRuns)
    .where(
      inArray(schema.voiceLearnRuns.accountId, [DEMO_WORK_ACCOUNT_ID, DEMO_PERSONAL_ACCOUNT_ID]),
    );

  await startLibrary((message) => logger.info(message));
  try {
    const demoDocs = (await listDocuments()).filter((doc) =>
      doc.title.startsWith(DEMO_NOTE_TITLE_PREFIX),
    );
    for (const doc of demoDocs) await deleteDocument(doc.id);
  } finally {
    stopLibrary();
  }
}
