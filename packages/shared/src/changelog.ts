export type ChangelogEntry = {
  version: string;
  /** ISO date the version was released. */
  date: string;
  /** Release notes per UI language; keep both in step. */
  notes: { en: string[]; de: string[] };
};

/**
 * Hand-maintained release notes, shown in-app (the update card and Settings →
 * About → Changelog) and readable by the agent (app_help). Newest first; add
 * an entry when cutting a tagged release.
 */
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "0.4.5",
    date: "2026-08-04",
    notes: {
      en: [
        "Chats no longer open at a full context. Everything the assistant remembers was loaded into every conversation whole, so on a well-used setup a brand-new chat could start with no room left and refuse the first message. Memory now has a fixed share of that space, the least recently used entries stay on file instead of in every conversation, and the assistant is asked to tidy them up as it goes. Nothing is deleted, and an affected installation is back to normal on its next message.",
        "Marlen keeps running when you close the window. On Windows it stays in the system tray, where its icon reopens it and its menu quits it, so scheduled automations carry on instead of stopping until you next open the app.",
        'New under Settings, Preferences: "Start with the computer". Marlen then starts in the background when you log in, so your automations run without you opening it first.',
        "You are now told when something needs you. A run that fails, and a run that leaves a draft waiting for approval, both notify you even when that automation's completion notice is switched off. The app icon carries the number of drafts waiting for approval.",
        "A reply can be stopped. While the assistant is working, the send button becomes a stop button; stopping keeps what it had already written.",
        "If the part of Marlen that runs on your computer stops unexpectedly, it now starts again by itself instead of closing the app with an error.",
      ],
      de: [
        "Chats beginnen nicht mehr mit vollem Kontext. Alles, was sich der Assistent gemerkt hat, wurde vollständig in jede Unterhaltung geladen, sodass bei längerer Nutzung schon ein neuer Chat ohne Platz startete und die erste Nachricht ablehnte. Das Gedächtnis hat jetzt einen festen Anteil an diesem Platz, länger nicht genutzte Einträge bleiben als Datei erhalten statt in jeder Unterhaltung mitzureisen, und der Assistent räumt sie nach und nach auf. Nichts wird gelöscht, und eine betroffene Installation ist mit der nächsten Nachricht wieder normal.",
        "Marlen läuft weiter, wenn Sie das Fenster schließen. Unter Windows bleibt die App im Infobereich, das Symbol öffnet sie wieder, das Menü beendet sie. Geplante Automatisierungen laufen damit weiter, statt bis zum nächsten Öffnen zu pausieren.",
        'Neu unter Einstellungen, Darstellung & Sprache: "Mit dem Computer starten". Marlen startet dann beim Anmelden im Hintergrund, damit Ihre Automatisierungen laufen, ohne dass Sie die App vorher öffnen.',
        "Sie erfahren jetzt, wenn etwas auf Sie wartet. Ein fehlgeschlagener Lauf und ein Lauf, der einen Entwurf zur Freigabe hinterlässt, melden sich auch dann, wenn die Fertigmeldung dieser Automatisierung ausgeschaltet ist. Das App-Symbol zeigt die Zahl der Entwürfe, die auf Freigabe warten.",
        "Eine Antwort lässt sich stoppen. Während der Assistent arbeitet, wird aus dem Senden-Knopf ein Stopp-Knopf; das bereits Geschriebene bleibt erhalten.",
        "Hört der Teil von Marlen, der auf Ihrem Computer läuft, unerwartet auf, startet er jetzt von selbst neu, statt die App mit einer Fehlermeldung zu schließen.",
      ],
    },
  },
  {
    version: "0.4.4",
    date: "2026-08-04",
    notes: {
      en: [
        "Linking WhatsApp by QR code works again. The app now pairs against the version of WhatsApp Web that is live at that moment, so the code appears instead of the attempt expiring before you see it. Whenever WhatsApp retired the version the app announced, pairing stopped working on every installation at once.",
        "A linked phone no longer drops out on its own. A status check landing while WhatsApp was rewriting its credentials read the account as unlinked, which reset the assistant's running sessions, routed messages over the Business account and left reconnects stranded.",
        'Link attempts that cannot succeed now stop instead of retrying forever. If WhatsApp turns the link down for good, blocked, replaced by a newer link, or the wrong device, the app says so; and a paired account no longer sits on "Connecting" after repeated failures.',
        "Replacing a rejected WhatsApp Business token takes effect immediately, with no restart.",
        "Settings, Accounts now lists your accounts even when no Pipedream project is set up. onOffice and WhatsApp connect on their own and no longer disappear behind that setup.",
        "An outbound draft can no longer go out twice from two quick clicks on Send, and a draft you discarded can no longer be sent afterwards.",
        "Signatures are cleaned more thoroughly before they go into a message, and threading details copied from received mail can no longer add hidden recipients to a reply you send by hand.",
        "The assistant keeps its email tools for a whole answer. A mailbox session dropping mid-answer used to take them away until the next question.",
      ],
      de: [
        "Die Verknüpfung von WhatsApp per QR-Code funktioniert wieder. Die App verbindet sich jetzt mit der Version von WhatsApp Web, die gerade aktiv ist, damit der Code erscheint, statt dass der Versuch abläuft, bevor Sie ihn sehen. Sobald WhatsApp die von der App gemeldete Version abschaltete, schlug das Verknüpfen auf allen Installationen gleichzeitig fehl.",
        "Ein verknüpftes Handy fällt nicht mehr von selbst heraus. Eine Statusabfrage, die eintraf, während WhatsApp seine Zugangsdaten neu schrieb, las das Konto als nicht verknüpft, was laufende Sitzungen des Assistenten zurücksetzte, Nachrichten über das Business-Konto leitete und Wiederverbindungen hängen ließ.",
        'Verbindungsversuche, die nicht gelingen können, hören jetzt auf, statt endlos zu wiederholen. Lehnt WhatsApp die Verknüpfung endgültig ab, gesperrt, durch eine neuere ersetzt oder falsches Gerät, sagt die App das; und ein verknüpftes Konto bleibt nach wiederholten Fehlversuchen nicht mehr auf "Verbindet" stehen.',
        "Ein ersetzter, zuvor abgewiesener WhatsApp-Business-Token wirkt sofort, ohne Neustart.",
        "Einstellungen, Konten zeigt Ihre Konten jetzt auch dann, wenn kein Pipedream-Projekt eingerichtet ist. onOffice und WhatsApp verbinden sich eigenständig und verschwinden nicht mehr hinter dieser Einrichtung.",
        "Ein ausgehender Entwurf geht nicht mehr doppelt hinaus, wenn Sie zweimal schnell auf Senden klicken, und ein verworfener Entwurf lässt sich danach nicht mehr senden.",
        "Signaturen werden gründlicher bereinigt, bevor sie in eine Nachricht kommen, und aus empfangener Post übernommene Zuordnungsangaben können einer Antwort, die Sie selbst senden, keine verborgenen Empfänger mehr hinzufügen.",
        "Der Assistent behält seine E-Mail-Werkzeuge während einer ganzen Antwort. Brach eine Postfach-Sitzung mitten in der Antwort ab, fehlten sie bis zur nächsten Frage.",
      ],
    },
  },
  {
    version: "0.4.3",
    date: "2026-07-26",
    notes: {
      en: [
        "WhatsApp messages no longer take the wrong route. With your phone linked by QR code, that link is the only way a message goes out; a WhatsApp Business account connected alongside it is left alone instead of being used behind the scenes, which could fail on its own credentials.",
        "A connected WhatsApp Business account now has its own row under Settings, Accounts, with its own disconnect. Before, it was hidden behind the personal link and could only be removed further up the page. While your phone is linked, that row is marked as not in use.",
        "If WhatsApp Business does refuse an access token, the message now says that the stored token is the problem and where to replace it, instead of passing WhatsApp's technical wording straight through.",
      ],
      de: [
        "WhatsApp-Nachrichten nehmen nicht mehr den falschen Weg. Ist Ihr Handy per QR-Code verknüpft, geht jede Nachricht über diese Verknüpfung; ein daneben verbundenes WhatsApp-Business-Konto bleibt unangetastet, statt im Hintergrund benutzt zu werden und an seinen eigenen Zugangsdaten zu scheitern.",
        "Ein verbundenes WhatsApp-Business-Konto hat jetzt unter Einstellungen, Konten eine eigene Zeile mit eigenem Trennen. Vorher war es hinter der persönlichen Verknüpfung verborgen und ließ sich nur weiter oben auf der Seite entfernen. Solange Ihr Handy verknüpft ist, ist die Zeile als nicht aktiv gekennzeichnet.",
        "Weist WhatsApp Business einen Zugangs-Token doch zurück, sagt die Meldung jetzt, dass der hinterlegte Token das Problem ist und wo Sie ihn ersetzen, statt den technischen Wortlaut von WhatsApp durchzureichen.",
      ],
    },
  },
  {
    version: "0.4.2",
    date: "2026-07-25",
    notes: {
      en: [
        "Dictate instead of typing: the microphone next to the send box records your message, shows the sound as a wave across the composer while you speak, and puts what you said into the text field as editable text. Nothing is ever sent on its own. Escape discards a recording.",
        "Dictation needs a key for a speech service. The first time you press the microphone, Marlen asks for one and links straight to where you get it, with Groq marked as the free option.",
        "An API key that was copied with extra formatting is now refused right away, with a note to copy it again, instead of failing later with a technical error.",
        "The permission to send now counts the same way everywhere: for every connected account, in chat and in scheduled automations alike. Creating, changing and deleting stay reserved for when you are there, whatever is granted.",
      ],
      de: [
        "Diktieren statt tippen: Das Mikrofon neben dem Senden-Feld nimmt Ihre Nachricht auf, zeigt den Ton beim Sprechen als Welle über dem Eingabefeld und setzt das Gesagte als bearbeitbaren Text ins Feld. Gesendet wird nie von allein. Esc verwirft eine Aufnahme.",
        "Zum Diktieren braucht es einen Schlüssel für einen Sprachdienst. Beim ersten Druck auf das Mikrofon fragt Marlen danach und verlinkt direkt dorthin, wo Sie ihn bekommen, Groq ist als kostenlose Möglichkeit gekennzeichnet.",
        "Ein API-Schlüssel, der mit zusätzlicher Formatierung kopiert wurde, wird jetzt sofort abgelehnt, mit dem Hinweis, ihn nochmal zu kopieren, statt später mit einem technischen Fehler zu scheitern.",
        "Die Berechtigung zum Senden gilt jetzt überall gleich: für jedes verbundene Konto, im Chat wie in geplanten Automatisierungen. Anlegen, Ändern und Löschen bleiben Ihrer Anwesenheit vorbehalten, unabhängig davon, was erlaubt ist.",
      ],
    },
  },
  {
    version: "0.4.1",
    date: "2026-07-24",
    notes: {
      en: [
        "The ring next to the send box opens a new model control: switch the AI provider and model, choose how thoroughly the assistant thinks (Fast, Normal, or Thorough), and see at a glance how much of your subscription's usage limits and of the current chat's memory you have used.",
        "How thoroughly the assistant thinks is now yours to set. Fast answers right away, Normal thinks briefly for better answers, and Thorough takes its time on hard questions. Before, it was fixed.",
        "Models now appear under their proper names instead of their technical ids, both in the new control and in Settings.",
        "When something fails to load, a short notice now says so instead of leaving an empty space.",
      ],
      de: [
        "Der Ring neben dem Senden-Feld öffnet eine neue Modellsteuerung: Anbieter und Modell wechseln, festlegen, wie gründlich der Assistent nachdenkt (Schnell, Normal oder Gründlich), und auf einen Blick sehen, wie viel von den Nutzungslimits Ihres Abos und vom Speicher des aktuellen Chats verbraucht ist.",
        "Wie gründlich der Assistent nachdenkt, bestimmen jetzt Sie. Schnell antwortet sofort, Normal denkt kurz für bessere Antworten, und Gründlich lässt sich bei schweren Fragen Zeit. Vorher war das fest eingestellt.",
        "Modelle erscheinen jetzt unter ihren richtigen Namen statt unter ihren technischen Kennungen, sowohl in der neuen Steuerung als auch in den Einstellungen.",
        "Wenn etwas nicht geladen werden kann, sagt das jetzt ein kurzer Hinweis, statt eine leere Fläche zu hinterlassen.",
      ],
    },
  },
  {
    version: "0.4.0",
    date: "2026-07-23",
    notes: {
      en: [
        'A draft the assistant writes in chat is now only a proposal: nothing lands in your mail account until you press "Keep as draft" on its card, or ask the assistant to keep it. Keeping saves it to the account\'s Drafts folder and the approval list on Home; Send sends it right away; Discard leaves no trace. Automations still create real drafts for approval, as before.',
        "One signature, everywhere. The signature you set for an account appears under the draft on its chat card and on Home, stays out of the text field while you edit, and is re-applied with its formatting and images when you save. The assistant never writes a signature block of its own.",
        "The signature editor takes a signature pasted straight from Gmail or Outlook, keeps its formatting and images (up to 300 KB), and shows it the way recipients will see it.",
        "The assistant knows the app it lives in: ask what Marlen can do, where a setting lives, or what changed in an update, and it answers from the built-in guide and this changelog instead of guessing.",
        "When your AI provider hits its rate limit, the chat says so plainly and offers a one-click switch to another signed-in provider.",
        "Selecting text in your own chat messages is visible again.",
      ],
      de: [
        'Ein Entwurf, den der Assistent im Chat schreibt, ist jetzt zunächst nur ein Vorschlag: Nichts landet im Mail-Konto, bis Sie auf der Karte "Als Entwurf behalten" drücken oder den Assistenten darum bitten. Behalten speichert ihn im Entwürfe-Ordner des Kontos und in der Freigabe-Liste auf der Startseite, Senden verschickt ihn sofort, Verwerfen hinterlässt nichts. Automatisierungen legen ihre Entwürfe weiterhin direkt zur Freigabe an.',
        "Eine Signatur, überall. Die für ein Konto hinterlegte Signatur steht unter dem Entwurf auf seiner Chat-Karte und auf der Startseite, bleibt beim Bearbeiten außerhalb des Textfelds und wird beim Speichern mit Formatierung und Bildern wieder angefügt. Der Assistent schreibt keinen eigenen Signaturblock mehr.",
        "Der Signatur-Editor übernimmt eine direkt aus Gmail oder Outlook eingefügte Signatur mit Formatierung und Bildern (bis 300 KB) und zeigt sie so, wie Empfänger sie sehen.",
        "Der Assistent kennt die App, in der er arbeitet: Fragen, was Marlen kann, wo eine Einstellung liegt oder was ein Update geändert hat, beantwortet er aus dem eingebauten Handbuch und diesem Changelog, statt zu raten.",
        "Stößt Ihr KI-Anbieter an sein Anfrage-Limit, sagt der Chat das klar und bietet den Wechsel zu einem anderen angemeldeten Anbieter mit einem Klick an.",
        "Markierter Text in Ihren eigenen Chat-Nachrichten ist wieder sichtbar.",
      ],
    },
  },
  {
    version: "0.3.9",
    date: "2026-07-21",
    notes: {
      en: [
        'Add your own to-dos on the home page. The plus next to "To do" opens a field, Enter files the entry, and the pencil on the new row adds a date, a note, or an automation that starts once it is done.',
        '"Draft ready" in the morning briefing is now a button that jumps straight to that draft in the approvals list, ready to send, edit, or discard. The detour through the assistant is gone.',
        "A learned writing style opens in the editor with a click on its chip in Settings, edits keep each directive on its own line, and renaming the note behind it no longer detaches it from its account.",
        "The changelog marks the version you are running, with dates written out in full.",
      ],
      de: [
        'Eigene Aufgaben direkt auf der Startseite anlegen. Das Plus neben "Zu erledigen" öffnet ein Feld, Enter legt den Eintrag an, und über den Stift bekommt die neue Zeile ein Datum, eine Notiz oder eine Automatisierung, die beim Erledigen startet.',
        '"Entwurf bereit" im Morgenbriefing ist jetzt ein Knopf, der direkt zum Entwurf in der Freigabe-Liste springt, bereit zum Senden, Bearbeiten oder Verwerfen. Der Umweg über den Assistenten entfällt.',
        "Ein gelernter Schreibstil öffnet sich per Klick auf sein Abzeichen in den Einstellungen im Editor, beim Bearbeiten bleibt jede Vorgabe in ihrer eigenen Zeile, und das Umbenennen der Notiz dahinter löst sie nicht mehr vom Konto.",
        "Das Changelog zeigt, welche Version gerade läuft, mit ausgeschriebenem Datum.",
      ],
    },
  },
  {
    version: "0.3.8",
    date: "2026-07-21",
    notes: {
      en: [
        "The morning briefing now also picks up mail from the last 7 days you never read, and says how long each one has been sitting. If an earlier run already drafted a reply, it points you at that draft instead of writing a second one.",
        "When a reply is about a time, the assistant checks a connected calendar first and only proposes slots you are free for. With no calendar connected it leaves the times to you.",
        "Completing a to-do that starts an automation now hands the run your note on it, not just the title.",
        "The home page reads quieter. The approvals list dropped its duplicate headings, every draft carries its account's color, and the actions other than send and discard appear when you hover a row.",
        "Replies in chat now read as plain text under the assistant's mark, instead of sitting in a grey bubble.",
        "A new brand mark, the app icon included. Settings counts every connection in the accounts chip, not just mailboxes, and WhatsApp only shows a status when something is wrong.",
      ],
      de: [
        "Das Morgenbriefing sieht jetzt auch die ungelesenen Mails der letzten 7 Tage durch und sagt bei jeder, wie lange sie schon liegt. Hat ein früherer Lauf dafür schon einen Entwurf geschrieben, verweist es auf diesen, statt einen zweiten zu verfassen.",
        "Geht es in einer Antwort um einen Termin, prüft der Assistent zuerst einen verbundenen Kalender und schlägt nur Zeiten vor, zu denen Sie frei sind. Ohne verbundenen Kalender bleiben die Zeiten Ihnen überlassen.",
        "Ein erledigtes To-do, das eine Automatisierung startet, gibt dem Lauf jetzt auch Ihre Notiz mit, nicht nur den Titel.",
        "Die Startseite ist ruhiger. Die Freigabe-Liste hat ihre doppelten Überschriften verloren, jeder Entwurf trägt die Farbe seines Kontos, und alles außer Senden und Verwerfen erscheint erst, wenn Sie über eine Zeile fahren.",
        "Antworten im Chat stehen jetzt als normaler Text unter dem Zeichen des Assistenten, statt in einer grauen Blase.",
        "Ein neues Markenzeichen, auch als App-Symbol. In den Einstellungen zählt die Konten-Anzeige jetzt alle Verbindungen, nicht nur Postfächer, und WhatsApp zeigt einen Status nur noch, wenn etwas nicht stimmt.",
      ],
    },
  },
  {
    version: "0.3.7",
    date: "2026-07-20",
    notes: {
      en: [
        "The app is now called Marlen. Your accounts, drafts, and settings carry over exactly as they were.",
      ],
      de: [
        "Die App heißt jetzt Marlen. Ihre Konten, Entwürfe und Einstellungen bleiben genau wie zuvor erhalten.",
      ],
    },
  },
  {
    version: "0.3.6",
    date: "2026-07-20",
    notes: {
      en: [
        "A ready update now waits in the sidebar instead of floating over your work. It opens the changelog first, so you can see what changes before you restart.",
        "The assistant no longer writes a second draft for a thread that already has an unsent one. Repeating an instruction, or catching up on a schedule that was missed while the app was closed, refines the existing draft instead of stacking another next to it.",
        "An account connected before you signed in to an AI now learns your writing voice on the next start. It used to stay silently unlearned.",
        "Switching between pages fades instead of snapping, and a message you send settles into its sent line in place rather than disappearing the way a discarded one does.",
        "Clearer German throughout the app, in plainer words.",
      ],
      de: [
        "Ein bereitstehendes Update wartet jetzt in der Seitenleiste, statt über der Arbeit zu schweben. Es öffnet zuerst die Änderungen, damit Sie vor dem Neustart sehen, was sich ändert.",
        "Der Assistent schreibt keinen zweiten Entwurf mehr für einen Verlauf, in dem schon ein ungesendeter liegt. Eine wiederholte Anweisung, oder ein Zeitplan, der bei geschlossener App ausgefallen ist, überarbeitet den vorhandenen Entwurf, statt einen weiteren danebenzulegen.",
        "Ein Konto, das vor der KI-Anmeldung verbunden wurde, lernt Ihren Schreibstil jetzt beim nächsten Start. Vorher blieb es stillschweigend ungelernt.",
        "Der Wechsel zwischen Seiten blendet über, statt zu springen, und eine gesendete Nachricht geht an Ort und Stelle in ihre gesendete Zeile über, statt zu verschwinden wie eine verworfene.",
        "Klareres Deutsch in der ganzen App, in einfacheren Worten.",
      ],
    },
  },
  {
    version: "0.3.5",
    date: "2026-07-20",
    notes: {
      en: [
        "Marlen starts faster, most of all on the first launch after an update on Windows. The app now ships as a single archive instead of tens of thousands of separate files, which is what the virus scanner spends its time on.",
        "The window opens as soon as the app can answer. Loading the schedule, the document index and the message channels no longer holds up the start.",
        "The startup screen shows a progress bar instead of a spinner, and explains what is happening if the wait gets long.",
        "The app no longer fetches its typeface from the internet. It starts the same offline or behind a hotel network, and opening Marlen is no longer visible to an outside service.",
      ],
      de: [
        "Marlen startet schneller, vor allem beim ersten Start nach einem Update unter Windows. Die App wird jetzt als ein einziges Archiv ausgeliefert statt als zehntausende einzelne Dateien, die der Virenscanner alle prüft.",
        "Das Fenster öffnet sich, sobald die App antworten kann. Zeitplan, Dokumentenindex und Nachrichtenkanäle halten den Start nicht mehr auf.",
        "Der Startbildschirm zeigt einen Fortschrittsbalken statt eines Kreisels und erklärt, woran es liegt, wenn es länger dauert.",
        "Die App lädt ihre Schrift nicht mehr aus dem Internet. Sie startet ohne Netz genauso wie im Hotel-WLAN, und der Start von Marlen ist für einen fremden Dienst nicht mehr sichtbar.",
      ],
    },
  },
  {
    version: "0.3.4",
    date: "2026-07-20",
    notes: {
      en: [
        "WhatsApp messages waiting for approval can be edited by hand on the start page, the way email drafts already could.",
        "Every draft has a refine button that reopens the chat it was written in, so the assistant keeps the full context instead of starting cold.",
        "Lists no longer jump. A message you send or discard fades out and the rows below slide up to close the gap, and a to-do you tick leaves the same way.",
        "The assistant no longer uses dashes in its replies.",
      ],
      de: [
        "WhatsApp-Nachrichten, die auf Freigabe warten, lassen sich auf der Startseite von Hand bearbeiten, so wie es bei E-Mail-Entwürfen schon möglich war.",
        "Jeder Entwurf hat einen Knopf zum Verfeinern, der den Chat wieder öffnet, in dem er geschrieben wurde, damit der Assistent den vollen Zusammenhang behält.",
        "Listen springen nicht mehr. Eine gesendete oder verworfene Nachricht blendet sich aus, die Zeilen darunter rücken weich nach oben, und ein abgehaktes To-do verschwindet genauso.",
        "Der Assistent verwendet in seinen Antworten keine Gedankenstriche mehr.",
      ],
    },
  },
  {
    version: "0.3.3",
    date: "2026-07-20",
    notes: {
      en: [
        "Home marks what arrived since your last visit with a small dot and counts it at the top, so nothing new slips past.",
        "WhatsApp can now be connected as a Business account instead of scanning a QR code with your phone. Sending works right away, reading chats stays with the phone link.",
        "Every run shows why it started: a slot caught up after the app was closed, a completed to-do, or new mail.",
        "The search for a service to connect finds onOffice and WhatsApp on more terms, in German too, and shows them the moment you type.",
      ],
      de: [
        "Die Startseite markiert mit einem kleinen Punkt, was seit dem letzten Besuch dazugekommen ist, und zählt es oben mit, damit nichts Neues untergeht.",
        "WhatsApp lässt sich jetzt auch als Business-Konto verbinden, statt einen QR-Code mit dem Telefon zu scannen. Das Senden funktioniert sofort, das Lesen von Chats bleibt bei der Telefonverbindung.",
        "Jeder Lauf zeigt, warum er gestartet ist: ein nachgeholter Termin, ein erledigtes To-do oder neue Mail.",
        "Die Suche nach einem Dienst findet onOffice und WhatsApp bei mehr Begriffen, auch auf Deutsch, und zeigt sie sofort beim Tippen.",
      ],
    },
  },
  {
    version: "0.3.2",
    date: "2026-07-19",
    notes: {
      en: [
        "Library files can be downloaded with one click, even the kinds that normally open in the browser.",
        "A new button opens the current library folder straight in Finder or Explorer.",
        "Accounts, automations, and email drafts now update on their own the moment something changes, no reload needed.",
      ],
      de: [
        "Bibliotheksdateien lassen sich mit einem Klick herunterladen, auch solche, die sonst im Browser öffnen.",
        "Ein neuer Knopf öffnet den aktuellen Bibliotheksordner direkt im Finder oder Explorer.",
        "Konten, Automationen und E-Mail-Entwürfe aktualisieren sich von selbst, sobald sich etwas ändert, ganz ohne Neuladen.",
      ],
    },
  },
  {
    version: "0.3.1",
    date: "2026-07-19",
    notes: {
      en: [
        "Automations can be dragged into the order you want.",
        "Runs now start knowing why they fired: a completed to-do, new mail, or a missed slot.",
        "Connecting an account opens in your browser, where you are already signed in, and the app picks up the new account by itself.",
        "The instruction box in the automation editor gives your text more room.",
      ],
      de: [
        "Automationen lassen sich per Ziehen in die gewünschte Reihenfolge bringen.",
        "Läufe wissen jetzt beim Start, warum sie ausgelöst wurden: ein erledigtes To-do, neue Mail oder ein verpasster Termin.",
        "Die Kontoverbindung öffnet im Browser, wo die Anmeldung schon besteht, und die App übernimmt das neue Konto von selbst.",
        "Das Anweisungsfeld im Automationen-Editor bietet dem Text mehr Platz.",
      ],
    },
  },
  {
    version: "0.3.0",
    date: "2026-07-19",
    notes: {
      en: [
        "Release notes now show up in the app after an update, and any time under Settings, About.",
        "The window opens right away with a spinner while Marlen starts, instead of a silent wait.",
        "A cleaner window on the Mac: the app draws its own chrome edge to edge.",
        "WhatsApp drafts awaiting your approval can be revised in place instead of piling up copies.",
      ],
      de: [
        "Versionshinweise erscheinen nach einem Update direkt in der App und jederzeit unter Einstellungen, Über.",
        "Das Fenster öffnet sofort mit einem Ladeindikator, während Marlen startet, statt still zu warten.",
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
