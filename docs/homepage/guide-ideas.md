# Grundideen

Wie KI, TypeScript und bedienbare Oberflächen zusammenarbeiten.

## KI und TypeScript arbeiten zusammen

RAgents ist eine Arbeitsumgebung, in der KI-Agenten, TypeScript-Programme und kleine
Oberflächen gemeinsam einen Auftrag bearbeiten. Du kannst einen Auftrag im Chat beschreiben
oder ein vorbereitetes Sample starten. Die KI kann die benötigten Teilnehmer und Programme
selbst aufbauen; ein Sample bringt diesen Aufbau bereits mit.

TypeScript ist dabei der zentrale Arbeitsweg der KI. Sie schreibt kleine Programme, die
bereitgestellte Funktionen aufrufen und deren Ergebnisse verbinden. Eine solche Funktion
kann eine Datei lesen, einen Agenten anlegen oder eine Nachricht zustellen. Die Funktionen
kommen aus der Arbeitsumgebung; das Modell muss ihre Implementierung nicht neu erfinden.

## Code regelt den Ablauf, Modelle liefern die Beiträge

Beim Wortspiel liefern vier Modelle nacheinander Wörter. Das TypeScript-Programm bestimmt,
wer als Nächstes dran ist, gibt das letzte Ergebnis weiter und beendet die Runde nach zwölf
Beiträgen. Die Modelle wählen die Wörter. So bleibt der Ablauf fest, obwohl seine Inhalte
erst während der Arbeit entstehen.

Auch bei einer freien Aufgabe kann die KI mehrere zusammenhängende Schritte in einem
kurzen TypeScript-Snippet ausführen. Wenn das Snippet seine Ergebnisse zurückgibt, entscheidet
das Modell über den nächsten Schritt. Für einen Ablauf, der auf spätere Antworten reagieren
soll, gibt es dauerhafte Actor-Programme. Die
[TypeScript-Anleitung](guide-functions.html) erklärt beide Formen.

## Actors sind die Teilnehmer eines Runs

Ein Run fasst einen Auftrag, seine Teilnehmer, Arbeitsdateien und Ereignisse zusammen.
Die Teilnehmer heißen Actors. Ein LLM-Actor bearbeitet Nachrichten mit einem Modell; ein
TypeScript-Actor mit seinem Programm. Ein Koordinator ist selbst ein LLM-Actor, der weitere
Teilnehmer beauftragen kann. Ein vorbereitetes Sample kann auch ohne Koordinator arbeiten.

Im Wortspiel gibt es vier LLM-Actors für die Wörter und einen TypeScript-Actor für den Ablauf.
Beim Lernnachmittag arbeiten zwei LLM-Actors gleichzeitig; das Programm sammelt ihre Ideen.
Actors behalten ihren eigenen Zustand zwischen Aufträgen. Der Gesprächsverlauf eines
LLM-Actors, seine programmierten Daten und das gemeinsame Journal haben dabei verschiedene
Aufgaben.

## Nachrichten und Ereignisse verbinden die Arbeit

Eine Nachricht beauftragt einen Actor. Er bearbeitet sie in einem Turn und erzeugt dabei
Ereignisse, etwa eine fertige Antwort. Andere Actors können passende Ereignisse abonnieren.
Dann erhalten sie eine neue Nachricht und können weiterarbeiten. Beim Wortspiel wird das
Programm dadurch mit jeder fertigen Antwort erneut aufgerufen und beauftragt den nächsten Actor.

Das Journal zeichnet die Vorgänge auf. Dadurch lassen sich Aufträge, Antworten und Fehler
nachvollziehen. Das Wiederherstellen des Journals führt die aufgezeichnete Arbeit nicht
erneut aus. Die [Laufzeitanleitung](guide-runtime.html) erklärt die Zusammenhänge.

## Mini-Apps machen die Arbeit bedienbar

Ein Actor kann eine kleine Oberfläche besitzen: eine Mini-App auf der Arbeitsfläche.
Sie zeigt seine Daten und ruft seine Funktionen auf. Beim Wortspiel sind das Startknopf,
Fortschritt und Wortliste. Beim Sammelboard können sowohl ein KI-Helfer als auch ein Mensch
Einträge in dieselbe Liste schreiben.

Chat und Oberfläche sind damit zwei Zugänge zu derselben Arbeit. Eine Mini-App kann zu
einem LLM-Actor oder zu einem TypeScript-Actor gehören. Wie Funktionen, Zustand und Oberfläche
verbunden werden, zeigt [Mini-Apps bauen](guide-programs.html).

## Plugins liefern Fähigkeiten, Samples einen fertigen Aufbau

Ein Plugin ergänzt beispielsweise Dateifunktionen, Rückfragen oder Oberflächenbausteine.
Ein Produktprofil wählt die Plugins und Einstellungen der Arbeitsumgebung. Ein Skill erklärt
einem Modell, wie es eine Aufgabe bearbeiten soll. Ein Run-Script bringt dagegen die Programme
für einen vorbereiteten Aufbau mit.

Die [Samples](reference.html#samples) verwenden solche Run-Scripts. Du bekommst
damit den gezeigten Aufbau und die mitgelieferte Oberfläche; die Antworten der Modelle bleiben
variabel. In der eingebauten Hilfe führt "Sample starten" direkt zum passenden Einstieg.
Die separat geöffnete Homepage zeigt dieselben Oberflächen mit gekennzeichneten Beispieldaten.
