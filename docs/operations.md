# Betrieb und Fachdetails

Was die Plugins im laufenden Betrieb tun und was man wissen muss, um sie zu bedienen. Wie das
System aufgebaut ist, steht in `docs/spec/`; das Warum in `docs/decisions.md`.

<!-- guide:getting-started -->
## Use the tile workspace

A run's workspace consists of tiles. Each tile shows an actor or mini-app, and together they
fill the available space. There is no panning or zooming. Tiles use flat surfaces, outlines,
and rounded corners without depth. Mini-app content appears at its original size both in the
tile and in full view.

Drag an actor or mini-app from the header onto one of a tile's docking targets. Left and right
create a side-by-side split; top and bottom create a vertical split. Targets at the outer edge
split the entire workspace. Before you release, a preview shows the resulting area. Drag an
existing tile by its title bar; the X removes it from the layout. Its content remains available
through the header. Without access to the actors view, removal and reordering are disabled: the
X and drag handle are hidden. Dividers for adjusting size ratios remain available.

Drag a divider to the desired ratio; releasing it saves the value. Escape cancels the active
resize. With keyboard focus on a divider, arrow keys change its size while Home and End set the
allowed limits. When space is tight, the "Sichtbare Kachel" (visible tile) selector displays one item at a time
without discarding the layout. You can also ask the coordinator: "App on the left, chat on the
right, 50:50" or "One tile on top, two below at a 2:1 ratio." Until a layout is specified, the
workspace arranges visible participants itself. Your changes remain saved until the program
changes its layout. A new program layout is applied automatically so added tiles appear at
once. "Programmvorgabe übernehmen" (apply program layout) in the status bar can reset your own layout earlier.

## Install locally

The application is built from the repository with Node.js and pnpm. Run these commands from
the repository root:

```sh
pnpm install
pnpm build:agent
pnpm provision core
```

The second command generates type declarations for the agent runtime and is required after a
fresh clone. The third downloads the tools required by the profile's plugins, such as language
servers and the browser, to `<data-directory>/tools/<plugin-id>/`. For each plugin it reports
`ready`, `installed`, or `missing: <reason>`; a missing prerequisite explains what must be done
manually, such as installing `dotnet`. Running it again downloads nothing unnecessarily. The
`core` profile contains the neutral workspace with chat, agents, TypeScript functions, and
mini-apps. Its settings are in `ragents.config.core.ts`. A profile selects plugins, models, and
configuration; it is not a single agent task. `showcase` (`ragents.config.showcase.ts`) is the
same profile plus the included examples. `pnpm provision showcase` installs its tools in its
own data directory.

## Configure model access and start

The model integration uses OpenRouter. In the profile file's `ragents.product` section,
configure `OPENROUTER_API_KEY` as a reference to your own environment variable, for example
`env("RAGENTS_MODEL_API_KEY")`, and provide its value in your shell or service environment. The
included `core`, `showcase`, and `developer` profiles use `env("OPENROUTER_API_KEY")` and expect
that exact environment variable. Startup fails if it is missing. Existing environment variables
take precedence over profile values; no `.env` file is loaded. Startup reports a missing
referenced variable as an error. Configured models and reasoning levels must be valid in the
available model catalog.

Alternatively, a profile can obtain its models from another RAgents server running the
`ragents.model-relay` plugin with `RELAY_MODELS`: set `AGENT_PROVIDER: "relay"`, point
`RELAY_URL` to that server, use `RELAY_TOKEN: env("...")` with a user's personal token there,
and use relay aliases for every model key. Only the relay server can see which model is behind
an alias. Its log at `plugins/ragents.model-relay/relay.log` records the user, alias, target,
and token count for each request.

Then start the neutral profile:

```sh
scripts/start.sh core
```

The script builds the plugins, builds the web application and help if they are missing or
outdated, then starts the server. The interface is
available at `http://localhost:4710`; runtime data is stored in
`~/.local/share/ragents/core`. `PORT` and `DATA_DIR` can override these defaults.
`scripts/start.sh showcase` starts the same profile with examples on port 4713 and stores data
in `~/.local/share/ragents/showcase`; both can run side by side. Without a user list, sign-in is
disabled. [Users and permissions](homepage/guide-access.html) explains how to configure access.
Additional language servers must be installed separately for their diagnostic functions; the
first chat message does not start them.

The fixed server port is configured as `host.PORT` in the profile file. If it is occupied,
startup fails. The address stays fixed and a running instance is not terminated. An explicitly
set `PORT` must be between 1 and 65535; 0 is invalid. The final server message displays the URL.
A warning about JavaScript bundle size does not prevent startup.

With `scripts/start.sh core --dev`, the backend runs on 4710 and Vite on 5710. The script checks
both fixed ports first and points `API_TARGET` at the backend. Vite always uses the backend port
plus 1000, so an explicitly set `PORT` moves both. With `strictPort`, Vite does not switch
to another port when its port is occupied. A standalone `pnpm dev:web` uses port 5710 and
`http://localhost:4710` as its proxy target. In dev mode, Vite serves the host interface from its
sources with hot reload, while plugin interfaces come from the server as bundles, rebuilt by
`pnpm build:plugins --watch`; a changed plugin interface appears after reloading the page. The
stylesheet also comes from the server and is recompiled on every request, so new classes in host
code appear after a reload.

## Create your first run

The top-left corner opens the run overview. Choose "Neuer Run" to open the start selection. It
contains skills with editable tasks and run scripts with programmed setups. The preview shows
the selected entry. Before starting, you can discuss an adopted skill task in the preparation
chat. Give a clear go-ahead such as "Start", or choose "Run erstellen" (create run). Merely confirming a detail
does not start anything. Some entries collect values in a setup dialog first.

Inside the run, the coordinator processes the task. Additional agents and mini-apps appear in
the workspace when the workflow creates them. The global coordinator in the header has its own
conversation and can oversee several runs. The journal and "Executions" tab make events and
TypeScript calls traceable.

## Build after changes

Server changes take effect after a restart. There is one web interface for every profile, built
with the host into `apps/web/dist`; plugin interfaces are loaded at runtime from the plugin bundles
of the running profile. `scripts/start.sh` rebuilds outdated plugins before every start and the web
interface only when it is missing or no longer matches its sources, so restarting is enough after
changes. `pnpm build:web` builds it directly. Started any other way from a checkout (`pnpm start`,
`ragents run`, `ragents start`, the VS Code extension), the server refuses outdated built-in
bundles or an outdated interface and names `pnpm build:plugins` or `pnpm build:web`.
`pnpm check` runs the project checks, including tests, type checking, and the web build.
`pnpm build:package` creates the host as an npm package for machines without a checkout, and
`pnpm publish:package` publishes it (see Work without a checkout). The question mark next to
Settings opens the included help. For separate static hosting, `pnpm generate:homepage` creates
the same website under `docs/homepage/dist`.
<!-- /guide:getting-started -->

## TypeScript-Funktionen und Snippets

Der Run-Koordinator, globale Koordinator und berechtigte Fachagenten erhalten automatisch alle
für sie verfügbaren TypeScript-Funktionen mit Name und Kurzbeschreibung. Der Bestand bleibt
auch während eines Turns aktuell. Reine LLMs mit `tools: []` erhalten keine Übersicht.
`typescript_api` lädt Details nach. Suche und Snippet-Ausführung gehören zur Server-Grundausstattung, auch
ohne das optionale Actor-Programm-Plugin.
Ohne Funktionsauswahl liefert es den Katalog mit Kurzbeschreibungen; mit Namen liefert es
genaue TypeScript-Verträge, vorhandene Langbeschreibungen und passende Anleitungen. `typescript_eval` führt genau `code` oder `path` aus. Der Quelltext ist
der Rumpf einer asynchronen Funktion mit `context`, zum Beispiel
`return await context.functions.actor_list({});`. Dateiwerkzeuge bearbeiten längere Quellen.

Ein Snippet benötigt keinen eigenen Actor. Es handelt als sein Aufrufer und verwendet die
für diesen verfügbaren Funktionen. Dauerhafte Actor-Programme verwenden dieselbe API in
`onInput` und ihren Funktionen; ihre deklarierten `capabilities` wählen die benötigten Namen.
`onInput` handelt als Actor, eine veröffentlichte Funktion besitzt dessen Zustand und handelt
bei weiteren Run-Aufrufen als ihr Aufrufer. Eigene Ereignisabos richtet ein Actor in `onInput` ein.

Plugins registrieren eine typisierte Funktion einmal mit `defineRunFunction` und
`host.functions`. `description` beschreibt knapp den Zweck; zusätzliche Regeln und Beispiele
stehen optional in `longDescription`. `label` benennt die Funktion für Menschen.
`nativeTool: true` ergänzt bei Bedarf eine native Werkzeugdarstellung.
Nach einem fehlgeschlagenen Snippet vorhandene Actors und Subscriptions prüfen: vorherige
Funktionsaufrufe werden nicht zurückgerollt. Typfehler vor Ausführung, ein Laufzeitfehler und
ein verletzter fachlicher Auftrag sind unterschiedliche Befunde.

## Build- und Prüftasks in VS Code

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
prüft `pnpm check:remote-workspace` mit einem Linux-Container (Abschnitt Session-Isolation); er
gehört nicht zu `pnpm check`, weil er Docker braucht.

## Konzept und Implementierung gegeneinander prüfen

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
einem neuen Ordner; der ursprüngliche Lauf bleibt erhalten.

Nach erfolgreichem Modelllauf stehen im Ausgabeordner `report.md`, Rohantworten je Rolle, Aufruf- und Verbrauchsdaten sowie
`manifest.json`, `status.json` und `coverage.json` mit den tatsächlichen Lesezugriffen.
`<role>-attempt-N.txt` und `<role>-attempt-N-usage.json` erhalten jeden Versuch. `<role>.txt`
enthält die letzte Antwort; `<role>-usage.json` summiert Modellaufrufe und Verbrauch über
alle Versuche dieser Rolle.
Bei einer Fortsetzung verweist `manifest.json` unter `options.resume` auf den vorherigen Lauf;
dessen Verbrauchsdaten bleiben dort und werden nicht als neue Modellaufrufe gezählt.
Der Bericht ist eine begrenzte Prüfung, kein behaupteter Vollscan. Das Werkzeug ändert weder
Spec noch Implementierung automatisch und startet keine RAgents-Runs.

`python3 scripts/maintenance/concept-audit.test.py` prüft den Ablauf mit dem echten Agent Framework gegen
einen lokalen Test-Endpunkt. Dafür werden keine API-Schlüssel oder externen Modellaufrufe benötigt.

## Homepage und erzeugte Referenzen

`docs/homepage/index.html` wird redaktionell gepflegt. Die Textfassungen `reference.md` (Bausteine
und UI-Verträge) und `developer.md` (Erweiterungspunkte mit Codebeispielen) werden aus den
neutralen Quellen erzeugt; sie sind interne Build-Ausgaben und gehören nicht zum öffentlichen
Export. `guide.html` erschließt die
erklärenden Kapitel zu Einstieg, Laufzeit, Funktionen, Programmen, Erweiterungen und Zugriff.
Diese Texte stehen in den bestehenden Spec-Kapiteln und hier in der Betriebsdokumentation:
`<!-- guide:<id> -->` und `<!-- /guide:<id> -->` markieren die öffentlichen Ausschnitte.
Mehrere Blöcke werden in ihrer Quellreihenfolge zusammengefügt. Nur diese Ausschnitte gelangen
in den Guide; seine erzeugten HTML- und Markdown-Dateien werden nicht von Hand bearbeitet.
Kapitelreihenfolge und Verweise stehen in `scripts/homepage/homepage-guide.ts`.
Nach einem frischen Klon sind
dafür wie für die Anwendung `pnpm install` und einmal `pnpm build:agent` erforderlich.
Die Kopfzeile in `index.html` ist zugleich die Vorlage für alle Unterseiten. Das gemeinsame
Layout und Sticky-Verhalten liegen in `site.css` und `site.js`; beide Dateien werden mit
exportiert. Die Funktionsstrecke der Hauptseite verwendet GSAP ScrollTrigger. Das lokale
`scroll-vendor.js` entsteht aus der festgelegten GSAP-Paketversion über
`scripts/homepage/homepage-motion.ts`; es wird wie die Referenzdateien erzeugt und auf Aktualität geprüft.
Die bedienbare Mini-App im Hauptabschnitt stammt aus dem Referenzeinstieg `shared-actor-list`.
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
Erweiterungsflächen benötigen ein Beispiel in `scripts/homepage/homepage-extensions.ts`; die Abdeckung
wird gegen die tatsächlichen Verträge geprüft. UI-Demos werden in
`docs/homepage/reference-ui.tsx` gepflegt, ihre Props kommen aus dem öffentlichen UI-Vertrag.

Die Werkzeugerfassung komponiert ausschließlich die neutralen Plugins aus der literalen
core-Liste in einem separaten Prozess mit eigener temporärer Ablage und fest vorgegebener
Testkonfiguration. Sie startet keine Lifecycles, Modelle, Werkzeuge oder Runs. Die reale
Profilkonfiguration wird nicht ausgeführt. Private Produktnamen und lokale Pfade in den
Ausgaben brechen die Generierung ab. Die fertigen Seiten brauchen nur ihre lokalen JS-/CSS-
Dateien; die UI-Demos arbeiten im Browser ohne Backend.

## Runs wechseln

Die quadratische Ecke links oben in der Kopfzeile (oder `Cmd+I` auf macOS beziehungsweise
`Ctrl+I`) öffnet die Run-Übersicht als modalen Dialog unter der Kopfzeile einschließlich der
unteren Statusleiste. Die Kopfzeile bleibt bedienbar. Die Run-Karten zeigen
Titel, Bearbeitungsstatus, Erstellungsdatum mit Uhrzeit, letzte Aktualisierung und ergänzende Plugin-Angaben. Die Karten sind nach
letzter Aktivität in Heute, Gestern und weitere Tage gruppiert; Blau kennzeichnet laufende
Arbeit, ein violetter Hinweis neue Aktivität seit dem letzten Ansehen, und dieser persönliche
Lesestand gilt je Benutzer in diesem Browser. Die Auswahl
öffnet den Run und schließt die Übersicht. Ein erneuter Klick auf die Ecke, Escape oder ein
Klick auf den abgedunkelten Hintergrund schließen sie mit Rückgabe des Fokus zur Ecke.
"Neuer Run" in der Run-Leiste wechselt zum Startdialog. Erstellen sowie Einzel- und
Mehrfachlöschen erscheinen abhängig von deinen Rechten; die Mehrfachauswahl bietet Alle, Keine
und eine Löschbestätigung. Gelöschte Runs verschwinden sofort aus der Liste; das Aufräumen
(Prozesse, Arbeitsverzeichnis, Archiv) erledigt der Server danach im Hintergrund. Fehler bleiben
sichtbar. Lange Listen lassen sich scrollen.
Solange kein fertiger automatischer Titel vorliegt, zeigt die Run-Liste den ursprünglichen
Auftrag. Nach erfolgreicher Erzeugung und Speicherung erscheint die kurze Überschrift, ohne
auf den nächsten regelmäßigen Listenabruf zu warten. Bei deaktivierter oder fehlgeschlagener
Erzeugung bleibt der Auftrag sichtbar. Bewusst im Run oder Setup gesetzte Titel haben Vorrang;
eine andere Modellauswahl benennt vorhandene Titel nicht neu.

Der globale Koordinator steht unabhängig davon direkt in der Kopfzeile. Das Öffnen der
Run-Übersicht schließt seinen Verlauf, erhält aber Gespräch, Entwurf und Anhänge.

## Run-Chat und Arbeitsfläche

Die schmale Statusleiste am unteren Fensterrand reicht über die ganze Anwendungsbreite. Sie
trägt `Journal` und, sobald Du selbst etwas umgeordnet hast, "Programmvorgabe übernehmen".
Gespräche stehen in den Kacheln und in den
Actor-Pop-outs. Der Run-Koordinator ist standardmäßig nur in der Actor-Leiste über der Fläche
erreichbar. Ein Klick auf seinen Eintrag öffnet den Chat als Pop-out darunter. Diese
Chatansichten sind bis zu 784 Pixel breit und passen sich bei schmalen Fenstern an. Andere
LLM-Einträge öffnen ihren Chat, TypeScript-Einträge ihre Actor-Ansicht. Ein erneuter Klick,
Escape, Außenklick oder das X im Pop-out-Kopf schließt die Fläche; ungesendete Texte bleiben
beim Schließen und Actor-Wechsel erhalten. Über die Actorliste kannst Du ihm zusätzlich eine
eigene Kachel geben. In der Ansichtsleiste wählt die Sprechblase den Verlauf, die anderen
Symbole jeweils eine Detailansicht. Der Code-Reiter zeigt bei Actors mit installiertem Programm
die TypeScript-Quellen und übrigen Dateien dieses Stands, mit Dateiauswahl und Syntaxhervorhebung.
Das gilt auch für TypeScript-Actors ohne Mini-App oder veröffentlichte Funktionen. Dafür
werden die technischen Leserechte benötigt.
Links in der Leiste über der Fläche schaltet `Anzeige` zwischen `Alle`, `Aktive`, `Sichtbare`,
`LLM-Agenten` und `TypeScript`, ohne seine Breite zu ändern. Standard ist `Aktive`;
`Alle` zeigt zusätzlich gestoppte Actors. Solange kein Actor gestoppt ist, sehen beide gleich aus.
`Sichtbare` zeigt nur Actors, die gerade eine Kachel haben, und immer den
primären Actor. Die beiden Typfilter zeigen auch gestoppte Actors
des jeweiligen Typs. Actorliste und Chats öffnen mit demselben Abstand direkt unter dem Knopf.
Das ändert nur die direkten Actor-Zugänge und verändert die Aufteilung nicht.
Die Auswahl bleibt je Run im Browser gespeichert. Unter `Actors` findest Du immer die
vollständige Liste. Knöpfe geöffneter Flächen bleiben sichtbar gedrückt.
Der Nachrichtenentwurf bleibt beim Wechsel erhalten. Im Chat des primären Actors bleibt
`Run stoppen` mit Bestätigung erreichbar.

`Journal` in der Statusleiste öffnet darüber die tatsächlichen Ereignisse des Runs.
Die neuesten stehen zuerst; die Suche findet Ereignisinhalte und Actor-Handles. Ein Eintrag
lässt sich zum vollständigen JSON aufklappen. Zunächst sind 100 Treffer sichtbar, weitere
lassen sich nachladen. Die offene Ansicht folgt Änderungen des Runs und bietet Aktualisieren.
Außenklick oder Tab aus der Fläche schließen sie; Escape und X geben den Fokus an Journal zurück.

`Actors` in der Leiste über der Fläche listet alle Beteiligten auf, auch dich und gestoppte
Actors. Klicke auf einen Namen eines KI- oder TypeScript-Actors, um rechts dessen Chat und
Details zu öffnen; eine Kachel entsteht dadurch nicht.

Rechts an jedem Eintrag steht die Checkbox `Canvas`. Ohne eigene Wahl stehen der Hauptactor und
Actors mit eigener Mini-App nicht auf der Fläche; so braucht die App keinen zusätzlichen Platz
für ihren Besitzer. Alle übrigen Actors stehen darauf. Die Checkbox wirkt auf die anfängliche
Aufteilung eines Runs ohne Vorgabe und auf die Actor-Auswahl des Run-Panels; eine bereits
gespeicherte Aufteilung ändert sie nicht. Die Auswahl bleibt in diesem Browser je Serveradresse
und Run erhalten; Leserechte genügen. Sie ändert weder den Run noch sein Journal.

Die Reitersymbole oben neben Einstellungen und Hilfe wählen den rechten Arbeitsbereich.
Der Panelknopf in derselben Titelleiste klappt ihn vollständig ein. Danach ist nur noch der Knopf
zum Öffnen sichtbar; er stellt die zuletzt verwendete Breite wieder her. Eine Auswahl über
einen Namen in der Actorliste öffnet das Panel ebenfalls. Besuchte Ansichten behalten ihren Zustand.
Die Symbolnamen erscheinen nach 50 Millisekunden Hover oder sofort bei Tastaturfokus direkt
unter der Kopfzeile. Beim Wechsel zum nächsten Symbol bleibt der Hinweis sichtbar und wechselt
sofort; kleine Lücken zwischen den Knöpfen unterbrechen ihn nicht.
Der Panelknopf ist so groß wie Einstellungen und Hilfe; Escape entfernt einen sichtbaren
Hinweis, ohne den Fokus zu verschieben.

Die Eingabe direkt in einer Agenten-Kachel sendet an den
jeweiligen Actor. Wie im rechten Actor-Chat stehen Dateien anhängen und die Darstellung der
Schritte von ausgeblendet bis vollständig zur Verfügung, ohne Modell- oder Denktiefenauswahl.
Der Modus "aktuell" zeigt den laufenden Schritt als Quassel-Chip. Bei Zugängen ohne technische
Leserechte steht dort "Denken" oder "Werkzeug läuft", ohne Werkzeugnamen, Inhalte oder
aufklappbare Details. Nach Ende des Schritts verschwindet der Chip; eine Nachricht, die Du
währenddessen nachschiebst, lässt ihn stehen. Die animierten
Arbeitsszenen bleiben sichtbar, solange der Agent arbeitet, auch bei längeren Denkpausen.
Im Run-Chat laufen sie, solange irgendein Agent oder Programm des Runs arbeitet, also auch
während der Koordinator auf beauftragte Actors wartet; Kacheln und Pop-outs zeigen nur den
jeweiligen Actor.
Senden braucht Schreibrechte am Run und einen nicht gestoppten Actor; fehlgeschlagene Eingaben
bleiben über die gemeinsame Chat-Eingabe verfügbar. Jede Kachel scrollt ihren eigenen Inhalt;
am Ende des Verlaufs folgt er neuen Nachrichten wieder automatisch. Den Chat mit allen Details
öffnest Du über die Actorliste oder die direkten Zugänge in der Leiste über der Fläche.

Verlauf und Eingabe nutzen dieselbe verfügbare Breite. Im Run-Chat schaltet der Uhrknopf unten
neben der Schrittdarstellung die Zeitstempel ein und aus. Die Wahl bleibt im Browser je Run und
primärem Actor gespeichert. Der Pfeil zum Ende erscheint erst bei mehr als 120 Pixeln Abstand;
kleines Zurückscrollen hält neue Antworten trotzdem an der gewählten Leseposition.

Kleinigkeiten der Chats und Kacheln: Antworten erscheinen schon während der Ausgabe als
Markdown mit Überschriften, Listen, Tabellen und Codeblöcken; noch offene Formatierungen werden
vorläufig dargestellt. Die Verläufe in den Kacheln zeigen keine Zeitangaben. An Deinen eigenen
Nachrichten erscheint beim Darüberfahren oder per Tastaturfokus oben rechts ein Kopiersymbol;
es kopiert den ursprünglichen Text mit seinen Zeilenumbrüchen und bestätigt mit einem Haken.
Sendest Du während einer laufenden Antwort eine weitere Nachricht, bleibt die Antwort
zusammenhängend vor Deiner neuen Nachricht stehen. Unter dem letzten Beitrag bleiben etwa zwei
Zeilen freier Scrollraum. Hat der Actor des Chats gerade einen Turn und ist die Eingabe leer,
unterbricht "Arbeit stoppen" nur diesen Turn; der Actor nimmt danach die nächste Nachricht an.
Ist er gestoppt, steht an der Stelle der Eingabe der Grund samt "Neu starten". Die Darstellung der Werkzeugaufrufe
(Symbole, kompakte Zeilen, vollständig) gilt je Chat; andere Chats und Runs behalten ihre
Einstellung, ebenso Breite und Aufklappzustand des rechten Panels je Run. Bei vielen Einträgen
in der Actor-Leiste über der Fläche erscheinen links und rechts Pfeilknöpfe zum Blättern; auch
Mausrad und Trackpad bewegen die Einträge horizontal. Mini-Apps bekommen in der Kachel einen
gemeinsamen Innenabstand; ihr Scrollbalken liegt am rechten Kachelrand, und der Platz für
Statusmeldungen unter dem App-Inhalt bleibt reserviert, damit Start, Abschluss und Fehler einer
Aktion die App nicht verschieben. Jede Teilfläche lässt sich erneut teilen, etwa in eine obere
Kachel und zwei untere im Verhältnis zwei Drittel zu einem Drittel; Koordinatoren können solche
Aufteilungen auf Wunsch ebenfalls setzen.

<!-- guide:clients -->
## Run panel and VS Code extension

The run panel is also available in the browser. `http://localhost:4710/run-panel.html?run=<id>`
shows a run in a narrow layout with mini-app chips, the selected app, actor chips, chat, and the
workspace-tab rail on the right. Without `run`, it shows the run list with "Neuer Run" as the first
card. `run-panel.html?layout=app&run=<id>&element=<app-id>` shows one mini-app without the rail.
Run-panel state, including the selected app and actor, view mode, chat width, collapsed chat
height, open tab, and tab-area height, is stored per run in the browser.

A narrow icon rail on the right contains the same tabs as the web workspace: files, documents,
functions, executions, and language-server diagnostics, depending on the run and the user's
permissions. The tab name appears in a tooltip. A small counter sits at the top right of its
button, while a dot at the bottom right indicates new activity since the last view. Clicking a
button opens that tab below the chat with its name and an X in the header. Clicking the same
button or the X closes it; another button switches tabs. Drag the top handle or use the up and
down arrow keys to change the area's height. At least 160 pixels remain for the chat. The open
tab and height are stored per run in the browser, per VS Code window, and independently from the
web workspace.

Once a mini-app is selected, three header buttons control the run-panel view: "Nur Chat" (chat
only, speech bubble), "Chat unten" (chat below, a sheet over the app), and "Chat rechts" (chat
right, beside the app). "Chat rechts" is the default. While the panel is narrower than the
configured width, that option is disabled and the chat stays below. "Nur Chat" gives the chat the
entire panel: the mini-app
recedes, nothing slides in or out, and an open sheet closes cleanly. Switching back rebuilds the
mini-app, so unsaved input in it is lost. The choice is stored per run and survives a restart.
The extension can also open a mini-app as an editor tab in the center, which works well with
"Nur Chat" in the run panel.

In "Chat unten", the handle controls the expanded chat height. Dragging up makes it taller;
dragging down makes it shorter. The chosen height is stored per run. The collapsed chat always
shows only the handle, status, and complete input, including multiple input lines. Hovering or
writing opens the chat to the chosen height (90 percent of the panel by default). Dragging leaves
the chat open at its new height. Clicking the handle opens or closes it. With
keyboard focus on the handle, up and down change the height, Home and End select its limits, and
Escape cancels an active drag.

The collapsed chat keeps its rounded border, background, and shadow. The compact handle row
shows keyboard focus on the small grip itself.

The extension lives under `apps/vscode`. It works with all configured **targets at the same
time**; there is no single active connection. A target in the `ragents.connections` setting is
either a server (`name` and `url`; it connects automatically when activated and its card asks
for sign-in in the panel) or a local profile (`name` and `profileFile`, the path to a
`ragents.config.<profile>.ts`). When activated, the extension starts a local profile silently in
the background with `--port 0`. The page shows "startet" (starting) and then "bereit" (ready), so its card and
templates are immediately available; a stopped local profile can be started again from its chip. The
host runs until the VS Code session ends and terminates with it, even if the window reloads, VS
Code crashes, or it is forcibly closed. Before starting, the extension provisions the profile's
tools; the web interface comes finished with the host. With a checkout as host, the host refuses
to start while its built-in bundles or its web interface are outdated and names the build
command. If a server distributes a client profile, the extension
fetches it after sign-in like `pnpm connect`, starts its host locally, and supplies the token as
`RAGENTS_TOKEN`. If `ragents.hostPath` is empty and the extension is not running from a checkout,
as with an installed `.vsix`, it downloads the host itself:
`npm install --prefix <globalStorage>/hosts/<paketfassung> @schlenkr/ragents@<paketfassung>`,
using the `npm` available on `PATH`. For a distributing server, that server specifies the version
through `ragents.profile.describe`; for a local profile, the extension supplies its own
`ragents.packageVersion` from `package.json`, keeping extension and host compatible. npm progress
and output appear in the `RAgents` output channel. Downloaded versions remain installed, and a
failure appears as the reason in the environment row. A local profile therefore no longer needs
a checkout. `ragents.hostPath` remains an override pointing to a checkout or installed package.
The status bar shows the number of connected targets and opens the start page when clicked. See
the root `README.md` for details.

Install the extension from the Marketplace as `purestate.ragents-vscode` using "Extensions:
Install Extension" or `code --install-extension purestate.ragents-vscode`. To install a locally
packaged file, run `pnpm package:vscode` (task `vscode: package`), which builds
`dist/ragents-vscode-<version>.vsix`, then use "Extensions: Install from VSIX" or
`code --install-extension dist/ragents-vscode-<version>.vsix --force`. The `vscode: install`
task (`scripts/vscode/install-local.sh`) performs both steps, rebuilds the built-in plugins, and
rebuilds the web interface if it no longer matches its sources, so that hosts from this checkout
start again. The script then restarts manually launched
servers (`scripts/start.sh`, identified by `RAGENTS_LAUNCH=start.sh` in their environment, with logs under
`<data-directory>/logs/server-<time>.log`) and waits for `/health`. Hosts started by the extension
are left alone and restart with the reload. Afterward, reload VS Code with "Developer: Reload
Window" and reopen the run panel. If `code` is not on `PATH`, it is available at
`/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code`. An installed extension
needs no checkout; it fetches the host from `@schlenkr/ragents` when first required by a
distributing server.

The extension is an app with four pages: Start, Runs, the run panel, and "Umgebungen"
(environments). All appear in the RAgents panel of VS Code's secondary sidebar. Navigation and
commands live in the view title bar, following VS Code conventions: Start (home), Runs (list),
Umgebungen (gear), "Neuer Run" (new run), and "Aktualisieren" (refresh). They remain available
while the panel shows a run. Start has no separate page header; Runs and Umgebungen show their
title next to a back arrow to Start, and the run panel's back
arrow also returns there. There is no Explorer tree in the activity bar. The view badge counts
pending inputs across all environments.

**Start** begins with **Umgebungen** (environments). Equal-width chips appear two per row at 420 pixels and in
a single row from 560 pixels. Each chip is a split button. Its left side shows a status icon,
name, and when needed an action label: none for a connected or ready environment (clicking opens
Runs filtered to it), "Anmelden" (sign in) when authentication is required or access was denied,
"Erneut versuchen" (try again) when unreachable or failed, "Starten" for a stopped local profile,
and "Verbinden" (connect) for a stopped server. "startet ..." (starting) is not a button. A monospace line below identifies the target:
`local / <profile>` for a local profile, the server host and non-default port, or `<host> / local`
when a server distributes a client profile whose host runs here.

The right side contains a plus button for a new run. If the environment profile defines
`defaultStartEntry` (see [profiles.md](spec/profiles.md)), it starts that template; otherwise it
starts an empty chat. Without permission to start, an equally wide empty space remains. For a
failed, unreachable, or rejected environment, its status icon is also a button. It opens a
popover with the status, full selectable message, "Ausgabe öffnen" (open output), and either
"Erneut versuchen" or "Anmelden". A lock opens the same sign-in dialog.

Below that, **Weiter** (continue) shows the five most recent runs from all environments in a fixed-column
grid with status, title, right-aligned time, and, when more than one exists, environment. "Alle N
Runs" opens the Runs page. **Neu** (new) appears when at least one environment is reachable and permits
new runs. Entries are grouped by environment when needed. The first tile is its default template,
marked "Standard" (default), or "Neuer Chat" (new chat) in the "Ohne Vorlage" (without template)
category. Remaining templates follow,
without duplicating the default. Clicking a tile creates and starts the run in its environment
and opens the run panel.

The new run uses your open folder as its workspace, asking you to choose when several are open.
If the template defines its own workspace, such as one server folder per run, VS Code does not
ask. Until content appears, the panel shows a progress bar and the current step: starting,
loading, preparing, or setting up. A startup or setup error appears in the same place while the
chat input remains usable. The loading state disappears with the first mini-app or chat item; an
empty chat without a template does not show it. VS Code never displays the run panel's run-list
view. If a run cannot be started, for example because the user may not create runs, the panel
explains why and offers "Zur Start-Seite" (back to Start). For a new run, the visible chat input receives focus as
soon as it becomes writable. Opening an existing run does not move focus there automatically.

**Runs** shows the complete list in the same grid, with search, "Beendete ausblenden" (hide finished), an environment
filter carried over from Start, and a selection mode that deletes several runs after a dialog
confirmation. Checkboxes occupy an additional first column without shifting the others.

**Umgebungen** is the configuration page. You can add, edit, sign in, sign out, connect,
disconnect, and remove environments with confirmation, then open `settings.json` from the link
at the bottom.

Every status uses a colored icon and a tooltip with the same vocabulary everywhere. A run is
"läuft" (running), "wartet auf Eingabe" (waiting for input, with the number of open inputs),
"ruht" (idle), "beendet" (ended), "fehlgeschlagen" (failed), or "abgebrochen" (cancelled). An
environment is "verbunden" (connected), "bereit" (ready), "startet" (starting), "Anmeldung nötig"
(sign-in required), "nicht erreichbar" (unreachable), "gestoppt" (stopped), "gescheitert"
(failed), or "kein Zugriff" (no access). Time is compact and omits "vor" (ago): `jetzt`, `5 min`,
`3 h`, `2 d`, then a date after seven days. A function or mini-app name never appears as a status.
Status icons never resemble a stop button: cancelled is a slashed circle, ended a check mark, and
idle or stopped an empty circle. Actual stop buttons consistently use a filled red square: "Run
stoppen" (stop run) in the run-panel header and run menu, "Arbeit stoppen" (stop work) beside the
chat input, and the stop controls for run processes.

Stopping work in a chat and stopping the run are different things. "Arbeit stoppen" appears in a
chat input only while that chat's own actor has a turn running, and it interrupts just that turn:
the text already written stays, running function calls are cancelled, and the actor stays active
and answers the next message. Actors it has started keep working, and when only another actor is
busy, the input pulses but offers no stop. To end everything, use "Run stoppen" (stop run) with its
confirmation; to stop a single actor for good, use "Stop" on its actor card. If a chat's actor has
been stopped, the input is replaced by `@handle gestoppt: <reason>` and, with permission to operate
and inspect the run, "Neu starten" (restart). Restarting the former primary actor makes it the
primary actor again, and the run chat continues.

The arrow on a mini-app in the run-panel stage opens it as a central editor tab; "Zurück ins Panel"
(back to the panel) closes the tab. Text artifacts and the journal open as read-only documents, while other artifacts
open in the browser. `RAgents: Neuer Run` uses a Quick Pick grouped by environment and template.
The first entry for each environment is its default, marked "Standard", or the free task without
a template. The commands `RAgents: Trennen` (disconnect), `RAgents: Verbinden` (connect), and
`RAgents: Abmelden` (sign out) apply to the selected run's environment or ask when several match.

When the run chat has focus, VS Code shortcuts such as Cmd/Ctrl+P and Cmd/Ctrl+Shift+P still
work using your keybindings. Text entry, selection, undo, and clipboard actions remain in the
input field. Keys already handled by chat, such as Enter to send, are not also executed as VS
Code commands.

If a server profile requires users, both the lock on Start and the Umgebungen row open the
same sign-in dialog. For a profile with `ACCESS_TOKEN`, the dialog requests that token. User name
and password are stored per server address in VS Code SecretStorage and reused silently next
session. The session token is stored there as well and sent as a bearer token; iframes receive it
in their URL (the server accepts a bearer token or the `access` query parameter for GET requests).
After expiry or a server restart, that target asks for sign-in again without affecting others.
`RAgents: Abmelden` revokes the session.
<!-- /guide:clients -->

### Erweiterung veröffentlichen, entwickeln und prüfen

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
`LICENSE`. Das Skript kopiert `README.md` und `LICENSE` für den Lauf von `vsce` aus der Wurzel
daneben und entfernt die Kopien danach wieder. Das Marketplace-README und das GitHub-README haben
damit dieselbe Quelle.

Einrichtung zum Entwickeln:

1. `scripts/start-vscode.sh core` (auch ein anderes Profil oder eine Serveradresse; Task `vscode: start`)
   startet bei Bedarf den Server, baut die Erweiterung und startet eine eigene VS-Code-Instanz mit
   ihr und dem Repo als Ordner, mit einem Ziel auf diesen Server;
   Layout und Anmeldung dieser Instanz bleiben unter `~/.local/share/ragents/vscode`. Alternativ F5
   mit einer eigenen `.vscode/launch.json` (nicht eingecheckt), Typ `extensionHost` mit
   `--extensionDevelopmentPath=${workspaceFolder}/apps/vscode`, `outFiles` auf
   `${workspaceFolder}/apps/vscode/dist/**/*.js` und `preLaunchTask` `vscode: build`.
2. `pnpm --filter ragents-vscode build` baut `dist/extension.js` (esbuild, CommonJS) und
   `dist/webview`, `watch` dasselbe fortlaufend. Der Stub der Tests ist der echte Transport des
   Servers; damit dessen Module geladen werden können, ist `apps/vscode/tests/` über eine eigene
   `package.json` ein ESM-Ordner, während die gebündelte Erweiterung CommonJS bleibt.
3. `ragents.theme` (`auto`, `light`, `dark`) wirkt sofort.
4. `ragents.hostEnvironment` führt die Namen der Umgebungsvariablen, die ein lokal gestarteter
   Host zusätzlich zur geerbten Umgebung bekommt. In der Einstellung stehen nur Namen; die Werte
   legt der Befehl "RAgents: Secret setzen" in die SecretStorage von VS Code, "RAgents: Secret
   löschen" nimmt sie wieder heraus. Beim Start eines Hosts liegen die gespeicherten Werte über
   der geerbten Umgebung; fehlt einer, nennt der Kanal `RAgents` nur seinen Namen, nie einen Wert.
   Damit startet ein Profil, das Werte über `env("NAME")` auflöst, auch in einem VS Code, das
   ohne die Variablen der Shell aus dem Dock kommt.

Ist ein Server nicht erreichbar, zeigt seine Zeile auf der Seite Umgebungen die Ursache und "Erneut versuchen", auf Start
steht dieselbe Meldung hinter dem Zustandssymbol des Chips, und die
Sitzung versucht es alle fünf Sekunden von selbst; die Liste wird verbunden ohnehin alle fünf
Sekunden neu geladen, der Ereignisstrom verbindet nach fünf Sekunden neu und meldet die
Unterbrechung als Zeile unter seinem Ziel. Die Erweiterung wird erst beim Öffnen einer ihrer
Ansichten aktiv und verbindet sich nicht im Hintergrund.

Prüfen: `pnpm --filter ragents-vscode test` läuft ohne VS Code gegen einen Stub-Server und
gehört zu `pnpm check`; `RAGENTS_HOST_TEST_SERVER=http://localhost:4710 pnpm --filter
ragents-vscode test:host` startet das installierte VS Code mit einem temporären Benutzerordner
gegen den laufenden Server (mindestens ein Run mit Mini-App, etwa das Sammelboard aus einem
Server mit dem Profil `showcase`) und prüft
Verbindung, Run-Panel, Run-Wechsel und Mini-App in der Mitte; `RAGENTS_HOST_TEST_LOGIN=id:passwort`
beziehungsweise `RAGENTS_HOST_TEST_TOKEN=<token>` prüfen die Anmeldung.
`RAGENTS_HOST_TEST_WORKSPACE=<ordner>` prüft zusätzlich einen Run mit Bindung `client`,
`RAGENTS_HOST_TEST_SECOND=<adresse>` daneben ein zweites Ziel: beide gleichzeitig verbunden, die
Start-Seite mit beiden, der Arbeitsplatz bei beiden Servern angemeldet, ein Kachel-Klick, der
Zurück-Pfeil auf die Start-Seite, das Löschen eines Runs, das Plus einer Umgebung als leerer Run
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

Grenzen: keine Codeaktionen, keine Dateisynchronisation, kein Betrieb ohne Server. Ein lokales
Profil zeigt seine Startvorlagen erst nach dem Start.

## Dienste und Hintergrundprozesse beenden

Die Prozessleiste zeigt Hintergrundprozesse des Runs und Dienste mit offenen Ports, und zwar auf
dem Rechner, auf dem der Run arbeitet: bei einem Arbeitsplatz dessen Prozesse, sonst die des
Servers. Mit Schreibrecht beendet das kleine Stopp-Symbol genau die ausgewählte Prozessinstanz.
Während der Anfrage ist dessen Knopf gesperrt; Fehler bleiben am Eintrag sichtbar. Der nächste
Prozessstand entfernt beendete Einträge. Beim Stoppen und vor dem Löschen eines Runs räumt der
Executor des Runs auch markierte Prozesse ohne offenen Port auf, auf dem Arbeitsplatz wie auf dem
Server. Ein offenes Browserfenster ist dafür nicht nötig. Ist der Arbeitsplatz gerade nicht
verbunden oder antwortet er nicht innerhalb von zehn Sekunden, merkt sich der Server den Stopp und
holt ihn nach, sobald sich der Arbeitsplatz wieder anmeldet, noch vor jedem neuen Auftrag dieses
Runs; das Serverprotokoll nennt ihn bis dahin als ausstehend. Ein Serverneustart vergisst ihn.

Zunächst sendet der Executor SIGTERM. Reagiert der Prozess innerhalb von zwei Sekunden nicht,
folgt SIGKILL; nach einer weiteren Sekunde muss er beendet sein. Ein Durchlauf hat eine
Zeitgrenze von acht Sekunden. Fehlende Betriebssystemrechte oder ein verbleibender Prozess
werden als Fehler gemeldet und dürfen nicht als erfolgreicher Abschluss verstanden werden.

Ein bewusst abgesetzter Node-Dienst kann mit `child_process.spawn` und den Optionen
`detached: true`, `stdio: "ignore"`, `env: process.env` sowie anschließendem `child.unref()`
weiterlaufen. Das verwendet auf macOS und Linux die Node-Prozessschnittstelle und benötigt
kein externes `setsid`-Programm. Der geerbte `RAGENTS_RUN_ID`-Marker muss erhalten bleiben,
damit der Dienst beim Run-Stopp wiedergefunden wird. Derselbe Mechanismus gilt unabhängig
vom verwendeten Interpreter; ohne Marker gibt es keine Zuordnung zum Run. Auf einem Mac liest die
Prozesstabelle den Marker aus `ps -E`, und das zeigt die Umgebung von Programmen aus `/bin` und
`/usr/bin` nicht (etwa `sleep`, `bash`, `sh`, `perl`, `ruby`): einen so abgesetzten Dienst aus einem
Systemprogramm sieht die Prozessleiste nicht, und der Stopp räumt ihn nicht ab. Node,
Homebrew-Programme und das Python von Xcode sind nicht betroffen. Unter Linux zählt ein eigener
Prozess, der seine Umgebung gesperrt hat (etwa `ssh-agent`), zu keinem Run.

## Anhänge im Chat

Die Chat-Eingabe leert Text und Anhänge sofort beim Absenden. Bis zum Ende der Anfrage sind
weitere Sendeaktionen und neue Anhänge gesperrt. Du kannst einen neuen Text beginnen, sofern
die jeweilige Ansicht die Eingabe freigibt. Bei einem Fehler kehrt die ursprüngliche Eingabe
automatisch zurück, wenn du inzwischen nichts geändert hast. Sonst bleibt dein neuer Text
unverändert; der fehlgeschlagene Auftrag steht getrennt mit Vorschau bereit. Mit
"Nicht gesendete Eingabe einfügen" hängst du ihn samt Anhängen an den aktuellen Entwurf an.

Bilder, Videos und Dateien lassen sich in die Chat-Eingabe ziehen oder über den Anhangknopf
auswählen. Bilder und Dateien aus der Zwischenablage fügst du mit Cmd+V beziehungsweise Ctrl+V
ein. Vor dem Senden erscheinen Vorschauen mit Dateinamen und einem Entfernen-Knopf. Auch ohne
zusätzlichen Text kannst du senden. Das gilt für neue Unterhaltungen, den globalen Koordinator,
die Actor-Ansicht und Chat-Controls in Actor-Views.

Eine Nachricht nimmt bis zu acht Dateien mit zusammen 20 MiB auf. Bilder, Videos und native PDFs
brauchen ein passendes Modell; die Eingabe meldet fehlende Fähigkeiten und erhält die Auswahl.
Textdateien werden als UTF-8 gelesen. Andere Dateien stehen dem Agenten über seine Dateiwerkzeuge
zur Verfügung: sie liegen unter `attachments/` im Arbeitsbereich des Runs, bei einem Arbeitsplatz
also auf dessen Rechner; ihre weitere Verarbeitung hängt von diesen Werkzeugen ab. Bei Fehlern bleiben
Nachricht und Dateien im Composer. Gesendete Anhänge kannst du im Verlauf wieder herunterladen.

## Anmeldung und Profilrechte

Für einen optionalen Anmeldemodus ergänzt die eigene `ragents.config.<profil>.ts` neben
`config` einen `users`-Export mit `readonly ProfileUser[]`. Benutzerkennung, optionaler
Anzeigename und Rechte stehen dort; das Passwort steht als Klartext oder verweist mit
`env(...)` auf eine lokal bereitgestellte Umgebungsvariable. Ein Beispiel steht in
[profiles.md](spec/profiles.md) unter "Sign-in and permissions", vollständige Beispiele in der
intern erzeugten [Entwicklerreferenz](homepage/developer.md#lesen-und-vorbereitete-setups-freigeben). Die gültigen eingebauten Rechtenamen und die Host-Routenzuordnung stehen in der
[automatisch erzeugten Entwicklerreferenz](homepage/developer.md).

Nach einer Änderung neu starten. Ohne `users` gibt es keine Benutzeranmeldung; eine leere
Liste oder fehlende Passwortvariable ist ein Startfehler. Bei aktiver Anmeldung Benutzerkennung
und Passwort eingeben. Der Benutzerknopf bietet Abmelden. Nach zwölf Stunden oder nach einem
Serverneustart ist eine neue Anmeldung erforderlich; Abmelden beendet auch offene Ereignisströme
und laufende HTTP-Abrufe. Bereits gestartete Agenten-Runs werden dadurch nicht gestoppt.
Die Benutzersitzung wird nur im Serverspeicher gehalten.

Jeder Run gehört dem Benutzer, der ihn angelegt hat: Ein Bedienerzugang sieht und erreicht nur seine
eigenen Runs, `runs.read.all` zeigt die aller Benutzer, und die Rolle mit `*` hat dieses Recht damit
automatisch. Runs aus der Zeit davor und Runs, die ohne Anmeldung entstanden sind, haben keinen
Eigentümer und bleiben `runs.read.all` vorbehalten. Ein Profil ohne Anmeldung ändert sich nicht.
Einen an einen Arbeitsplatz gebundenen Run bedient nur sein Eigentümer: wer ihn mit `runs.read.all`
sieht, kann sein Journal lesen und ihn stoppen, aber keine Nachricht schicken, keinen Einstieg starten
und keine Rückfrage beantworten (`run-owner-only`). Seinen Arbeitsbereich sieht nur der Eigentümer: den
Reiter Dateien für das Arbeitsverzeichnis, die Prozessleiste und die Sprachserver liefert der Server
jedem anderen nicht, auch nicht mit `runs.read.all` und nicht der Dienstidentität des globalen
Koordinators (`run-workspace-owner-only`); die Dateiablage auf dem Server bleibt lesbar. Web und
VS Code blenden bei so einem Run Prozessleiste, Sprachserver und jeden anderen Reiter aus, der den
Arbeitsbereich braucht, der Reiter Dateien zeigt nur die Dateiablage, und Angaben der Run-Liste aus
dem Arbeitsbereich (etwa ein Branch) fehlen. Run-Schreibrechte erlauben Chat und App-Aktionen. Freie
Runs brauchen zusätzlich `runs.create`, technische Ansichten `runs.inspect`. Ohne `runs.create`
begrenzt `startEntries` die erlaubten Run-Scripts. Ein `anonymousUser`-Export kann dieselben Rechte
ohne Anmeldung setzen. Die globale Unterhaltung hat eigene Rechte; für ihre Modelländerung ist
zusätzlich Settings-Schreibzugriff nötig. Benutzer und Passwörter werden in der Profildatei
beziehungsweise Umgebung gepflegt, nicht über eine Verwaltungsseite. `ACCESS_TOKEN` bleibt nur für
Profile ohne `users` wirksam und ersetzt bei aktivierter Benutzeranmeldung kein Passwort.

Ein Benutzer kann neben dem Passwort einen persönlichen Token haben (`token: env("...")`):
ein dauerhafter Bearer ohne Ablauf für Clients ohne Anmeldedialog, etwa `pnpm connect` und den
Modellzugang eines lokalen Servers über das Relay. Die dafür nötigen Rechte sind `models.use`
(Relay) und `profile.fetch` (Client-Profil); Runs des Servers braucht ein solcher Benutzer
nicht zu sehen. Entzug: Token aus dem Profil nehmen und neu starten.

## Einstellungen

Die Kachelfläche im Stil Schichtwerk zeigt matte Kacheln mit gerundeten Kanten, ohne Tiefe.
Lavendel kennzeichnet den Hauptactor, Tonfarbe weitere KI-Actors, Senfgelb
TypeScript-Actors und Blaugrau die Mini-Apps. Die Fronten bleiben gerade und gleichmäßig.
Runde Knöpfe mit X schließen Dialoge; ein runder Pfeil führt zur vorherigen Ansicht zurück.
Die Hinweise am Knopf benennen die jeweilige Aktion.
Auswahlmenüs öffnen je nach Platz über oder unter ihrem Knopf und bleiben auch in engen
Eingabe- und Dialogflächen vollständig erreichbar. Escape schließt zunächst das offene Menü.

Unter "Darstellung", "Schichtwerk" wählst du Hell, Dunkel oder System. Die Vorgabe ist Dunkel;
System folgt der Farbschema-Einstellung des Betriebssystems auch bei späteren Änderungen.
Die Auswahl wirkt sofort auf Oberfläche, Kacheln und gemeinsame Actor-View-Controls, ohne Chats
oder Apps neu zu laden. Sie wird im Browser für dieselbe Serveradresse gespeichert und mit
anderen geöffneten Tabs abgeglichen. Zum Ändern brauchst du Settings-Schreibrechte.
Eigene feste Actor-View-Farben bleiben bestehen. Farben, Schriften, Radien, Schatten und
Animationen werden für die Entwicklung zentral in `apps/web/src/ui/theme.css` gepflegt.
Actor-Views verwenden dieselben shadcn/ui-Controls wie der Host, mit den Farben aus den Tokens.
Sie folgen derselben Hell-/Dunkel-Wahl; eine gesonderte Auswahl dafür gibt es nicht.

Das Zahnrad öffnet zuerst "Modelle". "Globaler Koordinator" ändert dessen eigene Auswahl
ab dem nächsten Arbeitsschritt. Die erste globale Auswahl wird unabhängig gespeichert und
bleibt auch nach einem Neustart von den Produktvorgaben getrennt. "Neue Runs und Agenten" bietet für jedes Agentprofil des
Produkts Modell und Denktiefe; in core sind das coordinator, relay und standard. Speichere den
vollständigen Entwurf. Neue Actors und Vorgaben noch nicht gestarteter Runs verwenden ihn
sofort; bestehende Actors sowie eine ausdrücklich getroffene Startauswahl bleiben erhalten.

Die Auswahl enthält nur konfigurierte Modelle und deren unterstützte Denktiefen. Ungültige
Entwürfe werden vor dem Speichern abgewiesen. Die Vorgaben bleiben pro Produkt-Plugin unter
`${DATA_DIR}/plugins/<produkt-plugin>/model-settings.json` erhalten. Ohne Datei gelten die
Konfigurationsvorgaben; eine beschädigte oder inzwischen ungültige Datei verhindert den Start.
Die verfügbare Modellliste wird weiterhin in der Profildatei gepflegt.

Das Gesprächsprofil heißt `coordinator`, das Profil der Agenten `standard`. Unter
"Neue Runs und Agenten" kannst Du ihre Denktiefen getrennt wählen. Die Vorgaben stehen in der
Profildatei, in core unter `ragents.product`:

```typescript
AGENT_COORDINATOR_MODEL: "z-ai/glm-5.3-flash",
AGENT_COORDINATOR_THINKING: "high",
AGENT_MODEL: "z-ai/glm-5.3-flash",
```

Ein Produkt-Plugin kann weitere Rollen mit eigenen Schlüsseln anmelden; gespeicherte Profile
lassen sich separat bearbeiten. Der aktuelle Modellkatalog bietet für GLM 5.3 und GLM 5.3 Flash
`low`, `high` und `max`.
Gespeicherte Modelleinstellungen haben Vorrang vor der Profildatei. Änderungen
in der Oberfläche gelten für neu angelegte Actors ohne Neustart; Config- und Run-Prompt-Änderungen
benötigen einen Neustart und für den neuen Koordinatorprompt einen neuen Implementierungs-Run.

Unter "Überschriften" wählst du unabhängig davon das Modell für kurze automatische
Listentitel. Bei einer großen Modellliste hilft die Suche. "Speichern" übernimmt die Auswahl,
"Änderungen verwerfen" verwirft nur den Entwurf. "Keine automatischen Überschriften" mit
anschließendem Speichern deaktiviert neue Erzeugungen; vorhandene Titel bleiben erhalten.
Die Auswahl wirkt ab der nächsten Erzeugung und verändert keine Agentenmodelle.

Angeboten werden Textmodelle des konfigurierten `COMPACTION_PROVIDER`, die ohne Reasoning
arbeiten können. Diese Liste ist unabhängig von `AGENT_MODELS`. Die Einstellung bleibt unter
`${DATA_DIR}/title-settings.json` erhalten. Ohne Datei gilt `COMPACTION_MODEL` aus der
Profildatei, in den mitgelieferten Profilen Gemma 4 A4B. Eine ungültige gespeicherte Auswahl
verhindert den Start und wird nicht still ersetzt.

"Darstellung" enthält die Oberflächenwahl und die Einstellungen des Run-Panels. "Erweiterungen" enthält
"Nach Extension" und "Nach Fähigkeit" als technische Kataloge mit Suche. Ein Klick auf den
Eigentümer öffnet die vollständige Extension-Seite. "Laufzeit" zeigt technische Fakten,
Modelle, Profile und Systemprompt. Modelle und Darstellung funktionieren unabhängig vom
Laden dieser Kataloge. Plugin-Formulare sind zusätzlich bei ihrer Extension erreichbar.

Unter "Run-Panel" bestimmst du, ab welcher Panelbreite der Chat rechts neben der Mini-App
liegt (Vorgabe 900 Pixel) und wie träge das Sheet auf die Maus reagiert (Vorgabe 160
Millisekunden bis zum Hochschieben, 150 Millisekunden bis zum Zurückgleiten). Zum Ändern
brauchst du Settings-Schreibrechte. Die Einstellung bleibt lokal für dieselbe Serveradresse im
Browser gespeichert und wird nicht als Profilwert auf dem Server abgelegt. Zurücksetzen stellt
die Vorgaben wieder her.

## Übergeordneter Koordinator

Der Koordinator entdeckt seine Funktionen mit `typescript_api` und führt sie in
`typescript_eval` über `context.functions` aus. Seine Auswahl umfasst `read`, `write`, `edit`
und `bash`; `quick_answer` ergänzt eine kurze Ergebnisanzeige nach seiner normalen Antwort. Seine erzeugte Referenz
der Nachrichtenschicht (`rpc-reference.md`, `openrpc.json`) liegt im eigenen Arbeitsverzeichnis. `RAGENTS_JOURNAL_DIR` zeigt auf die echten Journale des
Profils; die Shell kann sie etwa mit `rg` durchsuchen. Journale bleiben unverändert im
JSONL-Dateiformat 5 (ältere Zeilen tragen 4, gleich kodiert). Große Payload-Felder liegen im benachbarten `payloads/`-Ordner;
`payloadRefs` nennt ihren Hash und ihre Bytezahl. Die Methode `ragents.overseer.readEvents` löst diese Referenzen
vollständig auf. Laufzeitänderungen wie Starten, Senden und Stoppen gehen durch die Methoden.
`RAGENTS_API_BASE_URL` nennt den lokalen Host mit dem Port, auf dem er tatsächlich lauscht, auch
nach einem Start mit `--port 0`; ein Server nur über stdio hat keine HTTP-API und setzt die Variable
nicht. `RAGENTS_API_TOKEN` enthält eine private, auf die lokale Verwaltungs-API beschränkte
Dienstidentität für Run-Lesen und -Schreiben sowie Hilfe. Sie erreicht weder Einstellungen
noch den globalen Gesprächsreset, und einen an einen Arbeitsplatz gebundenen Run kann sie nur
lesen und stoppen. Den Token nicht ausgeben oder in Requestdateien schreiben.
Dieselbe API steht externen Clients mit dem normalen Hostzugang zur Verfügung.

Eigene Run-Script-Pakete lassen sich im Arbeitsbereich erstellen und über einen absoluten
Serverdateipfad starten. Paketformat und Script-API stehen in der erzeugten Setup-Referenz;
es braucht keine neue Pluginregistrierung. Innerhalb eines bestehenden Runs kann der
Koordinator Einrichtungen direkt in einem TypeScript-Snippet ausführen. Ein eigenes
Actor-Programm wird für spätere Inputs, Zustand oder Views benötigt. Vorbereitete Run-Scripts
bleiben wiederverwendbare Startpakete. Fehlgeschlagenen Aufbau vor einer Wiederholung prüfen:
bereits ausgeführte Einrichtungsschritte bleiben erhalten.
Ändert sich die feste Werkzeugauswahl des globalen
Koordinators, meldet ein vorhandenes Gespräch beim nächsten Sendeversuch
`global-tools-changed`. Nach dem Serverneustart einmal `Gespräch zurücksetzen` ausdrücklich
bestätigen, damit die nächste Nachricht mit den aktuellen Werkzeugen und der neuen
Promptanweisung beginnt. Auch die Erweiterung von `quick_answer` um die kurze Nutzerfrage
benötigt nach dem Neustart einen Reset für den aktuellen Vertrag und Prompt: Ein bestehendes
Gespräch wird nicht automatisch angepasst. Der Reset leert globalen Verlauf, Entwurf, Anhänge
und Modellkontext; Modellwahl und normale Runs bleiben erhalten.

`Gespräch zurücksetzen` steht neben Modell und Reasoning im Dropdown des globalen Chats und öffnet
einen Dialog über dem gesamten globalen Chat. Sein Hintergrund wird unscharf und ist
währenddessen nicht bedienbar; der Fokus beginnt auf Abbrechen. Die bestätigte Aktion löscht
Verlauf, Eingabeentwurf, Anhänge und Modellkontext und stoppt vorher eine laufende Antwort. Normale Runs,
ihre Journale sowie Modell- und Reasoningwahl bleiben erhalten. Nach Abschluss beginnt die
nächste Nachricht ein frisches Gespräch. Bei einem Fehler bleibt eine Meldung sichtbar;
ein begonnener Reset lässt sich wiederholen und wird nach einem Serverneustart fertiggestellt.
Es gibt keinen automatischen Reset.

Modell und Reasoning-Tiefe wählst du im Dropdown oberhalb des Verlaufs. Dieselbe Auswahl findest du
in den Einstellungen unter Modelle und bei `ragents.overseer`. Sie wird pro Profil
gespeichert und gilt ab dem nächsten Arbeitsschritt; eine laufende Antwort wird nicht
umgestellt. Andere Runs behalten ihre Modelle. Ein inkompatibles Modell, etwa ohne
Unterstützung für schon gesendete Bilder, wird abgewiesen und die bisherige Auswahl bleibt.

Mit `ragents.overseer` in `host.PLUGINS` steht die Eingabe "Globaler Koordinator" rechts
neben den Übersichtsknöpfen. Fokus in die Eingabe klappt den Verlauf
unterhalb auf. Enter sendet, Shift+Enter fügt eine Zeile ein. Die Eingabe bleibt oben; Anhänge
lassen sich wie in anderen Chats auswählen, hineinziehen oder einfügen. Im Dropdown stehen
Verlauf, Modellwahl, Reasoning, Details und Reset. Senden und Stopp bleiben an der Eingabe.

Beim Absenden erfährt der globale Koordinator, ob du auf der Startansicht, in der Run-Übersicht
oder in einem Run bist, welchen Bereich du geöffnet und welches Element du ausgewählt hast.
Öffne zum Beispiel den Reiter Dateien und frage oben "Was liegt in diesem Run?".
Run-Titel, kurze Laufreferenz und Actor-Name werden auf dem Server ergänzt; du musst sie nicht
abschreiben. Dein sichtbarer Fragetext bleibt dabei unverändert.

Diese Orientierung hält den Stand beim Absenden fest. Wechselst du danach den Run, bezieht
sich die schon gesendete Frage weiterhin auf ihre ursprüngliche Auswahl, auch wenn sie noch
in der Warteschlange steht. Ohne mitgesendete UI-Angabe gibt es keinen aktuellen Standort.
Der Koordinator erhält durch diesen Kontext weder Bildschirmbilder noch Formulartexte oder
vollständige Run-Inhalte. Die Angabe hilft beim Zuordnen deiner Frage und erteilt keinen
zusätzlichen Auftrag; ein Ansichtswechsel allein löst keine Modellanfrage aus.

Escape schließt zuerst ein offenes Auswahlmenü und danach den Verlauf. Ein Klick außerhalb
oder Tab aus dem gesamten Bereich schließt ihn ebenfalls. Das beendet keine Arbeit und
verwirft keinen Entwurf. Übersicht, Einstellungen und Hilfe schließen den Verlauf; bei einem
Run-Wechsel bleiben Gespräch und Eingabe erhalten. Die Übersichtsecke und `Cmd+I` beziehungsweise
`Ctrl+I` öffnen ausschließlich die Run-Übersicht.

Erst das erste Öffnen verbindet den Stream. Schon während der Sendeanfrage und danach bei
laufender Arbeit pulsiert der Rahmen um die Eingabe, wie bei arbeitenden Agenten in ihrer Kachel.
Bei reduzierter Bewegung
bleibt der Rahmen hervorgehoben. Ein Verbindungsabbruch sperrt Senden, erhält aber den Entwurf.
Nach Wiederverbindung werden zwischenzeitliche Kurzantworten berücksichtigt, ohne alte Toasts
beim ersten Verbinden oder erneuter Wiedergabe nochmals anzuzeigen.

Der Koordinator überblickt die Läufe des aktuellen Profils, liest Journale und kann neue Läufe
mit einem Auftrag oder einem installierten Run-Script beginnen. Erstellte Läufe lassen sich
über die Run-Liste öffnen. Der Stopp-Knopf an seiner Eingabe erscheint nur, solange der globale
Koordinator selbst einen Turn hat, und unterbricht nur diesen; einen anderen Lauf stoppt er auf
Auftrag über die Verwaltungsmethoden. Ohne Schreibrecht
bleibt die schreibgeschützte Eingabe fokussierbar und öffnet den lesbaren Verlauf; Senden ist
gesperrt. Einen zusätzlichen Dropdown-Pfeil gibt es nicht.

Für eine knappe Antwort kann der Koordinator `quick_answer` verwenden. Die aktuelle Nutzerfrage
und ihre Antwort erscheinen kurz zusammengefasst, jeweils mit höchstens 240 Zeichen,
automatisch direkt unter der Kopfzeile als Toast, auch bei
offenem Verlauf. Er verwendet dieselbe Fläche und denselben Abstand wie die Hinweise der
Kopfzeilenknöpfe.
Die gesamte Fläche öffnet beim Anklicken das Gespräch und fokussiert seine Eingabe, bei
Lesezugriff den Verlauf. Das X schließt nur den Toast; die Antwort
öffnet nichts von selbst und unterbricht nicht die aktuelle Eingabe.

Der Chat verwendet die reservierte Run-ID `overseer` und die normale Journal- und Sessionablage.
Die kurzen Laufreferenzen liegen dauerhaft unter `plugins/ragents.overseer/run-references.json`
im Datenverzeichnis. Der Koordinator erscheint nicht in der normalen Unterhaltungsliste und kann
nicht gelöscht werden. Die mitgelieferten Profile enthalten das Plugin; eine zusätzliche
Profildatei muss es ebenfalls in ihrer Pluginliste aufführen.

## Wählbares Modell

Gibt das Produkt es frei (`MODEL_SELECTABLE`, in `core` voreingestellt an) und erlauben
die Benutzerrechte freie Starts und technische Ansichten, wählt man auf der Startfläche das
Modell des Koordinators über ein tastaturbedienbares Auswahlmenü in der Auftragseingabe.
Die Denktiefe steht als zweites
Auswahlmenü kompakt daneben und bietet nur die Stufen des gewählten Modells an, einschließlich
erweiterter Stufen wie `max`, sofern unterstützt. `AGENT_MODEL_REASONING` ist nur für eine
bewusste Einschränkung dieser Modellfähigkeiten nötig; ungültige Stufen brechen die Konfiguration ab.
Die Eingabe beginnt mit drei Zeilen und wächst bis acht Zeilen;
weitere Startoptionen stehen darunter.
Angeboten werden weiterhin nur wählbare, noch nicht gesperrte Startoptionen.
Zur Wahl steht `AGENT_MODELS` - eine ECHTE Liste in der Konfigurationsdatei, kein Wert
mit Trennzeichen:

```ts
AGENT_COORDINATOR_MODEL: "deepseek/deepseek-v4-flash-0731",
AGENT_COORDINATOR_THINKING: "off",
AGENT_MODELS: ["qwen/qwen3.8-max", "deepseek/deepseek-v4-flash-0731", "z-ai/glm-5.3"],
```

Ohne `AGENT_MODELS` stehen die ohnehin konfigurierten Modelle des Produkts zur Wahl, jedes einmal,
auch wenn Agent und Koordinator dasselbe Modell nennen; doppelt darf ein Modell nur in einem
ausdrücklichen `AGENT_MODELS` nicht stehen. Die Wahl wird wie
der Systemprompt mit der ersten Nachricht eingefroren und gilt für den Koordinator.
`AGENT_COORDINATOR_MODEL` ist dabei der explizite Standard und nicht einfach der erste Listeneintrag.
Er muss in `AGENT_MODELS` stehen; eine widersprüchliche Konfiguration bricht den Start hart ab. Das
Profil `relay` beginnt mit demselben Modell und derselben Koordinator-Denktiefe. Unter
Einstellungen, Modelle kann es eine eigene Vorgabe für neue Vermittlungs-Actors erhalten.

## Webanwendungen im Browser prüfen

`ragents.browser` verwendet `playwright-core` und einen ausführbaren Chrome oder Chromium auf dem
Rechner, auf dem der Arbeitsbereich des Runs liegt: bei einem leeren Ordner je Run oder einem
Ordner des Serverrechners auf dem Server, bei einem Arbeitsplatz auf dem Arbeitsplatz. Dort
erreicht der Browser die Anwendung, die der Agent gestartet hat, auch unter `localhost`.

Auf dem Server trägst Du in der Sektion `ragents.browser` des Profils `BROWSER_EXECUTABLE_PATH`
ein oder überlässt den Browser der Provisionierung. Für Google Chrome auf macOS lautet der Pfad
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. `pnpm provision <profil>` holt
über `plugins/ragents.browser/provision.ts` die zur gepinnten Playwright-Fassung passende
Chromium-Version und unter Linux deren Systembibliotheken; sie landet im normalen Browsercache
von Playwright, nicht im Werkzeugordner. Zeigt `BROWSER_EXECUTABLE_PATH` ins Leere, meldet die
Provisionierung das als Lücke, die sie nicht schließen darf.

Ein Arbeitsplatz bekommt nichts davon aus dem Profil des Servers. Er nimmt `BROWSER_EXECUTABLE_PATH`
aus seiner eigenen Umgebung, sonst das Chromium, das `pnpm provision --workspace` beim Start von
`pnpm workspace-client` und der VS-Code-Erweiterung holt, und `playwright-core` aus seinem
Host-Ordner, wie den TypeScript-Sprachserver. Fehlen Host-Ordner, `playwright-core` oder ein
ausführbarer Browser, scheitert `browser_open` mit der Ursache und dem Befehl, der sie behebt;
Werkzeuge, Sprachserver und Dateien arbeiten weiter. Die Pluginregistrierung startet keinen Browser
und lädt keinen herunter.

Der Agent lädt bei Bedarf den Skill `browser-testing`, öffnet die laufende Anwendung, liest
ihren zugänglichen Aufbau und bedient den Nutzerweg. Er prüft sichtbare Ergebnisse und
Browserfehler mit `browser_check`. Rollen und Beschriftungen bestimmen die Elemente;
fehlende oder mehrdeutige Ziele werden gemeldet. Eigene Auswahlmenüs werden geklickt,
native Selects über ihren sichtbaren Optionstext gewählt. Tastatur und Iframes sind verfügbar.
Weitere Fenster werden gemeldet und geschlossen.

Aufnahmen aus `browser_screenshot` erscheinen unter `browser` in den Dokumenten des Runs.
Mini-Apps können die zurückgegebene URL direkt anzeigen. `browser_view_screenshot` ist ein
natives Werkzeug für Modelle mit Bildunterstützung und lädt die letzte Aufnahme ohne
Pfadangabe. Die Aufnahmen liegen immer auf dem Server, auch wenn der Browser auf einem
Arbeitsplatz läuft. Die historische Aufnahmeliste bleibt über Stopp und Serverneustart erhalten;
eine frühere Aufnahme beweist keinen später geänderten Stand. Der Browser startet je Run
ohne persönliche Anmeldung. Stoppen verwirft seine Cookies und die aktuelle Prüfgültigkeit.

Die gezielte echte Browserprobe startet nur eine kurzlebige lokale Fixture und schreibt nach
Temp: `RAGENTS_BROWSER_TESTS=1 PRODUCT_PROFILE=core pnpm --filter @ragents/host exec node
--import tsx --test tests/browser-live.test.ts`. `BROWSER_EXECUTABLE_PATH` kann für diesen
Aufruf als Umgebungsvariable gesetzt werden. Die regulären Serverprüfungen enthalten die
Browser-Vertrags- und Lifecycle-Tests; die echte Browserprobe benötigt die ausdrückliche Flagge.

## Auswählbare Systemprompts

Der Kern bringt selbst KEINEN inhaltlichen Systemprompt mehr mit. `ragents.product/preamble.hbs`
sagt nur noch, dass man als Koordinator in RAgents läuft; die Mechanik steht bei dem Plugin, das
sie erklärt (Profile und Neustart-Regel in `ragents.orchestration`, `ask_user` in `ragents.ask`),
und Ton wie Verhalten kommen aus den Prompt-Dateien.

Jede `.md` oder `.hbs` im Ordner `prompts/` eines Plugins oder in `SYSTEM_PROMPTS_DIR` ist ein
Eintrag der Liste: Kennung = Dateiname ohne
Endung, Beschriftung = erste `# `-Überschrift. Auf der Startfläche schaltet man sie einzeln an und aus -
MEHRERE gleichzeitig sind erlaubt, die Reihenfolge im Prompt folgt dem Katalog, nicht der
Klickfolge. Der Text kommt ZUSÄTZLICH zur Präambel in den Prompt und wird mit der ersten Nachricht
eingefroren. `SYSTEM_PROMPT_DEFAULT` nimmt entsprechend eine Liste von Kennungen.

Das Häkchen "Auch an die Agenten weiterreichen" auf der Startfläche entscheidet über die Reichweite:
ohne Häkchen gilt der Prompt nur für den Koordinator, mit Häkchen steht er zusätzlich im
Systemprompt jedes Agenten, den der Koordinator erzeugt. Plain-LLMs mit `tools: []` sind bewusst
ausgenommen und erhalten ausschließlich ihren eigenen Prompt. `SYSTEM_PROMPT_SHARE_DEFAULT=1`
belegt das Häkchen vor; die Reichweite wird zusammen mit der Auswahl in das Journal des Runs eingefroren.

Die Dateiablage bleibt je Unterhaltung isoliert
(`sessions/<id>/plugins/ragents.documents/documents`, Dienst `documentStoreToken` von
`ragents.documents`); `DOCUMENTS_DIR` legt sie mit einem Unterordner je Unterhaltung unter einen
externen Pfad, bleibt aber bewusst ungesetzt, damit Testunterhaltungen nie in eine fremde
Ablage schreiben. Ein Systemprompt gleichen Namens im Plugin-Ordner und in
`SYSTEM_PROMPTS_DIR` ist ein harter Fehler.

## Skill-Einstiege für die TypeScript-Referenzfälle

Actor-Programme sind private TypeScript-Pakete mit Funktionen, optionalem Input-Handler und
optionalen React-Views. `actor_program_create({name, template})` erzeugt die Vorlage und ihre
TypeScript-Umgebung. Bearbeitet werden normale Dateien mit Imports unter `@actors/<name>/`;
der Alias gilt auch für den TypeScript-Language-Server. Bash erreicht dieselbe Sammlung über
`RAGENTS_ACTORS_DIR`. Vor der nächsten Modellanfrage meldet der Host neue und behobene Fehler
knapp. `actor_program_diagnostics` liefert den letzten vollständigen Stand, mit `name` nur
für das gewählte Programm. Fachtests stehen unter `tests/**/*.test.ts` und verwenden `node:test`.
`actor_program_activate({name, actor?})` prüft, baut, testet und aktiviert den vollständigen Stand.
Die Pakete verwenden feste Abhängigkeiten aus der lokalen Hostinstallation.

Ein neues Backend erzeugt ohne ausdrückliche Bindung einen TypeScript-Actor mit dem Paketnamen.
`actor: "self"` oder `actor: "@handle"` bindet an einen vorhandenen Actor; ein bereits gebundenes
Paket behält seine Zuordnung. Reine Views gehören ohne ausdrückliche Bindung zum aufrufenden
Actor und erzeugen keinen zusätzlichen Actor. Ein Backend mit `onInput` benötigt einen
TypeScript-Actor; bei LLM-Actors verarbeitet weiterhin das Modell die gewöhnlichen Nachrichten.

`ragents.actor-programs` liefert sechs Vorlagen aus `server/templates.ts`: statische View,
Chat, Controls, Textanalyse, Zähler ohne Oberfläche und gemeinsame Liste. Die Kennungen und
Quelldateien stehen in der generierten Bausteinreferenz. `blank` eignet sich für die Karte
"Hallo Welt auf der Arbeitsfläche". Eine reine View braucht keine künstliche Funktion oder Server-Tests.

Für eigene Views `AppLayout` als Rahmen, `Stack` für Abstände und `Grid` für responsive Spalten
verwenden. `AppLayout fill` setzt einen höhenbegrenzten Elternbereich voraus; dann scrollt nur
der Inhalt. Beschriftete Eingaben und Interview-Schritte mit `Form` aufbauen, längere Antworten
als Feldtyp `textarea`. Schrift und Box-Sizing liefert der Host. `ui-field` gehört direkt auf
ein Eingabeelement, niemals auf dessen Wrapper. Die Controls-Demo zeigt mehrzeilige Felder;
die Layoutdemo der Referenz übernimmt eine Antwort ausschließlich lokal. Bestehende Programme
bekommen beim Neuladen die gemeinsame Grundgestaltung, neue Layoutkomponenten erst nach
ausdrücklicher Quellbearbeitung und Aktivierung.

Für einen Ablauf mit Diagramm und LLM-Anleitung lege `src/definition.ts` und die längeren
Anweisungen unter `prompts/` im Actor-Paket an. Verwende `defineWorkflow` aus
`@ragents/workflow`; Rollen und Schritte referenzieren ihre Promptdateien. Serverseitig
erzeugt `workflowInstructions` mit `readPrompt` aus `@ragents/workflow/prompts` die
rollenbezogene Anleitung. Die View erhält Definition und aktuellen Zustand über
`WorkflowDiagram` aus `@ragents/client/ui`. Das Beispiel `learning-afternoon` zeigt den
vollständigen Aufbau. Der [Autorenleitfaden](spec/run-modules.md#connect-workflow-definition-instructions-and-presentation)
beschreibt dynamische Quellen, Freiheitsgrade und die verbleibenden Aufgaben der Steuerung.
Zusätzliche optionale Arbeitspunkte gehören in den Zustand, lange Prompttexte bleiben in Dateien.

Freie Diagramme stehen als `FlowDiagram` aus `@ragents/client/ui` bereit. Übergib `nodes` mit
stabilen lokalen IDs und `edges` mit `source`/`target` sowie eine verständliche Beschreibung
als `label`. React Flow zeigt die Karten, ELK berechnet das Layout. Leite Beschriftungen und
Status aus den App-Daten ab; Statusupdates erhalten die Anordnung. Zoom und Verschieben sind
standardmäßig lokal bedienbar. Mit `viewport="fit-width"` füllt die Grafik automatisch die Breite,
nimmt die erforderliche Höhe ein und lässt ausschließlich das äußere Scrollen zu; `viewport="fit"`
passt Breite und Höhe in den Container ein. `layout="star"` stellt den ersten Knoten in die
Mitte. Knoten können über `items` einzelne Punkte mit eigenen Statusangaben zeigen und über
`actions` Buttons, die `onAction` melden; Kanten tragen optional einen `status`. Fachliche
Änderungen bleiben bei der Mini-App. Fehlerhafte
Verbindungen werden an der Grafik gemeldet. Die erzeugte Bausteinreferenz enthält ein
umschaltbares Beispiel. Für selbst positionierte SVG-Knoten bleibt `SvgEdge` verfügbar.

Funktionen, Werkzeuge und Views teilen den Zustand ihres Actors. Eine Funktion kann mit
`tool` zusätzlich als Agentenwerkzeug veröffentlicht werden. Eingabe und Ergebnis bleiben
identisch; nur `context.state.replace` ändert den Actor-Zustand. Ein Funktionsaufruf aus der
View oder als Werkzeug braucht keinen zusätzlichen Modell-Turn. Erfolgreiche Änderungen
aktualisieren alle zugehörigen Views auch bei ruhendem Chat; lokale Formularentwürfe bleiben.

Jede aktivierte View bekommt eine Kachel. Ihr Actor steht standardmäßig nicht auf der Fläche;
über `Actors` bleiben Chat und Details erreichbar.
`actor_view_set_visibility` blendet eine View aus und wieder ein;
Funktionen, Zustand und Bindung bleiben erhalten. Sichtbarkeit bleibt nach Neustart erhalten.
Der Name in der Kopfzeile wählt ihre Kachel, der Vergrößern-Knopf öffnet die Mini-App als
Dialog über der Arbeitsfläche. Titel und Schließen-Knopf stehen am oberen Rand; die Fläche
darunter wird weichgezeichnet. Kopfzeile, Statusleiste und rechtes Panel bleiben bedienbar.
X, Escape oder ein Klick auf den Dialoghintergrund schließt die Ansicht. Diese Fensterbedienung gehört zum Host; Views besitzen keine
Dialogfähigkeit oder eigene Fenstersteuerung.

Die Vorlage `chat` bindet `UI.Chat` an `context.actor.handle`. Ein anderer `@handle` oder
`primary` kann ausdrücklich gewählt werden; `showInput={false}` blendet die Eingabe aus.
Der Chat des primären Actors teilt den Live-Verlauf des Hauptchats; andere Actors zeigen
Eingaben und abgeschlossene Nachrichten. Eine kontrollierte Chatansicht verwendet stattdessen
`messages` und `onSend`, bei Bedarf `UI.ChatMessages` und `UI.ChatInput` einzeln.

Die Bausteine werden mit `import * as UI from "@ragents/client/ui"` eingebunden. Der Reiter
`Funktionen` zeigt Programme, ihre zugehörigen Actors und Funktionen sowie den installierten
Quellcode. Der Arbeitsstand liegt getrennt unter `@actors`. Headless-Programme erscheinen dort
und in der Actorliste. Ihr Actor bekommt standardmäßig eine eigene Kachel, lässt sich
persönlich ausblenden und benötigt keinen leeren View-Rahmen.

Die neutralen Beispiele in `ragents.reference` sind Demos und mögliche High-Level-Testfälle;
das Plugin gehört zum Profil `showcase` und nicht zu `core`:
Skills mit Beispielaufträgen oder wiederverwendbaren Arbeitsanleitungen, Run-Scripts und
vorgeschaltete Einrichtungsdialoge. Die automatisch erzeugte Übersicht
in `docs/homepage/reference.md` ordnet sie nach Anwendungsfall und Konzeptdemo
sowie nach gezeigter Fähigkeit. Der Katalog und die Schlagworte sind die Quellen, keine zweite
handgepflegte Beispielauflistung. Für jedes Produktkonzept im Katalog werden mindestens zwei
Beispiele geprüft; jeder Skill-Einstieg zählt als ein Beispiel. UI-Controls haben keine
Beispielquote. Demos verwenden die zu ihrem Anwendungsfall passenden Controls, ohne alle
abdecken zu müssen.

Die `description` im Kopf von `SKILL.md` oder `RUN.md` erklärt kurz, was die jeweilige Demo
zeigen soll. Bei ähnlichen Fällen nennt sie den Unterschied. Startauswahl und erzeugte
Referenz zeigen denselben Text.

Jeder Skill-Einstieg hat eine Kategorie als einzelnen freien Text und enthält einen kurzen, frei formulierten Startauftrag, der das gewünschte Ergebnis ohne
Plattformwissen beschreibt. Ein Klick zeigt die Vorschau; "In Auftrag übernehmen" öffnet den
Vorbereitungs-Chat zum Bearbeiten und Besprechen. Die Einstellungen zeigen denselben Prompt mit einer
Kopieraktion.

```markdown
---
name: two-perspectives
description: Zwei Perspektiven auf eine Aufgabe vergleichen.
start: true
title: Zwei Perspektiven
disable-model-invocation: true
category: Zusammenarbeit
order: 10
tags: Anwendungsfall, Konzeptdemo, Agententeams
---
Ich hätte gern zwei unterschiedliche Perspektiven auf meine Aufgabe und eine gemeinsame Empfehlung.
```

`tags` ist optional für allgemeine Plugins und Pflicht im Referenzkatalog. Eine leere oder
doppelte Angabe scheitert beim Einlesen. Die Datei liegt unter `skills/two-perspectives/SKILL.md`;
der Ordnername und `name` stimmen überein. Der Body darf nicht leer sein. Ohne eigenes
`prompt`-Feld ist er zugleich der bearbeitbare Startauftrag. Eine längere Arbeitsanleitung
kann über `prompt` einen kurzen Startauftrag mitbringen und weitere Dateien im Skill-Ordner
verwenden. Ohne `start: true` bleibt der Skill ausschließlich während der Arbeit verfügbar.
`disable-model-invocation: true` nimmt konkrete Demoaufträge aus der automatischen Skill-Auswahl;
die ausdrückliche Auswahl und das Laden bleiben möglich. Die Startfläche gruppiert Skills
nach Kategorie, einschließlich einer eigenen Gruppe Mini-Apps.
Kategorien sind frei wählbar und keine Liste aus dem Code. Der gemeinsame Schlagwortfilter und die Suche
auf der Startfläche machen Anwendungsfälle und Konzeptdemos auffindbar. Auswählen öffnet die
Vorschau; "In Auftrag übernehmen" führt zum Vorbereitungs-Chat im nächsten Dialogschritt.
Dort lässt sich der Auftrag mit einer eigenen Koordinator-Instanz und derselben Modellwahl
besprechen. Nach Deinem ausdrücklichen, sinngemäßen Go startet sie den Run; es ist kein
festgelegter Satz nötig. "Run erstellen" startet weiterhin direkt. Beide Wege übernehmen
Gespräch, Skill und Anhänge; der Knopf nimmt auch die letzte ungesendete Ergänzung mit.
Zurück verwirft den lokalen Vorbereitungsverlauf und erhält die Startauswahl. Ein Skill-Leitfaden
führt nach seinem Abschluss ebenfalls in diesen Vorbereitungschat. Beim Start wird der Skill
mit dem Auftrag übernommen; der bearbeitete Auftrag hat Vorrang vor Beispieltext im Skill.
Run-Scripts stehen in einer eigenen Listengruppe; ihre Aktion
startet den Leitfaden oder den programmierten Aufbau.

## Run-Scripts

Die Homepage-Samples sind in der Startauswahl als Run-Scripts verfügbar: Sammelboard,
Balkon-Wizard, Lernnachmittag und Wortspiel. In der eingebauten Hilfe wählt "Sample starten"
den passenden Einstieg direkt aus. Ein vorhandener Einrichtungsdialog bleibt vorgeschaltet.
Wortspiel und Lernnachmittag bauen ihre Teilnehmer und Mini-App zunächst ohne Modellaufruf
auf; die Arbeit beginnt mit dem Startknopf in der App. Ihre Homepage-Vorschauen verwenden
dieselben Oberflächen mit gekennzeichneten Beispieldaten und rufen keine Modelle auf.

Ein Run-Script baut einen Run mit programmierten Schritten auf. Ein Plugin liefert:

```text
run-scripts/example/
  RUN.md             title, description; optional order, guide, tags, coordinator, fixed-start-options
  package.json       ragents.backend nennt src/server.ts
  src/server.ts      defineActor mit input-Vertrag und onInput
  tests/*.test.ts    Fachtests mit node:test und typisierten Funktions-Mocks
  actors/<name>/     Optionale weitere Actor-Programmpakete
```

`guide` verweist auf eine React-Komponente im Web-Beitrag `guides`. `fixed-start-options` legt
Startoptionen für jeden Run über diese Vorlage fest, als JSON-Objekt in einer Zeile, etwa
`fixed-start-options: {"ragents.workspace.binding": {"kind": "fresh"}}` für einen Ablauf, der nur im
Ordner je Run arbeitet. Die Startfläche zeigt eine festgelegte Option fest statt zur Wahl, "Neuer
Run" in VS Code belegt sie nicht vor, und wer vorher etwas anderes gewählt hat, bekommt beim Start
`start-option-fixed` mit dem Namen der Vorlage. Der Vorbereitungschat nennt diesen Widerspruch schon
vorher an der festgelegten Option, sperrt "Run erstellen" und bietet "Werte der Vorlage übernehmen" an. Der Startwert trägt
`{ "input": ..., "options": { ... } }`: `input` stammt aus `onComplete`, `options` aus den
Startoptionen, festgelegte eingeschlossen. Die Einrichtungsdialoge in
`ragents.reference/web/StartGuides.tsx` zeigen zwei vollständige Beispiele. Gesprächsrunde erwartet
`{ topic, rounds }` (1 bis 160 Zeichen, 1 bis 5 ganze Runden); Sammelboard `{ title, firstEntry }`
(1 bis 160 beziehungsweise 2000 Zeichen). Beide weisen leere oder zusätzliche Felder zurück. `null`
ist der ausdrücklich unterstützte Standardstart aus den Pakettests, kein Ersatz für fehlerhafte
Eingaben.

Der Host aktiviert den Aufbau über denselben Programmdienst wie eigene Actor-Programme.
Der Ordnername bestimmt den Handle; Fähigkeiten stehen im TypeScript-Inputvertrag. Weitere
Pakete werden nach `@actors` kopiert und können vom Setup gezielt aktiviert werden. Die Pakettests
verwenden simulierte Capability-Antworten und prüfen auch ungültige Startwerte.
`reference-run-scripts.test.ts` prüft alle Referenzpakete gegen die echten core-Verträge;
Modellantworten während des späteren Runs sind dadurch nicht vorweggenommen.

`SKILLS_DIR` und `SYSTEM_PROMPTS_DIR` bleiben für deployment-lokale Dateien außerhalb des
Repos verfügbar. Was zum Produkt gehört, liegt beim jeweiligen Plugin.

## Feste Abläufe

Plugin-lokale Skills tragen die immer gleichen Aufgaben, alle für den vom Produkt
konfigurierten Koordinator außerhalb vorbereiteter Runs. Der jeweilige Plugin-Prompt macht die
Regeln verbindlich; der Koordinator darf sich keinen eigenen, kürzeren Weg bauen.

Profile sind ROLLEN mit Vorgaben (`model_list`): in core `coordinator`, `relay` und `standard`.
Das Modell ist keine Eigenschaft der Rolle: `agent_spawn` nimmt `model` und
`thinking` aus der Modellliste (`AGENT_MODELS`) zusätzlich zum Profil an, der Koordinator wählt je
Prüfer ein anderes. Ein Agent ohne Profil bekommt keinen Turn - die Engine rät kein Modell.

Sessions löschen (Mülleimer, ohne Rückfrage) entfernt das Arbeitsverzeichnis und
alle sessiongebundenen Plugin-Daten vollständig. Chat, Wiederherstellungsdaten und Run-Journal
wandern als Archiv nach `${DATA_DIR}/archive/<id>/` und bleiben erhalten. Plugin-eigene
Laufzeitprotokolle werden von ihren Lösch-Hooks beendet und anschließend mit der Session
entfernt.

<!-- guide:clients -->
## Control RAgents as an agent

An AI agent working on the same machine controls RAgents through four `ragents` subcommands. In
a checkout, use `pnpm ragents <command>`. These commands are the agent-facing contract: each one
waits for the turn to end and returns an exit code.

```sh
ragents provision developer                                  # once per machine
ragents run selftest/workspace-project "Fix the type error in src/broken.ts"
ragents send <runId> "Read README.md and report the passphrase"
ragents journal <runId> --tools
ragents stop <runId>                                         # interrupt the primary actor's active turn
ragents stop <runId> --run                                   # emergency stop: halt the whole run
ragents stop --host                                          # stop the remembered host
ragents --help                                               # same as ragents help
```

`run` checks `GET <address>/health` to see whether the profile host is already running. If not,
it starts a detached process with its log at `<data-directory>/host.log`, then records the
address and PID in `<data-directory>/host.json`. It creates a run with a `path` binding to the
absolute folder (`ragents.startOptions.select`), sends the task (`ragents.chat.send`), and follows
the run journal until the turn triggered by its message ends. If the profile does not provide
`ragents.workspace.binding` because it creates its own workspace, the folder remains unbound and
the command reports this on stderr.

`--entry <entry>` additionally starts the run through a skill or run script. If that program
chooses its chat partner during setup, the task waits instead of failing. `send` performs the
same operation in an existing run. `journal` reads the history without a server, using the same
code as `pnpm driver journal`. `stop <runId>` interrupts only the active turn of the run's primary
actor through `ragents.runs.interruptTurn`, exactly like the stop button in the chat input: the
run and all actors stay active and accept the next task, and without an active turn nothing
happens. `stop <runId> --run` is the emergency stop (`ragents.chat.stop`): it aborts every turn
and stops all actors of the run. `stop --host` terminates exactly the PID in `host.json`, never a
process pattern, and only if the host at the recorded address reports that same PID from
`/health`; otherwise it fails, leaves the process alone and removes the stale record. `ragents --help` and `ragents help` show usage and exit with 0; invoking the
command without arguments is an error with exit code 1.

`--profile <profile|path>` selects something other than `developer`: a profile name beside the
host or the path to a custom `ragents.config.<profile>.ts` anywhere on disk. Resolution matches
`ragents start` and is relative to the caller. `RAGENTS_PROFILE` selects the same profile for all
commands in a shell. The file name determines the profile name, while the profile file supplies
the port and data directory as it does for the server. `stop --host` can therefore find the host
for that exact profile:

```sh
export RAGENTS_TOKEN="$MY_RAGENTS_TOKEN"
ragents run ~/projects/example "Implement work item 1234" \
  --profile ~/profiles/ragents.config.custom.ts \
  --entry custom.tickets.implement-task
ragents stop --host --profile ~/profiles/ragents.config.custom.ts
```

If the profile requires sign-in through `users`, `RAGENTS_TOKEN` must contain the personal token
declared for that user as `token: env("...")` (see `docs/spec/profiles.md`). A password alone is
not enough because the command has no sign-in dialog. If the token is missing, the command says
that the profile requires authentication and asks you to set `RAGENTS_TOKEN` to the user's
personal token.

stdout contains function calls (`> <name> <input>`, `< <name> <duration>s ok`, or `Error: ...`),
the model response, and finally the fixed line `run: <id>`. Messages from the command itself go
to stderr. With `--json`, journal events are emitted as newline-delimited JSON instead. Exit code
0 means `turn.finished` with `outcome: "completed"`; 2 means `turn.interrupted`; 1 means a failed
turn or connection problem.

The address comes from the profile's `host.json`, then `RAGENTS_URL`, then `host.PORT` in the
profile file. When authentication is required, `RAGENTS_TOKEN` is sent as a bearer token. The
data directory is the server's `DATA_DIR`, then `host.DATA_DIR`, then
`~/.local/share/ragents/<profile>`. Because server, project, and journal are on the same machine,
the command reads history directly from `<data-directory>/runs/<runId>/journal.jsonl`. A host
started this way also serves the web interface, which comes finished with the host;
`ragents start developer` (or `scripts/start.sh developer` in a checkout) starts it in the
foreground instead. `ragents start` writes the same `host.json` and removes it on shutdown,
so `stop --host --profile <profile|path>` handles either startup path. Only `--port 0` cannot be
remembered because it chooses its own port. The short guide for agents is in
`skills-for-agents/ragents/SKILL.md`.

## Drive runs from external clients

`pnpm driver` (`scripts/driver/run-driver.ts`) creates and controls runs without an interface and
analyzes their journals. It is a testing tool for custom runs and later analysis. An agent should
use `ragents run` instead because it waits and returns meaningful exit codes:

```sh
PRODUCT_PROFILE=showcase pnpm driver new-run                 # creates a run and prints its ID
PRODUCT_PROFILE=showcase pnpm driver send <id> @coordinator "Task ..."
PRODUCT_PROFILE=showcase pnpm driver journal <id> --since 120 --tools
PRODUCT_PROFILE=showcase pnpm driver usage <id>              # model calls and tokens per actor
PRODUCT_PROFILE=showcase pnpm driver stop <id>              # interrupts the primary actor's turn
PRODUCT_PROFILE=showcase pnpm driver stop <id> --run        # emergency stop for the whole run
```

`new-run` starts a run script; without an argument it uses `ragents.reference.shared-actor-list`,
which only `showcase` contains, and `new-run <entry>` selects another one.

The address comes from `host.PORT` in the profile file, with `RAGENTS_DRIVER_URL` as an override;
the data directory comes from `DATA_DIR` or the profile default. If the profile defines users,
`RAGENTS_DRIVER_USER` is required. The driver reads that user's password from the same profile
file and signs in through `POST /api/access/login`. If `ACCESS_TOKEN` is set, it sends that as a
bearer token instead. The driver uses `ragents.chat.start`, `ragents.chat.sendToActor`,
`ragents.runs.view` with `ragents.runs.interruptTurn` for `stop`, `ragents.chat.stop` for
`stop --run`, and `ragents.sessions.list`, while reading the journal directly from
`${DATA_DIR}/runs/<uuid>/journal.jsonl`.

The same methods are available to any client. The API uses JSON-RPC 2.0. Over HTTP, `POST /rpc`
accepts one message per request, while `GET /rpc/stream` delivers server notifications and
requests as Server-Sent Events:

```sh
curl -s http://localhost:4710/rpc -H 'content-type: application/json' \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"ragents.sessions.list","params":{}}'
```

The response contains either `result` or `error`; `error.data` provides `code` and `status`.

Without HTTP, use stdio: `pnpm start -- --stdio` exchanges one JSON message per line through
stdin and stdout and opens no port. The startup modes are:

- `--stdio` without `--port`: stdio only, no HTTP server.
- `--port 0`: a private port; the server reports it on stdout as
  `{"ragents":{"url":"...","token":"...","pid":1234}}`.
- `--port N`: fixed port N instead of `host.PORT` from the profile file.
<!-- /guide:clients -->

<!-- guide:distributed -->
## Work without a checkout

Using RAgents does not require a repository. `pnpm build:package` creates the npm package
`@schlenkr/ragents` from this checkout in `dist/ragents`; with `--pack`, it also creates
`dist/schlenkr-ragents-<version>.tgz`. The package contains the server, engine, executor, all
plugins, and the scripts behind its subcommands. From the documentation it includes only
`LICENSE` and a separate English `README.md` for the npm listing, sourced from
`scripts/package/README.md`. It carries the finished web interface and every built-in plugin as a
bundle, so nothing is built on the user's machine. Its `package.json` records the source commit as
`ragents.hostVersion`. Install it like any other npm package:

```sh
npm install -g @schlenkr/ragents
RAGENTS_TOKEN=<token> ragents connect https://ragents.example.com
```

Only Node 22 is required: no Git, pnpm, `pnpm install`, or build. The subcommands are:

- `ragents run <folder> "<task>"`, `send`, `journal`, and `stop` let an agent work on a project.
- `ragents connect <server-url>` fetches a client profile with its plugin bundles, provisions
  tools, and starts a server. It supports `--port <n>`, `--clean`, and `--no-start`, like
  `pnpm connect`.
- `ragents start <profile|path>` starts an included profile (`core`, `developer`, or `showcase`),
  a custom `ragents.config.<profile>.ts` anywhere on disk, or a previously fetched version.
- `ragents provision [<profile>|--workspace]` installs only the required tools.
- `ragents workspace-client <server-url> [folders ...]` registers this machine as a workspace.
- `ragents plugin build <folder...>` builds plugin sources into bundles, with type checks; see
  [Build and ship a plugin](homepage/guide-extensions.html).

The package runs like the checkout, with the same files in the same places and TypeScript loaded
at runtime through `tsx`. On first use, the command creates the `node_modules/@ragents/*`
links that pnpm supplies in a checkout. This is idempotent and requires no elevated privileges.

### Custom profiles and plugins

A developer will usually keep a custom profile and plugins somewhere on disk. `ragents start
<path>` starts it from the package, while `ragents run --profile <path>` runs it without an
interface for an agent. Both resolve the path in the same way:

```sh
ragents start ~/projects/mine/ragents.config.mine.ts
ragents run ~/projects/mine "Build this" --profile ~/projects/mine/ragents.config.mine.ts
```

The file must be named `ragents.config.<profile>.ts`; that name becomes the profile name. Startup
provisions the plugin tools and then starts the server. Nothing is built: the package carries the
finished web interface, which is the same for every profile, and the server loads the web halves
of the profile's plugins from their bundles at runtime.

The server loads plugins only as bundles. The package carries its built-in plugins as bundles
under `bundles/`; a custom plugin is built first with `ragents plugin build <source-folder...>`,
which writes `./dist/plugins/<custom-plugin-id>` by default. The package brings everything this
build needs, including the type checks against the host API. The profile names that bundle by a
path relative to the profile file, such as `"./dist/plugins/<custom-plugin-id>"`; a source folder
in the profile stops the start and names the build command. A bundle imports from the host only
the modules of the host API list, resolved by `apps/server/src/host-resolution-hooks.mjs`, and
must be rebuilt when the host API changes. Its `web/` half is served under `/plugins/<id>/web/`
and loaded by the browser; its Tailwind classes join the one stylesheet the server compiles at
startup. The build tool bundles libraries such as `lucide-react` from the host, so the package
also includes the dependencies declared by `apps/web/package.json`. The host does not check
whether such a bundle still matches its sources; rebuild it before starting.

An external plugin project can use a `host` symlink to access host tools. With a package
installation, that link points to the package instead of a checkout. Set `RAGENTS_HOST` to the
appropriate location:

```sh
export RAGENTS_HOST="$(npm root -g)/@schlenkr/ragents"
```

A script in the external repository can create the `host` symlink from that value. If that script
identifies a checkout by `pnpm-workspace.yaml`, it should test for something the package shares
instead, such as `apps/server/src/main.ts` beside `package.json`. Start with `ragents start <path-to-profile>`;
the symlink is used only by scripts and tsconfig files in the external repository.

The VS Code extension starts the same profile from the same package. Set `ragents.hostPath` to
the package directory (`<npm-prefix>/lib/node_modules/@schlenkr/ragents`) rather than a checkout.
If the setting is empty and the extension is not running from a checkout, it fetches the package
itself as described under Run panel and VS Code extension.
<!-- /guide:distributed -->

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
bricht der Lauf ab. Abgelehnt wird weiterhin eine Fassung, die auf npm schon liegt - nach dem
Hochzählen kann das nicht mehr passieren, die Prüfung bleibt trotzdem stehen. Nach dem Publish
nennt das Script die veröffentlichte Fassung; die Registrierung braucht danach noch ein paar
Sekunden, bis sie sie ausliefert und anzeigt. Die VS-Code-Tasks `package: build` und
`package: publish` rufen dieselben Skripte, `publish: all` (`pnpm publish:all`) veröffentlicht
Paket und Erweiterung nacheinander und bricht beim ersten Fehler ab; `npm_key` kommt dort aus der
Umgebung von VS Code.

<!-- guide:distributed -->
## Connect to a server

A developer can run RAgents locally with the profile and models of a central server. This
requires a local host with the same host API as that server: either the `@schlenkr/ragents`
package, which needs only Node, or this checkout with Git, Node, pnpm, `pnpm install`,
`pnpm build:agent`, `pnpm build:plugins`, and `pnpm build:web`. It also requires a personal token
for a user in the server profile with `profile.fetch` and `models.use` permissions:

```sh
RAGENTS_TOKEN=<token> ragents connect https://ragents.example.com
RAGENTS_TOKEN=<token> ragents connect https://ragents.example.com --port 4720 --clean
RAGENTS_TOKEN=<token> ragents connect https://ragents.example.com --no-start
```

In a checkout, the same command is `pnpm connect <server-url>` and uses the same implementation.

`connect` fetches the client-profile description and checks the local host before it downloads
anything. The host must offer the host API number the server's bundles were built against, and it
must have a built-in bundle for every plugin the profile names by ID. The same commit is not
required. On a mismatch, `connect` stops and names the fix: `npm install -g
@schlenkr/ragents@<version>` for the package, where the server supplies the version, or the
server's commit plus `pnpm build:plugins` and `pnpm build:web` in a checkout. It then downloads
the archive, which holds only the profile file and the finished bundles it names by path,
verifies its SHA-256, stores the version under
`~/.local/share/ragents/remote/<host>/<profile>/profiles/<version>/`, and starts the server with
that profile. Data goes to `~/.local/share/ragents/remote/<host>/<profile>/data/`, and the web
interface is the local host's own; nothing is built or installed on the developer machine.
Existing versions are not downloaded again. `--clean` removes older ones, `--no-start` stops after
fetching and reports the profile and data paths, and `--port <n>` overrides the profile port.
`ragents start <profile>` can restart an included profile or the latest fetched version without
contacting the server. Personal `env(...)` values from the client profile, such as the relay
token, must exist in the shell. Between download and startup, `connect` provisions language
servers and the browser; a prerequisite it cannot install, such as `dotnet` or a separate Chrome,
stops with instructions.

The server needs `ragents.profile-distribution` with `CLIENT_PROFILE_FILE`, plus
`ragents.model-relay` with `RELAY_MODELS` for models. Plugins the client profile names by path
must be bundles built with `ragents plugin build`; the server checks them at startup. Users
receive `token: env("...")` and the two permissions. Relay responses and all client-profile
content, including prompts, skills, run scripts, bundles, and configuration, are present on the
developer machine. Only the provider, actual model, and key remain secret. The relay replaces
`model` with the alias and removes `provider`, so model context, journal, catalog, and interface
expose only the alias.

### Common first-run pitfalls

- Two environment variables, often with the same value, are needed: `connect` reads
  `RAGENTS_TOKEN`, while the name used by `RELAY_TOKEN: env("...")` must also be set.
- `COMPACTION_PROVIDER: "relay"` with an empty `COMPACTION_MODEL` can start without a text model
  at reasoning level `off`; automatic titles stay disabled and Settings explains why. An
  explicitly named alias must be such a model or startup fails.
- The relay must be reachable when the local server starts because it fetches the alias catalog
  once. Alias changes require restarting the local server.
- Revoking access affects the next model request immediately, not the running server process.
  The run then ends as failed and records the relay response in the journal.
- Rejected requests appear in the relay server's `logs/server.log`, not `relay.log`. The latter
  records only forwarded calls with user, alias, target, status, and token count.
- The archive carries no web interface. After updating the host package, a fetched version
  starts with the new web interface as long as the host API stays the same. Otherwise the start
  refuses the fetched bundles, and `connect` names the version to install.

## Transfer a run

A run can move from one server to another and continue there, for example from a notebook to an
always-on machine or from a central server to a developer for local inspection.

```sh
RAGENTS_TOKEN=<token> pnpm run-transfer http://localhost:4723 http://server.example:4724 <runId>
RAGENTS_TOKEN=<token> pnpm run-transfer <source> <target> <runId> --workspace /path/to/project
```

The script exports the run from the source with `ragents.runs.export` and imports it on the target
with `ragents.runs.import`. If each side uses a different token, set `RAGENTS_SOURCE_TOKEN` and
`RAGENTS_TARGET_TOKEN`. The transfer includes the journal and payloads, model contexts under
`chat/`, actor programs, and all plugin storage for the run, including `ragents.documents` files
and the workspace of a run with a `fresh` binding. Running processes, language servers, and
browsers are not transferred; they are recreated on the target when next used.

The transfer enforces these prerequisites:

- Both servers use the same host version and workspace executor. There is no override.
- The run is stopped, with no active turn or waiting input.
- Its ID is unused on the target. An existing run, folder, or archive entry rejects the import.
- A run bound to a source project folder needs `--workspace <path>` pointing to an existing
  target folder, given as an absolute path on the target server. A workspace binding is retained; that workspace reconnects to the target with
  the same ID and as the run owner, or anonymously for an ownerless run.
- The archive must stay below 16 MiB because it travels as Base64 through the message layer.
  A workspace containing `node_modules` will exceed this; a `path` binding usually will not.

Export copies the run. It remains on the source and must be deleted there explicitly after a
real move, otherwise two journals with the same ID diverge. On the target, the run appears
stopped and continues with the next message. Its model context still contains absolute source
paths; reusing one fails at the workspace boundary, while a relative path reaches the target.
After transfer, inspect the journal with `pnpm driver journal <runId>` and plugin storage under
`${DATA_DIR}/sessions/<runId>/plugins/`.

## Work on Windows

The local host and workspace also run on Windows. Requirements are:

- **Git for Windows** for Git Bash. The executor checks `%ProgramFiles%\Git\bin\bash.exe`, then
  `%ProgramFiles(x86)%\Git\bin\bash.exe`, then `bash.exe` on `PATH` for Cygwin or MSYS2. If none
  is found, every `bash` call fails with installation instructions. PowerShell and `cmd.exe` are
  not used.
- **Node.js** is enough with `@schlenkr/ragents`. A checkout additionally needs **pnpm**, and
  `pnpm install`, `pnpm build:agent`, and `scripts/start.sh` run in Git Bash.
- The **.NET SDK** is required when the profile includes Roslyn or FSAC. Provisioning downloads
  the language servers; the TypeScript server comes from the host directory.

The data directory is `%LOCALAPPDATA%\ragents\<profile>` and server-provided profiles use
`%LOCALAPPDATA%\ragents\remote\<host>\<profile>\`. `DATA_DIR` overrides this. Startup fails when
`LOCALAPPDATA` is absent. Unix permissions 0700 and 0711 do not apply on Windows, where session
isolation depends on the user account.

Windows has no process group for command termination, so RAgents ends the process tree with
`taskkill /T /F`. This is forceful and has no grace period. There is also no process table: for
runs using a Windows workspace, the process rail explains this limitation. Stopping a run still
terminates Bash process trees, while a deliberately detached service continues. Workspace tools
do not depend on the process rail.

Windows support has not yet been exercised on a physical Windows machine. It is implemented and
covered by unit tests that simulate the platform. A first real run should verify `pnpm connect`,
`read`, `edit`, `bash` output and cancellation, diagnostics, and a workspace through
`pnpm workspace-client`.
<!-- /guide:distributed -->

## Datenablage und Protokolle

Standardmäßig liegt jedes Profil unter `~/.local/share/ragents/<profil>`, unter Windows unter
`%LOCALAPPDATA%\ragents\<profil>`. Die Reihenfolge
ist `DATA_DIR` aus der Umgebung, `host.DATA_DIR` aus der Profildatei, dann dieser Standard.
Das gilt für `scripts/start.sh` und den direkten Serverstart. Vor dem Build beziehungsweise der
Serverinitialisierung werden vorhandene Pfadvorfahren einschließlich Symlinkzielen geprüft:
`.git`, `pnpm-workspace.yaml` und `package.json` sind dort nicht zulässig. So übernehmen
Buildwerkzeuge keine Konfiguration des RAgents-Quellbaums. Ein ausdrücklicher externer Pfad
bleibt eine gültige Einstellung. Unterhalb des Datenordners liegt neben den Laufzeitdaten
`tools/<plugin-id>/`: die Werkzeuge, die `pnpm provision` für die Plugins dieses Profils holt.

Für einen bewussten Umzug zuerst den Server und seine Run-Prozesse beenden. Den gesamten
Profilordner einschließlich Journale, Payloads, Arbeitsverzeichnisse und Pluginzustände
verschieben. Enthalten gespeicherte Runs absolute alte
Pfade, kann ein ausdrücklich angelegter Symlink vom alten zum neuen Profilordner diese
Referenzen erhalten. Der Start erstellt diesen Link nicht selbst und schreibt keine Journale
um. Die physische neue Ablage muss außerhalb eines Git-/Paketprojekts liegen.

Die Ablage eines Runs ist über wenige feste Verzeichnisse verteilt und im Journal vollständig
zugeordnet. `apps/server/src/layout.ts` besitzt die produktneutralen Run-, Session-, Archiv- und
Logpfade. Die Plugin-Ablage ist reine Konvention und nicht deklarierbar: `host.storage` liefert
global `plugins/<pluginId>/` und je Unterhaltung `sessions/<sessionId>/plugins/<pluginId>/`.

```
${DATA_DIR}/
  runs/<sessionId>/journal.jsonl  kompaktes Engine-Journal v4 mit Commands und Events
  runs/<sessionId>/payloads/      unveränderliche große JSON-Inhalte, je SHA-256 eine Datei
  artifacts/<sha256>              unveränderliche Artefaktinhalte
  sessions/                       0711 root: durchquerbar, aber nicht auflistbar
    <sessionId>/                  0711 root
      chat/<agentId>/             0700 root - Agent-Sitzung je Agent (Modellkontext über Turns hinweg)
      plugins/                    0711 root - je Plugin genau ein Unterordner
        ragents.documents/
          documents/              Dateiablage der Unterhaltung (document_write), ohne DOCUMENTS_DIR
        ragents.workspace/
          workspace/              leeres Arbeitsverzeichnis bei Bindung fresh, befüllt ein Resolver-Plugin;
                                  bringt der Beitrag eine eigene Art mit, liegt sein Ordner in dessen Ablage
          server/                 nur bei Bindung an einen Arbeitsplatz und erst bei Bedarf: Ordner für
                                  typescript_eval und Actor-Programme, die auf dem Server laufen
          home/                   HOME der Sandbox
  delete-intents/                 0700 root - vermerkte Löschabsichten
    <sessionId>.json              0600 root - ein beim Absturz unterbrochenes Löschen wird
                                  beim nächsten Start daran erkannt und zu Ende geführt
  recovery/                       0700 root - Wiederherstellungsdaten je Run; wandern beim
                                  Löschen mit ins Archiv (heute legt noch nichts darin ab)
  archive/<sessionId>/            Chat, Wiederherstellungsdaten und Journal gelöschter Unterhaltungen
  transfer/                       Arbeitsordner des Run-Umzugs: manifest.json während eines
                                  Exports, import/ während eines Imports; beides wird danach
                                  wieder entfernt
  plugins/<pluginId>/             globale Ablage je Plugin, soweit benötigt
  logs/server.log                 Serverlauf, HTTP-Zugriffe, Fehler, Abstürze (Rotation 32 MB x3)
```

Servergelieferte Profile (`pnpm connect`) liegen daneben unter
`~/.local/share/ragents/remote/<host>/<profil>/`: `profiles/<stand>/` je geholtem Stand und
`data/` als `DATA_DIR` des lokalen Servers mit derselben Struktur wie oben.

Ein einzelner Run wechselt den Server nicht von Hand, sondern mit `pnpm run-transfer` (siehe
"Transfer a run"). Ein Journal-Backup oder manueller Umzug umfasst immer den gesamten `runs/<sessionId>/`-Ordner,
also auch `payloads/`. Die einzelne JSONL-Datei reicht bei ausgelagerten Inhalten nicht.
Die Archivierung gelöschter Runs übernimmt diesen Ordner vollständig. Andere Run-Daten wie
Modellkontexte und Arbeitsdateien bleiben zusätzlich erforderlich. Journale früherer Dateiformate
werden für den betroffenen Run abgewiesen; der Server startet trotzdem. Auch beschädigte oder
unvollständige Journale und fehlende Inhaltsdateien betreffen nur ihren Run. Das Serverprotokoll
nennt Run-ID, Dateipfad und Ursache. Gesperrte Runs erscheinen nicht in der Liste nutzbarer
Unterhaltungen; ein direkter Zugriff meldet den Fehler `journal-unavailable` (Status 409). Die Dateien
bleiben erhalten und werden nicht automatisch migriert, verschoben oder gelöscht. Auch ein
altes Journal des globalen Koordinators verhindert den Serverstart nicht; sein ausdrücklich
bestätigter Gesprächsreset beginnt danach wieder ein neues Gespräch. Für andere Runs kann eine
bewusste Reparatur mit anschließendem Neustart die vorhandene Ablage wieder nutzbar machen.
Ein frischer gesamter Datenbestand ist nicht erforderlich.

Es gibt keine automatischen Migrationen und keine Suche nach alten Datenpfaden. Bestehende
Bestände werden nur auf ausdrücklichen Auftrag bei gestopptem Server umgezogen; der Server
zieht nichts selbst um und löscht keinen alten Bestand.

Lesen: `tail -200 ${DATA_DIR}/logs/server.log`, `ls ${DATA_DIR}/sessions/<id>/chat/`.

Die Rechte sind so gesetzt, dass eine Session ihr eigenes Arbeitsverzeichnis erreicht, aber weder
die Nachbarsessions auflisten noch deren Chat und Plugin-Protokolle lesen kann. Die
Plugin-Protokolle überleben einen Stopp; ein Plugin-Log wird pro Start mit einer
`=== Start: ... ===`-Zeile fortgeschrieben statt überschrieben. In den Log kommen nur
Pfade, nie Query-Strings, damit kein Zugangstoken auf Platte landet.

Die Session-ID verbindet diese Verzeichnisse.

## Session-Isolation

Jede Unterhaltung arbeitet in ihrem eigenen Arbeitsverzeichnis und ihrer eigenen Dateiablage.
Die Datei-Werkzeuge prüfen jeden Pfad nach Symlink-Auflösung gegen den Arbeitsbereich der
Session plus die Skills. Welcher Ordner das ist, legt die Startoption "Arbeitsbereich" beim Start
fest: ein leerer Ordner unter den Laufzeitdaten, ein vorhandener Ordner auf dem Serverrechner oder
der Ordner eines verbundenen Arbeitsplatzes (etwa der VS-Code-Erweiterung). Ein Profil kann die
erste Art durch einen eigenen Arbeitsbereich ersetzen - dann steht dessen Name in der Auswahl, und
ein Ordner des Serverrechners entfällt dort. Ein gebundener Ordner wird beim Löschen des Runs nie
angefasst. Bei einer Bindung an einen Arbeitsplatz ist dessen Ordner das ganze
Arbeitsverzeichnis: der Agent sieht denselben Pfad, in dem seine Werkzeuge arbeiten, und der
Reiter Dateien zeigt diesen Ordner mit dem Namen des Arbeitsplatzes. Nur was auf dem Server läuft,
`typescript_eval` und die Actor-Programme, bekommt dort bei Bedarf einen eigenen Ordner des Runs;
eine Snippet-Datei für `typescript_eval` mit `path` kommt trotzdem vom Arbeitsplatz. Aliasse des
Servers wie `@actors` gibt es auf dem Arbeitsplatz nicht. Ein Arbeitsplatz gehört dem Benutzer, der ihn
angemeldet hat: die Auswahl und `ragents.workspace.clients.list` zeigen jedem nur seine eigenen,
und ein Run arbeitet nur auf dem Arbeitsplatz seines Eigentümers, auch wenn ein anderer Benutzer
einen mit derselben Kennung anmeldet. Jedes VS-Code-Fenster ist ein eigener Arbeitsplatz mit eigener
Kennung; zwei Fenster verdrängen sich nicht. Ist der Arbeitsplatz eines Runs nicht verbunden,
scheitert jeder Werkzeugaufruf mit `workspace-client-disconnected`, bis er sich wieder meldet.
Anmelden darf einen Arbeitsplatz über das Netz nur ein angemeldeter Benutzer eines Profils mit
`users`; ohne Benutzer (offener Server, `ACCESS_TOKEN`, `anonymousUser`) nimmt der Server ihn nur
über eine Loopback-Verbindung an, sonst lehnt er mit `workspace-client-login-required` ab. Die
VS-Code-Erweiterung versucht es in diesem Fall gar nicht und nennt den Grund an der Umgebung.
Bei einem Arbeitsplatz läuft alles, was den Ordner anfasst, dort, wo er liegt: Werkzeuge,
Sprachserver, der Reiter Dateien, die Prozessleiste und der Browser der Browserprüfung. Der
Server reicht jede Operation über
`ragents.workspace.client.execute` an den Executor des Arbeitsplatzes weiter, der dieselbe Version
des Pakets `@ragents/workspace-executor` trägt. Bricht die Verbindung mitten in einem Aufruf,
nennt die Ursache den Arbeitsplatz ("hat die Verbindung verloren"), nicht den Ereignisstrom.

Ohne VS Code meldet `pnpm workspace-client <server-url> [ordner ...]` denselben Arbeitsplatz von
der Kommandozeile an; `RAGENTS_TOKEN` setzt den persönlichen Token, wenn der Server eine Anmeldung
verlangt. Der Arbeitsplatz liest seine Sprachserver und seinen Browser aus seiner eigenen
Prozessumgebung, nicht aus dem Profil des Servers: der Start ruft `pnpm provision --workspace`,
legt Roslyn und fsautocomplete unter `~/.local/share/ragents/workspace/tools/<plugin-id>/` ab und
holt Chromium in den Browsercache von Playwright; TypeScript und `playwright-core` kommen aus dem
Host-Ordner. `ROSLYN_LANGUAGE_SERVER`, `FSHARP_LANGUAGE_SERVER` und `BROWSER_EXECUTABLE_PATH`
übersteuern das. Die VS-Code-Erweiterung provisioniert dasselbe beim Start und schreibt den Bericht
in ihren Ausgabekanal `RAgents`. `HOME` bleibt das Home des Entwicklers, damit Git, SSH und NuGet mit seinen Zugangsdaten
arbeiten; Sprachserver-Protokolle landen unter `os.tmpdir()`. Jeder Werkzeugaufruf des Modells
erscheint als eine Zeile auf stdout (Run-Kennung, Werkzeug, Dauer, `ok` oder Fehlertext); die
VS-Code-Erweiterung schreibt dieselbe Zeile in ihren Ausgabekanal `RAgents`. Abfragen der
Oberfläche, etwa der Reiter Dateien oder die Prozessleiste im Zwei-Sekunden-Takt, erscheinen dort
nicht.

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
Sitzungsmarkierung; Reste eines abgebrochenen Laufs räumt der nächste zu Beginn ab. Der erste
Image-Bau braucht Netz (Node-Image, npm, mit `--browser` Chromium aus Debian); danach kommen diese
Schichten aus dem Cache, und nur das Paket wird neu gebaut. Nach einem Fehlschlag bleiben die
Protokolle unter `/tmp/ragents-rwc-protokoll-<sitzung>`. Einzelheiten stehen in
`scripts/remote-workspace/README.md`.

Beim Bash-Abschluss prüft der Host unter macOS einen Signalfehler `EPERM` zusätzlich anhand
von Prozessgruppen-ID und Status. Bereits beendete Zombie-Einträge verdecken so keine
Befehlsausgabe mehr. Echte Berechtigungsfehler und fehlgeschlagene Prüfungen bleiben sichtbar.
Ein Fehler des ausgeführten Build- oder Generierungsbefehls muss weiterhin separat behoben werden.

## Sicherheits-Lockdown der Agentenlaufzeit

Alle Einschränkungen stecken in der Engine-Konfiguration beim Serverstart (weder Modell noch
Client können sie ändern): Der Systemprompt wird geordnet aus den Beiträgen der aktiven Plugins
zusammengesetzt. Skills kommen ausschließlich aus deren registrierten Pfaden. Die Werkzeuge stammen
aus dem RAgents-Core und der Plugin-Registry statt aus einer frei wählbaren Liste. Die
Agentenlaufzeit liest weder Einstellungs- noch Zugangsdateien; feste Profile binden die Modelle.
Capabilities begrenzen die Orchestrierung und ihre Delegation.
Workspace-Werkzeuge bleiben sichtbar; Rollen werden im Prompt beschrieben und die technische
Grenze ist die Sandbox der Session. Bash ist darin erlaubt.
