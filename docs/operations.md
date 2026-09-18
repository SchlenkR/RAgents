# Betrieb und Fachdetails

Was die Plugins im laufenden Betrieb tun und was man wissen muss, um sie zu bedienen. Wie das
System aufgebaut ist, steht in `docs/spec/`; das Warum in `docs/decisions.md`.

<!-- guide:getting-started -->
## Ein Sample auswählen

Ein Sample bringt seinen Aufbau und seine Oberfläche mit. Die KI muss beides nicht erst
aus einem Auftrag erstellen. In der eingebauten Hilfe führt "Sample starten" zum gewählten
Ablauf. Alternativ öffnest Du über "Neuer Run" die Startauswahl und wählst das Run-Script.

Beim Start zeigt die noch leere Arbeitsfläche einen Ladebalken und den aktuellen
Vorbereitungsschritt. Danach erscheinen die Agenten und Mini-Apps automatisch. Fehler
oder Rückfragen werden als Hinweis angezeigt; der Balken läuft dann nicht einfach weiter.

| Sample | Was Du ausprobieren kannst |
| --- | --- |
| [Wortspiel](../homepage/reference.html#start-ragents.reference.word-game) | Vier Modelle liefern Wörter; TypeScript regelt die Reihenfolge und endet nach zwölf Beiträgen. |
| [Lernnachmittag](../homepage/reference.html#start-ragents.reference.learning-afternoon) | Zwei Modelle arbeiten parallel; ihre Ideen erscheinen in einer gemeinsamen Liste. |
| [Sammelboard](../homepage/reference.html#start-ragents.reference.shared-actor-list) | Einträge über Chat und Oberfläche in derselben Liste pflegen. |
| [Balkon-Wizard](../homepage/reference.html#start-ragents.reference.balcony-wizard) | Ein Interview über eine Mini-App führen; ein Modell stellt die Fragen. |

Wortspiel, Lernnachmittag und Balkon-Wizard warten nach dem Aufbau auf den Startknopf in ihrer
Mini-App. Erst dann beginnt die Modellarbeit. Beim Sammelboard legst Du vorher Titel und ersten
Eintrag fest; der Helfer trägt ihn anschließend ein. Die Modelle verwenden die Einstellungen
Deines Profils. Die Homepage-Vorschauen zeigen feste Beispieldaten und rufen keine Modelle auf.

Wenn RAgents noch nicht läuft, richte es mit den folgenden Schritten lokal ein.

## Canvas oder Kacheln verwenden

Unten in der Statusleiste schalten "Frei" und "Kacheln" die Darstellung um. Frei ist die
Vorgabe mit Verschieben und Zoom. Kacheln füllen die verfügbare Fläche; Übersicht und Zoom
sind dann deaktiviert. Die Karten behalten ihre Flächen, Konturen und Radien und haben im Kachelmodus keine Tiefe.
Chat-Actors und Mini-Apps starten im freien Canvas einheitlich mit 720 mal 520 Pixeln
und lassen sich am Größenanfasser bis auf 2880 mal 2700 Pixel vergrößern.
Mini-App-Inhalte verwenden in beiden Modi und der Vollansicht 90 Prozent Skalierung
(bei 100 Prozent Canvas-Zoom). Ziehe einen Actor oder eine Mini-App aus der Kopfzeile auf eines der
Andockziele einer Kachel. Links/rechts teilt nebeneinander, oben/unten übereinander. Die
Andockziele am Außenrand teilen die ganze Fläche. Vor dem Loslassen zeigt eine Vorschau den
entstehenden Bereich. Bestehende Kacheln ziehst Du an ihrer Titelleiste; das X entfernt sie
aus der Aufteilung. Die Inhalte bleiben über die Kopfzeile erreichbar. Ohne Zugriff auf die Actors-Ansicht
entfallen Entfernen und Umordnen: X und Verschiebegriff werden ausgeblendet. Die Trenner
zum Anpassen der Größenverhältnisse bleiben verfügbar.

Ziehe die Trenner auf das gewünschte Verhältnis; beim Loslassen wird es gespeichert.
Escape verwirft die laufende Größenänderung. Mit Tastaturfokus auf einem Trenner ändern
Pfeiltasten die Größe, Home und End setzen die erlaubten Grenzen. Bei wenig Platz zeigt die
Auswahl "Sichtbare Kachel" jeweils einen Inhalt, ohne die Aufteilung zu verwerfen.
Du kannst auch den Koordinator bitten: "App links, Chat rechts, 50:50" oder "Eine Kachel oben,
darunter zwei im Verhältnis 2:1". Eigene Änderungen bleiben gespeichert, solange das Programm
seine Anordnung nicht ändert. Eine neue Programmanordnung wird automatisch übernommen,
damit ergänzte Kacheln sofort erscheinen. "Programmvorgabe übernehmen" setzt eine eigene
Anordnung auch vorher zurück.

## Lokal installieren

Die Anwendung wird aus dem Repository mit Node.js und pnpm gebaut. Führe im Repository-Wurzelordner
zuerst diese Befehle aus:

```sh
pnpm install
pnpm build:agent
```

Der zweite Befehl erzeugt die Typdeklarationen der Agentenlaufzeit und ist nach einem frischen
Klon erforderlich. Das Profil `core` enthält die neutrale Arbeitsumgebung mit Chat, Agenten,
TypeScript-Funktionen und Mini-Apps. Seine Einstellungen stehen in `ragents.config.core.ts`.
Ein Profil wählt Plugins, Modelle und Konfiguration; es ist kein einzelner Agentenauftrag.

## Modellzugang konfigurieren und starten

Die Modellanbindung verwendet OpenRouter. Konfiguriere in der Sektion `ragents.product` der
Profildatei `OPENROUTER_API_KEY` als Referenz auf eine eigene Umgebungsvariable, beispielsweise
`env("RAGENTS_MODEL_API_KEY")`. Hinterlege deren Wert in Deiner Shell- oder Dienstumgebung.
Bereits gesetzte Umgebungsvariablen haben Vorrang vor Profilwerten; eine `.env` wird nicht geladen.
Fehlt eine referenzierte Variable, meldet der Start einen Fehler. Die konfigurierten Modelle
und Denktiefen müssen im verfügbaren Modellkatalog gültig sein.

Starte anschließend das neutrale Profil:

```sh
scripts/start.sh core
```

Das Script baut das Web samt Hilfe und startet den Server. Die Oberfläche ist unter
`http://localhost:4710` erreichbar, die Laufzeitdaten liegen unter `~/.local/share/ragents/core`. `PORT` und
`DATA_DIR` können diese Vorgaben überschreiben. Ohne Benutzerliste ist die Anmeldung aus;
[Benutzer und Rechte](homepage/guide-access.html) beschreibt die Einrichtung eines Zugangs.
Zusätzliche Language Server müssen für ihre jeweiligen Diagnosefunktionen separat eingerichtet
sein; sie werden nicht durch die erste Chatnachricht gestartet.

Der feste Serverport steht unter `host.PORT` in der Profildatei. Ist er belegt, bricht der Start
mit einem Fehler ab. Die Adresse bleibt fest und eine laufende Instanz wird nicht beendet.
Ein ausdrücklich gesetztes `PORT` muss zwischen 1 und 65535 liegen; 0 ist ungültig.
Die abschließende Servermeldung nennt die URL. Eine Warnung über die
JavaScript-Bundle-Größe verhindert den Start nicht.

Mit `scripts/start.sh core --dev` laufen Backend auf 4710 und Vite auf 5710. Das Script prüft
beide festen Ports vorher und richtet `API_TARGET` auf das Backend aus. Ein ausdrücklich
gesetztes `PORT` ändert nur den Backendport; er muss vom Vite-Port verschieden sein.
Vite weicht mit `strictPort` bei belegtem Port ebenfalls nicht aus. Ein eigenständiges
`pnpm dev:web` verwendet 5710 und als Proxyziel `http://localhost:4710`.

## Den ersten Run anlegen

Die Ecke links oben öffnet die Run-Übersicht. Mit "Neuer Run" öffnest Du die Startauswahl.
Dort stehen Skills mit bearbeitbaren Aufträgen und Run-Scripts mit programmiertem Aufbau.
Die Vorschau zeigt den gewählten Einstieg; ein übernommener Skill-Auftrag lässt sich vor dem
Start im Vorbereitungschat besprechen. Gib dort sinngemäß Dein Go zur Ausführung, etwa
"Leg los", oder wähle "Run erstellen". Eine bloße Bestätigung eines Details startet nichts. Manche
Einstiege sammeln vorher Werte in einem Einrichtungsdialog.

Im Run bearbeitet der Koordinator den Auftrag. Weitere Agenten und Mini-Apps erscheinen auf
der Arbeitsfläche, wenn der Ablauf sie anlegt. Der globale Koordinator in der Kopfzeile hat
ein eigenes Gespräch und kann mehrere Runs überblicken. Das Journal und der Reiter
"Executions" machen Ereignisse und TypeScript-Aufrufe nachvollziehbar.

## Nach Änderungen bauen

Serveränderungen werden nach einem Neustart wirksam. Nach Webänderungen baut `pnpm build:web`
die Oberfläche und ihre Hilfe neu; der Server liefert sie statisch aus `apps/web/dist` aus.
`pnpm check` führt die Projektprüfung einschließlich Tests, Typprüfung und Web-Build aus.
Das Fragezeichen neben Einstellungen öffnet die mitgelieferte Hilfe. Für ein eigenes
statisches Hosting erzeugt `pnpm generate:homepage` dieselbe Website unter `docs/homepage/dist`.
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
ein verletzter fachlicher Auftrag sind unterschiedliche Befunde. Liveprüfungen weiter nur am
von Ronald gestarteten Server durchführen.

## Build- und Prüftasks in VS Code

Über `Tasks: Run Task` stehen drei Einstiege bereit. `Tasks: Run Build Task`
(Cmd+Shift+B auf macOS) startet standardmäßig `build`. Die Tasks enthalten ausschließlich
Skriptaufrufe. Die drei Skripte unter `build/` lassen sich auch aus einem anderen
Arbeitsverzeichnis starten; sie benötigen Bash und das installierte pnpm.

| Task | Skript | Zweck |
| --- | --- | --- |
| `build` | `build/build.sh` | Agentenlaufzeit, Web und Homepage bauen |
| `check` | `build/check.sh` | Vollständige Projektprüfung einschließlich Homepage |
| `open: homepage` | `build/homepage.sh --open` | Homepage bauen und im Standardbrowser öffnen (macOS) |

`pnpm build`, `pnpm check` und `pnpm open:homepage` verwenden dieselben Abläufe.
`pnpm generate:homepage` ruft `build/homepage.sh` ohne Option auf, `pnpm check:homepage`
verwendet `--check`. Jeder Ablauf bricht beim ersten Fehler ab; ein fehlgeschlagener
Homepage-Build öffnet keinen Browser. Geöffnet wird der statische Export unter
`docs/homepage/dist/index.html`. Die Referenzprüfung meldet veraltete Dateien, ohne sie zu
überschreiben; im Gesamtprüflauf steht sie deshalb vor dem Web-Build.

Für gezielte Arbeiten bleiben `pnpm build:agent`, `pnpm build:web`, `pnpm lint` und
`pnpm test:engine` verfügbar. Sie rufen die jeweiligen Werkzeuge direkt auf. Weitere
Einzelprüfungen laufen über die Workspace-Pakete, etwa `pnpm --filter @aicontainer/server test`
oder `pnpm -r typecheck`. Einzelprüfungen setzen nach einem frischen Klon die installierten
Abhängigkeiten und einmal `pnpm build:agent` voraus.

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

## Öffentliche Homepage und Entwicklerreferenz

`docs/homepage/index.html` wird redaktionell gepflegt. Die verlinkten Unterseiten
`reference.html` (Bausteine und UI-Showcase) und `developer.html` (Erweiterungspunkte mit
Codebeispielen) werden aus den neutralen Quellen erzeugt. `guide.html` erschließt die
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
und Erweiterungsbeispielen. `http-api.md` und `openapi.json` beschreiben die gemeinsame
HTTP-Verwaltung aus deren tatsächlichen Routenverträgen. `llms-full.txt` bündelt die Textreferenzen in einer Datei. Gib einem
externen Modell die `llms.txt` oder die vollständige Datei; für ein Run-Setup reichen zunächst
die Setup-Anleitung und die dort verlinkte API. Diese Dateien werden generiert, nicht von Hand
bearbeitet. Neue Werkzeuge, Ergebnistypen und Paketdateien erscheinen beim nächsten Build.
Die öffentliche Referenz beschreibt core, keine privaten Profile oder individuellen Run-Rechte.

Der Homepage-Build erzeugt außerdem `docs/homepage/dist/`. Zum statischen Hosting wird der
Inhalt dieses Ordners hochgeladen, einschließlich JS, CSS und gegebenenfalls Screenshots.
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
Titel, Bearbeitungsstatus, Erstellungsdatum mit Uhrzeit, letzte Aktualisierung und ergänzende Plugin-Angaben. Die Auswahl
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

## Run-Chat und Canvas-Steuerung

Bei aktivem Canvas steht oben zwischen der Run-Übersicht und dem globalen Koordinator ein
zweiter, gleich breiter quadratischer Knopf. Er öffnet die Canvas-Übersicht und zoomt so weit
heraus, dass alle sichtbaren Actors, Formen und Actor-Views in die verfügbare Fläche passen.
Das Ziel unter der Maus oder mit Tastaturfokus wird hervorgehoben. Ein Klick oder die
Aktivierung per Tastatur bringt es bei genau 100 Prozent in die Mitte und beendet den Modus.
Deine bisherige Auswahl bleibt erhalten; Karten und Apps führen dabei keine Aktion aus.
Ihre sonstigen Bedienelemente sind während der Zielwahl gesperrt. Escape oder ein erneuter
Klick auf den Übersichtsknopf kehrt zum vorherigen Bildausschnitt und Zoom zurück.
Auch die Zoomsteuerung beendet den Modus und führt die gewählte Kamerabewegung aus.

In der schmalen Statusleiste am unteren Fensterrand stehen Minus, Zoomstufe, Plus und
`Einpassen`. Die Leiste reicht über die ganze Anwendungsbreite. Einpassen und ein
Doppelklick auf freie Fläche zentrieren den Inhalt bei 100 Prozent. Große Szenen können dabei
über den sichtbaren Bereich hinausreichen. Nur beim ersten Anzeigen wird die Szene automatisch
an die verfügbare Fläche angepasst. Gespräche stehen an den Agentenkarten und im rechten
Actor-Inspector. Der Run-Koordinator ist standardmäßig nur in der Actor-Leiste oben am Canvas
erreichbar. Ein Klick auf seinen Eintrag öffnet den Chat als Pop-out darunter. Diese
Chatansichten sind bis zu 784 Pixel breit und passen sich bei schmalen Fenstern an. Andere
LLM-Einträge öffnen ihren Chat, TypeScript-Einträge ihre Actor-Ansicht. Ein erneuter Klick,
Escape, Außenklick oder das X im Pop-out-Kopf schließt die Fläche; ungesendete Texte bleiben
beim Schließen und Actor-Wechsel erhalten. Über die Actorliste kannst Du die Canvas-Karte
zusätzlich einblenden. In der Ansichtsleiste wählt die Sprechblase den Verlauf, die anderen
Symbole jeweils eine Detailansicht. Der Code-Reiter zeigt bei Actors mit installiertem Programm
die TypeScript-Quellen und übrigen Dateien dieses Stands, mit Dateiauswahl und Syntaxhervorhebung.
Das gilt auch für TypeScript-Actors ohne Mini-App oder veröffentlichte Funktionen. Dafür
werden die technischen Leserechte benötigt.
Links in der Canvas-Headerzeile schaltet `Anzeige` zwischen `Alle`, `Aktive`, `Sichtbare`,
`LLM-Agenten` und `TypeScript`, ohne seine Breite zu ändern. Standard ist `Aktive`;
`Alle` zeigt zusätzlich gestoppte Actors. Solange kein Actor gestoppt ist, sehen beide gleich aus.
`Sichtbare` zeigt nur Actors, deren Karte oder Kachel gerade auf dem Canvas steht, und immer den
primären Actor. Die beiden Typfilter zeigen auch gestoppte Actors
des jeweiligen Typs. Actorliste und Chats öffnen mit demselben Abstand direkt unter dem Knopf.
Das ändert nur die direkten Actor-Zugänge und blendet keine Canvas-Karten aus.
Die Auswahl bleibt je Run im Browser gespeichert. Unter `Actors` findest Du immer die
vollständige Liste. Knöpfe geöffneter Flächen bleiben sichtbar gedrückt.
Der Nachrichtenentwurf bleibt beim Wechsel erhalten. Im Chat des primären Actors bleibt
`Lauf stoppen` mit Bestätigung erreichbar.

Klicke auf freie Canvas-Fläche und navigiere mit den Pfeiltasten zum räumlich nächsten
sichtbaren Actor, zur Mini-App oder Form in der jeweiligen Richtung. Das Ziel wird bei
unverändertem Zoom weich über 300 Millisekunden zentriert; die Inspector-Auswahl bleibt
erhalten und das Element führt keine Aktion aus. Gedrückthalten setzt die Navigation
schrittweise fort. Die Tasten funktionieren auch, solange kein Bedienelement den Seitenfokus
besitzt. In Eingabefeldern, Controls, Mini-Apps, scrollbaren Karten und Dialogen bleibt ihre
normale Bedienung erhalten; in der Canvas-Übersicht bleibt die Zielnavigation unverändert.
Andere Kameragesten übernehmen sofort. Bei reduzierter Bewegung entfällt die Animation.

`Journal` in der nächsten Statusgruppe öffnet darüber die tatsächlichen Ereignisse des Runs.
Die neuesten stehen zuerst; die Suche findet Ereignisinhalte und Actor-Handles. Ein Eintrag
lässt sich zum vollständigen JSON aufklappen. Zunächst sind 100 Treffer sichtbar, weitere
lassen sich nachladen. Die offene Ansicht folgt Änderungen des Runs und bietet Aktualisieren.
Außenklick oder Tab aus der Fläche schließen sie; Escape und X geben den Fokus an Journal zurück.

`Actors` daneben listet alle Beteiligten auf, auch dich und gestoppte Actors. Klicke auf einen
Namen eines KI- oder TypeScript-Actors, um rechts dessen Chat und Details zu öffnen. Das blendet seine Karte nicht auf dem
Canvas ein. Bei jedem nichtmenschlichen Actor kannst du die Karte unabhängig davon ein- oder
ausblenden; seine Arbeit und die zugehörigen Mini-Apps laufen weiter.

Unter `Ansicht` ist `Actors mit Mini-App anzeigen` zunächst aus. So steht die App auf
der Fläche, ohne zusätzlich Platz für die Karte ihres Besitzers zu brauchen. Das gilt auch
für KI-Agenten mit eigener Oberfläche und bleibt so, wenn die Mini-App selbst ausgeblendet
wird. `Verbindungen anzeigen` ist zunächst an. Ausgeblendete Actor-Karten verlieren nur ihre
sichtbaren Verbindungen. Umschalten der Mini-App-Gruppenwahl ersetzt die Einzelentscheidungen
für diese Actors. `Ansicht zurücksetzen` entfernt alle Einzelentscheidungen und stellt beide
Vorgaben wieder her. Die Auswahl bleibt in diesem Browser je Serveradresse und Run erhalten;
Leserechte genügen. Sie ändert weder das gemeinsame Layout noch den Run oder sein Journal.

Die Reitersymbole oben neben Einstellungen und Hilfe wählen den rechten Arbeitsbereich.
Der Panelknopf in derselben Titelleiste klappt ihn vollständig ein. Danach ist nur noch der Knopf
zum Öffnen sichtbar; er stellt die zuletzt verwendete Breite wieder her. Eine Auswahl über
den Actor-Kartenkopf oder einen Namen in der Actorliste öffnet das Panel ebenfalls. Besuchte Ansichten behalten ihren Zustand.
Die Symbolnamen erscheinen nach 50 Millisekunden Hover oder sofort bei Tastaturfokus direkt
unter der Kopfzeile. Beim Wechsel zum nächsten Symbol bleibt der Hinweis sichtbar und wechselt
sofort; kleine Lücken zwischen den Knöpfen unterbrechen ihn nicht.
Der Panelknopf ist so groß wie Einstellungen und Hilfe; Escape entfernt einen sichtbaren
Hinweis, ohne den Fokus zu verschieben.

Agentenkarten lassen sich über das Größensymbol im Kopf auf dem Canvas vergrößern und wieder
kompakt anzeigen. Die kleine Ecke rechts unten ändert ihre freie Größe; eine selbst gewählte
Größe bleibt beim Umschalten erhalten. Die Eingabe direkt auf LLM-Karten sendet an den
jeweiligen Actor. LLM-Karten sind dafür standardmäßig 720 mal 520 Pixel groß und mindestens
260 Pixel hoch; kleinere gespeicherte Höhen werden beim Anzeigen begrenzt. Wie im rechten Actor-Chat stehen Dateien anhängen und die Darstellung der
Schritte von ausgeblendet bis vollständig zur Verfügung, ohne Modell- oder Denktiefenauswahl.
Der Modus "aktuell" zeigt den laufenden Schritt als Quassel-Chip. Bei Zugängen ohne technische
Leserechte steht dort "Denken" oder "Werkzeug läuft", ohne Werkzeugnamen, Inhalte oder
aufklappbare Details. Nach Ende des Schritts verschwindet der Chip; eine Nachricht, die Du
währenddessen nachschiebst, lässt ihn stehen. Die animierten
Arbeitsszenen bleiben sichtbar, solange der Agent arbeitet, auch bei längeren Denkpausen.
Im Run-Chat laufen sie, solange irgendein Agent oder Programm des Runs arbeitet, also auch
während der Koordinator auf beauftragte Actors wartet; Karten und Inspector zeigen nur den
jeweiligen Actor.
Senden braucht Schreibrechte am Run und einen nicht gestoppten Actor; fehlgeschlagene Eingaben
bleiben über die gemeinsame Chat-Eingabe verfügbar. Im Verlauf kannst du zurücklesen, ohne den Canvas
zu zoomen; am Ende folgt er neuen Nachrichten wieder automatisch. Der Kartenkopf öffnet den
Actor-Chat mit Details.

Nachgeladene oder aufgeklappte Karteninhalte lösen automatisch eine neue Anordnung aus;
Rahmen und Linien folgen den Größen. Das gilt auch während du eine Canvas-App am Griff
skalierst, unabhängig vom Zoom. Dabei bleibt dein Bildausschnitt erhalten. `Einpassen` richtet
die Kamera bei 100 Prozent auf die aktuellen Ausmaße aus. Ein abgebrochener Größen-Drag stellt die vorherige
App-Größe wieder her.

## Arbeitsspalte und VS-Code-Erweiterung

Die Spalte gibt es auch im Browser: `http://localhost:4710/column.html?run=<id>` zeigt einen
Run als schmale Ansicht (Mini-App-Chips, gewählte App mit Griff, Actor-Chips, Chat), ohne `run`
die Run-Liste mit "Neuer Run" als erster Karte; `column.html?layout=app&run=<id>&element=<app-id>` zeigt eine
Mini-App allein. Der Zustand der Spalte (gewählte App, Griffhöhe, gewählter Actor, Chat rechts oder unten, Chatbreite) bleibt je Run
im Browser.

Die Erweiterung liegt unter `apps/vscode` und verbindet sich mit einem laufenden Server; sie
bündelt ihn nicht. Einrichtung:

1. Server starten (`scripts/start.sh core`) und das Web bauen (`pnpm build:web`), weil der
   Server `column.html` aus `apps/web/dist` liefert.
2. `scripts/start-vscode.sh core` (auch ein anderes Profil oder eine Serveradresse; Task `vscode: start`)
   baut die Erweiterung und startet eine eigene VS-Code-Instanz mit ihr und dem Repo als Ordner;
   Layout und Anmeldung dieser Instanz bleiben unter `~/.local/share/ragents/vscode`. Alternativ F5
   mit der Startkonfiguration aus `apps/vscode/README.md` oder `pnpm --filter ragents-vscode
   package` und die `.vsix` über "Extensions: Install from VSIX" laden.
3. Einstellung `ragents.serverUrl` (Standard `http://localhost:4710`; ein anderes Profil
   verwendet seinen eigenen Port) und `ragents.theme` (`auto`, `light`, `dark`). Nach einer Änderung
   verlangt die Erweiterung ein Neuladen des Fensters.

Bedienung: Das RAgents-Symbol in der Aktivitätsleiste öffnet den Explorer mit allen Runs
(Zustandspunkt: grün läuft, orange wartet auf eine Rückfrage, blau ruht, hohl beendet; das
Abzeichen am Symbol zählt offene Rückfragen). Ein Run klappt zu `Actors`, `Mini-Apps`,
`Dateien` und `Journal` auf; ein Klick auf den Run öffnet ihn in der Spalte der zweiten
Seitenleiste (`RAgents`). Der Pfeil an einer Mini-App oder in der Bühne der Spalte legt
sie als Editor-Reiter in die Mitte; Explorer und Spalte zeigen "in der Mitte", "Zurück in die
Spalte" schließt den Reiter. Textartefakte und das Journal öffnen als schreibgeschützte
Dokumente, andere Artefakte im Browser. `Neuer Run` im Explorer öffnet die Startauswahl in der
Spalte; `Run stoppen` im Kontextmenü beendet den ganzen Lauf nach Rückfrage.

Anmeldung: Verlangt das Profil Benutzer, zeigt der Explorer "Anmeldung erforderlich" und der
Befehl `RAgents: Anmelden` fragt Benutzer und Passwort ab; bei einem Profil mit `ACCESS_TOKEN`
nach dem Token. Der Sitzungstoken liegt in VS Codes SecretStorage je Serveradresse und wird als
Bearer gesendet; die iframes bekommen ihn in ihrer Adresse (im Server: Bearer oder
Abfrageparameter `access` für GET-Abrufe). Nach Ablauf oder Serverneustart meldet der Explorer
die Anmeldung erneut, die Spalte bietet "In VS Code anmelden". `RAgents: Abmelden` widerruft
die Sitzung.

Ist der Server nicht erreichbar, zeigt der Explorer die Ursache und "Erneut verbinden" und
versucht es alle fünf Sekunden von selbst; die Liste wird verbunden ohnehin alle fünf Sekunden
neu geladen, der Ereignisstrom verbindet nach fünf Sekunden neu und meldet die Unterbrechung
als Zeile im Explorer. Die Erweiterung wird erst beim
Öffnen einer ihrer Ansichten aktiv und verbindet sich nicht im Hintergrund.

Prüfen: `pnpm --filter ragents-vscode test` läuft ohne VS Code gegen einen Stub-Server und
gehört zu `pnpm check`; `RAGENTS_HOST_TEST_SERVER=http://localhost:4710 pnpm --filter
ragents-vscode test:host` startet das installierte VS Code mit einem temporären Benutzerordner
gegen den laufenden Server (mindestens ein Run mit Mini-App, etwa das Sammelboard) und prüft
Verbindung, Spalte, Run-Wechsel und Mini-App in der Mitte; `RAGENTS_HOST_TEST_LOGIN=id:passwort`
beziehungsweise `RAGENTS_HOST_TEST_TOKEN=<token>` prüfen die Anmeldung.

Grenzen: keine Codeaktionen, keine Dateisynchronisation, kein Betrieb ohne Server. "Im Browser
öffnen" führt zur Startseite, weil das Web keinen Run in der Adresse trägt. Der Explorer kennt
die persönliche Actor-Anzeige der Spalte nicht.

## Dienste und Hintergrundprozesse beenden

Die Prozessleiste zeigt Hintergrundprozesse des Runs und Dienste mit offenen Ports. Mit
Schreibrecht beendet das kleine Stopp-Symbol genau die ausgewählte Prozessinstanz. Während der
Anfrage ist dessen Knopf gesperrt; Fehler bleiben am Eintrag sichtbar. Der nächste Prozessstand
entfernt beendete Einträge. Beim Stoppen und vor dem Löschen eines Runs räumt die Prozess-Extension
auch markierte Prozesse ohne offenen Port auf. Ein offenes Browserfenster ist dafür nicht nötig.

Zunächst sendet der Server SIGTERM. Reagiert der Prozess innerhalb von zwei Sekunden nicht,
folgt SIGKILL; nach einer weiteren Sekunde muss er beendet sein. Ein Durchlauf hat eine
Zeitgrenze von acht Sekunden. Fehlende Betriebssystemrechte oder ein verbleibender Prozess
werden als Fehler gemeldet und dürfen nicht als erfolgreicher Abschluss verstanden werden.

Ein bewusst abgesetzter Node-Dienst kann mit `child_process.spawn` und den Optionen
`detached: true`, `stdio: "ignore"`, `env: process.env` sowie anschließendem `child.unref()`
weiterlaufen. Das verwendet auf macOS und Linux die Node-Prozessschnittstelle und benötigt
kein externes `setsid`-Programm. Der geerbte `RAGENTS_RUN_ID`-Marker muss erhalten bleiben,
damit der Dienst beim Run-Stopp wiedergefunden wird. Derselbe Mechanismus gilt unabhängig
vom verwendeten Interpreter; ohne Marker gibt es keine Zuordnung zum Run.

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
zur Verfügung; ihre weitere Verarbeitung hängt von diesen Werkzeugen ab. Bei Fehlern bleiben
Nachricht und Dateien im Composer. Gesendete Anhänge kannst du im Verlauf wieder herunterladen.

## Anmeldung und Profilrechte

Für einen optionalen Anmeldemodus ergänzt die eigene `ragents.config.<profil>.ts` neben
`config` einen `users`-Export mit `readonly ProfileUser[]`. Benutzerkennung, optionaler
Anzeigename und Rechte stehen dort; das Passwort steht als Klartext oder verweist mit
`env(...)` auf eine lokal bereitgestellte Umgebungsvariable. Das neutrale `ragents.config.example.ts` und die erzeugte
[Entwicklerreferenz](homepage/developer.html#extension-profile-access) zeigen vollständige
Beispiele. Die gültigen eingebauten Rechtenamen und die Host-Routenzuordnung stehen in der
[automatisch erzeugten Übersicht](homepage/developer.html#access-rights).

Nach einer Änderung neu starten. Ohne `users` gibt es keine Benutzeranmeldung; eine leere
Liste oder fehlende Passwortvariable ist ein Startfehler. Bei aktiver Anmeldung Benutzerkennung
und Passwort eingeben. Der Benutzerknopf bietet Abmelden. Nach zwölf Stunden oder nach einem
Serverneustart ist eine neue Anmeldung erforderlich; Abmelden beendet auch offene Ereignisströme
und laufende HTTP-Abrufe. Bereits gestartete Agenten-Runs werden dadurch nicht gestoppt.
Die Benutzersitzung wird nur im Serverspeicher gehalten.

Leseberechtigte Benutzer teilen sich die vorhandenen Runs. Run-Schreibrechte erlauben Chat und App-Aktionen. Freie Runs brauchen zusätzlich `runs.create`,
technische Ansichten `runs.inspect`. Ohne `runs.create` begrenzt `startEntries` die erlaubten
Run-Scripts. Ein `anonymousUser`-Export kann dieselben Rechte ohne Anmeldung setzen. Die globale Unterhaltung hat
eigene Rechte; für ihre Modelländerung ist zusätzlich Settings-Schreibzugriff nötig.
Benutzer und Passwörter werden in der Profildatei beziehungsweise Umgebung gepflegt, nicht
über eine Verwaltungsseite. `ACCESS_TOKEN` bleibt nur für Profile ohne `users` wirksam und
ersetzt bei aktivierter Benutzeranmeldung kein Passwort.

## Einstellungen

Der Schichtwerk-Canvas zeigt matte Karten mit gerundeten Kanten und sichtbarer Tiefe nach
rechts oben. Lavendel kennzeichnet den Hauptactor, Tonfarbe weitere KI-Actors, Senfgelb
TypeScript-Actors und Kalkweiß die Mini-Apps. Die Fronten bleiben gerade, die Schattierung fest.
Runde Knöpfe mit X schließen Dialoge; ein runder Pfeil führt zur vorherigen Ansicht zurück.
Die Hinweise am Knopf benennen die jeweilige Aktion.
Auswahlmenüs öffnen je nach Platz über oder unter ihrem Knopf und bleiben auch in engen
Eingabe- und Dialogflächen vollständig erreichbar. Escape schließt zunächst das offene Menü.

Unter "Darstellung", "Schichtwerk" stellst du "Tiefenstufen" auf eine ganze Anzahl von 0 bis 5;
der Ausgangswert ist 1. Jede Stufe reicht um denselben festen Abstand nach hinten, bei 0 bleibt
die Karte flach. Der Wert bleibt in diesem Browser gespeichert und wirkt sofort auf die Karten
aller Runs im freien Canvas. Kacheln verwenden dieselbe Optik mit fest null Tiefenstufen. Alte Pixelwerte werden nicht übernommen. Bei einer ungültigen gespeicherten
Einstellung erscheint ein Fehler; mit Zurücksetzen stellst du die Vorgabe wieder her.

Unter "Darstellung" wählst du außerdem Hell, Dunkel oder System. Die Vorgabe ist Hell;
System folgt der Farbschema-Einstellung des Betriebssystems auch bei späteren Änderungen.
Die Auswahl wirkt sofort auf Oberfläche, Canvas und gemeinsame Actor-View-Controls, ohne Chats
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

"Darstellung" enthält die Oberflächenwahl und Canvas-Einstellungen. "Erweiterungen" enthält
"Nach Extension" und "Nach Fähigkeit" als technische Kataloge mit Suche. Ein Klick auf den
Eigentümer öffnet die vollständige Extension-Seite. "Laufzeit" zeigt technische Fakten,
Modelle, Profile und Systemprompt. Modelle und Darstellung funktionieren unabhängig vom
Laden dieser Kataloge. Plugin-Formulare sind zusätzlich bei ihrer Extension erreichbar.

Unter "LLM-Karten" bietet die Orchestration-Extension eine gemeinsame Standardgröße für alle
Runs in diesem Browser: anfänglich 720 mal 520 Pixel, einstellbar auf 240 bis 2880 Pixel Breite
und 260 bis 2700 Pixel Höhe. Zum Ändern brauchst du Settings-Schreibrechte. Speichern wirkt
sofort auf Standardkarten; individuell gezogene Größen bleiben erhalten. Die Einstellung
bleibt lokal für dieselbe Serveradresse im Browser gespeichert und wird nicht als Profilwert
auf dem Server abgelegt. Zurücksetzen stellt die anfängliche Größe wieder her.

## Übergeordneter Koordinator

Der Koordinator entdeckt seine Funktionen mit `typescript_api` und führt sie in
`typescript_eval` über `context.functions` aus. Seine Auswahl umfasst `read`, `write`, `edit`
und `bash`; `quick_answer` ergänzt eine kurze Ergebnisanzeige nach seiner normalen Antwort. Seine erzeugte HTTP-Referenz
liegt im eigenen Arbeitsverzeichnis. `RAGENTS_JOURNAL_DIR` zeigt auf die echten Journale des
Profils; die Shell kann sie etwa mit `rg` durchsuchen. Journale bleiben unverändert im
JSONL-Dateiformat 4. Große Payload-Felder liegen im benachbarten `payloads/`-Ordner;
`payloadRefs` nennt ihren Hash und ihre Bytezahl. Die Event-HTTP-API löst diese Referenzen
vollständig auf. Laufzeitänderungen wie Starten, Senden und Stoppen gehen durch die HTTP-API.
`RAGENTS_API_BASE_URL` nennt den lokalen Host, `RAGENTS_API_TOKEN` enthält eine private, auf die lokale Verwaltungs-API beschränkte
Dienstidentität für Run-Lesen und -Schreiben sowie Hilfe. Sie erreicht weder Einstellungen
noch den globalen Gesprächsreset. Den Token nicht ausgeben oder in Requestdateien schreiben.
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
Öffne zum Beispiel einen Actor im Inspector und frage oben "Was macht dieser Actor?".
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
laufender Arbeit pulsiert der Rahmen um die Eingabe, wie bei arbeitenden Agenten auf dem Canvas.
Bei reduzierter Bewegung
bleibt der Rahmen hervorgehoben. Ein Verbindungsabbruch sperrt Senden, erhält aber den Entwurf.
Nach Wiederverbindung werden zwischenzeitliche Kurzantworten berücksichtigt, ohne alte Toasts
beim ersten Verbinden oder erneuter Wiedergabe nochmals anzuzeigen.

Der Koordinator überblickt die Läufe des aktuellen Profils, liest Journale und kann neue Läufe
mit einem Auftrag oder einem installierten Run-Script beginnen. Erstellte Läufe lassen sich
über die Run-Liste öffnen. Der Stopp-Knopf an seiner Eingabe stoppt den globalen Koordinator
selbst; einen anderen Lauf stoppt er auf Auftrag über die HTTP-Verwaltung. Ohne Schreibrecht
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

Ohne `AGENT_MODELS` stehen die ohnehin konfigurierten Modelle des Produkts zur Wahl. Die Wahl wird wie
der Systemprompt mit der ersten Nachricht eingefroren und gilt für den Koordinator.
`AGENT_COORDINATOR_MODEL` ist dabei der explizite Standard und nicht einfach der erste Listeneintrag.
Er muss in `AGENT_MODELS` stehen; eine widersprüchliche Konfiguration bricht den Start hart ab. Das
Profil `relay` beginnt mit demselben Modell und derselben Koordinator-Denktiefe. Unter
Einstellungen, Modelle kann es eine eigene Vorgabe für neue Vermittlungs-Actors erhalten.

## Webanwendungen im Browser prüfen

`ragents.browser` verwendet `playwright-core` und einen lokal ausführbaren Chrome oder Chromium.
Trage in der Sektion `ragents.browser` des Profils `BROWSER_EXECUTABLE_PATH` ein oder installiere
den passenden Browser im Repo mit `pnpm exec playwright-core install chromium`. Für Google
Chrome auf macOS lautet der Pfad `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.
Ein fehlender Browser blockiert den Browseraufruf mit einer konkreten Einrichtungsanweisung.
Die Pluginregistrierung startet keinen Browser und lädt keinen herunter.
`plugins/ragents.browser/install.sh` installiert die zur gepinnten Playwright-Version passende
Chromium-Version und unter Linux deren Systembibliotheken. Lokal installiert derselbe Aufruf
nur Chromium im normalen Browsercache.

Der Agent lädt bei Bedarf den Skill `browser-testing`, öffnet die laufende Anwendung, liest
ihren zugänglichen Aufbau und bedient den Nutzerweg. Er prüft sichtbare Ergebnisse und
Browserfehler mit `browser_check`. Rollen und Beschriftungen bestimmen die Elemente;
fehlende oder mehrdeutige Ziele werden gemeldet. Eigene Auswahlmenüs werden geklickt,
native Selects über ihren sichtbaren Optionstext gewählt. Tastatur und Iframes sind verfügbar.
Weitere Fenster werden gemeldet und geschlossen.

Aufnahmen aus `browser_screenshot` erscheinen unter `browser` in den Dokumenten des Runs.
Mini-Apps können die zurückgegebene URL direkt anzeigen. `browser_view_screenshot` ist ein
natives Werkzeug für Modelle mit Bildunterstützung und lädt die letzte Aufnahme ohne
Pfadangabe. Die historische Aufnahmeliste bleibt über Stopp und Serverneustart erhalten;
eine frühere Aufnahme beweist keinen später geänderten Stand. Der Browser startet je Run
ohne persönliche Anmeldung. Stoppen verwirft seine Cookies und die aktuelle Prüfgültigkeit.

Die gezielte echte Browserprobe startet nur eine kurzlebige lokale Fixture und schreibt nach
Temp: `RAGENTS_BROWSER_TESTS=1 PRODUCT_PROFILE=core pnpm --filter @aicontainer/server exec node
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

`ragents.product` hält Modell-Unwissen, Internet-Regel und Verschwiegenheit fest in
`ragents.product/preamble.hbs`, weil sie nicht abwählbar sein dürfen.

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
die öffentliche Layoutdemo übernimmt eine Antwort ausschließlich lokal. Bestehende Programme
bekommen beim Neuladen die gemeinsame Grundgestaltung, neue Layoutkomponenten erst nach
ausdrücklicher Quellbearbeitung und Aktivierung.

Für einen Ablauf mit Diagramm und LLM-Anleitung lege `src/definition.ts` und die längeren
Anweisungen unter `prompts/` im Actor-Paket an. Verwende `defineWorkflow` aus
`@ragents/workflow`; Rollen und Schritte referenzieren ihre Promptdateien. Serverseitig
erzeugt `workflowInstructions` mit `readPrompt` aus `@ragents/workflow/prompts` die
rollenbezogene Anleitung. Die View erhält Definition und aktuellen Zustand über
`WorkflowDiagram` aus `@ragents/client/ui`. Das Beispiel `learning-afternoon` zeigt den
vollständigen Aufbau. Der [Autorenleitfaden](spec/run-modules.md#ablaufdefinition-anleitung-und-darstellung-verbinden)
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
Verbindungen werden an der Grafik gemeldet. Die öffentliche Bausteinreferenz enthält ein
umschaltbares Beispiel. Für selbst positionierte SVG-Knoten bleibt `SvgEdge` verfügbar.

Funktionen, Werkzeuge und Views teilen den Zustand ihres Actors. Eine Funktion kann mit
`tool` zusätzlich als Agentenwerkzeug veröffentlicht werden. Eingabe und Ergebnis bleiben
identisch; nur `context.state.replace` ändert den Actor-Zustand. Ein Funktionsaufruf aus der
View oder als Werkzeug braucht keinen zusätzlichen Modell-Turn. Erfolgreiche Änderungen
aktualisieren alle zugehörigen Views auch bei ruhendem Chat; lokale Formularentwürfe bleiben.

Jede aktivierte View erscheint auf dem Canvas. Die Karte ihres Actors ist standardmäßig
ausgeblendet; über `Actors` bleiben Chat und Details erreichbar. Paketmetadaten können
Breite und Höhe setzen. `actor_view_set_visibility` blendet eine View aus und wieder ein;
Funktionen, Zustand und Bindung bleiben erhalten. Sichtbarkeit bleibt nach Neustart erhalten.
Der Name in der Kopfzeile führt zum Canvas, der Vergrößern-Knopf öffnet die Mini-App als
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
und in der Actorliste. Ihre Actor-Karte steht standardmäßig auf dem Canvas, lässt sich
persönlich ausblenden und benötigt keinen leeren View-Rahmen.

Die neutralen Beispiele in `ragents.reference` sind Demos und mögliche High-Level-Testfälle:
Skills mit Beispielaufträgen oder wiederverwendbaren Arbeitsanleitungen, Run-Scripts und
vorgeschaltete Einrichtungsdialoge. Die automatisch erzeugte Übersicht
unter `docs/homepage/reference.html#examples` ordnet sie nach Anwendungsfall und Konzeptdemo
sowie nach gezeigter Fähigkeit. Der Katalog und die Schlagworte sind die Quellen, keine zweite
handgepflegte Beispielauflistung. Für jedes Produktkonzept im Katalog werden mindestens zwei
Beispiele geprüft; jeder Skill-Einstieg zählt als ein Beispiel. UI-Controls haben keine
Beispielquote. Demos verwenden die zu ihrem Anwendungsfall passenden Controls, ohne alle
abdecken zu müssen.

Die `description` im Kopf von `SKILL.md` oder `RUN.md` erklärt kurz, was die jeweilige Demo
zeigen soll. Bei ähnlichen Fällen nennt sie den Unterschied. Startauswahl und öffentliche
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
  RUN.md             title, description; optional order, guide, tags, coordinator
  package.json       ragents.backend nennt src/server.ts
  src/server.ts      defineActor mit input-Vertrag und onInput
  tests/*.test.ts    Fachtests mit node:test und typisierten Funktions-Mocks
  actors/<name>/     Optionale weitere Actor-Programmpakete
```

`guide` verweist auf eine React-Komponente im Web-Beitrag `guides`. Der Startwert trägt
`{ "input": ..., "options": { ... } }`: `input` stammt aus `onComplete`, `options` aus den
Startoptionen. Die Einrichtungsdialoge in `ragents.reference/web/StartGuides.tsx` zeigen zwei
vollständige Beispiele. Gesprächsrunde erwartet `{ topic, rounds }` (1 bis 160 Zeichen,
1 bis 5 ganze Runden); Sammelboard `{ title, firstEntry }` (1 bis 160 beziehungsweise 2000
Zeichen). Beide weisen leere oder zusätzliche Felder zurück. `null` ist der ausdrücklich
unterstützte Standardstart aus den Pakettests, kein Ersatz für fehlerhafte Eingaben.

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

## Läufe von außen fahren

`pnpm driver` (`scripts/driver/run-driver.ts`) legt Runs ohne Oberfläche an, steuert sie und wertet
ihr Journal aus - gedacht für autonome Läufe und die Analyse danach:

```sh
PRODUCT_PROFILE=core pnpm driver new-run                     # legt einen Run an, gibt die Run-Id aus
PRODUCT_PROFILE=core pnpm driver send <id> @coordinator "Auftrag ..."
PRODUCT_PROFILE=core pnpm driver journal <id> --since 120 --tools
PRODUCT_PROFILE=core pnpm driver usage <id>                  # Modellaufrufe und Tokens je Actor
PRODUCT_PROFILE=core pnpm driver stop <id>
```

Die Adresse kommt aus `host.PORT` der Profildatei (`RAGENTS_DRIVER_URL` überschreibt sie), der
Datenordner aus `DATA_DIR` oder dem Profilstandard. Definiert das Profil Benutzer, ist
`RAGENTS_DRIVER_USER` Pflicht; das Passwort liest der Treiber aus derselben Profildatei und
meldet sich per `POST /api/access/login` an. Dahinter stehen die Routen `POST /chat/<uuid>/start`,
`POST /chat/<uuid>/actors/<@handle>/send`, `POST /chat/<uuid>/stop` und `GET /chat/sessions`;
das Journal liest er direkt aus `${DATA_DIR}/runs/<uuid>/journal.jsonl`.

## Datenablage und Protokolle

Standardmäßig liegt jedes Profil unter `~/.local/share/ragents/<profil>`. Die Reihenfolge
ist `DATA_DIR` aus der Umgebung, `host.DATA_DIR` aus der Profildatei, dann dieser Standard.
Das gilt für `./start.sh` und den direkten Serverstart. Vor dem Build beziehungsweise der
Serverinitialisierung werden vorhandene Pfadvorfahren einschließlich Symlinkzielen geprüft:
`.git`, `pnpm-workspace.yaml` und `package.json` sind dort nicht zulässig. So übernehmen
Buildwerkzeuge keine Konfiguration des RAgents-Quellbaums. Ein ausdrücklicher externer Pfad
bleibt eine gültige Einstellung; `.data/language-servers` enthält weiterhin nur die
gemeinsam installierten Sprachserver.

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
          documents/              Dateiablage der Unterhaltung (RAGENTS_FILES_DIR), ohne DOCUMENTS_DIR
        ragents.workspace/
          workspace/              leeres Arbeitsverzeichnis der Unterhaltung, befüllt ein Resolver-Plugin
          home/                   HOME der Sandbox
  delete-intents/                 0700 root - vermerkte Löschabsichten
    <sessionId>.json              0600 root - ein beim Absturz unterbrochenes Löschen wird
                                  beim nächsten Start daran erkannt und zu Ende geführt
  recovery/                       0700 root - Wiederherstellungsdaten je Run; wandern beim
                                  Löschen mit ins Archiv (heute legt noch nichts darin ab)
  archive/<sessionId>/            Chat, Wiederherstellungsdaten und Journal gelöschter Unterhaltungen
  plugins/<pluginId>/             globale Ablage je Plugin, soweit benötigt
  logs/server.log                 Serverlauf, HTTP-Zugriffe, Fehler, Abstürze (Rotation 32 MB x3)
```

Ein Journal-Backup oder manueller Umzug umfasst immer den gesamten `runs/<sessionId>/`-Ordner,
also auch `payloads/`. Die einzelne JSONL-Datei reicht bei ausgelagerten Inhalten nicht.
Die Archivierung gelöschter Runs übernimmt diesen Ordner vollständig. Andere Run-Daten wie
Modellkontexte und Arbeitsdateien bleiben zusätzlich erforderlich. Journale früherer Dateiformate
werden für den betroffenen Run abgewiesen; der Server startet trotzdem. Auch beschädigte oder
unvollständige Journale und fehlende Inhaltsdateien betreffen nur ihren Run. Das Serverprotokoll
nennt Run-ID, Dateipfad und Ursache. Gesperrte Runs erscheinen nicht in der Liste nutzbarer
Unterhaltungen; ein direkter Zugriff meldet HTTP 409 mit `journal-unavailable`. Die Dateien
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
Session plus die Skills.

Beim Bash-Abschluss prüft der Host unter macOS einen Signalfehler `EPERM` zusätzlich anhand
von Prozessgruppen-ID und Status. Bereits beendete Zombie-Einträge verdecken so keine
Befehlsausgabe mehr. Echte Berechtigungsfehler und fehlgeschlagene Prüfungen bleiben sichtbar.
Ein Fehler des ausgeführten Build- oder Generierungsbefehls muss weiterhin separat behoben werden.

## Sicherheits-Lockdown der Agentenlaufzeit

Alle Einschränkungen stecken in der Engine-Konfiguration beim Serverstart (weder Modell noch
Client können sie ändern): Der Systemprompt wird geordnet aus den Beiträgen der aktiven Plugins
zusammengesetzt. Skills kommen ausschließlich aus deren registrierten Pfaden. Die Werkzeuge stammen
aus dem RAgents-Core und der Plugin-Registry statt aus einer frei wählbaren Liste. Das agentDir
`apps/server/agent-home` enthält nur Agentenlaufzeitkonfiguration; feste Profile
binden die Modelle. Capabilities begrenzen die Orchestrierung und ihre Delegation.
Workspace-Werkzeuge bleiben sichtbar; Rollen werden im Prompt beschrieben und die technische
Grenze ist die Sandbox der Session. Bash ist darin erlaubt.
