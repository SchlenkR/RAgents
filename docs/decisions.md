# Entscheidungen

## Die API ist JSON-RPC mit typisierten Verträgen, HTTP und stdio sind Transporte (18.09.2026)

Kapitel: plugins (Nachrichtenschicht, Plugin-Vertrag, Web als Plugin-Host, Arbeitsbereich),
core (Schichten, Overseer), profiles (Startmodi, Rechte), typescript-platform, run-modules,
README. Ronald wollte den Server auch als Konsolenprozess ohne Port starten und die Erweiterung
zwischen HTTP und stdio wechseln lassen, mit einer Nachrichten-API, die im Web und im Backend
typsicher ist; die REST-artige HTTP-API sollte weg, nicht hinter einer Fassade weiterleben.
Festgelegt: (1) Ein Vertrag je Fähigkeit als TypeBox-Objekt im `contract.ts` des Plugins
(`defineOperation`, `defineChannel`), Server (`implement`) und Web (`rpc.call`) ziehen ihre
Typen daraus; kein Codegen, keine zweite Beschreibung. (2) JSON-RPC 2.0 mit eigenem, kleinem
Kern in der Engine (`packages/ragents/src/rpc`): symmetrischer Peer mit Abbruch (`rpc.cancel`)
und Fortschritt (`rpc.progress`), Abonnements als Methoden, Rückrufe des Servers an den Client
über `implementedBy: "client"`. `vscode-jsonrpc` bleibt den Language Servern vorbehalten, weil
sein Stream-Modell nicht zu POST plus SSE passt und die Browser-Bündelung nichts gewänne.
(3) Zwei Transporte für denselben Dispatcher: HTTP mit `POST /rpc` und `GET /rpc/stream`, stdio
mit einer Nachricht je Zeile. (4) Rechte stehen im Vertrag und werden im Dispatcher geprüft;
Rechte je Run bleiben dynamisch beim Host (globaler Chat). (5) Auslieferung bleibt HTTP:
statische Oberfläche, Frames, Artefakt- und Anhanginhalte unter `/files/...`, Anmeldung; der
Erweiterungspunkt `http` ist nur noch dafür da. (6) Startmodi `--port N`, `--port 0` mit Ansage
auf stdout und erzeugtem Token, `--stdio`; eine Sperre auf dem Profilordner ist Sache des
Aufrufers, nicht des Servers. (7) Die Referenz für Menschen und Modelle entsteht aus den
Registrierungen aller Verträge als Markdown und OpenRPC; OpenAPI entfällt. Der Umbau lief in
einem Zug über Kern, alle Plugins, Web, Erweiterung, Treiber und Tests, ohne Altpfade.

## Arbeitsbereich: ein Vertrag als Naht, Bindung je Run als Richtung (18.09.2026)

Kapitel: plugins (Arbeitsbereich, Sandbox-Werkzeuge und Prozesse; Offene Grenzen), Homepage
(Sticker im Hero, Abschnitt Der Arbeitsbereich). Für die Veröffentlichung ohne das private
Produkt fehlt der VS-Code-Erweiterung der Bezug zum Projektordner: sie kennt den Workspace
nicht, und core arbeitet je Run in einem leeren Ordner. Ronald: die Erweiterung soll wissen, wo
die Dateien sind, und ein Arbeitsplatz soll sich später auch an einen entfernten Server hängen
können, mit den Dateien lokal und Modellen, Wissensbasis und Werkzeugen auf dem Server.
Festgelegt: (1) Der Server bleibt der eine Prozess je Profil, die Erweiterung ist Client; sie
startet keinen Server je Fenster wie Claude Code seine CLI. (2) `WorkspaceRuntime` und
`SandboxServices` sind die einzige Naht zum Arbeitsverzeichnis, jetzt ausgesprochen in der Spec;
in core gilt das bereits. (3) Die Bindung je Run ist die Startoption `ragents.workspace.binding`
mit den Arten `fresh`, `path` und `client`; auf Ronalds Ansage ("baue alles an einem Stück") sind
alle drei gebaut, das Konzept dazu ist gelöscht. Entscheidungen beim Bau: Die Auflösung scheitert
nie an einem fehlenden Client oder Ordner, weil der Server beim Start alle Arbeitsbereiche
auflöst und ein toter Run den Start nicht blockieren darf; erst der Werkzeugaufruf meldet die
Ursache. Ein Arbeitsplatz verbindet sich nach außen über den vorhandenen Ereignisstrom (Kanal
`workspace-client:<id>`, Ergebnisse per POST), damit es hinter NAT und mit VS Code Remote
funktioniert; die Kennung ist je VS-Code-Installation stabil, weil sie im Journal gebundener Runs
steht. Nur die fünf Grundoperationen (readFile, writeFile, access, mkdir, exec) gehen zum Client,
die Werkzeuglogik bleibt auf dem Server; Pfade in Serverwurzeln bleiben beim Server. Meldet der
Client denselben Hostnamen wie der Server und sieht der Server seine Ordner, belegt die
Erweiterung `path` statt `client` vor, damit Language Server und Prozessanzeige erhalten bleiben;
bei `client` lehnen die Language-Server-Plugins den Start mit Ursache ab. Die Vorbelegung läuft
generisch über das Host-Signal `newRun` mit `startOptions`, die Spalte kennt keine
Arbeitsbereich-Fachlichkeit. Der `WorkspaceResolver`-Haken bleibt für den Inhalt eines frischen
Ordners.

## Plugins und Profile liegen an beliebiger Stelle (18.09.2026)

Kapitel: plugins (Plugin-Ordner an beliebiger Stelle), profiles (Produktprofile). RAgents wird
öffentlich; die Plugins eines privaten Produkts, sein Profil, seine Tests, Container und
Deploy-Skripte sind in ein eigenes Repo gezogen, das über einen VS-Code-Workspace neben dem Host
bearbeitet wird. Ronald:
Ein Plugin muss an beliebiger Stelle auf der Platte liegen können, auch für fremde Autoren.
Festgelegt: (1) `PLUGINS` akzeptiert Pfade, `PRODUCT_PROFILE_FILE` eine Profildatei außerhalb des
Repos, `start.sh` Namen oder Pfad. (2) Host-Code wird über die Pakete `@aicontainer/server`,
`@aicontainer/web`, `@aicontainer/ragents` und `@aicontainer/plugins/<id>` importiert; alle
relativen `apps/`-Importe der Plugins sind umgestellt, `client-ui` ausgenommen. (3) Ein
Loader-Hook und ein Vite-Resolver lösen nackte Importe externer Dateien über den Host auf; Plugins
brauchen keine eigenen `node_modules`. (4) Das Web-Bundle entsteht aus dem Profil statt aus einem
statischen Glob; `manifest.web` macht eine fehlende Web-Hälfte im Bundle zum harten Fehler. (5)
Keine Symlinks, keine verschachtelten Repos, kein Nachladen zur Laufzeit. Verworfen: Symlinks der
privaten Plugin-Ordner ins Repo, weil sie die relativen Importe brechen und Spuren in
`.gitignore` hinterlassen. Die Paketnamen `@aicontainer/*` bleiben vorerst; eine Umbenennung ist
eine eigene Entscheidung.

## Unbekannte Werkzeugfelder werden entfernt, nicht abgelehnt (18.09.2026)

Kapitel: core (Werkzeug-Validierung), plugins (Funktionen bereitstellen). In einem Kontrolllauf
rief Qwen 3.8 27B ein Werkzeug ohne Eingabe 23-mal mit erfundenen Feldern (`previous`,
`__unused`) auf, neunmal in Folge bei demselben Agenten (3,8 Minuten), obwohl das Reasoning
jedes Mal die richtige Form nannte.
Die Ablehnung kam aus der Agentenschleife ("root: must not have additional properties", ohne
Feldnamen) und half dem Modell nicht. Ronald: nicht mehr ablehnen. Festgelegt: (1) Die
Argumentprüfung in `packages/ai/src/utils/validation.ts` erzwingt `additionalProperties: false` an
der Wurzel nicht mehr (achter eigener Eingriff in der Agentenlaufzeit); ihre Fehlermeldung nennt
bei unbekannten Feldern deren Namen, auch verschachtelt. (2) Die Engine ist die eine Stelle für
die Toleranz: `TurnToolset.invoke` entfernt unbekannte Felder der obersten Ebene eines
geschlossenen Objektschemas, führt das Werkzeug mit der bereinigten Eingabe aus, schreibt
`ignoredFields` als optionales Feld in `tool.call.started` (keine Formatversion, keine Migration)
und liefert sie dem Treiber als `ToolInvocation` zurück; der Agent-Treiber stellt dem Ergebnis für
das Modell eine deutsche Hinweiszeile voran, die bei einem Werkzeug ohne Eingabe genau das sagt.
(3) Fehlende Pflichtfelder, falsche Typen und verschachtelte unbekannte Felder bleiben harte
Fehler; die Engine-Meldung nennt auch die entfernten Feldnamen. (4) `invokeFunction` (Snippets,
`context.functions`, Capabilities von Actor-Programmen) entfernt nichts; dort prüft der Compiler.
Der Driver-Vertrag trennt jetzt `invoke` je Treiberart: Agent erhält `ToolInvocation`, Script
weiterhin den reinen Wert. Tests: `packages/ragents/tests/tool-validation.test.ts` (voller Weg mit
Faux-Modell, Journal und Modellkontext), `run-functions.test.ts` (Engine direkt),
`packages/ai/tests/validation.test.ts`.

## Stillstandstakte nicht ins Journal (18.09.2026)

Kapitel: plugins (Wächter). Ein Kontrolllauf zeigte 15 Weckungen, davon 2 nötig: 13 waren
Herzschläge während laufender Prüfrunden, in denen die beobachtete Quelle zu Recht auf einen
anderen Actor wartet und keine Ereignisse erzeugt. Eine Weckbedingung kann den Stillstand
deshalb auf Phasen außerhalb einer solchen Runde begrenzen. Nach `ready` bewertete der Wächter
alle 120 Sekunden weiter und schrieb jedes Urteil ins Journal; ein Stillstandstakt ohne Weckung
bleibt jetzt im Speicher und erzeugt keinen Journaleintrag.

## Agenten als Fork ihres Auftraggebers starten (18.09.2026)

Nachdem ein Koordinator einen Auftrag analysiert hat, startete ein von ihm beauftragter Agent
bisher kalt und las alles erneut; die Analyse erreichte ihn nur als Zusammenfassung
in `instructions`. Auf Ronalds Wunsch bekommt `agent_spawn` das Feld `forkOf`: `agent.spawned`
hält die Quelle fest, und der Agent-Treiber legt die Kontextdatei des neuen Agenten beim ersten
Turn als Kopie des Kontextzweigs der Quelle an, gekürzt vor dem ersten unbeantworteten
Werkzeugaufruf und ohne Reasoning-Blöcke; `forkableBranch` in `drivers/agent-runtime.ts` ist die
Regel dafür. Systemprompt, Werkzeuge und Modell stammen vom neuen Agenten; die Ai-Schicht wandelt
fremde Modellhistorie ohnehin um. Beide Prompts sagen, dass der Verlauf vor dem ersten Auftrag
die eigene Vorarbeit ist und nicht erneut gelesen wird. Kapitel: `docs/spec/core.md`
(Modellkontext, Subagenten ausstatten).

## Wächter ohne Modell: Weckbedingung als TypeScript, Herzschlag alle zwei Minuten (18.09.2026)

Kapitel: plugins (Wächter), Bedienung. In einem Kontrolllauf hatte das kleine
Richter-Modell (`qwen/qwen3.6-35b-a3b`) von 9 nachlesbaren Weckungen 4 mit erfundenen Änderungen
begründet ("completedTurns von 14 auf 15", obwohl die vorgelegte Liste keinen solchen Eintrag
hatte) und eine gegen die eigene Begründung ausgesprochen; die Nicht-Weckungen waren gar nicht
nachvollziehbar, weil sie nicht journalt wurden. Ronald: "Vielleicht sollten wir das ohne LLM
machen. Einfach nur imperativ mit einem wirklich guten TypeScript-Skript." Und: Der Wächter darf
nie einschlafen; meldet die beobachtete Quelle nichts, soll das LLM alle ein bis zwei Minuten
selbst nachsehen.

Festgelegt: (1) Die Bedingung eines Wächters ist der Rumpf einer TypeScript-Funktion
`(now, before) => string | undefined` über dem ohnehin deterministischen Stand; sie wird beim
Anlegen mit dem gemeinsamen Compiler gegen `WatchState` typgeprüft und zur Laufzeit in einem
`vm`-Kontext mit 200 ms Grenze ausgeführt. Kein Modell, kein `WATCH_MODEL`, `judge.ts` und die
Profilsektion `ragents.watch` sind weg; das Konzept `watch-plugin.md` ist umgesetzt und gelöscht.
Server-Code und LLM-Actors übergeben dieselbe Form, ein LLM-Actor also Code statt Satz. (2) Jede
Bewertung, auch eine ohne Weckung, steht mit Grund und vorgelegten Änderungen als eines der
letzten zehn Urteile im Plugin-Zustand am Run. (3) Der Stillstand ist der Herzschlag: der
Monitor eines Ablaufs setzt `stallAfterSeconds` auf 120; ohne Ereignis der beobachteten Quelle
meldet der Wächter je Periode erneut, auch bei laufendem Turn, und der Weckhinweis sagt dem
Koordinator, dass er dann Status und Aktivität liest und entweder berichtet, was läuft, oder den
nächsten Schritt gibt. Ein Turnende mit unfertigem Auftrag geht dem Stillstand vor. (4) Der
Wächter misst die Zeit mit der Uhr der Laufzeit (`Orchestration.now()`), nicht mit `Date.now()`,
sonst sehen Testläufe mit fester Uhr Wochen an Stillstand. Die zwei Sperren vom Vortag (ruhende
Quelle, unveränderte Änderungsliste) bleiben als Vorfilter. Die Weckbedingungen sind mit allen
Zweigen getestet (`apps/server/tests/watch.test.ts`).

## Werkzeugsatz der Agentenlaufzeit ist read, write, edit, bash (18.09.2026)

Die Werkzeuge `grep`, `find` und `ls` sind aus `packages/agent` entfernt: Der Server hat sie nie
verdrahtet, Suche und Verzeichnislisten laufen wie bei Claude Code über `bash`; der Werkzeugsatz
ist `read`, `write`, `edit`, `bash`.

## Befunde aus einem Kontrolllauf: Reviewer in Paketen, ruhende Quelle für den Wächter (17.09.2026)

Ein Kontrolllauf eines vorbereiteten Ablaufs mit demselben Auftrag wie ein früherer Lauf
brauchte deutlich länger, fünf Eingriffe des Fahrers und sieben Prüfrunden. Die Codeänderung ist
richtig, die Mehrkosten sind Regressionen der Änderungen vom 16./17.09. Je Befund ist
entschieden, wo die Lösung liegt:

1. Der Steueractor lief mit `maxConcurrent: 50` in einer Schleife gegen die Grenze von 64
   Capability-Aufrufen je Eingabe (fünf je Reviewer): Runden 1 und 2 brachen nach 15 Reviewern
   ab, der Koordinator patchte das Actor-Programm selbst und baute einen Folgefehler ein
   (Runden 3 bis 5). Fachlich im Run-Script: Zuweisung in Paketen zu zehn je Eingabe mit
   Selbstanstoß, Parallelität 25 (Ronald: 50 war zu hart), Programmtest mit 33 Regeln bei 25.
   Die Grenze der Laufzeit bleibt; sie schützt vor Endlosschleifen.
2. Der Koordinator hat den Steueractor gelesen, gepatcht und aktiviert. Ronald: Koordinatoren
   dürfen Infrastruktur grundsätzlich bauen und ändern; in einem vorbereiteten Ablauf nicht.
   Also kein Host-Verbot, sondern ein Absatz im Koordinator-Prompt des Ablaufs: Actor-Programme
   des Runs sind Infrastruktur, Fehler werden im Wortlaut als Blockade gemeldet,
   TypeScript-Actors nur über ihre Funktionen bedienen (Freitext an den Steueractor brach jede
   Runde erneut ab).
3. Der Wächter weckte 21-mal, nötig waren 2 (Fortsetzung nach unfertigem Turn, ready). 19
   Weckungen waren Kenntnisnahmen mit je einem Modellaufruf, aber jeder Aufruf trug den
   gesamten Verlauf (bis 133k Tokens). Ursache der Weckungen: Anweisungen stauten sich bei der
   beobachteten Quelle, jedes Turnende in der Kette erfüllte "Turn beendet und nicht fertig"
   formal; das kleine Modell weckte auch gegen die eigene Begründung und mit erfundenen
   Änderungen. Allgemein in `ragents.watch`, deterministisch vor dem Modell: keine Bewertung,
   solange die Quelle einen Turn ausführt oder Eingaben auf sie warten (Ausnahme Stillstand);
   leere oder unveränderte Änderungslisten nicht erneut vorlegen. Die Strategie
   (deterministischer Stand, kleines Modell ohne Verlauf) bleibt.
4. Der Kontext des Koordinators bestand zu 70 Prozent aus altem Thinking, das `packages/ai` für
   jedes OpenRouter-Modell in jeden Folgeaufruf zurückschickt. Ronald: ob ein Modell das
   braucht, ist modellabhängig, es gibt keinen üblichen Weg; also kein pauschales Weglassen.
   Offen als TODO: Modellmerkmal im Katalog und Test mit GLM 5.3 flash.
5. `browser_check` scheiterte 23-mal am Rauschen der geprüften Anwendung, obwohl die Assertion
   bestand; `noErrors` hatte im Schema keine Beschreibung. Allgemein in `ragents.browser`:
   Beschreibung ergänzt (der Browserphasen-Prompt nannte `noErrors: false` bereits).
6. Der Kontextbeitrag der Projektdiagnostik (fünf echte TS-Fehler in einem Run-Script)
   erreichte alle 157 Reviewer; einer halluzinierte daraus vier Befunde. Allgemein in
   `ragents.actor-programs`: der Beitrag gilt nur für Actors, denen die Actor-Programm-Werkzeuge
   zur Verfügung stehen (`applies`). Die Projektfehler selbst bleiben als TODO.

Nicht geändert: der Sockel von rund 7k Tokens je Koordinator-Aufruf (Systemprompt und
Verträge); er ist bei greifendem Anbieter-Cache billig. Der Cache griff bei GLM 5.3 flash in
einem Drittel der Aufrufe nicht, weil OpenRouter unter 28 Providern wechselt; ein
Konfigurationsschlüssel für die Provider-Bindung (`compat.openRouterRouting` existiert schon)
steht als TODO. Kapitel: `docs/spec/plugins.md` (Wächter), `docs/spec/core.md`
(Kontextbeitrag).

## Webseiten zeigt der Host, wenn er kann (17.09.2026)

Kapitel: plugins. "Anwendung öffnen" und die Anwendungsvorschau eines Fachplugins öffneten immer
den modalen Dialog mit iframe, auch in VS Code, wo ein Reiter im Simple Browser natürlicher ist.
Statt jeder Stelle eine VS-Code-Sonderlocke zu geben, gibt es einen neutralen `PageOpener`-Kontext
in der Web-App: die Spalte stellt ihn im Host `vscode` aus der neuen Vertragsnachricht `openPage`
bereit, im Browser fehlt er. Fachplugins fragen ihn und fallen sonst auf ihren Dialog zurück; der
Dialog bleibt für Protokoll und Fehler.

## Dunkel als Vorgabe der Oberfläche (17.09.2026)

Kapitel: plugins. Ronald gefällt die dunkle Darstellung, wie sie die Spalte in VS Code aus dem
Editor-Theme übernimmt; sie soll auch im Browser die Vorgabe sein. Ohne gespeicherte Wahl startet
die Web-App deshalb dunkel statt hell; Hell und System bleiben unter Darstellung wählbar, eine im
Browser gespeicherte Wahl gilt weiter.

## Spalte mit Fokus auf die Mini-App: eine Kopfzeile, Sheet-Chat, Adressat in der Eingabeleiste (17.09.2026)

Kapitel: plugins. Die Spalte in VS Code verbrauchte vier Zeilen, bevor Inhalt kam: die breite
Web-Toolbar als zweizeilige Kopfzeile, eine Chipzeile für die einzige Mini-App, deren Titel die
Bühne direkt darunter wiederholte, und Actor-Chips, die bei der Vorgabe `Aktive` alle 70
bereitstehenden Review-Agenten zeigten und umbrachen. Nach dem Entwurf
`docs/ui-drafts/vscode-column-focus.html` gilt jetzt: eine Kopfzeile mit Titel und Zustand, die
Kopfzeilenbeiträge (Branch, Systemprompts, Turn, Lauf stoppen) hinter dem Titel als Popover; eine
Mini-App bekommt die Bühne ohne Chipzeile und Überschrift, ihr Knopf für die Mitte erscheint beim
Zeigen; der Chat ist ein Sheet am unteren Rand, das auf Maus, Fokus oder Griff auf 90 Prozent der
Fläche hochgleitet, ohne das Layout zu verschieben (Ronald wollte ausdrücklich das Gefühl der
iPhone-Sheets: unten bündig, seitlich frei, oben rund, und keine Bewegung der Eingabe beim
Aufklappen, deshalb gleitet allein die Höhe und die Eingabe bleibt am unteren Rand verankert);
die Nadel dockt ihn wie bisher an, ab 900 Pixel Breite liegt er rechts daneben. Der Adressat
wandert als Pop-out in die Eingabeleiste neben Detailgrad und Senden, dazu der erste arbeitende
Actor mit Spinner. Die Actor-Anzeige hat jetzt überall die Vorgabe `Sichtbare`: was auf dem Canvas
ausgeblendet ist, gehört auch in Kopfzeile und Pop-out hinter die Zahl. `ChatSurfaceOptions`
bekommt dafür `toolbarRight`, `ActorChatControls` die Darstellung `column` mit beiden Slots.
Nicht gebaut: ein kompaktes Format der Kopfzeilenbeiträge; das Popover zeigt sie unverändert,
solange nur die Spalte es braucht. Nachtrag am selben Tag: Ronald will Breite und beide
Verzögerungen selbst stellen, deshalb stehen sie als Einstellung `Arbeitsspalte` unter Darstellung
statt als Konstanten im Code. Zweiter Nachtrag: die Nadel ist einem Layout-Schalter mit
`Automatisch`, `Sheet`, `Unten`, `Daneben` gewichen, weil Ronald die Anordnung auch von Hand
festlegen will; daneben bekommt der Chat einen senkrechten Griff für seine Breite. Zugeschoben
zeigt das Sheet keinen Rahmen, dafür eine Statuszeile (Rückfrage, aktuelle Arbeit oder letzte
gesprochene Zeile), damit man sieht, ob der Chat etwas tut. Dritter Nachtrag: der Vierfach-Schalter
war zu viel. Ronald will nur rechts oder unten wählen, und unterhalb der eingestellten Breite
liegt der Chat immer unten; `docked` samt Bühnenhöhe ist zurückgebaut, frühere gespeicherte Werte
werden auf die zwei Lagen abgebildet. Dazu kommt rechts oben ein Menü mit Einstellungen, "Im
Browser öffnen" und Abmelden; in VS Code läuft die Abmeldung über den Host (`logout` im
Spaltenvertrag), weil der Extension-Host den Token hält. Vierter Nachtrag: "Neuer Run" ist die
erste Karte der Run-Liste statt eines Knopfs in der Kopfzeile, und der Zurück-Pfeil ist ein
Chevron, der die Liste über den laufenden Run klappt; Escape kehrt zum Run zurück, ohne ihn
verlassen zu haben. Die Run-Übersicht der Web-App zeigt dieselbe Karte statt ihres Knopfs, damit beide
Einstiege gleich aussehen. Die Testinstanz aus `scripts/start-vscode.sh` startet jetzt in einer eigenen
Sitzung (`setsid` per Perl, zweiter Fork gegen das Kontrollterminal), weil der VS-Code-Task sie
sonst mit seinem Ende beendete. Die Ansicht heißt schlicht `RAgents`, und ohne erreichbaren Server
zeigt ihr Webview einen Hinweis mit Adresse und Fehler statt eines leeren iframes; ein zweiter Task
startet die Testinstanz gegen ein zweites Profil, und beide ersetzen eine laufende Instanz statt sich zu weigern.
Ronald will nicht erst den Server und dann die Instanz von Hand starten, deshalb startet das Skript
zu jedem Profil den Server selbst mit, wenn er nicht antwortet, und wartet auf `/health`.

## Gruppierte Schritte als Vorgabe aller Chats, Plugin-Quellen im Tailwind-Build (17.09.2026)

Kapitel: plugins. Ronald will den Detailgrad `grouped` überall als Vorgabe: Host-Policy,
globaler Koordinator, Server-Fallback der Produkt-Policy und die Konfiguration der Profile stehen
jetzt auf `grouped`; im Browser gespeicherte Auswahlen bleiben wie bisher vorrangig.
Dabei fiel auf, dass der Vite-Build die Plugin-Ordner nicht scannte: `@source` mit einem
Verzeichnis-Glob (`plugins/*/web`) findet keine Dateien, erst `plugins/*/web/**/*`. Die
Utilities der Plugins (Inspector-Abstände, Statusleiste, Materialfarben) fehlten deshalb im
gebauten Stylesheet; Fixtures und Mini-App-Compiler waren nicht betroffen, weil sie die
Ordner ausdrücklich übergeben.

## Arbeitsspalte und VS-Code-Erweiterung, Anmeldung per Token (17.09.2026)

Kapitel: plugins, profiles. Ronald wollte RAgents am Rand von VS Code: links ein Explorer der
Runs, rechts eine Spalte mit Chat und Mini-Apps, die Mitte für Code (Entwurf E aus
`docs/ui-drafts/vscode-sidebar.html`). Umgesetzt ohne zweite Oberfläche: `column.html` ist ein
zweiter Vite-Einstieg derselben Web-App, `PluginChat` bekommt ein `layout`, und die Spalte selbst
ist ein `Column`-Beitrag des Orchestrierungs-Plugins neben seinem `Center`, weil der Host die
Laufansicht nicht kennt und plugin-neutral bleibt. Die Erweiterung unter `apps/vscode` ist eine
dünne Hülle: nativer Baum, Webview mit iframe auf `column.html` in der zweiten Seitenleiste
(VS Code kennt `viewsContainers.secondarySidebar`), je Mini-App ein Editor-Reiter. Offene
Fragen des Entwurfs sind entschieden:

- Anmeldung: Das Anmeldecookie kommt im iframe eines VS-Code-Webviews nicht an (Drittkontext,
  SameSite). Statt Stufe 2 (eigenes Bundle, CORS, Basis-URLs in jedem Plugin) meldet sich der
  Extension-Host selbst an, hält den Sitzungstoken in der SecretStorage und gibt ihn den iframes
  in der Adresse mit; der Server nimmt den Token als Bearer und, für GET-Abrufe ohne Header, als
  Abfrageparameter `access` an. Dasselbe gilt für den älteren `ACCESS_TOKEN`; dafür sind die
  gebauten Assets frei und nur Seitennavigationen werden umgeleitet. Die Mini-App-Frames erlauben
  die VS-Code-Webviews als Vorfahren.
- Zweite Seitenleiste: vorhanden ab VS Code 1.134; die Erweiterung verlangt diese Version.
- Mehrere Fenster: Der Spaltenzustand bleibt je Webview-Speicher, also je Fenster; genügt, weil
  der Server nichts davon wissen muss.
- `PluginChat` braucht den Layout-Parameter, `renderChat` allein reicht nicht: Provider,
  Kopfzeilenportal und Startdialog gehören auch in die Spalte, Canvas-Leiste und Werkstatt nicht.
- Der Standort `surface: "column"` für den globalen Koordinator entfällt, weil die Spalte ihn
  nicht zeigt; sie meldet keinen Standort.
- Der Explorer zeigt Actors nur mit ihrem Serverzustand; die persönliche Actor-Anzeige lebt im
  Webview und ist dem Extension-Host nicht bekannt.

Stufe 2 (Spalte ohne iframe) bleibt eine TODO-Zeile; das Konzept `vscode-extension.md` ist
gelöscht. Ein Host-Test (`pnpm --filter ragents-vscode test:host`) prüft die Erweiterung in
einem echten VS Code gegen einen laufenden Server, auch mit Anmeldung und `ACCESS_TOKEN`.

## Wächter mit Weckbedingung statt festem Monitor (17.09.2026)

Kapitel: plugins, core. Vier Läufe vom 16.09.2026 zeigten: Der Monitor schickte
bereits nur Deltas, und der Koordinator fragte danach fast nie den Status ab (4 von 53
Weckungen). Der Aufwand lag in der Weckung selbst: jede war ein voller Koordinator-Turn mit 11k
bis 39k Input-Tokens und wachsendem Verlauf, und in 12 von 13 Fällen erzählte der Koordinator
nur nach, was die Mini-App ohnehin zeigt; Leer-Weckungen ("Turn beendet, nichts geändert")
lösten unnötige Werkzeugrunden aus. Die Weckregel und der Fortschrittsvergleich waren fest in
einer Serverklasse eines Fachplugins codiert.

Festgelegt: (1) Neues neutrales Plugin `ragents.watch`. Ein Actor sagt als Satz, wen er
beobachten und wann er wecken soll (`watch_create`, dazu `watch_list`, `watch_remove`). Der Dienst
verfolgt den Stand deterministisch (Lebenszyklus, Turns, Eingaben, Fragen, letzter Ausgabetext,
optional das Ergebnis einer benannten Operation, Stillstand) und lässt ein kleines Modell ohne
Verlauf nur entscheiden: wecken oder nicht. Jede Bewertung sieht Bedingung, aktuellen Stand,
Änderungen seit der letzten Weckung und die letzten drei Urteile; der Kontext bleibt konstant.
Modell in der Profilsektion (`WATCH_MODEL`, Vorgabe `qwen/qwen3.6-35b-a3b`). Definitionen und
Grundlinie stehen als Plugin-Zustand im Journal und überleben einen Neustart. (2) Die
Pluginreihenfolge zählt: `ragents.watch` steht in Profilen vor den Plugins, die es verwenden.
Offen bleiben ein lokaler Provider für das kleine Modell, ein zweiter Nutzer und ein optionaler
Erzähler (`TODO.md`); das Konzept steht in `docs/concepts/watch-plugin.md`.

## Eine Fläche, eine Gruppenbeschriftung: Card und SectionLabel (17.09.2026)

Kapitel: plugins. Nach der Tailwind-Umstellung stand dieselbe Flächenbeschreibung als
Klassenkette an einem Dutzend Stellen, und die kleine Versalienbeschriftung war an jedem
Abschnitt neu getippt. `Card` ist jetzt die Fläche des Hauses (`rounded-panel`, Hostkontur,
Kartenfläche, `shadow-bar`) und hat die ad-hoc-Flächen in Anmeldung, Darstellung, Übersicht,
Einstellungen, Canvas-Hinweis und Referenz-Vorschau ersetzt; Abweichungen stehen als
`className` daran. Die shadcn-API bleibt unverändert. Neu ist der eigene Baustein
`SectionLabel` für die Gruppenbeschriftung; Beschriftungen, die eine Überschrift oder ein `dt`
sind, bleiben ihr Element. Schwebende Flächen mit eigener Komponente, die Materialkarten des
Canvas und die leichteren Innenflächen einer Karte bleiben unverändert. `SectionLabel` steht
Mini-Apps über dieselbe Bibliothek zur Verfügung, bleibt aber aus dem generierten
Bausteinkatalog heraus: es nimmt die nativen `div`-Props, deren Tabelle die Referenz mit
knapp 300 Zeilen fluten würde.

## Koordinator-Kopfzeile: breiter, feste Höhe, Toasts nur bei geschlossenem Verlauf (17.09.2026)

Kapitel: plugins. Nach der Tailwind-Umstellung wuchs die Kopfzeile mit einer zweizeiligen
Koordinator-Eingabe, der Kurzantwort-Toast war schmal und sein X saß im Text. Ronald wollte den
Koordinator 50 Prozent breiter (570 statt 380 Pixel), den Toast doppelt so breit und sauber
gesetzt, eine Kopfzeile, die nie wächst, und Toasts nur, wenn der Verlauf nicht ausgeklappt ist.
Die Toolbar-Eingabe ist jetzt fest einzeilig und scrollt, Kopfzeile und Beitrag haben feste
45 Pixel; der Toast ist eine Zeile aus Textfläche und rundem X; eine Kurzantwort bei offenem
Verlauf wird verworfen.

## Gesamte Oberfläche auf Tailwind und shadcn, ein Token-File (17.09.2026)

Kapitel: plugins, run-modules. Seit dem 15.09. galt Tailwind nur für die Controls und die
Mini-App-Frames, die übrige Oberfläche lief über rund 8.700 Zeilen eigenes CSS in Host und
Plugins mit `--qsl-*`-Tokens und einer zweiten Token-Schicht in `theme.css`. Ronald wollte
dieselbe Technik allumfassend und ohne Redundanz. Festgelegt:

- `apps/web/src/ui/theme.css` ist die einzige Token-Quelle; `tokens.css` und `ui.css` sind
  weg, ebenso jede `--qsl-*`- und `--ui-*`-Variable. Zusätzliche Hostfarben, Materialfarben,
  Schatten, Radien und Animationen sind Tailwind-Theme-Tokens und damit als Utilities nutzbar.
- Der Host-Einstieg lädt Tailwind mit Preflight; die Rücksetzregeln für `data-slot` und
  `base.css` entfallen. Alle Klassen-Stylesheets (`app.css`, `chat.css`, `panel.css`,
  `host-widgets.css`, die Plugin-`plugin.css`, `material.css`, die Mini-App-`styles.css`)
  sind Regel für Regel in Utility-Klassen an den Elementen aufgegangen und gelöscht.
- Wiederkehrende Muster sind Komponenten statt Klassen (`ToolbarItem` und Geschwister in
  `Toolbar.tsx`, `Badge`, `Empty`, `Alert`, `Card`, `Spinner`); Kontext läuft über
  `data-*`-Attribute und `in-data-[...]`-Varianten (`data-surface="material"`).
- CSS bleibt nur für fremd erzeugtes Markup: highlight.js, react-diff-view, xyflow.
- Tests wählen nicht mehr über Klassen. Der Mini-App-Compiler und die Homepage-Builds scannen
  die Host-Quellen mit; die Homepage bezieht ihre Tokens aus `theme.css` und scannt nur ihre
  eigenen `.tsx`-Quellen, nicht ihre erzeugten Ausgaben.
- Das je Programm kompilierte Frame-Stylesheet liegt als `frame.css` im Build-Ordner
  (`stylesFile`), nicht mehr je View im Programm-JSON; sonst sprengten zweiseitige
  Programme die 250-KB-Grenze. Bereits installierte Programme brauchen eine erneute
  Aktivierung.
- Die kompakte Skala (`--spacing: 0.235rem`, `text-sm` 0.78rem) bleibt bewusst; Pixelwerte
  der alten Regeln sind auf die nächste Stufe gerundet, die Oberfläche ist damit an einigen
  Stellen um wenige Pixel enger oder weiter als zuvor.

## Actor-Anzeige `Sichtbare` (17.09.2026)

`Anzeige` erhält zwischen `Aktive` und `LLM-Agenten` den Modus `Sichtbare`: nur Actors, deren
Karte oder Kachel gerade auf dem Canvas steht, plus der primäre Actor, dessen Zugang die Leiste
ist. Ronald wollte die Leiste auf das eingrenzen, was er auf der Fläche sieht; `Aktive` blendet
nur gestoppte Actors aus und wirkt ohne gestoppte Actors wie `Alle`. Grundlage sind die
Bühneneinträge aus `publishStageEntities`, die schon die ausgegrauten Zugänge bestimmen; damit
gilt der Modus in freiem Canvas und Kacheln gleich. Kapitel: `docs/spec/plugins.md`; Bedienung
und Homepage sind angepasst.

## Detailgrad "gruppiert" für Schritte (17.09.2026)

Zwischen `chips` und `compact` steht der neue Detailgrad `grouped`: alle Denk- und
Werkzeugschritte zwischen zwei Antworten fallen zu einer aufklappbaren Zeile "N Schritte"
zusammen, aufgeklappt erscheinen sie als die einzeiligen Zeilen des `compact`-Modus mit
demselben Popover. Ronald wollte die Gruppierung, wie Codex sie zeigt, ohne dass die Gruppe
beim Öffnen sofort alle Details ausbreitet; erst die Gruppe, dann die Zeile, dann das Popover.
Die einzeilige Darstellung ist dafür aus `Bubble` in `TraceLine` gezogen und wird von beiden
Modi verwendet. Kapitel: `docs/spec/plugins.md`.

## Detailgrad je Anzeigefläche (17.09.2026)

Canvas-Karte, Seiteninspector und Popout desselben Actors teilten sich bisher den gemerkten
Detailgrad (Schlüssel Run + Actor). Ronald will ihn je Fläche: im Inspector "alles" lesen,
auf der Karte gruppiert bleiben. `useChatSteps` nimmt eine dritte Kennung `surface` in den
Schlüssel; `ActorChat` und `ActorChatControls` leiten ihre Darstellung durch, das Popout meldet
sich als `popout`, Kachel-Inspectoren als `canvas`. Ohne Fläche bleibt der bisherige Schlüssel
gültig. Kapitel: `docs/spec/plugins.md`.

## Erinnerungen an laufende Turns über den Kontextbeitrag, Vorschau nie allein im iframe (16.09.2026)

Ein autonomer Lauf brachte Reibungspunkte; je Punkt ist entschieden, ob die Lösung allgemein
oder fachlich ist:

1. Der Monitor reihte einem laufenden Agenten nach einer Minute ohne Bericht eine Erinnerung
   als Input ein. Ein Input erreicht einen laufenden Turn nie; die Erinnerung wurde erst danach
   als eigener Turn verarbeitet ("Der Bericht ist nachgereicht"), änderte Detailtexte, und der
   Koordinator antwortete auf den Folgeping "Keine Änderung". Der Erinnerungstext rechnete mit
   genau diesem Fall, die Verspätung war eingebaut. Allgemeine Regel in `core.md` (Scheduler
   und Turn): Ein Input, der sich auf den laufenden Turn bezieht, ist beim Verarbeiten immer
   veraltet und darf nicht eingereiht werden; in einen laufenden Turn führt nur der
   Kontextbeitrag der Agentenlaufzeit (`agentRuntime`-Contribution, Ereignis `context`), wie ihn
   die Projektdiagnostik der Actor-Programme schon verwendet. Ein Fachplugin ergänzt damit vor
   jedem Modellaufruf eines fälligen Turns eine nicht angezeigte Nachricht; offene
   Benutzerfragen unterdrücken sie.
2. Der Vorschau-Dialog blieb leer: die geprüfte Anwendung lädt eine Bibliothek, die jedes
   Nicht-Top-Fenster nach `about:blank` verlässt; im Playwright-Browser des Agenten ist sie
   Top-Fenster. Allgemein: Anwendungen dürfen das Einbetten verweigern, der Host erkennt das
   über die Origin-Grenze nicht. Regel in `plugins.md` (Web als Plugin-Host): ein Dialog mit
   fremder Web-Anwendung nennt die Adresse und bietet immer "In neuem Tab öffnen".
3. Zeitanalyse des Laufs: eine Prüfrunde brauchte 3,8 Minuten bei 10,3 Minuten Einzelzeit,
   weil `maxConcurrent: 3` in der Ablaufdefinition nur drei Instanzen gleichzeitig zuließ (Rest
   aus der Zeit vor dem Compiler-Pool). Ronald: Parallelität 50, praktisch unbegrenzt; die
   Reihenfolge "erster Aufruf allein, dann alle" für den Anbieter-Cache bleibt.
4. Werkzeugzählung: 86 Aufrufe eines Agenten, davon 39 `typescript_eval`-Snippets ohne eine
   Zeile Logik, nur Einzelaufrufe von Browser-, Report-, Status- und Diagnostikfunktionen;
   weitere 36 Snippets für Kontext und Bericht. Jede Hülle kostet Kontext, rund eine Sekunde
   Compiler und liefert Vertragsfehler als TS-Diagnose. Ronald: mehr Werkzeuge nativ. Die
   bisherige Regel ("nativ nur, wenn der Umweg etwas verliert") ist durch eine Zuordnung
   ersetzt (`plugins.md`, Funktionen bereitstellen): nativ, was allein aufgerufen und gelesen
   wird (Bedienung, Bericht, Status, Diagnostik); Snippet, was kombiniert, filtert oder Werte
   weiterreicht. `nativeTool: true` an den Browserfunktionen (außer `browser_viewport`) und den
   Language-Server-Diagnosen; die Prompts sagen, was direkt ist, und verlangen, unabhängige
   Aufrufe in einer Antwort zu bündeln. Aufrufe, deren Ergebnis weitergereicht wird, bleiben
   Snippet, damit keine Werte abgetippt werden.

Kapitel: `docs/spec/core.md` (Scheduler und Turn), `docs/spec/plugins.md` (Web als Plugin-Host).
Die generierten Referenzen unter `docs/homepage/` sind mit `pnpm generate:homepage` nachgezogen.

## `scripts/` thematisch gegliedert (16.09.2026)

Der Ordner `scripts/` war mit 30 Dateien flach: Homepage-Generator samt Tests,
Run-Driver, Modellkatalog und Konzept-Audit lagen neben den beiden Einstiegen. Ronald: thematische
Unterordner statt 30 Dateien flach. Festgelegt: `scripts/` behält nur die Einstiege `start.sh`
und `install-plugin-dependencies.sh`, die README, Dockerfile, Beispielkonfiguration und
Dokumentation nennen. `scripts/homepage/` enthält alle `homepage-*.ts` samt Tests, `generate-homepage.ts` und
`tsconfig.homepage.json`; `scripts/driver/` enthält `run-driver.ts` mit Test;
`scripts/maintenance/` enthält `update-model-catalog.ts`, `concept-audit.fsx` und
`concept-audit.test.py`. Die Dateien wurden mit `git mv` verschoben, geändert wurden nur
relative Importe, Wurzelberechnungen und Pfadliterale (`package.json`, `build/homepage.sh`,
`tsconfig.homepage.json`, `homepage-extensions.test.ts`, `concept-audit.fsx`). Generierte
Homepage-Dateien wurden neu erzeugt.
Betroffen: `README.md` (Ordnertabelle, Entwickeln), `docs/operations.md`, `docs/spec/overview.md`.

## Läufe von außen fahren: `pnpm driver` im Repository (16.09.2026)

Die autonomen Läufe des Tages wurden mit einem losen Hilfswerkzeug außerhalb des
Repositorys gefahren (HTTP-API plus Journal-Auswertung, Anmeldung per Playwright).
Ronald: das ist ein sinnvolles Werkzeug und gehört ins Repository, konfigurierbar statt
hartkodiert. Festgelegt: `scripts/run-driver.ts` als `pnpm driver` mit den Befehlen new-run,
send, stop, sessions, journal und usage. Profil über `PRODUCT_PROFILE` wie bei `start.sh`,
Adresse aus `host.PORT` (`RAGENTS_DRIVER_URL` überschreibt), Datenordner aus `DATA_DIR` oder
Profilstandard, Anmeldung per `POST /api/access/login` mit `RAGENTS_DRIVER_USER` und dem
Passwort aus der Profildatei; ohne Benutzer bei benutzerpflichtigem Profil harter Fehler. Die
Journal-Auswertung ist als reine Funktionen getestet (`scripts/run-driver.test.ts`, läuft mit
den Homepage-Skripttests). Laufberichte und Übergabe bleiben außerhalb des Repositorys.
Betroffen: `docs/operations.md` (Läufe von außen fahren), `README.md` (Entwickeln).

## Abgegebene Werkzeugergebnisse gelten, leere Modellantworten werden nachgestoßen (16.09.2026)

In einem Kontrolllauf scheiterten in einer Prüfrunde 4 von 18 Instanzen technisch, nicht
fachlich, und kosteten eine Nachrunde von rund 11 Minuten. Zwei Modellantworten bestanden nur
aus Reasoning ohne Text und ohne Werkzeugaufruf bei Stopgrund `stop`; eine Instanz lief in den
Provider-Timeout; und eine Instanz gab ihren Bericht per Werkzeugaufruf ab, ihr Turn endete
danach mit "Upstream idle timeout exceeded", worauf der Abschluss mit `error` die Prüfung
zurücksetzte. Ronalds Vorgabe: Zeitgrenzen bleiben, Prüfungen dürfen lange dauern. Festgelegt:

1. Ein Werkzeugergebnis im Journal bleibt gültig, egal wie der Turn danach endet; die Regel
   steht in `core.md` (Scheduler und Turn).
2. Die Agentenschleife (`packages/agent-core/src/agent-loop.ts`) stößt bei einer Antwort ohne
   Text und ohne Werkzeugaufruf genau einmal mit einer Nutzer-Nachricht nach; bleibt die
   nächste Antwort leer, wird sie zur Fehlerantwort "Modell lieferte zweimal eine leere
   Antwort." und der Turn endet über die vorhandenen Fehlerpfade als `failed` (Runtime-Ausgabe
   und Grund in `turn.finished`), nicht als `completed`. Text oder Werkzeugaufruf setzen die
   Zählung zurück; Zeitgrenzen sind unverändert. Tests:
   `packages/agent-core/tests/empty-response.test.ts` (neues Testskript des Pakets, in
   `build/check.sh` aufgenommen) und `packages/ragents/tests/agent-runtime.test.ts` für das
   Turn-Ergebnis des Drivers.

Kapitel: `docs/spec/core.md` (Scheduler und Turn). Die generierten Referenzen unter
`docs/homepage/` sind mit `pnpm generate:homepage` nachzuziehen.

## Befunde aus zwei autonomen Läufen (16.09.2026)

Zwei autonom gefahrene Läufe lieferten zehn Reibungspunkte; Ronald hat je Punkt entschieden, ob
die Lösung in Engine, Host, neutralen Plugins oder im Fachplugin liegt. Allgemein festgelegt und
umgesetzt:

1. WECK-GARANTIE als Regel in `core.md`: Wer einen Actor auffordert, den Turn zu beenden und
   auf Weckung zu warten, muss ihn garantiert wecken; ein passiv wartender LLM-Koordinator ist
   keine Weckung. Ein Agent beendete nach einem synchronen Werkzeugaufruf seinen Turn und stand
   14,5 Minuten, bis ein Mensch eingriff. Der Monitor des Fachplugins, der das Turn-Ende ohnehin
   über die Journalbeobachtung sieht, ist jetzt dieser Beobachter: bei nicht terminaler Phase,
   ohne wartenden Input, ohne laufenden oder beauftragten weiteren Actor, ohne offene Frage und
   ohne Übergabe an den Koordinator reiht er den konkreten nächsten Schritt aus dem
   Workflowstand ein, je Stand nur einmal; ein zweites Turnende ohne Änderung meldet er dem
   Koordinator als Stillstand.
2. Neuer Test `apps/server/tests/prompt-snippet-contract.test.ts`: alle TypeScript-Beispiele
   aus Prompts, Skills und Run-Script-Prompts (Zäune und einzeilige `context.functions`-Ketten)
   werden mit dem Snippet-Compiler gegen die Run-Kontext-Deklarationen der Profil-Fixtures
   kompiliert; Handlebars-Platzhalter werden vorher neutralisiert. Gefunden und behoben: ein
   Prompt griff mit `entries[0].path` ungeprüft auf einen möglicherweise leeren Eintrag zu.
   Sechs Beispiele sind abgedeckt.
3. `bash` liefert einen Exit-Code ungleich null als Ergebnis (`Command exited with code N` als
   letzte Zeile), nicht als Werkzeugfehler; Werkzeugfehler bleiben Start, Zeitgrenze und
   Abbruch (acht Fehlversuche durch `grep` ohne Treffer und `grep -P`). Die Workspace-Plugins
   liefern einen an `bash` gebundenen Promptbeitrag mit der Plattform der Shell aus
   `process.platform` (`plugin-support/shell-platform.ts`), unbekannte Plattform ist ein
   Startfehler.
4. Browserziele erhalten `nth` (0-basiert) oder `first: true`, `browser_check` erhält `count`
   (sichtbare Treffer statt Eindeutigkeit); Strict-Mode-Fehler nennen weiter die Kandidaten und
   jetzt den Ausweg; reine Sichtbarkeits- und Adressprüfungen warten höchstens 5 Sekunden statt
   15 (sechs Fehlversuche je 15 Sekunden).

Kapitel: `docs/spec/core.md` (Actors, Inputs, Events und Subscriptions), `docs/spec/plugins.md`
(Sandbox-Werkzeuge, Browserprüfungen). Die generierten Referenzen unter `docs/homepage/` sind
mit `pnpm generate:homepage` nachzuziehen.

## Koordinator-Tokens: kompakte Funktionsergebnisse, schlankes typescript_api (16.09.2026)

Messung in einem Lauf: der Koordinator brauchte 31 Modellaufrufe mit 933k Input-Tokens; 731k
davon fielen nach dem Start eines beauftragten Agenten an, 356k allein für fünf Monitor-Pings
ohne jede Änderung, die je einen `typescript_eval`-Aufruf und eine Antwort "Keine Änderung"
kosteten. Der Kontext wuchs auf 40k Tokens, vor allem durch das `typescript_api`-Ergebnis mit
doppelten Schemata (32k Zeichen) und einen Snapshot mit 50 Einträgen (20k). Vier Fehlversuche
kamen aus Vertragslücken: verpflichtendes leeres Argument (TS2554), `undefined` in Ergebnissen,
eine Feldbindung erst zur Laufzeit, ein Feld in der Beschreibung, aber nicht mehr im Schema.

Festgelegt, allgemein und nicht nur für diesen Run: (1) Ein Monitor bildet aus dem
beobachteten Stand einen Fingerprint und weckt den Koordinator nur bei einer Änderung;
der Input nennt die Änderung, der Koordinator berichtet ohne Statusabfrage. Ein Turnende der
beobachteten Quelle bleibt immer ein Ping. (2) Modellfunktionen liefern kompakte Ergebnisse:
Statusfunktionen ohne lange Listen und Vorgaben; Listen nur auf ausdrückliche Anforderung als
Kurzliste; die Mini-App liest den vollen Snapshot über eine eigene Operation. (3) Verträge:
leeres oder rein optionales Eingabeschema erlaubt den Aufruf ohne Argument; `undefined` unter
einem Objektschlüssel gilt ein- und ausgangsseitig als abwesend, `exactOptionalPropertyTypes`
ist im Snippet- und Programmcompiler aus; die Bindung zwischen Feldern steht in den
Feldbeschreibungen und damit in den Deklarationen. (4) `typescript_api` mit `names` liefert
TypeScript-Deklarationen mit Feldkommentaren aus den Schema-`description`s, gemeinsame Schemata
einmal als Alias und JSON-Schemata nur mit `schemas: true`. (5) macOS-Prozessliste: Zeilen mit
PGID und leerem Zustand gelten als vorhandene Gruppe. (6) Neue Regel mit Test: Feldsemantik
gehört ins Schema, Funktionsbeschreibungen nennen keine Feldnamen;
`apps/server/tests/run-function-description-drift.test.ts` prüft alle registrierten Verträge.
Zwei Entwurfsregeln stehen in der Spec; eine Engine-Verallgemeinerung der änderungsgetriebenen
Weckung folgt erst mit einem zweiten Beobachter. Kapitel: `docs/spec/plugins.md`
(Funktionen bereitstellen), `docs/spec/typescript-platform.md` (Kurzbeschreibung und Details,
Code ausführen), `docs/spec/core.md` (Actor-Zustand).

## Snippet-Compiler als warmer Worker-Pool (16.09.2026)

Jede Kompilierung startete bisher einen neuen Worker-Thread, der TypeScript lud, alle
lib- und Deklarationsdateien parste und danach endete; in einem Lauf kostete das je
Snippet rund eine halbe Sekunde reine Vorbereitung und bei parallelen Reviewern Wartezeit bis
zur Zeitgrenze. Festgelegt: bis zu acht langlebige Worker mit Anfragekennungen, je Worker ein
LRU-Cache geparster Bibliotheken und Deklarationen (256 Einträge) und `oldProgram` für die
strukturelle Wiederverwendung; Snippet-Quellen bleiben immer frisch. Gemessen: 471 ms kalt,
10 ms warm bei gleichen Deklarationen. Ein Worker, der die Zeitgrenze überschreitet oder stirbt,
wird beendet und beim nächsten Bedarf ersetzt; ein Compilerfehler in der Anfrage lässt ihn am
Leben. Diagnosen, `compilationHash` und Emit sind unverändert; die bestehenden Compiler-Tests
laufen unverändert, zwei neue prüfen Wiederverwendung mit Zeitverhältnis und den Ersatz eines
gestorbenen Workers. Kapitel: `docs/spec/typescript-platform.md` (Code ausführen).

## Browser-Viewport 1920 x 1080 mit Umschaltung per Funktion (16.09.2026)

Die Screenshots eines Laufs waren abgeschnitten: der Browser des Runs lief mit 1440 x 1000, die
geprüfte Anwendung braucht 1920 Breite (Ribbon-Überlauf, Legende und Tabelle beschnitten).
Festgelegt: `ragents.browser` startet mit 1920 x 1080 (16:9, Skalierung 1, also Full-HD-PNGs
ohne Vergrößerung, passend zur Screenshot-Konvention in Ronalds Testablage). Ronalds Ergänzung:
das Modell muss die Größe selbst ändern können, etwa für schmale Layouts; dafür gibt es
`browser_viewport`, der Wert bleibt je Run bis zur nächsten Änderung erhalten.
Betroffen: `docs/spec/plugins.md` (Browserprüfungen), Skill `browser-testing`. Die generierte
Bausteinreferenz ist mit `pnpm generate:homepage` nachzuziehen.

## Benutzername kommt nur aus der Anmeldung (16.09.2026)

Ein Koordinator begrüßte einen Tab mit dem Namen eines anderen Benutzers. Ursache: Der Run
gehörte laut Journal dem zweiten Benutzer, weil ein zweiter Tab im selben Browser als dieser
angemeldet war und damit das gemeinsame Cookie ersetzt hatte; der erste Tab zeigte weiter den
alten Namen, schickte aber die andere Sitzung mit. Festgelegt: Ein Tab lädt bei jedem
Fokus den angemeldeten Benutzer nach und übernimmt den Wechsel. Außerdem steht ein
Benutzername nur noch einmal im System, in der Benutzerliste der Profildatei; Prompts,
Skills und Testfixtures sprechen vom Administrator oder nutzen neutrale Beispielnamen. Kapitel:
`docs/spec/profiles.md`.

## Run-Löschung antwortet sofort, das Aufräumen ist ein Löschjob (16.09.2026)

Das Löschen von 17 Runs dauerte pro Run 20 bis 40 Sekunden (Arbeitsverzeichnis entfernen,
Language-Server und Prozesse stoppen) und der Client löschte nacheinander; der
Bestätigungsdialog wirkte minutenlang eingefroren. Festgelegt: `DELETE /chat/:id` antwortet mit
`202`, sobald die Löschabsicht dauerhaft vermerkt ist. Ab da ist der Run unsichtbar und die
Sessions-Liste wird angestoßen; Stoppen, Entfernen und Archivieren laufen als Löschjob im
Hintergrund, Fehler ins Serverlog, die Vollendung beim nächsten Start bleibt wie bisher. Der
Client schickt Mehrfachlöschungen parallel. Der Bestätigungsdialog erhält als
verschachtelter Seitendialog einen eigenen Backdrop, weil Base UI verschachtelten Dialogen
keinen rendert. Betroffen: `docs/spec/core.md`, `docs/operations.md`.

## AGENTS.md in die README verschmolzen (16.09.2026)

Ronalds Einwand: Die README ist der bessere Einstieg, die meisten lesen ohnehin sie; ein
zweiter Einstieg daneben verzettelt. Dazu kam die Beobachtung, dass Claude Code nur `CLAUDE.md`
automatisch lädt, Codex nur `AGENTS.md`, und das Repo bislang keine `CLAUDE.md` hatte: eine
Claude-Session begann ohne Spec und ohne Entscheidungen. Festgelegt: Pflichtlektüre,
Dokumentationsregel, Arbeitsweise und Regeln stehen jetzt im README-Abschnitt "Für
KI-Assistenten"; die Ordnerbeschreibungen und Prüfbefehle sind in die vorhandenen Abschnitte
eingeflossen. `AGENTS.md` bleibt als Zweizeiler für Codex, `CLAUDE.md` importiert die README
mit `@README.md` für Claude Code; beide sind reine Zeiger ohne eigenen Inhalt, damit nichts
doppelt altert. Kapitel: keines; geändert sind README, AGENTS.md, CLAUDE.md und die Verweise
in `selftest/GUIDE.md`, `TODO.md` und den Pflegekommentaren der Homepage.

## Sternansicht in Mini-Apps über das gemeinsame FlowDiagram (16.09.2026)

Eine Mini-App zeichnete ihren Stern selbst als SVG mit fest eingetragenem Hintergrund;
die Entfernung des Punktrasters im gemeinsamen `FlowDiagram` erreichte sie deshalb nicht.
Festgelegt: Diagramme in Mini-Apps laufen über `FlowDiagram`, das dafür `layout="star"`
(erster Knoten in der Mitte), `viewport="fit"` (Breite und Höhe eingepasst, kein Scrollen),
`actions` mit `onAction` an Karten und `status` an Kanten erhält. Das Diagramm hat keinen
eigenen Hintergrund. Betroffen: `docs/spec/plugins.md`, `docs/operations.md`,
`docs/homepage/guide-programs.md`.

## Vertragsdrift aktiviert Pakete neu, statt den Lauf zu sperren (16.09.2026)

Ein Lauf einer Mini-App vom Vorabend meldete nach einem Serverneubau bei jedem
Aufruf "Capability-Vertrag von status hat sich geändert; Paket erneut aktivieren". Ursache:
`snapshotSchema` hatte über Nacht `formatting` bekommen und `audience` verloren, das Paket im
Run war aber mit den Schemata vom Vorabend gebunden, und nichts aktivierte es neu. Ronalds
Frage war, ob man Verträge strukturell vergleichen und nur echte Brüche ablehnen könne.
Festgelegt:

- Kein Schemavergleich. Ein Subtyp-Prüfer für TypeBox (Eingabe kontravariant, Ergebnis
  kovariant, Sonderrolle von `additionalProperties: false`) wäre ein eigenes Projekt und
  würde nur raten, was der Code verträgt. Der Hash bleibt die Erkennung, die Typprüfung des
  neu gebauten Pakets ist der Verträglichkeitstest: grün heißt weiterlaufen, rot heißt echter
  Bruch mit Compilerfehler als Ursache. Kapitel: `docs/spec/typescript-platform.md`.
- Die Neuaktivierung läuft in der Aufrufreihe des Actors, vor der Ausführung des wartenden
  Aufrufs; laufende Aufrufe desselben Actors gibt es dort nicht, deshalb entfällt nur dafür
  die Leerlaufprüfung. Eingabe und Capability-Bindung werden nach der Neuaktivierung gegen
  die neue Definition aufgelöst, damit auch geänderte Capability-Listen greifen. Ein Handler
  oder Aufruf bleibt an die Revision gebunden, mit der er aufgelöst wurde; nur die von ihm
  selbst ausgelöste Neuaktivierung darf sie wechseln, ein anderweitig ersetztes Paket lehnt
  ihn weiterhin ab.
- Pakete aus Run-Scripts bekommen bei Drift die aktuellen Plugin-Quellen, nicht die beim
  Start kopierten Dateien: Plugin und Server ändern sich gemeinsam, der Lauf zieht nach. Dafür
  merkt sich der Run die Einstiegkennung als Plugin-Zustand `ragents.actor-programs.script`;
  ein Namensabgleich über alle Scripts wäre implizit und könnte eigene Pakete überschreiben.
  Eigene Pakete werden aus ihren Arbeitsdateien gebaut, wie `actor_program_activate` es täte.
- Als Regel für Capability-Autoren steht in `docs/spec/overview.md`, was ein verträglicher
  Vertragswechsel ist: Eingaben dürfen mehr annehmen, Ergebnisse nicht weniger zusichern;
  Maßstab ist die Wertemenge, nicht die Feldanzahl. Von den drei Änderungen an
  `snapshotSchema` war nur das neue optionale `formatting` verträglich, und selbst das nicht
  für ein Paket, das den Snapshot durch ein geschlossenes eigenes Schema durchreicht.

## Arbeitsanzeige im Run-Chat folgt dem ganzen Run, Chip überlebt eigene Eingaben (15.09.2026)

Der Run-Chat zeigte die Arbeitsszenen nur während eines Turns des primären Actors. Sobald der
Koordinator delegierte und auf Sub-Agenten wartete, wirkte der Run untätig, und beim nächsten
Koordinator-Turn sprang die Anzeige wieder an. Der Run-Chat verwendet jetzt dieselbe Lesart
wie die Run-Liste: Er arbeitet, solange irgendein Agent oder Programm einen Turn ausführt
(Live-Status des primären Actors oder `lifecycle.running` in der Run-View), und nur bei
bestehender Verbindung. Stoppknopf und Platzhalter folgen demselben Signal. Karten und
Inspector behalten ihren Actor-bezogenen Laufzustand. Der aktuelle Schrittchip verschwand
zudem, sobald der Bediener während der Arbeit eine Nachricht nachschob; nachgeschobene
eigene Eingaben beenden den Chip nicht mehr, jede andere Nachricht weiterhin.
Kapitel: `docs/spec/plugins.md`; Bedienung angepasst.

## UI-Bibliothek auf shadcn/ui, Base UI und Tailwind (15.09.2026)

Kapitel: plugins, run-modules. Die eigene Control-Bibliothek vom 07.09. (Button, IconButton,
Chip, Segmented, Tabs, SelectMenu, Modal, Dialog mit `ui-*`-Klassen und Floating UI) ist durch
shadcn/ui auf Base UI ersetzt. Ausschlaggebend: Die Mini-Apps schreiben überwiegend Modelle,
und die kennen die shadcn-API (`variant="outline"`, `Select/SelectTrigger/SelectContent`,
`Tabs/TabsList/TabsTrigger`, `Dialog/DialogContent`) und Tailwind ohne Anleitung; React Aria
war als Alternative geprüft und wegen der geringeren Bekanntheit verworfen. Festgelegt:

- Die Komponenten liegen per shadcn-CLI (`components.json`, Stil `base-nova`) als eigene
  Quellen in `apps/web/src/ui/` und werden ohne eigene Prop-Namen durchgereicht; Host,
  Plugins und Mini-Apps (`@ragents/client/ui`) verwenden dieselbe API, Icons aus `lucide-react`.
- Look ist der shadcn-Standard, die Farben kommen über `theme.css` aus den `qsl`-Tokens; das
  Schichtwerk für Controls und die Mini-App-Fläche `mini-app.css` entfallen, Materialien
  gelten weiter für Canvas und Karten.
- Tailwind nur für Controls und Mini-Apps: im Host ohne Preflight (`tailwind.css`), im
  Mini-App-Frame vollständig (`frame.css`), kompiliert je Ansicht im Mini-App-Compiler und in
  den Homepage-Builds mit `@tailwindcss/node`. Die übrige Host-Oberfläche behält ihr CSS.
- Eigene Bausteine bleiben `ListDetail`, `SvgEdge`, das Seiten-`Modal` des Hosts sowie die
  Mini-App-Extras `Form`, `DataTable`, `FilePicker`, `AppLayout`, `Stack`, `Grid`,
  `TaskProgress`, `DocumentViewer` und `DiffViewer`, jetzt aus shadcn-Teilen und Tailwind.
- Der Nachschlagekatalog und die Homepage dokumentieren die eigenen Bausteine; für die
  shadcn-Komponenten gilt die Dokumentation von shadcn und Base UI.

## Reiter und gefaltete Karten in Mini-Apps (15.09.2026)

Eine Mini-App zeigt nach der Auswahl den Gegenstand im Kopf und vier Reiter über einen neuen
gemeinsamen `Tabs`-Baustein; Agentenprosa steht in gefalteten Karten, die Aktionsleiste enthält
nur Aktionen. Kapitel: `docs/spec/run-modules.md`.

## Run-Übersicht nach Aktivität mit persönlichem Lesestand (15.09.2026)

Das bestehende Kartenraster bekommt Tagesgruppen nach letzter Journal-Aktivität und dezente
Statusfarben. Ein eigener Hinweis unterscheidet neue Aktivität von laufender Arbeit.
Der lokale Lesestand verwendet geladene Journalrevisionen je Benutzer und Run; verdeckte
Ansichten und Listenabfragen bestätigen nichts. Die Laufanzeige prüft alle Actors im
Scheduler, damit ein aktiver Worker bei ruhendem Primärchat sichtbar bleibt.
Betroffen: `docs/spec/plugins.md`.

## Mini-App-Inhalte und Diagramme in natürlicher Größe (15.09.2026)

Die Verkleinerung des gesamten Mini-App-Frames auf 90 Prozent entfällt; sein Viewport nutzt
die tatsächlichen Maße. Diagramme starten und zentrieren bei 100 statt 80 Prozent. Damit
verkleinern zwei verschachtelte Vorgaben nicht länger Schrift, Controls und Karten.
Die automatische Breitenanpassung bleibt bei Platzmangel erhalten.
Betroffen: `docs/spec/run-modules.md`.

## Mehr Abstand zwischen Diagrammkarten (15.09.2026)

Die Standardabstände der automatischen Anordnung steigen um etwa 30 Prozent: von 40 auf 52
innerhalb einer Ebene und von 72 auf 94 zwischen Ebenen. So bleibt zwischen den Kästen mehr
Freiraum. Betroffen: `docs/spec/run-modules.md`.

## Diagrammkarten an der äußeren Rundung begrenzen (15.09.2026)

Bei Karten ohne Unterpunkte reichte die rechteckige Kopffläche über die unteren runden Ecken.
Die Karte beschneidet jetzt ihre Inhaltsflächen an ihrer Außenkontur. Abmessungen, Schatten
und Verbindungen bleiben unverändert. Betroffen: `docs/spec/run-modules.md`.

## Pop-out-Scrollen von der Canvas-Leiste abgrenzen (15.09.2026)

Die fest positionierten Actor-Pop-outs bleiben DOM-Kinder der Canvas-Leiste. Deren nativer
Mausradhandler fing deshalb auch Ereignisse aus dem Chat ab und verhinderte dessen normales
Scrollen. Pop-outs markieren jetzt ihre eigene Scrollgrenze; der Handler der Leiste
überspringt Ereignisse aus solchen Bereichen auch an deren Inhaltsrändern.
Betroffen: `docs/spec/plugins.md`.

## Chat-Mitlaufen, Stopaktion und deutlichere Diagrammzustände (15.09.2026)

Der Folgezustand unterschied manuelles Zurücklesen nicht zuverlässig von einer durch den
Browser begrenzten Scrollposition. Er berücksichtigt jetzt die tatsächliche Scrollabsicht
und bleibt bei Layoutänderungen und ausgeblendeten Ansichten erhalten. Browserprüfungen
decken Größenwechsel, Streaming, Darstellungswechsel und manuelles Scrollen ab.
Der leere Composer verdrahtet seine Stopaktion mit dem jeweiligen Actor und dessen Kindern;
fehlende Stopcallbacks hatten zuvor einen deaktivierten Sendeknopf hinterlassen.
Betroffen: `docs/spec/plugins.md`.
Diagramme behalten Statuschips und kennzeichnen ihre Zustände stärker durch Farbe, ohne
zusätzliche Höhe. Animation verlangt ein ausdrückliches laufendes Signal statt eines
impliziten Standardwerts. Betroffen: `docs/spec/run-modules.md`.

## Direkte Arbeitswerkzeuge und lokal begrenzter UI-Zustand (15.09.2026)

Die vier Datei-/Shellwerkzeuge read, write, edit und bash werden zusätzlich nativ angeboten.
Einzelne Aufrufe benötigen damit keine typgeprüfte TypeScript-Hülle; Implementierung,
Arbeitswurzeln und Actorfreigaben bleiben identisch. Orientierung und Rollenprompts
unterscheiden direkte Werkzeuge von Workflowfunktionen. Betroffen: `docs/spec/core.md`,
`docs/spec/typescript-platform.md`.
Der Dateibrowser hält keine modulglobalen Komponentenwerte mehr. Panelbreite und
Aufklappzustand gehören zum jeweiligen Run. Damit übertragen Bedienaktionen keine
unbeabsichtigten Vorgaben an andere Instanzen. Betroffen: `docs/spec/plugins.md`.

## Werkzeugdarstellung je Chat (15.09.2026)

Die Darstellung der Toolcalls war nur nach Koordinator und Agenten getrennt. Die Auswahl
gehört jetzt zu Run und Actor, sodass andere Chats unverändert bleiben. Hauptansicht,
Canvas und Inspector desselben Chats verwenden dieselbe Präferenz.
Betroffen: `docs/spec/plugins.md`.

## Chatkachel auf die Auswahl reduzieren (15.09.2026)

Die erste Chatkachel zeigt nur noch ihren mittig zentrierten Auswahltext. Die Kopfzeile und
die zusätzliche Erklärung entfallen. Die Kachel bleibt auch bei laufenden Ladevorgängen
bedienbar, da ihre Auswahl rein lokal ist. Betroffen: `docs/spec/plugins.md`.

## Diagramme standardmäßig auf 80 Prozent (15.09.2026)

Der gemeinsame Diagrammrenderer verwendet 80 Prozent als Ausgangs- und Zentrierskalierung.
Breitenangepasste Diagramme bleiben höchstens so groß und verkleinern sich bei Platzmangel
weiter. Die React-Flow-Skalierung erfasst Schrift, Karten, Verbindungen und Abstände gemeinsam;
die Inhaltshöhe folgt derselben Skalierung. Damit passen FlowDiagram und WorkflowDiagram
zu den übrigen Mini-App-Inhalten. Betroffenes Kapitel: `docs/spec/run-modules.md`.

## Gemeinsamer Scrollraum unter dem letzten Chatbeitrag (15.09.2026)

Chatverläufe erhalten zwei Textzeilen unteren Inhaltsabstand, mindestens die Höhe der
Ausblendzone. Die gemessene Eingabehöhe kommt bei sichtbarem Composer hinzu. Die bisherigen
unterschiedlichen Abstände für reine Verläufe und Chats mit Eingabe entfallen; Materialkarten
ändern nur noch den seitlichen Abstand. Damit bleibt der letzte Beitrag auch ohne Eingabe
vollständig lesbar, und das vorhandene Mitscrollen berücksichtigt den Freiraum automatisch.
Die Composer-Messung bleibt außerdem beim Neurendern bestehen: Das bisherige kurzzeitige
Entfernen ihrer Höhe konnte die Scrollposition begrenzen und den Folgemodus ausschalten.
Betroffenes Kapitel: `docs/spec/plugins.md`.

## Laufende Chatantworten bei neuen Eingaben zusammenhalten (15.09.2026)

Neue Eingaben schlossen bisher den laufenden Antwortblock; weitere Streaming-Stücke erschienen
unter der Benutzernachricht als abgetrennte Fortsetzung. Die gemeinsame Nachrichtenprojektion
ergänzt nun den offenen Block an seiner ursprünglichen Position und prüft seine Gesprächs- und
Turnzuordnung. Actor-Verläufe erzeugen beim Einreihen eines Inputs keinen künstlichen
Turn-Abschluss mehr. So bleiben Ausgabe und Eingabe auch beim Journal-Replay getrennt lesbar.
Betroffenes Kapitel: `docs/spec/core.md`.

## Ablauf als kompakte Übersicht ohne Vergrößerung (15.09.2026)

Die Breitenanpassung vergrößerte schmale Ablaufgraphen über ihre normale Kartengröße hinaus
und wirkte dadurch dem Browserzoom entgegen. Sie verkleinert jetzt nur bei Platzmangel und
zentriert übrigen Platz. Die Standarddarstellung begrenzt Phasentitel auf zwei Zeilen und
Arbeitspunkte auf eine Zeile mit Statuspunkt. Vollständige Texte bleiben beim Darüberfahren
verfügbar; lange Berichte beeinflussen die Kartenhöhe nicht mehr. `detailLevel="full"` erhält
die ausführliche Darstellung als ausdrückliche Option. Bereits installierte Mini-Apps enthalten
ein eigenes kompiliertes Clientpaket und benötigen einen erneuten Build, um die Änderung zu
übernehmen. Betroffen:
`docs/spec/run-modules.md`, `docs/spec/plugins.md` und die öffentliche Bausteinreferenz.

## Statusleiste mit Randabstand und klareren Trennern (15.09.2026)

Die Statusleiste lässt links 12 Pixel Platz für abgerundete Fensterecken. Kurze, kontrastreichere
Trenner machen die Bediengruppen deutlicher erkennbar. Betroffen: `docs/spec/plugins.md`
und der Oberflächenabschnitt der Homepage.

## Ablaufdefinition als Quelle für Anleitung und Grafik (15.09.2026)

Phasen, Übergänge und Freiheiten eines vorbereiteten Ablaufs standen bisher getrennt im Prompt
und im Diagramm. `@ragents/workflow` verbindet sie in einem neutralen TypeScript-Vertrag.
Längere Anweisungen bleiben referenzierte Dateien; der Host setzt sie rollenbezogen zusammen.
Der Zustand enthält aktuelle Arbeitspunkte und dynamische Gruppen. Bestehende Steueractors
führen weiterhin aus und prüfen die verbindlichen Dienst- und Benutzerfreigaben.
Ein Fachablauf und der neutrale Lernnachmittag verwenden denselben Vertrag; `WorkflowDiagram` bindet
ihn an die vorhandene Darstellung. Damit ist die Wiederverwendung an zwei echten Abläufen
geprüft, ohne eine zweite Ablaufmaschine einzuführen. Der Erweiterungs- und Autorenleitfaden
beschreiben die Verwendung einschließlich Promptauflösung und Erweiterungsgrenzen.
Betroffene Kapitel: `docs/spec/run-modules.md`, `docs/spec/typescript-platform.md`, `docs/spec/plugins.md`.

## Redundanzprüfung ausdrücklich am offenen Changeset (15.09.2026)

Reviewer-Prompt und Startauftrag benennen den tatsächlichen Prüfumfang gegenüber HEAD:
gestagte, ungestagte, neue und gelöschte Dateien im Run. Die vorhandene Wiederverwendungsregel
erfasst auch doppelte Prüfungen, ableitbare Zustände und unnötige Zwischenschichten; belegte
Vertrags- und Vertrauensgrenzen sind Ausnahmen. So bleibt das Review auf neu entstandene oder
verschärfte Probleme begrenzt und erzeugt keinen zweiten überlappenden Regelauftrag.
Kapitel: `docs/spec/plugins.md`.

## React Flow und ELK ersetzen Mermaid (15.09.2026)

Der gemeinsame Diagrammbaustein erhält strukturierte Knoten und Kanten statt Mermaid-Text.
React Flow stellt Karten, Status und die bedienbare Ansicht dar, ELK berechnet Anordnung und
Verbindungen. Damit verwenden Mini-Apps dieselbe visuelle Sprache wie die übrige Oberfläche;
LLMs benötigen weder Diagrammsyntax noch Koordinaten. Mermaid samt Export, Anleitung,
Vorlage und Abhängigkeit entfällt. Kapitel: `docs/spec/run-modules.md`, `docs/spec/plugins.md`;
öffentliche Referenz und Homepage angepasst.

## Kopieren ohne zusätzliche Nachrichtenzeile anbieten (15.09.2026)

Das Kopiersymbol liegt oben rechts über Benutzernachrichten und wird bei Hover oder
Tastaturfokus sichtbar. Es reserviert keine zusätzliche Höhe im Chatverlauf. Auf Geräten
ohne Hover bleibt es sichtbar. Kapitel: `docs/spec/plugins.md`; Homepage angepasst.

## Gesamten Run über Titelleiste und Koordinator stoppen (14.09.2026)

Der vollständige Stopp ist direkt in der Run-Titelleiste erreichbar, auch ohne
Agenteninspektor. Der Primary-Actor erhält dafür `run_stop`; ein vorbereiteter Koordinator
verwendet es bei einem Abbruchwunsch statt einer wirkungslosen Nachricht an beschäftigte
Worker. Beide nutzen die bestehende Sitzungs-Stoppgrenze einschließlich Plugin-Bereinigung.
Das Werkzeug wartet nicht auf sein eigenes Turnende, um einen gegenseitigen Wartezustand
zu vermeiden. Unterhaltung und Dateien bleiben erhalten. Kapitel: `docs/spec/core.md`,
`docs/spec/plugins.md`; Homepage angepasst.

## Laufzeitdaten außerhalb von Quellprojekten isolieren (14.09.2026)

Ein Arbeitsverzeichnis unter `RAgents/.data` erbte beim regulären Build den äußeren
pnpm-Workspace trotz korrektem Arbeitsverzeichnis. Die gemeinsame Vorgabe liegt deshalb
unter `~/.local/share/ragents/<profil>`; der Start weist Datenpfade in Git-/Paketprojekten
auch nach Symlinkauflösung ab. Es gibt keine automatische
Datenmigration und keine Journalumschreibung. Kapitel: `docs/spec/profiles.md`,
`docs/spec/plugins.md`; Betrieb und Einstieg angepasst.

## Mermaid als Mini-App-Baustein (14.09.2026)

Mini-Apps können Diagramme mit dem gemeinsamen `MermaidDiagram` aus lokalen Quellen rendern.
Damit müssen sie Graphanordnung, Theme und Fehleranzeige nicht einzeln implementieren.
Die öffentliche Referenz und die Controls-Vorlage machen den Baustein direkt ausprobierbar.
Kapitel: `docs/spec/run-modules.md`, `docs/spec/plugins.md`; Bedienung und Homepage angepasst.

## Bash-Abschluss auf macOS bei beendeten Prozessgruppen erhalten (14.09.2026)

Bei der Untersuchung eines vermeintlich festhängenden Runs war `kill EPERM` nach
beendeten Bash-Aufrufen sichtbar. Ein isolierter macOS-Versuch reproduziert diesen
Signalfehler für Prozessgruppen, die nur noch aus Zombie-Einträgen bestehen; die damalige
Gruppenzusammensetzung des Runs ist nicht rückwirkend belegt. Die Existenzprüfung liest bei
macOS-`EPERM` ausschließlich PGID und Status. Nur nachweislich beendete Gruppen werden als
aufgeräumt behandelt, auch wenn sie zwischen Prüfung und Signal enden. Echte Fehler bleiben
Fehler, während der eigentliche Befehlsabschluss nicht mehr durch diesen Sonderfall verloren
geht. Kapitel: `docs/spec/plugins.md`; Bedienung angepasst.

## Aufgeklappte Actor-Chats um 40 Prozent verbreitern (14.09.2026)

Die Chat-Pop-outs der LLM-Actors verwenden auf Ronalds Wunsch 784 statt 560 CSS-Pixel
Breite. Die gemeinsame Positionierung begrenzt sie weiterhin auf den verfügbaren Fensterplatz.
Kapitel: `docs/spec/plugins.md`; Bedienung und Homepage angepasst.

## Hintergrundaufträge aus dem Gespräch heraushalten (14.09.2026)

Der Fortschrittsmonitor erschien mit seinen internen Anweisungen als Benutzer im Chat.
Native ActorInputs können ihre Darstellung jetzt als Hintergrund markieren. Zustellung,
Ausführung und Journal bleiben vollständig; Hauptchat und Actor-Gespräch blenden nur den
Auftrag aus. Die verständlichen Antworten bleiben erhalten. Ein vorbereiteter Ablauf verwendet
diese Kennzeichnung für periodische und abschließende Statusprüfungen.
Kapitel: `docs/spec/core.md`, `docs/spec/plugins.md`; Bedienung und Homepage angepasst.

## Neue Programmanordnungen automatisch übernehmen (14.09.2026)

Eine persönliche Kachelgröße konnte spätere Programmanordnungen dauerhaft verdecken und
damit neue Teilnehmer unsichtbar machen. Persönliche Anordnungen speichern nun ihre
Programmbasis. Sobald das Programm Modus oder Kachelbaum ändert, wird die neue Vorgabe
direkt übernommen; unveränderte Programmanordnungen erhalten die persönlichen Größen.
Kapitel: `docs/spec/plugins.md`; Bedienung und Homepage angepasst.

## Loginname beim Anlegen eines Runs übernehmen (14.09.2026)

Die Produktvorgabe trug jeden menschlichen Teilnehmer unter einem festen Namen ein, auch beim
Start durch einen anderen Benutzer. Chat- und Setup-Start übernehmen jetzt den
vertrauenswürdigen Anzeigenamen aus der Anmeldung; ohne Benutzer gilt eine neutrale Vorgabe.
Vorhandene Journale bleiben unverändert.
Kapitel: `docs/spec/profiles.md`.

## Sucheingabe unmittelbar beim Absenden leeren (14.09.2026)

Das Leeren nach erfolgreicher Antwort ließ den Text während der Suche stehen. Enter und
Suchknopf leeren ihn jetzt unmittelbar; ein fehlgeschlagener Aufruf stellt die Eingabe zur
Korrektur wieder her. Der zusätzliche Erfolgszähler entfällt. Der Browsertest hält beide
Anfragen vor ihrer Antwort an und prüft bereits dann das leere Feld.
Kapitel: `docs/spec/plugins.md`; Bedienung angepasst.

## Verlaufssymbol und Programmquellen in jeder Actor-Detailansicht (14.09.2026)

Das X in der Ansichtsleiste wählte den Verlauf und wirkte wie ein Schließen-Knopf. Eine
Sprechblase benennt diese Funktion nun bildlich. Der Quelltext-Reiter berücksichtigt außerdem
das aktivierte Actor-Programm statt nur das ältere direkte `actor.source`-Feld. Headless-Actors
erhalten damit denselben Zugang zu ihrem TypeScript-Code. Programm-Plugin, Quellcode-Endpunkt,
Dateiauswahl und Syntaxhervorhebung bleiben die gemeinsamen Bausteine; es entsteht kein
zweiter Dateizugriff. Quellen laden erst beim Öffnen und erneut nach einer Programmaktivierung.
Kapitel: `docs/spec/plugins.md`, `docs/spec/run-modules.md`; Bedienung und Homepage angepasst.

## Erstellungszeitpunkt auf Run-Karten anzeigen (14.09.2026)

Gleich benannte Runs waren nur an ihrer letzten Aktivität zu unterscheiden. Die Run-Karten
zeigen zusätzlich "Erstellt" mit Datum und Uhrzeit aus dem ursprünglichen Journalzustand.
Die bestehende Aktualisierungsanzeige und Sortierung bleiben erhalten. Run-Liste und
Verwaltungs-API liefern den Zeitpunkt mit; noch nicht angelegte Runs haben keinen.
Kapitel: `docs/spec/plugins.md`; Bedienung und Homepage angepasst.

## Fokusrahmen am Rand von Mini-App-Inhalten erhalten (14.09.2026)

Der begrenzte Inhalt von `AppLayout` schnitt den äußeren Fokusrahmen einer Suchzeile links ab.
Vier Pixel Innenabstand mit ausgleichendem Außenabstand halten den Rahmen innerhalb der
Scrollfläche und erhalten die bisherige Ausrichtung. Die gemeinsame Layoutregel gilt auch
für bereits installierte Views beim erneuten Laden. Kapitel: `docs/spec/run-modules.md`;
Homepage angepasst.

## Erweiterungsleitfaden aus konkreten Integrationsbefunden (14.09.2026)

Die Arbeit an Datenzugriff, Koordinator und Worker, Sprachservern und Mini-Apps zeigte dieselben
Grenzen an mehreren Stellen: Fachfunktion und Ansicht, Prompt und tatsächlicher Aufbau,
Aktivität und Ergebnis sowie Render-Test und bedienbarer Host-Frame. Der öffentliche Guide
erklärt daraus acht Strategien und eine Entscheidungshilfe für Funktionen, Scripts, Actors
und Views. Konkrete Belegpfade und ihre Reichweite bleiben im internen Spec-Kapitel; feste
Modelle, Fachfilter und Produktpfade werden nicht zu allgemeinen Regeln. Es entsteht kein
neuer Abstraktionsmechanismus und keine zweite Dokumentationsablage.
Kapitel: `docs/spec/plugins.md`, `docs/spec/run-modules.md`; Homepage und Guide-Verweise angepasst.

## Kurzer Suchinterpreter und sichtbare Sprachserver-Vorbereitung (14.09.2026)

Die Itemauswahl eines Fachplugins nimmt Freitext an. Ein einzelner Modellaufruf im Plugin
übersetzt ihn in validierte Filter; Abfrage und Listenübernahme verwenden die vorhandenen
Dienste. Das braucht keinen weiteren Actor oder Koordinatorturn. Modell und Denktiefe sind
separat konfiguriert, Zeit und Ausgabe begrenzt. Klärungsfehler erhalten die vorherige Liste.
Enter und Suchknopf werden in der Mini-App ausdrücklich behandelt, weil der Host-Iframe
keine native Formularübermittlung erlaubt.

Eine Promptanweisung allein öffnete beim Run-Start keine Sprachserver. Das vorbereitete
TypeScript-Programm startet sie jetzt parallel zur Auswahl mit den Wurzeln des Produkt-Runs.
Der neutrale Host und die Diagnoseansicht unterscheiden Laden, bestätigte Bereitschaft und
Fehler. Statusabfragen warten nicht auf den Start; Stoppen und Wurzelwechsel verwerfen späte
Ergebnisse und räumen Prozesse auf. Die Tests verwenden isolierte Prozesse und keine
Produktdaten.
Ein Payload-Test des bestehenden Modelladapters belegt zudem, dass `off` je nach Katalogmapping
ausdrücklich `enabled: false` oder `effort: "none"` sendet; der Interpreter verwendet diesen
vorhandenen Weg. Das gewählte Flash-Modell bietet im Katalog ausschließlich eingeschaltete Stufen.
Kapitel: `docs/spec/plugins.md`, `docs/spec/profiles.md`, `docs/spec/core.md`; Bedienung und Run-Beschreibung angepasst.

## Arbeitenden Actor sichtbar machen (14.09.2026)

Der laufende Worker war im festen Zweikachellayout unsichtbar. Sein eigenes Actor-Programm
zeigt nun in einer kleinen dritten Kachel echte Aktivität und den gemeldeten Arbeitsschritt.
Es verwendet vorhandene Actor-Views und eine lesende Plugin-Operation, keine zusätzliche KI.
Idle und Fehler bleiben vom geprüften Ergebnis getrennt; interne Traces werden nicht geliefert.
Die Host-Bridge behält 512 kürzlich verwendete Anfrage-IDs statt nach 512 Aufrufen dauerhaft
abzubrechen. So funktioniert die regelmäßige Statusanzeige auch bei längeren Läufen.
Kapitel: `docs/spec/plugins.md`, `docs/spec/profiles.md`, `docs/spec/run-modules.md`; Bedienung angepasst.

## Fachanleitungen beim zuständigen Plugin (14.09.2026)

Die neue Datensuche war wiederverwendbar, ihre Anleitung stand aber im vorbereiteten Ablauf.
Das bisherige Fachkapitel verlangte zugleich ausschließlich die eigene Ergebnisansicht
und setzte bei persönlichen Abfragen den Dienstzugang voraus. Das Plugin liefert jetzt einen
kurzen werkzeuggebundenen Initialhinweis und getrennte Detailkapitel für Datenabfrage und
Ansicht. `typescript_api` lädt das passende Kapitel anhand der tatsächlichen Funktionen, auch
für eigens erzeugte Koordinatoren. Der Run-Prompt und sein Skill beschreiben die Übergabe in
ihre Mini-App; allgemeine Suchregeln bleiben beim Fachplugin. Die Funktionsübersicht bleibt kurz.
Die vorhandene Promptkomposition und die Datenverträge benötigen dafür keine Erweiterung.
Kapitel: `docs/spec/plugins.md`; Bedienung und Agentenanweisungen angepasst.

## Feste lokale Adressen je Profil (14.09.2026)

Das automatische Ausweichen bei belegten Ports führte auf wechselnde Adressen und konnte
beim Öffnen einer vertrauten URL eine andere Anwendung zeigen. Die Profildateien legen den
Serverport jetzt unter `host.PORT` fest: core 4710, Konfigurationsvorlage 4712.
Nur ein ausdrücklich gesetztes `PORT` überschreibt diese Vorgabe. Startscript und Server
weisen belegte und ungültige Ports vor der Plugininitialisierung zurück; Port 0 und die
automatische Portsuche entfallen. Laufende Instanzen werden nicht beendet.

Im Dev-Modus bleiben die Backendports gleich. Vite verwendet fest 5710 für core mit
`strictPort` und dem passenden Backend als Proxyziel; der Port wird vor dem Start geprüft.
Der eigenständige Web-Dev-Start verwendet 5710 mit Backend 4710.
Kapitel: `docs/spec/profiles.md`; README, Bedienung und Selbsttest-Anleitung angepasst.

## Mauszeiger und Kopieren im Chat (14.09.2026)

Der Textcursor über dem Verlauf wirkte wie eine Eingabefläche. Der gemeinsame Chat zeigt
jetzt den normalen Mauszeiger; die explizite Textcursor-Regel der Canvas-Vorschau entfällt.
Benutzernachrichten erhalten ein kleines Kopiersymbol für ihren unveränderten Text,
mit Erfolgs- und Fehlerrückmeldung. Das gilt in allen Darstellungsformen des gemeinsamen
Renderers. Kapitel: `docs/spec/plugins.md`; Homepage angepasst.

## Gemeinsame Maximalgröße für Mini-Apps und Chat-Karten (14.09.2026)

Die frühere Vergrößerung der Actor-Grenzen ließ Mini-Apps bei 960 mal 720 Pixeln stehen.
Ihre Größenanfasser verwenden jetzt dieselben maximalen 2880 mal 2700 Pixel wie Chat-Karten.
Die gemeinsame Quelle verhindert ein erneutes Auseinanderlaufen der Obergrenzen.
Kapitel: `docs/spec/plugins.md`; Bedienung und Homepage angepasst.

## Aktuellen Schritt mit Quassel-Chips und Arbeitsszenen anzeigen (14.09.2026)

Die reine Statuszeile im Modus `current` unterdrückte die vertrauten Chips und die
Arbeitsanimation. Der Modus verwendet jetzt dieselbe Chip-Darstellung wie die übrigen Chats.
Eingeschränkte Zugänge behalten generische Beschriftungen ohne technische Details. Die
gemeinsamen Arbeitsszenen folgen dem tatsächlichen Laufzustand; eine Pause im Nachrichtenstrom
blendet sie nicht mehr nach 20 Sekunden aus. Kapitel: `docs/spec/plugins.md`,
`docs/spec/profiles.md`; Bedienung und Homepage angepasst.

## Aktuelle Arbeitsphase auch für eingeschränkte Zugänge anzeigen (14.09.2026)

Ein abgeschlossener Lauf wirkte während der Browserprüfung inaktiv: Ohne `runs.inspect`
entfernten Serverprojektion und Kartenchat bisher auch die Information über laufende Schritte.
Der Server liefert nun inhaltsleere Statusmarker; das Web zeigt nur die aktuelle Denk- oder
Werkzeugphase. Namen, Argumente, Ergebnisse und Denktexte bleiben verborgen. Ein Produktprofil
kann diesen Modus ohne Aufklappen oder Umschaltung vorgeben. Es werden keine technischen Rechte
ergänzt. Kapitel: `docs/spec/plugins.md`, `docs/spec/profiles.md`; Bedienung und Homepage angepasst.

## Fachdetails rechts und Browseraufnahmen im Canvas öffnen (14.09.2026)

Eine Fach-Mini-App verwendet kompakte Issue-Zeilen im Stil verbreiteter Issue-Tracker. Ein Klick öffnet die vorhandene Detaildarstellung im rechten Seitenpanel,
ohne den Auftrag bereits zu starten. Die Mini-App behält Auswahl und Fortschritt, der Chat
bleibt sichtbar. Die Wiederverwendung hält Beschreibung, Kommentare und Aktivität konsistent.
Browseraufnahmen öffnen als vollständiges Bild in einem Canvas-lokalen Dialog statt in einem
neuen Browsertab. Beide Wege verwenden Plugin-Operationen und die bestehenden Host-Schnittstellen
für Tabs und Dialoge. Kapitel: `docs/spec/plugins.md`; Bedienung angepasst.

## Kartenkopfzeilen dezent abdunkeln (14.09.2026)

Kartenkopf und Inhalt hatten dieselbe Fläche. Die gemeinsame Materialdarstellung mischt
für Kopfzeilen vier Prozent Schwarz in die jeweilige Kartenfarbe. Mini-Apps, LLM- und
Script-Karten verwenden dieselbe Regel in freiem Canvas und Kacheln. Die Kopfzeile bleibt
vollflächig; der reservierte Platz für Mini-App-Knöpfe liegt innerhalb ihrer Fläche.
Kapitel: `docs/spec/plugins.md`; Homepage angepasst.

## 90 Prozent Mini-App-Skalierung (14.09.2026)

Mini-App-Inhalte verwenden in freiem Canvas, Kacheln und Vollansicht denselben
Faktor 0,9; der innere Frame gleicht die Skalierung aus und füllt weiterhin den verfügbaren Platz.
Kapitel: `docs/spec/run-modules.md`; Bedienung und Homepage angepasst.

## Run-Vorbereitung auf dem leeren Canvas anzeigen (14.09.2026)

Zwischen angenommenem Start und sichtbaren Actors blieb die Fläche ohne Rückmeldung.
Die Chat-Session meldet deshalb den tatsächlichen Vorbereitungsstand auch bei erneutem
Verbinden. Der Canvas zeigt zentral einen Ladebalken; nach der Aktivierung bestimmen Inputs
und Turns, ob noch gearbeitet wird. Fehler, Rückfragen und Stopp ersetzen die Ladeanzeige.
Freie Fläche und Kacheln verwenden dieselbe Darstellung ohne Abhängigkeit vom Canvas-Zoom.
Kapitel: `docs/spec/typescript-platform.md`, `docs/spec/plugins.md`; Bedienung und Homepage ergänzt.

## Gemeinsame SVG-Verbindungen und Autorenbeispiel (14.09.2026)

Canvas und eine Fach-Mini-App zeichneten Pfeile jeweils selbst. `SvgEdge` vereinheitlicht diesen
gemeinsamen Teil einschließlich Zustandsfarben, Marker und Animation. Das Mini-App-SDK
exportiert denselben Baustein. Ein neutrales Beispiel und die Autorenanleitung geben Modellen
eine konkrete Gestaltungsvorlage; Layout und fachliche Knoten bleiben beim jeweiligen Fall.
Kapitel: `docs/spec/run-modules.md`; öffentliche Bausteinreferenz und Homepage ergänzt.

## Einheitliche Kartenköpfe für Mini-Apps und Actors (14.09.2026)

Mini-App-Köpfe hatten kleinere Titel und kein Symbol. Sie teilen jetzt Typografie,
Symbolrahmen und Abstände mit Actor-Köpfen. Das Raster-Symbol stammt aus demselben Baustein
wie in der Actor-Leiste. Kachelköpfe verwenden ebenfalls diese Darstellung; der
Verschiebegriff bleibt davon getrennt. Die eingeklappte App reserviert die neue Kopfhöhe.
Kapitel: `docs/spec/plugins.md`; Homepage angepasst.

## Canvas-Größenänderungen ohne Speichern je Mausbewegung (13.09.2026)

Kachel-Trenner speicherten bisher bei jedem Pointerevent den gesamten Baum und lösten damit
auch neue Renderdurchläufe für die Inhalte aus. Die Vorschau bleibt jetzt lokal und wird
höchstens einmal pro Bildschirmframe aktualisiert; nur das Loslassen speichert. Abbruch,
Escape, Fokusverlust und externe Layoutänderungen verwerfen die Vorschau. Im freien Canvas
werden Größenmessung und Style-Änderungen ebenfalls pro Frame gebündelt. Unveränderte
Chat-Inhalte und Materialkörper werden bei reinen Geometrieänderungen nicht neu gerendert.
Die Andockvorschau aktualisiert sich nur beim Wechsel des Ziels.

Auf Ronalds Wunsch haben Kacheln jetzt null Tiefenstufen. Die gemeinsame Kastenoptik bleibt,
der Platz für den Tiefenkörper entfällt. Flache Materialkörper benötigen keine Größenbeobachtung.
Kapitel: `docs/spec/plugins.md`; Bedienung und Homepage angepasst.

## Gemeinsamer Chat-Abstand und Rechte für Kachelanordnung (13.09.2026)

Die Materialregel setzte den unteren Composer-Abstand auf null und überschrieb den Abstand
für Kacheln. Drei spezielle Padding-Regeln entfallen; Actor-Chats verwenden den vorhandenen
ChatPanel-Standard in beiden Modi. Material und Kacheln erhalten ihre Styles über einen einzigen
Plugin-Einstieg. Ohne Actors-Zugriff konnten Benutzer Kacheln entfernen, ohne sie wiederzufinden.
Entfernen und Umordnen setzen deshalb dasselbe Recht wie die Actors-Ansicht voraus; X,
Verschiebegriff und Drag-and-drop entfallen ohne dieses Recht. Größenverhältnisse bleiben
über die Trenner anpassbar. Beim Ziehen einer bestehenden Kachel verdeckte deren neu
angelegter Andockschutz sofort den Quellkopf und brach den nativen Browser-Drag ab. Auch
ein äußeres Andockziel konnte direkt über dem Startpunkt liegen. Die Andockanzeige beginnt
jetzt erst nach dem nativen Dragstart, und nur Zielkacheln erhalten den Schutz. Die tatsächlichen
SVG-Griffe sind einschließlich erneutem Ziehen bereits umgeordneter Kacheln im Browser geprüft.
Kapitel: `docs/spec/plugins.md`; Bedienung und Homepage ergänzt.

## Gemeinsame Kartengröße und Material in beiden Modi (13.09.2026)

Chat-Actors starten auf Ronalds Wunsch mit doppelter Breite und Höhe, 720 mal 520 CSS-Pixel.
Mini-Apps verwenden dieselbe zentrale Vorgabe unabhängig von ihren Platzierungsangaben.
Kacheln übernehmen die Schichtwerk-Kastenoptik des freien Canvas mit genau einer Tiefenstufe;
der reservierte Materialüberstand hält Kontur und Körper sichtbar. Mini-App-Inhalte verwenden
in beiden Modi Faktor 0,8, damit ihre Controls beim Umschalten nicht größer werden.
Kapitel: `docs/spec/plugins.md`; Bedienung und Homepage angepasst.

## Vorbereiteter Ablauf mit zwei gleich breiten Kacheln starten (13.09.2026)

Ein vorbereiteter Ablauf verwendet den neuen Kachelvertrag im Run-Script: Mini-App links, Agent
rechts, gleiche Gewichte. So steht die gesamte verfügbare Canvas-Fläche für den Ablauf bereit.
LLM-Kacheln erhalten die vorhandenen Kartenbeiträge des Hosts, damit insbesondere Rückfragen
auch dort beantwortbar sind. Kapitel: `docs/spec/plugins.md`; Bedienung und Homepage angepasst.

## Dreifache Maximalgröße für Actor-Karten (13.09.2026)

LLM-Karten im freien Canvas lassen sich auf Ronalds Wunsch bis 2880 mal 2700 CSS-Pixel
vergrößern. Größenprüfung, Einstellungen und CSS verwenden die verdreifachten Obergrenzen.
Die Standard- und Mindestgröße bleiben erhalten; Kacheln folgen weiterhin ihrer Aufteilung.
Kapitel: `docs/spec/plugins.md`; Bedienung und Homepage angepasst.

## Feste Kacheln neben dem freien Canvas (13.09.2026)

Bildschirmfüllende Apps und Chats brauchen eine Aufteilung relativ zur verfügbaren Fläche.
Der freie Canvas bleibt die Vorgabe; ein eigener Kachelmodus teilt dieselben Inhalte rekursiv
in gewichtete Bereiche und schaltet die Kamera-Steuerung aus. Andockziele mit Vorschau und
verschiebbare Trenner erlauben dieselbe Struktur direkt in der Oberfläche. Stabile Blattpositionen
im DOM erhalten Inhalte beim Umordnen. Persönliche Anordnungen haben Vorrang vor späteren
Programmänderungen und lassen sich ausdrücklich auf die Run-Vorgabe zurücksetzen.
`canvas_layout_replace` trägt beide Modi; rekursive Schema-Typen erhalten die verschachtelten
Verträge auch in Snippets, Actor-Programmen und der öffentlichen SDK-Referenz. Koordinator und
Setup-Anleitung beschreiben die Modi, ohne die freie Vorgabe ungefragt zu ersetzen.
Kapitel: `docs/spec/plugins.md` und `docs/spec/typescript-platform.md`; Bedienung und Homepage ergänzt.

## Eine Tiefenstufe als Vorgabe (13.09.2026)

Die Schichtwerk-Karten verwenden auf Ronalds Wunsch standardmäßig eine Tiefenstufe. Die
Vorgabe gilt auch beim Zurücksetzen; ausdrücklich gespeicherte Browserwerte bleiben gültig.
Kapitel: `docs/spec/plugins.md`; Bedienung und Produkt-Homepage angepasst.

## Mini-App-Innenabstand zentral im Host (13.09.2026)

Äußere Abstände lagen bisher in den einzelnen App-Styles und konnten bei generierten Views
fehlen. Echte Mini-App-Frames erhalten jetzt einen gemeinsamen Innenabstand am scrollenden
Mountpunkt. Der Scrollbalken bleibt am rechten Frame-Rand, `AppLayout` verdoppelt den Abstand
nicht und sein `fill`-Layout bleibt möglich. Die mitgelieferten Apps verzichten auf ihr eigenes
äußeres Padding; die Autorenanleitung überlässt Seitenlayout und Abstand ausdrücklich dem Host.
Standalone-Vorschauen behalten ihren Dokumentfluss.
Kapitel: `docs/spec/run-modules.md`; Produkt-Homepage entsprechend ergänzt.

## Innenabstand der Mini-App-Statuszeile herstellen (13.09.2026)

Die eingebettete Host-Statuszeile setzte ihren seitlichen und unteren Innenabstand auf null.
Meldungen wie "Aktion läuft" klebten dadurch am Kartenrand. Sie verwenden nun den gemeinsamen
seitlichen Workspace-Abstand und acht Pixel oben und unten.
Kapitel: `docs/spec/plugins.md`; Produkt-Homepage entsprechend ergänzt.

## Sichtbarer Start (13.09.2026)

Ein lokaler Start wartete ohne Meldung auf einen unerreichbaren Dienst; zugleich
war ein Wunschport bereits von einem fremden Prozess belegt. Auf Ronalds Wunsch bleibt
`scripts/start.sh` der einzige Benutzereinstieg für alle Profile: belegte Wunschports werden mit
sichtbarer Meldung übersprungen. Eine frühe Portprüfung liegt vor der Plugin-Initialisierung.
Eine Profilvorbereitung protokolliert ihre Schritte und prüft Netzzugriffe vor ihren Aufrufen
mit einem kurzen Zeitlimit.
Der Dev-Start wählt zusätzlich einen getrennten Vite-Port und richtet dessen Proxy auf den
gewählten Backend-Port aus. Beide Ports bleiben danach fest, damit eine zweite Portwahl die
Oberfläche nicht mit einem anderen laufenden Dienst verbindet.

Der Browsertest deckte außerdem eine technische URL beim Abfragen laufender App-Aktionen auf.
Die Abfrage verwendet jetzt die App-Route und funktioniert auch ohne technische Einsichtsrechte.
Laufanzeigen verwenden fachliche Aktionslabels und verbergen technische Kennungen im eingeschränkten Zugang.
Kapitel: `docs/spec/profiles.md`, `docs/spec/plugins.md`, `docs/spec/run-modules.md`;
Bedienung in `docs/operations.md`.

## Endbenutzerzugang und geführte Setups (13.09.2026)

Endbenutzer starten freigegebene Setups; der vollständige Zugang bleibt bestehen. Allgemeine
Rechte trennen Bedienung, freie Starts und technische Einsicht. Dieselbe Prüfung gilt in UI
und Server, einschließlich redigierter Snapshots. Anmeldung ist konfigurierbar und unabhängig
von der Einschränkung. Benutzerpasswörter dürfen ausdrücklich im Klartext konfiguriert werden.

Ein loser Shell-Skill und ein eigener Reiter werden durch ein vorbereitetes Setup ersetzt. Die
Mini-App zeigt die Auswahl, den Fortschritt, Konflikte und den Abschluss. Ein fester Dienst
und ein TypeScript-Steueractor führen die Arbeitsschritte aus; ein einzelner begrenzter
LLM-Helfer bespricht Konflikte. Getrennte App- und Steueractors halten die App bei langen
Läufen bedienbar. Der Abschluss prüft den wirklich gebauten Stand serverseitig. Die Schritte
lassen sich nach Abbruch anhand gespeicherter Nachweise wiederaufnehmen. Keine stillen
Fallbacks und keine ungewählten Eingaben.
Kapitel: `docs/spec/profiles.md`, `plugins.md`, `typescript-platform.md`.
Bedienung in `docs/operations.md`, Produktüberblick und öffentliche Rechtebeschreibung angepasst.

## Demos nach Anwendungsfall statt UI-Control auswählen (13.09.2026)

Die mitgelieferten neutralen Beispiele demonstrieren RAgents-Konzepte und dienen als
Ausgangspunkte für High-Level-Testfälle. Die bisherige Forderung nach zwei Skill-Beispielen
pro UI-Control erzeugte unnötige Karten und überladene Aufträge. Die Control-Quote, ihr Test
und die einzelnen UI-Controls im Demo-Konzeptkatalog samt Tags entfallen. Demos kombinieren
die für ihren Anwendungsfall passenden Controls; eine vollständige Control-Abdeckung ist
kein Ziel. Die generierte technische UI-Referenz bleibt davon unabhängig. Die Mindestzahl
für Produktkonzepte gilt weiter. Die Beschreibungen aller Demo-Einstiege nennen im bestehenden
`description`-Feld ihren Demonstrationszweck und unterscheiden ähnliche Fälle. Startauswahl
und öffentliche Referenz übernehmen denselben Text. Kapitel: `docs/spec/overview.md`, `plugins.md`.

## Chat von programmierten Actor-Eingaben trennen (13.09.2026)

Freie Chatnachrichten wurden bisher auch an TypeScript-Actors und an Runs mit einem
TypeScript-Primary angenommen. Das Wortspiel ignorierte solche Nachrichten; die
Annahmebestätigung verleitete auch den globalen Koordinator dazu, einen Auftrag als zugestellt
und ausführbar zu behandeln. Der Chat-Host weist diese Ziele jetzt vor Eingaben und Anhängen
mit einem fachlichen Fehler ab. Oberfläche und gebundene Mini-App-Chats zeigen ihren Verlauf
ohne Chat-Eingabe. Modellbeschreibungen erklären Programmeingaben und die Grenze einer
Einreihungsbestätigung. Wortspiel und Lernnachmittag weisen unbekannte direkte Programmeingaben
als Fehler ab und erhalten dabei ihren Zustand. Der allgemeine ActorInput-Kanal bleibt für
programmierte Kommandos und Ereignisse bestehen.
Kapitel: `docs/spec/core.md`, `typescript-platform.md`, `run-modules.md`, `plugins.md`.

## Mini-App-Scrollbalken an den Kartenrand rücken (13.09.2026)

Der Freiraum für den Größenanfasser liegt bei Mini-Apps unter dem Inhalt. Der Scrollbereich
nutzt dadurch die volle innere Kartenbreite statt rechts einen ungenutzten Streifen zu lassen.
Der Kartenkopf behält seinen seitlichen Abstand und bleibt beim Einklappen stabil.
Kapitel: `docs/spec/plugins.md`; Produkt-Homepage entsprechend ergänzt.

## Canvas-Zugänge durchblättern und Typen unterscheiden (13.09.2026)

Die Canvas-Leiste ergänzt bei Platzmangel Pfeilknöpfe und übersetzt vertikales Mausrad-Scrollen
in horizontale Bewegung. Scrollbalken bleiben verborgen, die festen Listen- und Filterknöpfe
erreichbar. Unterschiedliche Symbole auf den bestehenden Canvas-Typfarben unterscheiden
LLM-Actors, TypeScript-Actors und Mini-Apps auch bei gleichlautenden Anzeigenamen.
Kapitel: `docs/spec/plugins.md`; Bedienung auf der Produkt-Homepage ergänzt.

## Actorliste verdichten und App-Kopf beim Einklappen stabil halten (13.09.2026)

Die Actorliste ordnet Handle und Anzeigename nebeneinander an, Metadaten kompakt darunter
und die Canvas-Auswahl rechts. Lange Namen dürfen umbrechen. Skalierbare Mini-App-Karten
behalten den seitlichen Platz für den Größenanfasser auch eingeklappt; der Kartenkopf
verschiebt sich dadurch nicht beim Umschalten. Kapitel: `docs/spec/plugins.md`.

## Konzepte vor Beispielen erklären (13.09.2026)

Die Funktionsabschnitte der Homepage erklären Setups, Agenten und Koordination, TypeScript
als Arbeitsweg der KI sowie Mini-Apps unabhängig von den Samples. Überschriften benennen
diese Konzepte; Bildunterschriften ordnen die Vorschauen ausdrücklich als Beispiele zu.
Dadurch erscheinen Anwendungsfälle nicht als Produktbegriffe. Die Vorschauen ändern ihren
Zustand nur noch durch Bedienung. Scrollen löst keine Inhalts- und Höhenänderungen aus; die
Frames erhalten beim Größenabgleich keinen inneren Scrollbalken. Im normalen Seitenlauf
stehen Text und Beispiel oben ausgerichtet mit Abstand zum nächsten Paar.
Kapitel: `docs/spec/overview.md`.

## Sample-Vorschauen vollständig und im Zusammenhang zeigen (13.09.2026)

Die Homepage bemisst eingebettete Vorschauen nach ihrem tatsächlichen Inhalt statt nach
einer festen Framehöhe. Auch bei schmalen oder niedrigen Fenstern bleibt der Seitenlauf
der einzige Scrollbereich. Der Agentenabschnitt erklärt die zwei Helfer und das sammelnde
TypeScript-Programm des gezeigten Lernnachmittags; die alternative KI-Koordination steht
getrennt davon. Bedienhinweise und technische Exkurse entfallen auf der Hauptseite; ihre
vier Funktionsabschnitte erklären jeweils die Idee am sichtbaren Beispiel. Details bleiben
im Guide und in der Referenz. Sample-Links unter den Vorschauen starten in der eingebetteten
Hilfe dasselbe Sample wie der Startknopf. Kapitel: `docs/spec/overview.md`, `plugins.md`.

## Von Kernideen zu startbaren Samples führen (13.09.2026)

Der Guide beginnt mit der Zusammenarbeit von KI und TypeScript, festen Abläufen, Actors,
Nachrichten und Mini-Apps. Die Navigation trennt Verstehen, Ausprobieren, Selbstbauen und
Nachschlagen; technische Werkzeugnamen folgen erst nach der Erklärung ihres Zwecks.

Wortspiel und Lernnachmittag sind vorbereitete Run-Scripts mit eigenen Mini-Apps. Ihre
Homepage-Vorschauen verwenden dieselben View-Komponenten mit gekennzeichneten Beispieldaten.
Die echte Modellarbeit beginnt erst beim Start in der App. Die eingebettete Hilfe kann
verfügbare Samples über die vorhandene Run-Erstellung öffnen; Profil und Benutzerrechte
begrenzen die Auswahl. Sichtbare native Scrollbalken und eine begrenzte Framehöhe erleichtern
die Orientierung in langen Referenzseiten.
Kapitel: `docs/spec/overview.md`, `typescript-platform.md`, `plugins.md`; Bedienung in
`docs/operations.md`, ausführbare Beispiele unter `plugins/ragents.reference/run-scripts/`.

## Doppelte UI- und Server-Zuständigkeiten zusammenführen (13.09.2026)

Floating-Positionierung und Sichtbarkeitsbeobachtung liegen gemeinsam im Host-UI-Kern;
Menüs, Tooltips, Actor-Pop-outs, Schrittdetails, Journal und globaler Koordinator verwenden
sie. Das X der Koordinator-Kurzantwort bleibt beim Drücken unter dem Mauszeiger; seine
Zentrierung überschreibt nicht mehr die gemeinsame Druckanimation. Datei-Aufnahme und
lokale Einstellungs-Stores teilen ihre wiederholte Verdrahtung.
Dialoge der Fachplugins verwenden die zentrale Dialoghülle, beide Logansichten dieselbe Komponente.
Primär-Chat und Actor-Verläufe teilen die Journal-Ereignisabbildung; Routing und die
unterschiedlichen Darstellungsregeln bleiben bei den beiden Projektionen.
Run-Stopp und Engine teilen Fehleraggregation; der Host-HTTP-Mapper erhält fachliche
DomainError-Statuscodes, vier generische Plugin-Mapper entfallen. Doppelte Routenmuster
und eine doppelte Code-/Pfad-Prüfung sind entfernt.

Die Quellenprüfung unterscheidet echte Kopien von verschiedenen Verträgen: flache
Prompt-/Run-Script-Köpfe und YAML-Skills bleiben getrennt, ebenso Actor-Guards für
verschiedene Datenstrukturen und fachliche Fehlerübersetzungen der Fachplugins. Kapitel:
`docs/spec/plugins.md`, `docs/spec/core.md`, `docs/spec/run-modules.md`; die Homepage
beschreibt die gemeinsame Größenanpassung der Pop-outs und Schrittdetails.

## Verifizierte Laufzeitgrenzen im öffentlichen Guide erklären (13.09.2026)

Die Hinweise des Konzept-Audits wurden gegen Treiber, Zustandsübernahme und bestehende Tests
geprüft. Der Guide erklärt nun den eigenen Modellkontext eines Actors getrennt von Actor-Zustand
und Journal sowie die Bedeutung von ID, Handle und erneutem Spawn. Ein gestoppter Actor gibt
seinen Handle nicht frei; Gesprächsgedächtnis entsteht nicht erst durch ein Actor-Programm.

Vorhandene Spec-Abschnitte zu Stopps und Lebenszyklus werden öffentlich erschlossen: Der
Run-Stopp erhält den Primary-Actor, wartet aber die Bereinigung ab. Nach einem Serverneustart
unterscheiden sich wartende ActorInputs von abgebrochenen Turns und Mini-App-Aufrufen.
Die Zustandsübernahme einer erfolgreichen Funktion setzt bereits geschehene Seiteneffekte
bei späteren Fehlern nicht zurück. Diese Grenzen sollen Wiederholungen und Fortsetzungen
verständlich machen, ohne eine genau einmalige Ausführung zu versprechen.
Das Zugriffskapitel erklärt Capability, Grant, Geltungsbereich und Delegation sowie den
Unterschied zu Benutzerrechten und bloßer Funktionsauswahl. Die Begriffe Anmeldesitzung,
Modellkontext und Benutzerrechte vermeiden dabei scheinbare Widersprüche zwischen den Kapiteln.
Die abschließende Konsistenzprüfung präzisiert außerdem das Aktualisieren desselben Programmpakets
gegenüber dem abgewiesenen Zweitpaket sowie die Rollen von `create` und `register` und das
Skill-Metadatum `disable-model-invocation`.
Kapitel: `docs/spec/core.md`, `run-modules.md`, `profiles.md` und `plugins.md`;
die Guide-Texte entstehen aus denselben Quellen.

## Abschlussantworten des Konzept-Audits prüfen und gezielt korrigieren (13.09.2026)

Das Audit übernimmt die letzte Modellantwort statt einer Verkettung mit Zwischenkommentaren.
Die Synthese erhält ein echtes JSON-Schema für Befunde und offene Fragen; der Bericht prüft
Pflichtfelder, Typen und Quellenbelege. Eine begründete Bewertung und eigene Vergleichslesezugriffe
der Synthese verhindern, dass zwei leere Arrays als abgeschlossene Prüfung gelten.
Ungültige Antworten können in derselben Session
zweimal korrigiert werden, damit bereits gelesene Quellen erhalten bleiben. Die Aufruf- und
Zeitlimits umfassen die Korrekturen und den Netzwerkaustausch und beginnen nicht erneut.

Die Vorgaben steigen auf 60 Modellaufrufe und 900 Sekunden pro Agent bei bis zu 16000
Ausgabetokens je Modellanfrage. Antworten und Verbrauchsdaten jedes Versuchs bleiben zur
Prüfung erhalten. Ein nach den Korrekturen ungültiges Ergebnis scheitert ausdrücklich;
es erzeugt keinen scheinbar erfolgreichen Bericht. Zusammenhängende gelesene Ausschnitte
werden bei der Belegprüfung vereint; echte Leselücken bleiben Fehler. `--resume` übernimmt
Prüferberichte nur bei unverändertem Quellenstand, Fokus und Modus und wiederholt die Synthese
mit einem neuen Budget in einem neuen Ausgabeordner.
Kapitel: `docs/spec/overview.md`; Bedienung: `docs/operations.md`.

## Doppelimplementierungen mit dem vorhandenen F#-Audit untersuchen (13.09.2026)

Der Scan verwendet auf Wunsch das große `z-ai/glm-5.3`; `--reasoning-high` setzt die
Reasoning-Intensität ausdrücklich im HTTP-Request, durch den lokalen Mock geprüft.
Das Konzept-Audit erhält `--duplicates`, damit Quellzugriff, Modellanbindung, Grenzen und
Belegprüfung weiter dieselbe Implementierung nutzen. Drei GLM-Prüfer untersuchen
Oberfläche/CSS, Laufzeit und Plugin-Grenzen; eine Synthese bündelt belegte Doppelstellen
mit Folgen und gemeinsamem Ersatz. Der Code-Korpus umfasst dabei auch produktspezifische
Plugins, benötigt aber keinen Guide. Kapitel: `docs/spec/overview.md`; Aufruf und
Übertragung gelesener Quellen an den Modellanbieter stehen in `docs/operations.md`.

## Actor-Typfilter und gemeinsames Pop-out-Control (13.09.2026)

`Anzeige` bietet statt `Nur Koordinator` die Typfilter `LLM-Agenten` und `TypeScript`;
`Alle` und `Aktive` bleiben erhalten. Die feste Breite verhindert springende Nachbarknöpfe.
Das neue Speicherformat beginnt mit `Aktive`, ohne den entfernten Modus zu übernehmen.
Chat und Actorliste hatten getrennte Positionierungslogik mit unterschiedlichen Abständen.
Beide verwenden zusammen mit der Canvas-Ansicht jetzt `ActorPopout` für Positionierung,
Größenbegrenzung, Kopfzeile, Fokus und Darstellung. Die Fläche schließt ohne Abstand am
Knopf an. Kapitel: `docs/spec/plugins.md`; README, Bedienung und Homepage sind angepasst.

## Actorliste vor dem Canvas und einstellbare Header-Zugänge (13.09.2026)

Der Sammelknopf `Actors` öffnete seine Liste, deren Fläche jedoch hinter dem Canvas lag.
Eine ausdrückliche Stapelposition macht sie sichtbar und bedienbar. Die Browserprüfung
verwendet den echten OrchestrationCenter mit seinem Header-Portal und Canvas statt nur
einzelne Header-Einträge. Der neue linke Knopf `Anzeige` schaltet die direkten Zugänge
zwischen allen Actors, aktiven Actors und nur dem Koordinator um, unabhängig von der
Canvas-Sichtbarkeit. Die vollständige Actorliste bleibt erreichbar. Die Auswahl bleibt
pro Run im Browser; verborgene Chats behalten ihre Entwürfe. Offene Toolbar-Knöpfe zeigen
eine vertiefte Akzentfläche. Kapitel: `docs/spec/plugins.md`; README, Bedienung und
Homepage beschreiben Moduswahl und gedrückten Zustand.

## Actor-Pop-outs in der Canvas-Headerzeile wiederherstellen (13.09.2026)

Die direkten Actor-Einträge öffneten nur noch das rechte Panel. Sie öffnen wieder eine
Fläche unter ihrem Knopf: für LLM-Actors einschließlich Koordinator den Chat mit Eingabe,
für TypeScript-Actors die Actor-Ansicht. Beide verwenden den bestehenden Inspector, damit
Verlauf, Funktionen und Detailreiter denselben Stand zeigen. Besuchte Ansichten behalten
beim Schließen und Wechseln ihre Eingabeentwürfe. Floating UI führt die Position beim
Scrollen und bei Größenänderungen nach. Kapitel: `docs/spec/plugins.md`; README,
Bedienung und Homepage beschreiben die direkten Zugänge.

## Modellanbindung durch AI SDK Core ersetzen (13.09.2026)

Vercel AI SDK Core (`ai` 7) und `@openrouter/ai-sdk-provider` 3 übernehmen die
Modellanfragen einschließlich Streaming und Bilderzeugung. Der gegabelte OpenAI-Providerpfad
mit seinen Sonderfällen für bereits entfernte Anbieter und die direkte `openai`-Abhängigkeit
entfallen. Ein Adapter erhält den Ereignisvertrag, native Anhänge, Reasoning-Metadaten,
Cachemarkierungen, Kostenberechnung sowie Anfrage- und Antwort-Hooks. Kleine Übersetzungen
für `reasoning_content`, ältere Reasoning-Feldnamen und Werkzeug-Cachemarkierungen schließen
die Unterschiede zur SDK-Schnittstelle. Bilderzeugung weist Antworten ohne verwertbare
Bilddaten zurück; Cache-Lesen und Cache-Schreiben zählen als getrennte Tokenmengen.

Die eigene Session- und Agentenlaufzeit bleibt bestehen: private Kontexte, Werkzeugausführung,
Skills, Extensions, Compaction und die Agentenschleife sind ein eigener Umbau. Das SDK führt
hier genau einen Modellschritt aus und startet keine zweite Agentenschleife. Die bisherige
Protokollkennung bleibt für Modellbeschreibungen und gespeicherte Sitzungen erhalten.
Kapitel: `docs/spec/core.md`; die Paket-README beschreibt die Integrationsgrenze.

## Standardbibliotheken für Streams, JSON-RPC und Positionierung verwenden (13.09.2026)

`eventsource-parser` ersetzt die eigene SSE-Zerlegung im Chat und verarbeitet geteiltes UTF-8,
unterschiedliche Zeilenenden und mehrzeilige Datenfelder. `vscode-jsonrpc` übernimmt den
Transport zu Language Servern einschließlich Framing, Requests und Antworten. Die bestehende
Prozessverwaltung und die fachlichen LSP-Adapter bleiben die Integrationsgrenze.
Der Writer-Adapter leitet Schreibfehler in das Schließen der Verbindung um, weil
`vscode-jsonrpc` 9.0.2 sie sonst zusätzlich aus einem asynchronen Promise-Executor wirft.

Floating UI ersetzt die eigene Viewportberechnung von Auswahlmenüs und Header-Tooltips.
Positionierung und Größenbegrenzung folgen Scrollen sowie Größen- und Layoutänderungen;
native Popover, Dialogzuordnung und Bedienlogik bleiben erhalten. So liegen die allgemeinen
Protokoll- und Browserregeln bei den Bibliotheken. Kapitel: `docs/spec/core.md`,
`docs/spec/plugins.md`; die Homepage beschreibt das Verhalten der Auswahlmenüs.
Die lokale Homepage-Demo sperrt Verbindungen per Content Security Policy. Ihre Prüfung
kontrolliert diese Sperre und fehlende Run-Endpunkte statt unbenutzte Netzwerkhelfer im
Bibliotheksbundle als tatsächlichen Zugriff zu werten. Kapitel: `docs/spec/overview.md`.

## Run-Koordinator standardmäßig über die Actor-Leiste öffnen (13.09.2026)

Die Canvas-Sichtbarkeit blendet den primären Actor ohne persönliche Einzelentscheidung aus.
Damit bleibt der Run-Koordinator über den vorhandenen Zugang in der Actor-Leiste und seinen
Inspector-Chat erreichbar, ohne zusätzlich Platz auf der Arbeitsfläche zu belegen. Eine
ausdrücklich eingeblendete Karte bleibt sichtbar; Zurücksetzen stellt die Vorgabe wieder her.
Kapitel: `docs/spec/plugins.md`; README, Bedienung und Homepage folgen mit.

## Run nach dem Go im Vorbereitungschat starten (13.09.2026)

Der werkzeuglose Vorbereitungsaufruf wich einer eigenen Agent-Session mit einem gemeinsamen
Grundprompt des globalen Koordinators und einer gezielten Vorbereitungsrolle. Dadurch kann
der Benutzer den besprochenen Auftrag per sinngemäßem Go starten, ohne einen festgelegten
Satz oder einen zusätzlichen Klick. Die parameterlose Startfunktion übernimmt den vollständigen
Auftrag samt Skill und Anhängen über denselben Startpfad wie der Knopf. Sie merkt die Übergabe
bis zum erfolgreichen Antwortabschluss vor, damit Abbruch und Fehler keine Ausführung auslösen.
Kapitel: `docs/spec/plugins.md`, `docs/spec/core.md`; README, Bedienung und Homepage folgen mit.

## Kartenkopf am Chatinhalt ausrichten (13.09.2026)

Zusätzliche seitliche Margins am Rollensymbol und Größenknopf entfielen, damit die Kopfzeile
dieselben Inhaltsränder wie der Chatverlauf verwendet. Kapitel: `docs/spec/plugins.md`;
die Homepage beschreibt die bündige Ausrichtung.

## Nur den aktuellen Chatschritt als Standard zeigen (13.09.2026)

Der neue Detailgrad "aktuell" zeigt während der Arbeit nur "Denken" oder die Box des gerade
laufenden Werkzeugaufrufs. Frühere Schritte verschwinden aus der Darstellung, bleiben aber
über die bisherigen Detailgrade erreichbar. Das reduziert den Verlauf auf Gespräch und
gegenwärtige Tätigkeit. Der Modus ist Vorgabe für Run-Chats, Agenten, globale Koordination
und das gemeinsame Chat-Control; ausdrücklich gespeicherte Auswahlen bleiben erhalten.
Kapitel: `docs/spec/plugins.md`; die Homepage beschreibt die neue Vorgabe.

## Feste Tiefenstufen und kompaktere Karten (13.09.2026)

Die Materialeinstellung bestimmt die Anzahl von 0 bis 5 Tiefenstufen mit festem Abstand;
die Vorgabe ist 3. Dadurch entspricht jede sichtbare Stufe einer festen Tiefe. Alte Pixelwerte
werden nicht migriert; ungültige Einstellungen lassen sich nach einer Fehlermeldung zurücksetzen.
Eine einzelne Frontkontur, kleinere Kopfzeilen und einmalige seitliche Chatabstände geben dem
Inhalt mehr Platz. Der Größenanfasser braucht weniger Freiraum rechts. Zwischen Tiefenkörpern
genügen mindestens 32 Pixel; größere Layout- und Verbindungsabstände bleiben bestehen.
Kapitel: `docs/spec/plugins.md`, `docs/spec/run-modules.md`; Bedienung und Homepage folgen mit.

## Markdown im Chat mit Streamdown rendern (13.09.2026)

Der zeilenbasierte Eigenbau erkannte unter anderem Trennlinien nicht und konnte verschachtelte
Formatierungen nicht zuverlässig abbilden. Streamdown übernimmt Markdown und GFM sowie die
vorläufige Ergänzung unvollständiger Syntax während der Ausgabe. Der Nachrichtenabschluss
schaltet auf statische Darstellung um; Host-Links und Chatgestaltung bleiben integriert.
Der Renderer erhält den Originaltext, damit Einrückungen beim Streaming erhalten bleiben.
Kapitel: `docs/spec/plugins.md`; die Homepage beschreibt die Darstellung im Chat.

## Apps und Actors in eine eigene Canvas-Leiste setzen (13.09.2026)

Apps und Actor-Zugänge liegen in einer eigenen Leiste oben am Canvas. Dadurch gehören die
Zugänge zum geöffneten Run direkt zur Arbeitsfläche. Die durchsuchbare Actorliste bleibt
links erreichbar; Apps und direkte Zugänge zu aktiven nichtmenschlichen Actors scrollen
nebeneinander. Die gemeinsame Titelleiste wird mit
45 statt 56 Pixeln kompakter. Die Statusleiste bleibt 28 Pixel hoch. Eine feine untere
Trennlinie grenzt die Canvas-Leiste ab; ein eigener Schatten entfällt und der Schatten der
Titelleiste liegt darüber.

Die Leiste liegt außerhalb des Canvas-Dialogbereichs. App-Auswahl und Vollansichtswechsel
bleiben dadurch bei geöffneter Mini-App bedienbar. Der vorhandene Plugin-Slot erhält
`placement: "canvas"`; Beiträge ohne Angabe bleiben in der Titelleiste. Kapitel:
`docs/spec/plugins.md`, `run-modules.md`; die Produkt-Homepage folgt der neuen Anordnung.

## Guide und Code durch getrennte Leser prüfen (13.09.2026)

Ein externes F#-Skript vergleicht den öffentlichen Guide mit neutralem Code und Tests über
Microsoft Agent Framework und OpenRouter. Getrennte Rollen lesen die Beschreibung und die
Implementierung zunächst unabhängig; die Synthese muss Befunde anschließend mit Quellen
belegen. So wird die Beschreibung nicht schon beim ersten Lesen als Nachweis des Codes behandelt.

Der Bericht dokumentiert die tatsächlichen Lesezugriffe und behauptet keinen Vollscan.
Modellaufrufe und Laufzeit sind pro Agent begrenzt; ein Dry-Run prüft die Vorbereitung ohne
Modell. Verständliche Fortschrittsmeldungen zeigen, welcher Prüfer welche Quellen liest
oder auf ein Modell wartet, damit auch längere Läufe nachvollziehbar bleiben. Ergebnisse
bleiben außerhalb des Repositorys, Änderungen an Spec oder Code sind
kein Teil des Werkzeugs. Es dient der Entwicklung und ergänzt keine Laufzeitfähigkeit von
RAgents. Kapitel: `docs/spec/overview.md`; Bedienung: `docs/operations.md`.

## Öffentlichen Guide aus der bestehenden Dokumentation erzeugen (13.09.2026)

Die Homepage besitzt neben Produktüberblick und technischen Referenzen einen zusammenhängenden
Guide für Einstieg, Laufzeit, TypeScript-Funktionen, Actor-Programme, Erweiterungen und Rechte.
Die Erklärungen werden aus markierten öffentlichen Abschnitten der Spec und Betriebsdokumentation
erzeugt. Damit bleibt die fachliche Quelle an einem Ort, während Leser direkt auf der Website
von der Erklärung zu Codebeispielen und Verträgen gelangen. Marked ergänzt den vorhandenen
statischen Generator; ein eigener Dokumentationsserver ist nicht erforderlich.

Kapitel, Markdown-Fassungen, LLM-Index, statischer Export und eingebettete Hilfe entstehen
gemeinsam. Die Prüfung erkennt fehlende Quellabschnitte und ungültige lokale Seiten- und
Sprungziele. Private Betriebsdaten und interne Konzepte werden nicht automatisch übernommen.
Kapitel: `docs/spec/overview.md`, `core.md`, `typescript-platform.md`, `run-modules.md`,
`plugins.md`, `profiles.md`; Bedienung: `docs/operations.md`.

## Verfügbare TypeScript-Funktionen automatisch zeigen (13.09.2026)

Ausgerüstete LLM-Actors erhalten alle tatsächlich freigegebenen TypeScript-Funktionen mit
Name und Kurzbeschreibung. Die Übersicht folgt dem aufgelösten Funktionsbestand und seinen
Änderungen im laufenden Turn; sie gilt für Koordinator, Subagenten und globalen Koordinator.
Reine LLMs mit leerer Werkzeugauswahl bleiben ohne Übersicht.

`description` bleibt die knappe Zweckbeschreibung, `longDescription` ergänzt bei Bedarf
ausführliche Regeln und Beispiele. `typescript_api` liefert diese Details zusammen mit den
Typen gezielt auf Namensanfrage. Damit kennt das Modell seine Möglichkeiten, ohne vollständige
Verträge ständig im Kontext zu tragen. Registrierung, Übersicht und Nachschlagen verwenden
dieselbe Quelle. Kapitel: `docs/spec/plugins.md`, `typescript-platform.md`, `core.md` und
`overview.md`; Bedienung und öffentliche Referenzen sind entsprechend angepasst.

## Negative System-UIDs in macOS-Prozesstabellen lesen (13.09.2026)

Die Gesamtprüfung der Skill-Zusammenführung fand einen vorhandenen Parserfehler:
`ps` liefert für den Systemprozess `dhcp6d` die UID `-2`. Diese Zeile blockierte
Prozessbeobachtung und Bereinigung. Der macOS-Parser akzeptiert vorzeichenbehaftete UIDs;
Prozesskennungen bleiben nicht negativ. Eine Regression sichert die beobachtete Zeile.
Kapitel: `docs/spec/plugins.md`.

## Promptkarten in Skills zusammenführen (13.09.2026)

Textbasierte Einstiege verwenden gemeinsam `skills/<name>/SKILL.md`. Ein Skill kann einen
bearbeitbaren Startauftrag mitbringen und während der Arbeit als Anleitung geladen werden;
ergänzende Dateien bleiben beim selben Eintrag. Konkrete Beispielaufträge sind ausdrücklich
auswählbar, werden aber nicht automatisch als Arbeitsanleitung empfohlen. `SKILLS_DIR`
ersetzt das separate Kartenverzeichnis.

Alle Skill-Einstiege führen in denselben Vorbereitungschat, auch nach einem Einrichtungsdialog.
Der Run übernimmt den ausgearbeiteten Auftrag und den ausgewählten Skill. Damit entfallen
das zweite Textformat und getrennte Bedienwege. Run-Scripts behalten ihren programmierten Aufbau.
Kapitel: `docs/spec/plugins.md`, `overview.md` und `typescript-platform.md`.

## Freiraum am Größenanfasser für alle Canvas-Karten vereinheitlichen (12.09.2026)

Der Abstand gehört zum gemeinsamen Kartencontainer mit Größenanfasser, nicht zur Chat-Eingabe.
Jeder Inhalt einschließlich Mini-App und Dokumentabschnitten erhält acht Pixel unten und
30 Pixel rechts. Die zusätzliche Composer-Regel entfällt; Karten ohne Anfasser bleiben unverändert.
Kapitel: `docs/spec/run-modules.md`.

## Actors direkt neben den globalen Koordinator setzen (12.09.2026)

Das Actors-Symbol sitzt direkt rechts neben dem globalen Koordinator und vor dem Run-Titel.
Ein eigener Beitrag in der Kopfzeile hält es unabhängig vom rechten Panel erreichbar.
Kapitel: `docs/spec/plugins.md` und `run-modules.md`.

## TypeScript-Ausführungen im Sidepanel nachvollziehen (12.09.2026)

`Executions` sammelt die Snippet-Aufrufe aller Actors eines Runs mit Status, Zeit, Quelltext,
Ergebnis, Logs und Fehlern. Die schreibgeschützte Ansicht gehört zur Orchestrierungs-Extension;
die Ausführung bleibt Server-Grundausstattung. Suche und Statusfilter erleichtern das Prüfen
eines laufenden oder beendeten Runs. Nur der aktive Reiter aktualisiert seine Daten.

Der Host journalisiert den tatsächlich gelesenen Quelltext vor der Typprüfung. Ein Dateipfad
allein belegt nach einer Änderung nicht mehr, welcher Code geprüft oder ausgeführt wurde.
Deshalb bleibt der damalige Stand auch bei Compilefehlern erhalten. Ältere Inline-Aufrufe
zeigen ihre gespeicherte Eingabe; fehlt einem alten Dateiaufruf der Snapshot, wird das offen
angezeigt. Es gibt weder ein Nachladen der heutigen Datei noch einen erneuten Ausführungsweg
im Reiter. Geändert: `docs/spec/plugins.md`, `typescript-platform.md`, `core.md` und der
Journal-/TypeScript-Abschnitt der Homepage.

## Dokumentanzeigen in allen Actor-Gesprächen wieder anbinden (12.09.2026)

Der neue Actor-Chat hatte die registrierten Tool-Presenter nicht übernommen und zeigte
`show_document` deshalb nur als Werkzeugchip. Standardchat, Canvas und Inspector beziehen
die Darstellung jetzt aus demselben Session-Kontext. Die Dokumente-Sammlung berücksichtigt
auch Worker-Verläufe, damit deren sichtbare Dokumentknöpfe ein vorhandenes Ziel öffnen;
identische Aufrufe erscheinen nur einmal. Kapitel: `docs/spec/plugins.md`.

## Chat-Eingabe dichter an den Kartenrand setzen (12.09.2026)

Der untere Innenabstand der Canvas-Eingabe beträgt acht Pixel. Rechts bleiben 30 Pixel für den
innenliegenden Größenanfasser; seine Höhe erzeugt keinen eigenen Fußstreifen.
Kapitel: `docs/spec/run-modules.md`.

## Actors in die obere Arbeitsbereichsleiste verschieben (12.09.2026)

Die Actorliste öffnet jetzt über ein Symbol neben Dateien und den Sprachwerkzeugen nach unten.
Ansicht, Journal und Zoom bleiben in der unteren Statusleiste. Suche, Inspector-Auswahl und
persönliche Canvas-Sichtbarkeit bleiben erhalten. Kapitel: `docs/spec/plugins.md`.


Datiertes Protokoll, jüngste zuerst. Es sagt, WARUM etwas so ist. WAS ist, steht in den Kapiteln
unter `docs/spec/`; ein neuer Eintrag nennt das Kapitel, das er geändert hat, und wird zusammen
mit der Kapiteländerung geschrieben. Einträge vor dem 04.09.2026 nennen kein Kapitel und sind
noch nicht vollständig in die Kapitel zurückgeflossen (siehe TODO.md).

## 12.09.2026: Eine TypeScript-API für Snippets und Actor-Programme

Fachfunktionen werden einmal mit `defineRunFunction` und `host.functions` registriert und
stehen über `context.functions` in einmaligen Snippets und dauerhaften Actor-Programmen bereit.
Die kleine native Modelloberfläche entdeckt Verträge mit `typescript_api` und führt Code mit
`typescript_eval` aus; native Fachwerkzeuge sind eine ausdrückliche Option. Der Host verwendet
denselben Compiler, Funktionsresolver und Executor. Suche und Snippets gehören zur
Server-Grundausstattung, damit der globale Koordinator und Profile ohne Actor-Programm-Plugin
dieselbe Schnittstelle verwenden. Auch der globale Prompt erlaubt freie fachliche Starts.
Ein Aufbau benötigt keinen eigenen
Setup-Actor mehr. `agent_spawn` liefert die erzeugte Actor-Referenz direkt statt einer Eventliste.

Der bisherige Weg verband Pflicht-Setup-Actor, Werkzeugfreigaben und unterschiedliche
Ausführungskontexte. Die Vereinfachung verlagert technische Verträge in die auffindbare API.
Fachliche Promptkarten bleiben Ergebnisaufträge, ohne vorgeschriebenen technischen Aufbau.
Snippets handeln als Aufrufer, Actor-Inputs als empfangender Actor; veröffentlichte Funktionen
behalten Besitzerzustand und Aufruferidentität. Abgeschlossene Seiteneffekte bleiben bei späterem
Fehler erhalten. Deshalb zeigen Anleitungen Wiederaufnahme und tatsächliche Ergebnisprüfung.
Die Typprüfung umfasst den deklarierten Backend-Einstieg auch außerhalb von `tsconfig.include`,
ohne Autorenkonfigurationen zu überschreiben. Ergebnisse und Zustand werden bereits vor IPC
als strenges JSON geprüft, damit etwa `Infinity` nicht still als `null` ankommt; TypeBox-Verträge
werden für ihre Beschreibung ausdrücklich ohne Metadaten als JSON exportiert.
Geändert: `overview.md`, `typescript-platform.md`, `run-modules.md`, `plugins.md` und `core.md`;
README, Bedienung, öffentliche Homepage und generierte Referenzbeispiele folgen demselben Zugang.

## Zusätzlichen Fußstreifen unter Canvas-Inhalten entfernen (12.09.2026)

Kapitel: run-modules. Ronald lehnt die zusätzliche Leerzeile unter der einzeiligen Eingabe ab.
Die pauschalen 32 Pixel Innenabstand für den Größenanfasser entfallen bei LLM-Karten und
Mini-Apps. Der Griff bleibt in der Ecke; die bisherige knappe Innenkante der Eingabe genügt.

## Balkon als vorbereitetes Demo und Abstand zum Größenanfasser (12.09.2026)

Kapitel: plugins, run-modules. Ronald beauftragt ausdrücklich ein Balkon-Demo-Setup.
Das Referenzpaket richtet den Berater und seine eigene App in TypeScript ein; Fragen und
Empfehlung bleiben beim Modell. Es verwendet die bestehenden Actor- und Chat-Verträge.
Ein Startknopf trennt den Aufbau vom ersten Modellaufruf, eine erneute Anforderung nach
Modellfehlern zählt keine zusätzliche Antwort. Die Promptkarte bleibt ein separater Auftrag
an den Builder. Daraus entsteht keine allgemeine fachliche Wizard-Vorgabe.
Weil der innenliegende Größenanfasser über Fehlermeldungen und Eingaben lag, reservieren
vergrößerbare Canvas-Apps und LLM-Karten unten Platz für ihn.

## Run-Aufbau und Werkzeugauswahl ausdrücklich begrenzen (12.09.2026)

Kapitel: core, typescript-platform, plugins, profiles. Der Balkon-Test zeigte trotz geladener
Anweisung direkten Aufbau und einen Gesprächsberater mit geerbtem Rückfragewerkzeug. Ronald
beauftragt allgemeine Plattformkorrekturen, ausdrücklich keine fachliche Wizard-Vorgabe.
Der Run-Builder bereitet TypeScript vor und startet es; direkte strukturelle Modellwerkzeuge
entfallen. Fachagenten wählen ihre Werkzeuge beim Spawn ausdrücklich, ohne stille Vererbung.
Der bestehende Host-Erzeugungsbefehl hält Builder-Prompt und Koordinator-Beiträge auch nach
Primary-Wechsel oder Fork beim richtigen Actor. Canvas und View-Sichtbarkeit teilen ihre
Namensauflösung. Bekannte Views gestoppter Actors werden aus der Szene entfernt, damit ein
Stopp keine verwaisten Fehlplatzhalter erzeugt. Der Run-Koordinator erhält auf Ronalds Wunsch
high als Standard-Denktiefe. Ein reparierter Einzellauf gilt nicht als Nachweis für den Builder.

## Zusätzliche Schatteneffekte vollständig entfernen (12.09.2026)

Kapitel: plugins, run-modules, overview. Ronald möchte den Effekt nach erneut sichtbaren
Nachziehspuren entfernen. WebGL-Kontaktschatten, Iframe-Runtime, Material-Portnachrichten und
die Schattenregler entfallen vollständig. Auch der Filter-Schlagschatten der Karten entfällt.
Die Materialtiefe bleibt unabhängig davon einstellbar. Die bisherigen Offline-Entwürfe bleiben
als Entwürfe in der gemeinsamen Übersicht erhalten.

## Kartenkopf vereinfachen und innenliegende Griffe erreichbar halten (12.09.2026)

Kapitel: plugins. Ronald möchte im LLM-Kartenkopf nur Symbol, Name und Größenknopf;
Rollenüberschrift und Eingabezähler entfallen. Nach dem Versetzen nach innen lag der Griff
unter der Eingabeleiste. Seine Zeichenebene liegt jetzt darüber. Kopfzeile, rechtes Panel und
Statusleiste erhalten ein eigenes deckendes Schieferblau, damit der Hintergrund keine warmen
Farben in diese Flächen mischt.

## Anwendung auf die Canvas-Palette abstimmen (12.09.2026)

Kapitel: plugins. Ronald empfindet die übrige Anwendung farblich nicht als zusammengehörig.
Kühle blaugraue Grundflächen, Lavendel für Auswahl und Aktionen sowie violettgraue Konturen
ersetzen die warmen Schalenfarben. Kopfzeile, Panels, Dialoge und Einstellungen übernehmen
sie über die gemeinsamen Tokens. Die bisher fest eingetragenen Datei-, Aufgaben-, Dokument-
und Entwicklungsstatusfarben verwenden ebenfalls zentrale Farben mit passender dunkler Variante.

## Canvas-Hintergrund beleben und Griffe nach innen setzen (12.09.2026)

Kapitel: plugins. Ronald findet den Hintergrund zu einflächig und die Karten weiterhin zu eng.
Mehrere weiche Farbverläufe bringen Lavendel, Mint, Blau und einen warmen Randbereich zurück;
die Materialstruktur wird schwächer. Zwischen den Tiefenkörpern bleiben mindestens 72 statt
40 CSS-Pixel. Der Größenanfasser sitzt wieder innerhalb der Kartenecke und verwendet
Schwarz mit 70 Prozent Deckkraft, auch beim Darüberfahren.

## Balkon-Gespräch durch eine eigenständige Canvas-App vermitteln (12.09.2026)

Kapitel: plugins, typescript-platform. Der erzeugte Wizard stellte fünf feste Fragen und nutzte
den Berater erst für die Auswertung. Ronald möchte hingegen ein begrenztes LLM-Gespräch:
Die App vermittelt jede Antwort, das LLM bestimmt die nächste Frage. Die Promptkarte verlangt
dafür ausdrücklich eine eigenständige App auf dem Canvas, außerhalb einer LLM-Chatkarte.
Die Aufbauanweisung gehört in die Prompts des globalen Koordinators und Run-Builders;
sie wird nicht zusätzlich über die allgemeine Werkzeug-Kurzanleitung an Fachagenten verteilt.

## Canvas-Ansichten vor dem Speichern auflösen (12.09.2026)

Kapitel: plugins. Der Balkon-Run platzierte `app:balkon-wizard/wizard`, während die aktive
Ansicht intern anders hieß. Das Layout speicherte diesen Verweis ungeprüft und zeigte erst auf
der Fläche einen Fehler. Das Werkzeug löst nun selbstgewählte Programm- oder Actor-Namen mit
View-Schlüssel serverseitig auf und weist unbekannte Ansichten vor jeder Zustandsänderung ab.
Damit müssen Modelle keine generierten View-IDs übertragen. Bestehende Layouts werden nicht
umgeschrieben; ein erneuter Layout-Aufruf nutzt die Prüfung und Auflösung.

## Kontaktschatten an die tatsächliche Zeichenfläche binden (12.09.2026)

Kapitel: plugins. Ronald sieht vergrößerte, versetzte Schatten neben den Eingaben.
Der Renderer nahm an, dass der GPU-Puffer die angeforderte Browserauflösung übernimmt.
Ein großer Test-Viewport reproduziert die Abweichung: Statt 24000 Pixel Breite stellt die GPU
nur 8192 bereit. Shader und Ausschnitt rechnen deshalb mit dem tatsächlichen Drawing Buffer
und der gemessenen Bildschirmfläche des Canvas. Die Zuordnung folgt auch Zoom und Panning.

## Kartenabstand und Mini-App-Farbe korrigieren (12.09.2026)

Kapitel: plugins, run-modules. Ronald möchte mehr Abstand zwischen den Tiefenkörpern und
keine beige Mini-App. Der Mindestabstand wächst von 18 auf 40 CSS-Pixel zusätzlich zur
Extrusion. Mini-App-Fläche und gemeinsame Controls wechseln zu mattem Blaugrau. Der einzelne
Größenanfasser bleibt außen, sitzt aber zwölf Pixel näher an der Kartenecke.

## Einzeilige Quassel-Eingabe in LLM-Karten (12.09.2026)

Kapitel: plugins. Ronald möchte mehr Platz für das Gespräch in den LLM-Actor-Karten.
Der gemeinsame Quassel-Composer erhält eine Inline-Darstellung mit Textfeld, Anhang,
Detailgrad und Senden nebeneinander. Anhänge, Fehlerbehandlung und Entwurfswiederherstellung
bleiben im selben Baustein; im rechten Inspector bleibt die bisherige Eingabehöhe erhalten.

## Schichtwerk-Tiefenkörper als Canvas-Material übernehmen (12.09.2026)

Kapitel: plugins, run-modules, overview. Ronald möchte die ausgearbeitete Materialwirkung des Entwurfs
layer-depth-style.html in der laufenden Oberfläche. Gerade matte Fronten, runde Kanten und
nach rechts oben extrudierte Körper ersetzen die Glaskarten. Die Seitentiefe wird nach hinten
in drei Stufen heller; die breite Eckenschattierung dunkelt ausschließlich ab. Zwischenlinien
und mausabhängiges Licht entfallen. Lavendel, Ton, Senfgelb und Kalkweiß unterscheiden die
Actor-Arten und Mini-App-Hosts. Auch die Mini-App-Controls übernehmen matte Kalkflächen,
lavendelfarbene Aktionen und runde Ecken. Größenabhängige WebGL-Kontaktschatten ergänzen sie.
Darstellung enthält browserlokale Regler für Materialtiefe und Schatten: Tiefe 44, Schatten an
und Stärke 30 sind die Vorgaben. Änderungen wirken sofort in allen Runs und Mini-Apps.
Das beschriftete Canvas-Schema der Homepage folgt dem Material; der ursprüngliche Offline-Entwurf
bleibt zum Vergleich in der gemeinsamen Entwurfsübersicht.

## Setup-Code ausdrücklich von Mini-App-Code unterscheiden (12.09.2026)

Kapitel: core, typescript-platform. Der aktuelle Balkon-Wizard-Run hatte die neue Setup-Regel
im Koordinator-Prompt, baute aber nur das Mini-App-Programm in TypeScript. Agent, Aktivierung,
Subscription und Canvas wurden weiterhin direkt eingerichtet. Die bisherige Präferenz wird
deshalb für mehrteilige Aufbauten zur eindeutigen Arbeitsanweisung: Schon Agent plus Mini-App
benötigt einen Setup-Handler, der die Aufbauaufrufe ausführt. Die zur Vorbereitung und zum
Start dieses Handlers nötigen direkten Aufrufe sind ausdrücklich benannt. Die Laufzeit erzwingt
diese Promptregel weiterhin nicht technisch. Der beobachtete Run wird dadurch nicht umgebaut.

## Balkon-Wizard als Mini-App-Promptkarte anbieten (12.09.2026)

Kapitel: plugins. Ronald möchte den Balkon-Wizard erneut aus der Startauswahl aufbauen können.
Die neutrale Referenz erhält dafür eine kurze Promptkarte: fünf aufeinander aufbauende Fragen
in einer eigenen Oberfläche und anschließend eine Gestaltungsempfehlung. Gemeinsame Layout-
und Formularbausteine sowie sichtbare Lade- und Fehlerzustände gehören zum Auftrag. Die Karte
registriert einen Aufbauwunsch, kein fest installiertes Programm. Die zuvor erweiterten
Textanalyse- und Listenprompts werden ebenfalls wieder auf kurze fachliche Aufträge verdichtet.

## Mauslicht aus dem Entwurf entfernen (12.09.2026)

Kapitel: overview. Ronald möchte keine Beleuchtung, die der Maus folgt. Der Entwurf entfernt
Schalter, Maussteuerung und den zusätzlichen Frontverlauf vollständig. Feste matte Fronten,
gestufte Tiefenkörper und größenabhängige Kontaktschatten bleiben erhalten.

## Bewegliches Licht im Entwurf sichtbar machen (12.09.2026)

Kapitel: overview. Der frühere Frontverlauf dunkelte maximal um etwa 3,5 Prozent ab und
bewegte sich relativ zur gesamten Bühne; Ronald konnte die Wirkung nicht erkennen.
"Licht folgt Maus" verwendet jetzt die Koordinaten jeder Box und einen deutlicheren matten
Verlauf ohne Aufhellung. Bei reduzierter Bewegung startet der Effekt aus, lässt sich aber
bewusst aktivieren; zuvor blockierte die Einstellung den eingeschalteten Schalter unsichtbar.
Ausschalten und Verlassen der Bühne brechen noch wartende Aktualisierungen ab.

## Kontaktschatten an die Größe des Controls anpassen (12.09.2026)

Kapitel: overview. Ronald findet die Kontaktschatten im Schichtwerk-Entwurf bei Checkboxen
zu stark. Der Shader skaliert Ausdehnung, Versatz und Deckkraft deshalb nach der kürzeren
Controlkante. So bleiben kleine und schmale Elemente dezent, während größere Flächen die
bisherige Tiefe behalten. Der Stärkeregler wirkt weiterhin auf alle Controls, erhält aber
deren Größenverhältnis. Der bestehende Entwurf und seine beiden Vorschauen werden aktualisiert.

## Mini-App-Grundlayout und Formularaufbau gemeinsam liefern (12.09.2026)

Kapitel: run-modules. Ronalds Balkon-Wizard zeigte Browser-Standardschrift und ein überlagertes
Textfeld. Die Bibliothek lieferte Fachcontrols, überließ Grundlayout und Typografie jedoch den
erzeugten App-Quellen. Der Host liefert nun die Basis zentral; AppLayout, Stack und Grid übernehmen
Rahmen, Abstände und an der Containerbreite orientierte Spalten. Textanalyse und gemeinsame
Liste nutzen dieselben Bausteine und Form für ihre Eingaben. Die Autorenanleitung lenkt auch
Wizards auf Form; Feld-CSS wirkt nur noch an echten Eingabeelementen. Die vorhandenen Demos
zeigen Textareas und einen lokalen Interview-Schritt. Eigene App-Quellen bleiben bearbeitbar;
die Änderung ersetzt keine alten Programme automatisch.

## Modellwahl beim Agent-Spawn direkt am Werkzeug erklären (12.09.2026)

Kapitel: core. Ronalds Balkon-Wizard-Aufbau versuchte einen LLM-Agenten nur mit Handle und
Prompt anzulegen. Profil und Modell waren im Schema einzeln optional und ohne Erklärung
ihrer Abhängigkeit. Werkzeug- und Feldbeschreibungen nennen jetzt die notwendige ausdrückliche
Modellwahl; der Orchestrierungsprompt verlangt sie bei jedem LLM-Spawn. Der harte Fehler bleibt
erhalten, statt die fehlende Auswahl durch ein stilles Standardprofil zu ersetzen. Ob das
verwendete Modell die klarere Anleitung zuverlässig befolgt, braucht einen weiteren echten Lauf.

## Mehrteilige Run-Aufbauten bevorzugt als TypeScript ausführen (12.09.2026)

Kapitel: core, typescript-platform. Ronald möchte zusammengehörige Einrichtungsschritte als
prüfbaren Code statt als lange Folge einzelner Modell-Werkzeugaufrufe. Der globale Koordinator
soll vorhandene Run-Scripts bevorzugen oder eigene Pakete erstellen; im bestehenden Run nutzt
der Koordinator denselben Actor-Programmpfad mit Setup-Handler. Einfache Starts und gezielte
Einzeländerungen bleiben direkt. Die Prompts verlangen den Aufbau vor Arbeitsaufträgen und
Bestandsprüfung vor Wiederholungen, weil Capability-Aufrufe keinen gemeinsamen Rollback haben.
Die Änderung verwendet bestehende Verträge und führt keine neue Setup-Abstraktion ein.

## Nicht lesbare Journale auf ihren Run begrenzen (12.09.2026)

Kapitel: core, overview. Ronald verlangt ausdrücklich, dass alte oder beschädigte Journale
niemals den Serverstart oder andere Runs blockieren. Der Wechsel auf Dateiformat 4 hatte den
Start noch bei der ersten v3-Datei beendet. Die Wiederherstellung übernimmt nun jeden Run erst
nach vollständiger Prüfung; Fehler isolieren seine ID und melden Pfad und Ursache. Originaldateien
bleiben erhalten, automatische Migration und Neuerzeugung unter derselben ID entfallen.
Direkte Zugriffe melden einen benannten Run-Fehler. Auch ein Fehler beim laufenden Journal-Append
sperrt nur seinen Run. Der ausdrückliche globale Gesprächsreset kann eine gesperrte
Koordinator-ID freigeben. Ein leerer gesamter Datenbestand ist für den Serverstart nicht nötig.

## Schichtwerk als matte Tiefenkörper weiterentwickeln (12.09.2026)

Kapitel: overview. Der neue Offline-Entwurf layer-depth-style.html entwickelt Schichtwerk
mit deutlich nach rechts oben extrudierten Körpern, runden Fasen und matten Schattierungen weiter.
Die Materialtiefe steht standardmäßig auf 56 statt 22 und lässt sich zwischen 24 und 80 einstellen.
Konturen an Front und äußerer Silhouette geben den Körpern einen gezeichneten Charakter.
Die Seitenflächen kommen ohne zusätzliche Striche aus. Drei flächige Schattenstufen gliedern
die Tiefe; die kleinen Schlagschatten an den Bedienelementen bleiben weich.
Die Tiefe verläuft vorne dunkler und nach hinten heller bis zur unveränderten Seitenfarbe.
Die matten Flächen, runden Kanten und geraden Fronten bleiben erhalten. Die Schattierung der
Rundung rechts oben erstreckt sich über einen breiteren Bereich bis auf die angrenzenden Seiten.
Sie ist im mittleren Winkelbogen am dunkelsten und nimmt nach außen in klar getrennten Stufen ab.
Alle Materialschattierungen dunkeln ausschließlich ab. Ein weicher Schlagschatten folgt der gesamten Silhouette statt einer versetzten Schattenplatte.
Eine transparente WebGL-Schicht je Karte ergänzt weiche Kontaktschatten an echten HTML-Controls.
Abstandsfunktionen der gerundeten Controls modellieren Auflage und Vertiefung; beim Drücken
wird der Auflageschatten enger. Die gestuften Boxen bleiben erhalten. Ein Schalter und ein
Stärkeregler machen den Effekt vergleichbar, fehlendes WebGL wird sichtbar gemeldet.
Der Shader zeichnet nur bei Änderungen an Größe oder Bedienzustand. Gerade Fronten,
einstellbare Materialtiefe und bewegliches Licht machen die Formwirkung vergleichbar. Die Seite samt Desktop- und Mobilvorschau steht zuerst in der bestehenden
Entwurfsübersicht; die laufende Oberfläche übernimmt diesen Entwurf noch nicht.

## Actor-Schritte beim Wechsel des Hauptchats erhalten (12.09.2026)

Kapitel: plugins, run-modules. Der bisherige Hauptactor fiel nach einem Wechsel auf eine
Projektion aus Eingaben und Antworten zurück. Denk- und Werkzeugschritte waren dadurch trotz
aktiviertem Detailgrad unsichtbar. Der Host liefert jetzt getrennte Gesprächsverläufe je Actor
aus dem Journal und aktualisiert sie über die vorhandenen Run-Benachrichtigungen. Karten,
Inspector und Mini-App-Chat nutzen dieselben Verläufe. Die kompakte Run-Ansicht enthält
weiterhin keine Werkzeugargumente oder Ergebnisse.
Die Größenanfasser der Canvas-Karten liegen als einzelner Bogen außerhalb ihrer unteren
rechten Ecke. Eine größere Trefferfläche hält sie bedienbar, ohne den Eingabebereich zu überdecken.

## Einzelstile in der Entwurfsübersicht sichtbar halten (12.09.2026)

Kapitel: overview. Das Zusammenfassen der oberen Tabs hatte auch die Einzelvorschauen aus
dem Kartenraster entfernt; dadurch war etwa Plakat nur noch hinter Farbwerk erreichbar.
Das Raster zeigt wieder jeden Stil mit eigener Vorschau und direktem Variantenlink.
Nur die obere Leiste fasst Sammlungen zusammen. Teamraster, Gesprächsrunde und Synth-Oberflächen
waren beim Nachtragen fälschlich auf den 11.09. datiert; ihr ursprünglicher 05.09. stellt die
zeitliche Reihenfolge wieder her. Varianten übernehmen das Entwurfsdatum ihrer Sammlung.

## Journal verschlanken und große Inhalte separat speichern (12.09.2026)

Kapitel: core, run-modules, overview. Ronald möchte eine stärkere Dateisystemablage und weniger
überflüssigen Journalinhalt. Dateiformat 4 hält gemeinsame Metadaten einmal pro Command und
lagert große Payload-Felder als unveränderliche, geprüfte JSON-Dateien im jeweiligen Run aus.
Eine Abo-Zustellung speichert nur ihre Quelle; beim Fork entsteht ihr Inhalt aus den neu
zugeordneten Events. Actor- und Plugin-Zustände verwenden kleinere Feldänderungen, sodass
beispielsweise Statuswechsel von Mini-App-Aufrufen bisherige Ergebnisse nicht erneut kopieren.
Das Journal prüft neue Events auf einer isolierten aktuellen Projektion statt die komplette
Historie vor jedem Append erneut abzuspielen. Öffentliche Ereignisse und Zustandsansichten
bleiben aufgelöst; Commit-Grenzen und Idempotenz bleiben erhalten. Ein fehlgeschlagener
Journal-Append sperrt weitere Schreibversuche bis zum erneuten Öffnen, damit eventuell bereits
geschriebene Bytes keine doppelten Commands verursachen. Archivierung und Forks
umfassen die Inhaltsdateien. Es gibt keine Migration bestehender Entwicklungsjournale.

## Eine dauerhafte rechte Bühne für die Kernfunktionen verwenden (12.09.2026)

Kapitel: overview. Die bisherige Fixierung fiel bei reduzierter Bewegung, niedrigen Fenstern
oder fehlendem moveBefore aus. Dadurch erschienen die Diagramme wieder untereinander.
Alle Darstellungen liegen jetzt dauerhaft in einem gemeinsamen Rahmen; CSS hält ihn rechts
fest, ScrollTrigger wechselt nur seinen Inhalt. Die mobile Reihenfolge entsteht ebenfalls per
CSS, ohne die Mini-App umzuhängen. So bleiben Rahmen und Eingaben auch beim Größenwechsel erhalten.
Die bisherigen Kästenschemata erklärten den Nutzen zu wenig. Die drei neuen Darstellungen
zeigen deshalb nachvollziehbare Referenzabläufe samt Ergebnis: aus einem Run-Script wird eine
gemeinsame Liste, aus parallelen Helfern eine Ideensammlung, aus festen Übergaben ein nach zwölf
Beiträgen beendetes Wortspiel. Schematische Antworten sind entsprechend gekennzeichnet.

## Quassel-Eingabe auch auf LLM-Karten verwenden (12.09.2026)

Kapitel: plugins. LLM-Actors lassen sich direkt auf ihrer Canvas-Karte anschreiben. Karte
und Inspector teilen die Quassel-Eingabe samt Anhängen, Fehlerbehandlung und Detailgradwahl.
Das vermeidet eine zweite Implementierung derselben Bedienung. Die vorhandenen Run-Schreibrechte
und der Actor-Lebenszyklus bestimmen, ob gesendet werden darf; Modell- und Denktiefenauswahl
werden dort nicht angeboten. Karten verwenden jetzt denselben gewählten Detailgrad wie der
Inspector, damit die Einstellung auch direkt am Gespräch wirkt. Standard- und Mindesthöhe
der LLM-Karten steigen auf 260 Pixel, weil bei 182 Pixeln neben der dauerhaft sichtbaren
Eingabe nur noch eine Chatzeile lesbar war.

## Vergrößerte Mini-Apps nur über dem Canvas öffnen (12.09.2026)

Kapitel: plugins, run-modules. Der Mini-App-Dialog belegt nur die Arbeitsfläche und lässt das
rechte Panel sowie Kopf- und Statusleiste bedienbar. Der vorhandene Modal-Host erhält dafür
den Bereich `canvas`; Rand, Schatten, weichgezeichneter Hintergrund und Titel machen die
vergrößerte Ansicht als Dialog erkennbar. Die Mini-App selbst bleibt dieselbe Oberfläche.

## Auf dem Canvas mit Pfeiltasten zum nächsten Element navigieren (12.09.2026)

Kapitel: plugins. Die Pfeiltasten zentrieren das räumlich nächste sichtbare Element in der
gewählten Richtung. So lässt sich der Canvas bei gleichbleibendem Zoom gezielt per Tastatur
erkunden, ohne die Inspector-Auswahl oder App-Aktionen auszulösen. Die weiche Bewegung dauert
300 Millisekunden; Gedrückthalten setzt sie ohne aufgestaute Wiederholungen fort. Fokus in
Bedienelementen und die Zielwahl der Canvas-Übersicht behalten ihre eigene Bedienung. Andere
Kameragesten übernehmen sofort, reduzierte Bewegung schaltet die Animation ab.

## Setups als Einstieg und Mini-Apps direkt zeigen (12.09.2026)

Kapitel: overview. Programmierbare Setups waren zwischen Ereignissen und Journal zu wenig
sichtbar. Sie eröffnen jetzt die Kernfunktionen; anklickbare Sticker stellen schon im Einstieg
die fünf zentralen Fähigkeiten heraus. Die Mini-App-Erklärung zeigt auf Ronalds Wunsch die
bedienbare gemeinsame Liste statt eines weiteren technischen Schemas. Deren Originaloberfläche
und Listenfunktion laufen für die Homepage lokal im Browser. Scrollen ergänzt Beispielnotizen,
bis der Benutzer selbst eingreift. Beim Wechsel der Darstellung bleibt seine Eingabe erhalten.
Die lokale Demo wird zusammen mit der Homepage gebaut und in der Hilfe ausgeliefert.
Ronalds Feinschliff entfernt den dekorativen Klebestreifen am Setup-Sticker. Zusätzlicher Abstand
und ein auslaufender Hintergrund vermeiden die harte untere Kante bei gleicher Elementplatzierung.

## Großbuchstaben in Mini-App-Funktionsaufrufen zulassen (12.09.2026)

Kapitel: run-modules. Der Actor-Vertrag erlaubte `addEntry`, die Mini-App-Aufrufroute dagegen
nur kleingeschriebene Namen. Ein Klick wurde dadurch vor der Funktionsausführung mit 404
abgewiesen. Die Route akzeptiert jetzt dieselben Namen wie der direkte Actor-Funktionsaufruf;
ein HTTP-Regressionstest prüft den vollständigen Weg bis zum gespeicherten Ergebnis.

## Bestehende Mini-Apps tatsächlich an die gemeinsame UI binden (12.09.2026)

Kapitel: run-modules. Die Umstellung der Vorlagen änderte bestehende Programmpakete nicht.
Die gezeigte Notizliste verwendete weiterhin eigene blaue HTML-Buttons und Feldregeln statt
der gemeinsamen UI. Ihre vorhandene Oberfläche wird auf den gemeinsamen Button und die
Feldklasse umgestellt. Die Autorenanleitung verlangt diese Bindung für Standardcontrols
ausdrücklich, damit zentrale Stiländerungen beim Laden auch bestehende Apps erreichen.

## Funktionen direkt im Detailpanel aufrufen (12.09.2026)

Kapitel: run-modules. Die Funktionsdetails erhalten ein generisches Eingabeformular samt
Aufrufstatus, Rückgabewert und Fehleranzeige. Damit lassen sich installierte Funktionen auch
ohne eigene Mini-App direkt bedienen. Detailpanel und Werkzeugkarten teilen den Formularbaustein;
der bestehende Funktionsvertrag und Host bestimmen Eingaben, Aufruf und Bestätigungen.
Ein zusätzlicher Modell-Turn ist dafür nicht nötig.

## Entwurfssammlungen statt einzelner Varianten auflisten, neueste zuerst (12.09.2026)

Kapitel: overview. Die gewachsene Entwurfsübersicht zeigt oben und im Kartenraster nur noch
einen Eintrag je Entwurfsseite. Deren eigenes Menü erschließt die einzelnen Varianten; die
doppelten Einträge entfielen auf Ronalds Wunsch. Bisherige Variantenlinks bleiben erreichbar.
Tabs und Karten stehen nach Datum absteigend, innerhalb desselben Tages in der gepflegten
Reihenfolge. So sind neue Sammlungen vor den älteren erreichbar.
Das Raster erhält eine explizite verfügbare Breite und schrumpfbare Spalten und Karten;
seine bisherige Mindestbreite führte zu horizontalem Überlauf. Die neuesten Sammlungen stehen
oben links, und beim Öffnen der Übersicht kehrt die Tab-Leiste an ihren linken Anfang zurück.

## Signal bis in die Mini-App-Vorlagen durchziehen (12.09.2026)

Kapitel: run-modules. Die gemeinsamen Controls verwendeten bereits Signal, die Vorlagen für
Textanalyse und gemeinsame Liste sowie das Sammelboard aber noch eigene blaue Buttons,
große runde Felder und feste helle Farben. Sie verwenden jetzt die gemeinsamen Controls und
Theme-Tokens. Die Chat-Eingabe erhält ebenfalls die Signal-Kontur. So kommt der gewählte
Entwurf auch in den mitgelieferten Mini-Apps an. Vorhandene Run-Quellen werden nicht umgeschrieben.

## Actor-Oberflächen für Benutzer Mini-Apps nennen (12.09.2026)

Kapitel: overview, run-modules, plugins. Ronald möchte die Bezeichnung Mini-App für die
Oberflächen eines Actors. Homepage, Grafiken, Navigation, Referenzen, Beispiele und sichtbare
App-Bezeichnungen verwenden deshalb Mini-App beziehungsweise Mini-Apps. Die technischen
View-Verträge und bestehenden Kennungen bleiben erhalten.

## Den globalen Koordinator am Standort der abgesendeten Frage orientieren (11.09.2026)

Kapitel: core, plugins. Eine Frage wie "Was macht dieser Actor?" braucht den Bezug zur Auswahl
in der Oberfläche. Der Browser sendet deshalb mit jeder globalen Nachricht einen kompakten
UI-Standort; der Server ergänzt die vorhandenen Run-Referenzen und Namen. Nutzertext und
Orientierung bleiben getrennt. Plugin-Journalzustand, Input-Quellereignisse und dynamischer
Systemprompt binden den Schnappschuss an genau diese Eingabe, damit Warteschlangen und spätere
Run-Wechsel ihn nicht verschieben. Fehlende Angaben bedeuten ausdrücklich keinen aktuellen
Standort. Die Orientierung bleibt klein und erteilt weder Aufträge noch Berechtigungen.

## Persönliches Canvas-Layout je Run erhalten (11.09.2026)

Kapitel: plugins. Beim erneuten Öffnen eines Runs gingen der Bildausschnitt und manuell
angepasste Elementgrößen verloren. Der Browser speichert deshalb Panning, Zoom, Karten- und
App-Größen samt Kompakt- und Einklappwahl pro Run im Local Storage. Die temporäre Übersicht
bleibt davon ausgenommen; eine gespeicherte Kamera verhindert den erneuten initialen Fit.
Kamerabewegungen werden gebündelt gespeichert und beim Verlassen abschließend geschrieben.

## Signal für kompakte Mini-App-Controls (11.09.2026)

Kapitel: plugins, run-modules, overview. Ronald wählt Signal aus den Control-Entwürfen. Die bestehenden
Mini-App-Controls erhalten deshalb kräftige Konturen, asymmetrische Ecken und gelbe
Hauptaktionen. Die Trennung von der Aquaglass-Hülle bleibt erhalten. 28 Pixel Standardhöhe,
kompaktere Formulare und Tabellen sowie eigene helle und dunkle Controlfarben setzen die
gewählte Richtung um. Gemeinsame React-Bausteine und Bedienverträge bleiben bestehen;
die öffentliche Bausteindemo zeigt dieselbe Implementierung.

## Pro Arbeitsbereichsreiter nur einen Hinweispunkt anzeigen (11.09.2026)

Kapitel: plugins. Der Hinweis auf neue Inhalte und das Inhaltsbadge erschienen gleichzeitig
als zwei Punkte neben demselben Symbol. Der gemeinsame Host zeigt jetzt bei neuen Inhalten
nur deren Hinweispunkt, ansonsten das Badge des Plugins. So bleibt jeder Reiter bei maximal
einem Punkt.

## Auswahlmenüs freistellen und Eingaben sofort zum Weiterschreiben leeren (11.09.2026)

Kapitel: plugins, run-modules. Auswahlmenüs wurden von begrenzten Composer-Flächen
abgeschnitten. Das gemeinsame SelectMenu verwendet deshalb den nativen Popover-Toplayer und
passt seine Position an den verfügbaren Platz an; DOM-Zugehörigkeit und Dialogkontext bleiben
erhalten. Die Chat-Eingabe leert einen gültigen Auftrag nun sofort beim Absenden. Bei Fehlern
kehrt der Auftrag automatisch zurück, solange kein neuer Text geschrieben wurde; andernfalls
bleibt er separat zum bewussten Einfügen verfügbar. So bleiben sowohl der neue Entwurf als
auch der fehlgeschlagene Auftrag samt Anhängen erhalten.

## Canvas-Licht und runde Dialogaktionen deutlicher gestalten (11.09.2026)

Kapitel: plugins, run-modules, overview. Der Aquaglass-Canvas erhält eine zusammenhängende
Lichtfläche ohne Punktraster, mit deutlicherem Mint, Eisblau und hellem Zentrum. Leichte
Hintergrundunschärfe und kleine Lichtkanten an den Statusicons verstärken die Glaswirkung.
Die bestehende runde IconButton-Variante erhält eine sichtbare Fläche und wird für Schließen
und Zurück durchgängig verwendet. So sind diese Aktionen in Dialogen und mobilen Details
klar erkennbar; ihre Namen, Tooltips und Bedienverträge bleiben erhalten. Das Homepage-Schema
übernimmt die Lichtfläche.
Der Mini-App-Titel in der Kopfzeile verwendet durchgehend Schriftgewicht 700. Der Wechsel von
550 auf 700 beim Öffnen der Vollansicht hatte seine Breite verändert und Nachbareinträge
verschoben; eine zusätzliche feste Breite ist dafür nicht nötig.

## Alle UI-Entwürfe in derselben Tabübersicht sammeln (11.09.2026)

Kapitel: overview. Ronald möchte bisherige und künftige UI-Drafts dauerhaft in der bestehenden
Übersicht wiederfinden. Die Regel steht ausdrücklich in der Projekt-AGENTS.md und in den
globalen Codex-Arbeitsanweisungen: neue Tabs ergänzen, vorhandene erhalten und fehlende ältere
Entwürfe nachtragen. Team-Raster, Gesprächsrunde und Synth-Oberflächen sind jetzt ebenfalls
in docs/ui-drafts/index.html eingetragen.

## Vorschauaktionen sichtbar am unteren Rand halten (11.09.2026)

Kapitel: plugins, run-modules. Bei langen Vorlagen scrollte die gesamte rechte Detailfläche
mitsamt "In Auftrag übernehmen". Der gemeinsame ListDetail-Baustein füllt jetzt die verfügbare
Höhe und scrollt nur seinen mittleren Inhalt; Kopf und Aktionsbereich bleiben stehen. Die
Startfläche begrenzt Liste und Vorschau auf den verfügbaren Platz, statt den ganzen Dialog
zu scrollen. So bleibt die Übernahme auch bei langen Prompts und in der mobilen Detailansicht
unmittelbar erreichbar.

## Promptauswahl von der Startbereitschaft trennen (11.09.2026)

Kapitel: plugins. Die Startauswahl hatte ihre Listenzeilen mit derselben Sperre wie die
Run-Erstellung deaktiviert. Dadurch waren Promptkarten bei ausstehender Chatverbindung oder
Modellabfrage nicht anklickbar. Auswahl, Vorschau, Prompt-Übernahme und Texteingabe bleiben
jetzt lokal bedienbar; nur ausführende Aktionen warten weiter auf ihre Voraussetzungen.
Die Browserprüfung mit bestehendem Run und geöffnetem globalem Chat zeigte zusätzlich einen
Stau durch die parallelen Liveverbindungen. Während des Startdialogs pausiert deshalb der
Stream der verdeckten Run-Liste samt periodischer Abfrage; danach wird die Liste sofort neu
geladen und wieder abonniert. Bestehender Run und Entwurf behalten ihre Livebeobachtung.
Der Entwurf öffnet außerdem keinen redundanten Chat-Stream mehr. Sein Run-Stream erkennt
weiterhin den tatsächlichen Start; Texte und Startoptionen benötigen nur ihre HTTP-Anfragen.

## Aquaglass als gemeinsamen Oberflächenstil übernehmen (11.09.2026)

Kapitel: plugins, run-modules, overview. Ronald wählt nach den Canvas-Entwürfen Aquaglass:
plastische, durchscheinende grünblaue Flächen mit hellen Kanten und kleinen Eckradien.
Gerade Karten behalten ihre klare Ausrichtung; TypeScript-Actors verwenden dafür denselben
rechteckigen CSS-Aufbau statt des SVG-Umrisses mit abgeschnittenen Ecken. Gemeinsame Tokens
verbinden Host, Canvas und Actor-View-Controls. Hell, Dunkel und System bleiben die vorhandene
Darstellungswahl; eine zusätzliche Stilauswahl ist nicht nötig. Das Homepage-Schema folgt der
neuen Gestaltung. Die alte Textanalyse-Aufnahme wird bis zu einem neuen echten core-Lauf
entfernt, damit die öffentliche Seite keine überholte Oberfläche zeigt.

Für die Mini-App-Controls wählt Ronald anschließend Variante B, Fluss, aus dem Control-Entwurf.
Offene Eingabefelder und weichere Schaltflächen übernehmen die Aquaglass-Farben. Der Stil gilt
über einen Marker nur innerhalb der Mini-Apps und ihrer Referenzdemos; die gemeinsame
React-Implementierung und ihre Props bleiben erhalten. So schließen sich die App-Inhalte an
den Canvas an, ohne die Bedienelemente des Hosts ebenfalls auf Fluss umzustellen.

## Startauswahl und Auftragsvorbereitung mit gemeinsamen Controls (11.09.2026)

Kapitel: plugins, run-modules. Ronald wählt Variante C aus den Offline-Entwürfen, weil die
bisherigen Karten kaum unterscheidbar waren. Eine gruppierte Liste mit Vorschau nutzt deshalb
den neuen gemeinsamen `ListDetail`-Baustein, auch für Actor-Views und den öffentlichen Katalog.
Die originale Quassel-Eingabe verwendet dieselbe begrenzte Breite wie der Chat. Eine Promptkarte
führt in einen zweiten Modalschritt: Der Benutzer arbeitet den Auftrag dort mit der KI aus
und startet den Run getrennt. Der Vorbereitungsaufruf nutzt dieselbe Modellwahl, erzeugt aber
keinen Run und kein Arbeitsverzeichnis. So bleibt Besprechen eine ausdrückliche Vorstufe zur
Ausführung. Laufende Modelländerungen sperren die Sendeaktionen bis zum gespeicherten Stand.

## Automatische Überschriften getrennt konfigurieren und zeitnah anzeigen (11.09.2026)

Kapitel: profiles, plugins, core. Ronald möchte ein kleines aktuelles Gemma für Listenüberschriften.
Die Vorgabe ist deshalb Gemma 4 A4B (`google/gemma-4-26b-a4b-it`). Der bestehende Host-Dienst
besitzt eine eigene gespeicherte Modellwahl, ausgeschaltetes Reasoning, kleine Ein- und
Ausgabebudgets und eine begrenzte Laufzeit ohne Client-Wiederholungen. Nach dem Speichern
meldet der Server den fertigen Titel an offene Run-Listen; bis dahin bleibt der Auftrag sichtbar.
Bereits gespeicherte und ausdrücklich gesetzte Titel bleiben erhalten. Die Auswahl erlaubt
weitere geeignete Modelle und das Abschalten, ohne Agentenmodelle zu verändern.

## Actors erreichbar halten, Canvas-Sichtbarkeit persönlich wählen (11.09.2026)

Kapitel: plugins, run-modules. Eine Mini-App erschien bisher zusätzlich zur Canvas-Karte ihres
Actors, obwohl die Oberfläche oft schon alle nötige Bedienung enthält. Die Actorliste in der
Statusleiste erschließt deshalb jeden Beteiligten unabhängig von seiner Karte. Actors mit
installierter View sind standardmäßig ausgeblendet; ihre Mini-Apps bleiben sichtbar. Das gilt
auch für LLM-Actors und verwendet die generische Verankerung der Canvas-Elemente.
Einzelsichtbarkeit und Verbindungen gehören zur persönlichen Browseransicht je Run, nicht zum
journalisierten Aufbau. So bleiben Auswahl und Inspector erreichbar, ohne die Arbeitsfläche
anderer Benutzer oder die Ausführung des Runs zu verändern.

## Vollansicht-Knopf als stabilen Kopfzeilenabschnitt anordnen (11.09.2026)

Kapitel: plugins. Der absolut zentrierte Iconbutton verlor beim Drücken durch den allgemeinen
Button-Transform seine Zentrierung. Dadurch wanderte seine Klickfläche unter dem Mauszeiger
weg. Die Vollansicht-Aktion verwendet nun wie der App-Name einen regulären Kopfzeilenabschnitt
über die gesamte Höhe. Eine kurze gestrichelte Trennlinie macht die getrennte Aktion sichtbar.

## Promptkarten nach einer freien Kategorie gruppieren (10.09.2026)

Kapitel: overview, plugins. Die ungeteilte Startliste machte kleine Apps zwischen technischen
Beispielen schwer auffindbar. Jede Promptkarte besitzt deshalb genau eine verpflichtende
Kategorie als freien Text; Loader, öffentlicher Vertrag und Oberfläche verwenden denselben Wert.
Die erste Karte bestimmt über die bestehende Reihenfolge auch die Position ihrer Gruppe.
Die Mini-Apps beginnen mit einer Begrüßung und einer Textanalyse. Zwei weitere Fälle zeigen
geteilten Zustand in mehreren Ansichten und automatisch gesammelte Antworten.
Titel und Beschreibungen benennen das sichtbare Ergebnis. Schlagworte bleiben für Suche,
Filter und Referenz erhalten, füllen aber nicht mehr jede einzelne Karte.

## Bearbeitbare Modelle vom technischen Inventar trennen (10.09.2026)

Kapitel: profiles, plugins. Einstellungen öffnen zuerst die tatsächlichen Modellformulare;
Darstellung, Erweiterungskatalog und Laufzeitinventar erhalten eigene Bereiche. Die
Produkt-Plugins speichern Modell und Denktiefe je vorhandenem Agentprofil atomar und prüfen
den vollständigen Entwurf vor dem Schreiben. Neue Actors und die Vorgaben noch nicht
begonnener Runs verwenden diese Auswahl. Bestehende Actors und ausdrücklich gewählte
Startwerte bleiben erhalten. Der globale Koordinator speichert seine erste Auswahl unabhängig
von den Produktvorgaben, damit spätere Änderungen auch nach einem Neustart getrennt bleiben.

## Referenzgenerierung mit gültigen Katalogmodellen komponieren (10.09.2026)

Kapitel: overview. Die Offline-Komposition der öffentlichen Referenz verwendete erfundene
Modellnamen, die die verbindliche Modellprüfung ablehnt und damit den Web-Build blockiert.
Generator und Referenztests verwenden deshalb vorhandene öffentliche Katalogmodelle.
Die Komposition bleibt isoliert und führt weder Netzaufrufe noch Modellläufe aus.

## Canvas-Abstand und stabile Maussteuerung, sichtbare Panelschatten (10.09.2026)

Kapitel: plugins. Kopfzeile und Statusleiste erhalten gerichtete Schatten; der kaum sichtbare
Panelschatten wird in beiden Themes verstärkt, damit sich die Bedienflächen vom Canvas abheben.
Die Kamera startet mit 32 Pixeln Abstand und richtet auch die erste vermessene Szene mit diesem
Rand aus. Die Weltkoordinaten bleiben unverändert. Beim Mounten übernimmt die Welt den aktuellen
Kamerastand. Run-Updates erneuerten bisher die Mausbindung über den Canvas-Context und lösten
dadurch Pointer Capture mitten beim Panning. Die Bindung liest die aktuelle Auswahlfunktion
nun unabhängig von ihrem Lebenszyklus; Nachrichten beenden keine laufende Mausgeste mehr.

## Denktiefen durchgängig aus dem jeweiligen Modell ableiten (10.09.2026)

Kapitel: core, profiles. Die Startauswahl bot GLM 5.3 Flash durch eine manuell gepflegte
Parallelkonfiguration `off` und `medium` an, obwohl die Laufzeit beide ablehnte. Gleichzeitig
fehlten gültige erweiterte Stufen wie `max` im RAgents-Vertrag. Produktkatalog, Auswahl und
Validierung verwenden deshalb die Modellfähigkeiten; Konfigurationslisten dürfen sie nur
bewusst einschränken. Der Server prüft alle Modelle und Profile vor der Nutzung. Auch geerbte
Denktiefen werden beim Spawn gegen das endgültige Modell geprüft. Die globale Host-Vorgabe
entfällt für Agenten ohne ausdrückliche Denktiefe; ihre Session verwendet eine modellgültige
Vorgabe. So gelangen Fehler nicht erst beim ersten Modellaufruf in den Chat.

## Funktionsschemata durch Scrollen schrittweise erklären (10.09.2026)

Kapitel: overview. Ronald möchte Animationen, die den Wert der Funktionen sichtbar machen.
Die Schemata zeigen deshalb konkrete Abläufe: Aufträge verteilen und Ergebnisse zurückgeben,
Programmschritte ausführen, gemeinsamen Zustand ändern, Ereignisse zustellen und ein Setup
aufbauen. Bewegte Nachrichten folgen den gezeichneten Verbindungen; Bearbeitungsbalken,
Programmzeilen und Listeneinträge zeigen die Zwischenstände. Auf der Arbeitsfläche werden
Auftrag, Bearbeitung und Ergebnis mit dem Journal verbunden.

Die GSAP-Timelines hängen direkt am Scrollfortschritt, einschließlich Rückwärtslauf und
Stillstand. Mobil verwenden die einzelnen Grafiken ihren eigenen Weg durch den Viewport.
Reduzierte Bewegung, Druck und fehlendes JavaScript zeigen das vollständige statische Schema.
MotionPathPlugin wird mit GSAP lokal gebündelt; externe Laufzeitressourcen sind unnötig.

## Prozesswechsel während der macOS-Markerabfrage begrenzt neu lesen (10.09.2026)

Kapitel: plugins. Zwischen dem Lesen der Befehlszeile und der Umgebung kann ein Prozess
enden oder seine Argumente ändern. Explizite `<defunct>`-Einträge werden als beendet
ausgelassen. Für lebende Prozesse vergleicht der Host die Befehlszeile vor und nach `ps -E`
und fragt nur geänderte PIDs erneut ab, höchstens dreimal. So unterbricht ein normaler
Prozesswechsel nicht den ganzen Scan; neue Argumente werden nicht als Umgebungsmarker
missverstanden. Dauerhaft instabile Prozesse und Zugriffs-, Werkzeug- oder Formatfehler
bleiben harte Fehler. Ein gescheiterter Scan speichert keine scheinbar fehlenden Marker.

## Dynamische Funktionen im laufenden Modellturn aktualisieren (10.09.2026)

Kapitel: core, plugins, run-modules. Nach der Aktivierung eines Actor-Programms behielt der laufende
LLM-Turn bisher seinen alten Werkzeugbestand. Neue Funktionen waren auch für `tool_open`
unbekannt und erzeugten unnötige Wiederholungen. TurnToolset und AgentSession lösen deshalb
den Bestand vor weiteren Aufrufen und zwischen Modellanfragen über dieselbe Registry neu
auf. Neue Schemata, geöffnete Namen und die Systemübersicht ändern sich gemeinsam; entfernte
Funktionen verschwinden sofort. Der normale native Werkzeugaufruf bleibt der einzige Weg.

## Relay mit der konfigurierten Koordinator-Denktiefe ausführen (10.09.2026)

Kapitel: profiles. Das Relay-Profil verwendet neben dem Koordinator-Modell auch dessen
konfigurierte Denktiefe. Das bisher fest eingetragene `off` verhinderte unter GLM 5.3 Flash
schon den ersten Modellaufruf. Die Einstellung bleibt ausdrücklich konfiguriert; es gibt
keinen automatischen Modellwechsel und keine Anpassung durch den Treiber.

## Actor-Programme vereinen Funktionen, Zustand und Views (10.09.2026)

Kapitel: overview, core, typescript-platform, run-modules, plugins, profiles. TypeScript- und
LLM-Actors besitzen denselben intrinsischen Zustand, aufrufbare Funktionen und optionale
React-Views. Bedienung und Agentenwerkzeuge rufen dieselbe Funktion am selben Actor auf;
nur eine gewöhnliche Nachricht an einen LLM-Actor braucht dessen Modell. Reine Views binden
an vorhandene Actors, ohne künstlichen App-Actor. Pro Actor bleibt genau ein Programmpaket.

`ragents.actor-programs` ersetzt die getrennten Mini-App- und Script-Werkzeug-Plugins sowie
den gesonderten Actor-Check/Test/Install-Weg. Normale Pakete, TypeBox, React, relative Imports,
feste lokale Abhängigkeiten und native Node-Ausführung über IPC bilden einen einzigen Weg.
Ergebnisse bleiben Ergebnisse; ausschließlich `context.state.replace` ändert Actor-Zustand.
Run-Scripts verwenden dieselben Pakete und Fachtests. Es gibt keinen Interpreter, keine
Migration und keine Kompatibilität mit den entfernten Werkzeugen oder Paketformen.

Der Modellablauf besteht aus Create, normalen Dateiänderungen und Activate. Automatische
Diagnostik-Deltas und gezielter Abruf vollständiger Befunde halten ihn kurz. Promptkarten,
Referenzpakete und die öffentliche Website zeigen die vier Fälle ohne Oberfläche, gemeinsame
Funktion mit View und Werkzeug, LLM-Actor mit View sowie Subscription-Input mit Zustand.
Redundante Karten entfallen; jedes dokumentierte Produktkonzept bleibt mehrfach vertreten.

Der echte Textanalyse-Lauf zeigt, dass passende Vorlagen zuerst gelesen und weiterverwendet
werden sollten. Die Kurzanleitung priorisiert deshalb vorhandenen Code und Fachtests; einzelne
UI-Verträge werden nur bei konkreten Unklarheiten geladen. Der Homepage-Abschnitt ergänzt die
Funktionsgrafik um die tatsächliche core-Vollansicht mit Zählergebnis und Actor-Aufrufzähler.

## Ereigniszustellung als Funktionsschema erklären (10.09.2026)

Kapitel: overview. Das Formular zur Subscription-Matrix verlangt Auswahl und Erklärung, bevor
die Funktion sichtbar wird. Ein kompaktes HTML-/SVG-Schema zeigt jetzt direkt den Weg vom
Agentenergebnis über passende Abonnements zu den nächsten Beteiligten. Der zugehörige
Dropdown-Code entfällt; das echte Referenzbeispiel bleibt verlinkt.

## Nutzen direkt unter den Funktionsüberschriften nennen (10.09.2026)

Kapitel: overview. Die Konzeptnamen bleiben als Hauptüberschriften erhalten. Statt nummerierter
Oberzeilen folgt darunter jeweils ein kurzer Schlagsatz, der den Nutzen der Funktion benennt.
So lassen sich Agenten, programmierte Abläufe, Mini-Apps, Ereignisse, Journal und Setups schon
beim Überfliegen einordnen; die vorhandene Erklärung schließt daran an.

## Scroll-Strecke an den eingebetteten Hilfe-Rahmen anpassen (10.09.2026)

Kapitel: overview. Die Homepage wurde korrekt mitgebaut, wirkte in der Hilfe bei üblichen
Notebookgrößen aber statisch: Ein Fenster mit 1366 mal 768 Pixeln lässt dem Hilfe-Iframe nur
1316 mal 718 Pixel, unterhalb der bisherigen Mindesthöhe von 740 Pixeln. Die Scroll-Strecke
beginnt deshalb jetzt bei 600 Pixeln Höhe und verkleinert ihre Grafiken in niedrigen Ansichten
proportional. Die Bildbeschriftung und Navigation behalten ihre Größe. Geprüft wird dieser
Fall direkt über das Fragezeichen der laufenden Anwendung, zusätzlich zur eigenständigen Seite.

## Promptkarten auf einen freien Auftrag vereinfachen (10.09.2026)

Kapitel: plugins, overview. Ronald möchte pro Promptkarte nur den bisherigen freien Auftrag.
Die technische Fassung und die Auswahl zwischen Technisch und Frei entfallen aus Karten,
Plugin-Vertrag, Einstellungen und öffentlicher Referenz. Ein Klick auf die Karte übernimmt
den Auftrag in die Eingabe. Die Kartendateien enthalten nach dem Kopf direkt den Prompt;
die freien Texte bleiben unverändert. So braucht derselbe Einstieg nur einen Inhalt und eine
Aktion.

## Mini-Apps und Run-Programme auf natives TypeScript umstellen (10.09.2026)

Kapitel: overview, core, typescript-platform, run-modules, plugins. Die bisherigen Mini-App-
Verträge, separaten Prüfaufrufe und eigenen Sprachregeln erzeugten lange Antworten und viele
Korrekturschleifen. Mini-Apps sind deshalb gewöhnliche private TypeScript-Pakete mit React-
Frontend, optionalem Backend und normalen Fachtests. Ein TypeBox-Vertrag liefert die Typen
und dieselbe Funktion für Browseraktion und Agentenwerkzeug. Feste lokal vorbereitete
Abhängigkeiten machen diese Projekte direkt für Dateiwerkzeuge und Language Server lesbar.

Die Agenten bearbeiten die Pakete über `@apps`, Bash über `RAGENTS_APPS_DIR`. Vor jeder
Modellanfrage prüft der Host geänderte Projekte und ergänzt einen kurzen Unterschied zum
letzten Fehlerstand. Vollständige Diagnosen sind gezielt abrufbar. `mini_app_activate` fasst
Typprüfung, Build, Fachtests und Aktivierung zusammen; gewöhnliche Erfolgsantworten bleiben
kurz. Das Modell überträgt keine Dateiinhalte oder Build-Hashes erneut.

Actors, Script-Werkzeuge und Mini-App-Backends verwenden dieselbe native Node-Ausführung mit
gebundenem Aufrufkontext über IPC. Der AST-Interpreter samt eigener Sprachuntermenge entfällt.
Host und Run-Workspace verwalten Prozessrechte, Abbruch und Lebenszyklus. Aufrufe derselben
App bleiben geordnet; verschiedene Apps können parallel arbeiten. Zustandsänderungen gelangen
auch bei ruhendem Chat in die vorhandene React-Anbindung und erhalten lokale Eingabeentwürfe.
Es gibt keine Kompatibilitätsschicht oder Migration alter App- und Scriptstände; Ronald hat
die vorhandenen Läufe ausdrücklich löschen lassen. Das umgesetzte TypeScript-Konzept entfällt.

## Homepage mit GSAP ScrollTrigger auf die Kernfunktionen konzentrieren (10.09.2026)

Kapitel: overview. Ronald möchte eine bewegtere Homepage, auf der die wichtigsten Funktionen
früher sichtbar werden. Eine Textstrecke mit rechts fixierter, wechselnder Grafik ersetzt die
bisherige vollflächige Bühne und die anschließende doppelte Erklärung von Agenten, TypeScript
und Mini-Apps. Der kürzere Einstieg führt direkt dorthin; die Oberfläche und vertiefende
Funktionen folgen im normalen Seitenfluss. Die vorhandenen HTML-/SVG-Schemata zeigen die
Zusammenhänge ohne neue Bildressourcen. GSAP und ScrollTrigger werden als festgelegte lokale
Paketversion gebündelt, damit auch der statische Export ohne CDN funktioniert. Kleine Ansichten,
reduzierte Bewegung und Druck ordnen die Grafiken ihren Texten zu; Details bleiben aufklappbar.

## Dialogfähigkeit der Mini-Apps entfernen (10.09.2026)

Kapitel: overview, typescript-platform, run-modules, plugins. Ronald will Mini-Apps als kleine
Anwendungen auf dem Canvas. Die zusätzliche journalisierte Dialogansicht brachte eigene
Capabilities, Platzierungen, Tests und Bedienzustände für dieselbe Oberfläche mit. Diese
Fähigkeit entfällt vollständig samt API, Vorlage und Promptanweisungen. Die vom Benutzer
bediente lokale Vollansicht bleibt beim Host. Die Hallo-Welt- und Freigabelisten-Beispiele
verwenden den Canvas; der statische Hallo-Welt-Fall benötigt keine eigene Serveraktion.

## Vollansicht-Symbol in den App-Eintrag integrieren (10.09.2026)

Kapitel: plugins. Die innere Trennlinie ließ den Vollansicht-Knopf wie einen eigenen
Kopfzeilenabschnitt wirken. Name und Symbol stehen jetzt enger zusammen auf einer gemeinsamen
Hover- und Fokusfläche. Der Vergrößern-Knopf sitzt als kleiner vorhandener Ghost-Iconbutton
innerhalb der durchgehenden App-Fläche; er belegt keinen eigenen Abschnitt über die ganze
Leistenhöhe. Die beiden Aktionen bleiben unabhängig bedienbar.

## Statusleiste abgrenzen und Panelschatten erhalten (09.09.2026)

Kapitel: plugins. Eine feine obere Trennlinie macht die 28 Pixel hohe Statusleiste erkennbar.
Ihr Hintergrund liegt unter dem Schatten des darüber endenden rechten Panels, damit die
Schattenkante nicht abgeschnitten wird. Statusgruppen und Journal bleiben über dem
Arbeitsinhalt bedienbar; die Aufteilung der Fläche bleibt unverändert.

## Flache Kopfzeilenelemente wiederherstellen (09.09.2026)

Kapitel: plugins. Die gewölbten Flächen gefallen in der Anwendung nicht. Die Kopfzeile verwendet
wieder den vorherigen flachen Stil; Glanzverlauf und zusätzliche Innenkanten der Segmente sowie
das ergänzte Innenrelief der globalen Texteingabe entfallen.

## Kartenchat ohne Zeitspalte und mit Schritt-Symbolen (09.09.2026)

Kapitel: plugins. Zeitangaben und ausgeschriebene Werkzeugnamen nahmen im kleinen
Inline-Verlauf der Agentenkarten zu viel Platz ein. Der gemeinsame ActorChat unterscheidet
jetzt ausdrücklich Canvas und Inspector: Auf der Karte entfallen Zeitstempel, sichtbare
Werkzeug- und Denkschritte verwenden die vorhandene Symbolstufe mit aufrufbaren Details.
Ausgeblendete Schritte bleiben verborgen. Der Inspector behält Zeitstempel und den gewählten
Detailgrad; Nachrichtenprojektion und Scrollverhalten bleiben gemeinsam.

## Canvas-Übersicht mit direkter Zielnavigation (09.09.2026)

Kapitel: plugins. Große Arbeitsflächen brauchen einen schnellen Weg vom Gesamtbild zu einer
einzelnen Karte oder App. Ein zweiter quadratischer Knopf zwischen Run-Übersicht und globalem
Koordinator passt deshalb alle sichtbaren Elemente in die Canvas-Fläche ein und aktiviert
eine Zielwahl. Hover und Tastaturfokus markieren das Ziel; dessen Aktivierung zentriert es
bei genau 100 Prozent, ohne die bisherige Auswahl oder App-Inhalte zu verändern. Escape oder
der erneute Knopfdruck stellt die vorherige Kamera wieder her. Der vorhandene Statusknopf
`Einpassen` behält seine Zentrierung bei 100 Prozent.

## Mini-App-Inhalte auf dem Canvas verkleinern (09.09.2026)

Kapitel: run-modules. Kleinere App-Fenster allein ließen die enthaltenen Schriften und
Steuerelemente zu groß gegenüber der restlichen Oberfläche erscheinen. Der Canvas-Host
stellt deshalb den gesamten Frame-Inhalt mit 80 Prozent und entsprechend größerem inneren
Viewport dar. Das greift auch für installierte Apps mit fest definierten Pixelgrößen;
ein neuer App-Build ist dafür nicht erforderlich. Vollansicht und App-Dialog behalten ihre
Originalgröße, die Fensterbedienung folgt weiterhin den gemeinsamen Host-Größen.

## Dialogbereiche, Kurzantworten und Kopfzeilenbedienung präzisieren (09.09.2026)

Kapitel: plugins, core, run-modules. Drei reguläre Dialogbereiche machen die Abdeckung
ausdrücklich: `page` umfasst die gesamte Anwendung, `run` den Inhalt ohne beide Leisten und
`workspace` alles unter der Kopfzeile einschließlich Statusleiste. Die Run-Übersicht verwendet
Workspace; gezielte lokale Container bleiben etwa für die Koordinator-Resetbestätigung möglich.
Auch vergrößerte Mini-Apps nutzen Workspace ohne zusätzliche Hosttitel- und Statuszeilen.
Eine zentrale Vollansicht verbindet Canvas und getrennten Vergrößern-Knopf in der Kopfzeile;
die aktive App bleibt dort erkennbar und lässt sich direkt wechseln.

Kurzantworten enthalten die Nutzerfrage und das Ergebnis jeweils knapp, damit ein Hinweis
auch außerhalb des Verlaufs zugeordnet werden kann. Die gesamte Fläche öffnet das Gespräch,
nur das X verwirft den Hinweis. Der Toolvertrag verlangt beide Texte ohne stille Ergänzung.
Der aktive Run-Titel benötigt keine zusätzliche RUN-Beschriftung und steht mittig sowie
linksbündig. Tooltips erscheinen zunächst nach 50 Millisekunden und wechseln danach sofort;
110 Millisekunden beim Verlassen überbrücken die Knopfabstände.
Der gemeinsame Arbeitsrahmen pulsiert deutlicher und beginnt am globalen Eingabefeld bereits
während der Sendeanfrage, bevor der Server seine laufende Arbeit meldet.
Eine leichte Wölbung der linken Kopfzeilensegmente macht deren Grenzen deutlicher; die
gemeinsamen Flächen- und Kantentokens lassen Einstellungen und Hilfe in ihrer Ghost-Darstellung.

## Journal und Koordinator mit gemeinsamer Popout-Fläche (09.09.2026)

Kapitel: plugins. Journal und globaler Koordinator-Verlauf verwenden dieselbe Kontur,
Panel- und Textfarbe sowie denselben Schlagschatten. Die gemeinsame Klasse `ui-popout-surface`
ersetzt die lokalen Kopien, damit beide Flächen auch bei Änderungen gleich gestaltet bleiben.
Öffnungsrichtung und Eckform gehören weiterhin zur jeweiligen Ansicht.

## Werkzeugübersicht und technische Detailreferenz trennen (09.09.2026)

Kapitel: plugins, core, run-modules, typescript-platform. Dieselben Werkzeugbeschreibungen
standen im Systemkontext und erneut am Öffnungswerkzeug; nachgeladene Anleitungen konnten später
nochmals im Systemprompt erscheinen. Der Systemkontext enthält deshalb die einzige Übersicht.
Normales Öffnen bestätigt Namen und Ergebnisverträge; die nativen Eingabeschemata werden dabei
nicht als Antworttext wiederholt. Eine ausdrückliche Detailabfrage liefert die vollständigen
Verträge und Anleitungen auch nach früherer Öffnung und für Worker.

Promptbeiträge trennen kurze Initialhinweise von Anleitungen auf Anfrage. Die Script- und
Handler-Referenzen werden beim Lesen aus dem aktuellen Werkzeugbestand des Actors erzeugt.
Mini-App-Manifest, Client- und Handler-API verwenden dieselben Quellen wie Validator und Compiler;
redaktionell bleiben Arbeitsweise und Empfehlungen. Die verbleibenden Fragen zu Appbestand,
Driver-Werkzeugen, Profilregeln und Skills bleiben im gekürzten Konzept `prompt-context.md`.

## Statusleiste, Kopfzeilenhinweise und Koordinatorzustände zusammenführen (09.09.2026)

Kapitel: plugins, core. Die schwebende Canvas-Zoomgruppe zieht in eine halbhohe Statusleiste
über die gesamte Anwendungsbreite. Ein eigener Journalbeitrag öffnet die tatsächlichen
Run-Ereignisse nach oben. Der Host stellt dafür geordnete Statusgruppen bereit; der Canvas
verwendet denselben Bereich. Die Journalansicht lädt nur geöffnet und folgt vorhandenen
Run-Änderungen, statt einen weiteren Pollingzyklus einzuführen.

Reiter- und Panelknopfhinweise erscheinen nach 150 Millisekunden beziehungsweise sofort bei
Tastaturfokus unter der Kopfzeile. Der Panelknopf verwendet dieselbe große Ghost-Darstellung
wie Einstellungen und Hilfe. Die gemeinsame Hinweisfläche gestaltet auch Kurzantworten, die
nun bei offenem oder geschlossenem globalem Chat automatisch erscheinen. Der zusätzliche
Ungelesen-Hinweis und dessen Lesecursor entfallen. Laufende Arbeit pulsiert am Eingaberahmen
mit derselben Animation wie Canvas-Agenten. Die Resetbestätigung liegt als hervorgehobener
Dialog über dem gesamten globalen Chat und beginnt mit dem Fokus auf Abbrechen.

## Starteingabe kompakter und globalen Verlauf direkt öffnen (09.09.2026)

Kapitel: plugins. Intro und Abschnittsüberschriften beanspruchten im Startdialog Platz vor
den Eingaben. Die Auftragseingabe beginnt jetzt mit drei statt sechs Zeilen und wächst bis
acht; engere Abstände halten Promptkarten und vorbereitete Abläufe näher zusammen. Modell
und Denktiefe stehen als Auswahlmenüs in derselben Eingabeleiste wie Anhänge und Detailgrad.
Der vorhandene Startoptionsvertrag bestimmt dafür die Platzierung in Composer oder Startfläche.

Beim globalen Koordinator öffnet das Textfeld seinen Verlauf direkt. Der zusätzliche
Dropdown-Pfeil entfällt. Auch mit reinem Lesezugriff bleibt die schreibgeschützte Eingabe
fokussierbar, während Sendefunktionen und andere Schreibaktionen gesperrt bleiben.

## Einstellungen als seitenweiter Dialog (09.09.2026)

Kapitel: plugins. Die Einstellungen betreffen die gesamte Anwendung. Ihr Modal verwendet
explizit den Seitenbereich, damit auch die Titelleiste hinter dem Dialog liegt und gesperrt
ist. Die gemeinsame Modal-Komponente übernimmt Fokusführung und Rückgabe an den Öffnungsknopf.

## Werkzeugrechte in der Einstellungsantwort akzeptieren (09.09.2026)

Kapitel: plugins. Die Werkzeugbeschreibungen des Servers enthalten inzwischen optional
`requiredCapabilities`. Die exakte Feldprüfung im Browser kannte diese Angabe nicht und
verwarf deshalb die gesamte Einstellungsantwort. Der Clientvertrag akzeptiert und prüft die
Liste jetzt ausdrücklich; die übrige Formatprüfung bleibt erhalten. Ein Regressionstest
verwendet die tatsächlichen Engine-Werkzeugbeschreibungen und prüft auch ungültige Angaben.

## Studio als gemeinsame Gestaltung mit wählbarem Farbschema (09.09.2026)

Kapitel: plugins, run-modules. Ronald hat Studio aus der Gestaltungsstudie als Grundlage
gewählt. Feine Konturen, ruhige Flächen, ein Punktraster und getönte Statusfelder ersetzen
die kräftigen Kartensymbole und Farbwaschungen. Semantische Tokens bündeln auch Konturen,
Statusflächen und Schatten, damit Themes an einer Stelle gepflegt werden können.

Die Auswahl Hell, Dunkel oder System gehört zum Host und gilt lokal für den Browser.
Ein Theme-Wechsel färbt vorhandene Ansichten um, ohne Kamera, Gespräch oder Eingabe zu
ersetzen. Mini-Apps erhalten dieselbe aufgelöste Darstellung über ihren bestehenden Port;
ein neuer Frame würde lokale Eingaben verlieren. Ihr eigenes CSS behält seine Freiheit.
Die aktuelle Titelleisten- und Panelanordnung bleibt die Grundlage der Gestaltung.

## Homepage-Konzepte vor ihren Details erklären (09.09.2026)

Kapitel: overview. Die Homepage setzte Begriffe wie Koordinator, Kontext und Run voraus und
begann häufig mit Bedienungsregeln. Jeder Themenabschnitt führt sein Konzept jetzt in ein bis
vier Sätzen ein, die auch beim direkten Sprung aus der Navigation verständlich sind.
Überschriften benennen die Sache; technische Regeln und längere Bedienungsdetails folgen
eingeklappt oder über Referenzlinks. Auch Funktionsschemata, die beiden Lesebeispiele und die
generierten Referenzeinstiege verwenden zuerst Erklärungen statt vorausgesetzter Fachbegriffe.
Damit bleibt der Aufbau des Systems im Vordergrund, ohne die Einführung um einen weiteren
Glossar- oder Dokumentationsbereich zu verlängern.

## Kurze Koordinatorantwort direkt unter der Eingabe anzeigen (09.09.2026)

Kapitel: plugins, core. `quick_answer` gibt dem globalen Koordinator einen ausdrücklichen Weg
für eine kurze Antwort mit höchstens 240 Zeichen. Bei geschlossenem Verlauf steht sie als
Toast direkt unter der Toolbar-Eingabe. Ein Klick öffnet das Gespräch und setzt dort den Fokus, das X
entfernt nur den Toast. Das Erscheinen selbst verändert keinen Fokus und öffnet keinen Verlauf.
Die normale vollständige Antwort bleibt im Chat; die Kurzantwort folgt zusätzlich als
journalisierter Plugin-Zustand über den vorhandenen Extension-Stream. Journalposition und
Replay-Grenze verhindern alte oder doppelte Toasts. Der bestehende Schutz der gespeicherten
Werkzeugauswahl bleibt erhalten: Vorhandene globale Gespräche benötigen nach dem Neustart
einen ausdrücklichen Reset für das neue Werkzeug und seine Promptanweisung.

## Koordinator-Eingabe ohne zusätzliche Überschrift (09.09.2026)

Kapitel: plugins. Die Überschrift über der globalen Chateingabe verbrauchte eine zusätzliche
Zeile in der Titelleiste. "Globaler Koordinator" steht deshalb als Platzhalter im Feld;
Status und Öffnungsknopf stehen daneben. Anhang und Detailgrad teilen sich mit Modell, Reasoning
und Zurücksetzen eine Bedienzeile im Dropdown. Der Verlauf behält seinen zugänglichen Namen.

## Rechtes Panel mit der Titelleiste verbinden (09.09.2026)

Kapitel: plugins. Die zusätzliche Reiterzeile und die Außenabstände trennten den Arbeitsbereich
von der Titelleiste und verkleinerten seinen Inhalt. Reiter und Klappknopf stehen deshalb
zusammen mit Einstellungen und Hilfe in der gemeinsamen Kopfzeile. Deren rechter Abschnitt
folgt beim Vergrößern der Panelbreite. Der Inhalt schließt direkt darunter sowie am rechten und
unteren Fensterrand an; eine gerade linke Kante mit Schlagschatten trennt ihn vom Canvas.
Einklappen, gespeicherte Breite und Zustand besuchter Reiter bleiben erhalten. Bei Platzmangel
scrollen die Reitersymbole innerhalb der Leiste.

## Globalen Koordinator direkt in der Kopfzeile bedienen (09.09.2026)

Kapitel: plugins, core. Der globale Koordinator erhält eine dauerhafte Toolbar-Eingabe mit
darunterliegendem Verlauf. Dadurch ist ein Auftrag ohne Öffnen der Run-Übersicht erreichbar.
Der vorhandene Beitragsvertrag erhält eine Toolbar-Platzierung; der Host koordiniert Öffnen
und Schließen, das Plugin besitzt weiterhin Unterhaltung und Entwurf. Die Übersicht enthält
keinen zweiten Koordinator-Chat mehr; deren ungenutzter Breitenregler entfällt. Beide
Composer-Anordnungen verwenden dieselbe Eingabe- und Anhangslogik.

Nach der ersten Nutzung bleibt genau ein Stream für Antwortmeldungen verbunden. Eine
Leseposition im Browser-Tab quittiert neuen sichtbaren Antworttext erst im tatsächlich sichtbaren
Verlaufsende. Gesprächsidentität, Journalposition und Textoffset sowie eine ausdrückliche
Replay-Grenze machen Wiederverbindung und Reset unterscheidbar. Fokus, Run-Wechsel und
geschlossener Verlauf verlieren weder den Entwurf noch eine laufende Antwort. Das umgesetzte
Konzept wird entfernt; Bedienung, Homepage und Koordinator-Walkthroughs folgen dem neuen Zugang.
Ein Reset kann das Journal nach dem Stoppen entfernen, bevor der Scheduler seinen abschließenden
Scan erreicht. Dieser überspringt dann das entfernte Journal; neue Arbeit in einem später neu
angelegten Run derselben Kennung bleibt regulär planbar.
Beim Wechsel von der Run-Übersicht in die Toolbar-Eingabe erhält das schließende Modal den
absichtlich neuen Fokus, statt ihn zur Übersichtsecke zurückzusetzen.

## Dialogschritte im gemeinsamen Modal steuern (09.09.2026)

Kapitel: plugins. Folgedialoge sollen denselben Rahmen verwenden und ihren Rückweg vom Host
erhalten. Der typisierte Modal-Controller öffnet Schritte deshalb nach der Hostvorgabe `push`
oder `replace`. Bei `push` bleibt der vorherige Inhalt verborgen gemountet, bei `replace` wird
er verworfen. Fokusführung, Zurück und Schließen bleiben im gemeinsamen Modal; `onClose` des
Hosts wird auch bei verzögertem oder gesperrtem Schließen berücksichtigt.

Der Startdialog liegt unter den Session- und Plugin-Providern. Einrichtungsleitfäden von Skills
und Run-Scripts öffnen darin einen Folgeschritt. Zurück und Abbrechen erhalten Auftrag,
Anhänge, Filter und Scrollposition. Ein Abschluss kehrt zurück und startet den gewählten Ablauf
einmal; Fehler bleiben bei den vorbereiteten Abläufen sichtbar.

## Startdialog mit Auftrag links und vorbereiteten Abläufen rechts (09.09.2026)

Kapitel: plugins. Der Startdialog beginnt direkt mit der Startfläche, damit Titel und Untertitel
keinen zusätzlichen Platz vor der Auftragseingabe belegen. Der gemeinsame `Modal` behält den
zugänglichen Namen "Neue Unterhaltung", den seitenweiten Bereich und seine Fokusführung.
Ein überlagerter Schließen-Knopf rechts oben schließt ihn; auf der Startfläche schließen auch
Escape und Hintergrundklick.
Auf breiten Ansichten nehmen Auftragseingabe, Startoptionen und die darunterliegenden
Promptvorlagen zusammen die linken zwei Drittel ein. Vorbereitete Abläufe aus Skills und
Run-Scripts stehen rechts im übrigen Drittel; bei schmaler Darstellung folgen sie darunter.

## Kopfzeile mit vollen Flächen und ohne Werkzeugverknüpfungen (09.09.2026)

Kapitel: plugins, run-modules. Haupteinträge der Kopfzeile nutzen wie die Übersichtsecke die
volle Höhe und eine gemeinsame rechte Trennlinie. Kleine Artbeschriftungen und bis zu zwei
Titelzeilen ordnen Run, App, Aktivität, Prozess, Startoption, Branch und Benutzer zu. So werden
auch längere Namen in zusammenhängenden Flächen lesbar. Einstellungen und Hilfe behalten ihre
großen `ghost`-Iconbuttons; Prozess-Ports und Beenden bleiben kompakte Unteraktionen.

Die App-Auswahl zeigt sichtbar geschaltete Canvas-Apps und fokussiert weiterhin deren Fläche.
Installierte Werkzeugverknüpfungen entfallen aus der Kopfzeile; der Werkzeuge-Reiter bleibt
ihr Zugang. Die Anzeige laufender Werkzeugaufrufe behält ihre Auswahl und Zustellung bei.
Bei Platzmangel scrollt der fokussierbare mittlere Run-Bereich horizontal, statt eine zweite
Toolbarzeile zu bilden. Übersichtsecke, Einstellungen und Hilfe bleiben erreichbar. Der
Prozessdialog behält seine kompakte Listenansicht.

## Selbstarbeit und ausführbare Delegation klarstellen (09.09.2026)

Kapitel: plugins. Die Orchestrierungsanleitung stellte Rollen und mehrphasige Abläufe stark in
den Vordergrund und ordnete Experten und Kritikern pauschal keine Werkzeuge zu. Sie verlangt
jetzt standardmäßig Selbstarbeit und einen konkreten Nutzen oder Benutzerwunsch für zusätzliche
Actors. Mehrere Sprachen, Dateien oder Schritte genügen dafür allein nicht. Delegierte Phasen
erhalten den tatsächlichen Arbeitsauftrag und werden anhand ihres Ergebnisses geprüft.
Die nötigen Werkzeuge folgen dem Auftrag statt dem Rollennamen; ein reiner Textkontext reicht
nur für Aufgaben ohne Zugriff auf Dateien, Diagnosen oder andere Werkzeuge.

## Mini-App-Anleitung erst bei Bedarf laden (09.09.2026)

Kapitel: run-modules. Die Bindung der vollständigen Mini-App-Anleitung an das direkt verfügbare
Nachschlagewerkzeug vergrößerte auch den initialen Kontext fachfremder Aufträge. Eine kurze
Einführung beschreibt deshalb zunächst die Fähigkeit. Die vollständige Anleitung folgt beim
ausdrücklichen Abruf mit `mini_app_controls` und `topic: "guide"` aus der gerenderten Promptdatei.
Sie ist kein registrierter Systemprompt-Beitrag. Das anschließende Öffnen der Bauwerkzeuge mit
`tool_open` liefert deren Verträge und bettet die Anleitung nicht erneut ein. Damit dupliziert
die Folge aus Nachschlagen und Werkzeugöffnung den langen Text auch in späteren Turns nicht.
Der direkte Control-Katalog und die automatisch aus TypeScript gewonnenen Einzelverträge bleiben
erhalten; eine Control-Auswahl beim Abruf der Anleitung ist ein ausdrücklicher Eingabefehler.

## Eingabehilfen im Feld und kompaktere Controls (09.09.2026)

Kapitel: run-modules. Separate Beschreibungszeilen beanspruchten in Werkzeugkarten viel Höhe.
Text-, Zahl-, JSON- und Stringlisten-Eingaben zeigen die Parameterbeschreibung deshalb als
Platzhalter. Feldnamen und Pflichtmarkierung bleiben zur Orientierung sichtbar. Checkboxen
teilen sich mit ihrem Namen eine Zeile; ihre Beschreibung bleibt darunter.

Die gemeinsamen Formular-Controls verwenden kurze Eingabehilfen als Platzhalter und behalten
ausdrückliche Hinweise dauerhaft bei. Bearbeitbare Auswahlfelder zeigen Feldname und
Pflichtmarkierung direkt im Auswahlknopf, damit auch eine noch leere Auswahl erkennbar bleibt;
schreibgeschützte Werte behalten die separate Feldbeschriftung. Mehrzeilenfelder beginnen mit
zwei vergrößerbaren Zeilen. Weniger Innen- und Zeilenabstand in
Formularen, Datei- und Aufgabenlisten sowie Tabellen spart Platz, ohne die Schrift zu verkleinern.
Auch die Tabellensuche verwendet einen Platzhalter und eine zugängliche Beschriftung statt einer
zusätzlichen sichtbaren Labelzeile.
Die öffentlichen Demos und die Controls-Vorlage zeigen passende Eingabehilfen.

## Breitere Koordinatorspalte mit verstellbarer Aufteilung (09.09.2026)

Kapitel: plugins. Der Koordinator erhält standardmäßig 30 Prozent mehr Breite. Ein mittlerer
Größenanfasser erlaubt eine eigene Aufteilung zwischen Gespräch und Run-Liste und verwendet
dieselbe Griffgestaltung wie das rechte Arbeitsbereichspanel. Die Wahl bleibt lokal gespeichert;
responsives Stapeln verändert sie nicht. Tastaturbedienung und Abbruch der Ziehgeste erhalten
die Bedienbarkeit und verhindern unbeabsichtigt gespeicherte Zwischenstände.

## Getrennte Übersichtsflächen ohne gemeinsame Titelzeile (09.09.2026)

Kapitel: plugins. Koordinator und Run-Liste erhalten jeweils eine eigene Fläche über dem
unscharfen Dialoghintergrund. Die gemeinsame Hülle und ihre Übersichts-Titelzeile entfallen,
damit beide Bereiche für sich stehen. Der gemeinsame Run-Modal bleibt für Fokus, Escape und
Hintergrund zuständig; auch der freie Abstand zwischen den Flächen ist eine Schließfläche.
Der zugängliche Dialogname und die erhaltenen Gesprächsentwürfe bleiben bestehen.

## Übersicht, Arbeitsbereich und Inspector klar umschalten (09.09.2026)

Kapitel: plugins. Die Übersicht aus Koordinator und Runs verwendet den gemeinsamen Modal
mit Run-Scope, Abstand und Backdrop. Kopfzeile, Fokusführung und verschachtelte Dialoge folgen
damit derselben Technik wie andere Modale. Verborgene Beiträge bleiben gemountet.

Der rechte Arbeitsbereich wechselt zwischen aufgeklappt und vollständig eingeklappt statt
zwischen normal und maximiert. Die zuletzt gewählte Breite bleibt erhalten; ausdrückliche
Tab-Navigation öffnet ihn wieder. Im Actor-Inspector nutzt ein gewählter Detailreiter die ganze
Höhe. Chat und Composer bleiben dabei verborgen gemountet; der X-Reiter führt ohne Verlust des
Entwurfs zurück zum Gespräch.

## Startdialog bei langsamen Run-Antworten zuverlässig schließen (09.09.2026)

Kapitel: plugins. Häufige Live-Ereignisse konnten eine langsame Run-Abfrage immer wieder als
veraltet markieren. Die vorhandene Abfrage liefert jetzt ihren Stand und bündelt weitere
Ereignisse zu einer Folgeabfrage. Der Startdialog erkennt dadurch den angelegten Run unabhängig
von einer noch offenen Sendeantwort. Nach dem Schließen ignoriert er verspätete Antworten,
damit diese keinen späteren Entwurf schließen. Tests prüfen langsame und verspätete Antworten
sowie Fehler ohne angelegten Run.

## Canvas ohne zusätzlichen Chat-Pop-out und mit Rückkehr zu 100 Prozent (09.09.2026)

Kapitel: plugins. Der zusätzliche Canvas-Chat duplizierte Kartenchat und Actor-Inspector.
Chat-Schalter, Pop-out und dessen gespeicherte Breite entfallen. Der Run-Stopp zieht in die
Werkzeugleiste des rechten Primary-Actor-Inspectors und behält Bestätigung und Rechteprüfung.
Einpassen bleibt als bewusste Rückkehr zu 100 Prozent: die aktuellen Szenengrenzen werden
zentriert, ohne sie dafür zu verkleinern. Der Doppelklick auf freie Fläche nutzt denselben
Schritt. Nur die erste automatische Ansicht passt ihren Zoom weiterhin an Szene und Fenster an.

## Ruhigere Kopfzeile mit größeren Hilfsaktionen (09.09.2026)

Kapitel: plugins. Der Run-Header ergänzte zum gemeinsamen Kopfzeilenabstand eine weitere
Trennlinie und eigenes linkes Padding. Diese Doppelung entfällt; der normale Abstand bleibt
erhalten. Einstellungen und Hilfe erhalten größere, besser erkennbare Icons über die neue
gemeinsame Button-Größe large. Höhe, Icongröße und Schrift stammen aus denselben UI-Tokens
für Button und IconButton, ohne Sonderformatierung einzelner Kopfzeilenknöpfe.

## Empfindlichkeit der Canvas-Pinch-Geste einstellen (08.09.2026)

Kapitel: plugins. Trackpad-Pinch soll stärker reagieren und sich an die eigene Bedienung
anpassen lassen. Die Orchestrierungs-Extension bietet deshalb unter Canvas-Zoom einen lokal
gespeicherten Faktor von 0,1 bis 10 mit Standard 2 an. Faktor 1 stellt die frühere Stärke wieder
her. Nur Pinch beziehungsweise Strg+Mausrad verwenden den Faktor; gewöhnliches Mausrad und
Zoomknöpfe behalten ihr Verhalten. Änderungen gelten sofort auch für andere offene Tabs und
benötigen settings.write. Die bestehende Grenze zwischen Controls und Canvas-Kamera bleibt bestehen.

## Derselbe Agentenchat auf Canvas und im Inspector (08.09.2026)

Kapitel: plugins. Die angeheftete Kartenansicht formatierte Nachrichten bisher selbst als
verkürzten Textverlauf. Canvas und Actor-Inspector verwenden jetzt den gemeinsamen ActorChat
mit ChatMessages, identischer Nachrichtenprojektion, Absenderzuordnung, Markdown, Anhängen,
Zeitstempeln und Schritteinstellung. Die Karte behält nur ihre Größen- und Canvas-Scrollgrenze;
eigene Text- und Arbeitsanzeigeformate entfallen. Dadurch folgen auch Zurücklesen, automatische
Fortsetzung am Ende und Linknavigation demselben Verhalten wie im rechten Chat.

## Fehlende Script-Grants und wartende Orchestrierung erklären (08.09.2026)

Kapitel: typescript-platform, plugins. Nach dem Filtern der Werkzeuge kannte die Buildprüfung
bei fehlenden Grants nur noch die gültigen Aufrufnamen. Die tatsächliche Auflösung meldet
ausgeschlossene Werkzeuge nun intern an die Diagnose; vorhandene Verfügbarkeitsverträge nennen
ihre benötigten Grants strukturiert. So benennt script_actor_check Aufruf und fehlenden Grant
ohne separate Zuordnungstabelle, künstliche Rechte oder zusätzliche Werkzeugfreigabe. Regressionen
decken Engine-Aufrufe und das Canvas-Plugin sowie unbrauchbare Grants und die korrigierte Anfrage ab.

Die Anleitung stellt Script-Actors auch als dauerhafte Zähler und Zustandshalter dar und verweist
auf zwei vorhandene Setup-Beispiele. Nach Subscription und Auftrag endet der Koordinator-Turn
ohne Füllmeldung; echte Phasenwechsel bleiben berichtenswert. Die Script-Werkzeuganleitung nennt
für erfolgreiche Tests nun passend zum gemeinsamen Vertrag sowohl fehlendes expect.error als
auch null; ein leerer String bleibt ungültig.

## Werkzeugaktivität aller Actors aus der Run-Projektion (08.09.2026)

Kapitel: core, plugins. Die Aktivitätsanzeige las Werkzeugaufrufe bisher aus dem primären Chat
und Turns aus der Run-Ansicht. Dadurch fehlten die Werkzeuge von Subagenten. Die bestehende
Journal-Projektion hält nun kompakte Aufrufzustände je Turn; der Header verwendet ausschließlich
diese gemeinsame Quelle und nennt bei Subagenten den Actor am Werkzeug.

Die Kombination aus Turn und Call-ID verhindert Verwechslungen wiederverwendeter Modell-IDs.
Ein laufendes Werkzeug vertritt seinen Turn-Chip, damit derselbe Arbeitsschritt nicht doppelt
angezeigt wird. Abschluss, Fehler und Unterbrechung räumen die Aktivität auf. Chatereignisse,
Chat-Detailstufen und Transportwege bleiben dafür unverändert.

## Abschließende Bereinigung gehört zur Stop-Antwort (08.09.2026)

Kapitel: core. Der Engine-Integrationstest zeigte, dass die Stop-Anfrage schon erfolgreich
antwortete, bevor die abschließenden Plugin-Beiträge fertig waren. Sie wartet jetzt auch diese
Bereinigung ab und meldet deren Fehler. Eine zusätzliche feste Antwortfrist verhindert endloses
Warten auf Fremdarbeit; die Quarantäne besteht unabhängig von der Antwort bis zum echten Ende.

Beim Wiederholen einer fehlgeschlagenen Bereinigung ließ außerdem ein bereits verworfenes
Quarantäne-Promise das gemeinsame Warten vorzeitig abbrechen. Der Scheduler wartet nun alle
Nachläufe ab. Die HTTP-Eingabeprüfung bestätigte außerdem, dass während der Sperre angenommene
Primary-Inputs nach der Freigabe ohne weiteres Journalereignis liegenblieben. Der Scheduler
prüft nun nach erfolgreicher Freigabe erneut die offenen Inputs; bereits beanspruchte Inputs
bleiben verbraucht. Sechs Engine-Tests prüfen späte Arbeit, Fehler und Wiederholung, ignorierte
Abbruchsignale, die begrenzte Antwortzeit und diese HTTP-Eingabe ohne Produktserver oder echte
Fremdprozesse.

## Dokumentanzeige und Ergebnisveröffentlichung unterscheiden (08.09.2026)

Kapitel: plugins. Der Selbsttest wertete eine leere Artefaktliste nach `show_document` als
möglichen Fehler. Die Anzeige gehört jedoch der Dokumente-Extension und wird aus dem
protokollierten Werkzeugaufruf aufgebaut; `artifact_publish` erzeugt unveränderliche
Core-Ergebnisse. Diese bestehende Trennung ist jetzt ausdrücklich dokumentiert, statt beim
Anzeigen unbeabsichtigt eine zweite Speicherung und zusätzliche Artefakt-Events einzuführen.

## Fehlende Modellwahl nennt passende Profile (08.09.2026)

Kapitel: core. Ein Agent-Start ohne Profil und Modell verwies bisher nur auf `model_list`.
Die Fehlermeldung nennt jetzt direkt die registrierten Profile des gewählten Treibers.
Damit lässt sich die Anfrage ohne zusätzlichen Suchschritt korrigieren; Profile anderer
Treiber werden nicht als Modellwahl angeboten. Ein leerer Katalog bleibt ein harter Fehler.

## Öffnungshinweise erreichen auch den echten Agent-Loop (08.09.2026)

Kapitel: plugins. Der TurnToolset erklärte ungeöffnete indexierte Werkzeuge bereits korrekt,
doch der vorgeschaltete Agent-Loop wies solche Aufrufe mit einem allgemeinen Fehler ab.
Ein optionaler Fehlerformatter in AgentLoopConfig und Agent erzeugt jetzt schon dort den
Hinweis aus dem erlaubten Turn-Toolset. Er verändert ausschließlich den Fehlertext, öffnet
kein Werkzeug und führt nichts aus. Verbotene und unbekannte Namen verraten keine Katalogdaten.
Ein Faux-Modelltest mit echtem Scheduler belegt Fehlertext im Folgerequest und Journal,
ausbleibende Ausführung und anschließende Wiederaufnahme über tool_open.

## Abgebrochene Rückfragen erzeugen keine Benutzerantwort (08.09.2026)

Kapitel: plugins. Beim Abbruch einer offenen Rückfrage entfernte die Ask-Extension zuerst
ihren wartenden Aufruf und schloss danach die Frage im Journal. Der synchrone Journal-Listener
hielt diese Auflösung für eine Antwort ohne aktiven Aufruf und reihte einen zusätzlichen
ActorInput mit dem Text einer Benutzerverwerfung ein. Die Extension kennzeichnet jetzt die
laufende technische Abbruchauflösung und unterdrückt genau deren Antwortzustellung. Die Frage
verschwindet weiterhin, der Aufruf wird abgebrochen. Echte Benutzerantworten und die Zustellung
nach einem Neustart bleiben erhalten. Ein Scheduler-Test bestätigt, dass der Run-Stopp keinen
künstlichen Antwortinput und keinen weiteren Turn erzeugt.

## Verständliche Mockfehler und eindeutige Fehlererwartungen (08.09.2026)

Kapitel: run-modules. Bei falschen Mock-Antworten verdeckte bisher ein vollständiger Ergebnistyp
den eigentlichen Fehler. Mockprüfungen verwenden nun denselben kompakten Feldpfad-Formatter wie
Werkzeugargumente. Das benennt verschachtelte Typfehler und vermeidet große Union-Ausgaben.

`expect.error: ""` sah wie ein Wunsch nach fehlerfreier Ausführung aus, wurde aber wörtlich mit
`null` verglichen. Ein gemeinsamer Vertrag für Mini-App-, Script-Werkzeug- und Actor-Tests weist
leeren Text ausdrücklich zurück. `null` bedeutet Erfolg, nichtleerer Text den genauen erwarteten
Fehler. Auch direkte Aufrufe der Erwartungsprüfung erhalten dieselbe verständliche Fehlermeldung.

## Laufzeitverträge absichern und Denktiefen nicht umdeuten (08.09.2026)

Kapitel: core. Die generische Agentensession passte eine nicht unterstützte Denktiefe bisher
automatisch an. RAgents prüft nun vor dem Modellaufruf, damit eine ausdrücklich gewählte
Stufe nicht nur als Warnung durch eine andere ersetzt wird. Eine Faux-Modellregression
prüft die Ablehnung von `off` bei einem Modell mit `low`/`high` und den erfolgreichen nächsten
Turn mit gültiger Auswahl.

Die bisher offene Absicherung eigener Fork-Eingriffe ist ergänzt: Steering mit laufendem
Werkzeug und späterem Erfolg oder Fehler samt Ergebniskappung, eindeutige Edit-Anker,
Hashprüfung unter konkurrierenden Zugriffen über Dateialias und Sperrfreigabe nach einem
abgebrochenen Schreibaufruf. Systemprompt-Erhalt und Werkzeugvalidierung besitzen bereits
Integrationstests. Providerprüfungen sichern den expliziten Off-Payload und Unicode in
ineinander verschachtelten Werkzeugargumenten bei byteweise geteiltem SSE ab. Der frühere
Umlautverlust ließ sich im Streamingpfad damit nicht reproduzieren; ein erneuter echter
Fehlfall bleibt nötig, um Providertext von einem Plattformfehler zu unterscheiden.

## Werkzeuganfragen einzeln auflösen und Anleitungen nur einmal laden (08.09.2026)

Kapitel: plugins. Ein falscher oder schon direkt verfügbarer Werkzeugname darf die gültigen
Einträge einer gemischten Anfrage nicht verwerfen. `tool_open` trennt diese Ergebnisse und
liefert jeweils die registrierten Eingabe- und Ergebnisverträge. Der bisher verfügbare
Werkzeugbestand bestimmt zugleich, welche gebundenen Kapitel schon im Kontext stehen.
Sequenzielle Freischaltung vermeidet konkurrierende doppelte Anleitungen in einem Modellaufruf.
Promptkarten übernehmen keine eigene pauschale Sichtbarkeitsregel mehr.

## Markierte Prozesse bis zum Ende eines Runs bereinigen (08.09.2026)

Kapitel: core, plugins. Ein abgesetzter Dienst ist kein laufender Agent-Turn mehr und konnte deshalb
den bisherigen Run-Stopp überleben. Das Prozessplugin verwendet seine plattformabhängige
Zuordnung nun auch zum Beenden. Der Aufräumpfad betrachtet alle markierten Prozesse, nicht nur
die sichtbaren Dienste mit Ports. Ein früher Durchlauf beendet bestehende Dienste; der finale
Lifecycle-Durchlauf erfasst Kinder aus noch auslaufenden Actors, bevor der Run wieder freigegeben
wird. Vor dem Löschen wird erneut geprüft.

Die Auswahl folgt PID plus Startkennung statt einer PID allein. Vor Signalen werden Identität,
Runmarker und gegebenenfalls die aktuelle HTTP-Berechtigung erneut geprüft. Einzelne positive
PIDs vermeiden, dass eine geteilte Prozessgruppe den Server oder andere Runs trifft. SIGTERM,
begrenztes Warten und nötigenfalls SIGKILL liefern einen überprüften Abschluss oder einen
expliziten Fehler. Auf macOS wird das Kommando vor der Markerprüfung aus `ps -E` entfernt;
ein Marker als bloßes Argument darf keine fremde Prozesszuordnung erzeugen.

## Gezielte Control-Verträge und Mock-Ergebnisse vor dem Test (08.09.2026)

Kapitel: run-modules. Eine einzelne Control-Abfrage lieferte bisher sämtliche UI-Typdateien.
Der Abruf folgt jetzt dem TypeScript-Symbolgraphen des gewählten Controls und nimmt nur dessen
transitive Typabhängigkeiten mit. Katalog, Compiler und öffentliche Gesamtreferenz behalten
dieselbe Quelle, ohne eine zweite handgepflegte Props-Liste.

Mini-App-Tests erwarten exakte Capability-Ergebnisse, doch der Check benannte bisher nur die
gebundenen Oberflächen. Er liefert nun deren tatsächlich aufgelöste Eingabe- und Ergebnisverträge
vor dem Test: für direkte Operator-Aktionen, Handler-Aktionen und Werkzeuge je Zielagent.
Autoren können passende Mock-Antworten daraus erstellen, ohne echte Operationen aufzurufen oder
Feldnamen aus Fehlversuchen abzuleiten.

## Prozesse direkt aus der Oberfläche beenden (08.09.2026)

Kapitel: plugins. Sichtbare Hintergrundprozesse und Dienste sollen ohne einen weiteren
Chat-Auftrag beendet werden können. Die vorhandenen Prozess-Pills erhalten dafür eine
kompakte Aktion; der bisher rein informative Restzähler macht alle weiteren Prozesse in
einem gemeinsamen Run-Dialog erreichbar. Auf schmalen Fenstern bleibt die Kopfzeile auf
einen Prozess und den Zugang zur vollständigen Liste beschränkt.

Kopfzeile und Dialog teilen den Anfragezustand je stabiler Prozessreferenz. Ein erfolgreicher
HTTP-Aufruf entfernt den Eintrag nicht vorzeitig; dafür bleibt der Live-Beobachter zuständig.
Fehler sind wiederholbar, Leserechte bleiben erhalten, und die Fokusrückgabe berücksichtigt
auch den letzten verschwindenden Prozess.

## Absender als Darstellungs-Owner im Chat wählen (08.09.2026)

Kapitel: plugins, run-modules. Der Inspector zeigte auch die eigenen Antworten des ausgewählten
Agenten in Sprechblasen. Der gemeinsame Chat-Baustein erhält deshalb einen optionalen Owner,
der über die Absenderkennung bestimmt, wessen Nachrichten ohne Sprechblase erscheinen. Die
Entscheidung liegt bei der Ansicht; dieselbe Actor-Projektion bleibt für Gesprächsrunden mit
Sprechblasen verwendbar.

Der Inspector und Actor-Chats setzen den betrachteten Actor automatisch ein. Mini-Apps können
den Owner für Chats und Nachrichtenlisten selbst wählen oder die Vorgabe mit `null` abschalten.
Die öffentliche Nachrichtenlisten-Demo macht den Wechsel direkt sichtbar. Der Darstellungs-Owner
ist unabhängig vom menschlichen Run-Owner und verändert keine Rechte.

## Gültige Werkzeugargumente vor Konvertierung bewahren (08.09.2026)

Kapitel: core. Ein gültiges `null` in einer String/Null-Union wurde zu einem leeren String und
löste dadurch einen falschen Mini-App-Testfehler aus. Die Reproduktion grenzt die Ursache auf
unsere zusätzliche JSON-Schema-Konvertierung ein; die eingesetzte TypeBox-Konvertierung erhält
den Unionwert bereits korrekt. Der zusätzliche Schritt wählte dagegen den ersten nach
Konvertierung passenden Zweig, auch wenn ein anderer Zweig schon zum Originalwert passte.

Die Validierung lässt vollständig gültige Argumente sofort durch und prüft beim rekursiven
Konvertieren jeden Teilwert zuerst unverändert. So bleiben gültige Unionwerte auch erhalten,
wenn benachbarte Felder eine Umwandlung benötigen. Regressionstests decken verschachtelte
Objekte, Arrays, Tupel, zusätzliche Eigenschaften, JSON-Schema-Unionen und weiterhin nötige
Zahl-/Boolean-Konvertierung ab. Die ursprünglichen Aufrufargumente bleiben unverändert.

## Scrollgesteuerte Funktionsbühne auf der Homepage (08.09.2026)

Kapitel: overview. Ronald möchte die Kernfähigkeiten visuell stärker inszenieren und den
vorhandenen Einstiegstext behalten. Drei große Szenen zeigen deshalb Agenten, TypeScript
und Mini-Apps mit eigenständiger Farbgebung, räumlich angeordneten Karten und Verbindungen.
Auf ausreichend großen Ansichten hält die Bühne ihre Position, während Scrollen durch
die Szenen führt. Die übrigen Abschnitte erhalten kurze Einblendungen und stärkere Grafiken.

Die Scrollposition steuert die Effekte über lokale Browser-APIs; eine zusätzliche Bibliothek
oder externe Ressource ist dafür nicht nötig. Scrollen bleibt eine normale Browserbewegung,
die Szenen sind auch per Schaltfläche erreichbar und lassen sich überspringen. Kleine
Ansichten, reduzierte Bewegung und Betrieb ohne JavaScript zeigen die Szenen untereinander.
So bleibt die Funktionsübersicht auch ohne die räumliche Inszenierung vollständig lesbar.

## Script-Actors als flache Module mit Quelldialog (08.09.2026)

Kapitel: plugins. Script-Actors teilten bisher die Gestaltung von Gesprächskarten und ließen
sich dadurch schwer von LLMs unterscheiden. Ein flaches Modul mit abgeschrägten Ecken, kleiner
TS-Kennung und eigener Statuszeile macht die Art unabhängig von der Farbe erkennbar. Die
Anzahl zugestellter Eingaben bleibt sichtbar; laufende Arbeit benötigt nur einen schmalen Balken.

Der direkte Skript-Knopf öffnet den vorhandenen Quelltext im gemeinsamen Run-Dialog. Damit ist
die programmierte Regel ohne Suche im Inspector lesbar, während der Canvas kompakt bleibt.
Die Ansicht verwendet die bestehende Syntaxhervorhebung und bietet keine Codebearbeitung.

## Eindeutige Eingabezuständigkeit auf dem Canvas (08.09.2026)

Kapitel: plugins, run-modules. Die Kamera erkannte bisher vor allem vertikal überlaufende
DOM-Bereiche als Scrollziel. Kurze Controls, Eingabefelder und horizontale Inhalte konnten
stattdessen den Canvas-Zoom auslösen. Die Entscheidung richtet sich jetzt nach der gesamten
Control-Grenze und berücksichtigt bereits behandelte Ereignisse. So bleibt die Zuständigkeit
auch bei wechselndem Inhalt und am Scrollrand gleich. Der bestehende iframe- und MessageChannel-
Pfad braucht dafür keine Wheel-Weiterleitung; ein zweiter Ereigniskanal würde dieselbe Bedienung
unnötig verdoppeln.
Die gleiche Control-Grenze schützt auch vor parallelem Canvas-Verschieben mit der mittleren
Maustaste und vor Einpassen per Doppelklick. Freie Flächen behalten diese Kameragesten.

## Generierter Fähigkeitenüberblick für den globalen Koordinator (08.09.2026)

Kapitel: core. Der globale Koordinator musste zunächst Referenzdateien durchsuchen, um
vorhandene Möglichkeiten wie Canvas und Mini-Apps zu entdecken. Sein Systemprompt enthält
nun einen kompakten Überblick aus den ausführbaren Management-Routen und öffentlichen
Werkzeugdeskriptoren des aktiven Pluginbestands. Die späte Zusammensetzung berücksichtigt auch
nach dem Overseer registrierte Beiträge. Schemas und Beispielcode bleiben bei Bedarf nachladbar.

Die Orientierung unterscheidet HTTP-Aktionen von Bausteinen regulärer Runs und bewirbt keine
internen Serviceoperationen. Der globale Chat behält seine allgemeinen Datei-/Shellwerkzeuge;
der Katalog vergibt keine zusätzlichen Rechte oder Fähigkeiten. So entsteht keine zweite,
manuell gepflegte Werkzeugliste und kein neuer Spezialwerkzeugpfad.

## Vorhandene Beteiligte und verfügbare Werkzeuge im Startkontext (08.09.2026)

Kapitel: core, plugins. Ein moderierter Run hatte seine Gäste bereits per Setup angelegt; der
Moderator erzeugte dennoch zwei weitere Actors und adressierte danach die ursprünglichen Gäste.
Der bisherige Standardablauf begann mit dem Erzeugen eines Agenten und enthielt keinen aktuellen
Actorbestand. Der Prompt fordert deshalb zuerst die Bestandsprüfung und Wiederverwendung passender
Beteiligter. Ein pro Turn aus der RunView erzeugter Überblick macht vorhandene Actors auch dann
sichtbar, wenn ein anderer Actor sie angelegt hat. Er erscheint nur mit erlaubtem `actor_list`.
Gleiche Namen führen weiterhin nicht zu automatischer Wiederverwendung: getrennte Kontexte sind
ein legitimer Grund für mehrere Actors.

Eine zweite, aus dem erlaubten Toolset erzeugte Übersicht erklärt schon vor dem ersten Aufruf,
welche Werkzeuge der Actor hat und welche noch geöffnet werden müssen. Plugin-Beschreibungen
bleiben die Quelle; Detailverträge werden weiterhin nachgeladen. So muss das Modell die
Möglichkeiten seiner Arbeitsumgebung nicht erst erraten. Beide Übersichten lassen isolierte
LLMs ohne Werkzeuge unberührt.

## Kartengröße einstellen und Gespräche auf dem Canvas zurücklesen (08.09.2026)

Kapitel: plugins. Die Breite anhand des Handles gab kurzen Namen wenig Platz für Inhalt.
LLM-Karten verwenden deshalb eine gemeinsame Vorgabe von 360 mal 182 Pixeln. Die zuständige
Extension bietet diese Größe als lokale Browsereinstellung an; individuelle Größen bleiben
von Änderungen der Vorgabe unberührt.

Eine begrenzte Vorschau verhinderte das Zurücklesen direkt an der Karte. Der vorhandene Verlauf
bleibt jetzt vollständig zugänglich und verwendet dieselbe Scrolllogik wie der Chat. Die
Kartenfläche fängt Scrollen auch am Rand ab, damit daraus kein unerwarteter Canvas-Zoom wird.
Der Kopf öffnet weiterhin die Detailansicht.

Im globalen Koordinator stehen Modell, Reasoning und Reset zusammen über dem Verlauf.
Die breitere Modellauswahl und die Bestätigung direkt darunter ersetzen keinen Datenpfad;
sie halten die Bedienung an einem Ort und sparen die zusätzliche Fußzeile.

## Eine Übersicht statt Run-Dialog, Koordinator-Dropdown und Neuer-Run-Knopf (08.09.2026)

Kapitel: plugins, run-modules. Die Run-Liste lag in einem seitenweiten Dialog, der übergeordnete
Koordinator in einem eigenen Dropdown, dazu "Neuer Run" als dritter Knopf in der Kopfzeile: drei
Wege für eine Frage, nämlich was läuft und womit ich weitermache. Jetzt gibt es links oben eine
einzige quadratische Ecke von Leistenhöhe, deren ganze Fläche der Knopf ist. Sie klappt die
Übersicht über der Run-Fläche auf: Koordinator-Chat links, Run-Karten rechts, "Neuer Run" in der
Run-Leiste. Die Übersicht bleibt ein Dropdown mit Außenklick, Escape und `Cmd+I`, kein modaler
Dialog; sie bedeckt die Fläche unter der Kopfzeile, die Kopfzeile bleibt bedienbar. Der Slot
`appHeaders` wird zu `overviewPanels` mit `readRight` und `onBusy`; der Koordinator ist sein
erster Beitrag und meldet laufende Arbeit an die Ecke. Der Ausweichweg, den Koordinator über
einem offenen seitenweiten Dialog als zweiten Dialog zu öffnen, entfällt mitsamt seinem
Portal-Wechsel; der Kurzbefehl tut bei offenem Dialog nichts.

## Homepage als Produkteinstieg mit Wegen zur Entwicklung (08.09.2026)

Kapitel: overview. Die Homepage wirkte durch ihre Dichte und die vielen technischen
Unterabschnitte wie eine Einführung in die Laufzeit. Der neue Aufbau beginnt mit dem Produkt
und einer großen schematischen Arbeitsfläche. Kurze Featureabschnitte mit eigenen Grafiken,
mehr Abstand und klarer Typografie machen die Kernfähigkeiten schneller erfassbar.
Technische Vertiefungen führen zu passenden Referenzstellen; ein eigener Entwicklungsbereich
erschließt Plugins, Profile und Codebeispiele. Die lokalen Event- und Journalbeispiele bleiben
bedienbar. Die gemeinsame Navigation wird weiterhin aus der Hauptseite generiert.

Die schematischen Grafiken erklären vorhandene Funktionen ohne einen echten Run zu behaupten.
Leere Screenshot-Platzhalter entfallen, Anwendungsideen bleiben am Ende. Die Gestaltung nutzt
weiterhin Farben und Schriftfamilie der App und benötigt keine externen Ressourcen.

## Run-Karten, freie Agentengrößen und gezielte Aktivitätsanzeige (08.09.2026)

Kapitel: plugins. Eine wachsende Run-Liste braucht mehr Platz als ein schmales Dropdown.
Die Auswahl öffnet deshalb einen seitenweiten Dialog mit responsiven Karten und behält die
vorhandenen Auswahl-, Lösch- und Rechtepfade. Der globale Koordinator bleibt ein Dropdown;
seine Unterhaltung wird durch diese Navigationsänderung nicht ersetzt.

Agentenkarten lassen sich direkt auf dem Canvas vergrößern und an einer kleinen Ecke ziehen.
Die gemeinsame Größenlogik berücksichtigt den Zoom und erhält eine gewählte Größe beim
Umschalten zur kompakten Ansicht. So kann die Gesprächsvorschau mehr Platz nutzen, ohne einen
weiteren Dialog zu öffnen. Entfernte Karten verlieren ihre lokale Größenwahl.

Die Arbeit des primären Gesprächspartners ist bereits im Chat erkennbar. Sein laufender Turn
entfällt deshalb im Aktivitätschip, während Werkzeugaufrufe und andere Actors sichtbar bleiben.
Die Filterung vor dem Anzeigelimit verhindert, dass der ausgeblendete Turn einen Platz belegt.

## Kompakte Symbolleisten für Arbeitsbereich und Agentendetails (08.09.2026)

Kapitel: plugins. Beschriftete Reiter und die dauerhafte Statuszeile nahmen besonders in
schmalen Ansichten viel Platz vor dem eigentlichen Chat ein. Die Leisten zeigen deshalb
Symbole in einer Zeile; Namen und Anzahlen bleiben in Tooltips und zugänglichen Beschriftungen.
Der Infochip zeigt Modell und Laufdetails erst beim Öffnen. Punkte erhalten die Hinweise
im Arbeitsbereich, und die Sprachplugins liefern ihre kurzen Kennzeichen selbst. Horizontales
Scrollen hält beide Leisten auch bei wenig Platz erreichbar, ohne sie auf mehrere Zeilen
umzubrechen.

## Arbeitsszenen zeigen laufende Agenten an (08.09.2026)

Kapitel: plugins. Während einer laufenden Antwort soll die Agentenkarte auch ohne neue
Nachricht sichtbar aktiv bleiben. Das Symbolfeld verwendet deshalb eine kompakte Auswahl
der vorhandenen Arbeitsszenen; unter der Chatvorschau zeigt eine zusätzliche Zeile die normale
Variante. Die fünf Verlaufszeilen bleiben vollständig erhalten. Beide Anzeigen folgen dem
vorhandenen Actor-Zustand und verschwinden bei Ende, Fehler oder Stopp.

Der gemeinsame Chat-Baustein übernimmt beide Darstellungen. Eine reduzierte Bewegungseinstellung
pausiert Bildtakt und Szenenwechsel, damit auch die neu verwendeten Szenen ruhig bleiben.

## Kompakte Appfenster und lesbare Agentenvorschauen (07.09.2026)

Kapitel: run-modules, plugins. Große anfängliche Appfenster nahmen auf dem Canvas viel Platz
ein, während die Agentenköpfe kaum Einblick in die laufende Arbeit gaben. Mini-Apps starten
deshalb mit höchstens 400 mal 280 CSS-Pixeln; kleinere Vorgaben bleiben erhalten. Ihre Inhalte
behalten die normale Schriftgröße, größere Arbeitsansichten sind weiterhin über Skalieren
oder die Vollansicht erreichbar.

Agentenkarten erhalten mehr Breite und unter ihrem Kopf einen fünf Zeilen hohen Ausschnitt
der jüngsten Nachrichten. Die Vorschau verwendet die vorhandene Actor-Unterhaltung und führt
beim Anklicken zu deren vollständiger Ansicht. Sie bleibt auf Agenten beschränkt; das
bestehende Layout berücksichtigt die gemessenen Kartengrößen.

## Homepage erklärt Konzepte vor ihrer Zusammenstellung (07.09.2026)

Kapitel: overview. Ein Setup stand bisher vor der Erklärung seiner Bausteine; die Verknüpfung
über Events war im TypeScript-Unterabschnitt versteckt. Die Homepage führt deshalb von Run und
Actors über Events und Subscriptions zu programmierten Regeln, Mini-Apps und Journal. Setups
werden anschließend als wiederverwendbarer Aufbau dieser Teile erklärt. Nutzen und vorhandene
Beispiele stehen direkt beim jeweiligen Konzept. Die Subscription-Matrix erhält ein lokales
Lesebeispiel für Quelle, Eventtyp und Zustellung. Die gemeinsame Kopfzeile erschließt diese
Kapitel auch von den Referenzseiten aus. Gestaltung und bestehende technische Details bleiben
erhalten; eine Mini-App wird dabei ausdrücklich von einem abonnierenden Actor unterschieden.

## Startdialog folgt dem angelegten Run (07.09.2026)

Kapitel: plugins. Das Schließen war ausschließlich an die erfolgreiche HTTP-Antwort von
`send` oder `start` gebunden. Bei ausstehender Antwort konnte der Run bereits vorhanden sein,
während der Dialog weiterhin die Startfläche zeigte. Der Entwurf beobachtet deshalb auch den
bestehenden Run-Stream und meldet den Übergang nur einmal. Ablehnungen ohne Run bleiben sichtbar.
Die isolierte Browserprüfung deckt Chat und Script mit Erfolg, Ablehnung und verzögerter Antwort ab.

## Gemeinsame Homepage-Kopfzeile auf allen Seiten (07.09.2026)

Kapitel: overview. Die separat gepflegte Navigation der Referenzen hatte andere Einträge,
Abstände und kein Sticky-Verhalten. Der Generator übernimmt deshalb die vorhandene Kopfzeile
aus der Hauptseite. Styles und Höhenmessung werden als gemeinsame Assets ausgeliefert;
auch die Inhaltsbreite ist identisch. Themenlinks erhalten auf Unterseiten das Homepage-Ziel,
der aktuelle Referenzeintrag eine Markierung. Damit bleiben Menüänderungen an einem Ort und
funktionieren sowohl im Hilfedialog als auch im statischen Export.

## Einfache Nachrichtenliste als Mini-App-Control (07.09.2026)

Kapitel: run-modules. Für Redaktionsnotizen oder Prüfstatus braucht eine Mini-App häufig
mehrere Absender und lesbare Nachrichten, aber weder Actor-Anbindung noch eine Chateingabe.
`UI.MessageList` verwendet deshalb die gemeinsame Nachrichtendarstellung mit einem kleinen,
kontrollierten Datenvertrag. Reihenfolge und Inhalt kommen aus der App; Absenderfarben bleiben
stabil. Zwei bestehende Referenzfälle und lokale Demos zeigen die Nutzung. Typen und öffentliche
API werden durch denselben Export- und Vertragssammler wie die übrigen Controls dokumentiert.
Die Zustellung externer Zustandsänderungen bleibt eine separate Frage der Hostreaktivität.

## Optionale Profilanmeldung mit gemeinsamen Rechten (07.09.2026)

Kapitel: profiles, plugins. Eine Instanz soll ohne Benutzerverwaltung einfach bleiben und
bei Bedarf Leser und Bediener unterscheiden können. Deshalb aktiviert erst ein ausdrücklicher
Benutzerexport der Profildatei die Anmeldung. Passwortreferenzen bleiben außerhalb öffentlicher
Konfiguration; Sitzungen werden im Speicher gehalten und beim Neustart verworfen.

Die Rechteabfrage ist ein gemeinsamer Stringvertrag für Host und Extensions. Die Oberfläche
verwendet ihn für Sichtbarkeit und Bearbeitbarkeit, HTTP-Routen prüfen unabhängig davon.
Die globale Unterhaltung hat eigene Rechte. Profilzugriff bleibt gemeinsamer Zugriff auf alle
Runs und vertraut bei Schreibrechten der bestehenden Agentenausführung. Eine private lokale
Dienstidentität erhält dem globalen Koordinator seine Verwaltungs-API, ohne einen Browserzugang
zu verteilen. Rechte, Verträge und Beispiele fließen aus dem Code in die Entwicklerreferenz.

## Kleine Fensterhülle für Canvas-Mini-Apps (07.09.2026)

Kapitel: run-modules, plugins. Ganz ohne Rahmen fehlten den Canvas-Apps erkennbare Grenzen
und eine einfache Möglichkeit, Platz freizugeben. Eine flache Titelzeile bietet Einklappen
und Vergrößern; sie unterscheidet sich bewusst von den Agentenkarten. Der kleinere
Größenanfasser hält die Ecke frei. Die lokale Vollansicht verwendet den vorhandenen Dialog
innerhalb des Runs, ohne neue Manifestpflicht. Der Canvas-Client bleibt dabei gemountet,
damit lokale Eingaben erhalten bleiben; die zusätzliche Ansicht teilt den Journalzustand.
Werkzeugformulare an Agenten erhalten keine zusätzliche Hülle. Escape aus Sandbox-Iframes
wird an den Host weitergereicht, sofern die App es nicht selbst behandelt.

## Vorhandene Homepage-Kopfzeile bleibt beim Scrollen sichtbar (07.09.2026)

Kapitel: overview. Die zusätzliche Themenleiste wiederholte die Navigation. Sie entfällt
mitsamt Fortschrittsanzeige und Abschnittsmarkierung. Stattdessen bleibt die vorhandene
Kopfzeile sticky; ihre gemessene Höhe hält Sprungziele unterhalb der Navigation sichtbar.

## Hilfe ohne zusätzliche Titelzeile (07.09.2026)

Kapitel: plugins. Die Homepage besitzt bereits eine eigene Navigation. Die zusätzliche
Hilfe-Kopfzeile entfällt, damit der Dialog die verfügbare Höhe für den Inhalt verwendet.
Ein Schließen-Button liegt oben rechts über dem Iframe. Der gemeinsame Modal-Baustein
behält Hintergrundsperre, Escape und Fokusrückgabe bei; der Dialogname bleibt für Screenreader
vorhanden. Die Tastaturgrenzen des Iframes führen direkt zum Schließen-Button zurück.

## Kompakter Kopf im Koordinator-Chat (07.09.2026)

Kapitel: plugins. Titel, Untertitel und ausführliche Modellinformationen nahmen dem Chat zu
viel Platz. Das Dropdown erhält einen einzeiligen Kopf und zusammenstehende Modellcontrols
mit Meldungen nur bei Lade-, Speicher- oder Fehlerzuständen. Die normale Einstellungsseite
behält ihren Erklärungstext. Eine begrenzte Breite und der kürzere Fußbereich geben dem
Gespräch mehr Gewicht, ohne die bestehende Dropdown-, Modellwahl- oder Resetlogik zu ändern.

## Mini-Apps unmittelbar auf dem Canvas (07.09.2026)

Kapitel: run-modules, plugins, overview. Die zusätzliche App-Vollansicht im rechten Reiter
verteilte dieselbe Oberfläche auf mehrere Orte und verlangte für die eigentliche Arbeitsfläche
eine ausdrückliche Platzierung. Jede installierte App erscheint deshalb standardmäßig auf dem
Canvas. Fehlende Maße und Platzierungen ergänzt der Host; das Layout ordnet die Elemente an.
Auch Dialog-Apps gehören auf die Fläche, der Dialog bleibt eine zusätzliche Ansicht.

Die Sichtbarkeit ist Laufzeitzustand und kein neuer Build: Der Agent kann eine App ausblenden,
ohne Installation, Werkzeuge oder Daten zu verlieren. Wiederanzeigen und Neustart erhalten
diesen Zustand. Eigene App-Reiter und ihre Navigation entfallen vollständig; der Werkzeuge-Reiter
bleibt für Script-Werkzeuge erhalten. Zwei Referenzkarten prüfen automatische Platzierung und
Ein-/Ausblenden, die generierte Übersicht überprüft deren Abdeckung.

## Gemeinsame HTTP-Verwaltung statt Koordinator-Spezialwerkzeuge (07.09.2026)

Kapitel: core, plugins, typescript-platform. Der globale Koordinator arbeitet mit denselben allgemeinen
Datei- und Shellwerkzeugen wie ein externer Agent. Seine sechs eigenen Werkzeugadapter
entfallen. Ihre nützlichen Zusagen gehen in eine gemeinsam aufrufbare HTTP-Verwaltung über:
Referenzauflösung, serverseitige Run-Erstellung und bestätigte Startvorbereitung. Lokale
Run-Script-Pakete durchlaufen den bestehenden Loader und Prüfpfad, damit eigene Setups
keinen neuen Paketvertrag oder Pluginneustart brauchen.

Ausführbare HTTP-Verträge erzeugen OpenAPI und Markdown; dieselben Verträge prüfen Anfragen.
Damit entsteht keine manuell gepflegte zweite API-Liste. Journale bleiben JSONL und werden
lesend zugänglich. Schreibende Operationen bleiben bei der Engine; die vorhandene Host-Shell
ist dabei keine neue Sicherheitsgrenze. Alte globale Actor-Identitäten werden nicht migriert,
sondern verlangen den bereits vorhandenen ausdrücklichen Gesprächsreset.

## Eine Stimme für alle Steuerelemente (07.09.2026)

Kapitel: plugins, run-modules. Die Oberfläche hatte über dreißig eigene Schaltflächen-Stile:
in der Kopfzeile drei verschiedene Knöpfe nebeneinander, Pillen mit fünf Größen, Ghost-Knöpfe
mit vier Hover-Farben, Fokusringe mal deckend, mal transparent, mal gar nicht. Jedes Plugin
hatte seinen eigenen Zurück-Knopf. Festgelegt:

- Es gibt EINE kleine UI-Bibliothek unter `apps/web/src/ui/` mit `Button`, `IconButton`,
  `Chip`, `Segmented`, `SelectMenu`, `Modal` und `Dialog`; die Klassen in `ui.css` sind
  derselbe Vertrag für Markup ohne Komponente. Host, Plugins und Mini-Apps (`UI.Button` usw.)
  verwenden sie; Plugin-CSS baut keine Schaltflächen mehr und selektiert keine `ui-*`-Klasse.
- Genau zwei Höhen (30 px, in Reihen und Karten 26 px), ein Radius, ein Fokusring, eine
  Hover-Farbe. Die Skala steht in `ui.css` selbst, damit sie auch im Mini-App-Frame trägt.
- Zustände tragen nie nur Farbe: ein gewählter Chip ist gefüllt UND gerahmt, ein aktiver
  Umschalter liegt als Fläche mit Schatten im Rahmen, Löschendes sagt es im Text.
- Listenzeilen und Tabs (`session-open`, `file-row`, `tree-row`, `workspace-tab`,
  `settings-navigation-item`) bleiben Zeilen, keine Schaltflächen; sie sind nicht Teil der
  Bibliothek.
- `host-widgets.css` behält nur, was keine Steuerung ist (Spinner, Zähler, Leerzustand,
  Meldungen, Quelltextfarben); `chat/icons.tsx` und `lib/icons.tsx` sind zu `ui/icons.tsx`
  zusammengelegt.

## Homepage mit Erklärgrafiken und gestufter Vertiefung (07.09.2026)

Kapitel: overview. Die bestehende Homepage bekommt eine anschauliche Gesamterklärung und
kürzere Zugänge zu den Features. Beschriftete Funktionsschemata zeigen Aufbau, getrennte
Agentenkontexte und den gemeinsamen Handler einer Mini-App. Lange Betriebsdetails stehen
hinter aufklappbaren Zusammenfassungen; das Journal-Lesebeispiel bleibt direkt bedienbar.
Ronalds Wunsch nach erklärenden Illustrationen ergänzt die bisherige Screenshot-Regel.
HTML und SVG halten Beschriftungen, Links und Icons präzise, skalierbar und im statischen Export.
Die Themenleiste und kurze Hervorhebungen unterstützen die Orientierung beim Scrollen, ohne
den Scrollweg zu übernehmen oder Inhalte bis zu einer Animation zu verbergen.
Als Gestaltungsprinzip dient Progressive Disclosure; die sachliche Stimme bleibt erhalten.
Die Quellenfreigabe der UI-Referenz folgt den nach `apps/web/src/ui/` verschobenen Bausteinen.
Die dort fehlenden Icons für Zurück, Hilfe und Einstellungen sind für den Web-Build ergänzt.

## Auto-Scroll am tatsächlichen Verlaufsende (07.09.2026)

Kapitel: plugins. Der bisherige Endmarker lag vor dem Fußraum der Eingabe. `scrollIntoView`
erreichte deshalb nicht zuverlässig die tatsächliche Scrollgrenze; der Größenbeobachter
konnte zusätzlich beim Wachsen einer Antwort den Folgemodus ausschalten. Der gemeinsame
Chat merkt jetzt die Scrollabsicht unabhängig von Größenänderungen und bewegt nur seinen
eigenen Scrollcontainer. Manuelles Erreichen des Endes und der Ende-Knopf aktivieren das
Mitlaufen, Scrollen nach oben pausiert es. Tests decken auch gleichzeitiges Scrollen und
Inhaltswachstum ab.

## Mehr Abstand vor der Chat-Eingabe (07.09.2026)

Kapitel: plugins. Der letzte Beitrag stand zu dicht an der darüberliegenden Eingabebox.
Der gemeinsame Chat-Rahmen reserviert bei vorhandener Eingabe jetzt 32 statt 16 Pixel
zusätzlichen Fußraum neben deren gemessener Höhe. Das gilt auch für den globalen Koordinator
und Mini-App-Chats; reine Verlaufsansichten behalten ihren bisherigen Abstand.

## Neutrale Beispiele nach Anwendungsfall und Konzept (07.09.2026)

Kapitel: overview, plugins, typescript-platform. Die Referenz bestand überwiegend aus technischen
Proben; für Startleitfäden gab es nur einen Kundenfall. Die Referenz-Extension liefert deshalb
zwei eigene Einrichtungsdialoge, zwei Skill-Abläufe und zusätzliche Anwendungsfälle für die
vorhandenen Fähigkeiten und Controls. Kundenspezifische Szenarien zählen nicht zur Abdeckung.

Einfache optionale Schlagworte auf dem gemeinsamen StartEntry-Vertrag verbinden Suche,
Filter und Dokumentation. Fachliche Zuordnung und Konzeptkatalog bleiben in der Extension;
der Host kennt keine Referenzkategorien. Der Generator erzeugt die beiden Blickrichtungen
und eine Konzeptübersicht; die Prüfung fordert mindestens zwei Beispiele pro Konzept.
Fassungsvarianten sowie dasselbe Szenario als Script und Prompt verdoppeln die Abdeckung nicht.
Die Mindestzahl dokumentiert vorhandene Beispielaufträge, nicht erfolgreich ausgeführte Modellläufe.

## Hilfe innerhalb der Anwendung öffnen (07.09.2026)

Kapitel: plugins. Die Homepage erscheint auf Wunsch im modalen Dialog statt in einem neuen
Browser-Tab. Ein Iframe lädt denselben statischen Export; Unterseiten und UI-Beispiele bleiben
innerhalb der Hilfe bedienbar. Der vorhandene Dialog übernimmt Hintergrundsperre und
Fokusrückgabe. Escape und die Tab-Grenzen werden auch innerhalb des Iframes behandelt.
Externe Quelllinks öffnen weiterhin separat; der eigenständige Export bleibt unverändert.
Fehlende Konzeptzuordnungen für die vorhandenen Script-Werkzeug- und Reiter-App-Beispiele
sind ergänzt, damit die strikte Referenzprüfung den integrierten Web-Build nicht blockiert.

## Homepage als mitgelieferte Hilfe und statischer Export (07.09.2026)

Kapitel: overview, plugins. Das Fragezeichen neben Einstellungen öffnet die Homepage in einem
neuen Tab, damit die laufende Unterhaltung erhalten bleibt. Jeder Web-Build erzeugt die
öffentlichen Referenzen und liefert den statischen Export unter `/help/` mit. Derselbe Export
liegt unter `docs/homepage/dist/` zum unabhängigen Hosting; es gibt keine zweite Hilfe-Seite.
Repository-Links werden im Export zu GitHub-Links, Seiten und Assets bleiben relativ.
Die Referenzprüfung läuft vor dem Web-Build, damit dessen Generierung veraltete Quellen nicht
verdeckt. Fehlende Hilfe-Dateien liefern 404 statt erneut die Anwendung zu öffnen.

## Build-Einstiege auf drei Tasks und Skripte reduziert (07.09.2026)

Kapitel: overview. Separate Tasks und Wrapper für jeden Teilbuild und Test machten die Auswahl
unnötig groß. Es bleiben `build`, `check` und `open: homepage` sowie drei Skripte unter `build/`.
Der Homepage-Einstieg bündelt Erzeugen, Prüfen und Öffnen über Optionen. Die vollständige
Prüfreihenfolge bleibt erhalten; gezielte pnpm-Befehle rufen ihre Werkzeuge direkt auf.

## Homepage vor dem Öffnen bauen (07.09.2026)

Kapitel: overview. Der Task `open: homepage` soll aktuelle Referenzen anzeigen. Sein Skript
führt deshalb zuerst den Homepage-Build aus und öffnet die Seite nur bei Erfolg. Die Task-Datei
enthält weiterhin nur den Skriptaufruf; `pnpm open:homepage` verwendet denselben Ablauf.

## Eingebettete Oberflächen ohne zusätzliche Fensterhülle (06.09.2026)

Kapitel: overview, plugins, run-modules. Verschachtelte Kopfzeilen und Rahmen machten kleine
Oberflächen unnötig schwer. Die Mini-App-Extension zeigt Canvas-Apps deshalb ohne Host-Rahmen
oder Hintergrund und Werkzeugformulare direkt innerhalb der Agentenkarte, ohne zweite Kopfzeile
oder Einklappknopf. Eingaben, Aktionen, Größenanfasser und nötige Laufzeitmeldungen bleiben
erhalten. Erfolgreiche Aktionen hinterlassen auf dem Canvas keine dauerhafte Statusleiste.
Die eigene Gestaltung der Mini-App sowie die Vollansichten in Reitern und Dialogen bleiben erhalten.

## Startfähige Reasoning-Vorgabe im core-Profil (06.09.2026)

Kapitel: profiles. Das core-Profil setzte GLM 5.3 Flash auf `off`, obwohl der Modellkatalog
für die angebotenen RAgents-Stufen nur `low` und `high` erlaubt. Die Initialisierung des globalen
Koordinators brach deshalb den Serverstart ab. Die Profilvorgabe ist jetzt ausdrücklich `low`;
die strikte Prüfung bleibt erhalten. Ein Test mit der ausgelieferten Konfiguration und dem
echten Modellkatalog reproduziert den Fehler und prüft die gültige Initialisierung.

## Gesprächsreset und Controls aus der Mini-App-Extension (06.09.2026)

Kapitel: core, plugins, run-modules, overview. Der globale Koordinator soll nach einem erledigten
Auftrag mit frischem Kontext beginnen können. Ein ausdrücklich bestätigter Reset stoppt seine
Arbeit und entfernt nur seine Unterhaltung. Eine persistierte Absicht und die bestehende
Stopp-Grenze verhindern, dass ein Prozessabbruch oder späte Laufzeit-Ausgaben den alten Kontext
wiederherstellen. Modellwahl und verwaltete Runs bleiben bestehen; kein automatisches Leeren.

Formulare, Tabellen, Dateiauswahl, Aufgabenfortschritt und Dokument-/Diff-Ansichten liegen mit
Typen und Styling in ragents.mini-apps. Sie ergänzen die vorhandenen Controls, ohne neue
Fachzweige im Host einzuführen. Der gemeinsame Typdateisammler versorgt Compiler, LLM-Werkzeug
und öffentliche Referenz; Export- und Vertragstests verhindern eine zweite, veraltende API.
Die lokale Vorlage und Referenzdemos zeigen denselben Code, einschließlich Fehlern asynchroner
Aktionen und kontrollierter Eingaben.

## Sachliche Sprache auf der Homepage (06.09.2026)

Kapitel: overview. Die Homepage benennt RAgents im Einstieg als programmierbaren AI-Harness.
Werbesprüche und direkte Ansprache entfallen auf der gesamten Hauptseite. Die drei Schwerpunkte
beschreiben Fähigkeiten und Nutzen; Einleitung und kompakte Anordnung bleiben erhalten.

## Platz für Linienlabels und ruhiger globaler Chat (06.09.2026)

Kapitel: plugins. Beschriftete Verbindungen wirkten zwischen kompakten Actor-Karten gedrängt.
Ihre gemessene Textgröße erhöht jetzt den Mindestabstand der kleinsten gemeinsamen Layoutgruppe.
So bleibt Platz um die Beschriftung, auch nach Textänderungen und unabhängig vom Kamerazoom.
Der globale Koordinator beginnt mit ausgeblendeten Werkzeug- und Reasoning-Schritten. Eine
eigene gespeicherte Detailauswahl lässt sie bei Bedarf sichtbar werden, ohne Run-Chats umzustellen.

## Canvas-Größen unabhängig vom Netz-Render erfassen (06.09.2026)

Kapitel: plugins. Asynchron geladene Kartenbeiträge konnten ihre Actor-Karte verbreitern,
ohne einen Render des Netzes auszulösen. Nachbarn, Linien und Rahmen verwendeten dadurch alte
Maße. Eine gemeinsame Beobachtung aller Actor- und App-Boxen sammelt Größenänderungen pro
Frame und speist die bestehende Layoutberechnung. Weltmaße bleiben unabhängig vom Kamerazoom;
die Plugins brauchen keine eigenen Aktualisierungssignale. Canvas-Apps behalten ihre
angeforderte Größe, während das Layout ihre gemessenen Außenmaße verwendet, um Rückkopplungen
zwischen Messen und Setzen zu vermeiden.

Der erste Kamera-Fit wartet auf echte Maße und eine sichtbare Fläche. Spätere Messungen
aktualisieren das Layout, ohne die Kamera zu verändern. App-Größenanfasser rechnen die
Pointerbewegung mit dem Zoom um und lösen bereits beim Ziehen die gemeinsame Messung aus.
Beobachter, ausstehende Frames und Pointergesten werden beim Entfernen sauber beendet.

## Homepage zwischen Einleitung und Faktenübersicht (06.09.2026)

Kapitel: overview. Die verdichtete Faktenliste war Ronald zu trocken und ließ den Einstieg
vermissen. Die Homepage verbindet deshalb wieder eine kurze Einleitung mit drei konkreten
Möglichkeiten: ein Agententeam zusammenstellen, in einer gemeinsamen Mini-App mitarbeiten und
den Aufbau für den nächsten Auftrag behalten. Die Einleitung stellt die eigene Arbeitsumgebung
in den Mittelpunkt. Auf dem Notebook stehen die Schwerpunkte nebeneinander; mobil folgen sie
untereinander. Modellwahl,
Plugins und Journal stehen ergänzend darunter. Moderate Schriftgrößen und Abstände halten die
Fähigkeiten weiterhin im ersten Bildschirm, die Bildplatzhalter bleiben eingeklappt.

## Generierte Textreferenz für externe Modelle (06.09.2026)

Kapitel: overview, typescript-platform. Externe Modelle sollen Run-Setups und weitere
Erweiterungen schreiben können, ohne die HTML-Referenz oder das Repository zuerst erschließen
zu müssen. Der vorhandene Homepage-Generator erzeugt deshalb zusätzlich einen kleinen
`llms.txt`-Index, Markdown-Referenzen, die vollständige `llms-full.txt` und `run-api.d.ts`.
Die API verwendet den echten Compiler-Deklarationsgenerator mit den registrierten core-Verträgen;
Beispiele übernehmen sämtliche Dateien der mitgelieferten Run-Script-Pakete. So sind auch Tests
und eingebettete Mini-Apps nachvollziehbar, ohne eine zweite API-Liste zu pflegen. Der normale
Referenzcheck prüft Drift und kompiliert die Beispielquellen gegen die veröffentlichte API.

## Einstellungen nach Extension oder Fähigkeit (06.09.2026)

Kapitel: plugins. Ronald möchte sowohl von einer Extension ausgehen als auch sehen können,
welche Extensions eine bestimmte Fähigkeit liefern. Ein Umschalter dreht deshalb die Navigation
desselben Inventars: Eigentümer oder Beitragsart links, die vorhandenen Details rechts. Die
Fähigkeitsansicht zeigt passende Beiträge nach Eigentümer und verlinkt dessen vollständige Seite.
Bearbeitbare Einstellungen gehören zur Konfiguration. Gemeinsame Detailkomponenten und derselbe
Plugin-Zustand verhindern voneinander abweichende Darstellungen oder Einstellungen.

## Homepage-Einstieg mit direkt sichtbaren Fakten (06.09.2026)

Kapitel: overview. Auf dem Notebook nahm der bisherige Titelblock fast den gesamten ersten
Bildschirm ein, ohne die Fähigkeiten ausreichend zu erklären. Der Einstieg besteht jetzt aus
einer kurzen Produktdefinition und sechs kompakten Zeilen zu Setups, Mini-Apps, TypeScript,
Modellwahl, Plugins und Journal, jeweils mit konkretem Nutzen und einem Link zur Vertiefung.
Die wiederholten Zwischenlabels entfallen, Abschnittsabstände werden kleiner. Bildplatzhalter
stehen eingeklappt in den jeweiligen Details; die Arbeitsfläche folgt nach dem Setup-Kapitel.
So bleibt der sichtbare Platz für Inhalte und direkt nutzbare UI- und Codebeispiele verfügbar.

## Homepage aus VS Code öffnen (06.09.2026)

Kapitel: overview. Zum Bauen fehlte Ronald der direkte Zugang zur fertigen Seite. Der Task
`open: homepage` und der Alias `pnpm open:homepage` verwenden `build/open-homepage.sh`.
Das Skript öffnet auf macOS die lokale Datei-URL im Standardbrowser; ein Neuaufbau ist ein
eigener Task. Die URL wird aus dem Dateipfad erzeugt, damit auch Leerzeichen korrekt bleiben.

## Gemeinsame Dropdowns und einstellbarer globaler Koordinator (06.09.2026)

Kapitel: core, plugins, profiles. Ronald möchte Modell und Reasoning-Tiefe des übergeordneten
Koordinators direkt im Chat und in den Einstellungen verändern. Beide Ansichten verwenden
denselben Plugin-Beitrag und Zustand. Die Auswahl wird pro Profil gespeichert und bei jedem
Turn synchron übernommen und journalisiert; laufende Antworten behalten ihr Modell. Dadurch
bleibt die langlebige Unterhaltung erhalten. Modellfähigkeiten und vorhandene Medien begrenzen
die Auswahl, fehlgeschlagene Änderungen erhalten den bisherigen Wert.

Bearbeitbare Einstellungen gehören als generischer Web-Beitrag ihrem Plugin. Der Überblick
und die Plugin-Seite zeigen dieselbe Oberfläche; ihr Inventar bleibt daneben lesbar. Die
Kopfzeile ordnet Run-Liste, Neuer Run und globale Beiträge links an, rechts bleibt das Zahnrad.
Run-Liste und Koordinator erhalten einen gemeinsamen Dropdown-Baustein und dieselbe Gestaltung
mit Abstand zur Kopfzeile. Auch Auswahlmenüs und Schritt-Popovers teilen die Schließlogik;
Escape schließt nur die oberste geöffnete Ebene, Außenklick und Fokuswechsel schließen ebenfalls.

## Build- und Prüfeinstiege unter build (06.09.2026)

Kapitel: overview. Ronald möchte VS-Code-Tasks ohne eigene Ablauflogik und einen gemeinsamen
Ordner `build` für die aufgerufenen Skripte. Die Tasks starten deshalb ausschließlich Bash-
Skripte unter `build/`; auch die bisherigen pnpm-Befehle delegieren dorthin. Reihenfolgen und
Fehlerbehandlung stehen damit einmalig im Skript statt verteilt in Editor- und Paketkonfiguration.
Der Standardbuild erzeugt Agentenlaufzeit, Web und Homepage; die Gesamtprüfung behält ihre
bisherigen Schritte. Nur `.vscode/tasks.json` wird aus dem ignorierten Editorordner freigegeben.

## Öffentliche Baustein- und Entwicklerreferenz (06.09.2026)

Kapitel: overview. Ronald möchte die vorhandenen neutralen Bausteine sichtbar machen und alle
Erweiterungsmöglichkeiten mit kleinen Beispielen erklären. Die Homepage verlinkt deshalb zwei
generierte Unterseiten: einen Werkzeug-/UI-Katalog und eine Entwicklerreferenz. Werkzeugverträge,
UI-Props, Vorlagendateien und Referenzeinstiege werden aus ihren Quellen gelesen; die Beispiele
ordnen die Erweiterungspunkte nach ihrem Zweck. Eine Vertragsprüfung erkennt neue, noch nicht
abgedeckte Flächen, und `pnpm check:homepage` erkennt veraltete Ausgaben.

Die öffentliche Erfassung führt keine reale Profilkonfiguration aus. Sie verwendet ausschließlich
neutrale Plugins, eine isolierte Testkonfiguration und temporäre Ablage ohne Modell- oder Run-Start.
Private Produktnamen werden auch aus der Hauptseite entfernt; die Ausgaben werden auf private
Namen und lokale Pfade geprüft. Echte UI-Komponenten dienen als lokale, ausdrücklich beschriftete
Demos ohne Backend. Die Regeln zur Homepage stehen entsprechend in AGENTS.md, der Neuaufbau in
operations.md.

## Canvas-Steuerung unten und Run-Chat als Pop-out (06.09.2026)

Kapitel: plugins. Die schwebende Zoomleiste verdeckte beim Start links oben platzierte Actors.
Sie steht deshalb links unten. Ihr Chat-Schalter öffnet den Run-Chat als Pop-out darüber und
verändert die Canvas-Geometrie nicht mehr. Die alte Chat-Spalte und der gespeicherte
Öffnungszustand entfallen; die einstellbare Breite bleibt. Ein ausgeblendeter Chat bleibt
montiert, damit Nachrichtenentwurf und Anhänge beim Schließen erhalten bleiben. Fokus beim
Öffnen, Escape, Schließen-Knopf und Außenklick folgen der Bedienung eines Pop-outs. Homepage und
Bedienhinweise beschreiben die neue Anordnung.

## Multimodale Eingaben in allen Chats (06.09.2026)

Kapitel: core, plugins, run-modules. Ronald möchte Bilder aus der Zwischenablage und Dateien
einschließlich Videos direkt in jedem Chat verwenden. Der gemeinsame Composer übernimmt
Dateiauswahl, Einfügen, Drag-and-drop, Vorschau und den erhaltenen Entwurf bei Ablehnung. Seine
Sendeaktion trägt Anhänge bis zur Chat-API beziehungsweise durch die Mini-App-Bridge; gebundene
und gesteuerte Chat-Controls verwenden denselben Vertrag.

Die vorhandene Artefaktablage hält die Bytes, während das Run-Journal nur Metadaten und
Zustellungen speichert. Die Modelllaufzeit erhält echte Medieninhalte. Veröffentlichte
OpenRouter-Modalitäten bestimmen die Zulässigkeit von Bildern, Videos und nativen PDFs; die
Prüfung liegt sowohl vor dem Senden im Web als auch vor der Annahme im Server und im Treiber.
PDFs aktivieren ausdrücklich native Verarbeitung, damit kein anderer Verarbeitungsdienst
unbemerkt einspringt. Textdateien werden Textinput, andere Dateien benötigen Dateiwerkzeuge.
So zeigt die Oberfläche keine erfolgreiche Zustellung an, wenn Anhänge gar nicht zum Ziel
gelangen können. Homepage und Bedienhinweise beschreiben die gemeinsamen Eingaben.

## Homepage: vom Skill zum Setup und technische Journal-Erklärung (06.09.2026)

Kapitel: overview, core. Ronald möchte die Fähigkeiten über ihren Nutzen und ihre Konstruktion
erklären: vorbereitete Setups, programmierte Ablaufregeln und eigene Mini-Oberflächen stehen
deshalb vor den weiteren Funktionen. Die Homepage verbindet kurze Erklärungen mit aufklappbaren
technischen Details. Das Journal erhält ein lokales, interaktives Lesebeispiel und eine Erklärung
von Command-Records, Events, Projektion und Neustartgrenzen. Der falsche Satz in der README,
eine Journalzeile sei immer genau ein Event, wird samt Beispiel korrigiert.

Ronald entwickelt parallel und möchte keine neuen Läufe aufnehmen. An den Bildstellen stehen
deshalb ausdrücklich beschriftete Platzhalter; die Homepage-Regel erlaubt diese Zwischenform.
Refactoring und Unternehmensabläufe bleiben als Anwendungsideen gekennzeichnet und werden in
`docs/concepts/homepage-use-cases.md` geführt. Die Prüfungen betreffen ausschließlich die statische
Homepage. Die Anwendung und ihre Laufzeitdaten werden dafür nicht gestartet oder verändert.

## Run-Liste als Dropdown und direkter Zugang zum Koordinator (06.09.2026)

Kapitel: plugins. Ronald möchte die Run-Liste links oben über der Arbeitsfläche öffnen, ohne
deren Breite zu verändern. Sie wird deshalb ein anfangs geschlossenes Dropdown mit begrenzter
Breite und einer eigenen Bildlaufleiste. Die persistierte Seitenleistenbreite, der gespeicherte
Öffnungszustand und der Größenanfasser entfallen. Run-Auswahl und Löschen bleiben verfügbar;
Auswahl, Neuerstellung, Escape und der Wechsel nach außen schließen die Liste.

Beim Übernehmen einer Promptvorlage wird der Auftragsbereich zusätzlich ins Sichtfeld gescrollt.
So bleibt der ersetzte Entwurf auch nach einer Suche weiter unten in den Vorlagen unmittelbar
bearbeitbar. Die Auswahl sendet weiterhin nichts. Homepage und Bedienhinweise folgen der neuen
Anordnung.

Der übergeordnete Koordinator erhält `Cmd+I` beziehungsweise `Ctrl+I` zum Öffnen, Fokussieren und
Schließen. Sein Dropdown sitzt mittig unter dem Kopf. Ist bereits ein seitenweiter Dialog offen,
wechselt derselbe Chat in einen Dialog darüber. So bleibt er erreichbar, während Entwurf und
Fokus des bisherigen Dialogs erhalten bleiben. Der Anzeigewechsel erzeugt weder einen zweiten
Chat noch einen zweiten Stream.

## Run-Angaben und Navigation in einer gemeinsamen Kopfzeile (06.09.2026)

Kapitel: plugins. Ronald möchte die beiden Kopfbereiche zusammenführen und mehr Platz für die
Arbeitsfläche gewinnen. Navigation, Run-Titel und -Status, Plugin-Beiträge sowie der übergeordnete
Koordinator stehen deshalb in einer gemeinsamen Leiste. Die zusätzliche Run-Titelzeile und der
leere Streifen bei eingeklappter Run-Liste entfallen. Auf schmalen Fenstern bleiben die globalen
Aktionen über Symbole mit zugänglichen Beschriftungen erreichbar; zusätzliche Run-Angaben können
innerhalb der Leiste umbrechen.

Ein Portal erhält für die run-gebundenen Beiträge deren bestehende Provider und Dialoggrenze.
Run-Dialoge bleiben unter der gemeinsamen Kopfzeile, seitenweite Dialoge überlagern sie. Der
Startentwurf verändert die Kopfzeile des bisherigen Runs nicht. So verschiebt die Zusammenlegung
die Darstellung, ohne den Kontext der Plugin-Beiträge oder das Verhalten der Dialoge zu ändern.
Die Homepage beschreibt die gemeinsame Leiste.

## Auftragseingabe und Vorlagen auf der Startfläche trennen (06.09.2026)

Kapitel: plugins. Ronald möchte die Startfläche übersichtlicher gestalten. Die Auftragseingabe
steht jetzt allein oben, darunter folgen die vorhandenen Startoptionen und getrennte Bereiche
für durchsuchbare Promptvorlagen sowie vorbereitete Skills und Run-Scripts. Der eigenständige
Eingabebaustein braucht keine Nachrichtenliste oder Chat-Fläche um sich herum. Eine Promptfassung
ersetzt den Entwurf und fokussiert ihn; sie startet weiterhin keinen Lauf. Die Modellwahl nutzt
das gemeinsame Auswahlmenü mit kompakter Denktiefe daneben.

Die Neuordnung erhält den Plugin-Vertrag: Nur wählbare, noch nicht gesperrte Startoptionen werden
angeboten. Freigaben aus dem Profil, Leitfäden und die bestehenden Sende- und Startwege bleiben
maßgeblich. Die Homepage und die Bedienhinweise beschreiben die neue Anordnung.

## Vorgefertigte Chat-Controls für Mini-Apps (06.09.2026)

Kapitel: run-modules, plugins. Ronald möchte mehr vorhandene UI-Bausteine auf dem Canvas nutzen
und sowohl Actor-gebundene als auch frei gesteuerte Chats anbieten. Mini-Apps erhalten dieselben
Chat-, Eingabe-, Markdown- und Auswahlkomponenten wie der Host als typisierte `UI`-Bibliothek.
Die Variante mit Actor-Handle nutzt die bestehende Run-Verbindung und denselben Verlauf wie der
Inspector; der primäre Actor behält seinen Live-Stream. Die freie Variante erhält Nachrichten
und Sendeaktion vom App-Code. Eine Canvas-Vorlage macht den Actor-Chat direkt verfügbar.

Der Host bündelt die vorhandenen Komponenten mit esbuild und bindet sie an die bereits geladene
React-Instanz im Iframe. Damit bleiben Darstellung und Bedienung gemeinsam gepflegt. Chat-Eingaben
gehen über den vorhandenen menschlichen Actor-Input-Weg; dafür braucht eine App keine eigene
Manifest-Aktion. Fehlgeschlagene Sendungen erhalten den Entwurf, reine Ansichten zeigen Rückfragen
ohne wirkungslose Eingabefelder. Die Homepage beschreibt die neuen Bausteine.

## Canvas-Mini-Apps ohne Fensterkopf (06.09.2026)

Kapitel: run-modules, plugins. Ronald möchte die kleinen Bedienoberflächen auf dem Canvas stärker
in den Vordergrund stellen. Die zusätzliche Kopfzeile mit App-Icon, Titel und Einklapp-Knopf
entfällt; die App bekommt die gesamte Fläche. Laufzeitmeldungen wandern kompakt an den unteren
Rand, Skalieren bleibt möglich. Mit dem einzigen Nutzer entfällt auch die Einklapp-Logik aus dem
Canvas-Beitragsvertrag und dem Layout. Die Hervorhebung anhand des rechts gewählten Reiters und
der harte Schlagschatten entfallen ebenfalls. Der Agentenprompt bevorzugt Canvas-Platzierungen
für neue Bedienoberflächen. Eine spätere Ablösung des rechten Panels bleibt als Richtung in TODO;
die vorhandenen Reiter bleiben nutzbar.

## Seitenweiter Koordinator und getrennte Dialogbereiche (06.09.2026)

Kapitel: plugins, core, profiles, run-modules. Ronald möchte einen jederzeit erreichbaren Chat
über allen Runs, während run-eigene Dialoge die Kopfzeile freilassen. `ragents.overseer` liefert
den ausklappbaren Chat in der neuen oberen Leiste und Werkzeuge zum Lesen der Journale und
Steuern weiterer Runs. Sein Verlauf ist ein eigener persistenter Run; kurze Referenzen löst der
Server auf. Die normalen Koordinatoren bekommen diese Werkzeuge nicht. Der Host rendert den
seitenweiten Kopfbeitrag über einen Plugin-Slot, damit das Entfernen des Plugins auch die
Oberfläche entfernt.

"Neuer Run" öffnet die vorhandene Startfläche als großen seitenweiten Dialog ohne rechten
Arbeitsbereich. Escape verwirft den Entwurf und kehrt zur vorherigen Unterhaltung zurück; nach
Annahme des Einstiegs öffnet sich der neue Run. Run-eigene Dialoge erben dagegen ihre Arbeitsfläche
als Portal- und Eingabegrenze. Die Kopfzeile und der übergeordnete Chat bleiben dadurch sichtbar
und bedienbar. Verschachtelte Dialoge behandeln Escape nur einmal und geben den Fokus zurück.
Die Homepage beschreibt beide Einstiege; die veralteten Gesamtansichten sind herausgenommen.

## Homepage erklärt den programmierbaren Harness (05.09.2026)

Kapitel: overview. Die Homepage begann mit Laufzeitbegriffen und beschrieb anschließend viele
Bedienelemente, bevor klar wurde, was RAgents ist. Der Einstieg benennt jetzt den programmierbaren,
modellagnostischen AI-Harness; Canvas, Agenten, TypeScript, Mini-Apps und Plugins erklären danach
die Arbeitsweise. Kürzere Absätze, größere echte core-Screenshots und aufklappbare Details ersetzen
die nummerierte Oberflächenführung. Die Modellwahl benennt die aktuelle OpenRouter-Anbindung,
Run-Scripts stehen als vorhandene Fähigkeit beim Einstieg. Run-Vorlagen bleiben im Ausblick;
die pauschale Bestätigungspflicht für App-Aktionen und ein veraltetes Inspector-Bild entfallen.
Die Seite bleibt eine statische Datei ohne externe Ressourcen; an der Anwendung ändert sich nichts.

## Der Koordinator-Chat verlässt die Fläche (05.09.2026)

Kapitel: plugins. Ronald: "lass uns diese Koordinator-Chat-View bitte von dem Canvas entfernen."
Das ist der Kern von Entwurf 1 (Kommandobrücke) aus `docs/ui-drafts/bedienkonzept.html`: der
Chat war ein 820 mal 1020 Pixel großes Weltobjekt, das mit der Fläche zoomte, das Layout musste
es rechts umfahren, und ein Knopf "Chat" holte die Kamera zurück. Jetzt ist der Chat eine feste
Spalte links neben der Fläche, in Lesegröße, ziehbar (320 bis 760 Pixel) und über die Zoomleiste
einklappbar; `CHAT_WORLD` und der Rückkehr-Knopf sind weg, das Layout beginnt im Ursprung, die
Kamera passt nur noch auf die Layout-Grenzen. Der Beitragsvertrag bleibt: der Canvas-Eigentümer
rendert den Chat weiter über `renderChat` und hängt den Not-Aus in `toolbarLeft`. Offen aus dem
Bedienkonzept bleiben die Varianten für die Run-Liste (A Wähler im Kopf, B Rail, C zwei Fächer)
und die anderen Entwürfe; die Run-Liste steht unverändert als Seitenleiste.

## Run-Scripts: ein Einstiege-Vertrag, Start ohne Nachricht, run_configure (05.09.2026)

Kapitel: plugins, core, typescript-platform. Ronald wollte das Run-Script-Feature komplett, also
Schritte 2 bis 5 des Konzepts `run-start.md`, das damit gelöscht ist. Festgelegt:

- EIN Vertrag `host.startEntries` statt `promptCards` und `starters`: dieselbe Karte, drei
  Aktionen (`prompt`, `skill`, `script`), `guide` je Einstieg. Das Web bekommt `startEntries` im
  Bootstrap, ein Script-Einstieg reist ohne Quelle. Der Wire-Vertrag liegt geteilt in
  `apps/server/src/plugin-support/start-entries-contract.ts`; ein Typtest hält ihn deckungsgleich
  mit `PublicStartEntry` der Engine.
- Run-Scripts sind Pakete `run-scripts/<name>/` mit RUN.md, setup.ts, tests.json und optional
  apps/; der Ordnername ist der Handle (Paketname statt festem `@setup`, damit die Fläche sagt,
  welches Script den Run gebaut hat). Der Host prüft, testet und installiert beim Klick ohne
  Modell über `setUpScriptActor`; `POST /chat/<id>/start` ist die Route ohne Nachricht. Erst das
  Script, dann der Koordinator: ein scheiterndes Script hinterlässt einen leeren Run und keinen
  halben, ein leerer Run nimmt den nächsten Einstieg an.
- `run_configure` (Titel, Primary-Actor) unter der zehnten Capability `run.configure`, dazu das
  Ereignis `run.title-changed`. Der Besitzer konfiguriert von Rechts wegen, andere brauchen den
  Grant. Damit geht `coordinator: false`: der Host spawnt keinen Koordinator, das Script wählt.
- `canvas_layout_replace` und `mini_app_*` gelten für jeden Actor außer dem Menschen mit den
  passenden Capabilities, nicht mehr nur für Agenten; sonst könnte kein Script die Fläche bauen.
- Ein installiertes Run-Script hat `toolNames: null`, damit gespawnte Agenten die volle Auswahl
  erben; die Capability-Liste des Builds bleibt die Grenze für das Script selbst.
- Ein bewusst gesetzter Titel (Paket, `run_configure`) schlägt in der Run-Liste die Heuristik aus
  der ersten Nachricht; die Titel-Kompaktierung läuft dann gar nicht.
- Drei Referenzpakete in `ragents.reference` neben den Karten: Gesprächsrunde, Werkzeug und
  Mini-App (mit `apps/`), Moderierte Runde ohne Koordinator. Alle drei live im Profil core
  gestartet: Fläche, Mini-App und Moderator als Primary-Actor standen ohne Zutun des Modells.
- Befunde des Reviews vom selben Tag behoben: `useChat.send` wirft bei abgelehnter Antwort, die
  Startfläche kommt zurück und zeigt den Fehler; ohne Skills und Run-Scripts gehört die Breite dem
  Chat; die Promptkarten tragen das Plugin klein an der Karte statt der Plugin-ID als Überschrift;
  die Homepage zeigt die Startfläche mit Run-Scripts statt des alten leeren Chats.

## Journal-Lock mit Herzschlag statt Handarbeit (05.09.2026)

Kapitel: core. Ein Serverstart scheiterte an einem Lock, dessen Prozess seit Stunden tot war;
Ronald: "Wie können wir verhindern, dass wir solche Locks haben?" Befund: SIGINT und SIGTERM
räumten auf, aber Absturz-Handler und die Shutdown-Zeitüberschreitung endeten in `process.exit`
ohne `journal.close()`, SIGHUP hatte keinen Handler, und ein hartes Beenden lässt ohnehin keinen
Handler laufen. Dazu lehnte das Journal jedes vorhandene Lock ab, obwohl es die Prozess-ID kannte.
Festgelegt, zwei Schichten:

- Freigeben, wo es geht: SIGHUP wie SIGTERM, und ein `exit`-Hook schließt das Journal synchron,
  sodass auch Absturz und Zeitüberschreitung das Lock zurückgeben.
- Ein verwaistes Lock erkennen: die Besitzerdatei trägt Prozess-ID, Hostname und einen Herzschlag,
  den der Besitzer alle fünf Sekunden erneuert. Beim Öffnen wird übernommen, wenn der Prozess auf
  demselben Host tot ist oder der Herzschlag älter als 30 Sekunden ist, mit Warnung im Protokoll;
  der Herzschlag deckt wiederverwendete Prozess-IDs und den Container ab, der andere IDs sieht als
  der Host. Ein lebender Writer mit frischem Herzschlag bleibt hart abgelehnt. Wessen
  Besitzerdatei verschwindet, der schreibt nicht mehr und meldet es. Die frühere Regel "niemals
  automatisch übernommen" schützte vor zwei Schreibern, nicht vor einem toten Prozess; diese
  Grenze hält der Herzschlag weiter.

## Einstiege der Startfläche ohne Kästen (05.09.2026)

Kapitel: plugins. Ronald zum ersten Stand der Startfläche: "skills und vorgebaute runs will ich
nicht in kästen gruppiert". Die zwei gerahmten Bereiche Skills und Vorgebaute Runs mit ihren
Kopfzeilen und der Gruppierung nach Plugin sind weg. Neben dem Chat-Control steht jetzt EINE Fläche
mit den Einstiegen, die den Run ohne Nachricht starten, als Karten direkt auf dem Grund: heute die
Starter mit dem Abzeichen Skill und dem Plugin klein an der Karte, später die Run-Scripts als
weitere Karten (`apps/web/src/StartSurface.tsx`, `start-layout`, `start-entries`, `entry-grid`).
Die Promptkarten bleiben unverändert Teil des Chat-Controls. Entwurf 5 der Mockups ist
nachgezogen.

## Produkt-Homepage unter docs/homepage (05.09.2026)

Kapitel: keines; geändert sind AGENTS.md (Dokumentation, Arbeitsregel 6) und README (Weiterlesen).
Ronald will neben Spec und Konzepten eine Homepage für Benutzer mitpflegen: Produktsicht statt
Technik, gegliedert nach dem, was man tun kann. Drei unabhängig ausgearbeitete Strukturen standen
zur Wahl: Aufgaben ("Ich will ..."), Rundgang entlang der Oberfläche, Fähigkeiten als Säulen.
Gewählt ist die Aufgabenstruktur, weil sie die Frage des Benutzers beantwortet und nicht an der
heutigen Anordnung der Oberfläche hängt: der Rundgang veraltet mit dem Bedienkonzept-Umbau, die
Säulen beschreiben, was das System ist, nicht, was man damit macht. Aus den anderen beiden
übernommen: jeder Abschnitt nennt mindestens eine Promptkarte aus
`plugins/ragents.reference/prompt-cards` als Beleg (fällt die Karte, fällt der Abschnitt auf); die
Seite zeigt nur, was im Profil `core` läuft, ein Produktprofil steht in genau einem Abschnitt
als Beispiel; ein Begriffsstreifen mit fünf Wörtern steht vorn, das Journal wird als Nutzen
erzählt (Neustart, Nachlesen), nicht als Architektur.

Festgelegt: EINE lange Seite `docs/homepage/index.html` mit Sprungleiste, ohne Build-Schritt;
Screenshots aus echten Läufen des Profils `core` unter `docs/homepage/screenshots/` (Lauf der
Promptkarte "Team als Baum, Themen im Raster", Startbildschirm, Inspektor, Einstellungen). Wo kein
echter Lauf vorlag (Vermittler, Rückfrage und To-do an der Karte, Werkzeugkarte, Mini-App an drei
Orten, Dokumente-Reiter), stehen Schemata, die als solche beschriftet sind; sie durch Screenshots zu
ersetzen steht in TODO.md. Ausgeschlossen sind Architektur, Event- und Werkzeugnamen, Plugin-IDs,
Zählungen, Sicherheitsversprechen (laut Kurs nachrangig) und Konzepte als Features; Konzepte stehen
nur im Ausblick als Idee. Bedeutung wird auf der Seite nie über Farbe allein codiert (Form,
Strichart, Text, Position; Akzente nur Blau und Bernstein).

Nachtrag vom selben Tag: die erste Fassung las sich wie ein generierter Prospekt: Slogan-Überschriften
nach einem Muster ("X statt Y"), drei Claim-Kacheln, siebzehn gleich gebaute Abschnitte mit
Bullet-Rastern und fetten Satzanfängen, Chips, erfundene Beispiele in Schemata, 14000 Pixel Länge.
Ronald: kein Werbeprospekt, eine nüchterne Beschreibung, was das Ding ist und was es kann, mit
einem Satz "RAgents ist ..." am Anfang. Festgelegt: Stimme der README, Überschriften benennen die
Sache, Fließtext statt Bullets, nur echte Screenshots (Schemata gestrichen), Promptkarten als
schlichter Satz "Zum Ausprobieren", ein Drittel der Länge, eine Spalte mit den Tokens und der Schrift
der App, keine Karten, Schatten oder externen Ressourcen. Der Text wurde erst als Rohfassung
freigegeben, dann ins HTML übernommen.

## Neuer Run und Startfläche statt leerem Chat (05.09.2026)

Kapitel: plugins. Erster Schritt des Konzepts `docs/concepts/run-start.md`. Ronalds Einwand:
"Neue Unterhaltung" ist ein neuer Run, und der Composer ist nicht der einzige Einstieg, sondern
einer unter den Karten, die Plugins mitbringen. Festgelegt:

- Wording im Web: "Neuer Run", "Runs", "Run löschen"; der Standardtitel `runTitle` beider
  Produkt-Plugins ist "Neuer Run". Unterhaltung bleibt in Prosa und Spec das erklärende Wort.
- Die Startfläche ist ein eigener Zustand des Entwurfs (`apps/web/src/StartSurface.tsx`), nicht
  mehr der `emptyState` der Nachrichtenliste: die Startoptionen als Zeile oben, darunter drei
  gleichberechtigte Bereiche nebeneinander (Ronalds Entscheidung, Entwurf 5 der Mockups): der
  Chat als das heutige Chat-Control mit Promptkarten und Composer, die Skills (Starter, nach
  Plugin gruppiert, mit Textabzeichen der Art) und die vorgebauten Runs (Run-Scripts und
  Leitfäden; bis Schritt 3 des Konzepts nur ein Hinweis). Keiner der Bereiche ist die Mitte,
  keiner eine Zeile am Rand. Das Zentrum wechselt mit dem ersten `send` auf Canvas und Chat; der
  Wechsel wird lokal gemerkt, weil `send` die Nachricht nicht optimistisch einträgt und die
  Fläche sonst bis zum SSE-Echo stehen bliebe.
- Die Klickpfade sind in der Wirkung unverändert: eine Promptkarte füllt den Composer, ein
  Starter sendet sofort oder öffnet zuerst seinen Leitfaden. Kein neuer Server-Vertrag;
  `promptCards` und `starters` bleiben zwei Registries, das Einschmelzen ist Schritt 2 des
  Konzepts und offen.
- Der rechte Arbeitsbereich bleibt auf der Startfläche erreichbar, weil Fachabfragen eines
  Plugins mit Übergabe an den Chat vor der ersten Nachricht gebraucht werden.
- Das CSS der alten Kartenlisten (`prompt-selection`, `prompt-cards`, `starter-cards`) ist weg.

## Konzeptpapiere eingeschmolzen, Kapitel gegen die Entscheidungen abgeglichen (04.09.2026)

Kapitel: run-modules, typescript-platform, core, plugins, profiles, overview. Schritt 2 des
Doku-Umbaus: `docs/concepts/mini-apps.md` und `docs/concepts/typescript-platform.md` sind in
`run-modules.md` und `typescript-platform.md` aufgegangen und gelöscht, die Übergangssätze am
Kapitelanfang sind weg. Gestrichen wurde, was Geschichte oder Nachweis ist (Ausgangsproblem der
Migration, umgesetzte Migration, Abnahme-Listen; Tests sind der Nachweis) und was der Code nicht
hergibt: `_generated/ragents.d.ts` liegt nirgends, Testnachweise sind serverseitig geführt mit 30
Minuten Gültigkeit statt HMAC-signiert, einen `environmentHash` gibt es nicht, das
Beispiel eines vorbereiteten Ablaufs ist Produktgeschichte. Bestätigt und übernommen: Platzierungsgrenzen (280 bis 960 mal 180
bis 720, Standard 480 mal 320, höchstens acht), Dialoggrößen, Compileroptionen, Worker-Grenzen,
Regex-Schranken, React 18.3.1 als UMD, Request-ID-Dedup, 250-kB-Grenze.

Abgleich der älteren Einträge: `core.md` beschreibt jetzt die drei Laufzeitpakete mit ihrem eigenen
Verhalten, Steering im Detail, Validierungsfehler als Journal-Ereignisse, die Redaktion der
Werkzeugergebnisse, `outputs` je Turn und Modellwahl beim Spawn; `plugins.md` bekommt den Abschnitt
zu Sandbox-Werkzeugen, Prozessleiste und Datei-Browser, die Kamera-Regel der Fläche und den
TypeScript-Sonderfall des Sprachservers; `profiles.md` die Rollen eines Produktprofils, den vorbereiteten
Ablauf, den Git-Token und die Fachumgebung; `overview.md` die vier Vertragsregeln (flache Schemata,
unrepräsentierbare Zustände, nichts abtippen, Ablehnungen nennen Namen).

## Drei Rückbauten aus der TODO-Liste (04.09.2026)

Kapitel: keines, reine Bereinigung ohne Verhaltensänderung nach außen. `unqueueSteering` der
Agentenlaufzeit hatte keinen Aufrufer und ist samt `removeQueuedSteering` und
`PendingMessageQueue.removeFirst` entfernt; Steering-Warteschlangen werden bei `reset` und Abbruch
geleert und sonst mit Absicht am Anfang des nächsten Laufs zugestellt. `env-api-keys.ts` in
packages/ai kennt nur noch OpenRouter, den einzigen Provider dieses Forks (`KnownProvider`); die
dreißig fremden Provider-Variablen, die Vertex- und Bedrock-Sonderpfade und die dynamischen
node:-Imports sind weg. Die Plugin-Aktivierung im Web hat einen discovery-freien Kern in
`apps/web/src/plugin-bootstrap.ts` (Prüfung der Bootstrap-Antwort, Lader aus dem Bundle-Pfadmuster,
Aktivierung); `import.meta.glob` steht allein in `plugin-discovery.ts`, der Kern ist ohne Vite
getestet. Der Selbsttest-Befund "ls mit unexpandiertem $RAGENTS_FILES_DIR" ist mit dem Wegfall des
ls-Werkzeugs gegenstandslos und aus der TODO-Zeile gestrichen.

## Gruppenrahmen auf der Fläche nur auf Ansage (04.09.2026)

Kapitel: plugins. Jede Layoutgruppe bekam automatisch einen gestrichelten Rahmen; Ronald will
das nicht als Automatik, sondern als Entscheidung des Modells je Gruppe. Festgelegt: eine Gruppe
zeigt ihre Beschriftung (`label`) immer als Überschrift, einen Rahmen zeichnet sie nur mit
`frame: true` (Standard false). Der automatische Bereich "Nicht platziert" trägt nur die
Überschrift. Intern ist `frame` ein Pflichtfeld mit Wert, kein Optional.

## Dokumentation: Spec, Konzepte, Entscheidungen (04.09.2026)

Kapitel: alle. Die Dokumentation hatte drei Quellen für "was ist" ohne Vorrang: das
Architekturdokument, die Wissensbasis und zwei umgesetzte Konzeptpapiere, deren Kurzfassung im
Architekturdokument stand. Festgelegt:

- `docs/spec/` ist die Spec: was ist, gültig für HEAD, ein Kapitel je Thema (overview, core,
  typescript-platform, run-modules, plugins, profiles). Jedes Kapitel endet mit seinen offenen
  Grenzen. Die Kapitel sind aus dem Architekturdokument und `packages/ragents/docs/` entstanden.
- `docs/concepts/` enthält nur, was noch nicht ist, mit Status Idee, In Arbeit oder Verworfen. Ein
  umgesetztes Konzept wird ins Kapitel eingeschmolzen und gelöscht; "umgesetzt" ist kein Status.
  Die zwei umgesetzten Papiere `mini-apps.md` und `typescript-platform.md` werden als nächster
  Schritt eingeschmolzen und gelten bis dahin als Teil der Spec.
- Diese Datei (vorher `KNOWLEDGE-BASE.md`) ist das Warum: datiert, jüngste zuerst, jeder Eintrag
  nennt sein Kapitel. Sie ist keine zweite Spec; die drei Kurs-Grundsätze stehen jetzt in
  `docs/spec/overview.md`.
- `TODO.md` ist der Eingang für Arbeit und Ideen, `docs/operations.md` das Bedienhandbuch,
  `AGENTS.md` der Einstieg für KI-Sessions samt der Regel, wie Arbeit dokumentiert wird.
  Claude-Memory wird nicht benutzt, weil Ronald auf mehreren Rechnern arbeitet; alles für neue
  Sessions Wichtige steht im Repo.
- `HANDOFF.md` ist aufgelöst: die Arbeitsregeln stehen in `AGENTS.md`, der Testweg des
  Feature-Laufs in `docs/operations.md`, der Rest in `TODO.md`.

## Prozesse und Ports eines Laufs stehen in der Kopfzeile (03.09.2026)

Ronalds Wunsch: startet ein Agent während eines Laufs einen Prozess (Node, dotnet, vite, ...) und
öffnet der einen Port, soll das von selbst oben in der Leiste erscheinen. Festgelegt:

- Zuordnung über EINEN Marker: `sanitizedEnv` setzt `RAGENTS_RUN_ID=<runId>` in die Umgebung jedes
  Sandbox-Prozesses (Bash-Kinder, Sprachserver, alles über `processContextFor`). Ein Prozess gehört
  zum Lauf, wenn er den Marker trägt, egal wie er gestartet oder umgehängt wurde. Keine Heuristik
  über Prozessbaum oder Arbeitsverzeichnis.
- Das Plugin `ragents.processes` liest die Prozesstabelle je Plattform: macOS über `ps` (Marker per
  `ps -E`, nur für Prozesse desselben Benutzers sichtbar; Apple-Systembinaries wie `/bin/sleep`
  oder `/bin/bash` verbergen ihre Umgebung, das ist unkritisch) und `lsof` für lauschende
  TCP-Ports; Linux über `/proc` (`stat`, `status`, `cmdline`, `environ`, `fd`, `net/tcp{,6}`), ohne
  `ps` oder `lsof` im Image. Als root braucht das Lesen fremder `environ`/`fd` CAP_SYS_PTRACE; die
  Berechtigung muss dem Container erteilt sein (`cap_add: SYS_PTRACE`). Fehlt die Berechtigung oder ein
  Werkzeug, ist das ein benannter Fehler in der Kopfzeile, kein stilles Nichts.
- Gezeigt werden Hintergrundprozesse immer und Kinder eines laufenden Werkzeugaufrufs nur mit
  offenem Port. "Im Werkzeugaufruf" heißt: die Prozessgruppe gehört einem Kind des Servers (Bash-
  Kinder sind Gruppenführer); alles andere ist Hintergrund. `bash`, `git` und `dotnet build`
  bleiben so unsichtbar, `vite` im Vordergrund ist über seinen Port sichtbar, ein abgesetzter
  Dienst auch ohne Port.
- Laufzeitressource, kein Journal-Zustand: ein Beobachter je Server scannt alle beobachteten Läufe
  mit EINEM Tabellenscan alle zwei Sekunden, aber nur solange ein Browser den SSE-Strom
  (`.../processes/watch`) hält; Marker werden je (PID, Startzeit) genau einmal gelesen.
  `GET .../runs/<id>/processes` liefert denselben Stand für curl.
- Kopfzeile: eine Pill je Prozess mit Art (Dienst/Prozess), Label (`node vite`,
  `dotnet Service.dll`) und Port-Links auf `http://<Host der Oberfläche>:<Port>/`. Hintergrund
  ist am gestrichelten Rahmen und im Tooltip erkennbar, nie an einer Farbe.
- Bewusst nicht dabei: Beenden per Klick und das Aufräumen markierter Prozesse beim Stoppen des
  Laufs (die Sandbox killt nur ihre Prozessgruppen; ein abgesetzter Dienst überlebt den Lauf).
  Beides steht in TODO.md.

## Startoptionen sind ein Beitrag, das Arbeitsverzeichnis ist je Unterhaltung leer (04.09.2026)

Was der Benutzer vor der ersten Nachricht festlegt, ist ein generischer Erweiterungspunkt
(`host.startOptions`, Web-Slot `startOptions`), kein fest verdrahtetes Paar aus Modell- und
Promptwahl mehr. Festgelegt:

- Eine Startoption nennt Schema, Standardwert, `selectable`, `accept` und `describe`. Der Host
  hält den Wert je Entwurf (`GET/PUT /chat/<id>/options[/<optionId>]`), prüft jeden Wert gegen das
  Schema und lässt `accept` des Besitzers entscheiden; beim Anlegen des Runs wandert jeder Wert als
  initialer Plugin-Zustand unter der Option-Id ins Journal, danach ist er gesperrt (409). Der Wert
  eines gestarteten Runs kommt ausschließlich aus dem Journal. Wer im Web keine Komponente
  liefert, bekommt ein Auswahlmenü aus `{ kind: "choice", label, options }`; alles andere ist ein
  sichtbarer Fehler, kein Fallback.
- `ragents.model` und `ragents.system-prompt` sind die Startoptionen des Produkt-Plugins
  (`plugin-support/product-start-options.ts`, Web in `plugins/ragents.product/web`). Die Sonderrouten `/model` und `/prompt`, die Felder in
  `RunChatSession` und die festen Picker sind weg. Der Engine-Kern liest nur den
  Systemprompt-Zustand für die Promptkomposition; das Modell des Koordinators liest die Session
  beim Spawn aus dem Journal.
- `ragents.workspace` gibt jeder Unterhaltung ein leeres Verzeichnis unter der Session-Ablage;
  `STATIC_WORKSPACE_DIR` ist weg, weil sich zwei Unterhaltungen im selben Verzeichnis im Weg
  stehen. Inhalt oder ein anderes `cwd` liefert ein Plugin über `workspaceResolverToken`; nennt es
  eine `optionId`, kommt die Wahl des Benutzers aus dem Journal, und vor dem Start gibt es kein
  Arbeitsverzeichnis (409 `run-not-started`). Der Host löst das Arbeitsverzeichnis deshalb erst
  nach dem Anlegen des Runs auf (`prepareWorkspace` in `#startRun`), die Lebenszyklus-Vorbereitung
  läuft weiter vor jeder Nachricht. Der Resolver muss für dieselbe Wahl dasselbe `cwd` liefern;
  die Agentenlaufzeit lehnt ein gewechseltes Arbeitsverzeichnis hart ab.
- Die Dateiablage gehört `ragents.documents` (`documentStoreToken`, `directoryFor(runId)`), nicht
  mehr dem Workspace-Vertrag: standardmäßig `sessions/<id>/plugins/ragents.documents/documents`,
  mit `DOCUMENTS_DIR` ein Unterordner je Unterhaltung unter einem externen Pfad, den der Host beim
  Löschen nicht anfasst. Die frühere feste Dateiablage-Variable und `filesFor` im Workspace-Vertrag
  sind weg; die Sandbox holt `RAGENTS_FILES_DIR` optional beim Dienst, ein Produkt-Workspace
  setzt nur noch die Besitzrechte, `ragents.mini-apps` verlangt `ragents.documents`. Nebenbefund behoben: die alte
  Ablage lag in der globalen Plugin-Ablage und überlebte das Löschen der Unterhaltung.
- `PluginRegistration.optionalService` ergänzt `service` für Dienste, die fehlen dürfen.
  `WorkspaceRuntime.describe()` kennt nur noch `mode` und `directoryPattern`; die Einstellungen
  zeigen Workspace- und Dateiablage-Muster je Run.

## Die Fläche gestaltet der Koordinator, das Netz zieht keine Linien mehr (03.09.2026)

Das Kräfte-Layout der Netzansicht ist ersetzt: Karten, Apps und Formen liegen in geschachtelten
Layoutgruppen (`h`, `v`, `wrap-h`, `wrap-v`, `grid`, `circle`, `tree`), die ein Agent mit
`canvas_layout_replace` als Run-Zustand des Orchestration-Plugins setzt. Festgelegt:

- Das Werkzeug ersetzt immer das GANZE Layout. Eingabeschema flach nach der Regel unten:
  Diskriminator `group`, Elemente als `entity` in `@handle`, `shape:<id>` oder `app:<id>`, Eltern
  über `parent`, Wurzelebene stapelt vertikal. `wrap-h` verlangt `width`, `wrap-v` `height`,
  `grid` `columns`, `tree` `root`; fremde Parameter sind ein Fehler, der die passende Gruppe
  nennt. Der geteilte Parser in `plugins/ragents.orchestration/contract.ts` prüft das auf Server
  und Web und liefert intern eine diskriminierte Union; der Server prüft zusätzlich gegen den
  Lauf (Handle vorhanden, kein Mensch, Abstammung eines Baums nicht doppelt platziert).
- Linien gibt es NUR auf Ansage und nur von Entität zu Entität (`arrow`, `style`, `label`). Die
  früheren automatischen Kanten (Abstammung, Chat-Anker, App-Anker) sind weg. Bedeutung tragen
  Pfeil, Linienstil und Text, nie eine Farbe; Gruppen tragen Rahmen und Beschriftung.
- Formen (`circle`, `diamond`) tragen immer einen Text und werden wie Actors platziert.
- Nicht platzierte Actors erscheinen deterministisch unter dem Layout als Abstammungsbäume
  (Vater oben bündig, Kinder rechts untereinander, geankerte Apps unter ihrer Karte), nicht
  platzierte Apps ohne bekannten Anker in einer umbrechenden Zeile. Gibt es ein Layout, trägt
  dieser Rest den Rahmen "Nicht platziert". Unbekannte Entitäten und unlesbare Layouts werden
  sichtbar gemeldet, nie still verschluckt.
- Die Engine ist ein reines measure/arrange (`web/canvas-layout.ts`), die Szene baut
  `web/canvas-scene.ts`; beides ist ohne React getestet. Kartenmaße kommen weiter aus der
  DOM-Messung; die ungefähren Standardmaße stehen in der Werkzeugbeschreibung und im Prompt
  `canvas.hbs`, der nur mit dem Werkzeug erscheint.

## Sandbox-Werkzeuge sind read, edit, write und bash (02.09.2026)

`ls`, `grep`, `find` und `typescript_check` sind gestrichen: nichts davon konnte etwas, was `bash`
nicht auch kann (`typescript_check` war nur `pnpm exec tsc --noEmit` im Arbeitsverzeichnis), und der
einzige Grund, solche Werkzeuge getrennt zu halten, wäre eine Berechtigungsstufe unterhalb von Bash,
die es in der Sandbox nicht gibt. Geblieben sind `read` (Zeilennummern, Kürzung), `edit` (eindeutiger
Treffer, Diagnostik-Anhang), `write` (Diagnostik-Anhang) und `bash`. Die Sprachserver-Werkzeuge
(`<server>_open`, `<server>_diagnostics`) bleiben, sie liefern Diagnosen ohne Build. Das
Namensmapping in `workspace-tool-naming.ts` kennt nur noch diese vier; `scriptTool` und
`WorkspaceOperation` hatten keine Aufrufer und sind weg.

## TypeScript-Sprachserver publiziert nur geänderte Diagnosen (02.09.2026)

Ein `edit` an einer fehlerfreien TypeScript-Datei hing 60 s: der Annotator wartet nach `didChange`
auf `publishDiagnostics` für die neue Version, aber typescript-language-server (6.0,
`FileDiagnostics.update`) schickt nichts, wenn die Diagnosen je Art vorher leer waren und leer
bleiben. Nach `didClose` publiziert er dagegen immer und verwirft den Eintrag, ein folgendes
`didOpen` liefert garantiert frische Diagnosen. Die Session kennt dafür die Launch-Eigenschaft
`publishesOnlyChangedDiagnostics` (nur der TypeScript-Adapter setzt sie): ist die letzte
publizierte Diagnostik der Datei leer und der Text geändert, schließt sie das Dokument, wartet auf
die Bestätigung und öffnet es neu, statt `didChange` zu senden. Roslyn nutzt Pull-Diagnostik und ist
nicht betroffen. Der Live-Test `TypeScript reports errors ...` prüft den Fall fehlerfrei zu
fehlerfrei mit Zeitschranke (`RAGENTS_LSP_TESTS=1`).

## Git ist in der Sandbox frei (02.09.2026)

Was Git und Bash ohnehin können, ist kein Werkzeug mehr. Die Bash-Sandbox hatte einen Parser, der
push/fetch/pull/merge/rebase und fremde Branch-Wechsel blockierte, dazu eine Git-Policy-Registry, an
der genau ein Plugin hing. Beides ist entfernt: `git` läuft ohne Einschränkung im
Session-Arbeitsverzeichnis, der Schreib-Token kommt als `http.<Git-URL>.extraheader` über
`gitHttpConfigPairs()` in die Git-Umgebung der Bash (`SessionWorkspace.gitConfig`) und in die
Routen-Git-Umgebung (`gitSession`); der Header ist an die Origin-URL gebunden, damit `git` ihn
nicht an fremde Hosts schickt. Push ist damit ein gewöhnliches `git push`, kein Capability und
nichts doppelt registriert.

- Ein Fachplugin, das einen Abgleich fuhr, ist eingedampft: eigene Werkzeuge, Operationen,
  Zustandsdatei, Protokolldatei und eine Mini-App-Vorlage sind weg. Geblieben sind der Skill
  (alles per `git`/`bash`, Vollbau als Bash-Schritte), der Starter und der Reiter. Der Reiter
  liest den Branchstand direkt aus Git des Session-Arbeitsverzeichnisses (`GET .../branches`,
  `POST .../refresh` mit fetch) und pusht je Branch serverseitig per `git push`
  (`POST .../push`). Es gibt nur noch eine Git-Identität für Fetch und Push.
- Ein Einzelabruf als Werkzeug ist entfernt. Der Agent liest ein einzelnes Fachobjekt per `curl`
  gegen die HTTP-API. Dazu gibt das Fachplugin seinem Vorausgesetzten über
  `contributeSandboxEnv` Origin, Sammlung und Token in die Bash-Umgebung
  (`SessionWorkspace.extraEnv`). Der Bediener-Client bleibt, weil er die Reiter-Ansicht speist
  und kein Bash-Ersatz ist.
- Die alte Branch-Sperre der Änderungen-Ansicht (`branchBasis` warf auf jedem Branch außer
  `main`/`main-*`) ist gelockert: die Basis ist die Merge-Base gegen `origin/main` für jeden
  ausgecheckten Branch, sonst bricht die Verteilphase eines Abgleichs die Ansicht.

## Der Quellcode eines Run-Moduls steht im installierten Build (02.09.2026)

Der Werkzeuge-Reiter zeigt den Quellcode eines Run-Werkzeugs und einer Dialog-Mini-App. Gezeigt
wird ausschließlich der installierte Build, nie der Arbeitsstand unter `_apps/<appId>/`: der Ordner
darf nach dem Installieren weiterbearbeitet worden sein, und eine Ansicht, die beides vermischt,
belügt den Bediener. Handler-Quellen, `styles.css` und `index.html` standen ohnehin schon in der
Moduldefinition; `module.json` und `client.tsx` legt die Installation als Snapshot unter
`host.storage.session(runId, "module-sources")/<app>/<compilationHash>/` ab, nicht im Journal:
der Modulzustand teilt sich sonst mit den Quellen die 250-kB-Grenze und reist mit jeder
Run-View-Abfrage ins Web. Fehlt der Snapshot (App vor dieser Ablage installiert), ist das ein harter
Fehler der Quellcode-Route; alle anderen Pfade bleiben unberührt.

## Validierungsfehler sind Journal-Ereignisse (02.09.2026)

Weist die Agentenschleife einen Werkzeugaufruf ab, bevor er läuft (Schemaverstoß, unbekannter
Name, blockiert), sah bisher nur das Modell den Fehlertext: Der Treiber merkte sich für die von
RAgents verwalteten Werkzeuge nichts, weil die sich sonst beim tatsächlichen Ausführen selbst
eintragen. Im Journal fehlten damit `tool.call.started` und `tool.call.failed` vollständig - ein
Unteragent lief acht Validierungsfehler hintereinander, und der Bediener sah im Chat nur endloses
Nachdenken. Jetzt merkt sich der Turn-Dispatcher bei `tool_execution_start` jeden verwalteten
Aufruf mit Name und gesendeter Eingabe, streicht ihn, sobald das Werkzeug wirklich ausgeführt
wird, und schreibt bei einem Fehlerabschluss ohne Ausführung das Paar `tool.call.started` +
`tool.call.failed` mit dem vollen Fehlertext. Der Vermerk gilt nur innerhalb eines Turns. Für das
Modell ändert sich nichts, im Chat erscheint der Fehlversuch wie jeder andere gescheiterte Aufruf.

## Eingabeschemata für Modelle sind flach (02.09.2026)

`mini_app_test` und `show_document` boten dem Modell eine Union an der Wurzel ihres
Eingabeschemas. Schwächere Modelle und mehrere OpenRouter-Upstreams kommen damit nicht zurecht:
`z-ai/glm-5.3-flash` schickte auf einem Upstream achtmal hintereinander `{}` als Argumente, auf
einem anderen 99-mal die verschachtelten Objekte (`input`, `mockCapabilities`, `expect`) als
JSON-Strings; `deepseek-v4-pro` kam mit demselben Schema klar. Regel: Ein modellzugewandtes
Eingabeschema ist EIN flaches `Type.Object`, der Diskriminator ist ein String-Enum, korrelierte
Felder sind `Type.Optional`, und die Korrelation prüft der Server direkt nach der Validierung mit
einem benannten Fehler, der beide gültigen Formen in einem Satz nennt (`targetActorId` gehört
genau zu `surfaceKind: "tool"`; `content` und `path` schließen einander aus). Die Regel steht
zusätzlich in der Beschreibung des korrelierten Feldes, damit das Modell sie im Schema sieht. Die
fachlichen Unterscheidungs-Unions bleiben unverändert serverintern. Gegen Rückfälle prüft
`profile-composition.test.ts` alle Werkzeuge aller Profile auf `type: "object"` ohne `anyOf` oder
`oneOf` an der Wurzel; Ausnahmen gibt es keine.

## Modaler Dialog als Platzierung plus zwei Capabilities (02.09.2026)

Ronald wollte einen kleinen Dialog in der Werkstatt und fragte, wo der Unterschied zwischen
Mini-App-Handlern und Actor-Skripten liegt. Festgelegt:

- Die Manifest-Platzierung bekommt neben `canvas` die Art `dialog` mit pflichtiger `size`
  (`medium`, `large`, `wide`, kein Vorgabewert). Eine App mit Dialog-Platzierung bekommt keinen
  eigenen Reiter; sie steht in der festen Werkzeugliste und der Host zeichnet sie mit dem
  Baustein `Dialog` über der Werkstatt.
- `dialog_open` und `dialog_close` sind in `ragents.mini-apps` DOPPELT registriert: als Operation
  (`operator: "direct"`) und als Agentenwerkzeug, mit identischer ID, Eingabe und Ergebnis. Damit
  gilt derselbe Capability-Vertrag für den Bedienerpfad und für Agenten, und eine App-Aktion, ein
  Handler, ein Script-Actor, ein Agent und der Bediener rufen dieselben zwei Namen.
- Ein Run zeigt höchstens EINEN Dialog. Zweites Öffnen einer anderen App ist ein harter Fehler mit
  Nennung der offenen App; erneutes Öffnen derselben App liefert nur den Zustand. Der Zustand
  (`ragents.run-modules.dialog`, `{kind:"closed"}` oder `{kind:"open", appId, revision, openedBy}`)
  ist journalisiert, überlebt den Neustart und wird geschlossen, wenn die App entfernt oder der Run
  gestoppt wird.
- Antwort auf Ronalds Frage: Mini-App-Handler und Actor-Skripte teilen sich denselben
  `runContextNamespace` - `context.state.read/replace` und `context.capabilities.call`. Verschieden
  sind nur drei Dinge: `std` gibt es allein im Skript, ein Handler liefert ein Ergebnis statt eines
  Folgezustands, und der Capability-Vorrat kommt beim Bedienerpfad aus den registrierten
  Operationen statt aus den Werkzeugen des Zielagenten.

## Profile sind Rollen, das Modell wählt der Spawn (02.09.2026)

Ronalds Einwand beim Blick auf die Profilliste: Modelle an Profile zu pinnen ist falsch. Die
Engine kann es längst anders: `agent_spawn` nimmt `model` und `thinking` aus der Modellliste
zusätzlich zum Profil an (`ExecutionRequest`), ein Profil liefert nur Treiber, Provider,
Denktiefe, Timeout und Workspace-Vorgabe. Deshalb gibt es in einem Produkt-Plugin keine
`review-<modell>`-Profile und keine eigene Modellliste je Profil mehr, sondern genau drei Rollen:
`coordinator`, ein Herstellermandat (herstellen, gründlich lesen) und `reviewer` (Lesemandat).
Welche Modelle zur Wahl stehen, sagt allein `AGENT_MODELS`; der Skill verlangt je Prüfer ein
anderes Modell aus dieser Liste. Ein Modell wechseln heißt damit Konfigurationsliste ändern,
nicht Profile umbauen.

## Starter mit Leitfaden, Dialog und Auswahlmenü als Systembausteine (02.09.2026)

Ronalds Wunsch: Einstiegspunkte sind nicht nur Promptkarten, sondern Skills, die ein Plugin als
Ablauf mitbringt, und an einem solchen Skill darf eine kleine Erweiterung hängen, die vor dem
Start Führung gibt. Festgelegt:

- Ein STARTER (`host.starters`) nennt Titel, Beschreibung, den Skill (Ordnername) und optional
  einen LEITFADEN. Er steht im leeren Chat über den Promptkarten; Modell und Reasoning sind dort
  wie bisher schon gewählt. Ohne Leitfaden schickt der Host einen festen Auftragstext
  (`starterMessage`), mit Leitfaden öffnet er dessen Komponente im Dialog, und der Leitfaden
  liefert den fertigen Text der ersten Nachricht.
- Der Leitfaden ist ein Web-Beitrag (`guides`) des Plugins, das die Daten kennt; der Starter darf
  einem anderen Plugin gehören (ein Ablauf-Plugin nutzt den Leitfaden eines Fachplugins). Engine
  prüft beim Start hart, dass der Skill existiert; das Web, dass der Leitfaden aktiv ist.
- `Dialog` und `SelectMenu` sind Host-Bausteine in `apps/web/src`, keine Registry-Slots. Native
  `<select>`-Elemente sind aus der Oberfläche verbannt; Auswahl läuft über die Listbox.
- Ein Fachreiter ist vom Bediener gesteuert (Abfragen, Suche, Filter, Detailseite, Übergabe an
  den Chat); die Ansichten des Agenten aus seinen Bediener-Clients bleiben als weitere Quellen.

## Illegale Zustände sind unrepräsentierbar (02.09.2026)

Korrelierte Optionals sind ein Finding: was zusammengehört, steht in einer diskriminierten
Union, nicht in unabhängigen nullbaren Feldern mit Laufzeit-Wächtern. Beispiele im Bestand:
ActorInput.lifecycle (pending/claimed/discarded), EventSubscription über status, Action über
kind, turn.finished über outcome, TurnRequest je Treiberart, ModuleInvocation über status.
Validatoren (Journal, TypeBox-Zustände) sind exakt so streng wie die Domänentypen - ein
Validator, der zulässt, was der Typ verbietet, ist ein Fehler. Ungültig gewordene Journale
scheitern laut beim Laden statt still zu lügen (`.data` ist wegwerfbar). Run-Module sind
ausschließlich Plattform 2: die Legacy-Handler-Pfade (callTool/state/remember) sind entfernt,
Handler- und App-Verträge (resultSchema, Capability-Hashes, styles/client) sind Pflichtfelder.
Einzige bewusste Ausnahme: subscription.removed.discardedInputIds bleibt optional, weil alte
Removals mit eigener Semantik (nichts verwerfen, Inputs bleiben startbar) getestet und gewollt
sind.

## Datei-Browser ist rein lesend (02.09.2026)

Der Tab "Dateien" (Plugin ragents.workspace) zeigt Arbeitsverzeichnis und Dateiablage eines Runs
als Baum mit Textvorschau (Syntax-Highlighting über die Host-Komponente SourceCode) - bewusst OHNE
Schreiben und Löschen. Ändern tun Agenten über ihre Werkzeuge, der Browser ist das Fenster des
Bedieners. Live wird er über einen fs-Watcher je Verbindung (SSE-Route browse/watch, entprellt);
ein 30-Sekunden-Poll bleibt nur als Fallback.

## Mini-App-Clients sind React (01.09.2026)

Der Client einer Mini-App heißt `src/client.tsx` und ist eine React-Oberfläche statt eines
handgeschriebenen DOM-Skripts: Modelle werden dort abgeholt, wo sie trainiert sind. Ein eigenes
DOM-Subset gibt es nicht mehr, der Browser-Emit prüft gegen die echte DOM-Lib von TypeScript und
gegen `@types/react`.

- `react` und `react-dom` sind auf 18.3.1 gepinnt, weil erst ab React 19 keine UMD-Builds mehr
  ausgeliefert werden. Der Host liefert die beiden Produktions-Bundles aus dem eigenen
  `node_modules` in den App-Frame; kein CDN, keine Netzverbindung, CSP und Sandbox unverändert.
- `client.tsx` ist eine Script-Datei OHNE `import` und `export`. `React`, `ReactDOM`, `context` und
  `useAppState` sind Globals, die die Plattform vor dem Client lädt. Ein `export` macht die Datei
  zum Modul und der UMD-Zugriff auf `React` wird zum benannten Compilerfehler.
- `useAppState()` ist die einzige Brücke vom App-Zustand in die Oberfläche: ein Prelude bindet
  `context.state.subscribe`/`read` über `React.useSyncExternalStore` an einen stabilen Snapshot.
  Aktionen laufen unverändert über `context.capabilities.call`.
- Handler bleiben deterministisches TypeScript ohne React; React betrifft ausschließlich die
  Präsentationsschicht im Frame.

## Eine Promptkarte, ein Ziel, zwei Fassungen (01.09.2026)

Jede Promptkarte trägt EIN Ziel in ZWEI gleichberechtigt wählbaren Fassungen: die TECHNISCHE
beschreibt wie bisher Vorgehen, Werkzeuge und Reihenfolge, die FREIE denselben Wunsch in ein bis drei
Sätzen ohne Werkzeugnamen, ohne Vorgehen und ohne Runtime-Begriffe. Der Wert liegt in der zweiten:

- Die freie Fassung ist der SELBSTERKLÄRUNGS-TEST der Plattform. Sie beantwortet die einzige Frage,
  die eine technische Karte nie stellt: reichen Prompts, Werkzeug-Index und lehrende Fehler, damit
  ein Modell den Weg allein findet? Scheitert sie, ist das ein Befund über die Plattform und nicht
  über die Karte - die technische Fassung daneben zeigt sofort, welcher Schritt gefehlt hat.
- Die technische Fassung bleibt der belastbare Referenzfall für die Selbsttest-Runden.
- Das Kartenformat ist streng: eine Datei je Karte, Frontmatter unverändert, im Body die
  Pflichtabschnitte `## technical` und `## free` in genau dieser Reihenfolge. Fehlt, doppelt,
  vertauscht oder leert sich eine Fassung, ist das ein harter Parser-Fehler; ein einzelnes
  `prompt`-Feld gibt es weder in der Datei noch im Beitrag noch auf der Leitung.

## Vermittler sind Bibliothek statt Vorlage (01.09.2026)

Ein Vermittler wird nicht als Beispielquelltext vorgegeben, den jedes Modell neu abschreibt, sondern
als EINE typisierte Implementierung in der Engine angeboten: `std.mediators.route(config)` ist die
einzige Vermittler-Funktion, der Script-Autor schreibt nur noch Konfiguration. Die Grundform ist die
Routing-Tabelle von der Actor-ID eines Absenders auf seine Ziele - Kreis und Stern sind zwei
Tabellen, keine zwei Funktionen. Die Schlüssel der Tabelle sind ALLE bekannten IDs; abonniert werden
genau die Schlüssel mit Zielen. Ein stiller Mithörer ist ein Schlüssel mit dem Wert `null`: er wird
nicht abonniert, routet nie, darf aber Ziel sein. Ziele dürfen statt einer Liste auch eine FUNKTION
sein: sie bekommt den übernommenen Beitrag und liefert Ziele, `null` oder die leere Liste - damit
sind Filter und inhaltsabhängiges Routing dieselbe Sache wie eine feste Zeile. Statische Ziele und
`start.to` prüft die Bibliothek beim BAU hart gegen die Schlüssel und nennt im Fehler die bekannten
IDs und die null-Form; Rückgaben der Ziel-Funktionen prüft die Laufzeit. Warum so:

- Verhalten entwickelt sich mit der Plattform weiter. Verbessert sich die Bibliothek, gilt die
  Verbesserung für alle Vermittler; eine Vorlage veraltet in jeder Kopie einzeln.
- Replay bleibt unberührt: der Zustand kommt weiter ausschließlich aus Events, die Bibliothek führt
  ihr Protokoll über denselben `context.state`-Port und ruft über denselben Capability-Port. Rechte
  sind exakt die des Actors - eine Fabrik verschafft keinen Zugriff.
- Der Erweiterungspunkt "Vorlage" bleibt nur für Mini-Apps offen. Wiederkehrende ACTOR-Logik gehört
  in die Bibliothek, nicht in einen Prompt-Baustein.
- Dafür trägt der Interpreter jetzt die allgemeine Brücke zwischen nativem und Script-Code:
  eine native std-Funktion nimmt Script-Closures entgegen, eine von std zurückgegebene Funktion gilt
  als Handler-Wert, und Ausführungsgrenzen zählen im Turn des Aufrufs statt in dem des Baus.
- Berechnete Objektschlüssel (`{ [id]: ... }`) sind in der Script-Policy freigegeben: der Schlüssel
  wird ausgewertet und muss ein nicht-leerer Text sein. Eine Actor-ID einmal als `const` zu
  definieren und zu referenzieren ist typsicherer, als dasselbe Literal zweimal zu tippen.

## Die Actor-Detailansicht zeigt beide Seiten (01.09.2026)

Die RunView trägt je Turn `outputs: [{ text, sequence, occurredAt }]` aus `model.output.completed`,
ungekürzt (gemessen: ein 51-Turn-Lauf bringt ~13 KB Antworttext bei 143 KB Gesamt-View - eine
Kappungsgrenze gibt es deshalb bewusst nicht). Die Detailansicht eines beliebigen Actors ist damit
eine echte Konversation: zugestellte Eingaben und eigene Antworten in einem Strom, sortiert über
die Journal-`sequence`. Reasoning gehört nicht dazu; die Chat-Projektion des primären Actors
bleibt unberührt, sie hatte beide Seiten schon.

## Werkzeug-Index statt aller Schemata (01.09.2026)

Nicht jedes Werkzeugschema steht immer im Kontext. Jeder Werkzeugbeitrag deklariert seine
Sichtbarkeit selbst (`visibility: "inline" | "indexed"`); indexierte Werkzeuge erscheinen nur als
Einzeiler im eingebauten `tool_open`, das auf Anfrage Schema UND die daran gebundenen
Prompt-Kapitel liefert und das Werkzeug ab dem nächsten Modellaufruf freischaltet. Festgelegt:

- Sichtbarkeit ist NICHT Rechte: Auflösung, Capability- und Grant-Prüfung sind unverändert, ein
  Agent kann nur öffnen, was er ohnehin hätte. Plain-LLMs (`tools: []`) und Scripts sind
  ausgenommen.
- Die Freischaltung ist das Journal-Ereignis `actor.tools.opened` und übersteht damit Replay.
- Prompt-Kapitel binden sich per `requiresTools` an Werkzeuge und erscheinen nur mit ihnen;
  bei Öffnung über den Index kommt das Kapitel ab dem Folgeturn dazu (fünfter Fork-Eingriff,
  siehe unten). Inline bleiben die produktive Oberfläche (Dateiwerkzeuge, Orchestrierung,
  installierte Run-Module); indexiert sind die schweren Bau- und Spezialfamilien.
- Gemessen am Koordinator-Erstturn in `core`: 64.631 -> 28.343 Zeichen (56 Prozent weniger).

## Typisiert angeboten, kompiliert geprüft (01.09.2026)

Ronalds zwei Prinzipien für alles, was ein Modell bauen oder aufrufen soll:

1. Alles, was Modellen angeboten wird, ist TYPISIERT, und die API steht in den Prompts. Ein Modell,
   das ein Script schreibt, kennt die vollständige TypeScript-API - Handler-Signatur, `context`,
   jede delegierte Capability mit Eingabe- UND Ergebnistyp -, ohne raten zu müssen.
2. Was Modelle bauen, wird IMMER kompiliert und typgeprüft. Der Compiler fängt, was sonst zur
   Laufzeit knallt.

Was das konkret erzwingt:

- Die Script-Deklarationen sind GENERIERT, nicht geschrieben:
  `packages/ragents/src/typescript/script-declarations.ts` baut `Handler`, `ScriptInput`,
  `ScriptEvent` und die Capability-Map aus den Schemata der jeweiligen Beiträger. Derselbe Text geht
  in den Compiler und - über `PromptRenderContext.scriptApi` - wörtlich in das Prompt-Kapitel des
  Plugins. Eine handgepflegte Beschreibung der API gibt es nicht mehr; `ScriptWord`/`ScriptGuidance`
  sind ersatzlos entfallen.
- Prompts gehören dem Plugin. Die Engine liefert nur den generierten Typtext als Dienst; welches
  Kapitel ihn einbettet, entscheidet das Plugin (hier `ragents.orchestration/script.hbs`). Kein
  API-Prosatext im Kern, kein Plugin-Wissen in der Engine.
- Die typisierte Capability-Sicht eines Builds entsteht aus den Werkzeugen, die für DIESEN Actor
  aufgelöst werden. Ein Plugin, das eine Capability beisteuert, bringt seine Typen damit selbst mit;
  es gibt keine zentrale Liste, in die etwas nachgetragen werden müsste.
- Zustellung ist typisiert statt roh: ein Subscription-Treffer kommt als `input.event` an, nicht als
  JSON-Klumpen in `input.content`. Der Wire-Wert im Journal bleibt davon unberührt.
- Ein Werkzeugvertrag verlangt nie, dass ein Modell Quelltext, Hashes oder Nachweise erneut
  eintippt. Alle drei Bau-Familien folgen EINEM Muster: `script_actor_check`, `script_tool_check` und
  `mini_app_check` legen den geprüften Stand unter einer kurzen Referenz (`build-1`) ab; Test und
  Installation nennen nur sie plus das Nötigste (Zielagent, Oberfläche). Die Mechanik dahinter ist
  der produktneutrale `BuildStore` in `packages/ragents/src/agents/build-store.ts`; jede Familie
  gibt ihm nur Identität, Drift-Hashes und ihre Werkzeugnamen mit. Vor Test und Installation baut
  der Server erneut und lehnt einen abgewichenen Build benannt ab - in Build-Referenz und Klartext,
  ohne Hex.
- Die Währung der Modelle ist die Build-Referenz; Hashes sind reine Server-Buchhaltung. Journal,
  BuildStore, Attestierungen und die `module`-Definitionen im Plugin-Zustand führen sie vollständig
  weiter, aber kein Werkzeugergebnis, keine Fehlermeldung und keine Karte zeigt einem Modell noch
  einen 64-stelligen Hex-Wert.
- Ein Werkzeugergebnis wiederholt nie, was das Modell selbst geschrieben hat - es liefert nur die
  neu entstandenen Kennungen und Fakten. Die eine Redaktionsstelle dafür ist `toolResultEventOf` in
  `packages/ragents/src/agents/actor-input.ts`: sie streicht aus jeder Event-Payload auf dem Weg zum
  Modell rekursiv die Hash-Schlüssel und die wörtlichen Eingabe-Echos (`prompt`, `source`,
  `execution`, `content`, `state`). `TurnToolset.eventsFor` und `enqueueActorInput` sind ihre
  einzigen Aufrufer; Journal, `event_query` und die RunView fürs Web bleiben vollständig.
- Tests prüfen das ECHTE Format. `script_actor_test` konstruiert Subscription-Inputs serverseitig
  über denselben Zustellpfad wie die Laufzeit; der Aufrufer nennt nur `eventType`, `sourceActorId`
  und `text`. Ein Test, dessen Eingabe der Autor selbst erfindet, bestätigt nur seine Annahme.
- Ablehnungen nennen gültige Namen. Capability-Namen kommen in ZWEI Formen vor, und das bleibt so:
  gepunktet (`actor.input`) sind die GRANTS - sie stehen als Wire-Werte im Journal und sind deshalb
  nicht umbenennbar -, mit Unterstrich (`actor_input`) sind die AUFRUF-Namen der Werkzeuge, die
  `capabilities.call` und die `capabilities`-Liste eines Builds erwarten. Jede Ablehnung nennt die im
  Build gültigen Aufruf-Namen und sagt dazu, dass die gepunktete Form ein Grant ist.

## Plugins liegen auf Repo-Wurzelebene, ein Plugin ist ein Ordner (01.09.2026)

`plugins/<plugin-id>/` liegt auf der Wurzelebene des Repos, nicht mehr in `apps/`. Ein Plugin ist
damit WIRKLICH ein Ordner: `server/index.ts` und, falls vorhanden, `web/index.tsx` gehören
zusammen, dazu eine geteilte, importfreie `contract.ts` (nur `ragents.todo` hat eine) und alle
Assets auf Plugin-Wurzelebene (`prompt.hbs`, `prompts/`, `prompt-cards/`, `skills/`, `install.sh`,
`preview-config/`). Die Ordnerform ist die Vorbereitung darauf, ein Plugin von extern als Ordner
hineinzulegen; Nachladen, Download und Registry bleiben ausdrücklich ausgeschlossen (siehe
Abschnitt unten).

Was der Umzug nach sich zieht und bewusst so bleibt:

- `apps/server/src/plugin-support/` und die Wire-Verträge `chat-events.ts` sowie
  `plugin-support/chat-display-contract.ts` bleiben im Server: Host-Bausteine, kein
  Plugin-Eigentum. Beide Hälften importieren sie relativ.
- Die Wurzel kommt aus EINER Quelle (`plugin-support/plugins-root.ts`, relativ zu
  `import.meta.url`), nicht aus `process.cwd()`.
- Der Typecheck bleibt getrennt: `apps/server/tsconfig.json` sieht `plugins/*/server` und
  `plugins/*/contract.ts`, `apps/web/tsconfig.json` sieht `plugins/*/web` und dieselbe
  `contract.ts` - keine Vermischung, sonst scheitert der Server-Lauf am JSX.
- Weil `plugins/` neben `apps/` liegt, löst Node dort keine Abhängigkeiten von `apps/server` oder
  `apps/web` mehr auf. Deshalb deklariert die Repository-Wurzel, wogegen Plugin-Code gebaut wird
  (`@aicontainer/agent`, `@aicontainer/ragents`, `react`, `typebox`, `typescript-language-server`
  und die übrigen). Einzelne Plugins bleiben trotzdem KEINE npm-Pakete: es gibt kein
  `package.json` je Plugin.
- ESLint zieht aus demselben Grund an die Wurzel (`eslint.config.js`, `pnpm lint` im Root): nur
  von dort aus sind `apps/web/src` und `plugins/*/web` in EINEM Lauf erreichbar.

## Keine Migrationen, keine Altpfad-Kompatibilität (01.09.2026)

Wir sind in der Entwicklungszeit: es gibt keinen Migrations-Erweiterungspunkt und keine
Kompatibilitätspfade. Die Plugin-Ablage ist reine Konvention und nicht mehr deklarierbar -
global `plugins/<plugin-id>`, je Unterhaltung `sessions/<runId>/plugins/<plugin-id>`. Braucht ein
Plugin Unterordner, nimmt es die Segmentparameter von `root()`/`session()`. Vorhandene
`.data`-Bestände sind wegwerfbare Entwicklungsdaten: wer alte Daten hat, löscht `.data` oder zieht
von Hand um; der Server zieht nichts mehr selbst um.

## Kein Vendor-Konstrukt mehr (01.09.2026)

`vendor/` ist aufgelöst. Der Chat-Code ist regulärer Eigencode: der Wire-Vertrag der ChatEvents
liegt als importfreie Datei in `apps/server/src/chat-events.ts` (der Server ist die Autorität,
das Web importiert sie relativ), der HTTP-/SSE-Adapter samt Session-Vertrag in
`apps/server/src/chat-handler.ts`, die React-Bausteine mit ihrem CSS in `apps/web/src/chat/`
und die Design-Tokens daneben in `apps/web/src/`. Ein Rückfluss ins eigenständige quassel-Repo
(~/repos/github/quassel) ist NICHT mehr geplant; jenes Repo bleibt unberührt, die früheren
Vendor-Stände stehen in der Git-Historie.

## Eigenes Verhalten in der Agentenlaufzeit (01.09.2026)

Die Agentenlaufzeit ist gegabelter Fremdcode (Upstream war `@earendil-works/pi-*`, Tag v0.80.10;
der Scope `@aicontainer/*` ist unserer) in DREI Paketen: `ai` ist die LLM-Anbindung (nur der
Provider openrouter), `agent` sind Werkzeuge und Session, `agent-core` die Agenten-Schleife.
Das vierte Paket `tui` (Terminal-UI) ist entfernt - ein Web-Produkt hat keine Terminal-Oberfläche.
Sieben eigene Eingriffe prägen das Verhalten. Herkunfts- und
Abweichungsdokumente sind bewusst entfallen - was zählt, steht hier.

- Steering bricht keinen laufenden Tool-Call ab. Kommt während eines Calls eine Nachricht an,
  liefert der Call sofort ein Zwischenergebnis, die Schleife macht mit dem nächsten LLM-Call
  weiter (der die Nachricht sieht), und das echte Ergebnis wird nachgereicht als getaggte
  Steering-Nachricht (Kappung bei 30000 Zeichen). Zustellung als Steering statt followUp, weil
  ein followUp im Leerlauf keinen Lauf startet. `unqueueSteering(text)` steht bereit und nimmt
  eine noch nicht zugestellte Nachricht zurück, ist aber NOCH NICHT verdrahtet: RAgents ruft es
  nirgends auf (siehe TODO.md).
- Der Systemprompt eines langlebigen Agenten ist nicht mehr unveränderlich:
  `AgentSession.setSystemPrompt` (plus `ResourceLoader.setSystemPrompt`) setzt ihn neu und erhält
  die Unterhaltung - nötig, damit werkzeuggebundene Prompt-Kapitel nach einem `tool_open` ab dem
  Folgeturn dazukommen.
- Das Edit-Werkzeug nennt bei mehrdeutigem `oldText` die Fundstellen mit Zeilennummern, statt nur
  zu scheitern. Optionale Anker: `occurrence` (n-tes Vorkommen), `nearLine` (nächstgelegenes,
  Gleichstand ist ein Fehler), `replaceAll` (nicht mit Anker kombinierbar).
- Ein Edit überschreibt nichts, was nach dem letzten Lesen entstanden ist: das Read-Werkzeug
  liefert einen SHA-256 des Dateiinhalts, das Edit-Werkzeug prüft ihn als `expectedHash`
  innerhalb der Datei-Mutationssperre und gibt den neuen Hash zurück.
- Die drei `package.json` laden zur Laufzeit die TS-Quellen (`main`/`import` auf `src/*.ts`),
  der Typecheck sieht die generierten `dist/*.d.ts` (`types`).
- Denktiefe `off` sendet bei openrouter explizit `reasoning: { enabled: false }` statt gar
  nichts - sonst greift der Modell-Default und das Modell denkt trotzdem
  (`packages/ai/src/api/openai-completions.ts`).
- Die Werkzeug-Validierungsmeldung wiederholt die empfangenen Argumente NICHT mehr (sie stehen
  schon im Tool-Call davor); sie nennt nur die Feldfehler und fordert zur Korrektur auf, bei
  Enum-Fehlern samt empfangenem Wert und den erlaubten Werten, ein Pfad nur einmal
  (`packages/ai/src/utils/validation.ts`).
- OFFEN: außer der Validierungsmeldung (`packages/ragents/tests/schema-errors.test.ts`) hat keiner
  dieser Eingriffe einen Test. Die vendorierten Testsuiten waren zu 60 Prozent rot und liefen in
  keinem `check`; sie sind samt Vitest entfernt, das Repo testet überall mit `node --test`.
  Die alte Werkzeug-Suite (84 grüne Tests) steht in der Historie
  unter `vendor/pi/coding-agent/test/tools.test.ts` (bef8c23) und ist die Vorlage, wenn die
  Abdeckung neu aufgesetzt wird.

## Ein Profil ist eine Datei, kein Paket (01.09.2026)

`ragents.config.<profil>.ts` nennt Produkt (`PRODUCT_ID`, `PRODUCT_TITLE`), Pluginliste
(`PLUGINS`) und die Konfiguration aller beteiligten Plugins. Es gibt kein Preset und keinen
Default mehr: fehlt der Wert oder die Datei, startet der Server nicht.

Das frühere Produktprofil-Paket ist ersatzlos entfallen. Ronalds Einwand: Profile werden
AUS Paketen gebaut, sie werden nicht IN einem Paket gesammelt. Dazu hielt es eine dritte,
handgepflegte Kopie der Pluginliste - Server und Web kennen ihre Plugins ohnehin, weil sie ihre
Ordner absuchen. Das Web prüft die Antwort des Servers seitdem nicht mehr gegen eine eigene Liste;
der Server ist die Autorität.

## Plugins werden geprobt, nicht kompiliert verdrahtet (31.08.2026)

Ronalds Vorgabe: "Ich will hier keine statischen Imports irgendwo. Das muss wirklich dynamisch so
plugin-mäßig zur Laufzeit sein, mit einem Probing. So wie bei Visual Studio Code Packages."
Damit ist die frühere Grenze "der Plugin-Katalog ist mitgebaut" aufgehoben. Festgelegt:

- Ein Plugin = EIN Ordner unter `plugins/`. Der Ordnername ist die Kennung, `server/index.ts`
  exportiert `plugin: PluginModule = { requires?, create(host) }`, geladen wird per
  `await import()`. Dasselbe im Web über `import.meta.glob` auf `plugins/*/web/index.{ts,tsx}`,
  je Ordner ein eigener Chunk.
- Jedes Plugin ist self-contained: was es braucht, holt es aus dem `PluginHost`. Sonderverdrahtung
  im Kompositionscode ist der Fehler, nicht die Lösung - fehlt etwas, kommt ein allgemeiner
  Host-Service dazu.
- Dasselbe gilt für alles andere um ein Plugin herum: seine Assets (`skills/`, `prompt-cards/`,
  `prompts/`) und seine Installation (`install.sh`) liegen auf seiner Ordner-Wurzelebene, neben
  `server/` und `web/`, und werden gefunden, nicht aufgezählt.
- Geprobt wird, was im Repository liegt. Ein Plugin aus fremder Quelle nachzuladen ist bewusst
  NICHT vorgesehen (kein Download, keine Registry, keine Signaturen).

## Die Agentenlaufzeit ist unser Paket, nicht mehr "Pi" (31.08.2026)

Der vendorierte Coding-Agent ist gegabelt und heißt jetzt `@aicontainer/agent` (dazu
`@aicontainer/agent-core`, `@aicontainer/ai`) unter `packages/`. Der Name
"Pi" kommt nirgends mehr vor: Bezeichner, Env-Schlüssel (`AGENT_MODEL`, ...),
der Treiberwert `"agent"`, das Konfigurationsverzeichnis `.agent` und die Wire-Werte
`agent-builtin`/`agent-extension`. Ein Rebase auf das Upstream-Projekt ist mit dem Fork
aufgegeben; die eigenen Eingriffe stehen als Verhalten im Abschnitt oben.

WICHTIG für frische Klone: `dist/` dieser drei Pakete ist gitignored, liefert aber die
Typdeklarationen. `pnpm build:agent` baut sie; `pnpm check` macht es von selbst.

## Netzansicht ohne Iframe, Mini-Apps nie auf Actor-Karten (31.08.2026)

Die Ablaufansicht lebt als native React-Ansicht im Host-Dokument; die frühere Iframe-Grenze der
eingebetteten Ansicht ist bewusst entfernt. Kamera, Karten, Kanten und Eingaben liegen damit in
EINEM Dokument, und Geometrie überschreitet keine `postMessage`-Grenze. Festgelegt:

- Genau EINE Host-Kamera. Der erste automatische Fit passiert einmal, danach bewegt die
  Oberfläche die Kamera nie von selbst.
- Actor-Karten sind reine Anzeige: ein Kartenbeitrag (`cardSections`) ändert niemals Identität,
  Capabilities oder Werkzeugauswahl eines Actors.
- Eine Mini-App wird NICHT auf einer Actor-Karte eingebettet. Die einzige zusätzliche
  Platzierungsart ist `canvas` mit `anchorActorId`, `width` und `height`; Ziel-IDs an Agenten
  gehören nur zu Werkzeugen und Aktionen.
- Bewusste Grenzen der Netzansicht: kein Dark Mode, kein `displayName` auf den kompakten Karten
  (das `@handle` reicht), und Canvas-Elemente von Run-Modulen sind Oberflächen, keine Actors.

## Diagnostik über Language Server statt Build je Turn (28.08.2026)

Coding-Agenten bauen nicht nach jedem Schritt: warme Language Server liefern die Fehler der
geänderten Datei, der volle `dotnet build` ist der Abschluss. Festgelegt:

- DREI Plugins (`ragents.lsp-roslyn`, `ragents.lsp-fsharp`, `ragents.lsp-typescript`), kein
  Sammelplugin; der Client ist gemeinsam in `plugin-support/language-server/`.
- Der Agent fordert die Server per `<id>_open` an, nichts startet von selbst. Welche Wurzel gilt
  (eine Projektmappe, ein Quellordner), ist Produktwissen im Prompt und im Skill eines
  Fachplugins, die Plugins bleiben neutral.
- Die Diagnostik hängt automatisch am `edit`-/`write`-Ergebnis (Slot im Sandbox-Host), Fehler
  immer, Warnungen nur gezählt.
- Server sind Laufzeitressourcen wie die Agent-Session, kein Journal-Zustand.
- Jedes der drei Plugins trägt einen eigenen Diagnose-Tab im rechten Panel (`workspaceTabs`,
  gemeinsame Web-Komponente, Snapshot-Route ohne Werkzeug und ohne Journal). Der Tab zeigt, was
  der Host kennt: Diagnosen erscheinen erst nach `<id>_diagnostics` oder einem Edit/Write.
- Jedes Plugin installiert seine eigenen Abhängigkeiten: `install.sh` im Plugin-Ordner,
  eingesammelt von `scripts/install-plugin-dependencies.sh`, das kein Plugin beim Namen kennt
  (Image und lokal identisch). `ragents.lsp-typescript` bringt keine mit - der
  typescript-language-server ist eine npm-Abhängigkeit der Repository-Wurzel.

## Sicherheit ist derzeit nachrangig (27.08.2026)

Sicherheit, Sandbox-Härtung und konzeptionelle Rechte (Capabilities, Grants, Delegation)
sind AKTUELL KEIN Investitionsziel. Keine Angriffs-Testsuiten, keine Rechte-Differenzierung,
keine Sandbox-Ausbauten, solange das Produkt nicht danach verlangt. Die harten Grenzen
bleiben die vorhandenen: Dateirechte und Session-UID im Container. Bestehende Mechanik ohne
tragenden Zweck fällt beim Eindampfen weg (die Git-Sperre und die Git-Policy der Bash sind
entfernt, siehe oberster Eintrag); ein gezielter Ausbau findet nicht statt.

## Kurs: einschmelzen statt ausbauen (27.08.2026)

Das System hat zu viele Indirektionen und Features. Leitlinien:

- Rückbauten werden IMMER fertig gezogen, keine stehengebliebenen Altpfade.
- KEINE Redundanzen: gleiche Logik existiert genau einmal.
- Generalisierungen erst, wenn es mindestens zwei echte Nutzer gibt.
- Die Mini-App-/TypeScript-Plattform-Vision STEHT; fehlende Referenzfälle sind dem
  Entwicklungsstand geschuldet, kein Abbaugrund. Aber: nicht weiter ausbauen, bis der
  erste echte Fachfall darauf läuft.
