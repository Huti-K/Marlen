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
