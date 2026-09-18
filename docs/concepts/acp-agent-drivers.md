# Externe Coding-Agenten über ACP

Status: Idee

Diese Idee wird derzeit nicht weiterverfolgt. Sie hält fest, wie vollständige Coding-Agenten
wie Codex und Claude später als Actors in RAgents laufen könnten, ohne deren Laufzeit und
Werkzeuge in RAgents nachzubauen.

## Rolle von ACP

RAgents würde als Client des Agent Client Protocol auftreten. Ein externer ACP-Agent wäre eine
weitere mögliche Actor-Laufzeit neben dem eingebauten Modell-Agenten, manuellen Actors und
TypeScript-Actors. ACP übernähme Sitzung, Eingaben, laufende Ausgaben, Pläne, Werkzeugereignisse,
Berechtigungsfragen und Abbruch. Runs, Zustellung, Journal, Arbeitsverzeichnis, Canvas und die
Vermittlung zwischen Actors blieben bei RAgents.

MCP hätte daneben eine eigene Rolle. ACP verbindet RAgents mit dem vollständigen Agenten; MCP
könnte diesem Agenten eine freigegebene Teilmenge der RAgents-Werkzeuge anbieten. Ein
ACP-Adapter müsste deshalb weder neue Werkzeugverträge erfinden noch unbeschränkten Zugriff auf
den RAgents-Host erhalten.

## Gemeinsamer Driver

Eine spätere Umsetzung sollte einen generischen Driver `acp` einführen und keine getrennten
Claude-, Codex- oder Gemini-Driver. Das Profil würde einen fest installierten Adapter mit
Startkommando und erlaubter Konfiguration auswählen. Verhalten richtet sich nach den beim
Verbindungsaufbau ausgehandelten Fähigkeiten; herstellerspezifische Sonderfälle bleiben
optionale Metadaten.

Für einen ersten Stand könnte jeder ACP-Actor einen eigenen lokalen Prozess und genau eine
ACP-Session besitzen. Das hält Arbeitsverzeichnis, Beendigung und Fehler voneinander getrennt.
Eine spätere gemeinsame Prozessnutzung wäre erst sinnvoll, wenn mehrere echte Adapter deren
Nebenläufigkeit und Sitzungsisolation belegen.

Der mögliche Lebenszyklus wäre:

- Beim Erzeugen des Actors startet RAgents den Adapter und eröffnet eine Session mit dem privaten
  Arbeitsverzeichnis des Runs.
- Ein ActorInput wird als Prompt zugestellt. Text, Reasoning, Plan, Werkzeugaufrufe,
  Terminalausgaben und Verbrauchsdaten werden während des Turns in passende RAgents-Ereignisse
  übersetzt.
- Ein Abbruch des Turns bricht auch den ACP-Prompt ab. Das Beenden des Actors schließt Session
  und Prozess.
- Die externe Session-ID bleibt im Session-Speicher und wird weder einem Modell noch dem
  Benutzer zum Abschreiben gegeben.
- Nach einem RAgents-Neustart wird die Session nur geladen oder fortgesetzt, wenn der Adapter
  diese Fähigkeit ausdrücklich anbietet. Andernfalls wird der Actor mit klarer Ursache gesperrt;
  eine unbemerkte leere Ersatzsession ist kein zulässiger Fallback.

## Arbeitsbereich und Entscheidungen des Benutzers

Ein ACP-Prozess muss denselben privaten Arbeitsbereich und dieselben Grenzen wie der zugehörige
Run einhalten. Eigene Datei- oder Terminalwerkzeuge des Adapters dürfen die RAgents-Sandbox nicht
umgehen. Denkbar sind durch RAgents bereitgestellte ACP-Datei- und Terminalfunktionen oder ein
entsprechend eingeschlossener Adapterprozess; welche Form trägt, müsste mit echten Adaptern
geprüft werden.

Berechtigungsfragen des Agenten könnten als wartende, journalisierte Rückfragen über
`ragents.ask` erscheinen. Die angebotenen Antworten und internen Bezeichner blieben serverseitig
gebunden. Zugangsdaten würden weder im Profil noch im Journal gespeichert; fehlende Anmeldung,
Adapter oder Sandbox wären harte Fehler.

## Mögliche Oberfläche

Ein ACP-Actor könnte im Actor-Dialog als Agent-Laufzeit statt als bloße Modellauswahl erscheinen.
Die Oberfläche könnte nur die vom Adapter angebotenen Modelle, Modi und Konfigurationsfelder
anzeigen. Im Chat und auf dem Canvas wären strukturierte Pläne, laufende Werkzeugschritte,
Dateiänderungen, Terminalprozesse und Berechtigungsfragen sichtbar, ohne die rohe
Protokollkommunikation zu zeigen.

Damit könnten vorbereitete Runs verschiedene Coding-Agenten gemeinsam einsetzen: etwa einen
Agenten für die Umsetzung, einen zweiten für die Prüfung und TypeScript-Actors für deterministische
Übergaben. Der Koordinator bliebe für Aufträge und Vermittlung zuständig; die ACP-Agenten würden
ihre eigenen Coding-Fähigkeiten behalten.

## Spätere Prüfung

Falls die Idee wieder aufgenommen wird, wäre ein kleiner Durchstich mit dem stabilen ACP-v1-
Vertrag sinnvoll. Ein gepinnter Codex-Adapter könnte zuerst Prompt, Streaming, Werkzeugereignisse,
Abbruch und sauberes Beenden belegen. Danach müsste ein Claude-Adapter ohne neuen Driver-Code
dieselben Grundfunktionen erfüllen. Erst dieses zweite echte Gegenstück rechtfertigt gemeinsame
Konfiguration und weitergehende Oberfläche.

Vor einer Umsetzung bleiben insbesondere zu entscheiden:

- Welche ACP-Ereignisse eigene Journal- und Live-Ereignisse benötigen, statt auf Text reduziert
  zu werden.
- Ob Datei- und Terminalzugriffe immer über RAgents laufen oder sicher im Adapterprozess bleiben.
- Wie Installation, Versionierung, Anmeldung und Aktualisierung lokaler Adapter verwaltet werden.
- Welche Sitzungsdaten dauerhaft gespeichert werden und wie wiederholte Updates beim Laden nicht
  doppelt journalisiert werden.
- Welche RAgents-Werkzeuge ein ACP-Agent über einen sitzungsbezogenen MCP-Zugang erhalten darf.

Bis zu einer ausdrücklichen Wiederaufnahme entstehen daraus keine Umsetzung, kein Plugin und kein
offener Arbeitsauftrag.
