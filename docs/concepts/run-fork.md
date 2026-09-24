# Run-Fork: neue Runs aus einem aufgebauten Run

Status: Idee

## Ziel

Ein Bediener soll einen aufgebauten Run als Ausgangspunkt weiterer Runs verwenden können:
Startoptionen, Actors, Funktionen, Zustand, Views, Subscriptions und Kachelaufteilung. Ein
Run-Fork übernimmt diesen Aufbau, ohne ihn nochmals durch den Koordinator ausführen zu lassen.

Vorbereitete Abläufe als TypeScript-Pakete sind bereits als Script-Vorlagen verfügbar; ihr
geltender Vertrag steht in `docs/spec/typescript-platform.md`. Dieses Konzept betrifft
ausschließlich die Übernahme eines tatsächlich aufgebauten Runs.

## Grundlage und fehlende Schritte

Die Engine besitzt `Orchestration.forkRun` für einen Fork an einer Kommandogrenze. Eine
Bedienoberfläche und eine Methode der Nachrichtenschicht, die den Fork mit den übrigen Daten des
Runs verbindet, fehlen. Der Fork des Journals allein genügt für eine benutzbare Kopie nicht:
Modellkontexte, Arbeitsdateien sowie Quellen und Builds der Actor-Programme liegen zusätzlich in der
Ablage des Runs.

Eine Umsetzung muss Journal und Ablage zusammen übernehmen und alle darin gebundenen Run- und
Actor-Referenzen konsistent halten. Quellen und installierter Programmstand gehören zusammen; ein
Quelltext allein darf keinen ungeprüften Ersatz für ein aktiviertes Programm bilden. Native
Prozesse werden nicht geklont. Ein neuer Run startet seine Instanzen aus dem übernommenen geprüften
Stand und seinem journalisierten Actor-Zustand.

Ein möglicher Weg ist eine ausdrückliche Fork-Methode, die eine neue Run-ID erzeugt, einen
ruhenden Run übernimmt und die zuständigen Plugins ihre Daten des Runs kopieren lässt. Dafür wäre
ein neuer Lebenszyklusschritt je Run nötig. Seine genaue Form soll erst mit zwei echten
Datenbesitzern entschieden werden: Actor-Programme und Dateiablage.

Der Ausgangs-Run bleibt ein Run. Eine Markierung soll verhindern, dass er mit einem frisch
gestarteten Fork verwechselt wird. Der Aufbau-Verlauf gehört beim exakten Fork zur Kopie; eine
neue saubere Historie lässt sich stattdessen mit dem vorhandenen Weg über eine Script-Vorlage
aufbauen. Ein zweiter deklarativer Seed-Vertrag ist dafür nicht vorgesehen.

## Offene Entscheidungen

- Modellkontexte mitkopieren oder mit einer ausdrücklichen Aufbau-Zusammenfassung neu starten.
- Dateiablage vollständig übernehmen oder eine klar ausgewählte Teilmenge kopieren.
- Quellen, Builds und private Arbeitsdateien ohne Verweise auf den ursprünglichen Run übernehmen.
- Ausgangs-Run weiter bearbeitbar lassen oder vor unbeabsichtigter Nutzung schützen.
- Verhalten bei Schema- oder Capability-Änderungen klar ablehnen; Migrationen sind nicht vorgesehen.

## Abnahme

Zwei Forks desselben Runs müssen unabhängig arbeiten. Änderungen an Actor-Zustand, Views und
Dateien dürfen weder den Ausgangs-Run noch den anderen Fork verändern. Nach Neustart müssen beide
Forks ihren eigenen Stand wiederherstellen. Ein unvollständiger oder nicht mehr kompatibler
Paketstand muss den Fork mit einer konkreten Fehlermeldung abbrechen.
