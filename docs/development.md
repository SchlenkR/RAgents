# RAgents: Handbuch für Entwicklung und KI-Assistenten

Der kurze englische Einstieg für GitHub ist die `README.md`. Dieses Handbuch ist der lange,
deutsche Teil: Begriffe, Aufbau, Plugins, Profile, Konfiguration, Entwicklung und die Regeln, nach
denen hier gearbeitet und dokumentiert wird. `AGENTS.md` und `CLAUDE.md` zeigen hierher.

RAgents ist eine Werkstatt für KI-Agenten: im Browser, in VS Code und in der Konsole. Du chattest
mit einem Koordinator; der kann weitere Agenten starten und Actors mit TypeScript-Funktionen und
Mini-Apps ausstatten. Alles, was passiert, steht in einem Journal; der Zustand entsteht immer
durch Wiedergabe dieses Journals, nie durch Zwischenspeicher. Was ein Benutzer sieht und tun kann,
steht in `docs/operations.md` und auf der [Homepage](https://schlenkr.github.io/RAgents/); hier
steht, wie das System gebaut ist.

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

Eine Zeile JSON je Command-Entscheidung, append-only. Die Zeile enthält den Command, seinen
Zeitpunkt und ein Array seiner Events. `sequence` zählt über alle Events des Runs lückenlos hoch.
Das folgende Beispiel zeigt eine Zeile, wie sie in `journal.jsonl` auf der Platte steht
(Dateiformat 5), zum Lesen eingerückt; Kennungen und Hash sind gekürzt:

```json
{
  "formatVersion": 5,
  "runId": "example-run",
  "command": {
    "id": "command-17",
    "type": "model.output.complete",
    "actorId": "reviewer",
    "requestHash": "9f2c..."
  },
  "occurredAt": "2026-09-24T10:15:00.000Z",
  "events": [
    {
      "eventId": "event-12",
      "sequence": 12,
      "type": "model.output.completed",
      "correlationId": null,
      "causationId": null,
      "payload": {
        "turnId": "review-turn",
        "text": "Die Prüfung ist abgeschlossen."
      }
    }
  ]
}
```

Im Speicher sieht dieselbe Zeile anders aus: Beim Lesen wird daraus ein `CommandRecord` mit
`formatVersion` 3, und jedes Event trägt zusätzlich `actorId`, `commandId`, `occurredAt` und
`schemaVersion` 3. Große Payload-Felder liegen auf der Platte unter `payloads/` und werden beim
Lesen aufgelöst. Die verbindlichen Typen stehen in `packages/ragents/src/runtime/journal.ts`,
`packages/ragents/src/runtime/journal-storage.ts` (Dateiformat) und
`packages/ragents/src/domain/events.ts`. Aus den Ereignissen wird der Run-Zustand wiederhergestellt,
ohne Modelle oder Werkzeuge erneut auszuführen. Modellkontexte und Arbeitsdateien liegen zusätzlich
außerhalb des Journals. Eine schrittweise Erklärung bietet die
[Homepage](homepage/index.html#journal); die Grenzen stehen in `docs/spec/core.md`.

## Aufbau

```
Browser, VS Code, Konsole  --JSON-RPC über HTTP oder stdio-->  apps/server  -->  packages/ragents (Engine)
                             |                   |
                        PluginHost          Journal, Actors, Turns, Events
                             |
                        bundles/<plugin-id>/server/
                             ^
                        bundles/<plugin-id>/web/  <--  apps/web (per URL unter /plugins/<id>/web/)
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
| `packages/agent`      | die Agentenlaufzeit: Agenten-Schleife, Sitzung, Werkzeuge (read, write, edit, bash)                  |
| `packages/workspace-executor` | der Arbeitsplatz-Executor aus Modulen: Sandbox-Werkzeuge, Sprachserver, Dateien, Prozesse, Befehle, Browser; im Server wie im Arbeitsplatz derselbe |
| `packages/ai`         | die LLM-Anbindung (openrouter)                                                                       |
| `apps/server`         | Node-Backend, Plugin-Suche, Profil-Komposition; `plugin-support/` sind Host-Bausteine, keine Plugins |
| `apps/web`            | React-Frontend mit Plugin-Slots; Chat-Bausteine in `src/chat`, Run-Panel in `src/run-panel`         |
| `apps/vscode`         | VS-Code-Erweiterung: Seiten Start, Runs und Umgebungen, Run-Panel und Mini-Apps als Webviews, Arbeitsplatz für Runs |
| `scripts`             | Einstiege `start.sh`, `start-vscode.sh`; Werkzeuge in Unterordnern, `remote/` für `pnpm connect`, `provision/` für `pnpm provision`, `workspace-client/` für `pnpm workspace-client`, `remote-workspace/` für `pnpm check:remote-workspace`, `run-transfer/` für `pnpm run-transfer` |
| `selftest`            | Katalog und Protokoll der autonomen Testrunden                                                       |
| `docs`                | Spec, Konzepte, Entscheidungen, Betrieb, Produkt-Homepage, Entwürfe                                  |

`apps/server`, `apps/web` und die Pakete unter `packages/` außer `workspace-executor` haben je
eine kurze README. `packages/agent` und `ai` sind eine
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
[Actor-Programme](spec/run-modules.md) und [TypeScript-Plattform](spec/typescript-platform.md).

## Was über Plugins geht

Ein Plugin ist EIN Quellordner - beide Hälften zusammen; die eingebauten liegen unter
`plugins/`. Der Ordnername ist die Kennung:

```
plugins/<plugin-id>/
  ragents-plugin.json  Kennung, deklarierte Exporte für andere Plugins, zusätzliche Assets
  server/index.ts    exportiert plugin: PluginModule = { requires?, create(host) }
  web/index.tsx      exportiert webPlugin: WebPlugin (nur wenn es einen Web-Anteil gibt)
  contract.ts        was beide Hälften teilen, importfrei (nur wenn es das gibt)
  prompt.hbs, prompts/, run-scripts/, skills/, provision.ts   nach Bedarf
```

Der Server lädt diesen Ordner nicht selbst: `pnpm build:plugins` baut jedes eingebaute Plugin mit
`ragents plugin build` zu einem Bundle unter `bundles/<id>/` (gitignored), und geladen wird zur
Laufzeit per `await import()` dessen `server/index.js`. Ein Plugin außerhalb des Repos baut sein
Repo selbst, das Profil nennt das Bundle per Pfad. Das Web des Hosts ist für jedes Profil
dasselbe; die Web-Hälften lädt der Browser zur Laufzeit per `import(url)` aus den Bundles des
Profils, die der Server unter `/plugins/<id>/web/` ausliefert, und die Tailwind-Klassen aller
Bundles gehen in das eine Stylesheet, das der Server beim Start und nach jeder geänderten
Klassenliste übersetzt. Es gibt keinen
kompilierten Katalog und kein Nachladen aus fremder Quelle: was als Bundle vorliegt und im Profil
steht, kann komponiert werden, mehr nicht.

Plugins sind KEINE npm-Pakete. Derzeit sind es 19, davon 14 mit Web-Anteil. Die fünf Pakete unter
`packages/` sind Bibliotheken, gegen die Plugins gebaut werden - keine Erweiterungen.

Auch scheinbar tief sitzende Dinge sind Plugins: die drei Language Server (`ragents.lsp-roslyn`,
`ragents.lsp-fsharp`, `ragents.lsp-typescript`) sitzen je in einem eigenen Ordner. `lsp-roslyn`
und `lsp-fsharp` bringen dazu je einen eigenen Konfigurationsschlüssel und eine eigene
`provision.ts` mit; `lsp-typescript` braucht beides nicht, weil der typescript-language-server eine
npm-Abhängigkeit der Repository-Wurzel ist. Nimmt man `ragents.lsp-roslyn` aus dem Profil,
verschwindet die C#-Diagnostik samt Konfiguration.

### Erweiterungspunkte im Server

`create(host)` bekommt den ganzen `PluginHost` und liefert Manifest und `register`. Die
Beiträge meldet das Plugin in `register(registration)` über die an das Plugin gebundene
`PluginRegistration` an (`packages/ragents/src/plugin-types.ts`):

| Punkt             | wofür                                              |
| ----------------- | -------------------------------------------------- |
| `functions`       | typisierte Run-Funktionen, optional als Werkzeug   |
| `prompts`         | Kapitel im Systemprompt                            |
| `skills`          | feste Abläufe als Skill-Dateien                    |
| `startEntries`    | Einstiege der Startfläche: Skills, Run-Scripts |
| `profiles`        | Modellprofile (`model_list`)                       |
| `agentRuntime`    | Hooks vor Modell- und nach Werkzeugaufrufen        |
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

Ein Web-Plugin füllt Slots im Frontend (`WebPlugin` in `apps/web/src/PluginRegistry.tsx`):
`brand`, `canvas`, `canvasElements`, `cardSections`, `chatDisplayPolicy`, `startOptions`,
`needsRunView`, `SessionProvider`, `sessionHeaders`, `sessionStatus`, `overviewPanels`,
`settings`, `workspaceTabs`, `workspaceTabsFor`, `toolPresenters`, `entityPresenters`, `guides`,
`sessionMetadata`, `actionViews`, `attention`; dazu `activate` und `enabled`. `actionViews`
stellen wartende Aktionen dar, deren Payload nur das besitzende Plugin kennt. `workspaceTabs` sind feste Reiter, `workspaceTabsFor` ist eine Fabrik, die je Session
Reiter aus dem laufenden Zustand ableitet. Mini-Apps bekommen standardmäßig eine eigene
Kachel; ihre Sichtbarkeit ist im Run schaltbar, der Benutzer kann eine lokale Vollansicht öffnen.
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

Im Repo liegen drei neutrale Profile:

|                      | `core`                  | `showcase`                      | `developer`                          |
| -------------------- | ----------------------- | ------------------------------- | ------------------------------------ |
| Plugins              | neutrale `ragents.*`    | wie `core` und `ragents.reference` | Arbeitsbereich, Dokumente, Sprachserver |
| Arbeitsverzeichnis   | wählbar je Unterhaltung | wählbar je Unterhaltung         | in der Regel ein Projektordner       |
| Dateiablage          | je Unterhaltung         | je Unterhaltung                 | je Unterhaltung                      |
| Anmeldung und Rechte | optional je Profildatei | wie `core`                      | aus, `anonymousUser` mit allen Rechten |
| Start                | `./start.sh core` (4710) | `./start.sh showcase` (4713)   | `./start.sh developer` (4715) oder `ragents run` |

`showcase` ist `core` samt den mitgelieferten Beispielen aus `ragents.reference`: 27 Skills und
6 Run-Scripts vom Wortspiel bis zur Balkon-Planung. Sie sind Lehrmaterial, deshalb bleibt `core`
als Vorlage für ein echtes Profil ohne sie. Die intern erzeugte Referenz und die eingebaute Hilfe
entstehen aus `showcase`.

`developer` ist das Programmierprofil: ein Server ohne Anmeldung auf dem eigenen Rechner, mit
C#-, F#- und TypeScript-Diagnostik. Es ist zugleich die Vorlage für ein eigenes Ad-hoc-Profil.

Ein Produktprofil ist eine eigene `ragents.config.<name>.ts`, die auch außerhalb des Repos
liegen und ihre Plugins per Pfad nennen kann; der Start nimmt statt des Profilnamens auch den
Pfad zu einer solchen Datei.

`core` ist zugleich der gelebte Entfernungstest: läuft es ohne jedes produktspezifische Plugin,
ist die Grenze zwischen Engine und Produkt intakt. Den Arbeitsbereich eines Runs wählt die
Startoption "Arbeitsbereich": ein leerer Ordner je Run, ein vorhandener Ordner auf dem
Serverrechner oder der Ordner eines verbundenen Arbeitsplatzes. Die VS-Code-Erweiterung bietet
ihre geöffneten Ordner jedem verbundenen Ziel als Arbeitsplatz an und belegt die Wahl bei "Neuer Run" vor; die
Arbeitswerkzeuge laufen immer dort, wo der Ordner liegt, mit demselben Executor im Server wie im
Arbeitsplatz. Ohne VS Code meldet `pnpm workspace-client <server-url> [ordner ...]` denselben
Arbeitsplatz von der Kommandozeile an. Ein KI-Agent auf demselben Rechner nimmt statt dessen
`ragents run <ordner> "<auftrag>"` mit der Bindung `path`; die Kurzanleitung dafür steht in
`skills-for-agents/ragents/SKILL.md`, die Befehle in
[operations.md](operations.md) unter "Control RAgents as an agent".

Eine Profildatei kann zusätzlich Benutzer mit Passwörtern und Rechten definieren.
Dann verlangt die Oberfläche eine Anmeldung und zeigt Funktionen je nach Recht verborgen,
nur lesbar oder bearbeitbar; der Server prüft dieselben Rechte. Ohne Benutzerliste bleibt die
Anmeldung aus; ein anonymer Zugang kann trotzdem eingeschränkt werden. Freie Runs und
technische Ansichten besitzen eigene Rechte. Eine Einstiegsliste begrenzt neue Runs auf
vorbereitete Setups. Ein Run gehört dem Benutzer, der ihn angelegt hat; `runs.read.all` zeigt
die Runs aller Benutzer. Die [Profil-Spec](spec/profiles.md) beschreibt Einrichtung und Grenzen;
geprüfte neutrale Beispiele stehen in der intern erzeugten
[Entwicklerreferenz](homepage/developer.md#lesen-und-vorbereitete-setups-freigeben).

## Konfiguration

Eine TypeScript-Datei je Profil (`ragents.config.<profil>.ts`), gruppiert nach Plugin-ID plus einer
`host`-Sektion. Der Compiler prüft Sektionen und Schlüssel gegen die Deklarationen der Plugins;
ein Dienst-Secret im Klartext ist ein Compilerfehler. Vorlagen: `ragents.config.core.ts` für ein
echtes Profil, `ragents.config.developer.ts` für ein Ad-hoc-Profil.

Rollen, Benutzer und Passwörter stehen in derselben Datei; die Rolle bestimmt den Zugang zur
Oberfläche und API, die Benutzer eines Profils teilen sich Modelle und Plugins; Runs gehören dem
Benutzer, der sie angelegt hat.
Gesetzte Umgebungsvariablen überschreiben die Dateivorgaben. Die Daten eines Profils liegen
unter `~/.local/share/ragents/<profil>`; `DATA_DIR` überschreibt `host.DATA_DIR` und diesen
Standard. Die Datenablage muss außerhalb eines Git- oder Paketprojekts liegen. Ein bewusster Umzug
erfolgt bei gestopptem Server; der Start übernimmt oder löscht keine bisherigen Profilordner.

Es gibt KEINE `.env`. Secrets kommen aus der Umgebung des Prozesses, etwa der Startdatei der
Shell, und werden mit `env("NAME")` referenziert.

## Entwickeln

```sh
pnpm install
pnpm build:agent          # einmalig nach frischem Klon: erzeugt die d.ts der Laufzeitpakete
pnpm build:plugins        # die veralteten eingebauten Plugins als Bundles nach bundles/ (start.sh und die Server-Tests tun das selbst)
pnpm build:web            # das Web des Hosts nach apps/web/dist, eins für alle Profile (start.sh tut das, wenn es veraltet ist)
scripts/start.sh core     # Server auf Port 4710, Daten ~/.local/share/ragents/core
scripts/start.sh showcase # dasselbe Profil samt Beispielen, Port 4713
pnpm check                # Build, Typecheck, Tests, Web-Build
pnpm provision core       # Werkzeuge der Plugins des Profils holen (Language Server, Browser)
pnpm build:package        # den Host als npm-Paket @schlenkr/ragents bauen (dist/ragents), samt Bundles und fertigem Web
pnpm check:package        # das gebaute Paket installieren und daraus ein fremdes Plugin bauen und starten (braucht npm)
pnpm publish:package      # dasselbe Paket auf npm veröffentlichen (Token aus npm_key)
RAGENTS_TOKEN=... pnpm connect https://<server>   # Profil und Modelle eines anderen RAgents-Servers
```

`pnpm provision <profil>` holt die Werkzeuge, die die Plugins des Profils brauchen, nach
`<Datenordner>/tools/<plugin-id>/` und berichtet je Plugin `bereit`, `installiert` oder
`fehlt: <Grund>`; `pnpm provision --workspace` tut dasselbe für einen Arbeitsplatz ohne Profil.
Was sich nicht holen lässt (dotnet, ein eigener Chrome), ist eine benannte Lücke mit Anweisung.

`pnpm connect` holt das Client-Profil eines zentralen Servers samt den Bundles, die es per Pfad
nennt, in einen Cache unter `~/.local/share/ragents/remote/`, verlangt dieselbe Host-API wie dort
und für jedes per Kennung genannte Plugin ein eingebautes Bundle, und startet den lokalen Server
damit, mit dem Web dieses Hosts; gebaut und installiert wird nichts, die Modelle kommen über das
Relay des Servers. Bedienung in `docs/operations.md` unter "Connect to a server".

Wer den Host nur benutzt, braucht dieses Repository nicht: `pnpm build:package` erzeugt daraus
das npm-Paket `@schlenkr/ragents` mit Server, Engine, Plugins und Skripten, `pnpm publish:package`
veröffentlicht es. Damit genügt Node 22 -
`npm install -g @schlenkr/ragents`, dann `ragents connect <server-url>`, `ragents start
<profil|pfad>`, `ragents provision`, `ragents workspace-client` und `ragents plugin build`.
`ragents start` nimmt auch eine eigene `ragents.config.<profil>.ts` mit eigenen Plugins an
beliebiger Stelle; ihre Bundles baut ihr Autor mit `ragents plugin build` aus dem Paket, samt
Typprüfung gegen die Host-API. Das Paket bringt dafür alles mit, dazu das fertige Web und alle
eingebauten Plugins als Bundles; beim Anwender wird nichts gebaut, Vite gehört nicht dazu. Die Fassung des Pakets ist die
`version` dieser Wurzel-`package.json`; `pnpm publish:package` zählt vor dem Bauen die letzte
Stelle über die zuletzt veröffentlichte hoch und schreibt sie dorthin. Bedienung in
`docs/operations.md` unter "Work without a checkout", die Anleitung für Plugin-Autoren im Abschnitt
"Build and ship a plugin" in `docs/spec/plugins.md`.

Die Adresse ist fest: `http://localhost:4710` für `core`. Der Port steht in `host.PORT` der
Profildatei. Ein ausdrücklich gesetztes `PORT` überschreibt ihn; ein belegter oder ungültiger
Port bricht den Start ab. Laufende Instanzen werden nicht beendet und der Start wechselt nicht
auf eine andere Adresse.

Mit `--dev` bleibt der Backendport gleich; Vite verwendet fest den Backendport plus 1000, für
`core` also 5710. Beide Ports werden vor dem Start geprüft. Ein eigenständiges `pnpm dev:web`
verwendet Port 5710 und als Proxyziel `http://localhost:4710`.

Browserprüfungen benötigen Chrome oder Chromium auf dem Rechner, auf dem der Arbeitsbereich des
Runs liegt; der Browser ist ein Modul des Executors. Auf dem Server gilt `BROWSER_EXECUTABLE_PATH`
aus der Profilsektion von `ragents.browser`, auf einem Arbeitsplatz aus dessen Umgebung, sonst der
mit `pnpm provision <profil>` beziehungsweise `pnpm provision --workspace` geholte Chromium. Auf
dem Mac kann der Pfad `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` verwendet
werden. Die Installation startet keinen Browser; dieser wird erst für einen konkreten Run geöffnet.

Die drei VS-Code-Tasks rufen Skripte unter `build/` auf: `build` (Standard) baut
Agentenlaufzeit, eingebaute Plugins, Web und Homepage, `check` prüft das Projekt und `open: homepage` baut und
öffnet die Homepage. Die entsprechenden pnpm-Befehle verwenden dieselben Skripte; gezielte
Teilbuilds bleiben über `pnpm build:agent` und `pnpm build:web` verfügbar. Jeder Web-Build
erzeugt die Homepage mit und liefert sie als Hilfe über das Fragezeichen neben Einstellungen
aus. Für separates statisches Hosting liegt dieselbe Website unter `docs/homepage/dist/`;
`pnpm generate:homepage` baut sie auch unabhängig von der Anwendung. Der Workflow
`.github/workflows/homepage.yml` baut sie bei jedem Push auf `main` neu und veröffentlicht sie
über GitHub Pages unter https://schlenkr.github.io/RAgents/.

Das Web wird statisch aus `apps/web/dist` serviert, eins für alle Profile; nach Änderungen dort
`pnpm build:web`. Der Server läuft über `tsx` aus den Quellen, Code-Änderungen greifen erst nach
Neustart. Plugins lädt er nur als Bundles: nach einer Änderung an `plugins/` gilt sie erst nach
`pnpm build:plugins` und Neustart; `scripts/start.sh` baut vor jedem Start die veralteten Plugins neu und das
Web, wenn es nicht mehr zu seinen Quellen passt (`apps/web/dist/host-web.json`), mit `--dev` die
Plugins laufend (`pnpm build:plugins --watch`), während Vite das Web aus den Quellen liefert; `tsx
watch` startet den Server nach jedem neuen Bundle neu, eine geänderte Plugin-Oberfläche greift
nach Neuladen der Seite. In einem Checkout verweigert der Server den Start, solange ein
eingebautes Bundle des Profils oder das Web nicht zu den Quellen passt, und nennt den Befehl; das
trifft `ragents run`, `ragents start`, ein direktes `pnpm start` und die VS-Code-Erweiterung mit
einem Checkout als Host, die selbst nichts bauen.

Einzeln statt `pnpm check`: je Paket `pnpm exec tsc --noEmit` (der Typecheck von `apps/server`
deckt die `server/`-Hälften der Plugins mit ab, der von `apps/web` die `web/`-Hälften); der
Browsertest des Registers und der Web-Bundles (`RAGENTS_BROWSER_TESTS=1`,
`apps/web/tests/host-modules.browser.test.ts`) läuft gegen das gebaute Web und einen echten Server;
Engine-Tests `cd packages/ragents && pnpm test`; Server-Tests
`cd apps/server && pnpm test` (baut vorher die Bundles, weil die komponierenden Tests sie laden); Lint `pnpm lint` im Root (`apps/web/src`
und `plugins/*/web`). Die Language-Server-Live-Tests (echte Server gegen `tests/fixtures/lsp`)
laufen nur auf Ansage: `pnpm provision --workspace` einmalig, dann
`RAGENTS_LSP_TESTS=1 PRODUCT_PROFILE=core pnpm test`; die Adapter finden die Server im
Werkzeugordner, `ROSLYN_LANGUAGE_SERVER` und `FSHARP_LANGUAGE_SERVER` übersteuern ihn.

Verhalten live prüfen: eine Nachricht per `POST http://localhost:<port>/rpc` mit
`{"jsonrpc":"2.0","id":1,"method":"ragents.chat.send","params":{"runId":"<uuid>","text":"..."}}`
schicken und das Journal unter `${DATA_DIR}/runs/<uuid>/` lesen. Startmodi des Servers:
`pnpm start -- --stdio` (JSON-RPC über stdin und stdout, kein Port) und `pnpm start -- --port 0`
(freier Port mit Ansage auf stdout), Details in `docs/spec/profiles.md`. Ganze Läufe
von außen anlegen, steuern und auswerten: `pnpm driver` (`scripts/driver/run-driver.ts`), Bedienung in
`docs/operations.md` unter "Drive runs from external clients".

Unter `scripts/` liegen nur die Einstiege `start.sh` und `start-vscode.sh` (VS-Code-Testinstanz
mit der Erweiterung gegen einen laufenden Server); die
übrigen Werkzeuge stehen thematisch in `scripts/homepage/` (Generator, Typprüfung und Tests der
Homepage), `scripts/driver/` (`pnpm driver`), `scripts/remote/` (`pnpm connect`),
`scripts/provision/` (`pnpm provision`), `scripts/package/` (`pnpm build:package`, `pnpm publish:package` und der
Befehl `ragents` des Pakets),
`scripts/run-transfer/` (`pnpm run-transfer`: einen Run auf einen anderen Server umziehen),
`scripts/workspace-client/` (`pnpm workspace-client`: ein Arbeitsplatz ohne VS Code),
`scripts/remote-workspace/` (`pnpm check:remote-workspace`: der Arbeitsbereich auf einem anderen
Rechner, mit Docker) und `scripts/maintenance/` (Modellkatalog, Konzept-Audit).

## Für KI-Assistenten

Besitzer ist SchlenkR. Er arbeitet auf mehreren Rechnern; verlass Dich nicht auf ein
Sitzungsgedächtnis. Alles, was eine neue Session wissen muss, steht im Repo, und zwar hier und in
den folgenden Dateien. `AGENTS.md` und `CLAUDE.md` sind nur Zeiger hierher, für Codex und
Claude Code; sie bekommen keinen eigenen Inhalt. Die `README.md` an der Wurzel ist der englische
GitHub-Einstieg und keine Quelle für Regeln.

### Pflichtlektüre in dieser Reihenfolge

1. `docs/spec/overview.md` - Leitsatz, Begriffe, Schichten, Kurs (einschmelzen statt ausbauen;
   Sicherheit nachrangig; keine Migrationen) und die verbindlichen Regeln.
2. Das Spec-Kapitel zur Aufgabe: `docs/spec/core.md` (Run, Actor, Turn, Event, Journal),
   `typescript-platform.md`, `run-modules.md` (Actor-Programme, Mini-Apps), `plugins.md`
   (Vertrag, Ordner, Web-Host, Language Server, Skill-Einstiege), `profiles.md` (Profile,
   Konfiguration).
3. `docs/decisions.md`, die obersten Einträge - was sich zuletzt geändert hat und warum.
4. `docs/operations.md` - Betrieb und Fachdetails der Plugins (Datenablage, Zugang, Bedienung
   durch Agenten und externe Clients).
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
  Offene Arbeit steht nur dort; die "Offenen Grenzen" der Spec nennen dauerhafte Grenzen und
  wiederholen keinen TODO-Eintrag.
- Sprache: Spec, `docs/operations.md`, `docs/decisions.md`, `TODO.md`, `docs/concepts/` und
  dieses Handbuch sind deutsch. Ausnahme sind die Abschnitte zwischen `<!-- guide:<id> -->` und
  `<!-- /guide:<id> -->` in Spec und `docs/operations.md`: Sie werden zum englischen Guide der
  Homepage und sind englisch, alles außerhalb der Marker ist deutsch. Ein Guide-Block umfasst
  ganze Abschnitte samt Überschrift; folgt auf ihn deutscher Text, bekommt dieser eine eigene
  deutsche Überschrift, sodass jeder Block unter einer Überschrift in seiner Sprache steht. Eine
  Überschrift mischt keine Sprachen, und dieselbe Sache steht nicht in beiden Sprachen im selben
  Kapitel. Der Guide zitiert Oberflächentexte so, wie die deutsche Oberfläche sie zeigt, mit
  englischer Umschreibung in Klammern nur dort, wo der Sinn sonst unklar bliebe. Deutscher Text
  verweist auf einen Guide-Abschnitt mit dessen englischer Überschrift. `README.md` und die
  Homepage sind englisch, Namen im Code immer (Regeln unten).
- `docs/operations.md`: Bedienung. `README.md`: der kurze englische Einstieg für GitHub und
  zugleich das README der Erweiterung im Marketplace, mit Installation, Loslegen und Links, ohne
  Fachdetails. Er wird auf Deutsch entworfen und mit
  `ragents run` (Modell GLM 5.3) ins Englische übersetzt; der deutsche Entwurf ist Arbeitsmaterial
  und liegt nicht im Repo. `docs/development.md`: Handbuch für Entwicklung und KI-Assistenten, diese Datei.
- `docs/homepage/index.html`: die Produkt-Homepage für Benutzer. Eine nüchterne Beschreibung, was
  RAgents ist und was es kann, in der Stimme der README; kein Prospekt: keine Slogans, keine
  Claim-Kacheln, keine erfundenen Beispiele. Die einzige Ausnahme sind die
  Sticker im Einstieg, und die sind Themenlinks, keine Claims. Jede Kernfunktion hat drei
  Stufen: einen Sticker (höchstens zwei Zeilen, Link auf den Abschnitt), einen Abschnitt auf der
  Hauptseite mit `data-core-feature` (Konzept, Nutzen, ein Funktionsschema, "Mehr über ..." in
  den Guide) und ein Guide-Kapitel aus markierten Abschnitten der Spec oder von
  `docs/operations.md`. Eine Fähigkeit ist erst Kernfunktion, wenn alle drei Stufen stehen;
  `pnpm check:homepage` lehnt einen Sticker ohne Abschnitt und einen Abschnitt ohne Sticker oder
  Guide-Link ab. Auf der Hauptseite steht je Fähigkeit der Nutzen als kurze Punkte (`feature-benefits`) und darunter höchstens zwei, drei Sätze zum Konzept;
  Bedienungsdetails (Knöpfe, Abstände, Pixelmaße, Speicherorte) gehören in `docs/operations.md`,
  nie auf die Hauptseite. Überschriften benennen die
  Sache (Oberfläche, leerer Chat, Agenten, Vermittler, Werkzeuge und Mini-Apps, Rückfragen und
  Dateien, Journal, Profile, Grenzen). Jeder Abschnitt nennt im HTML-Kommentar die Spec-Kapitel
  und Plugins, die ihn ändern können, und am Ende die Skill-Einstiege aus
  `plugins/ragents.reference/skills` zum Ausprobieren. Screenshots zeigen ausschließlich echte
  Läufe des Profils core unter `docs/homepage/screenshots/`. Seit 07.09.2026
  ergänzen beschriftete Funktionsschemata und Icons aus HTML/SVG die Erklärung; sie stellen
  keine echten Läufe dar. Solange keine Läufe aufgenommen werden können, sind ausdrücklich als
  solche beschriftete Bildplatzhalter zulässig. Die Seite zeigt nur, was in core läuft. Private
  Produktnamen und Integrationen erscheinen nicht auf den öffentlichen Seiten. Konzepte
  erscheinen nur im letzten Abschnitt, als Idee. Optik wie die App (Tokens und Schrift aus
  `apps/web/src/ui/theme.css`), eine Spalte, keine externen Ressourcen.
- `docs/homepage/guide.html` und `guide-*.html`: generierter Guide für Einstieg, Arbeitsweise und
  Entwicklung. Texte ausschließlich in markierten öffentlichen Abschnitten der Spec und
  `docs/operations.md` pflegen (`<!-- guide:<id> -->` bis `<!-- /guide:<id> -->`), keine zweite
  Textkopie. Kapitel und Darstellung in `scripts/homepage/homepage-guide.ts`; Build, Export und Hilfe
  verwenden denselben Generator. Neue Inhalte müssen im Profil showcase gelten, aus dem die Hilfe
  erzeugt wird.
- Der öffentliche Export unter `docs/homepage/dist/` enthält nur Produktseite, Guide und die
  konzeptionelle Mini-App. Generierte technische Dateien wie `reference.md`, `developer.md`,
  `llms.txt`, `rpc-api.md` und `openrpc.json` bleiben interne Build-Ausgaben und werden nicht
  veröffentlicht. Auch die ausführbaren Sample-Vorschauen gehören nicht zum öffentlichen Export.
- `docs/ui-drafts/`: jeder UI-Entwurf ist eine HTML-Seite mit ein bis zwei PNG-Screenshots
  daneben (headless Chrome) und einem Tab in `docs/ui-drafts/index.html`: dort von Hand einen
  `<article>`-Block ergänzen, wie im Kommentar der Datei beschrieben. Das gilt für ALLE
  bisherigen und neuen Entwurfsseiten. Pro HTML-Seite steht genau ein Tab in der Übersicht,
  neueste Sammlungen zuerst. Varianten innerhalb derselben Seite bleiben in deren eigenem Menü
  und bekommen keine doppelten Tabs oben (12.09.2026). Im Kartenraster bleibt jede
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
   verspricht nichts, was nicht in core läuft. Auf die Hauptseite kommt dabei höchstens ein
   Satz; die Bedienung im Einzelnen gehört in `docs/operations.md`, von wo der Guide sie
   übernimmt. Eine neue Kernfunktion bekommt alle drei Stufen (Sticker, Abschnitt,
   Guide-Kapitel) im selben Commit.

### Arbeiten

- Lokaler Server: Der Owner startet ihn SELBST über die VS-Code-Tasks oder `scripts/start.sh
  <profil>`. Keine Hintergrundinstanz starten, Laufzeitdaten nur auf Ansage anfassen. Belegte
  Ports brechen den Start ab; keine Ersatzports suchen oder andere Instanzen beenden. Nach
  Web-Änderungen `pnpm build:web` und "Neustart nötig" sagen; Serveränderungen greifen erst
  nach Neustart. Ausnahme: Dateien, die der Server je Aufruf als `new Worker(...)` lädt (etwa
  `packages/ragents/src/typescript/compiler-worker.ts`), greifen sofort - eine Änderung am
  Worker-Protokoll bricht laufende Runs, also nur bei gestopptem Server ändern.
- Das Secret `OPENROUTER_API_KEY` kommt aus der Shell-Umgebung: per grep aus der
  Startdatei extrahieren, NIE die Startdatei der Shell einlesen.
- Fleißarbeit (Generierungen, Seiten zusammenbauen, Prüfläufe) an Subagenten geben; das große
  Modell schneidet und entscheidet. Subagenten bekommen Zielordner im Scratchpad.

### Regeln

- NIEMALS committen, pushen oder deployen ohne ausdrückliche Erlaubnis des Owners.
- Die Dateiablage bleibt je Unterhaltung isoliert; die Übernahme eines fertigen Laufs in ein
  echtes Projekt ist Sache des Owners.
- Keine Personennamen in Doku, Entscheidungen, Selbsttest und Tests: Wünsche als Vorgabe oder mit
  "der Owner", Testbenutzer neutral (`alice`). Namen stehen nur in `LICENSE`, den `author`-Feldern
  und im Lizenzabschnitt.
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
- `docs/operations.md` - Betrieb und Fachdetails: Datenablage, Zugang, Bedienung durch Agenten
  und externe Clients
- `skills-for-agents/ragents/SKILL.md` - die Kurzanleitung, die ein fremder KI-Agent lädt, um
  RAgents lokal zu starten und ein Projekt programmieren zu lassen
- `docs/concepts/` - was noch nicht ist, je Konzept eine Datei mit Status-Zeile
- `docs/homepage/index.html` - die Produkt-Homepage für Benutzer, veröffentlicht unter
  https://schlenkr.github.io/RAgents/: was man tun kann, mit einer Scroll-Strecke für die
  Kernfunktionen, beschrifteten Funktionsschemata und technischen Vertiefungen; wird mit der Spec
  gepflegt
- [Guide](homepage/guide.html) - Einstieg, Aufbau, Zugänge (Web und VS Code), verteiltes
  Arbeiten, Modellkontext, Programme, Erweiterungen und Rechte; direkt aus öffentlichen
  Abschnitten der Spec und Betriebsdokumentation erzeugt
- [Erweiterungsleitfaden](homepage/guide-extensions.html#extension-guide) -
  Ausführungsform wählen, Fachverträge und Prompts verbinden, Lebenszyklus und Bedienung prüfen;
  die Befundgrundlage steht in `docs/spec/plugins.md`
- `docs/homepage/llms.txt`, `run-setup.md`, `reference.md`, `developer.md`, `rpc-api.md` und
  `openrpc.json` - interne generierte Text- und API-Referenzen, nicht Teil der öffentlichen Website

## Lizenz

RAgents steht unter der PolyForm Shield License 1.0.0: Verwenden und Betreiben ist erlaubt, auch
kommerziell, Ändern und Weitergeben ebenso; nicht erlaubt ist, damit ein konkurrierendes Produkt
oder einen konkurrierenden Dienst anzubieten. Der vollständige Text steht in `LICENSE`,
Rechteinhaber ist Ronald Schlenker.
