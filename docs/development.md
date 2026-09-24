# RAgents: Handbuch für Entwicklung und KI-Assistenten

Der kurze englische Einstieg für GitHub ist die `README.md`. Dieses Handbuch ist der lange,
deutsche Teil: Begriffe, Aufbau, Plugins, Profile, Konfiguration, Entwicklung und die Regeln, nach
denen hier gearbeitet und dokumentiert wird. `AGENTS.md` und `CLAUDE.md` zeigen hierher.

RAgents ist eine Werkstatt für KI-Agenten: im Browser, in VS Code und in der Konsole. Du chattest
mit einem Koordinator; der kann weitere Agenten starten und Actors mit TypeScript-Funktionen und
Mini-Apps ausstatten. Alles, was passiert, steht in einem Journal; der Zustand entsteht immer
durch Wiedergabe dieses Journals, nie durch Zwischenspeicher. Was ein Benutzer sieht und tun kann,
steht in `docs/usage.md` und auf der [Homepage](https://schlenkr.github.io/RAgents/), wie man es
installiert und betreibt in `docs/operations.md`; hier steht, wie das System gebaut ist.

## Die fünf Begriffe

Mehr braucht man nicht, um das System zu verstehen:

- **Run** - eine Arbeit. Genau ein Journal.
- **Actor** - wer im Run handelt. Drei Arten: Du (der menschliche Owner), Modell-Actors (Agenten),
  TypeScript-Actors (TypeScript).
- **ActorInput** - eine Nachricht an einen Actor. Landet in seiner Warteschlange.
- **Turn** - die Bearbeitung eines ActorInputs. Endet, sobald der Actor kein Werkzeug mehr
  aufruft. Es gibt keine Warte-Werkzeuge. Was einen Agenten während seines Turns erreicht, speist
  er vor der nächsten Modellanfrage in diesen Turn ein (Steering).
- **Event** - jede Zustandsänderung im Journal. Actors können sie abonnieren; jedes passende Event
  wird beim Abonnenten zu einem neuen ActorInput.

Ausführlicher stehen die Begriffe in `docs/spec/overview.md`.

### So sieht ein Journal aus

Eine Zeile JSON je Command-Entscheidung, append-only. Die Zeile enthält den Command, seinen
Zeitpunkt und ein Array seiner Events. `sequence` zählt über alle Events des Runs lückenlos hoch.
Das folgende Beispiel zeigt eine Zeile, wie sie in `journal.jsonl` auf der Platte steht
(Dateiformat 6), zum Lesen eingerückt; Kennungen und Hash sind gekürzt:

```json
{
  "formatVersion": 6,
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
| `apps/vscode`         | VS-Code-Erweiterung: Seiten Start, Runs und Server, Run-Panel und Mini-Apps als Webviews, Arbeitsplatz für Runs |
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
Programme und die Fläche.

Ein Modell entdeckt den aktuellen Bestand und exakte Typen über `typescript_api`. Mit
`typescript_eval` führt es kleine TypeScript-Snippets aus und ruft darin
`context.functions.<name>(input)` auf. Derselbe Zugang steht dauerhaften Actor-Programmen zur
Verfügung. Die Standardoberfläche braucht dafür nur diese beiden nativen Werkzeuge. Sie gehören zum
Server und bleiben auch ohne das optionale Actor-Programm-Plugin verfügbar.
Ein Plugin registriert mit `defineRunFunction` und `host.functions` eine gemeinsame
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
[Actor-Programme](spec/actor-programs.md) und [TypeScript-Plattform](spec/typescript-platform.md).

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
`packages/` sind Bibliotheken, gegen die Plugins gebaut werden - keine Plugins.

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
| `startEntries`    | Vorlagen der Startseite: Skills, Run-Scripts       |
| `profiles`        | Rollen (`model_list`)                              |
| `agentRuntime`    | Hooks vor Modell- und nach Werkzeugaufrufen        |
| `script`          | Capabilities für TypeScript-Actors                 |
| `operations`      | benannte Operationen, auch quer zwischen Plugins   |
| `operation`       | Griff auf eine fremde benannte Operation           |
| `invokeOperation` | eine benannte Operation aufrufen                   |
| `provide`         | einen Dienst unter einem Token bereitstellen       |
| `service`         | einen fremden Dienst über sein Token beziehen      |
| `optionalService` | einen fremden Dienst beziehen, der fehlen darf     |
| `startOptions`    | Startoptionen der Startseite, je Run eingefroren   |
| `methods`         | Methoden der Nachrichtenschicht mit Vertrag        |
| `channels`        | Kanäle mit Benachrichtigungen je Abonnement        |
| `http`            | Auslieferung: Dateien, Frames, Uploads             |
| `config`          | Konfigurationsschlüssel, streng geprüft            |
| `clientConfig`    | Werte, die das Web-Plugin sehen darf               |
| `storage`         | Ablage unter `plugins/<id>`, global und je Run     |
| `lifecycle`       | Haken bei Anlage und Löschung eines Runs           |
| `sessionMetadata` | zusätzliche Angaben zum Run                        |

### Erweiterungspunkte im Web

Ein Web-Plugin füllt Slots im Frontend (`WebPlugin` in `apps/web/src/PluginRegistry.tsx`):
`brand`, `surface`, `surfaceElements`, `cardSections`, `chatDisplayPolicy`, `startOptions`,
`needsRunView`, `SessionProvider`, `sessionHeaders`, `sessionStatus`, `overviewPanels`,
`settings`, `workspaceTabs`, `workspaceTabsFor`, `toolPresenters`, `entityPresenters`, `guides`,
`sessionMetadata`, `actionViews`, `attention`; dazu `activate` und `enabled`. `actionViews`
stellen wartende Aktionen dar, deren Payload nur das besitzende Plugin kennt. `workspaceTabs` sind feste Reiter, `workspaceTabsFor` ist eine Fabrik, die je Run
Reiter aus dem laufenden Zustand ableitet. Mini-Apps bekommen standardmäßig eine eigene
Kachel; ihre Sichtbarkeit ist im Run schaltbar, der Benutzer kann eine lokale Vollansicht öffnen.
`startOptions` liefert je serverseitiger Startoption eine eigene Bedienkomponente und ein Abzeichen
für den Kopf des laufenden Runs; ohne Komponente zeichnet der Host ein Auswahlmenü aus der
Darstellung der Option.

Ein Fachplugin besitzt seine Promptteile, Skills, Server-API, Web-Komponenten, CSS, Konfiguration
und Ablage selbst. Nimmt man es aus dem Profil, verschwinden Prompt,
Werkzeuge, Projektion, API, Reiter, CSS, Konfiguration und Run-Daten gemeinsam.

## Die Profile

Ein Profil ist genau EINE Datei: `ragents.config.<profil>.ts`. Sie nennt das Produkt
(`PRODUCT_ID`, `PRODUCT_TITLE`), die Pluginliste (`PLUGINS`) und die Konfiguration aller
beteiligten Plugins. `PRODUCT_PROFILE` wählt die Datei aus. Es gibt keinen Default; fehlt der
Wert oder die Datei, startet der Server nicht.

Im Repo liegen drei neutrale Profile:

|                      | `core`                  | `showcase`                      | `developer`                          |
| -------------------- | ----------------------- | ------------------------------- | ------------------------------------ |
| Plugins              | neutrale `ragents.*`    | wie `core` und `ragents.reference` | Arbeitsbereich, Dokumente, Sprachserver |
| Arbeitsverzeichnis   | wählbar je Run          | wählbar je Run                  | in der Regel ein Projektordner       |
| Dateiablage          | je Run                  | je Run                          | je Run                               |
| Anmeldung und Rechte | optional je Profildatei | wie `core`                      | aus, `anonymousUser` mit allen Rechten |
| Start                | `./start.sh core` (4710) | `./start.sh showcase` (4713)   | `./start.sh developer` (4715) oder `ragents run` |

`showcase` ist `core` samt den mitgelieferten Beispielen aus `ragents.reference`: 27 Skills und
6 Run-Scripts vom Wortspiel bis zur Balkon-Planung. Sie sind Lehrmaterial, deshalb bleibt `core`
als Vorlage für ein echtes Profil ohne sie. Die intern erzeugte Referenz und die eingebaute Hilfe
entstehen aus `showcase`.

`developer` ist das Programmierprofil: ein Server ohne Anmeldung auf dem eigenen Rechner, mit
C#-, F#- und TypeScript-Diagnostik. Es ist zugleich die Vorlage für ein eigenes Ad-hoc-Profil.

Ein eigenes Profil ist eine eigene `ragents.config.<name>.ts`, die auch außerhalb des Repos
liegen und ihre Plugins per Pfad nennen kann; der Start nimmt statt des Profilnamens auch den
Pfad zu einer solchen Datei.

`core` ist zugleich der gelebte Entfernungstest: läuft es ohne jedes produktspezifische Plugin,
ist die Grenze zwischen Engine und Produkt intakt. Den Arbeitsbereich eines Runs wählt die
Startoption "Arbeitsbereich" mit zwei getrennten Angaben: der Rechner (der Server oder ein
verbundener Arbeitsplatz) und der Ordner (ein neuer je Run oder ein vorhandener). Die VS-Code-Erweiterung bietet
ihre geöffneten Ordner jedem verbundenen Server als Arbeitsplatz an und belegt die Wahl bei "Neuer Run" vor; die
Arbeitswerkzeuge laufen immer dort, wo der Ordner liegt, mit demselben Executor im Server wie im
Arbeitsplatz. Ohne VS Code meldet `pnpm workspace-client <server-url> [ordner ...]` denselben
Arbeitsplatz von der Kommandozeile an. Ein KI-Agent auf demselben Rechner nimmt statt dessen
`ragents run <ordner> "<auftrag>"` mit einem vorhandenen Ordner auf dem Server; die Kurzanleitung dafür steht in
`skills-for-agents/ragents/SKILL.md`, die Befehle in
[usage.md](usage.md) unter "Control RAgents as an agent".

Eine Profildatei kann zusätzlich Benutzer mit Passwörtern und Rechten definieren.
Dann verlangt die Oberfläche eine Anmeldung und zeigt Funktionen je nach Recht verborgen,
nur lesbar oder bearbeitbar; der Server prüft dieselben Rechte. Ohne Benutzerliste bleibt die
Anmeldung aus; ein anonymer Zugang kann trotzdem eingeschränkt werden. Freie Runs und
technische Ansichten besitzen eigene Rechte. Eine Vorlagenliste begrenzt neue Runs auf
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
Relay des Servers. Betrieb in `docs/operations.md` unter "Connect to a server".

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
Stelle über die zuletzt veröffentlichte hoch und schreibt sie dorthin (unten, "Paket bauen und
veröffentlichen"). Betrieb in `docs/operations.md` unter "Work without a checkout", die Anleitung
für Plugin-Autoren im Abschnitt "Build and ship a plugin" in `docs/spec/plugins.md`.

Die Adresse ist fest: `http://localhost:4710` für `core`. Der Port steht in `host.PORT` der
Profildatei. Ein ausdrücklich gesetztes `PORT` überschreibt ihn; ein belegter oder ungültiger
Port bricht den Start ab. Laufende Instanzen werden nicht beendet und der Start wechselt nicht
auf eine andere Adresse.

Mit `--dev` bleibt der Backendport gleich; Vite verwendet fest den Backendport plus 1000, für
`core` also 5710, ein ausdrücklich gesetztes `PORT` verschiebt also beide. Beide Ports werden vor
dem Start geprüft, `start.sh` richtet `API_TARGET` auf das Backend, und mit `strictPort` weicht
Vite bei belegtem Port nicht aus. Ein eigenständiges `pnpm dev:web` verwendet Port 5710 und als
Proxyziel `http://localhost:4710`. Auch das Stylesheet kommt im Entwicklungsbetrieb vom Server und
wird je Anfrage neu kompiliert; neue Klassen im Host-Code erscheinen nach dem Neuladen.

Browserprüfungen benötigen Chrome oder Chromium auf dem Rechner, auf dem der Arbeitsbereich des
Runs liegt; die Bereitstellung steht in `docs/operations.md` unter "Browser für Browserprüfungen
bereitstellen", die echte Browserprobe unten.

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
(freier Port mit Ansage auf stdout), Details in `docs/spec/profiles.md`. Ganze Runs
von außen anlegen, steuern und auswerten: `pnpm driver` (`scripts/driver/run-driver.ts`), Bedienung in
`docs/usage.md` unter "Drive runs from external clients".

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

## Werkzeuge, Prüfläufe und Veröffentlichung

### Build- und Prüftasks in VS Code

Über `Tasks: Run Task` stehen drei Einstiege bereit. `Tasks: Run Build Task`
(Cmd+Shift+B auf macOS) startet standardmäßig `build`. Die Tasks enthalten ausschließlich
Skriptaufrufe. Die drei Skripte unter `build/` lassen sich auch aus einem anderen
Arbeitsverzeichnis starten; sie benötigen Bash und das installierte pnpm.

| Task | Skript | Zweck |
| --- | --- | --- |
| `build` | `build/build.sh` | Agentenlaufzeit, eingebaute Plugins, Web und Homepage bauen |
| `check` | `build/check.sh` | Vollständige Projektprüfung einschließlich Homepage |
| `open: homepage` | `build/homepage.sh --open` | Homepage bauen und im Standardbrowser öffnen (macOS) |

`pnpm build`, `pnpm check` und `pnpm open:homepage` verwenden dieselben Abläufe.
`pnpm generate:homepage` ruft `build/homepage.sh` ohne Option auf, `pnpm check:homepage`
verwendet `--check`. Jeder Ablauf bricht beim ersten Fehler ab; ein fehlgeschlagener
Homepage-Build öffnet keinen Browser. Geöffnet wird der statische Export unter
`docs/homepage/dist/index.html`. Die Referenzprüfung meldet veraltete Dateien, ohne sie zu
überschreiben; im Gesamtprüflauf steht sie deshalb vor dem Web-Build. Die Prüfungen des Pakets
und der Durchlauf von Verteilen, `connect` und Start (`scripts/remote/connect-start.test.ts`)
laufen danach, weil Paket und geholter Stand das gebaute Web des Hosts brauchen. Nicht im
Gesamtprüflauf, weil es `npm install` gegen die Registry braucht: `pnpm check:package` installiert
das gebaute Paket in ein eigenes Präfix, baut daraus in einem leeren Ordner ein fremdes Plugin samt
Typprüfung und startet es mit einem eigenen Profil.

Für gezielte Arbeiten bleiben `pnpm build:agent`, `pnpm build:web`, `pnpm lint` und
`pnpm test:engine` verfügbar. Sie rufen die jeweiligen Werkzeuge direkt auf. Weitere
Einzelprüfungen laufen über die Workspace-Pakete, etwa `pnpm --filter @ragents/host test`
oder `pnpm -r typecheck`. Einzelprüfungen setzen nach einem frischen Klon die installierten
Abhängigkeiten und einmal `pnpm build:agent` voraus. Den Arbeitsbereich auf einem anderen Rechner
prüft `pnpm check:remote-workspace` mit einem Linux-Container (unten, "Arbeitsbereich auf einem
anderen Rechner prüfen"); er
gehört nicht zu `pnpm check`, weil er Docker braucht.

### Homepage und erzeugte Referenzen

`docs/homepage/index.html` wird redaktionell gepflegt. Die Textfassungen `reference.md` (Bausteine
und UI-Verträge) und `developer.md` (Erweiterungspunkte mit Codebeispielen) werden aus den
neutralen Quellen erzeugt; sie sind interne Build-Ausgaben und gehören nicht zum öffentlichen
Export. `guide.html` erschließt die
erklärenden Kapitel zu Einstieg, Laufzeit, Funktionen, Programmen, Plugins und Zugriff.
Diese Texte stehen in den Spec-Kapiteln sowie in `docs/usage.md` und `docs/operations.md`:
`<!-- guide:<id> -->` und `<!-- /guide:<id> -->` markieren die öffentlichen Ausschnitte.
Mehrere Blöcke werden in ihrer Quellreihenfolge zusammengefügt. Nur diese Ausschnitte gelangen
in den Guide; seine erzeugten HTML- und Markdown-Dateien werden nicht von Hand bearbeitet.
Kapitelreihenfolge, Quelldateien und Verweise stehen in `scripts/homepage/homepage-guide.ts`; ein
Kapitel kann Blöcke aus mehreren Dateien desselben Ordners in der dort genannten Reihenfolge
zusammenfügen.
Nach einem frischen Klon sind
dafür wie für die Anwendung `pnpm install` und einmal `pnpm build:agent` erforderlich.
Die Kopfzeile in `index.html` ist zugleich die Vorlage für alle Unterseiten. Das gemeinsame
Layout und Sticky-Verhalten liegen in `site.css` und `site.js`; beide Dateien werden mit
exportiert. Die Funktionsstrecke der Hauptseite verwendet GSAP ScrollTrigger. Das lokale
`scroll-vendor.js` entsteht aus der festgelegten GSAP-Paketversion über
`scripts/homepage/homepage-motion.ts`; es wird wie die Referenzdateien erzeugt und auf Aktualität geprüft.
Die bedienbare Mini-App im Hauptabschnitt stammt aus der Referenzvorlage `shared-actor-list`.
`scripts/homepage/homepage-mini-app.ts` bündelt dessen Originalquellen mit dem lokalen Adapter aus
`docs/homepage/mini-app-runtime.ts`. Die erzeugten Dateien `mini-app.html`, `mini-app.js` und
`mini-app.css` nicht von Hand ändern; der Build übernimmt sie auch in die Hilfe.
Änderungen an Menüeinträgen erfolgen nur in der Hauptseite, danach neu erzeugen; Generator,
Typprüfung (`tsconfig.homepage.json`) und Tests liegen zusammen unter `scripts/homepage/`:

```bash
pnpm generate:homepage
pnpm check:homepage
```

Derselbe Build erzeugt unter `docs/homepage/` die LLM-Dokumentation: `llms.txt` als kleinen
Index, `guide.md` und `guide-*.md` für die erklärenden Kapitel, `run-setup.md` mit vollständigen Paketbeispielen und Testvertrag, `run-api.d.ts` mit den
generierten TypeScript-Verträgen sowie `reference.md` und `developer.md` mit den übrigen Verträgen
und Erweiterungsbeispielen. `rpc-api.md` und `openrpc.json` beschreiben die gemeinsame
JSON-RPC-API aus deren tatsächlichen Verträgen. Gib einem externen Modell die `llms.txt`; für ein Run-Setup reichen zunächst
die Setup-Anleitung und die dort verlinkte API. Diese Dateien werden generiert, nicht von Hand
bearbeitet. Neue Werkzeuge, Ergebnistypen und Paketdateien erscheinen beim nächsten Build.
Die erzeugte Referenz beschreibt showcase, keine privaten Profile oder individuellen Run-Rechte.

Der Homepage-Build erzeugt außerdem `docs/homepage/dist/`. Zum statischen Hosting wird der
Inhalt dieses Ordners hochgeladen, einschließlich JS, CSS und gegebenenfalls Screenshots. Genau
das tut der GitHub-Workflow `.github/workflows/homepage.yml`: Bei jedem Push auf `main` (und von
Hand über "Run workflow") installiert er die Abhängigkeiten, baut die Agentenlaufzeit, erzeugt die
Homepage und veröffentlicht `docs/homepage/dist/` über GitHub Pages unter
https://schlenkr.github.io/RAgents/. Voraussetzung ist einmalig in den Repository-Einstellungen
unter Pages die Quelle "GitHub Actions". Die README verlinkt diese Adresse.
Ein Backend ist dafür nicht erforderlich; auch Hosting unter einem Unterpfad ist möglich.
Links innerhalb der Website bleiben relativ, Links auf Quellcode und Repository-Dokumente
führen auf GitHub. Vorschauen, Generatorquellen und private Dateien gehören nicht zum Export.

`pnpm build:web` erzeugt die Homepage automatisch neu und übernimmt denselben Export nach
`apps/web/dist/help/`; `pnpm build` enthält diesen Schritt bereits. Das Fragezeichen neben
Einstellungen öffnet `/help/index.html` in einem großen modalen Dialog. Schließen oder Escape
führt zurück zur Anwendung; externe Quelllinks öffnen einen neuen Tab. Im Vite-Entwicklungsbetrieb wird
`/help` wie die API an den konfigurierten Server weitergereicht und zeigt dessen letzten Build.

Der zweite Befehl prüft Generator-Typen, Guide-Auszüge, die Ausschlussregeln, lokale Seiten-
und Sprungziele sowie den unveränderten Neuaufbau;
er ist auch Teil von `pnpm check`. Bei abweichenden Ausgaben die Referenz neu erzeugen. Neue
Erweiterungspunkte benötigen ein Beispiel in `scripts/homepage/homepage-extensions.ts`; die Abdeckung
wird gegen die tatsächlichen Verträge geprüft. UI-Demos werden in
`docs/homepage/reference-ui.tsx` gepflegt, ihre Props kommen aus dem öffentlichen UI-Vertrag.

Die Werkzeugerfassung komponiert ausschließlich die neutralen Plugins aus der literalen
core-Liste in einem separaten Prozess mit eigener temporärer Ablage und fest vorgegebener
Testkonfiguration. Sie startet keine Lifecycles, Modelle, Werkzeuge oder Runs. Die reale
Profilkonfiguration wird nicht ausgeführt. Private Produktnamen und lokale Pfade in den
Ausgaben brechen die Generierung ab. Die fertigen Seiten brauchen nur ihre lokalen JS-/CSS-
Dateien; die UI-Demos arbeiten im Browser ohne Backend.

### Konzept und Implementierung gegeneinander prüfen

`scripts/maintenance/concept-audit.fsx` ist ein externes Entwicklerwerkzeug für einen lesenden Abgleich
zwischen öffentlichem Guide und neutralem Code samt Tests. Es benötigt das .NET 10 SDK mit F#
Interactive und lädt `Microsoft.Agents.AI.OpenAI` in Version `1.20.0` über NuGet. Die
Modellanbindung geht über OpenRouter; der Schlüssel kommt aus `OPENROUTER_API_KEY` in der
Umgebung. Das Skript liest keine Shell-Konfiguration ein.

Der öffentliche Guide muss bereits erzeugt sein (`pnpm generate:homepage`). Ohne Modellaufruf
lassen sich Parameter und Dateikorpus prüfen; dabei entstehen das Quellenmanifest und
`status.json` mit dem Status `dry-run`:

```sh
dotnet fsi scripts/maintenance/concept-audit.fsx -- --dry-run
```

Der normale Aufruf verwendet `z-ai/glm-5.3`. Eine Frage und Grenzen lassen sich ausdrücklich setzen:

```sh
dotnet fsi scripts/maintenance/concept-audit.fsx -- --focus "Stimmen Funktionsauswahl und dokumentierte Rechte überein?" --max-calls 60 --timeout-seconds 900
```

Für Doppelimplementierungen verwendet dasselbe Skript drei Code-Prüfer für Oberfläche/CSS,
Laufzeit und Plugin-Grenzen sowie eine Zusammenführung. Dieser Modus benötigt keinen Guide
und umfasst auch produktspezifische Plugins; gelesene Ausschnitte gehen an den gewählten
Modellanbieter. Der Bericht nennt beide Implementierungen, Folgen und einen gemeinsamen Ersatz.

```sh
dotnet fsi scripts/maintenance/concept-audit.fsx -- --duplicates --reasoning-high --model z-ai/glm-5.3 --max-calls 24 --timeout-seconds 900
```

`--reasoning-high` setzt ausdrücklich `reasoning.effort` auf `high` im OpenRouter-Request.
`--model` wählt ein anderes Modell, `--repo` ein anderes Repository. `--output` muss einen neuen
Ordner außerhalb des Repositorys bezeichnen; ohne Angabe entsteht ein temporärer Ordner.
Die Vorgaben sind 60 Modellaufrufe und 900 Sekunden je Agent. Diese Grenzen gelten insgesamt
einschließlich möglicher Ergebniskorrekturen. Dieselbe Zeitfrist umfasst den Netzwerkaustausch.
Modellanfragen erlauben bis zu 16000 Ausgabetokens. Die letzte erlaubte Modellrunde
sperrt weitere Werkzeugaufrufe und fordert einen Bericht aus den bereits gelesenen Quellen.
`--endpoint` ändert die API-Adresse, standardmäßig `https://openrouter.ai/api/v1`; `--help` zeigt alle Optionen.

Die Konsole zeigt Zeitstempel und verständliche Rollennamen: Guide-Prüfer, Code-Prüfer,
Grenzfall-Prüfer und Zusammenführung. Sie meldet Phasen, Suchbegriffe und Treffer, gelesene
Dateien mit Zeilenbereichen sowie die Nummer jedes Modellaufrufs. Bei längerer Wartezeit
folgt nach 20 Sekunden eine Wartemeldung. Der Abschluss nennt Dauer, Aufrufzahl und Ergebnisordner.

Drei unabhängige Rollen lesen getrennt: `guide-reader` nur die erzeugten `guide*.md`,
`code-reader` und `boundary-reader` neutralen Code und Tests. Die anschließende Synthese
kann Belege mit denselben Lese- und Suchwerkzeugen nachprüfen. Als Ergebnis gilt die letzte
Modellantwort; Zwischenkommentare werden nicht mit ihr verkettet. Die Synthese erhält ein
JSON-Schema für `assessment`, `findings` und `openQuestions` im Konzeptmodus. Im
Duplikatmodus fordert der Prompt diese JSON-Felder; während der Werkzeugnutzung bleibt
das Antwortformat frei, damit GLM die Werkzeugaufrufe nicht als JSON-Text ausgibt. Die Bewertung erklärt auch bei
leeren Befunden, welche Prüferhinweise verworfen wurden und warum. Die Synthese muss selbst
eine Vergleichsquelle lesen, im Konzeptmodus aus dem Guide. Feldtypen, Pflichtangaben und Quellenbelege
werden vor dem Bericht geprüft. Ungültige Abschlussantworten erhalten bis zu zwei
Korrekturaufforderungen in derselben Agentensession; danach bleibt ein ungültiges Ergebnis
ein Fehler. Vorhandene Lesezugriffe und die gemeinsamen Aufruf- und Zeitlimits bleiben erhalten.
Zusammenhängende gelesene Ausschnitte dürfen gemeinsam einen Beleg abdecken; eine ungelesene
Lücke wird weiterhin abgewiesen.

Scheitert nur die Zusammenführung, übernimmt `--resume <bisheriger Ausgabeordner>` die drei
gespeicherten Prüferberichte und Lesezugriffe. Nur die Synthese wird erneut ausgeführt; sie
erhält ein neues Aufruf- und Zeitbudget. Quellenliste, Dateiinhalte, Fokus und Audit-Modus
müssen unverändert sein, sonst ist ein neuer Audit nötig. Die Ergebnisse entstehen wieder in
einem neuen Ordner; der ursprüngliche Prüflauf bleibt erhalten.

Nach erfolgreichem Modelllauf stehen im Ausgabeordner `report.md`, Rohantworten je Rolle, Aufruf- und Verbrauchsdaten sowie
`manifest.json`, `status.json` und `coverage.json` mit den tatsächlichen Lesezugriffen.
`<role>-attempt-N.txt` und `<role>-attempt-N-usage.json` erhalten jeden Versuch. `<role>.txt`
enthält die letzte Antwort; `<role>-usage.json` summiert Modellaufrufe und Verbrauch über
alle Versuche dieser Rolle.
Bei einer Fortsetzung verweist `manifest.json` unter `options.resume` auf den vorherigen Prüflauf;
dessen Verbrauchsdaten bleiben dort und werden nicht als neue Modellaufrufe gezählt.
Der Bericht ist eine begrenzte Prüfung, kein behaupteter Vollscan. Das Werkzeug ändert weder
Spec noch Implementierung automatisch und startet keine RAgents-Runs.

`python3 scripts/maintenance/concept-audit.test.py` prüft den Ablauf mit dem echten Agent Framework gegen
einen lokalen Test-Endpunkt. Dafür werden keine API-Schlüssel oder externen Modellaufrufe benötigt.

### VS-Code-Erweiterung veröffentlichen, entwickeln und prüfen

Veröffentlichen: `pnpm publish:vscode` (Task `vscode: publish`) ist ein Schritt. Es prüft den Token
mit `vsce verify-pat purestate`, fragt mit `vsce show purestate.ragents-vscode --json` die
veröffentlichten Fassungen ab, zählt die letzte Stelle der höchsten davon hoch, schreibt die neue
Fassung in `apps/vscode/package.json`, baut, packt und veröffentlicht die gepackte Datei. Die erste
Zeile der Ausgabe nennt sie: `== Fassung 0.1.2, zuletzt veröffentlicht 0.1.1`. Liegt noch nichts im
Marketplace, gilt die Fassung aus der `package.json`; steht dort schon eine höhere als die
veröffentlichte - jemand hat von Hand auf `0.2.0` gestellt -, gewinnt die `package.json`. Geschrieben
wird nur die Zeile mit `version`, der Rest der Datei bleibt Zeichen für Zeichen stehen. `--dry-run`
macht alles davon außer dem Publish, zeigt die Fassung, die es würde, ohne die `package.json` zu
ändern, und listet den Inhalt der `.vsix`. Der Token kommt aus der
Umgebungsvariable `AZURE_DEVOPS_VSCE_RAGENTS_PAT` (ein Azure-DevOps-PAT mit Marketplace-Publish für
den Herausgeber `purestate`) und geht nur als `VSCE_PAT` in die Umgebung von `vsce`, nie in eine
Ausgabe. Den Herausgeber selbst gibt es einmalig auf
https://marketplace.visualstudio.com/manage anzulegen, mit demselben Konto, dem der Token gehört;
solange er fehlt, endet `vsce verify-pat` mit `Access Denied` auf `/purestate`, und das Skript sagt
den Grund dazu. `vsce` selbst kommt über `pnpm dlx @vscode/vsce@4.0.0`, die Fassung steht in
`scripts/vscode/publish-extension.ts`. Die Fassung der Erweiterung steht in
`apps/vscode/package.json` und hängt nicht an der `version` der Wurzel, die dem npm-Paket gehört;
von Hand ist sie nur für eine neue Minor- oder Major-Fassung zu ändern. `pnpm package:vscode` packt
ohne Token und rührt die Fassung nicht an. Der Task `publish: all` (`pnpm publish:all`)
veröffentlicht erst das Paket und danach die Erweiterung und bricht beim ersten Fehler ab. Was in die `.vsix` geht, steht in `apps/vscode/.vscodeignore`: `dist/`
(ohne Sourcemaps und Testläufer), `media/`, `package.json`, `README.md`, `CHANGELOG.md` und die
`LICENSE`. Das Skript kopiert `README.md` und `LICENSE` für den Aufruf von `vsce` aus der Wurzel
daneben und entfernt die Kopien danach wieder. Das Marketplace-README und das GitHub-README haben
damit dieselbe Quelle.

Einrichtung zum Entwickeln:

1. `scripts/start-vscode.sh core` (auch ein anderes Profil oder eine Serveradresse; Task `vscode: start`)
   startet bei Bedarf den Server, baut die Erweiterung und startet eine eigene VS-Code-Instanz mit
   ihr und dem Repo als Ordner, mit einem Eintrag für diesen Server;
   Layout und Anmeldung dieser Instanz bleiben unter `~/.local/share/ragents/vscode`. Alternativ F5
   mit einer eigenen `.vscode/launch.json` (nicht eingecheckt), Typ `extensionHost` mit
   `--extensionDevelopmentPath=${workspaceFolder}/apps/vscode`, `outFiles` auf
   `${workspaceFolder}/apps/vscode/dist/**/*.js` und `preLaunchTask` `vscode: build`.
2. `pnpm --filter ragents-vscode build` baut `dist/extension.js` (esbuild, CommonJS) und
   `dist/webview`, `watch` dasselbe fortlaufend. Der Stub der Tests ist der echte Transport des
   Servers; damit dessen Module geladen werden können, ist `apps/vscode/tests/` über eine eigene
   `package.json` ein ESM-Ordner, während die gebündelte Erweiterung CommonJS bleibt.

Prüfen: `pnpm --filter ragents-vscode test` läuft ohne VS Code gegen einen Stub-Server und
gehört zu `pnpm check`; `RAGENTS_HOST_TEST_SERVER=http://localhost:4710 pnpm --filter
ragents-vscode test:host` startet das installierte VS Code mit einem temporären Benutzerordner
gegen den laufenden Server (mindestens ein Run mit Mini-App, etwa das Sammelboard aus einem
Server mit dem Profil `showcase`) und prüft
Verbindung, Run-Panel, Run-Wechsel und Mini-App in der Mitte; `RAGENTS_HOST_TEST_LOGIN=id:passwort`
beziehungsweise `RAGENTS_HOST_TEST_TOKEN=<token>` prüfen die Anmeldung.
`RAGENTS_HOST_TEST_WORKSPACE=<ordner>` prüft zusätzlich einen Run auf dem Arbeitsplatz,
`RAGENTS_HOST_TEST_SECOND=<adresse>` daneben einen zweiten Server: beide gleichzeitig verbunden, die
Start-Seite mit beiden, der Arbeitsplatz bei beiden Servern angemeldet, ein Klick auf eine Vorlage, der
Zurück-Pfeil auf die Start-Seite, das Löschen eines Runs, das Plus eines Servers als leerer Run
und ein Trennen, das nur eines trifft. `RAGENTS_HOST_TEST_VSIX=<pfad>` prüft statt des
Checkouts die gepackte Erweiterung: der Läufer entpackt die Datei in seinen Benutzerordner und
lädt `extension/` daraus, also genau das, was auch installiert wird - ohne `node_modules`
daneben. Mit `RAGENTS_HOST_TEST_SETTINGS=1` prüft der Läufer die Einstellungsseite ohne
Host-Pfad; kommt dabei `RAGENTS_HOST_PACKAGE_SPEC=<pfad zur .tgz>` dazu, holt die Erweiterung
ihren Host aus dieser Datei statt von npm und startet damit das lokale Profil aus
`RAGENTS_HOST_TEST_PROFILE`. Die Übersteuerung gibt es nur für diesen Test; im Alltag ist der
Bezeichner immer `@schlenkr/ragents@<fassung>`. Ohne VS Code prüft `apps/vscode/tests/extension-bundle.test.ts` dasselbe in klein: das
gebaute `dist/extension.js` liegt in einem leeren Temp-Ordner, ein Kindprozess ruft `activate`
mit einem Stub-`vscode` auf.

### Paket bauen und veröffentlichen

Gebaut wird das Paket aus dem, was der Host wirklich lädt; die Abhängigkeiten bestimmt der Build
aus den Importen der aufgenommenen Dateien und den Bibliotheken, die die Actor-Programme zur
Laufzeit verlinken. Gibt es ein Paket im Checkout in zwei Fassungen, nennt das Paket eine davon
und der Build sagt, welche.

Die Fassung des Pakets ist das Feld `version` in der `package.json` der Repository-Wurzel.
`pnpm publish:package` ist ein Schritt: es fragt mit `npm view @schlenkr/ragents versions --json`
die veröffentlichten Fassungen ab, zählt die letzte Stelle der höchsten davon hoch, schreibt die
neue Fassung in die `package.json` der Wurzel, baut das Paket und veröffentlicht es auf npm:

```sh
pnpm publish:package --dry-run   # Probelauf: nennt die Fassung, baut, prüft und zeigt den Tarball
pnpm publish:package             # erhöht die Fassung und veröffentlicht
```

Die erste Zeile der Ausgabe nennt die Fassung: `== Fassung 0.1.2, zuletzt veröffentlicht 0.1.1`.
Liegt noch nichts auf npm, gilt die Fassung aus der `package.json`; steht dort schon eine höhere
als die veröffentlichte - jemand hat von Hand auf `0.2.0` gestellt -, gewinnt die `package.json`.
Geschrieben wird nur die Zeile mit `version`, der Rest der Datei bleibt Zeichen für Zeichen
stehen. Der Probelauf zeigt die Fassung, die es würde, und ändert die Datei nicht.

Der Token kommt aus der Umgebungsvariable `npm_key` und geht als Registrierungsschlüssel in die
Umgebung des `npm`-Kindprozesses; er steht in keiner Datei und in keiner Ausgabe. Fehlt er,
bricht der Aufruf ab. Abgelehnt wird weiterhin eine Fassung, die auf npm schon liegt - nach dem
Hochzählen kann das nicht mehr passieren, die Prüfung bleibt trotzdem stehen. Nach dem Publish
nennt das Script die veröffentlichte Fassung; die Registrierung braucht danach noch ein paar
Sekunden, bis sie sie ausliefert und anzeigt. Die VS-Code-Tasks `package: build` und
`package: publish` rufen dieselben Skripte, `publish: all` (`pnpm publish:all`) veröffentlicht
Paket und Erweiterung nacheinander und bricht beim ersten Fehler ab; `npm_key` kommt dort aus der
Umgebung von VS Code.

### Echte Browserprobe

Die gezielte echte Browserprobe startet nur eine kurzlebige lokale Fixture und schreibt nach
Temp: `RAGENTS_BROWSER_TESTS=1 PRODUCT_PROFILE=core pnpm --filter @ragents/host exec node
--import tsx --test tests/browser-live.test.ts`. `BROWSER_EXECUTABLE_PATH` kann für diesen
Aufruf als Umgebungsvariable gesetzt werden. Die regulären Serverprüfungen enthalten die
Browser-Vertrags- und Lifecycle-Tests; die echte Browserprobe benötigt die ausdrückliche Flagge.

### Arbeitsbereich auf einem anderen Rechner prüfen

Ob ein Run wirklich auf einem anderen Rechner arbeitet, prüft `pnpm check:remote-workspace` auf
einem Mac mit OrbStack oder Docker Desktop. Ein Linux-Container ist der fremde Rechner: eigenes
Dateisystem, eigene Prozesstabelle, eigenes `localhost`, andere Plattform; darin läuft
`ragents workspace-client` aus dem gebauten Paket als Arbeitsplatz von `alice`. Der Server läuft auf
diesem Rechner mit `--port 0`, eigenem Datenordner unter `/tmp` und einem Prüfprofil mit `alice`,
`bob` und `admin`; statt eines Sprachmodells steuert ein Skriptmodell die Werkzeuge, ohne Cloud und
ohne Zufall. Der Läufer schreibt je Prüfung eine Zeile `ok`, `FEHLER` mit Ursache oder `--`:
Anmeldung und Sichtbarkeit des Arbeitsplatzes, Bindung, `bash`, `read`, `write` und ein binärer
Anhang im Container, `typescript_eval` im Ordner des Servers, Systemprompt mit Plattform und Ordner
des Arbeitsplatzes, Reiter Dateien, Prozessanzeige und Beenden, Rechte von `bob` und `admin`, der
Not-Aus samt Aufräumen auf beiden Rechnern, Trennen und Wiederanmelden, ein Stopp, während der
Container kein Netz hat, der nach der Rückkehr greift. Schalter:
`--shared-path` legt denselben Pfad mit anderem Inhalt auch auf diesem Rechner an (statt
`/work/project`, den es hier nicht geben darf), `--browser` öffnet mit `browser_open` eine Seite,
die nur auf `localhost` im Container läuft, `--vscode` fährt zusätzlich den Host-Test der
Erweiterung in einem eigenen VS-Code-Fenster gegen denselben Server. Der Läufer beendet nur, was er
selbst gestartet hat: Server und VS-Code-Launcher über ihre eigene PID, Container und Images nur
über seine Labels, Prozesse dieses Rechners nur mit einem Run-Marker seines Servers oder seiner
Sitzungsmarkierung; Reste eines abgebrochenen Prüflaufs räumt der nächste zu Beginn ab. Der erste
Image-Bau braucht Netz (Node-Image, npm, mit `--browser` Chromium aus Debian); danach kommen diese
Schichten aus dem Cache, und nur das Paket wird neu gebaut. Nach einem Fehlschlag bleiben die
Protokolle unter `/tmp/ragents-rwc-protokoll-<sitzung>`. Einzelheiten stehen in
`scripts/remote-workspace/README.md`.

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
   `typescript-platform.md`, `actor-programs.md` (Actor-Programme, Mini-Apps), `plugins.md`
   (Vertrag, Ordner, Web-Host, Language Server, Skill-Vorlagen), `profiles.md` (Profile,
   Konfiguration).
3. `docs/decisions.md`, die obersten Einträge - was sich zuletzt geändert hat und warum.
4. `docs/usage.md` - Bedienung in Web, Run-Panel, VS Code und durch Agenten und externe Clients;
   `docs/operations.md` - Betrieb (Installation, Start, Zugang, Paket, verteiltes Arbeiten,
   Datenablage).
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
- Sprache: Spec, `docs/usage.md`, `docs/operations.md`, `docs/decisions.md`, `TODO.md`,
  `docs/concepts/` und dieses Handbuch sind deutsch. Ausnahme sind die Abschnitte zwischen
  `<!-- guide:<id> -->` und `<!-- /guide:<id> -->` in Spec, `docs/usage.md` und
  `docs/operations.md`: Sie werden zum englischen Guide der
  Homepage und sind englisch, alles außerhalb der Marker ist deutsch. Ein Guide-Block umfasst
  ganze Abschnitte samt Überschrift; folgt auf ihn deutscher Text, bekommt dieser eine eigene
  deutsche Überschrift, sodass jeder Block unter einer Überschrift in seiner Sprache steht. Eine
  Überschrift mischt keine Sprachen, und dieselbe Sache steht nicht in beiden Sprachen im selben
  Kapitel. Der Guide zitiert Oberflächentexte so, wie die deutsche Oberfläche sie zeigt, mit
  englischer Umschreibung in Klammern nur dort, wo der Sinn sonst unklar bliebe. Deutscher Text
  verweist auf einen Guide-Abschnitt mit dessen englischer Überschrift. `README.md` und die
  Homepage sind englisch, Namen im Code immer (Regeln unten).
- `docs/usage.md`: Bedienung, also was ein Benutzer oder ein Agent als Benutzer sieht und tut.
  `docs/operations.md`: Betrieb, also Installation, Start, Zugang, Paket, verteiltes Arbeiten mit
  Server, Arbeitsplatz und Run-Umzug, Windows und Datenablage. Vertrag und Mechanik stehen in der
  Spec, Build, Prüfläufe und Veröffentlichung hier im Handbuch; `usage.md` und `operations.md`
  verweisen darauf statt sie zu wiederholen. `README.md`: der kurze englische Einstieg für GitHub und
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
  den Guide) und ein Guide-Kapitel aus markierten Abschnitten der Spec, von `docs/usage.md` oder
  `docs/operations.md`. Eine Fähigkeit ist erst Kernfunktion, wenn alle drei Stufen stehen;
  `pnpm check:homepage` lehnt einen Sticker ohne Abschnitt und einen Abschnitt ohne Sticker oder
  Guide-Link ab. Auf der Hauptseite steht je Fähigkeit der Nutzen als kurze Punkte (`feature-benefits`) und darunter höchstens zwei, drei Sätze zum Konzept;
  Bedienungsdetails (Knöpfe, Abstände, Pixelmaße, Speicherorte) gehören in `docs/usage.md`,
  nie auf die Hauptseite. Überschriften benennen die
  Sache (Oberfläche, leerer Chat, Agenten, Vermittler, Werkzeuge und Mini-Apps, Rückfragen und
  Dateien, Journal, Profile, Grenzen). Jeder Abschnitt nennt im HTML-Kommentar die Spec-Kapitel
  und Plugins, die ihn ändern können, und am Ende die Skill-Vorlagen aus
  `plugins/ragents.reference/skills` zum Ausprobieren. Screenshots zeigen ausschließlich echte
  Runs des Profils core unter `docs/homepage/screenshots/`. Seit 07.09.2026
  ergänzen beschriftete Funktionsschemata und Icons aus HTML/SVG die Erklärung; sie stellen
  keine echten Runs dar. Solange keine Runs aufgenommen werden können, sind ausdrücklich als
  solche beschriftete Bildplatzhalter zulässig. Die Seite zeigt nur, was in core läuft. Private
  Produktnamen und Integrationen erscheinen nicht auf den öffentlichen Seiten. Konzepte
  erscheinen nur im letzten Abschnitt, als Idee. Optik wie die App (Tokens und Schrift aus
  `apps/web/src/ui/theme.css`), eine Spalte, keine externen Ressourcen.
- `docs/homepage/guide.html` und `guide-*.html`: generierter Guide für Einstieg, Arbeitsweise und
  Entwicklung. Texte ausschließlich in markierten öffentlichen Abschnitten der Spec,
  `docs/usage.md` und `docs/operations.md` pflegen (`<!-- guide:<id> -->` bis `<!-- /guide:<id> -->`), keine zweite
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
   Fähigkeit, eine Skill-Vorlage), bringst du den betroffenen Abschnitt der Homepage im selben
   Commit mit; veraltete Screenshots nimmst du neu auf oder nimmst sie heraus. Die Homepage
   verspricht nichts, was nicht in core läuft. Auf die Hauptseite kommt dabei höchstens ein
   Satz; die Bedienung im Einzelnen gehört in `docs/usage.md`, von wo der Guide sie
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
- Die Dateiablage bleibt je Run isoliert; die Übernahme eines fertigen Runs in ein
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
- `docs/usage.md` - Bedienung: Web, Run-Panel, VS-Code-Erweiterung, globaler Koordinator,
  Bedienung durch Agenten und externe Clients
- `docs/operations.md` - Betrieb: Installation, Start, Zugang, Paket, Server und Arbeitsplatz,
  Run-Umzug, Windows, Datenablage
- `skills-for-agents/ragents/SKILL.md` - die Kurzanleitung, die ein fremder KI-Agent lädt, um
  RAgents lokal zu starten und ein Projekt programmieren zu lassen
- `docs/concepts/` - was noch nicht ist, je Konzept eine Datei mit Status-Zeile
- `docs/homepage/index.html` - die Produkt-Homepage für Benutzer, veröffentlicht unter
  https://schlenkr.github.io/RAgents/: was man tun kann, mit einer Scroll-Strecke für die
  Kernfunktionen, beschrifteten Funktionsschemata und technischen Vertiefungen; wird mit der Spec
  gepflegt
- [Guide](homepage/guide.html) - Einstieg, Aufbau, Zugänge (Web und VS Code), verteiltes
  Arbeiten, Modellkontext, Programme, Plugins und Rechte; direkt aus öffentlichen
  Abschnitten der Spec, der Bedienung und des Betriebs erzeugt
- [Plugin-Leitfaden](homepage/guide-plugins.html#plugin-guide) -
  Ausführungsform wählen, Fachverträge und Prompts verbinden, Lebenszyklus und Bedienung prüfen;
  die Befundgrundlage steht in `docs/spec/plugins.md`
- `docs/homepage/llms.txt`, `run-setup.md`, `reference.md`, `developer.md`, `rpc-api.md` und
  `openrpc.json` - interne generierte Text- und API-Referenzen, nicht Teil der öffentlichen Website

## Lizenz

RAgents steht unter der PolyForm Shield License 1.0.0: Verwenden und Betreiben ist erlaubt, auch
kommerziell, Ändern und Weitergeben ebenso; nicht erlaubt ist, damit ein konkurrierendes Produkt
oder einen konkurrierenden Dienst anzubieten. Der vollständige Text steht in `LICENSE`,
Rechteinhaber ist Ronald Schlenker.
