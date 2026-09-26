# TypeScript-Snippets, Actor-Programme und Run-Scripts

Snippets und Actor-Programme verwenden eine gemeinsame native Node-Ausführung und dieselbe
typisierte API der registrierten Run-Funktionen. Actor-Programme verwenden normale TypeScript-Module.
Ein Programm kann Funktionen, einen Input-Handler und React-Views bereitstellen. Ob ein Actor
seine normalen Inputs mit einem Modell oder mit TypeScript verarbeitet, bestimmt sein Treiber.
Aufrufbare Funktionen und der intrinsische Actor-Zustand sind davon unabhängig. Der Paket-
und Autorenvertrag steht in `actor-programs.md`, das Actor-Modell in `core.md`.

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
den unter `package.json.ragents.backend` deklarierten Einsprungpunkt immer ein, auch wenn die
Autorenkonfiguration ihn nicht in `tsconfig.include` erfasst. Vorhandene tsconfig-Dateien
bleiben erhalten; der Host ergänzt den Einsprungpunkt für die Prüfung ausdrücklich.

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
Dateirechte, UID je Run und Prozessumgebung kommen aus dem Serverkontext des Runs
(`SandboxServices.serverProcessContextFor`): bei einem Arbeitsbereich auf dem Server aus dessen
Workspace, bei einem Arbeitsplatz aus einem eigenen Ordner des Runs auf dem Server, nie aus dem
Ordner des Arbeitsplatzes. Native Ausführung ist keine zusätzliche Sprachsandbox gegen beliebigen
Backend-Code.

## TypeScript-Actors

Actor-Pakete können `@ragents/workflow` für eine gemeinsame Ablaufdefinition verwenden.
Sie liefert dieselben Schritte für LLM-Anleitungen und Mini-App-Diagramme. Das serverseitige
Untermodul `@ragents/workflow/prompts` liest referenzierte Promptdateien relativ zu dem Paket, in
dessen `node_modules` es liegt, ohne eingebrannten Pfad. Das setzt voraus, dass ein Backend das
Modul nicht mitbündelt; `compileAppBackend` lässt alle Pakete extern. Definition, Zustand und
Auflösung beschreibt
[Actor-Programme](actor-programs.md#connect-workflow-definition-instructions-and-presentation).
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
Input-Verarbeitung greifen auf denselben journalisierten Actor-Zustand zu. Auf der
Fläche bleibt der TypeScript-Actor ein Teilnehmer mit seiner Kennung und seinem Zustand.
Ein LLM-Actor verwendet für ActorInputs weiterhin sein Modell; ein zusätzliches Programm mit
`onInput` wird an ihm abgewiesen.

<!-- guide:functions -->
## TypeScript as the AI's way of working

The model uses RAgents capabilities by writing TypeScript. The workspace provides callable
functions for tasks such as reading a file or creating an agent. The model combines them into a
program, keeping results in variables, checking conditions, and running independent steps in
parallel.

The same approach supports larger setups. In the word game, code creates the participants and
controls their handoffs while four models supply the words. A mini-app displays progress from
the same program. The AI therefore does not need to derive the workflow again from conversation
instructions after every response.

For one-off work, a snippet is enough: a short TypeScript program for one execution. Its result
returns to the model, which can then decide what to do next. When a program needs to retain state
or react to later messages, it becomes an [actor program](../homepage/guide-programs.html). Both
forms use the same functions.

## One-off snippets

The standard native interface provides `typescript_api` for available functions and
`typescript_eval` for TypeScript code. Workspace plugins can also expose `read`, `write`, `edit`,
and `bash` directly when the actor is allowed to use them. Individual file and shell actions do
not need a TypeScript wrapper. They use the same implementation, working-directory resolution,
permission checks, and journal recording as function calls. Both mechanisms are part of the
server foundation, even without the optional actor-program plugin. Agent creation and other
workflow functions are called from TypeScript through `context.functions`. File functions remain
available there for compound calls. Plugins register each implementation once; snippets and
persistent actor programs use the same API.

Every equipped LLM actor automatically receives the names and short descriptions of all
functions available to it. This applies to coordinators and subagents. Changes update the
overview even during a turn. Direct native tools are marked, and their native descriptions also
include detailed usage guidance. The overview grants neither additional functions nor
permissions; plain LLMs with `tools: []` do not receive it.

### Short descriptions and details

A function registered with `defineRunFunction` has a technical `name` for calls and a readable
`label` for people. `description` briefly explains its purpose and appears in the automatic
overview. An optional `longDescription` adds detailed rules, prerequisites, and examples. Input
and result types come from schemas; descriptions do not replace those contracts. Local recursive
schema references create named TypeScript aliases, keeping nested contracts such as the tile tree
fully typed in snippets, actor programs, and the public run API. Resolution includes local
`$defs` references; external references are not loaded.

Without selected names, `typescript_api` returns the compact catalog. `query` searches names and
short descriptions. With `names`, the result includes the entries of those functions in
`RAgentsCapabilityMap` as TypeScript declarations, available long descriptions, and guidance
attached to those exact functions. The declarations of `context` itself (`run`, `actor`, `state`,
`log`, `std` with its mediators) are the same for every function, so `context: true` returns them
once with the general guidance instead of every answer repeating them. A result type made of
journal events lists only the event types the function actually produces. Declarations include each
property's `description` as a comment. A schema shared by several functions appears once as a
named alias. JSON Schemas with validation rules such as lengths and patterns are added to a name
selection only with `schemas: true`. This input asks for the actor-list contract; it is a tool
input, not a snippet:

```json
{"names":["actor_list"]}
```

### Execute code

`typescript_eval` accepts exactly one of `code` or `path`. The source is the body of an async
function with `context`; `return` produces the result. For `path`, the executor of the machine that
holds the file reads it (`files.read`): a path relative to the run root from the machine the run is
bound to, a path under an alias such as `@actors` from the server, also for a connected workspace.
Execution always takes place on the server. Before execution, the shared compiler checks
the code against the current API contract. Native execution uses the same executor, function
resolver, and cancellation path as actor programs. A snippet requires no actor package,
activation, or separate actor. Its variables live for that execution.

Compilation uses a warm pool of up to eight long-lived worker threads; additional requests wait
for a free worker. Each worker loads TypeScript once and caches parsed library and declaration
files by name and content, up to 256 entries with oldest-first eviction. Snippet sources are
always parsed fresh, while the previous program enables structural reuse. Results, diagnostics,
hashes, and emitted code match a cold compilation. The default 60-second limit, configurable by
callers up to 180 seconds, includes queue time. A worker that times out, exits, or receives run
cancellation is terminated and replaced when next needed; its request fails with `TIMEOUT`,
`WORKER_FAILURE`, or `ABORTED`. A compiler error in submitted code does not terminate the worker.
Resource limits apply per worker.

A function with an empty or entirely optional input schema can be called without an argument;
`context.functions.status()` and `context.functions.status({})` are equivalent. An `undefined`
object property is treated like a missing key on both input and result. The compiler does not
enable `exactOptionalPropertyTypes`; the host accepts the value and omits the key from its JSON
result. `undefined` as an array element or the result itself remains an error.

This `typescript_eval` input reads the existing actors and returns the actual response to the
model:

```json
{"code":"const actors = await context.functions.actor_list({}); return actors;"}
```

In a file, the same function body can combine several independent queries. For this example,
load the `actor_list` and `model_list` contracts first:

```ts
const [actors, models] = await Promise.all([
  context.functions.actor_list({}),
  context.functions.model_list({}),
]);
return { actors, models };
```
<!-- /guide:functions -->

### Quelltextnachweis und Ausführungshistorie

Vor der Typprüfung hält `typescript_eval` den tatsächlich gelesenen Quelltext als
`tool.call.source` im Journal fest. Das Ereignis gehört über Turn und Werkzeugaufruf zum
normalen Aufrufablauf und enthält bei Dateiausführung auch den angeforderten Pfad. Damit
bleibt bei `path` der damals ausgeführte Stand erhalten, selbst nach späterer Dateiänderung;
auch ein Compilefehler behält seine Quelle. Scheitert bereits das Lesen der Datei, gibt es
keinen erfundenen Quelltext-Snapshot.

Der Reiter `Executions` des Orchestrierungs-Plugins zeigt diese Historie zusammen mit
Status, Dauer, Ergebnis, Logs und Fehler. Ältere Inline-Aufrufe können ihren Quelltext aus der
journalisierten Eingabe anzeigen. Bei alten dateibasierten Aufrufen ohne Snapshot bleibt die
fehlende historische Quelle sichtbar benannt; die aktuelle Datei ersetzt diesen Nachweis nicht.

<!-- guide:functions -->
## State, continuation, and errors

Snippets can read data, combine results, and set up participants, programs, subscriptions, or
views. Actor programs handle later events, persistent state, and mini-apps. The choice follows
the task; a setup does not need a dedicated setup actor. Domain-specific skill templates describe
the desired result rather than prescribing a technical solution. Technical contracts and guides
belong in the discoverable environment.

A snippet acts as its caller. `onInput` acts as the receiving TypeScript actor. An actor function
uses its owner's state but calls run functions under the caller's identity. Accordingly,
`event_subscribe` creates the subscription for the acting caller. For a persistent actor to
subscribe on its own behalf, it makes the call from `onInput`. Calling another actor's function
does not transfer actor identity.

Completed function calls remain effective if a later step fails. A snippet is not a transaction
across its calls. Retries inspect the existing setup and continue missing steps. A snippet does
not wait for future responses; subscriptions deliver them as later ActorInputs.
<!-- /guide:functions -->

## Run-Scripts als vorbereitete Actor-Programme

Ein Run-Script bietet einen vorbereiteten, wiederverwendbaren Start eines Runs. Ein
freier Benutzerauftrag benötigt kein solches Paket. Der globale Koordinator kann vorhandene
oder selbst erstellte Pakete über die Verwaltungsmethoden starten. Innerhalb eines vorhandenen
Runs richten Snippets oder Actor-Programme die Umgebung über dieselbe Funktionen-API ein.

Ein Run-Script ist ein vollständiges Actor-Programm für den Start eines Runs.
Der Host installiert seinen Setup-Actor und stellt ihm den ersten ActorInput zu. Eine
Vorlage entsteht durch einen Ordner im Quellordner des Plugins; `ragents plugin build`
kopiert ihn ins Bundle (`bundles/<id>/run-scripts/<name>/`), und geladen wird diese Kopie:

```text
plugins/<id>/run-scripts/<name>/
  RUN.md                  Titel, Beschreibung, Reihenfolge, optional guide, coordinator, fixed-start-options
  package.json            ragents.backend verweist auf den Setup-Einsprungpunkt
  src/server.ts           defineActor mit input und onInput
  tests/program.test.ts    normale node:test-Fachtests
  actors/<program-name>/  optionale weitere Actor-Programme
```

Der Ordnername ist der Handle des Setup-Actors, die Vorlagenkennung `<plugin>.<name>`.
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
Der Run merkt sich die Vorlagenkennung (`ragents.actor-programs.script`); bei Vertragsdrift
holt der Host Setup-Paket und mitgelieferte Programme aus den aktuellen Quellen des Plugins
nach, statt die beim Start kopierten Dateien neu zu bauen.

Während der Vorbereitung meldet der Chat des Runs einen flüchtigen Startstatus im bestehenden
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
Der Server-Test `reference-run-scripts.test.ts` aktiviert die mitgelieferten Pakete gegen die
Werkzeuge des Profils `core`, damit veraltete Beispiele auffallen.

Lokale Pakete außerhalb des Repos können über die gemeinsamen Verwaltungsmethoden mit einem
Serverdateipfad gestartet werden. Sie verwenden denselben Loader und Aktivierungspfad,
werden aber nicht dauerhaft als Vorlagen registriert. Ein `RUN_SCRIPTS_DIR` existiert nicht.

## Erzeugte Entwicklerreferenz

`docs/homepage/llms.txt` erschließt die erzeugten Referenzen; sie sind interne Build-Ausgaben
und gehören nicht zum öffentlichen Export der Homepage. `run-setup.md`
enthält die vollständigen Quellen der showcase-Vorlagen einschließlich normaler Tests und
mitgelieferter Actor-Programme. `run-api.d.ts` ist das tatsächliche `@ragents/server`-SDK mit
den statischen Funktionsverträgen von showcase. Die installierten Pakete erhalten denselben
Deklarationsgenerator mit ihrem aktuellen Vertragsbestand.

Die SDK-Datei ist ein normales TypeScript-Modul mit Exports. Sie ergänzt keine Globals
oder Laufzeitrechte. Die Homepage-Prüfung kompiliert die dort enthaltenen Pakete und prüft
positive sowie fehlerhafte Funktionsaufrufe gegen diese Deklarationen.
`rpc-api.md` und `openrpc.json` entstehen getrennt aus den registrierten Methoden- und
Kanalverträgen und beschreiben den Zugang außerhalb der Actor-Laufzeit.

## Offene Grenzen

- Fachtests und Typechecks ersetzen keine tatsächliche Prüfung einer View im Browser.
- Zwischenstände einer noch laufenden Funktion werden nicht automatisch journalisiert.
- Eine gescheiterte Neuaktivierung nach Vertragsdrift wird bei jedem weiteren Aufruf erneut
  versucht; der Host merkt sich das Scheitern nicht.
- Native Node-Ausführung verwendet die Rechte und Umgebung des Serverkontexts des Runs und garantiert
  keine zusätzliche Isolation gegenüber absichtlich bösartigem Backend-Code.
