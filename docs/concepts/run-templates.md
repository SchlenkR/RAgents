# Run-Vorlagen aus bestehenden Unterhaltungen

Status: Idee

## Ziel

Ein Bediener soll einen aufgebauten Run als Vorlage verwenden können: Startoptionen, Actors,
Funktionen, Zustand, Views, Subscriptions und Kachelaufteilung. Neue Runs übernehmen diesen Aufbau,
ohne ihn nochmals durch den Koordinator ausführen zu lassen.

Vorbereitete Abläufe als TypeScript-Pakete sind bereits als Run-Scripts verfügbar; ihr geltender
Vertrag steht in `docs/spec/typescript-platform.md`. Dieses Konzept betrifft ausschließlich
die Übernahme eines tatsächlich aufgebauten Runs.

## Grundlage und fehlende Schritte

Die Engine besitzt `Orchestration.forkRun` für einen Fork an einer Kommandogrenze. Eine
Bedienoberfläche und eine HTTP-Verknüpfung mit den Chat-Sessions fehlen. Der Fork des Journals
allein genügt für eine benutzbare Kopie nicht: Modell-Sessions, Arbeitsdateien sowie Quellen
und Builds der Actor-Programme liegen zusätzlich im Session-Speicher.

Eine Umsetzung muss Journal und Session-Daten zusammen übernehmen und alle darin gebundenen
Run- und Actor-Referenzen konsistent halten. Quellen und installierter Programmstand gehören
zusammen; ein Quelltext allein darf keinen ungeprüften Ersatz für ein aktiviertes Programm
bilden. Native Prozesse werden nicht geklont. Ein neuer Run startet seine Instanzen aus dem
übernommenen geprüften Stand und seinem journalisierten Actor-Zustand.

Ein möglicher Weg ist eine ausdrückliche Fork-Route, die eine neue Chat-ID erzeugt, einen
ruhenden Run übernimmt und die zuständigen Plugins ihre Session-Daten kopieren lässt. Dafür
wäre ein neuer Session-Lebenszyklusschritt nötig. Seine genaue Form soll erst mit zwei echten
Datenbesitzern entschieden werden: Actor-Programme und Dateiablage.

Die Vorlage selbst bleibt ein Run. Eine Markierung soll verhindern, dass sie mit einer frisch
gestarteten Instanz verwechselt wird. Die Aufbau-Unterhaltung gehört beim exakten Fork zur
Kopie; eine neue saubere Historie lässt sich stattdessen mit dem vorhandenen Run-Script-Weg
aufbauen. Ein zweiter deklarativer Seed-Vertrag ist dafür nicht vorgesehen.

## Offene Entscheidungen

- Modell-Sessions mitkopieren oder mit einer ausdrücklichen Aufbau-Zusammenfassung neu starten.
- Dateiablage vollständig übernehmen oder eine klar ausgewählte Teilmenge kopieren.
- Quellen, Builds und private Arbeitsdateien ohne Verweise auf den ursprünglichen Run übernehmen.
- Vorlage weiter bearbeitbar lassen oder vor unbeabsichtigter Nutzung schützen.
- Verhalten bei Schema- oder Capability-Änderungen klar ablehnen; Migrationen sind nicht vorgesehen.

## Abnahme

Zwei neue Runs aus derselben Vorlage müssen unabhängig arbeiten. Änderungen an Actor-Zustand,
Views und Dateien dürfen weder die Vorlage noch die andere Instanz verändern. Nach Neustart
müssen beide Instanzen ihren eigenen Stand wiederherstellen. Ein unvollständiger oder nicht
mehr kompatibler Paketstand muss den Fork mit einer konkreten Fehlermeldung abbrechen.
