# TypeScript-Snippets, Actor-Programme und Run-Scripts

Snippets und Actor-Programme verwenden eine gemeinsame native Node-Ausführung und dieselbe
typisierte API der registrierten Run-Funktionen. Actor-Programme verwenden normale TypeScript-Module.
Ein Programm kann Funktionen, einen Input-Handler und React-Views bereitstellen. Ob ein Actor
seine normalen Inputs mit einem Modell oder mit TypeScript verarbeitet, bestimmt sein Treiber.
Aufrufbare Funktionen und der intrinsische Actor-Zustand sind davon unabhängig. Der Paket-
und Autorenvertrag steht in `run-modules.md`, das Actor-Modell in `core.md`.

## Ausführung und Kontext

Der Server bindet `NativeTypeScriptExecutor` an die produktneutrale Engine. Der Compiler prüft
TypeScript und baut die benötigten Module; der Executor lädt sie in einen verwalteten
Node-Prozess. Ein nativer IPC-Kanal transportiert Aufrufe, Ergebnisse, Zustandsänderungen und
Funktionsanfragen zwischen Prozess und Host. Normale relative Imports und Node-Bibliotheken
benötigen keine zusätzliche Sprachuntermenge oder Interpreterregeln.

Der Kontext eines Aufrufs liefert Run, Actor, Aufrufidentität, Zustand, deklarierte Capabilities,
Protokollierung und Abbruchsignal. `context.actor` ist immer vorhanden: Bei Programmen
identifiziert es den Besitzer, bei Snippets den handelnden Aufrufer. `context.state.read()`
liest den Kontextzustand, `context.state.replace(value)` merkt den nächsten Wert vor. Programme
verwenden ihren Actor-Zustand; Snippets beginnen mit `{}` und verwerfen diesen Zustand am Ende.
Die Funktion gibt ihr fachliches Ergebnis zurück; der Host interpretiert diese Rückgabe nicht
als Zustand. Der native Kindprozess prüft Ergebnisse und Zustandswerte vor der
IPC-Übertragung als strenges JSON. Nicht endliche Zahlen wie `Infinity` werden als Fehler
abgewiesen und nicht während der Serialisierung still in `null` umgewandelt. Bei Actor-Programmen
übernimmt erst der erfolgreiche Abschluss Zustandsänderungen ins Journal. Fehler oder Abbruch
verwerfen die vorgemerkten Änderungen.

`context.functions.<name>(input)` verwendet die registrierten Ein- und Ergebnisverträge.
Snippets erhalten die für ihren Aufrufer verfügbaren Funktionen; Programme deklarieren ihre
benötigten Funktionen unter `capabilities`. Die deklarierte Auswahl und die gebundene
Identität begrenzen den Aufruf. Aufrufnamen verwenden Unterstriche, etwa `actor_input`;
Grants stehen mit Punkt im Journal, etwa `actor.input`. Ein generierter Typvertrag erteilt
keine zusätzlichen Rechte.

`context.std` steht Snippets und Actor-Programmen gleichermaßen zur Verfügung. Uhr und
Kennungen sind an die jeweilige Ausführung gebunden: beim Snippet an dessen Aufruf,
bei der Input-Verarbeitung an den Actor-Turn. `context.std.mediators` stellt die vorhandenen
Vermittler bereit. Kontext und Standardbibliothek werden als Parameter übergeben, nicht als unsichtbare Code-Globals.

## Build und Prozesslebenszyklus

Programme sind private TypeScript-Pakete mit normalen Projektdateien, lokal aufgelösten
Abhängigkeiten und importierbaren SDK-Typen. Der TypeScript-Language-Server prüft dieselben
Dateien, die der Build verwendet. Vor Modellanfragen prüft ein Laufzeitbeitrag geänderte Pakete
und ergänzt einen kurzen Unterschied zum letzten Diagnostikstand. Die Typprüfung schließt
den unter `package.json.ragents.backend` deklarierten Einstieg immer ein, auch wenn die
Autorenkonfiguration ihn nicht in `tsconfig.include` erfasst. Vorhandene tsconfig-Dateien
bleiben erhalten; der Host ergänzt den Einstieg für die Prüfung ausdrücklich.

Ein aktivierter Build bindet Quellen, zusätzliche Module, generierte Typen, Capability-Verträge
und Compilerumgebung. Änderungen an Arbeitsdateien aktivieren sich nicht selbst; der Host
verwendet den geprüften Snapshot bis zur nächsten erfolgreichen Aktivierung. Hashes und
technische Bindungen bleiben Serverbuchhaltung.

Die eine Ausnahme ist Vertragsdrift. Liefert der Server, etwa nach einem Neubau, für eine
deklarierte Capability ein anderes Eingabe- oder Ergebnisschema als beim Aktivieren gebunden,
aktiviert der Host das Paket beim nächsten Aufruf einer Funktion oder des Eingabehandlers
selbst neu und führt den Aufruf erst danach aus; der Aufruf wartet solange in der Reihe des
Actors. Ein Paket aus einem Run-Script erhält dabei zuerst die aktuellen Quellen des Plugins,
ein eigenes Paket wird aus seinen Arbeitsdateien gebaut. Über die Verträglichkeit entscheidet
allein die Typprüfung gegen die neuen Verträge, nicht ein Schemavergleich. Scheitern
Typprüfung, Build, Fachtests oder die Zustandsprüfung, schlägt der Aufruf mit dieser Ursache
fehl und das alte Paket bleibt aktiv. Ändern sich dabei die Quellen, entsteht eine neue
Revision und offene Ansichten laden neu; gleiche Quellen behalten ihre Revision.

`actor_program_activate` führt Typprüfung, Build und die vorhandenen `node:test`-Dateien aus.
Das gilt für reine Funktionen, Programme mit Input-Handler und Programme mit Views. Getrennte
Actor- oder Script-Werkzeugverträge für Check, Test, Installation und Mock-JSON gibt es nicht.
Die normale SDK-Testhilfe `createTestContext` liefert Zustand und explizite typisierte Funktions-Mocks unter `functions`;
Tests prüfen Resultate, Zustandsänderungen und tatsächlich ausgeführte Aufrufe.

Der Executor ordnet Prozesse Run und Instanz zu und besitzt Stopps sowie Shutdown. Abbruch
beendet auch laufende und wartende Ausführung; eine späte Prozessantwort darf keinen Zustand
mehr übernehmen. Entfernen oder Ersetzen eines Programms löst dessen Ausführungsressourcen.
Dateirechte, Session-UID und Prozessumgebung gehören zum Workspace des Runs. Native Ausführung
ist keine zusätzliche Sprachsandbox gegen beliebigen Backend-Code.

## TypeScript-Actors

Actor-Pakete können `@ragents/workflow` für eine gemeinsame Ablaufdefinition verwenden.
Sie liefert dieselben Schritte für LLM-Anleitungen und Mini-App-Diagramme. Das serverseitige
Untermodul `@ragents/workflow/prompts` liest referenzierte Promptdateien relativ zum
installierten Paket. Definition, Zustand und Auflösung beschreibt
[Actor-Programme](run-modules.md#ablaufdefinition-anleitung-und-darstellung-verbinden).
Die Ausführung bleibt beim Actor; der Workflow-Vertrag ersetzt weder Scheduler noch Rechteprüfung.

Ein TypeScript-Actor verarbeitet einen ActorInput pro Turn. Sein Programm deklariert dafür
`input` und implementiert `onInput`. Der folgende einfache Zähler benötigt keine View:

```ts
import { defineActor } from "@ragents/server";
import { Type } from "typebox";

export default defineActor({
  state: Type.Object({ received: Type.Optional(Type.Integer()) }),
  functions: {},
  input: { capabilities: [] },
}, {
  functions: {},
  onInput: (input, context) => {
    const state = context.state.read();
    context.log(input.content);
    context.state.replace({ received: (state.received ?? 0) + 1 });
  },
});
```

Ein direkter Auftrag liefert normalen Text in `input.content`. Bei einer Subscription
enthält `input.event` zusätzlich das strukturierte Quellevent; andernfalls ist es `null`.
Die Quelle trägt Identität, Typ, Zeitpunkt und Nutzdaten. Ein Vermittler entscheidet nach
Quelle und Eventtyp, statt technische Informationen aus dem Text zu erraten.

Der Actor erledigt seinen Auftrag und beendet den Turn. Weitere Inputs oder Subscriptions
starten spätere Turns; ein Turn wartet nicht auf zukünftige Modellantworten. Funktionen und
Input-Verarbeitung greifen auf denselben journalisierten Actor-Zustand zu. Auf dem Canvas
bleibt der TypeScript-Actor ein Teilnehmer mit seiner Kennung und seinem Zustand.
Ein LLM-Actor verwendet für ActorInputs weiterhin sein Modell; ein zusätzliches Programm mit
`onInput` wird an ihm abgewiesen.

<!-- guide:functions -->
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
[Actor-Programm](../homepage/guide-programs.html). Beide Formen verwenden dieselben Funktionen.

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
<!-- /guide:functions -->

Vor der Typprüfung hält `typescript_eval` den tatsächlich gelesenen Quelltext als
`tool.call.source` im Journal fest. Das Ereignis gehört über Turn und Werkzeugaufruf zum
normalen Aufrufablauf und enthält bei Dateiausführung auch den angeforderten Pfad. Damit
bleibt bei `path` der damals ausgeführte Stand erhalten, selbst nach späterer Dateiänderung;
auch ein Compilefehler behält seine Quelle. Scheitert bereits das Lesen der Datei, gibt es
keinen erfundenen Quelltext-Snapshot.

Der Reiter `Executions` der Orchestrierungs-Extension zeigt diese Historie zusammen mit
Status, Dauer, Ergebnis, Logs und Fehler. Ältere Inline-Aufrufe können ihren Quelltext aus der
journalisierten Eingabe anzeigen. Bei alten dateibasierten Aufrufen ohne Snapshot bleibt die
fehlende historische Quelle sichtbar benannt; die aktuelle Datei ersetzt diesen Nachweis nicht.

<!-- guide:functions -->
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
<!-- /guide:functions -->

## Run-Scripts als vorbereitete Actor-Programme

Ein Run-Script bietet einen vorbereiteten, wiederverwendbaren Start einer Unterhaltung. Ein
freier Benutzerauftrag benötigt kein solches Paket. Der globale Koordinator kann vorhandene
oder selbst erstellte Pakete über die Verwaltungsmethoden starten. Innerhalb eines vorhandenen
Runs richten Snippets oder Actor-Programme die Umgebung über dieselbe Funktionen-API ein.

Ein Run-Script ist ein vollständiges Actor-Programmpaket für den Start einer Unterhaltung.
Der Host installiert seinen Setup-Actor und stellt ihm den ersten ActorInput zu. Eine
Startkarte entsteht durch einen Ordner unter dem registrierten Plugin:

```text
plugins/<id>/run-scripts/<name>/
  RUN.md                  Titel, Beschreibung, Reihenfolge, optional guide und coordinator
  package.json            ragents.backend verweist auf den Setup-Einstieg
  src/server.ts           defineActor mit input und onInput
  tests/program.test.ts    normale node:test-Fachtests
  actors/<program-name>/  optionale weitere Actor-Programmpakete
```

Der Ordnername ist der Handle des Setup-Actors, die Einstiegkennung `<plugin>.<name>`.
`RUN.md` enthält Metadaten und eine Beschreibung des Fachfalls. Die tatsächlich benötigten
Capabilities stehen im TypeScript-Vertrag unter `input.capabilities` oder an einer Funktion.
Es gibt keine zweite Capability-Liste in der Markdown-Datei.

Der Loader liest Paketdateien und optionale Unterprogramme, ohne fremde Verzeichnisse zu
verfolgen. Fehlende oder ungültige Paketbestandteile sind harte Fehler. Registrierte
Run-Script-Verträge transportieren Dateien; sie verlangen keine bereits erzeugten Build-IDs.
Weitere TypeScript-Dateien werden über normale relative Imports eingebunden.

`ragents.chat.start { runId, entry, input }` legt den Run mit dem Titel und den Startoptionen an.
Der Host bereitet den Arbeitsbereich vor, übernimmt die mitgelieferten Programme aus `actors/`
in die private Sammlung und importiert das Setup-Paket über denselben Aktivierungspfad wie
ein während des Runs geschriebenes Programm. Typprüfung, Build und Fachtests laufen vor der
Aktivierung. Der Start braucht dafür keinen Modellaufruf und keinen gesonderten Testnachweis.
Der Run merkt sich die Einstiegkennung (`ragents.actor-programs.script`); bei Vertragsdrift
holt der Host Setup-Paket und mitgelieferte Programme aus den aktuellen Quellen des Plugins
nach, statt die beim Start kopierten Dateien neu zu bauen.

Während der Vorbereitung meldet die Chat-Session einen flüchtigen Startstatus im bestehenden
Status-Stream: Vorbereitung des Runs, des Arbeitsverzeichnisses und der Oberfläche. Neue
Stream-Verbindungen erhalten den aktuellen Stand. Nach dem Einreihen des ersten Inputs endet
dieser Status; danach liefern die journalisierten Inputs und Turns den Arbeitszustand.
Ein Startfehler beendet die Ladeanzeige mit einer Fehlermeldung. Parallele Startanfragen
überschreiben keine laufende Vorbereitung. Ein Serverneustart stellt keinen flüchtigen
Startvorgang wieder her.
Ein Stopp meldet den abgebrochenen Start sofort und verhindert weitere Aufbauschritte.
Bereits laufende, nicht abbrechbare Vorbereitung bleibt bis zu ihrem Abschluss erfasst;
in dieser Zeit bleibt auch der Start gesperrt. Die Paketaktivierung erhält das Abbruchsignal.

Anschließend erhält der Setup-Actor den Startwert als JSON in `input.content`:
`{ "input": <Leitfaden-Ergebnis oder null>, "options": { "<option-id>": <Wert> } }`.
Die Form des Leitfaden-Ergebnisses gehört zum Paket; der Handler prüft sie vor dem Aufbau.
Mit `coordinator: true` legt der Host den normalen Koordinator an. Bei `coordinator: false`
entfällt er, und das Setup muss über `run_configure` einen Primary-Actor wählen. Dessen
Auftrag kommt über einen ActorInput. Ist der Primary-Actor ein LLM, spricht der Benutzer
direkt mit ihm. Ein TypeScript-Primary wird über seine Mini-App oder dokumentierten
Programmfunktionen bedient; sein Verlauf ist kein freier Chat.

Unterprogramme werden mit `actor_program_activate` anhand ihres eigenen Namens aktiviert.
Die optionale Actor-Referenz bindet etwa eine Liste samt View an einen gerade angelegten
LLM-Helfer. Ein vorbereitetes Paket braucht keinen erneuten Create-Aufruf. Der Setup-Actor
merkt abgeschlossene Einrichtung in seinem Zustand, damit spätere Inputs nichts doppelt
anlegen. Er bleibt danach ein normaler Actor des Runs.

Die neutralen Referenzen zeigen eine Gesprächsrunde, einen Moderator als direkten
Chatpartner, ein Sammelboard am echten LLM-Listenhelfer und einen Balkon-Berater.
`word-game` steuert zwölf Beiträge von vier LLMs; `learning-afternoon` sammelt zwei parallel
erzeugte Ideen. Beide bringen die Mini-App ihres TypeScript-Actors mit und beginnen die
Modellarbeit erst nach dem Startknopf in der App. Die Homepage importiert dieselben
View-Komponenten für ihre ausdrücklich gekennzeichneten lokalen Vorschauen.
Nach der Einrichtung weisen beide Programme unbekannte direkte Nachrichten als Fehler ab,
ohne den bisherigen Programmzustand zu verändern. Ihre Startkommandos und abonnierten
Ereignisse bleiben die vorgesehenen Eingaben; ein weiterer Durchlauf benötigt einen neuen Run.
Ihre Pakettests prüfen konfigurierte
Starts, ausdrückliche Standardstarts, ungültige Eingaben und die Reihenfolge des Aufbaus.
Der Server-Test `reference-run-scripts.test.ts` importiert die mitgelieferten Pakete gegen das
Profil `core`, damit veraltete Beispiele auffallen.

Lokale Pakete außerhalb des Repos können über die gemeinsamen Verwaltungsmethoden mit einem
Serverdateipfad gestartet werden. Sie verwenden denselben Loader und Aktivierungspfad,
werden aber nicht dauerhaft als Startkarten registriert. Ein `RUN_SCRIPTS_DIR` existiert nicht.

## Öffentliche Entwicklerreferenz

`docs/homepage/llms.txt` erschließt die erzeugten öffentlichen Referenzen. `run-setup.md`
enthält die vollständigen Quellen der core-Einstiege einschließlich normaler Tests und
mitgelieferter Actor-Programme. `run-api.d.ts` ist das tatsächliche `@ragents/server`-SDK mit
den statischen Funktionsverträgen von core. Die installierten Pakete erhalten denselben
Deklarationsgenerator mit ihrem aktuellen Vertragsbestand.

Die SDK-Datei ist ein normales TypeScript-Modul mit Exports. Sie ergänzt keine Globals
oder Laufzeitrechte. Die Homepage-Prüfung kompiliert die veröffentlichten Pakete und prüft
positive sowie fehlerhafte Funktionsaufrufe gegen diese Deklarationen.
`rpc-api.md` und `openrpc.json` entstehen getrennt aus den registrierten Methoden- und
Kanalverträgen und beschreiben den Zugang außerhalb der Actor-Laufzeit.

## Offene Grenzen

- Zeitpläne sind nicht umgesetzt. Ereignisse liefern über Subscriptions normale ActorInputs;
  sie sind keine Wartefunktion innerhalb eines Turns.
- Fachtests und Typechecks ersetzen keine tatsächliche Prüfung einer View im Browser.
- Zwischenstände einer noch laufenden Funktion werden nicht automatisch journalisiert.
- Eine gescheiterte Neuaktivierung nach Vertragsdrift wird bei jedem weiteren Aufruf erneut
  versucht; der Host merkt sich das Scheitern nicht.
- Native Node-Ausführung verwendet die Rechte und Umgebung des Run-Workspaces und garantiert
  keine zusätzliche Isolation gegenüber absichtlich bösartigem Backend-Code.
