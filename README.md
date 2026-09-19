# RAgents

Eine Web-Werkstatt für KI-Agenten. Du chattest mit einem Koordinator; der kann weitere Agenten
starten und Actors mit TypeScript-Funktionen und eigenen Oberflächen ausstatten. Alles, was passiert, steht in einem
Journal - der Zustand entsteht immer durch Wiedergabe dieses Journals, nie durch Zwischenspeicher.
Der Koordinator erhält die verfügbaren Funktionen mit kurzen Beschreibungen automatisch im
Kontext, lädt Details bei Bedarf und kombiniert die Funktionen in kleinen TypeScript-Snippets. Einmalige Arbeit benötigt keinen zusätzlichen Actor. Für spätere
Nachrichten, dauerhaften Zustand und Mini-Apps schreibt er Actor-Programme. Beide verwenden
dieselbe typisierte API; Plugins ergänzen Funktionen mit einer gemeinsamen Implementierung.
Der globale Koordinator ist direkt in der Kopfzeile erreichbar. Fokus in seine Eingabe öffnet
seinen Verlauf darunter; kurze Antworten erscheinen direkt unter der Kopfzeile. Er kann die Runs und ihre
Journale überblicken und weitere Läufe starten. Beim Absenden erhält er außerdem den aktuellen
UI-Standort, etwa Run und ausgewählten Actor, getrennt vom sichtbaren Fragetext. Er verwendet allgemeine Datei- und
Shellfunktionen über dieselbe TypeScript-Schnittstelle sowie die Verwaltungsmethoden externer Clients; deren Referenz wird aus den
ausführbaren Verträgen erzeugt. Die Ecke links oben öffnet die Run-Liste.
"Neuer Run" in der Übersicht öffnet die Startauswahl als Dialog; Escape führt zurück.
Eine Liste mit Vorschau unterscheidet Skills und Run-Scripts. Übernommene
Prompts lassen sich im nächsten Dialogschritt mit einer eigenen Koordinator-Instanz ausarbeiten.
Sie startet nach Deinem ausdrücklichen, sinngemäßen Go im Chat; "Run erstellen" startet weiterhin
direkt. Beide Wege übernehmen Gespräch, Skill und Anhänge und verwenden die gewählte Modellwahl. Ein
Skill kann neben dem Startauftrag eine wiederverwendbare Arbeitsanleitung und ergänzende
Dateien enthalten; er lässt sich auch während einer Unterhaltung passend zur Aufgabe laden.
Der Run-Koordinator steht standardmäßig in der Actor-Leiste oben am Canvas; sein Eintrag
öffnet den Chat als Pop-out direkt darunter. Weitere LLM-Einträge öffnen ebenso ihren Chat,
TypeScript-Einträge ihre Actor-Ansicht ohne Chat-Eingabe; diese Programme werden über Mini-App oder dokumentierte Funktionen bedient. Seine Canvas-Karte lässt sich bei Bedarf zusätzlich einblenden.
Links schaltet `Anzeige` zwischen `Alle`, `Aktive`, `Sichtbare`, `LLM-Agenten` und `TypeScript` um.
Die vollständige Liste bleibt unter `Actors` erreichbar; offene Knöpfe bleiben sichtbar gedrückt.
Die Actor-Programm-Extension liefert vorgefertigte Chats, Formulare, Tabellen, Dateiauswahl mit
Vorschau, Listen mit Detailansicht, Aufgabenfortschritt sowie Dokument- und Diff-Ansichten. Typisierte Controls und
API-Referenz stammen aus denselben Verträgen. Ein Chat folgt einem Actor im Run oder verwendet einen frei vorgegebenen Verlauf.
Eine gemeinsame Ablaufdefinition kann sowohl die LLM-Anleitung mit längeren Promptdateien
als auch ein automatisch angeordnetes Diagramm liefern. Eigene Arbeitspunkte und dynamische
Gruppen ergänzen den aktuellen Zustand innerhalb der beschriebenen Freiheiten.

Die neutrale Referenz-Extension liefert Demos für die RAgents-Konzepte, die auch als
Ausgangspunkte für durchgängige Testfälle dienen. Skill-Einstiege stehen
in frei benannten Kategorien, darunter Mini-Apps; Schlagworte ergänzen die Suche. Zwei Einrichtungsdialoge konfigurieren eine Gesprächsrunde oder ein Sammelboard vor
dem Start. Zwei Skill-Einstiege führen eine Entscheidung beziehungsweise eine Lerneinheit im
Chat. Die automatisch erzeugte Beispielübersicht verknüpft die gezeigten Produktkonzepte mit
den Demos. Deren Oberflächen kombinieren passende Controls für den jeweiligen Anwendungsfall.

Einstellungen öffnen zuerst die Modelle: die eigene Auswahl des globalen Koordinators und
Modellvorgaben für neue Runs und Agenten sowie ein getrenntes Modell für automatische
Überschriften. Die Titelerzeugung lässt sich deaktivieren; vorhandene Titel bleiben erhalten.
Bestehende Agenten behalten ihr Modell. Darstellung,
Erweiterungskatalog und Laufzeitinformationen stehen in eigenen Bereichen.

Die Oberfläche verwendet Schichtwerk: matte Karten mit geraden Fronten und gestufter Tiefe
nach rechts oben. Unter Einstellungen, Darstellung stehen Hell, Dunkel und die Systemeinstellung
zur Wahl; die Vorgabe ist Dunkel. Die Anzahl der Tiefenstufen lässt sich dort von 0 bis 5 einstellen;
die Vorgabe ist 3. Jede Stufe besitzt einen festen Abstand, bei 0 bleiben die Karten flach.
Die Auswahl bleibt im Browser.
Mini-Apps verwenden dieselben matten Farben und runden Konturen.
Kopfzeile, Seitenleisten, Dialoge und Einstellungen folgen der Canvas-Palette mit kühlen
blaugrauen Flächen und Lavendel als Akzent.

## Die fünf Begriffe

Mehr braucht man nicht, um das System zu verstehen:

- **Run** - eine Unterhaltung. Genau ein Journal.
- **Actor** - wer im Run handelt. Drei Arten: Du (der menschliche Owner), Modell-Actors (Agenten),
  TypeScript-Actors (TypeScript).
- **ActorInput** - eine Nachricht an einen Actor. Landet in seiner Warteschlange.
- **Turn** - die Bearbeitung genau eines ActorInputs. Endet, sobald der Actor kein Werkzeug mehr
  aufruft. Es gibt keine Warte-Werkzeuge.
- **Event** - jede Zustandsänderung im Journal. Actors können sie abonnieren; jedes passende Event
  wird beim Abonnenten zu einem neuen ActorInput.

Ausführlicher stehen die Begriffe in `docs/spec/overview.md`.

### So sieht ein Journal aus

Eine Zeile JSON je Command-Entscheidung, append-only. Die Zeile enthält den Command und ein
Array seiner Events. `sequence` zählt über alle Events des Runs lückenlos hoch. Das folgende
Formatbeispiel ist zum Lesen eingerückt und gekürzt; Kennungen und Metadaten sind teilweise
weggelassen, es ist keine vollständige Journalzeile:

```json
{
  "formatVersion": 3,
  "runId": "example-run",
  "command": {
    "type": "model.output.complete",
    "actorId": "reviewer"
  },
  "events": [
    {
      "sequence": 12,
      "type": "model.output.completed",
      "actorId": "reviewer",
      "payload": {
        "turnId": "review-turn",
        "text": "Die Prüfung ist abgeschlossen."
      }
    }
  ]
}
```

Die verbindlichen Typen stehen in `packages/ragents/src/runtime/journal.ts` und
`packages/ragents/src/domain/events.ts`. Aus den Ereignissen wird der Run-Zustand wiederhergestellt,
ohne Modelle oder Werkzeuge erneut auszuführen. Modellkontexte und Arbeitsdateien liegen zusätzlich
außerhalb des Journals. Eine schrittweise Erklärung bietet die
[Homepage](docs/homepage/index.html#journal); die Grenzen stehen in `docs/spec/core.md`.

## Aufbau

```
Browser, VS Code, Konsole  --JSON-RPC über HTTP oder stdio-->  apps/server  -->  packages/ragents (Engine)
                             |                   |
                        PluginHost          Journal, Actors, Turns, Events
                             |
                        plugins/<plugin-id>/server/
                             ^
                        plugins/<plugin-id>/web/  <--  apps/web
```

Der Server ist dünn. Er nimmt JSON-RPC über HTTP oder stdio entgegen, sucht beim Start die
Plugins auf der Platte und setzt daraus ein Profil zusammen. Jede Fähigkeit nach außen ist ein
typisierter Vertrag (Methode oder Kanal), aus dem Server, Web und Referenz dieselben Typen
ziehen; HTTP-Routen gibt es nur noch für die Auslieferung von Dateien und Frames. Die Engine kennt keine Fachdomäne - alles Fachliche kommt
aus Plugins.

## Welcher Ordner enthält was

| Ordner                | Inhalt                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| `plugins`             | ein Ordner je Plugin, mit `server/`, `web/` und seinen Assets                                        |
| `packages/ragents`    | die Engine: Journal, Actors, Turns, Events, Scheduler, TypeScript-Plattform                          |
| `packages/agent`      | Werkzeuge (read, write, edit, bash) und Sitzungsverwaltung                                           |
| `packages/agent-core` | die Agenten-Schleife                                                                                 |
| `packages/ai`         | die LLM-Anbindung (openrouter)                                                                       |
| `apps/server`         | Node-Backend, Plugin-Suche, Profil-Komposition; `plugin-support/` sind Host-Bausteine, keine Plugins |
| `apps/web`            | React-Frontend mit Plugin-Slots; Chat-Bausteine in `src/chat`, Arbeitsspalte in `src/column`         |
| `apps/vscode`         | VS-Code-Erweiterung: Explorer, Arbeitsspalte und Mini-Apps als Webviews, Arbeitsplatz für Runs     |
| `scripts`             | Einstiege `start.sh`, `start-vscode.sh`, `install-plugin-dependencies.sh`; Werkzeuge in Unterordnern |
| `selftest`            | Katalog und Protokoll der autonomen Testrunden                                                       |
| `docs`                | Spec, Konzepte, Entscheidungen, Betrieb, Produkt-Homepage, Entwürfe                                  |

Jedes Paket hat eine eigene kurze README. `packages/agent`, `agent-core` und `ai` sind eine
gegabelte Agentenlaufzeit; Herkunft und eigene Eingriffe stehen in `docs/decisions.md`. Ihr
`dist/` ist gitignored und liefert die Typen, daher nach einem frischen Klon einmal
`pnpm build:agent`.

## Was eingebaut ist

Die Engine stellt typisierte Funktionen für Actors, Nachrichten, Ereignisse, Artefakte und
Modellauswahl bereit. Der verbindliche Bestand steht im Code unter
`packages/ragents/src/agents/tools.ts`. Plugins ergänzen weitere Funktionen, etwa für Dateien,
Programme und die Arbeitsfläche.

Ein Modell entdeckt den aktuellen Bestand und exakte Typen über `typescript_api`. Mit
`typescript_eval` führt es kleine TypeScript-Snippets aus und ruft darin
`context.functions.<name>(input)` auf. Derselbe Zugang steht dauerhaften Actor-Programmen zur
Verfügung. Die Standardoberfläche braucht dafür nur diese beiden nativen Werkzeuge. Sie gehören zum
Server und bleiben auch ohne die optionale Actor-Programm-Extension verfügbar.
Eine Erweiterung registriert mit `defineRunFunction` und `host.functions` eine gemeinsame
Implementierung. `nativeTool: true` bietet sie bei Bedarf auch direkt als Modellwerkzeug an.

Dazu kommen der gemeinsame TypeScript-Compiler, die native Node-Ausführung, geprüfte
Programmbuilds, das Journal samt Wiedergabe und der Turn-Scheduler. Die Funktionsauswahl des
Actors und seine Capabilities begrenzen den Zugriff. Promptbeiträge binden sich über
`requiresTools` an die tatsächlich verfügbaren Funktionen; Detailanleitungen werden zusammen
mit deren Verträgen nachgeladen.

## Actors mit Funktionen und Views

TypeScript- und LLM-Actors können programmierte Funktionen, eigenen Zustand und React-Views
besitzen. Ein TypeScript-Actor verarbeitet auch seine normalen Nachrichten im Code. Ein
LLM-Actor beantwortet sie weiterhin mit seinem Modell; der Aufruf einer seiner programmierten
Funktionen benötigt keine zusätzliche Modellantwort.

Ein einfaches Backend zählt Eingaben im Zustand seines Actors:

```ts
import { defineActor } from "@ragents/server";
import { Type } from "typebox";

export default defineActor({
  state: Type.Object({ count: Type.Optional(Type.Integer()) }),
  functions: {},
  input: { capabilities: [] },
}, {
  functions: {},
  onInput: (_input, context) => {
    const state = context.state.read();
    context.state.replace({ count: (state.count ?? 0) + 1 });
  },
});
```

Funktionen stehen im selben Vertrag unter `functions` mit typisierter Ein- und Ausgabe.
Ihre Rückgabe ist ein Ergebnis; nur `context.state.replace` ändert den Actor-Zustand.
Eine Funktion kann gleichzeitig in der React-View und als Agentenwerkzeug verfügbar sein.
Beide arbeiten mit derselben Implementierung und denselben Daten. Lokale Eingabeentwürfe
bleiben in der View; erfolgreicher gemeinsamer Zustand erscheint auch bei ruhendem Chat.

`actor_program_create` legt ein privates TypeScript-Paket an. Die normalen Datei- und
Language-Server-Werkzeuge bearbeiten es unter `@actors/<name>/`, Bash über
`RAGENTS_ACTORS_DIR`. Neue oder behobene Projektfehler erscheinen vor Modellanfragen als
kurzer Hinweis; `actor_program_diagnostics` liefert bei Bedarf den vollständigen Stand.
`actor_program_activate` prüft Typen, baut das Programm, führt die Fachtests aus und aktiviert es.

Bei der Aktivierung bindet `actor: "self"` oder `actor: "@handle"` das Programm an einen
vorhandenen Actor. Ohne Bindung erzeugt ein neues Backend einen TypeScript-Actor; eine reine
View gehört zum aufrufenden Actor und braucht keinen zusätzlichen Teilnehmer.
Programme verwenden feste lokale Bibliotheken, reguläre Imports und normale `node:test`-Dateien.
Der Host führt sie in verwalteten Node-Prozessen aus und übernimmt erfolgreiche
Zustandsänderungen ins Journal. Paketstruktur und Beispiele stehen in
[Actor-Programme](docs/spec/run-modules.md) und [TypeScript-Plattform](docs/spec/typescript-platform.md).

## Was über Plugins geht

Ein Plugin ist EIN Ordner unter `plugins/` - beide Hälften zusammen. Der Ordnername ist die
Kennung:

```
plugins/<plugin-id>/
  server/index.ts    exportiert plugin: PluginModule = { requires?, create(host) }
  web/index.tsx      exportiert webPlugin: WebPlugin (nur wenn es einen Web-Anteil gibt)
  contract.ts        was beide Hälften teilen, importfrei (nur wenn es das gibt)
  prompt.hbs, prompts/, run-scripts/, skills/, install.sh
```

Geladen wird zur Laufzeit per `await import()`, im Web über `import.meta.glob` je Ordner als
eigener Chunk. Es gibt keinen kompilierten Katalog und kein Nachladen aus fremder Quelle: was im
Repo liegt, kann komponiert werden, mehr nicht.

Plugins sind KEINE npm-Pakete. Derzeit sind es 17, davon 14 mit Web-Anteil. Die vier Pakete unter
`packages/` sind Bibliotheken, gegen die Plugins gebaut werden - keine Erweiterungen.

Auch scheinbar tief sitzende Dinge sind Plugins: die drei Language Server (`ragents.lsp-roslyn`,
`ragents.lsp-fsharp`, `ragents.lsp-typescript`) sitzen je in einem eigenen Ordner. `lsp-roslyn`
und `lsp-fsharp` bringen dazu je einen eigenen Konfigurationsschlüssel und ein eigenes
`install.sh` mit; `lsp-typescript` braucht beides nicht, weil der typescript-language-server eine
npm-Abhängigkeit der Repository-Wurzel ist. Nimmt man `ragents.lsp-roslyn` aus dem Profil,
verschwindet die C#-Diagnostik samt Konfiguration.

### Erweiterungspunkte im Server

Das bekommt ein Plugin über `host` in `create(host)`:

| Punkt             | wofür                                              |
| ----------------- | -------------------------------------------------- |
| `tools`           | Werkzeuge für Agenten                              |
| `prompts`         | Kapitel im Systemprompt                            |
| `skills`          | feste Abläufe als Skill-Dateien                    |
| `startEntries`    | Einstiege der Startfläche: Skills, Run-Scripts |
| `profiles`        | Modellprofile (`model_list`)                       |
| `agentRuntime`    | Agent-Extensions in der Agentenlaufzeit            |
| `script`          | Capabilities für TypeScript-Actors                 |
| `operations`      | benannte Operationen, auch quer zwischen Plugins   |
| `operation`       | Griff auf eine fremde benannte Operation           |
| `invokeOperation` | eine benannte Operation aufrufen                   |
| `provide`         | einen Dienst unter einem Token bereitstellen       |
| `service`         | einen fremden Dienst über sein Token beziehen      |
| `optionalService` | einen fremden Dienst beziehen, der fehlen darf     |
| `startOptions`    | Startoptionen der Startfläche, je Run eingefroren  |
| `methods`         | Methoden der Nachrichtenschicht mit Vertrag        |
| `channels`        | Kanäle mit Benachrichtigungen je Abonnement        |
| `http`            | Auslieferung: Dateien, Frames, Uploads             |
| `config`          | Konfigurationsschlüssel, streng geprüft            |
| `clientConfig`    | Werte, die das Web-Plugin sehen darf               |
| `storage`         | Ablage unter `plugins/<id>`, global und je Session |
| `lifecycle`       | Haken bei Session-Anlage und -Löschung             |
| `sessionMetadata` | zusätzliche Angaben zur Unterhaltung               |

### Erweiterungspunkte im Web

Ein Web-Plugin füllt Slots im Frontend: `brand`, `canvas`, `canvasElements`, `cardSections`,
`chatDisplayPolicy`, `startOptions`, `SessionProvider`, `sessionHeaders`, `workspaceTabs`,
`workspaceTabsFor`, `toolPresenters`, `entityPresenters`, `sessionMetadata`, `questionResponder`,
`attention`. `workspaceTabs` sind feste Reiter, `workspaceTabsFor` ist eine Fabrik, die je Session
Reiter aus dem laufenden Zustand ableitet. Mini-Apps erscheinen standardmäßig direkt
auf dem Canvas; ihre Sichtbarkeit ist im Run schaltbar, der Benutzer kann eine lokale Vollansicht öffnen.
`startOptions` liefert je serverseitiger Startoption eine eigene Bedienkomponente und ein Abzeichen
für den Kopf der laufenden Unterhaltung; ohne Komponente zeichnet der Host ein Auswahlmenü aus der
Darstellung der Option.

Ein Fachplugin besitzt seine Promptteile, Skills, Server-API, Web-Komponenten, CSS, Konfiguration
und Ablage selbst. Nimmt man es aus dem Profil, verschwinden Prompt,
Werkzeuge, Projektion, API, Reiter, CSS, Konfiguration und Session-Daten gemeinsam.

## Die Profile

Ein Profil ist genau EINE Datei: `ragents.config.<profil>.ts`. Sie nennt das Produkt
(`PRODUCT_ID`, `PRODUCT_TITLE`), die Pluginliste (`PLUGINS`) und die Konfiguration aller
beteiligten Plugins. `PRODUCT_PROFILE` wählt die Datei aus. Es gibt keinen Default; fehlt der
Wert oder die Datei, startet der Server nicht.

Im Repo liegt genau ein Profil:

|                      | `core`                  |
| -------------------- | ----------------------- |
| Plugins              | neutrale `ragents.*`    |
| Arbeitsverzeichnis   | wählbar je Unterhaltung |
| Dateiablage          | je Unterhaltung         |
| Anmeldung und Rechte | optional je Profildatei |
| Start                | `./start.sh core`       |

Ein Produktprofil ist eine eigene `ragents.config.<name>.ts`, die auch außerhalb des Repos
liegen und ihre Plugins per Pfad nennen kann; der Start nimmt statt des Profilnamens auch den
Pfad zu einer solchen Datei.

`core` ist zugleich der gelebte Entfernungstest: läuft es ohne jedes produktspezifische Plugin,
ist die Grenze zwischen Engine und Produkt intakt. Den Arbeitsbereich eines Runs wählt die
Startoption "Arbeitsbereich": ein leerer Ordner je Run, ein vorhandener Ordner auf dem
Serverrechner oder der Ordner eines verbundenen Arbeitsplatzes. Die VS-Code-Erweiterung bietet
ihre geöffneten Ordner als Arbeitsplatz an und belegt die Wahl bei "Neuer Run" vor; liegt der
Server auf demselben Rechner, arbeitet der Run direkt im Ordner, sonst führt die Erweiterung
Datei- und Shellzugriffe für ihn aus.

Eine Profildatei kann zusätzlich Benutzer mit Passwörtern und Rechten definieren.
Dann verlangt die Oberfläche eine Anmeldung und zeigt Funktionen je nach Recht verborgen,
nur lesbar oder bearbeitbar; der Server prüft dieselben Rechte. Ohne Benutzerliste bleibt die
Anmeldung aus; ein anonymer Zugang kann trotzdem eingeschränkt werden. Freie Runs und
technische Ansichten besitzen eigene Rechte. Eine Einstiegsliste begrenzt neue Runs auf
vorbereitete Setups. Die Benutzer teilen sich die Runs ihres Profils. Die
[Profil-Spec](docs/spec/profiles.md) beschreibt Einrichtung und Grenzen; geprüfte neutrale
Beispiele stehen in der [Entwicklerreferenz](docs/homepage/developer.html#extension-profile-access).

## Konfiguration

Eine TypeScript-Datei je Profil (`ragents.config.<profil>.ts`), gruppiert nach Plugin-ID plus einer
`host`-Sektion. Der Compiler prüft Sektionen und Schlüssel gegen die Deklarationen der Plugins;
ein Dienst-Secret im Klartext ist ein Compilerfehler. Vorlage: `ragents.config.example.ts`.

Rollen, Benutzer und Passwörter stehen in derselben Datei; die Rolle bestimmt den Zugang zur
Oberfläche und API, die Benutzer eines Profils teilen sich Modelle, Plugins und Runs.
Gesetzte Umgebungsvariablen überschreiben die Dateivorgaben. Die Daten eines Profils liegen
unter `~/.local/share/ragents/<profil>`; `DATA_DIR` überschreibt `host.DATA_DIR` und diesen
Standard. Die Datenablage muss außerhalb eines Git- oder Paketprojekts liegen. Ein bewusster Umzug
erfolgt bei gestopptem Server; der Start übernimmt oder löscht keine bisherigen Profilordner.

Es gibt KEINE `.env`. Secrets stehen in Ronalds `~/.zshrc` und werden mit `env("NAME")` referenziert.

## Entwickeln

```sh
pnpm install
pnpm build:agent          # einmalig nach frischem Klon: erzeugt die d.ts der Laufzeitpakete
scripts/start.sh core     # Server auf Port 4710, Daten ~/.local/share/ragents/core
pnpm check                # Build, Typecheck, Tests, Web-Build
```

Die Adresse ist fest: `http://localhost:4710` für `core`. Der Port steht in `host.PORT` der
Profildatei. Ein ausdrücklich gesetztes `PORT` überschreibt ihn; ein belegter oder ungültiger
Port bricht den Start ab. Laufende Instanzen werden nicht beendet und der Start wechselt nicht
auf eine andere Adresse.

Mit `--dev` bleibt der Backendport gleich; Vite verwendet fest den Backendport plus 1000, für
`core` also 5710. Beide Ports werden vor dem Start geprüft. Ein eigenständiges `pnpm dev:web`
verwendet Port 5710 und als Proxyziel `http://localhost:4710`.

Browserprüfungen benötigen Chrome oder Chromium. Das Plugin `ragents.browser` verwendet
`BROWSER_EXECUTABLE_PATH` aus seiner Profilsektion oder den mit
`pnpm exec playwright-core install chromium` installierten Browser. Auf dem Mac kann der Pfad
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` verwendet werden. Die Installation
startet keinen Browser; dieser wird erst für einen konkreten Run geöffnet.

Die drei VS-Code-Tasks rufen Skripte unter `build/` auf: `build` (Standard) baut
Agentenlaufzeit, Web und Homepage, `check` prüft das Projekt und `open: homepage` baut und
öffnet die Homepage. Die entsprechenden pnpm-Befehle verwenden dieselben Skripte; gezielte
Teilbuilds bleiben über `pnpm build:agent` und `pnpm build:web` verfügbar. Jeder Web-Build
erzeugt die Homepage mit und liefert sie als Hilfe über das Fragezeichen neben Einstellungen
aus. Für separates statisches Hosting liegt dieselbe Website unter `docs/homepage/dist/`;
`pnpm generate:homepage` baut sie auch unabhängig von der Anwendung.

Das Web wird statisch aus `apps/web/dist` serviert; nach Änderungen dort `pnpm run build`.
Der Server läuft über `tsx` aus den Quellen, Code-Änderungen greifen erst nach Neustart.

Einzeln statt `pnpm check`: je Paket `pnpm exec tsc --noEmit` (der Typecheck von `apps/server`
deckt die `server/`-Hälften der Plugins mit ab, der von `apps/web` die `web/`-Hälften);
Engine-Tests `cd packages/ragents && pnpm test`; Server-Tests
`cd apps/server && PRODUCT_PROFILE=core pnpm test`; Lint `pnpm lint` im Root (`apps/web/src`
und `plugins/*/web`). Die Language-Server-Live-Tests (echte Server gegen `tests/fixtures/lsp`)
laufen nur auf Ansage: `scripts/install-plugin-dependencies.sh .data/language-servers`
einmalig, dann `RAGENTS_LSP_TESTS=1 ROSLYN_LANGUAGE_SERVER=<...>/roslyn/Microsoft.CodeAnalysis.LanguageServer.dll
FSHARP_LANGUAGE_SERVER=<...>/fsautocomplete/fsautocomplete PRODUCT_PROFILE=core pnpm test`.

Verhalten live prüfen: eine Nachricht per `POST http://localhost:<port>/rpc` mit
`{"jsonrpc":"2.0","id":1,"method":"ragents.chat.send","params":{"runId":"<uuid>","text":"..."}}`
schicken und das Journal unter `${DATA_DIR}/runs/<uuid>/` lesen. Startmodi des Servers:
`pnpm start -- --stdio` (JSON-RPC über stdin und stdout, kein Port) und `pnpm start -- --port 0`
(freier Port mit Ansage auf stdout), Details in `docs/spec/profiles.md`. Ganze Läufe
von außen anlegen, steuern und auswerten: `pnpm driver` (`scripts/driver/run-driver.ts`), Bedienung in
`docs/operations.md` unter "Läufe von außen fahren".

Unter `scripts/` liegen nur die Einstiege `start.sh`, `start-vscode.sh` (VS-Code-Testinstanz mit
der Erweiterung gegen einen laufenden Server) und `install-plugin-dependencies.sh`; die
übrigen Werkzeuge stehen thematisch in `scripts/homepage/` (Generator, Typprüfung und Tests der
Homepage), `scripts/driver/` (`pnpm driver`) und `scripts/maintenance/` (Modellkatalog,
Konzept-Audit).

## Für KI-Assistenten

Besitzer ist Ronald (SchlenkR). Er arbeitet auf mehreren Rechnern; verlass Dich nicht auf ein
Sitzungsgedächtnis. Alles, was eine neue Session wissen muss, steht im Repo, und zwar hier und in
den folgenden Dateien. `AGENTS.md` und `CLAUDE.md` sind nur Zeiger hierher, für Codex und
Claude Code; sie bekommen keinen eigenen Inhalt.

### Pflichtlektüre in dieser Reihenfolge

1. `docs/spec/overview.md` - Leitsatz, Begriffe, Schichten, Kurs (einschmelzen statt ausbauen;
   Sicherheit nachrangig; keine Migrationen) und die verbindlichen Regeln.
2. Das Spec-Kapitel zur Aufgabe: `docs/spec/core.md` (Run, Actor, Turn, Event, Journal),
   `typescript-platform.md`, `run-modules.md` (Script-Werkzeuge, Mini-Apps), `plugins.md`
   (Vertrag, Ordner, Web-Host, Language Server, Skill-Einstiege), `profiles.md` (Profile,
   Konfiguration).
3. `docs/decisions.md`, die obersten Einträge - was sich zuletzt geändert hat und warum.
4. `docs/operations.md` - Betrieb und Fachdetails der Plugins (Datenablage, Zugang, Läufe von
   außen fahren).
5. `TODO.md` und `docs/concepts/` - offene Arbeit, Ideen und ausgearbeitete Konzepte.
6. `selftest/LOG.md` - was die Selbstverbesserungs-Runden gefunden haben und welche
   Fehlerklassen schon behoben sind.

### Dokumentation: drei Orte, eine Regel

Die Spec sagt, was ist, gültig für den aktuellen Code. Ein Konzept sagt, was noch nicht ist.
Nichts ist beides; ein Konzept überlebt seine Umsetzung nicht.

- `docs/spec/`: ein Kapitel je Thema, immer wahr für HEAD, jedes Kapitel endet mit "Offene
  Grenzen". Verbindliche Listen (Events, Plugin-Vertrag, Schemata) stehen nur im Code.
- `docs/concepts/<thema>.md`: was noch nicht ist, mit Status-Zeile Idee, In Arbeit oder
  Verworfen. "Umgesetzt" ist kein Status.
- `docs/decisions.md`: das Warum, datiert, jüngste zuerst; jeder Eintrag nennt das Kapitel, das
  er geändert hat. Keine zweite Spec.
- `TODO.md`: Eingang für alles, Abschnitte "Offen" und "Ideen", eine Zeile je Eintrag, neu oben.
- `docs/operations.md`: Bedienung. `README.md`: Produktüberblick und Einstieg für Menschen und
  Assistenten, diese Datei.
- `docs/homepage/index.html`: die Produkt-Homepage für Benutzer. Eine nüchterne Beschreibung, was
  RAgents ist und was es kann, in der Stimme der README; kein Prospekt: keine Slogans, keine
  Claim-Kacheln, keine Bullet-Raster, keine erfundenen Beispiele. Überschriften benennen die
  Sache (Oberfläche, leerer Chat, Agenten, Vermittler, Werkzeuge und Mini-Apps, Rückfragen und
  Dateien, Journal, Profile, Grenzen). Jeder Abschnitt nennt im HTML-Kommentar die Spec-Kapitel
  und Plugins, die ihn ändern können, und am Ende die Skill-Einstiege aus
  `plugins/ragents.reference/skills` zum Ausprobieren. Screenshots zeigen ausschließlich echte
  Läufe des Profils core unter `docs/homepage/screenshots/`. Auf Ronalds Wunsch vom 07.09.2026
  ergänzen beschriftete Funktionsschemata und Icons aus HTML/SVG die Erklärung; sie stellen
  keine echten Läufe dar. Solange keine Läufe aufgenommen werden können, sind ausdrücklich als
  solche beschriftete Bildplatzhalter zulässig. Die Seite zeigt nur, was in core läuft. Private
  Produktnamen und Integrationen erscheinen nicht auf den öffentlichen Seiten. Konzepte
  erscheinen nur im letzten Abschnitt, als Idee. Optik wie die App (Tokens und Schrift aus
  `apps/web/src/ui/theme.css`), eine Spalte, keine externen Ressourcen.
- `docs/homepage/reference.html` und `developer.html`: generierte öffentliche Baustein- und
  Entwicklerreferenz. Quellen sind neutrale Verträge, Plugins und kleine Codebeispiele; keine
  privaten Profile oder Laufzeitdaten. Mit `pnpm generate:homepage` erzeugen, mit
  `pnpm check:homepage` prüfen. Generierte Dateien nicht von Hand bearbeiten; Pflege in
  `scripts/homepage/` und `docs/homepage/reference-ui.tsx`. Die UI-Demos verwenden echte
  Komponenten ohne Server.
- `docs/homepage/guide.html` und `guide-*.html`: generierter Guide für Einstieg, Arbeitsweise und
  Entwicklung. Texte ausschließlich in markierten öffentlichen Abschnitten der Spec und
  `docs/operations.md` pflegen (`<!-- guide:<id> -->` bis `<!-- /guide:<id> -->`), keine zweite
  Textkopie. Kapitel und Darstellung in `scripts/homepage/homepage-guide.ts`; Build, Export und Hilfe
  verwenden denselben Generator wie die Referenzen. Neue Inhalte müssen im Profil core gelten.
- `docs/ui-drafts/`: jeder UI-Entwurf ist eine HTML-Seite mit ein bis zwei PNG-Screenshots
  daneben (headless Chrome) und einem Tab in `docs/ui-drafts/index.html`: dort von Hand einen
  `<article>`-Block ergänzen, wie im Kommentar der Datei beschrieben. Das gilt für ALLE
  bisherigen und neuen Entwurfsseiten. Pro HTML-Seite steht genau ein Tab in der Übersicht,
  neueste Sammlungen zuerst. Varianten innerhalb derselben Seite bleiben in deren eigenem Menü
  und bekommen keine doppelten Tabs oben (Ronald, 12.09.2026). Im Kartenraster bleibt jede
  Variante mit eigener Vorschau direkt sichtbar. Nach dem ursprünglichen Entwurfsdatum
  sortieren; Nachtragen macht alte Entwürfe nicht zu neuen. Bestehende Direktlinks erhalten und
  fehlende ältere Seiten nachtragen. Keine getrennten Entwurfsübersichten. Kein Build.
- Mehr Orte gibt es nicht.

So dokumentierst du deine Arbeit:

1. Änderst du Verhalten, bringst du das betroffene Spec-Kapitel im selben Commit auf den neuen
   Stand. Die Spec beschreibt den Ist-Zustand, keine Historie.
2. Dazu ein datierter Eintrag oben in `docs/decisions.md`: was, warum, welches Kapitel.
3. Was offen bleibt, wird eine Zeile in `TODO.md`. Erledigte Zeilen löschst du.
4. Braucht eine Idee mehr als drei Sätze, bekommt sie `docs/concepts/<thema>.md` mit Status
   Idee; die TODO-Zeile verschwindet. Ist das Konzept umgesetzt: Kapitel anpassen, Eintrag in
   `decisions.md`, Konzeptdatei löschen.
5. Keine neuen Dokumente daneben, keine Übergabe-Dateien. Was eine nächste Session braucht,
   steht in `TODO.md` und `decisions.md`.
6. Ändert sich, was ein Benutzer sieht oder tun kann (Reiter, Startbildschirm, Fläche, eine
   Fähigkeit, ein Skill-Einstieg), bringst du den betroffenen Abschnitt der Homepage im selben
   Commit mit; veraltete Screenshots nimmst du neu auf oder nimmst sie heraus. Die Homepage
   verspricht nichts, was nicht in core läuft.

### Arbeiten

- Lokaler Server: Ronald startet ihn SELBST über die VS-Code-Tasks oder `scripts/start.sh
  <profil>`. Keine Hintergrundinstanz starten, Laufzeitdaten nur auf Ansage anfassen. Belegte
  Ports brechen den Start ab; keine Ersatzports suchen oder andere Instanzen beenden. Nach
  Web-Änderungen `pnpm build:web` und "Neustart nötig" sagen; Serveränderungen greifen erst
  nach Neustart. Ausnahme: Dateien, die der Server je Aufruf als `new Worker(...)` lädt (etwa
  `packages/ragents/src/typescript/compiler-worker.ts`), greifen sofort - eine Änderung am
  Worker-Protokoll bricht laufende Runs, also nur bei gestopptem Server ändern.
- Das Secret `OPENROUTER_VSCODE_APIKEY` kommt aus der `~/.zshrc`: per grep extrahieren, NIE
  `source ~/.zshrc`.
- Fleißarbeit (Generierungen, Seiten zusammenbauen, Prüfläufe) an Subagenten geben; das große
  Modell schneidet und entscheidet. Subagenten bekommen Zielordner im Scratchpad.

### Regeln

- NIEMALS committen, pushen oder deployen ohne ausdrückliche Erlaubnis von Ronald.
- Die Dateiablage bleibt je Unterhaltung isoliert; die Übernahme eines fertigen Laufs in ein
  echtes Projekt ist Ronalds Schritt.
- Alles englisch BENENNEN: Dateien, Ordner und Bezeichner im Code. Deutscher Fließtext bleibt
  deutsch (Prosa, Strings, Prompts), aber nie in einem Namen.
- Kommentare minimal (max. 1 Zeile), echte Umlaute in Prosa und Strings, nur Zeichen der
  deutschen Tastatur (keine Pfeile/typografischen Zeichen).
- Keine stillen Fallbacks: fehlende Voraussetzungen sind harte Fehler.
- Alte oder beschädigte Journale sperren nur den betroffenen Run und melden die Ursache. Sie
  dürfen weder den Serverstart noch andere Runs blockieren; Originaldateien erhalten.
- Generalisierung erst ab zwei echten Nutzern; Rückbauten immer fertig ziehen.
- Dokumentieren wie oben: Spec-Kapitel, Eintrag in `docs/decisions.md`, Rest nach `TODO.md`.
  Mehr Ablageorte gibt es nicht.
- Modelle tippen nichts ab: Werkzeugverträge dürfen nie verlangen, dass ein LLM Hashes, Tokens,
  IDs, Pfade oder Dateiinhalte aus früheren Ausgaben reproduziert - immer serverseitig auflösen
  oder per Referenz arbeiten.

## Weiterlesen

- `docs/spec/` - die Spec: was ist, ein Kapitel je Thema, Einstieg `overview.md`
- `docs/decisions.md` - das Warum: datierte Entscheidungen, jüngste zuerst
- `docs/operations.md` - Betrieb und Fachdetails: Datenablage, Zugang, Läufe von außen fahren
- `docs/concepts/` - was noch nicht ist, je Konzept eine Datei mit Status-Zeile
- `docs/homepage/index.html` - die Produkt-Homepage für Benutzer: was man tun kann, mit
  einer Scroll-Strecke für die Kernfunktionen, beschrifteten Funktionsschemata und technischen
  Vertiefungen; wird mit der Spec gepflegt
- [Bausteinreferenz](docs/homepage/reference.html) und [Entwicklerreferenz](docs/homepage/developer.html) -
  generierte Werkzeuge, UI-Demos und Erweiterungsbeispiele; `pnpm generate:homepage` erzeugt sie,
  `pnpm check:homepage` prüft Verträge und Aktualität
- [Guide](docs/homepage/guide.html) - Einstieg, Aufbau, Modellkontext, Programme, Erweiterungen
  und Rechte; direkt aus öffentlichen Abschnitten der Spec und Betriebsdokumentation erzeugt
- [Erweiterungsleitfaden](docs/homepage/guide-extensions.html#leitfaden-für-erweiterungen) -
  Ausführungsform wählen, Fachverträge und Prompts verbinden, Lebenszyklus und Bedienung prüfen;
  die Befundgrundlage steht in `docs/spec/plugins.md`
- [LLM-Einstieg](docs/homepage/llms.txt) und [Run-Setup-Anleitung](docs/homepage/run-setup.md) -
  generierte Textreferenzen für externe Modelle mit TypeScript-API und vollständigen Paketquellen;
  [llms-full.txt](docs/homepage/llms-full.txt) bündelt den Inhalt in einer Datei
