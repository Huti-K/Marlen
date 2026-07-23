Marlen app guide — what the app around you is and how the user works with it. UI labels are
given as English / German; use the one matching the app language when pointing the user somewhere.

What Marlen is
- A desktop app (Mac and Windows) with an AI email assistant: it reads, drafts and organizes
  mail across the user's connected accounts, runs scheduled automations, and answers this chat.
- Local-first: the app, its database and its files live on the user's machine. Mail is read live
  from the providers when needed; there is no Marlen cloud and no server-side copy of the
  mailbox. Only the provider and AI API calls themselves leave the machine.
- Single user: one person, one machine, their accounts. The AI runs on the user's own sign-in
  (a Claude, Copilot or ChatGPT subscription, or an API key).

Pages (sidebar, top to bottom)
- Home / Start: the day at a glance (details below).
- Chat: this conversation. Also available as a side panel over every other page.
- Leads: the prospect directory — only visible while an onOffice CRM is connected.
- Automations / Automatisierungen: standing instructions on a schedule or on demand.
- Knowledge / Wissen: a file browser over the assistant's memory, skills and document library.
- Settings / Einstellungen: AI sign-in, accounts and permissions, file access, preferences,
  local data, About.
- Search / Suche (Cmd+K) finds chats, briefings, drafts, documents and memory entries from
  anywhere. A light/dark toggle sits in the header; keyboard shortcuts under Cmd+Shift+7.

Home / Start
- Banners on top when relevant: setup incomplete, provider unreachable, and missed scheduled
  runs with a "Run now / Jetzt ausführen" catch-up button. New items since the last visit wear
  a dot and are counted, with "Mark all seen / Alles gesehen".
- Briefing hero: the pinned automation's latest result (typically a morning briefing), with
  buttons to refresh it and to open it in chat.
- "To do / Zu erledigen": overdue items first ("Missed / Überfällig"), then drafts waiting for
  approval ("To approve / Zur Freigabe"), then to-dos grouped by day ("Today / Heute",
  "Tomorrow / Morgen", dates, "Anytime / Jederzeit") interleaved with the day's upcoming
  scheduled runs. The plus adds a to-do; the pencil edits one in place (title, due date, note,
  and an automation to start on completion); rows drag between days; completed items collapse
  into a "done / erledigt" disclosure.
- "New results / Neue Ergebnisse": output cards of recent successful automation runs.
- "Activity / Aktivität" (collapsed by default): the full run log with status, why each run
  started ("Caught up / Nachgeholt", "From a to-do / Aus To-do", "New mail / Neue Mail"), a
  retry for failed runs, and open-in-chat.

Chat
- The composer sends on Enter (Shift+Enter for a new line). There is no file-upload control and
  no voice input; files reach the assistant via the Knowledge page or the library folder.
- A focus chip in the header scopes the conversation to one account (or all); cards can pin a
  specific email to the next message.
- The assistant's work renders as cards in the conversation: email drafts (with send / keep /
  discard), WhatsApp drafts, briefings, clarifying choices, research progress, charts, leads,
  attachment lists with an inline viewer ("Save to library / In der Bibliothek speichern").
- If the AI provider rejects a turn for rate limits, a notice offers one-click switching to
  another signed-in provider; the user then resends the message.
- The history rail lists past chats and automation runs; chats can be renamed and deleted.

Outbound flow (email and WhatsApp)
- An email the assistant drafts in chat is first only a PROPOSAL on its card: nothing is in
  the mail account yet. "Keep as draft / Als Entwurf behalten" on the card (or asking the
  assistant to keep it) is what saves it into the account's Drafts folder, where it also joins
  Home's "To approve / Zur Freigabe" list; Send sends it right away; Discard drops it without
  a trace.
- Automations create real mailbox drafts directly (nobody is there to keep a proposal). Those
  wait on Home under "To approve / Zur Freigabe": send, edit in place, discard, or refine —
  refine reopens the chat the draft came from with full context. Kept and automation drafts
  also exist in the real mailbox ("Open in mailbox / Im Postfach öffnen").
- Nothing sends on its own. Sending by the assistant needs the account's "Send / Senden" grant
  armed in Settings AND an explicit instruction to send; WhatsApp has its own "Auto-send /
  Automatisch senden" grant, off by default.
- Draft bodies pass through a humanizing edit before saving; the draft card shows the final
  text, with the account's signature set off below the body. Drafts written as an account with
  a learned style wear an "In your style / In Ihrem Stil" badge.

Automations / Automatisierungen
- An automation is a named standing instruction plus a schedule: every day, weekdays, chosen
  days, a specific date (runs once), or "On demand only / Nur auf Abruf" (a manual button; a
  raw cron field hides behind "Advanced / Erweitert"). Options per automation: pin its result
  to the top of Home, show/hide in activity, also run immediately when new mail arrives, and
  desktop-notify when a run finishes. Cards drag to reorder, pause with a switch, and show
  recent runs.
- Marlen also suggests automations from patterns in recent chats; suggestions are reviewed on
  the Automations page (add or dismiss).
- Unattended runs can read, search and create drafts, but never send, delete or change mail,
  regardless of grants. Anything needing a human lands as a draft or a to-do.

Leads (with onOffice connected)
- Every prospect the assistant tracks: filed automatically from email inquiries or added by
  hand ("New lead / Neuer Lead"). Rows carry a status (New/Neu, Contacted/Kontaktiert,
  Engaged/Im Gespräch, Qualified/Qualifiziert, Won/Gewonnen, Lost/Verloren) and a priority
  (A hot, B warm, C cold), and expand to interest, notes, contact data and attached follow-up
  automations. Deleting a lead deletes its attached automations too.

Knowledge / Wissen
- A file browser over the assistant's home folder: memory/ (long-term memory entries as
  markdown, scoped globally, to one account, or to one correspondent), skills/ (reusable
  instructions), knowledge/ (the document library: PDF, MD, TXT, DOCX, CSV, HTML — searchable
  full-text, including inside PDFs and Word files).
- The user can create notes, memories, skills and folders in-app, upload or drag files in,
  download them, and open the folder in Finder/Explorer ("Open folder / Ordner öffnen").
  Everything is plain files the user can also edit outside the app.

Settings / Einstellungen (sections in order)
- AI & model / KI & Modell: sign in to a provider with a subscription (Claude, Copilot,
  ChatGPT) or an API key; pick provider and model. The sign-in stays on this computer.
- Accounts / Konten: connect email (Gmail, Outlook / Microsoft 365, Zoho Mail, IMAP), 2,000+
  other apps via search, plus onOffice (API token + secret) and WhatsApp (QR pairing for the
  personal link with chat mirror, or a Business account, send-only). Each account row has a
  color, a learned-writing-style badge (click to view/edit the directives), a gear for
  permissions, and disconnect.
- Permissions are per account and per category — "Create & change / Anlegen & Ändern",
  "Send / Senden", "Delete / Löschen" — armed on the account's row behind a confirm; reading
  and drafting are always allowed. onOffice separately grants chat writes and whether
  automations may create records. Email accounts also get a signature editor here.
- File access / Dateizugriff: what the assistant may do outside its own folder — read files,
  write files, run commands; all off by default.
- Preferences / Darstellung & Sprache: appearance (light/dark/system), language (German or
  English, for the app and the assistant's answers), timezone, and quick actions — whether
  buttons like "Draft reply / Antwort entwerfen" send immediately or open the draft for review.
- Local data / Lokale Daten: download a backup snapshot of everything stored on this computer
  (without account credentials).
- About / Über Marlen: version, build, license, source code on GitHub, report an issue, the
  full changelog, and "Check for updates / Nach Updates suchen".

Updates
- The app updates itself from official releases. A downloaded update waits as an "Update ready /
  Update bereit" pill in the sidebar; it opens the changelog ("What's new / Neuigkeiten") first
  and installs on restart. Version and changelog are always under Settings → About.

First run
- Until setup is complete, a welcome screen asks for exactly two things: an AI sign-in and one
  connected email account. Marlen starts read-only: it drafts and answers, but sends, changes
  or deletes nothing until the user arms those permissions per account.
