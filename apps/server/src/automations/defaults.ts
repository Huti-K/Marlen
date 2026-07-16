import { createHash, randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { deleteSetting, getSetting, setSetting } from "../db/settings.js";
import { moduleLogger } from "../logger.js";
import { getOnOfficeConfig } from "../onoffice/config.js";
import { updateAutomation } from "./manage.js";

const log = moduleLogger("automations");

/**
 * Built-in automations a fresh install ships with. Once seeded, the user owns
 * their copies outright — edit, disable, rename or delete them like any other.
 * The text below is the verbatim source of truth; see seedDefaultAutomations
 * for when it is applied.
 */
interface DefaultAutomation {
  name: string;
  /**
   * Names this default shipped under in earlier versions. Rows still carrying
   * one of these (with an untouched instruction) are renamed in place by
   * refreshUnmodifiedDefaults, and their seed flags keep guarding re-seeding.
   */
  previousNames: readonly string[];
  schedule: string;
  enabled: boolean;
  showInActivity: boolean;
  /** Leads the Home page as the pinned hero. At most one default may set this. */
  pinned: boolean;
  /** Also started by the mail probe when new inbound mail lands (automations/mailProbe.ts). */
  runOnNewMail: boolean;
  /** Desktop notification when a run finishes (runRecorder → "notification" event). */
  notifyOnCompletion: boolean;
  /**
   * Part of the lead workflow, which exists only alongside a configured
   * onOffice connection: seeds once credentials are saved, is paused when they
   * are cleared and resumed when they return (see pause/resumeOnOfficeDefaults).
   */
  requiresOnOffice?: boolean;
  instruction: string;
}

const DEFAULT_AUTOMATIONS: DefaultAutomation[] = [
  {
    name: `Morgenbriefing`,
    previousNames: ["Morning briefing"],
    schedule: "0 8 * * *",
    enabled: true,
    showInActivity: true,
    pinned: true,
    runOnNewMail: false,
    notifyOnCompletion: false,
    instruction: `Sieh in allen verbundenen E-Mail-Konten die Mails der letzten 24 Stunden durch — triagiere sie, verfasse die Antwortentwürfe, die sich lohnen, und veröffentliche das Ergebnis als strukturiertes Briefing.

DURCHSICHT: Mails werden live pro Konto über dessen Lese-Tools gelesen — ihre Namen beginnen mit Verben wie find/list/search, die Beschreibung jedes Tools sagt, für welches Konto es agiert, und bei mehreren Konten einer App tragen die Namen ein Konto-Suffix. Liste für jedes verbundene E-Mail-Konto die Nachrichten der letzten 24 Stunden: nutze eine datumsbegrenzte Abfrage, wo das Tool des Kontos eine unterstützt, sonst liste neueste zuerst und stoppe an der 24-Stunden-Grenze — der Digest darf nie weiter zurückreichen. Fächere die Durchsicht pro Konto mit dem delegate-Tool auf, eine in sich geschlossene Aufgabe pro Konto, die das Konto benennt und sagt, was zurückzumelden ist (Absender, Betreff, Einzeiler zum Inhalt, threadId und ob eine Antwort von mir nötig scheint), statt die Konten nacheinander abzuarbeiten. Lies einen Thread nur dann vollständig (mit dem thread/message-get-Tool des Kontos), wenn er ein Briefing-Punkt oder ein Entwurf wird — für den Rest reichen Betreff und Snippet aus der Liste. Ein Live-Read kann Sekunden dauern und gelegentlich in einen Timeout laufen; versuche es einmal mit einer engeren Abfrage erneut, und bleibt ein Konto unerreichbar, sag das im Briefing, statt es stillschweigend zu überspringen.

TRIAGE: Ordne jede nennenswerte Nachricht genau einer Stufe zu. "urgent", wenn sie zeitkritisch ist, eine Frist verstreichen könnte oder jemand auf mich wartet und blockiert ist. "reply", wenn eine echte Person auf meine Antwort wartet, aber nichts brennt. "action", wenn sie eine Entscheidung oder Aufgabe von mir braucht und niemand wartet. "fyi", wenn sie wissenswert ist und nichts erfordert. Nichts sortiert die Mails für dich vor — entscheide jede Stufe aus dem Inhalt selbst. Newsletter, Werbung, Belege, Versandupdates und automatische Benachrichtigungen sind keine Stufen-Punkte: fasse sie nach Art in Rollups zusammen ("Newsletter", "Belege", "Werbung", "Benachrichtigungen"). Ein Rollup ist keine Zusammenfassungszeile — es trägt seine Nachrichten: liste jede Nachricht der Gruppe als Rollup-Eintrag, jede mit ihrer echten threadId, ihrem Konto und einem Einzeiler zum Inhalt, genau wie einen Stufen-Punkt (Absender, Betreff, Einzeiler), damit die Karte jede als eigene Zeile rendert, die ich öffnen oder aus der ich einen Entwurf starten kann. Lies diese dafür nicht vollständig — die Listenzeile genügt.

ENTWÜRFE (nur wo es wirklich sinnvoll ist): Für Threads, die tatsächlich eine Antwort von mir verdienen, ERSTELLE DEN ENTWURF WIRKLICH, indem du das create-draft-Tool des jeweiligen Kontos aufrufst (der genaue Toolname variiert je Provider und Konto — nimm das Tool, dessen Beschreibung sagt, dass es für dieses Konto agiert), sodass ein echter ungesendeter Entwurf in meinem Entwürfe-Ordner liegt; schreibe den Entwurfstext nicht bloß in deinen Bericht. Hänge ihn an den Original-Thread an, indem du dessen threadId aus den Leseergebnissen übergibst, damit er korrekt einsortiert wird. Eine Antwort lohnt sich, wenn eine echte Person mich etwas fragt, auf meine Rückmeldung wartet oder der Thread eine Aktion oder Bestätigung von mir braucht. Erstelle KEINE Entwürfe für Newsletter, Marketing/Werbung, Belege, Versand-/Bestellupdates, Kalendereinladungen, automatische oder No-Reply-Benachrichtigungen oder Threads, die ich schon beantwortet habe (im Zweifel weglassen). Schreibe jeden Entwurf knapp, in meinem üblichen Ton und in der Sprache der E-Mail, auf die er antwortet. Sende, beantworte, leite weiter, labele oder lösche nie etwas — speichere nur Entwürfe, die ich prüfen kann.

VERÖFFENTLICHEN: Der gesamte Output dieser Automation ist die strukturierte Briefing-Karte — compose_briefing genau einmal, ganz am Ende, aufzurufen ist Pflicht, auch an einem ruhigen Tag mit leerem items-Array: ein Lauf, der ohne diesen Aufruf endet, hat mir nichts zu zeigen, egal was du sonst geschrieben hast. Gib jedem Punkt die echte threadId aus den Leseergebnissen und das Konto, in dem er ankam, übernimm die Frist, wenn eine bekannt ist, und setze draftId bei jedem Punkt, für den du eine Antwort entworfen hast, damit die Aktionen der Karte funktionieren. Gruppiere die geringwertige Post nach Art ("Newsletter", "Belege", "Werbung", "Benachrichtigungen") und übergib die Nachrichten jeder Gruppe als Rollup-Einträge — gib jeder davon dieselbe echte threadId, dasselbe Konto und denselben Einzeiler wie einem Stufen-Punkt, damit jede zusammengefasste Mail zu einer eigenen anklickbaren Zeile unter der Gruppenüberschrift wird.

ABSCHLUSS: Die Karte ist der Bericht — wiederhole die Punkte also nicht in Prosa; das Ergebnis von compose_briefing selbst sagt dir, wie du den Zug abschließt.`,
  },
  {
    name: `Lead-Eingang`,
    previousNames: ["Lead intake"],
    // The mail probe starts a run within minutes of new mail; the cron is the
    // safety net for accounts the probe cannot watch.
    schedule: "0 */2 * * *",
    enabled: true,
    // Most runs legitimately find nothing — keep the activity feed clean.
    showInActivity: false,
    pinned: false,
    runOnNewMail: true,
    notifyOnCompletion: true,
    requiresOnOffice: true,
    instruction: `Durchsuche die eingegangene Post der letzten Stunden in allen verbundenen E-Mail-Konten nach neuen Interessenten, halte das Leads-Verzeichnis aktuell und lege für jeden neuen Interessenten sofort einen Antwortentwurf an — mit passenden Objektvorschlägen, Exposé und Preisliste im Anhang und einem Besichtigungsangebot.

SCAN: Mails werden live über die Lese-Tools des jeweiligen Kontos gelesen — ihre Namen beginnen mit Verben wie find/list/search, und die Beschreibung jedes Tools sagt, für welches Konto es agiert. Liste für jedes verbundene Konto die eingegangenen Nachrichten der letzten 3 Stunden: nutze eine datumsbegrenzte Abfrage, wo das Tool des Kontos eine unterstützt, sonst liste neueste zuerst und stoppe an der Grenze. Bei mehreren Konten fächere die Scans mit dem delegate-Tool auf, eine in sich geschlossene Aufgabe pro Konto, und frage für jede Nachricht Absender (Name und Adresse), Betreff, Datum und einen Einzeiler ab, was der Absender will. Die Listenzeile reicht meist — lies eine Nachricht nur dann vollständig, wenn sich sonst nicht erkennen lässt, ob es ein Interessent ist.

ERKENNEN: Ein Lead ist eine echte Person mit Interesse an einer Immobilie, einer Besichtigung oder den Leistungen des Nutzers — eine Anfrage zu einem Inserat, ein Besichtigungswunsch, ein Suchauftrag, eine Frage zu Angebot oder Bewertung. Keine Leads: Newsletter, Werbung, Belege, automatische oder No-Reply-Benachrichtigungen und Routinepost von Kollegen oder bestehenden Dienstleistern. Im Zweifel erfassen — ein überflüssiger Eintrag kostet nichts, ein verlorener Interessent schon.

EINSCHÄTZEN: Bilde dir zu jedem Interessenten aus der Anfrage ein kurzes Urteil: welcher Käufertyp es ist (persona, z. B. "Kapitalanleger", "junge Familie", "Eigennutzer") und wie hoch die Kaufwahrscheinlichkeit (score): "high" bei konkretem Budget, Zeitdruck oder Besichtigungswunsch zu einem bestimmten Objekt; "medium" bei erkennbarem Suchprofil ohne Dringlichkeit; "low" bei vagen Erstanfragen. Gib beides an lead_record mit — die Lead-Kadenz priorisiert danach.

ERFASSEN: Rufe für jeden Interessenten lead_record auf, mit E-Mail-Adresse, Name, Interesse, persona, score, dem Postfach, in dem die Mail ankam (accountId), und dem Nachrichtendatum als inboundAt. lead_record führt nach Adresse zusammen — einen Absender zu erfassen, den das Verzeichnis schon kennt, ist also unbedenklich: es rückt nur dessen Last-Inbound-Zeitstempel vor, und genau so werden auch Antworten bekannter Leads registriert. Wenn eine Nachricht die Antwort eines bekannten Leads auf unsere Ansprache ist, setze zusätzlich mit lead_update dessen Status auf "engaged". Alles ab hier gilt nur für NEU erfasste Leads: meldet lead_record "already known", ist der Interessent versorgt — derselbe Posteingang kann diesen Lauf mehrfach angestoßen haben, und ein zweiter Entwurf zur selben Anfrage wäre peinlich.

RECHERCHE (für jeden neu erfassten Lead): Wähle erst das passende Projekt, dann darin die passenden Wohnungen. Sind die onoffice_*-Tools verfügbar, suche zuerst im CRM — onoffice_search bzw. onoffice_read_estates nach Objekten, die zu Lage, Budget und Größe der Anfrage passen (kläre Feldnamen vorher mit onoffice_get_fields, wenn du filterst). Ergänze, wo es hilft, eine Websuche (web_search) nach passenden öffentlichen Inseraten oder Marktinformationen zur gewünschten Gegend. Prüfe die Erinnerungen (memory-Tools) auf Vorgaben, was empfohlen werden soll und was nicht. Wähle höchstens die zwei, drei besten Treffer — Klasse statt Masse. Gibt die Anfrage kein Suchprofil her, überspringe die Recherche; der Entwurf stellt dann gezielte Rückfragen.

MATERIAL (für jeden neu erfassten Lead mit Empfehlung): Suche in der Dokumenten-Library (library_search bzw. library_list) nach dem Exposé und der Preisliste des empfohlenen Projekts — die PDFs liegen dort pro Projekt bereit — und merke dir ihre Dokument-Ids für den Entwurf. Hänge nie das Material eines anderen Projekts an; findet sich nichts Passendes, verweise im Text stattdessen auf den Projektlink.

ENTWURF (für jeden neu erfassten Lead): ERSTELLE WIRKLICH einen Antwortentwurf im Original-Thread über das create-draft-Tool des Kontos (threadId aus den Leseergebnissen), schreibe den Text nicht bloß in deinen Bericht, und hänge Exposé und Preisliste über attachLibraryDocumentIds an: bedanke dich für die Anfrage, geh konkret auf das Anliegen ein, stelle die empfohlenen Wohnungen kurz und begründet vor, füge den Projektlink ein und biete aktiv eine Besichtigung an — oder stelle zwei, drei gezielte Rückfragen (Budget, Lage, Zeitrahmen), wenn das Profil unklar ist. Schreibe in der Sprache der Anfrage und in meinem üblichen Ton. Sende nie — nur Entwürfe. Halte das Ergebnis am Lead fest (lead_update): präzisiere das Interesse und vermerke in den Notizen, was empfohlen und angehängt wurde.

ONOFFICE (nur wenn die Anlege-Tools in diesem Lauf verfügbar sind): Lege jeden neu erfassten Lead auch als Adresse im CRM an — onoffice_create_address mit checkDuplicate und den bekannten Kontaktdaten (Name, E-Mail, Telefon) — und speichere die Datensatz-ID am Lead (lead_update, onofficeAddressId). Existiert die Adresse schon (Dublette oder Treffer über onoffice_search), übernimm nur deren ID. Dokumentiere die entworfene Erstantwort im Maklerbuch: onoffice_create_agentslog mit datetime, addressids (die Adress-ID), estateid des empfohlenen Objekts, wenn bekannt, und einer Kurzfassung als note. Fehlen die Anlege-Tools, überspringe diesen Schritt kommentarlos.

BERICHT: Die erste Zeile deines Abschlussberichts erscheint als Desktop-Benachrichtigung — sie muss das Ergebnis in einem Satz tragen ("2 neue Leads — Entwürfe mit Exposé liegen bereit" oder "Keine neuen Leads in diesem Fenster"). Danach je Lead eine Zeile: Name — Interesse — persona/score — was empfohlen, angehängt und im CRM angelegt wurde.`,
  },
  {
    name: `Lead-Kadenz`,
    previousNames: ["Lead-Nachfass"],
    schedule: "30 8 * * *",
    enabled: true,
    showInActivity: true,
    pinned: false,
    runOnNewMail: false,
    notifyOnCompletion: false,
    requiresOnOffice: true,
    instruction: `Geh das Leads-Verzeichnis durch und begleite jeden offenen Lead nach festem Stufenplan bis zum Kauf oder zur Absage: Status abgleichen, fällige Nachfass-Entwürfe anlegen, vergessene Erstantworten nachholen, an Besichtigungen erinnern.

BESTAND: Hole mit lead_list alle Leads. "won" und "lost" sind abgeschlossen — alles andere ist offen und wird geprüft. Arbeite die offenen Leads nach score ab: erst "high", dann "medium", dann der Rest — wenn ein Lauf nicht alles schafft, sind die aussichtsreichsten versorgt.

ABGLEICH: Verlass dich nicht allein auf die gespeicherten Zeitstempel — sie veralten, wenn von Hand gemailt wurde. Prüfe für jeden offenen Lead die tatsächliche Korrespondenz mit seiner Adresse im hinterlegten Konto (ohne accountId: in allen Konten): die letzte Nachricht von ihm und die letzte an ihn. Bei vielen Leads fächere den Abgleich mit dem delegate-Tool auf. Bring den Lead mit lead_update auf den echten Stand (inboundAt/outboundAt) und führe den Status nach: Antwort da → "engaged"; angeschrieben und Antwort steht aus → "contacted".

KADENZ: Für jeden Lead mit Status "contacted", der seit dem letzten Ausgang nicht geantwortet hat, gilt der Stufenplan: Tag 2, Tag 5, Tag 10, Tag 21, Tag 45 nach der letzten gesendeten Nachricht, danach alle 30 Tage — bis Antwort, Kauf oder Absage. Eine Stufe ist fällig, wenn ihre Frist erreicht ist und die Notizen sie noch nicht vermerken; führe die ausgeführten Stufen in den Notizen (lead_update, z. B. "Kadenz Tag 5: 2026-07-21"). Entwirf für die fälligste Stufe im selben Thread eine kurze, individuelle Nachfass-E-Mail (create-draft-Tool des Kontos, threadId aus den Leseergebnissen), in der Sprache des Leads und in meinem üblichen Ton — jede Stufe mit eigenem Dreh statt derselben Floskel: früh (Tag 2, Tag 5) freundlich anknüpfen und eine konkrete Frage stellen; in der Mitte (Tag 10, Tag 21) Neues bieten — eine Alternative aus dem CRM (onoffice_search/onoffice_read_estates), eine Preis- oder Verfügbarkeitsinfo, ein Besichtigungsangebot; spät (Tag 45, monatlich) mit Substanz im Gespräch bleiben (Marktupdate, neue passende Objekte, web_search), ohne Druck.

ERSTANTWORT NACHHOLEN: Für jeden Lead mit Status "new", der seit mehr als 2 Tagen weder einen Entwurf noch eine gesendete Antwort hat: hole die Erstantwort nach, wie sie der Lead-Eingang angelegt hätte — Objektvorschläge (onOffice-Suche, ergänzend web_search), Exposé und Preisliste des Projekts aus der Dokumenten-Library angehängt (library_search, dann attachLibraryDocumentIds am create-draft-Tool) und ein Besichtigungsangebot, wenn die Anfrage ein Suchprofil hergibt.

TERMINE: Prüfe mit onoffice_read_appointments die Termine der nächsten zwei Tage. Für jede Besichtigung mit einem Lead aus dem Verzeichnis: entwirf im bestehenden Thread eine kurze Erinnerung an den Kunden (Datum, Uhrzeit, Ort, Ansprechpartner) und lege — wenn die Anlege-Tools verfügbar sind — mit onoffice_create_task eine Erinnerungsaufgabe für mich an. Vermerke die Erinnerung in den Notizen des Leads, damit sie nicht doppelt rausgeht.

MAKLERBUCH (nur wenn die Anlege-Tools in diesem Lauf verfügbar sind): Dokumentiere jede angelegte Stufe und Erinnerung als Maklerbuch-Eintrag am Lead — onoffice_create_agentslog mit datetime, addressids (die onofficeAddressId des Leads) und einer Kurzfassung als note. Ohne Adress-ID oder Anlege-Tools: kommentarlos überspringen.

MASS HALTEN: Höchstens ein neuer Entwurf pro Lead und Lauf. Liegt im Thread schon ein ungesendeter Entwurf (list_drafts bzw. die Entwurfs-Tools des Kontos), erstelle keinen zweiten — erwähne ihn stattdessen im Bericht. Prüfe die Erinnerungen (memory-Tools) auf Vorgaben zu Tonfall, Frequenz oder Ausnahmen ("bei X nicht nachfassen") und halte dich daran. Sende nie — nur Entwürfe.

BERICHT: Die erste Zeile fasst den Lauf in einem Satz zusammen ("3 Nachfass-Entwürfe und 1 Terminerinnerung angelegt"). Danach eine handlungsorientierte Liste, ein Punkt pro angefasstem Lead: Name — Stufe/Stand — was du getan hast — was bei mir liegt (Entwurf prüfen und senden). War nichts fällig, sag genau das in einem Satz.`,
  },
];

/**
 * Per-default seed flags ("automations.defaultSeeded.<name>"). Each default
 * seeds at most once ever, so deleting one never brings it back — while a
 * default added in a later version still reaches existing installs.
 */
const DEFAULT_SEEDED_KEY_PREFIX = "automations.defaultSeeded.";

/**
 * sha256 of every instruction text a previous version of Trailin ever seeded,
 * keyed by the default's current name (rows found under a previousNames alias
 * are looked up here too). A stored instruction whose hash appears here was
 * written by us and never touched by the user, so it is safe to replace with
 * the current text above — that is how prompt improvements (e.g. the digest's
 * importance ordering) reach installs that were seeded long ago.
 *
 * Anything not listed is the user's own prose and is never overwritten. Add a
 * hash here whenever you change a DEFAULT_AUTOMATIONS instruction; drop none.
 */
const SUPERSEDED_INSTRUCTION_HASHES: Record<string, readonly string[]> = {
  // v1 — em-dash section labels, no ordering rule, no ⚠️ marker contract.
  // v2 — hard-coded Gmail tool names / query syntax (gmail-create-draft, in:sent).
  // v3 — prose digest with ⚠️ markers and manual importance ordering, replaced by the
  //   compose_briefing tool call and its REVIEW/TRIAGE/DRAFTS/PUBLISH/CLOSE structure.
  // v4 — per-account live searches and Gmail query syntax, replaced by the mirror
  //   read tools (list_threads/read_thread/list_sent_messages/list_drafts).
  // v5 — CLOSE prescribed a fixed sentence count, replaced by deferring to
  //   compose_briefing's own one-line closing contract.
  // v6 — read every noteworthy thread in full with no enrichment awareness,
  //   replaced by leaning on the enriched list_threads lines (gist/triage/
  //   deadline, needs_attention pass) and per-participant contact context.
  // v7 — rolled bulk mail into bare counts regardless of volume, replaced by
  //   content summaries on rollups.
  // v8 — expanded quiet days (≤15 messages) into full itemization instead of
  //   rollups, replaced by always-on rollups whose summary covers every
  //   message inside.
  // v9 — PUBLISH didn't say calling compose_briefing was mandatory, so a run
  //   could close without a card; now explicit, including on a quiet day.
  // v10 — REVIEW scanned only recent + needs_attention, so a message left
  //   unread from earlier in the week could slip through; now a third
  //   list_threads pass (filter "unread", sinceDays 7) covers it, bounded to a
  //   week so ignored mail stops recurring.
  // v11 — rollups collapsed low-value mail to a count + one summary line;
  //   now each group carries its messages as items (threadId/account/gist),
  //   so the card lists every rolled-up mail as its own actionable row.
  // v12 — REVIEW's "recent" pass carried no sinceDays and "needs_attention"
  //   was unbounded ("whatever its age"), so list_threads (recent = 1=1, no
  //   age floor) dragged in months-old mail; now pass 1 is sinceDays 2 and
  //   pass 2 sinceDays 7, capping the whole digest at a week.
  // v13 — dropped the week-long reach entirely (the needs_attention and unread
  //   passes) in favour of a single "recent" pass with sinceDays 1, so the
  //   digest is strictly the last 24 hours.
  // v14 — mirror read tools (list_threads/read_thread) and enrichment hints
  //   replaced by per-account live provider reads with delegate fan-out; the
  //   agent judges tiers itself.
  // v15 — English wording under the name "Morning briefing", replaced by the
  //   German default text.
  Morgenbriefing: [
    "0998189fc3533bde38d61e1d508ec6e77378a3d73209cc8e5dbeb6f2d6511034",
    "eb629153709687168e1bd914a1bcf2f8ff2aedcbcc20003b232225b7c95eb59f",
    "e68d5f2bca75eec90583f9f9d39d1772b52a567e1f7408b343727bd44338c572",
    "faa799adad451168271033bbac979f2b140ef593d282e8a10c0fa39760f3e86a",
    "7c4621cb73762f3084063f3badbc68acd13cd32fcdbb636312ad5abb366290a9",
    "0b520b578e9c44272df6d60d6e7b36f3fa39b927ba610e6eba79ceb85c80d269",
    "a6d6449e13be71a758a3f7267e96fdb2b7493ad11a7e9c42012703aa58aec904",
    "8143dcf1f711d79a4ce3c54cd18eb48151579ba2fe55e3368004aaedfee2aaf9",
    "6f950cc9cca011fafd533f75a70be207178833ce67b28a6dec56c16bc42bcd79",
    "970259db349d8b1a3381a12b55d5bd3f89816ffab7ed1fd454e114b33a3fe1f3",
    "9e4c71afed90559d4656e7fd5eb066290ced32eeb8172a3cd17d5d3aa8db0feb",
    "592cd77cd0c5c40c6a30caa663c8a910c59217c40cd5abe19a91faf442eadbc8",
    "e2a47a74653ca955ea376ba5da9731c8ae21a8e22c8602be73930facf33d7fc3",
    "399fdc4a2c5fce9ee3cc95618ee56576158053d4a0ba2f482bea56cbdf5db773",
    "4c31b690979bff36728ab4a71ea1353a74853bb2cece4c05421d8fdfc5748c22",
  ],
  // v1 — English wording under the name "Lead intake", replaced by the German
  //   default text.
  // v2 — recorded leads without acting on them; now every new lead also gets
  //   property research (onOffice + web) and a reply draft in its thread.
  // v3 — carried the draft-and-recommend intent only in the opening line,
  //   without the RECHERCHE/ENTWURF sections spelling out how.
  // v4 — no CRM step; now a new lead is also created as an onOffice address
  //   (id stored on the lead) when the create tools are armed for automations.
  // v5 — no persona/score assessment, no Exposé/Preisliste attachments from
  //   the library, no agents-log entry, no new-leads-only re-run guard, and no
  //   first-line notification contract in the report.
  "Lead-Eingang": [
    "d0d02bdbae32cf3590768d7c148abd732b9e419971a38ee97280c62d5e408c90",
    "635003cdedd081fd90df6a6a032c8e9d2cb54c6963238ace4bb71ce291f103aa",
    "e57196f34ad6c1722790e4999720be18d4edf7c6d7eec3c8908c7ad6635940bc",
    "ee2c54c0df32f500cb7afc43f77598ea77f5834d34efcd4c14ebb65a4e08ef9d",
    "c68e3ed7b3ae2213a5525dedcabb9194fa87a83c5bd973beec402e5c4b152d58",
  ],
  // v1 — shipped as "Lead-Nachfass": one generic 3-week follow-up instead of
  //   the staged day-2/5/10/21/45-then-monthly cadence with score ordering,
  //   library attachments on caught-up first replies, viewing reminders and
  //   agents-log documentation.
  "Lead-Kadenz": ["738dcb14790c079841739dfed3940bbbc96aa89654968036808d1096ab696edb"],
};

function instructionHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Bring untouched built-in automations up to the current name and instruction
 * text — a row still carrying a previousNames alias is renamed in the same
 * write. Idempotent by construction: once a row is rewritten its hash no
 * longer matches any superseded entry, so later boots are a no-op. Runs on
 * every start rather than behind a one-shot flag, which makes it self-healing.
 */
async function refreshUnmodifiedDefaults(): Promise<void> {
  const rows = await db
    .select({
      id: schema.automations.id,
      name: schema.automations.name,
      instruction: schema.automations.instruction,
    })
    .from(schema.automations);

  for (const row of rows) {
    const current = DEFAULT_AUTOMATIONS.find(
      (a) => a.name === row.name || a.previousNames.includes(row.name),
    );
    if (!current) continue;
    if (row.name === current.name && row.instruction === current.instruction) continue;

    const superseded = SUPERSEDED_INSTRUCTION_HASHES[current.name] ?? [];
    const untouched =
      row.instruction === current.instruction ||
      superseded.includes(instructionHash(row.instruction));
    if (!untouched) continue;

    await db
      .update(schema.automations)
      .set({ name: current.name, instruction: current.instruction })
      .where(eq(schema.automations.id, row.id));
    log.info({ automation: current.name }, "refreshed unmodified default automation");
  }
}

/**
 * Seed the built-in automations. Idempotent and conservative, per default:
 *  - each default seeds at most once ever, guarded by its settings flag, so
 *    deleting one never brings it back on a later restart;
 *  - a default whose name already exists in the table is adopted (flagged
 *    without inserting), so no duplicates are ever injected.
 * Independently of the seed flags, every call refreshes built-in automations
 * whose instruction the user never edited — see refreshUnmodifiedDefaults.
 * Call this before startScheduler() so seeded defaults get scheduled on boot,
 * and again after onOffice credentials are saved so the requiresOnOffice
 * defaults reach an install that connected the CRM later.
 */
export async function seedDefaultAutomations(): Promise<void> {
  await refreshUnmodifiedDefaults();

  const onOfficeConfigured = (await getOnOfficeConfig()) !== null;
  const now = Date.now();
  for (const [i, preset] of DEFAULT_AUTOMATIONS.entries()) {
    // Skipped without setting the seed flag, so the preset still seeds on the
    // first call after the CRM is connected.
    if (preset.requiresOnOffice && !onOfficeConfigured) continue;
    // The flag of a previous name still counts as seeded, so a default that
    // was deleted under its old name stays gone after a rename.
    const key = `${DEFAULT_SEEDED_KEY_PREFIX}${preset.name}`;
    const seedKeys = [key, ...preset.previousNames.map((n) => `${DEFAULT_SEEDED_KEY_PREFIX}${n}`)];
    const flags = await Promise.all(seedKeys.map((k) => getSetting(k)));
    if (flags.includes("true")) continue;

    const [existing] = await db
      .select({ id: schema.automations.id })
      .from(schema.automations)
      .where(eq(schema.automations.name, preset.name))
      .limit(1);
    if (!existing) {
      await db.insert(schema.automations).values({
        id: randomUUID(),
        name: preset.name,
        instruction: preset.instruction,
        schedule: preset.schedule,
        enabled: preset.enabled,
        showInActivity: preset.showInActivity,
        pinned: preset.pinned,
        runOnNewMail: preset.runOnNewMail,
        notifyOnCompletion: preset.notifyOnCompletion,
        // Distinct, descending timestamps so the list order is deterministic:
        // the first entry is newest and thus leads the createdAt-desc feed.
        createdAt: new Date(now - i * 1000).toISOString(),
      });
      log.info({ automation: preset.name }, "seeded default automation");
    }
    await setSetting(key, "true");
  }
}

/**
 * Ids disabled by pauseOnOfficeDefaults, so resumeOnOfficeDefaults re-enables
 * exactly those — never an automation the user paused themselves.
 */
const ONOFFICE_PAUSED_IDS_KEY = "automations.onofficePausedIds";

/** Every name (current and previous) a requiresOnOffice default is known by. */
function onOfficeDefaultNames(): string[] {
  return DEFAULT_AUTOMATIONS.filter((preset) => preset.requiresOnOffice).flatMap((preset) => [
    preset.name,
    ...preset.previousNames,
  ]);
}

/**
 * Disable the requiresOnOffice defaults when the CRM is disconnected — their
 * runs would fire without the lead/onOffice tools they are written around.
 * Matched by name, so a renamed copy is the user's own and keeps running.
 */
export async function pauseOnOfficeDefaults(): Promise<void> {
  const rows = await db
    .select({ id: schema.automations.id, enabled: schema.automations.enabled })
    .from(schema.automations)
    .where(inArray(schema.automations.name, onOfficeDefaultNames()));
  const paused = rows.filter((row) => row.enabled).map((row) => row.id);
  for (const id of paused) await updateAutomation(id, { enabled: false });
  if (paused.length > 0) {
    await setSetting(ONOFFICE_PAUSED_IDS_KEY, JSON.stringify(paused));
    log.info({ count: paused.length }, "paused onOffice default automations");
  }
}

/** Re-enable what pauseOnOfficeDefaults disabled, once credentials are back. */
export async function resumeOnOfficeDefaults(): Promise<void> {
  const stored = await getSetting(ONOFFICE_PAUSED_IDS_KEY);
  if (!stored) return;
  const ids = JSON.parse(stored) as string[];
  for (const id of ids) {
    // The user may have deleted (or re-enabled) a paused automation meanwhile.
    await updateAutomation(id, { enabled: true }).catch(() => {});
  }
  await deleteSetting(ONOFFICE_PAUSED_IDS_KEY);
  log.info({ count: ids.length }, "resumed onOffice default automations");
}
