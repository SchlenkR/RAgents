# Mit TypeScript arbeiten

Funktionen verbinden, feste Abläufe programmieren und Modelle gezielt einbeziehen.

## TypeScript als Arbeitsweg der KI

Das Modell arbeitet mit den Fähigkeiten von RAgents, indem es TypeScript schreibt.
Die Arbeitsumgebung stellt aufrufbare Funktionen bereit, etwa zum Lesen einer Datei oder
zum Anlegen eines Agenten. Das Modell verbindet sie zu einem Programm: Es kann Ergebnisse
in Variablen behalten, Bedingungen prüfen und unabhängige Schritte parallel ausführen.

Das ist auch der Weg zu größeren Aufbauten. Beim Wortspiel legt Code die Teilnehmer an und
regelt ihre Übergaben; die vier Modelle liefern die Wörter. Eine Mini-App zeigt den
Fortschritt desselben Programms. Die KI muss den Ablauf dadurch nicht bei jeder Antwort
erneut aus Anweisungen im Gespräch ableiten.

Für einmalige Arbeit genügt ein Snippet, ein kurzes TypeScript-Programm für genau einen Aufruf.
Sein Ergebnis geht an das Modell zurück, das danach weiterentscheiden kann. Soll das Programm
Zustand behalten oder auf spätere Nachrichten reagieren, wird es zu einem
[Actor-Programm](guide-programs.html). Beide Formen verwenden dieselben Funktionen.

## Einmalige Snippets

Die native Standardoberfläche enthält `typescript_api` für die verfügbaren Funktionen und
`typescript_eval` für TypeScript-Code. Arbeitsbereichsplugins stellen zusätzlich `read`, `write`,
`edit` und `bash` direkt bereit, soweit sie für den Actor freigegeben sind. Einzelne Datei- und
Shellaktionen benötigen keine TypeScript-Hülle und verwenden dieselbe Implementierung,
Arbeitsverzeichnisauflösung, Rechteprüfung und Journalaufzeichnung wie die Funktionsaufrufe. Beide gehören zur
Server-Grundausstattung, auch ohne das optionale Plugin für Actor-Programme. Das Anlegen von Agenten und andere Workflowfunktionen werden in TypeScript über
`context.functions` aufgerufen. Die Dateiwerkzeuge bleiben dort für zusammengesetzte
Aufrufe verfügbar. Plugins registrieren ihre Implementierung jeweils einmal; Snippets und dauerhafte
Actor-Programme verwenden dieselbe API.

Jeder ausgerüstete LLM-Actor erhält automatisch alle für ihn verfügbaren Funktionsnamen mit
Kurzbeschreibungen. Das gilt für Koordinatoren und Subagenten. Änderungen am Bestand aktualisieren
die Übersicht auch während eines Turns. Direkt bereitgestellte Werkzeuge sind darin gekennzeichnet;
ihre nativen Beschreibungen enthalten auch die ausführlichen Nutzungshinweise. Die Übersicht erweitert weder Funktionsauswahl noch
Rechte; reine LLMs mit `tools: []` erhalten sie nicht.

### Kurzbeschreibung und Details

Eine mit `defineRunFunction` registrierte Funktion trägt einen technischen `name` für den
Aufruf und ein lesbares `label` für Menschen. `description` beschreibt knapp ihren Zweck und
erscheint in der automatischen Übersicht. `longDescription` ergänzt optional ausführliche
Regeln, Voraussetzungen und Beispiele. Ein- und Ergebnistypen entstehen aus den Schemas;
die Beschreibungen ersetzen diese Verträge nicht.
Lokale rekursive Schema-Referenzen erzeugen benannte TypeScript-Aliase. Verschachtelte Verträge
wie der Kachelbaum bleiben damit in Snippets, Actor-Programmen und der öffentlichen Run-API
vollständig typisiert. Die Auflösung umfasst lokale `$defs`-Referenzen; externe Referenzen
werden nicht geladen.

`typescript_api` liefert ohne Namensauswahl den kompakten Katalog. `query` sucht in Namen und
Kurzbeschreibungen. Mit `names` kommen TypeScript-Deklarationen, vorhandene Langbeschreibungen
und die an genau diese Funktionen gebundenen Anleitungen hinzu. Die Deklarationen tragen die
`description` jeder Eigenschaft als Kommentar; ein Schema, das mehrere Funktionen teilen,
erscheint einmal als benannter Alias. Die JSON-Schemata mit Prüfregeln wie Längen und Mustern
kommen nur mit `schemas: true` zu einer Namensauswahl dazu. So fordert das
Modell den Vertrag der Bestandsabfrage an; dies ist eine Werkzeug-Eingabe, kein Snippet:

```json
{"names":["actor_list"]}
```

### Code ausführen

`typescript_eval` erhält genau `code` oder `path`. Der Quelltext ist der Rumpf einer asynchronen
Funktion mit `context`; `return` liefert das Ergebnis. Vor der Ausführung prüft der gemeinsame
Compiler den Code gegen den aktuellen API-Vertrag. Die native Ausführung verwendet denselben
Executor, Funktionsresolver und Abbruchpfad wie Actor-Programme. Ein Snippet erfordert kein
Actor-Paket, keine Aktivierung und keinen eigenen Actor. Variablen leben für diese Ausführung.
Die Kompilierung läuft in einem warmen Pool aus bis zu acht langlebigen Worker-Threads; weitere
Anfragen warten auf einen freien Worker. Ein Worker lädt TypeScript einmal, beantwortet Anfragen
über Nachrichten mit Anfragekennung und hält je Worker einen Cache geparster Dateien: Bibliotheken
und Deklarationen nach Dateiname und Inhalt (höchstens 256 Einträge, älteste zuerst verdrängt),
Snippet-Quellen werden immer frisch geparst; das vorige Programm dient dem nächsten Lauf zur
strukturellen Wiederverwendung. Ergebnisse, Diagnosen, Hash und Emit sind dieselben wie bei einer
kalten Kompilierung. Die Zeitgrenze je Kompilierung beträgt 60 Sekunden (Aufrufer dürfen bis
180 Sekunden setzen) und schließt die Wartezeit in der Schlange ein; der Worker-Start ist kein
Anteil mehr. Überschreitet ein Worker die Zeitgrenze, stirbt er oder bricht der Run ab, wird er
beendet und beim nächsten Bedarf ersetzt; die betroffene Anfrage scheitert mit `TIMEOUT`,
`WORKER_FAILURE` oder `ABORTED`. Ein Compilerfehler in der Anfrage lässt den Worker am Leben.
Die Ressourcengrenzen gelten je Worker.

Eine Funktion mit leerem oder rein optionalem Eingabeschema lässt sich ohne Argument aufrufen;
`context.functions.status()` und `context.functions.status({})` sind gleichwertig. Ein
`undefined` unter einem Objektschlüssel bedeutet auf Eingabe- und Ergebnisseite dasselbe wie
ein fehlender Schlüssel: Der Compiler setzt `exactOptionalPropertyTypes` nicht, der Host
akzeptiert den Wert und liefert das Ergebnis in JSON-Form ohne diese Schlüssel. Ein
`undefined` als Arrayelement oder als Ergebnis selbst bleibt ein Fehler.

Die folgende Eingabe an `typescript_eval` liest die vorhandenen Actors und gibt die echte
Antwort an das Modell zurück:

```json
{"code":"const actors = await context.functions.actor_list({}); return actors;"}
```

In einer Datei kann derselbe Funktionsrumpf mehrere unabhängige Abfragen verbinden. Für dieses
Beispiel werden zuvor die Verträge von `actor_list` und `model_list` geladen:

```ts
const [actors, models] = await Promise.all([
  context.functions.actor_list({}),
  context.functions.model_list({}),
]);
return { actors, models };
```

## Zustand, Fortsetzung und Fehler

Snippets können lesen, Ergebnisse kombinieren und Teilnehmer, Programme, Subscriptions oder
Views einrichten. Für spätere Ereignisse, dauerhaften Zustand und Mini-Apps stehen Actor-Programme
bereit. Die Wahl folgt der Aufgabe; ein Aufbau muss nicht in einem eigenen Setup-Actor liegen.
Fachliche Skill-Einstiege beschreiben das Ergebnis und schreiben keinen technischen Lösungsweg vor.
Technische Verträge und Anleitungen gehören zur auffindbaren Umgebung.

Ein Snippet handelt als sein Aufrufer. `onInput` handelt als der empfangende TypeScript-Actor.
Eine Actor-Funktion verwendet den Zustand ihres Besitzers, ruft Run-Funktionen aber mit der
Identität des Aufrufers auf. `event_subscribe` legt entsprechend das Abo für den handelnden
Aufrufer an. Soll ein dauerhafter Actor selbst abonnieren, führt er diesen Aufruf in `onInput`
aus. Eine fremde Funktion zu starten überträgt keine Actor-Identität.

Abgeschlossene Funktionsaufrufe bleiben wirksam, wenn ein späterer Schritt scheitert. Ein
Snippet bildet keine Transaktion über seine Aufrufe. Wiederholungen prüfen den vorhandenen
Aufbau und führen fehlende Schritte fort. Das Snippet wartet nicht auf zukünftige Antworten;
Subscriptions liefern sie als spätere ActorInputs.
