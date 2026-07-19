export type ChangelogEntry = {
  version: string;
  /** ISO date the version was released. */
  date: string;
  /** Release notes per UI language; keep both in step. */
  notes: { en: string[]; de: string[] };
};

/**
 * Hand-maintained release notes shown in-app (the update card and Settings →
 * About → Changelog). Newest first; add an entry when cutting a tagged release.
 */
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "0.3.0",
    date: "2026-07-19",
    notes: {
      en: [
        "Release notes now show up in the app after an update, and any time under Settings, About.",
        "The window opens right away with a spinner while Trailin starts, instead of a silent wait.",
        "A cleaner window on the Mac: the app draws its own chrome edge to edge.",
        "WhatsApp drafts awaiting your approval can be revised in place instead of piling up copies.",
      ],
      de: [
        "Versionshinweise erscheinen nach einem Update direkt in der App und jederzeit unter Einstellungen, Über.",
        "Das Fenster öffnet sofort mit einem Ladeindikator, während Trailin startet, statt still zu warten.",
        "Aufgeräumtes Fenster auf dem Mac: Die App zeichnet ihre Oberfläche randlos selbst.",
        "WhatsApp-Entwürfe in der Freigabe lassen sich direkt überarbeiten, statt sich zu stapeln.",
      ],
    },
  },
  {
    version: "0.2.0",
    date: "2026-07-16",
    notes: {
      en: [
        "Home is now one agenda: missed runs, approvals, and the day's schedule in a single flow.",
        "Flat to-dos you can edit in place, kept current by the agent.",
        "Outbound messages draft for your approval before anything sends.",
      ],
      de: [
        "Start ist jetzt eine Agenda: verpasste Läufe, Freigaben und der Tagesplan in einem Fluss.",
        "Flache To-dos, direkt bearbeitbar, vom Agenten aktuell gehalten.",
        "Ausgehende Nachrichten werden zur Freigabe entworfen, bevor etwas gesendet wird.",
      ],
    },
  },
  {
    version: "0.1.0",
    date: "2026-07-16",
    notes: {
      en: [
        "First release: connect Gmail or Outlook, chat with your inbox, and run the agent on a schedule.",
      ],
      de: [
        "Erste Version: Gmail oder Outlook verbinden, mit dem Postfach chatten und den Agenten nach Zeitplan laufen lassen.",
      ],
    },
  },
];

export function changelogNotes(entry: ChangelogEntry, lang: string): string[] {
  return entry.notes[lang.startsWith("de") ? "de" : "en"];
}
