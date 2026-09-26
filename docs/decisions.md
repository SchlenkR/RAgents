# Entscheidungen

## Schlanke Werkzeugergebnisse als Regel (26.09.2026)

Kapitel: `docs/spec/plugins.md` (Plugin-Leitfaden, Abschnitt 9, Befundgrundlage),
`docs/development.md` (Regeln). Vorgabe des Owners: Werkzeugergebnisse liefern nur, was das Modell
noch nicht hat.

**Warum so.** Eine Auswertung von 25 echten Runs eines Server-Profils ergab rund 1,3 MB
Werkzeugausgabe direkt an Modelle, die Hälfte davon aus 41 Aufrufen über 8 KB. Wörtliche Echos
waren selten; die Masse kam aus dem ganzen Zustand nach jeder Änderung samt unveränderlicher
Kataloge, aus der Bash-Grenze von 50 KB (einmal fast vollständig eine einzige minifizierte Zeile),
aus vollständigen Event-Hüllen und aus Deklarationen, die jede Antwort wiederholt. Die bestehende
Festlegung "kein Echo, kein Hex" (`docs/spec/core.md`) greift nur an `toolResultEventOf` für
Event-Payloads; Plugin-Funktionen liefern ihre Ergebnisse daran vorbei, und `read` und `edit`
zeigen weiter volle SHA-256-Werte.

**Festlegung.** Die Regel steht als Abschnitt 9 im Plugin-Leitfaden und als Kurzregel im
Handbuch. Die gefundenen Verstöße stehen in `TODO.md`.

## Solution beim Start eines Runs, Solution-Liste und Umschalten im Reiter (25.09.2026)

Kapitel: `docs/spec/plugins.md` (Zuständigkeit je Facette, Executor, Language-Server-Plugins),
`docs/spec/profiles.md` (Rechte im Einzelnen), `docs/development.md` (Erweiterungspunkte).
Vorgabe des Owners: Ein neuer Run soll die .NET-Solution seines Arbeitsbereichs selbst in Roslyn
laden, bei mehreren sofort fragen, bei Run-Scripts nie; das Modell soll Solutions finden und
dazuladen, der Benutzer im Reiter umschalten.

**Warum so.** Ob ein Run über ein Run-Script startet, weiß nur der Start selbst; das Journal kennt
die Vorlage eines Scripts erst nach dem Aufbau seines Actors, eine freie Nachricht nie. Ein Haken
des Hosts nach Arbeitsbereich und erstem Actor, vor dem ersten Input, entscheidet das ohne Timing:
kein Actor hatte einen Turn, also hat noch niemand geöffnet, und der Merker im Journal hält den
Durchgang auf einen je Run, auch über Neustarts. Das gleichzeitige Öffnen löst der Executor, nicht
das Plugin: `ifNoneOpen` prüft und belegt in einem Schritt und zählt auch Aufrufe, die ihren Pfad
noch auflösen. Außerhalb eines Turns darf nur der Eigentümer Befehle geben; deshalb fragt er, wie
schon die Host-Bestätigung der Actor-Programme, und `ragents.ask` bekommt `recipient`, damit eine
nach einem Neustart verwaiste Antwort beim Koordinator landet statt zu verfallen.

**Festlegung.** `SessionLifecycleContribution.sessionStarted({ runId, startEntry })` im Kern, ohne
Wissen über Werkzeuge. Adapter mit `solutionExtensions` (Roslyn) bekommen `<id>_solutions` (Werkzeug
und Operation, `git ls-files` ohne `node_modules`, `bin`, `obj`, ohne Git die Ordnersuche) und
`<id>_switch`; `<pluginId>.solutions` und `<pluginId>.switch` (zusätzlich `runs.write` und das
neue `<pluginId>.write`) bedienen den Reiter. Umschalten wartet nicht auf das Laden, weil ein
Proxy vor dem Server lange Anfragen abbricht. Das Laden beim Start gehört dem Roslyn-Plugin
(`ROSLYN_SOLUTION_ON_START`, Vorgabe `"off"`), FSAC und TypeScript bleiben ohne. Eine vom
Eigentümer gestellte Aktion trägt im Chat keinen Namen mehr, weil sie eine Frage des Hosts ist.
Öffnet jemand eine Instanz, solange die Startfrage offen ist, verwirft das Plugin sie über das neue
`AskService.withdraw` (ohne Laden, ohne Input an den Koordinator); den Anlass liefert `onOpened`
des Sprachserver-Rahmens nach Werkzeug-Öffnen und Umschalten.
`WORKSPACE_EXECUTOR_VERSION` ist 4: ein älterer Arbeitsplatz kennt die neuen Operationen nicht und
würde `ifNoneOpen` still übergehen; er wird bei der Anmeldung abgewiesen.

Verworfen: die Entscheidung aus dem Zustand von `ragents.actor-programs` im Journal abzuleiten (ein
fremdes Plugin, und erst nach dem Aufbau des Script-Actors sichtbar); ein `beforeModelCall`-Haken
im ersten Turn (fragt erst mit der ersten Nachricht und nur, wenn ein Modell läuft); die Frage im
Namen des Koordinators (der Kern lässt Befehle eines Agenten nur in seinem Turn zu); Umschalten
als Folge aus Schnappschuss, Schließen und Öffnen im Server (drei Wege zum Executor, dazwischen
offen für andere). Offen: Beim Umschalten bleibt ein Öffnen anderer Wurzeln stehen, das noch seinen
Pfad auflöst; eine Rückfrage nach einem Serverneustart hängt davon ab, dass der Koordinator die
weitergereichte Antwort in `<id>_open` umsetzt. Belegt durch `language-server-startup.test.ts`
(Suche mit und ohne Git, `ifNoneOpen`, Umschalten), `roslyn-solution-on-start.test.ts` (0, 1, n,
Script-Start, einmal je Run, offene Instanz, Antworten, Neustart, Stopp), `language-server.test.ts`,
`workspace-owner-access.test.ts`, `run-script-start.test.ts`, `skill-prompt-start.test.ts`,
`start-options.test.ts` und `language-server-panel.test.ts`.

## Unter Windows eine mitgebrachte Bash, auf dem Arbeitsplatz die geerbte Umgebung (25.09.2026)

Kapitel: `docs/spec/plugins.md` (Arbeitsbereich: Umgebung, Promptbeitrag der Shell, Bash unter
Windows; Offene Grenzen), `docs/operations.md` (Work on Windows), `docs/development.md`
(VS-Code-Erweiterung veröffentlichen). Vorgabe des Owners: Das Modell bekommt weiter genau ein
Werkzeug `bash`, auch unter Windows. RAgents nimmt dort nur eine Bash, die es selbst mitbringt,
und `git` bleibt das Git des Benutzers.

**Warum Bash und kein PowerShell-Werkzeug.** Die Modelle sind auf Bash trainiert, unsere Skills,
Prompts und Run-Scripts sind Bash, und ein zweites Werkzeug hieße je Plattform andere Prompts und
Beispiele. PowerShell reicht Objekte durch die Pipe statt Text; was ein Modell dort schreibt, ist
eine andere Sprache mit anderen Fehlern.

**Warum eine mitgebrachte Bash und nicht die Git Bash des Benutzers.** Welche Git-Bash-Fassung
installiert ist, wo sie liegt und was ihr `/etc/profile`, ihre `bash.bashrc` oder ein `PATH` mit
Cygwin oder WSL daraus machen, entzieht sich RAgents; eine Suche über `Program Files` und den `PATH`
fand im schlechtesten Fall das alte `System32\bash.exe` von WSL. Eine feste Fassung aus einem
festgelegten Archiv (Git for Windows PortableGit, per SHA-256 gepinnt) verhält sich auf jedem
Rechner gleich und ist Teil der Windows-VSIX. Busybox (`ash`, andere Optionen fast aller Werkzeuge)
und `just-bash` (eine nachgebaute Bash in JavaScript ohne echte Prozesse) sind keine Bash, auf die
Modelle und Skripte sich verlassen können. Die Auswahl ist schlank: Bash und die GNU-Textwerkzeuge
samt ihrer DLLs, die das Build-Skript aus den PE-Importen bestimmt; Git, Perl, Editoren, SSH, GnuPG,
OpenSSL und Terminals bleiben draußen. Git ist das `git.exe` vom `PATH`, damit Anmeldung
(Credential Manager), `~/.gitconfig` und `~/.ssh` des Benutzers ohne weiteres greifen.

**Warum der Arbeitsplatz erbt und der Server nicht.** Auf dem eigenen Rechner soll die Bash des
Runs arbeiten wie das Terminal des Entwicklers: seine Toolchain-Variablen, Proxy-Einstellungen,
Anmeldungen. Die Allowlist nahm ihm das und brachte nichts, weil die Umgebung ohnehin seine eigene
ist; ausgenommen bleiben nur die Variablen des umgebenden VS Code und `BASH_ENV`/`ENV`, damit keine
Startdatei in `bash -c` rutscht. Auf dem Server trägt die Umgebung Schlüssel und Tokens, die nicht
dem Benutzer des Runs gehören; dort bleibt es bei der Allowlist. Die Wahl ist ein ausdrücklicher
Parameter (`baseEnvironment`), kein Schalter nach Plattform oder Betriebsart. Der lokale Host der
Erweiterung erbt noch nicht, weil seine Umgebung Secrets enthält, die die Erweiterung ihm mitgibt
(`TODO.md`).

**Festlegung.** Der Kontext des Executors trägt die Bash (`bash`); unter Windows ist sie Pflicht,
ohne sie scheitert `bash` mit Ursache, eine Suche gibt es nicht mehr (`getShellConfig` wirft unter
Windows ohne Pfad; der Stdin-Weg für WSL entfällt). Gestartet wird überall
`bash --noprofile --norc -c`; unter Windows steht das `usr/bin` der Bash vorn im `PATH` und
`MSYSTEM` fällt weg. Die Erweiterung nennt die Bash für ihren Arbeitsplatz direkt und für ihren
lokalen Host über `RAGENTS_BASH`; ohne Erweiterung setzt man `RAGENTS_BASH` selbst. Gepackt werden
eine universelle VSIX ohne Bash und je eine für `win32-x64` und `win32-arm64`; die ARM64-Fassung
trägt dieselben x64-Programme, weil MSYS2 kein natives ARM64-Userland hat. Die Programme stehen
unter GPLv3 und LGPL; die Bash trägt Lizenztexte, Paketfassungen und die Quellverweise auf Git for
Windows und MSYS2 in `NOTICE.txt`, verändert ist nur `etc/nsswitch.conf`.

## Tab-Bereich des Run-Panels als Pop-out statt unter dem Chat (25.09.2026)

Kapitel: `docs/spec/plugins.md` (Run-Panel, Workspace-Tabs).
Vorgabe des Owners: Die Reiter der Symbolleiste (Dateien, Language Server, Dokumente ...) öffnen
nicht mehr unten im Hauptbereich, sondern überdecken ihn fast ganz, wie die übrigen Pop-outs des
Run-Panels (Run-Details, Adressat). Beim Schließen ist der Hauptbereich unverändert.

**Warum.** Unter dem Chat teilte sich der Tab-Bereich die Höhe mit Chat und Bühne; beide wurden
klein, und der Griff musste bei jedem Reiter nachgezogen werden.

**Festlegung.** `RunPanelWorkspace` liegt absolut über Chat und Bühne mit abgedunkeltem Rest;
X, Escape, Klick daneben oder erneuter Klick auf den Knopf schließen. Bei mindestens 960 Pixeln
Breite, wenn zwei Bereiche nebeneinander stehen, deckt es nur den rechten Teil ab. Griff und Höhe
entfallen; der Zustand je Run ist nur noch `{ tab }` unter dem neuen Schlüssel
`ragents.run-panel.workspace-tab:<runId>`, die alten Einträge werden ohne Migration ignoriert.

## Gemeinsamer Pop-out-Abstand und Hintergrund (25.09.2026)

Kapitel: `docs/spec/plugins.md` (gemeinsame UI-Bausteine, Run-Panel).
Pop-outs übernehmen ihren Abstand von 8 Pixeln aus `PopoverContent`. Dialoge, abdunkelnde
Pop-outs und Chat-Sheet verwenden denselben Theme-Wert `--backdrop`, damit die stärkere
Abdunklung zentral gepflegt wird. Die Adressat-Suche steht neben dem Titel im gemeinsamen
Pop-out-Kopf und durchsucht sichtbare wie ausgeblendete Actors.

## Homepage als handgeschriebene Seite ohne Strukturprüfung (25.09.2026)

Kapitel: `docs/spec/overview.md` (Produkt-Homepage), `docs/development.md` (Homepage-Regeln).
Vorgabe des Owners: Die neu gestaltete Homepage wird so übernommen, wie sie ist; die Sticker- und
Strukturregel des Generators entfällt.

**Warum.** Die Regel verlangte je Kernfunktion genau einen Sticker, einen Abschnitt mit
`data-core-feature` und einen Guide-Link. Die neue Seite hat Sticker, die dieselbe Szene aus zwei
Blickwinkeln anspringen, und Abschnitte ohne eigenen Sticker; die Regel hätte die Seite in eine Form
gezwungen, die der Owner nicht will.

**Festlegung.** `docs/homepage/index.html` ist handgeschrieben, mit `homepage.css` und
`homepage-*.js`. Der Generator prüft ihren Inhalt nicht mehr (`homepage-structure.ts` und sein Test
sind entfernt); er übernimmt weiter ihre Kopfzeile für die Guide-Seiten und veröffentlicht die in
`homepageFiles` genannten Dateien. Inhaltliche Leitlinien stehen in `docs/development.md`: kurze
direkte Sätze, Prinzip-Diagramme mit allgemeinen Rollen, scrollgebundene Animationen ohne Glättung,
nur belegte Features.
## Modell-Aliasse des Profils für eigene Runs und Relay (25.09.2026)

Kapitel: `docs/spec/profiles.md` (Modellanbieter), `docs/spec/plugins.md` (Modell-Relay, Host-API),
`docs/usage.md` (Wählbares Modell), `docs/operations.md`. Vorgabe des Owners. Aliasnamen gab es nur
für Clients des Relays (`RELAY_MODELS`); die eigenen Runs eines Servers nannten Anbieter und echte
Modellnamen, und die Modellwahl zeigte `openrouter/<modell>`. Das vorhandene Relay taugte dafür
nicht: Es ist ein HTTP-Weg für andere Server, der eigene Server müsste sich beim Start selbst
anfragen und einen Token für sich halten. Festgelegt: `MODEL_ALIASES` im Abschnitt `host`
(`alias=anbieter/modell`, optional `@denktiefe`, `plugin-support/model-aliases.ts`) ist die eine
Liste; `RELAY_MODELS` entfällt, das Relay bietet genau diese Aliasse an. Der Server registriert sie
unter dem Anbieter `alias` in der einen Modelllaufzeit (`ModelRuntime.registerAliases`, ein Eingriff
in `packages/agent`): Katalogdaten und Denkstufen kommen vom Ziel, die Anfrage geht mit dem Ziel
hinaus, jedes Ereignis kommt mit Alias zurück, und frühere Antworten des Alias zählen beim Ziel als
eigene, damit Reasoning-Signaturen erhalten bleiben. Ein Produkt-Plugin nutzt die Aliasse mit
`AGENT_PROVIDER: "alias"`; ohne `AGENT_MODELS` sind alle Aliasse wählbar, Anzeigen nennen keinen
Anbieter (`modelLabel`). Die Denktiefe am Alias ist dessen Vorgabe an genau einer Stelle: eine
Rollen-Denktiefe ohne Wert übernimmt sie (`roleThinkingLevel`), und ein Wechsel im Chat auf einen
anderen Alias wählt sie vor. `configuredModelAliases`, `modelLabel` und `roleThinkingLevel` stehen
neu in der Host-API, ohne neue `HOST_API_VERSION`, weil nichts entfällt. `core` und `showcase`
tragen ihre Relay-Aliasse nun unter `host`.

Katalog: `deepseek/deepseek-v4.1-flash` fehlte. `pnpm update:models` hätte rund 3900 Zeilen
geändert (neue Modelle, neue Preise und Grenzen, umformatierte Einträge); ergänzt ist deshalb nur
dieser Eintrag, mit Werten aus `GET /api/v1/models` und `compat` wie die übrigen DeepSeek-V4-Modelle.
Die Denkstufen folgen dem `reasoning`-Block der API: `supported_efforts` gehen wörtlich hinaus, "off"
als `effort: "none"`, solange `mandatory` nicht gesetzt ist. Dieselbe Regel leitet
`update-model-catalog.ts` jetzt für neue Einträge ab; sie ergibt für Qwen3.8 27B, GLM 5.3 und GLM
5.3 Flash genau die bisher gepflegten Tabellen.

Verworfen: Aliasse als zusätzliche Modelle des echten Anbieters, weil die Anzeige dann den Anbieter
nennt; Umbenennen des Modells im Katalog allein, weil die Anfrage dann den Alias an den Anbieter
schickt; eine zweite Aliasliste je Produkt-Plugin. Offen: Titelmodell (`COMPACTION_MODEL`) und
Werkzeugmodelle von Plugins nennen weiter echte Namen, weil sie über eigene Wege laufen. Nachgewiesen
mit `apps/server/tests/model-aliases.test.ts` (Katalog, Stufen je Ziel, ausgehender Request je Stufe,
Rückweg mit Alias, Verlauf, Vorgaben) und `apps/server/tests/model-relay.test.ts`.

## Adressatenwahl als Baum "wer hat wen erzeugt", Kurzbeschreibung je Actor (25.09.2026)

Kapitel: `docs/spec/plugins.md` (Run-Panel), `docs/spec/core.md` (Besitz, Kurzbeschreibung),
`docs/usage.md` (Run panel and VS Code extension). Vorgabe des Owners. Das Pop-out des Adressaten
im Run-Panel war eine flache Liste mit Handle, Art und Zustand; bei einem Lauf mit Koordinator,
Implementierer und 37 Regel-Reviewern war nicht zu sehen, wer zu wem gehört und was jeder tut.
Festgelegt: Das Pop-out zeigt einen Baum aus `createdBy` (`addresseeTree` in
`plugins/ragents.orchestration/web/run-panel/addressee-tree.ts`, Darstellung in `AddresseeTree.tsx`),
Koordinator oben, je Eintrag Handle, Kurzbeschreibung und Zustand; ab vier gleichartigen
Geschwistern (Art und erstes Handle-Wort) eine zuklappbare Gruppe mit Zustandszählung, die Suche
erst ab mehr als zwölf Actors. Die Herkunft stand schon zuverlässig im Journal: `createdBy` ist
der Actor des erzeugenden Commands, und die Journal-Semantik prüft ihn samt `agent.spawn` beim
Schreiben und Laden; die Oberfläche rät nichts. Neu ist die optionale Kurzbeschreibung
`description` in `agent.spawned` und `script.created` (höchstens 160 Zeichen, Leerraum
zusammengezogen), gesetzt über `agent_spawn` und für TypeScript-Actors aus der Paketbeschreibung
des Actor-Programms, gekürzt; `actor_list` liefert sie, der Orchestrierungsprompt bittet darum.
Alte Journale laden ohne das Feld, die Oberfläche nimmt dann die erste Zeile der ersten eigenen
Eingabe oder einen abweichenden Anzeigenamen. `actorDescriptionMaxLength` steht neu in der
Host-API, ohne neue `HOST_API_VERSION`, weil nichts entfällt.

Verworfen: die Beschreibung aus dem Prompt des Actors abzuleiten, weil der ohne `runs.inspect`
leer ankommt und Rollentexte keine Überschrift sind; eine Gruppierung nach gleichem Prompt oder
Modell, weil gleichartige Reviewer verschiedene Prompts haben; ein eigenes Gruppenfeld im Kern,
weil der Handle-Stamm genügt und der Kern damit eine Darstellungsfrage bekäme; die Grenzen dieser
Heuristik stehen in den Offenen Grenzen von `plugins.md`. Nachgewiesen mit `apps/web/tests/addressee-tree.test.ts` (Baum, Gruppen, Beschreibung,
Zustände, Suche), `apps/web/tests/addressee-tree-browser.test.ts` (Pop-out im Run-Panel mit 37
Reviewern: Verschachtelung, Gruppe zu und offen, Suche, Auswahl) und
`packages/ragents/tests/actor-description.test.ts` (Feld über `agent_spawn` und Engine, Grenzen,
Laden mit und ohne Feld).

## Detailgrad und Zeitstempel in jedem Chat aus einem Baustein (25.09.2026)

Kapitel: `docs/spec/plugins.md` (Chat-Bausteine, Kachelchat, Host-API), `docs/usage.md`. Vorgabe des
Owners. Der Zeitstempelschalter stand nur in der Eingabe des Run-Chats; Actor-Chats in Run-Panel,
Kachel und Inspector, der Vorbereitungschat und der globale Koordinator bauten eigene Eingaben
ohne ihn, und die Kachel blendete Zeitstempel fest aus. Festgelegt: `useChatViewSettings` und
`ChatViewSwitches` (`apps/web/src/chat-view-settings.tsx`, neu in der Host-API, ohne neue
`HOST_API_VERSION`, weil nichts entfällt) liefern Detailgrad und Zeitstempel für Schalter und
Nachrichtenliste jedes Chats; `chat-timestamps.ts` geht darin auf, der Speicherschlüssel bleibt.
Die Zeitstempelwahl gilt je Run und Actor, auch Chats ohne Eingabe zeigen die Schalter, solange
Nachrichten erscheinen, und der Vorbereitungschat stempelt seine Nachrichten lokal. Mini-App-Chats
bleiben ohne Schalter, weil dort das Programm die Darstellung per Props festlegt. Nachgewiesen mit
`apps/web/tests/chat-view-switches-browser.test.ts`.

## `ragents run` ohne Ordner (25.09.2026)

Kapitel: `docs/usage.md` (Control RAgents as an agent), `skills-for-agents/ragents/SKILL.md`.
`ragents run` wählte immer eine Ordnerbindung und scheiterte damit an Profilen ohne vorhandene
Serverordner und an Vorlagen, die die Bindung über `fixed-start-options` festlegen. Festgelegt: Der
Ordner ist optional, ohne ihn wählt `run` keine Bindung, und es gilt die Vorgabe des Profils oder
der Vorlage. Ein einzelner Wert ist immer der Auftrag, zwei sind Ordner und Auftrag; die Zahl
entscheidet, nicht ein Blick ins Dateisystem, weil ein Auftrag wie ein vorhandener Pfad aussehen
kann und dieselbe Zeile sonst je nach Rechner anders gelesen würde. Legt die Vorlage die Bindung fest und ist
trotzdem ein Ordner genannt, bricht `run` vor dem Anlegen mit Ursache ab (Vorlage aus
`ragents.plugins.bootstrap`), statt eine Seite zu überstimmen; `--workstation` verlangt einen
Ordner. Nachgewiesen mit `scripts/agent/agent-cli.test.ts`.

## Modell und Denktiefe im Chat des Runs, auch nach dem Start (24.09.2026)

Kapitel: `docs/usage.md` (Wählbares Modell), `docs/spec/plugins.md` (Startoptionen, Slots),
`docs/spec/profiles.md` (Rechte im Einzelnen). Vorgabe des Owners. Seit die Startauswahl nur noch
Kacheln zeigt, ließ sich das Modell eines neuen Runs nur im Vorbereitungschat einer Vorlage mit
Leitfaden wählen, nach der ersten Nachricht gar nicht mehr. Festgelegt: Die Modellwahl steht in der
Chat-Eingabe jedes Runs (`ChatSurface` in `PluginChat.tsx`, damit Browser und Run-Panel in VS Code
gleich), schon im leeren Run und danach. Sie bleibt die Startoption `ragents.model`: dieselbe
Liste und Wahl, dieselben Rechte aus `rights` der Option (`runs.inspect`, dazu `runs.create` und
`runs.write` der Methoden), dieselbe Prüfung durch `accept` gegen die Modelle der Modellwahl des
Profils und die Stufen des Modells. Neu ist `StartOptionContribution.changeable`: eine solche Option
sperrt nach dem Start nicht, ihre Wahl schreibt der Host als `plugin.state-replaced` ins Journal.
Der Scheduler nimmt für jeden Turn des Run-Koordinators das dort gespeicherte Modell
(`coordinatorSelection`), die Anhangsprüfung beim Senden ebenso; ein laufender Turn behält sein
Modell. Ein Wechsel auf ein Modell, das Bilder, Videos oder Dateien im Gespräch des Koordinators
nicht verarbeiten kann, scheitert wie beim globalen Koordinator mit Begründung
(`model-history-unsupported`). Dafür ist `selectStartOption` asynchron. Im Web gilt bis zur ersten
Antwort des Servers nach der ersten Nachricht jede Option als gesperrt, danach sein `locked`.

Verworfen: eine eigene Methode für das Modell eines laufenden Runs, weil sie Rechte und erlaubte
Werte ein zweites Mal festgelegt hätte; ein Ereignis, das die Ausführung des Actors ändert, weil
der gespeicherte Plugin-Zustand schon im Journal steht und die Wahl vor dem Start genauso trägt.
Offen: eine Vorlage, die das Modell festlegt, bindet es nur für den Start; danach kann ein
Benutzer mit den Rechten wechseln. Bilder aus Werkzeugergebnissen prüft der Wechsel nicht, nur
Anhänge von Eingaben. Nachgewiesen mit `apps/server/tests/chat-model-choice.test.ts` (echter
Scheduler: ohne `runs.inspect` weder Liste noch Wahl, nur Modelle der Modellwahl und ihre Stufen,
die Wahl vor der ersten Nachricht im ersten Turn, ein Wechsel ab dem nächsten),
`start-options.test.ts`, `chat-attachments.test.ts` und
`apps/web/tests/start-page.browser.test.ts` (Chat-Eingabe im Browser und im Run-Panel von VS Code,
mit und ohne `runs.inspect`).

## Startauswahl im Browser wie Start in VS Code, neue Runs dort nur auf dem Server (24.09.2026)

Kapitel: `docs/spec/plugins.md` (Web als Plugin-Host: Entwurf und Startauswahl, Slots, Run-Panel
und VS Code, Arbeitsbereich), `docs/spec/profiles.md`, `docs/spec/actor-programs.md`,
`docs/usage.md`. Vorgabe des Owners. Der Browser zeigte bei "Neuer Run" eine Auftragseingabe mit
Anhang, Modell, Denktiefe und Senden, darunter Arbeitsbereich und Systemprompts und eine
durchsuchbare Liste mit Vorschau; das Run-Panel in VS Code hat dagegen keine eigene Auswahlseite:
Start der Erweiterung zeigt Kacheln, "Neuer Chat" öffnet den leeren Run, eine Vorlage startet
sofort, nur ein Leitfaden fragt vorher. Festgelegt: Die Startauswahl (`StartSelection`) besteht aus
denselben Kacheln wie Start, `StartTiles` aus `panel/StartPage.tsx` herausgelöst, und startet wie
das Run-Panel über `startEntryDirectly`; `defaultStartEntry` kommt dafür auch im Web an. Auswahl
per Liste und Vorschau, freie Auftragseingabe und Startoptionen entfallen dort; die Startoptionen
bleiben im Vorbereitungschat einer Skill-Vorlage mit Leitfaden, ein neuer Run nimmt sonst die
Vorgaben. Zweitens bietet der Browser für neue Runs keinen Arbeitsplatz als Rechner an. Die
Stelle dafür ist der Host, nicht der Baustein: `RunPanelHost.machines` ist `server` im Browser und
`all` in VS Code, `RunPanelHostProvider` reicht es als `OfferedMachines` weiter, die Web-App ohne
Host bleibt beim Server, und jede Startoption bekommt es als `machines`; die Arbeitsbereich-Wahl
zeigt danach Arbeitsplätze oder nur den Server. Der Server bleibt unverändert, VS Code und
`ragents run` binden weiter an Arbeitsplätze. Browser-eigen bleiben der Entwurf als Dialog über dem
vorherigen Run und der fehlende Serverblock, weil die Web-App genau einen Server kennt.

Verworfen: die Startoptionen als Leiste über den Kacheln zu behalten, weil die Seite dann nicht
mehr wie Start aussähe; eine Abfrage des Hosts in `WorkspaceBindingControl` oder in
`StartSelection`, weil der Unterschied beim Host liegt. Nachgewiesen mit
`apps/web/tests/start-page.browser.test.ts` (Browser nur Server, Run-Panel in VS Code auch der
Arbeitsplatz; Kacheln und Startwege), `start-tiles.test.ts`, `workspace-binding.test.ts`,
`run-panel-host.test.ts` und `plugin-bootstrap.test.ts`. Die Fixtures von
`run-panel-start-browser.test.ts` und `run-panel-focus-browser.test.ts` liefen seit den
Plugin-Fehlern im Web nicht mehr an (`failures` fehlte) und sind nachgezogen.

## `ragents run` und `send` folgen dem Turn über den Server (24.09.2026)

Kapitel: `docs/usage.md` (Agenten-Befehle), `skills-for-agents/ragents/SKILL.md`. Beide Befehle
lasen die Journaldatei im Datenordner des lokalen Profils. Zeigte `RAGENTS_URL` auf einen Server
mit anderem Datenordner oder auf einem anderen Rechner, fanden sie sie nie und warteten endlos,
obwohl der Turn längst fertig war. Festgelegt: Sie folgen dem Turn wie Web und VS Code über den
Kanal `ragents.run` und `ragents.runs.view`, also nur mit `runs.read`; die lokale Datei ist für
sie keine Quelle mehr, auch nicht auf demselben Rechner. Die eigene Eingabe ist die neue Eingabe
des Owners mit dem gesendeten Text, ihr `claimed.turnId` der Turn, dessen Status das Ende. Die
Ansicht kennt je Werkzeugaufruf nur Name, Status und Zeiten und zeigt sie nur mit `runs.inspect`;
die Werkzeugzeilen verlieren deshalb ihre Eingabe, und `--json` liefert statt Journalereignissen
die Schritte der Ansicht. `ragents.runs.events` hätte die Journalform erhalten, verlangt aber
`runs.inspect` und lädt bei jeder Änderung das ganze Journal. Reißt der Strom ab oder scheitert
eine Anfrage, endet der Befehl mit 1 und der Ursache; der Gesundheitsabruf alle fünf Sekunden
entfällt. `journal` liest weiter lokal, mit `RAGENTS_URL` über `ragents.runs.events`.

## Jede Startoption nennt ihre Rechte (24.09.2026)

Kapitel: `docs/spec/profiles.md` (Rechte im Einzelnen), `docs/spec/plugins.md` (Startoptionen).
Vorgabe des Owners. `ragents.startOptions.list` und `.select` verlangten pauschal `runs.inspect`;
ein Benutzer ohne dieses Recht konnte einen Run deshalb weder im Web noch in VS Code noch per
`ragents run` an seinen Ordner oder Arbeitsplatz binden, obwohl nur die Modellwahl technische
Einsicht gibt. Festgelegt: `StartOptionContribution.rights` nennt die Rechte einer Option, die
Methoden verlangen nur noch `runs.read` und `runs.create` (die Wahl dazu `runs.write`). Modell- und
Systemprompt-Wahl erklären `runs.inspect`, die Ordnerbindung nichts. Eine Option ohne die Rechte
fehlt in der Liste, statt als nicht wählbar zu erscheinen: `selectable: false` liefert Wert und
Darstellung weiter aus und hätte Modelle und Prompttexte verraten. Ihre Wahl scheitert mit
`access-denied`, auch über `options` von `ragents.overseer.createRun`. Eine Option eines anderen
Plugins ohne `rights` ist damit ohne `runs.inspect` sichtbar.

## Formulare im Mini-App-Rahmen, Aktivieren nach dem Entfernen (24.09.2026)

Kapitel: `docs/spec/actor-programs.md` (Backend and client, Create, edit, and activate, Kachel-Host
und Funktionen-Reiter). Vorgabe des Owners. Der Rahmen einer Ansicht war ohne `allow-forms`
gesandboxt; Chromium feuerte dann kein `submit` ("Blocked form submission"), und `UI.Form` schickte
nie ab. Festgelegt: `allow-forms` im iframe-Attribut und in der CSP-Direktive `sandbox`;
`form-action 'none'` bleibt, eine echte Übermittlung an eine Adresse ist weiter unmöglich.
Nachgewiesen in `apps/web/tests/actor-view-frame.test.ts` mit der CSP der Frame-Route. Zweitens
stoppte `actor_program_remove` den TypeScript-Actor, dessen Handle belegt blieb, und ein Paket
gleichen Namens scheiterte beim Aktivieren an "Handle already belongs to an actor". Festgelegt: Ist
der Inhaber des Handles ein gestoppter TypeScript-Actor, startet das Aktivieren ihn neu
(`restartActor` im Namen des Aufrufers, wie das Stoppen beim Entfernen) statt einen anzulegen; sein
Zustand muss zum neuen Schema passen. Jeder andere Inhaber bleibt ein Fehler mit Ursache.

## Jede Wurzel gehört einer Maschine: ein Alias läuft auf dem Server, auch im Run auf einem Arbeitsplatz (24.09.2026)

Kapitel: `docs/spec/plugins.md` (Zuständigkeit je Facette; Arbeitsbereich, Sandbox-Werkzeuge und
Prozesse; Prozess-Sandbox des Servers; Language-Server-Plugins; Skills and starting tasks),
`docs/spec/actor-programs.md` (Packages and actor binding), `docs/spec/core.md` (Skills der
Agentenlaufzeit, Arbeitsbereich im Systemprompt), `docs/spec/typescript-platform.md` (Execute
code), `docs/operations.md` (Prozess-Sandbox, Datenablage, Isolation je Run). Vorgabe des Owners.

**Befund.** Ein an einen Arbeitsplatz gebundener Run schickte jede Operation an dessen Executor,
die Wurzeln des Servers kannte aber nur der Executor des Servers: den Workspace der Actor-Programme
unter `@actors` und die Skill-Ordner. `read @actors/...` scheiterte mit "Unbekannter
Arbeitsverzeichnis-Alias", `$RAGENTS_ACTORS_DIR` war in der Bash des Arbeitsplatzes leer, und die
SKILL.md unter ihrem Serverpfad lag "außerhalb des Arbeitsverzeichnisses". Die Prompts versprachen
beides trotzdem. Weil jeder VS-Code-Run mit Ordner so gebunden ist, ließen sich dort weder
Mini-Apps bauen noch Skill-Dateien lesen; Spec und Test schrieben den Mangel fest.

**Festlegung.** Jede Wurzel gehört einer Maschine: die Wurzel des Runs der Maschine seiner Bindung,
die Wurzeln mit Alias dem Server. Eine Operation läuft beim Executor der Maschine, der die
angesprochene Wurzel gehört; die Bindung bestimmt nur die Wurzel des Runs und damit, wo eine
Operation ohne Alias läuft. Welche Wurzeln eine Eingabe anspricht, erklärt das Modul der Operation
als Fußabdruck; `SandboxServices.execute` fragt ihn vor dem Versand beim Executor des Servers, der
dieselben Module trägt wie jeder Arbeitsplatz, und schickt eine Operation mit Alias an diesen, im
Kontext des Runs auf dem Server. Ein Aufruf über beide Maschinen scheitert mit
`workspace-roots-mixed`. `bash` nimmt ein `cwd`: mit Alias läuft sie auf dem Server in derselben
Prozess-Sandbox wie jeder andere Prozess des Runs dort, und nur diese Bash hat die Variablen der
Wurzeln des Servers; eine eigene Sperre gibt es dafür nicht, weil der Weg den Node-Prozessen gleicht,
die ein Run auf dem Server ohnehin startet. Skills stehen unter `@skills/<name>/`, in jeder Bindung
nur lesbar. Was ein Prompt über Wurzeln sagt, entsteht je Run: die Selbstbeschreibung des
Arbeitsbereichs nennt Aliasse, Weg und Variablen je Bindung, Plugin-Prompts und
Werkzeugbeschreibungen nennen nur den Alias.

**Warum die Gründe vom 20.09.2026 hier nicht greifen.** Der Eintrag "Ein Arbeitsplatz-Executor,
überall derselbe" verwarf eine Weiche je Pfad: die Bindung `client` schickte damals fünf
Grundoperationen zum Arbeitsplatz und behielt die Werkzeuglogik auf dem Server, jede Grundoperation
musste je Pfad entscheiden, Sprachserver gab es bei `client` nicht, und die Git-Zugangsdaten des
Servers gingen in eine fremde Bash. Jetzt wandert eine ganze Operation je Wurzel, und beide
Executoren tragen dieselben Module mit der ganzen Werkzeuglogik; jeder behält seine Sprachserver;
die Weiche liegt an einer Stelle vor dem Versand und fragt den Alias, keinen Pfad; und die Bash auf
dem Server ist keine fremde Bash, sondern läuft in der Sandbox des Runs mit dessen Ordnern. "Keine
gemischten Wurzeln" bleibt für den einzelnen Aufruf: er erreicht genau eine Maschine.

**Beim Bau entschieden.** Der Fußabdruck hängt am Modul (`WorkspaceExecutorModule.footprints`, je
Operation eine Funktion der Eingabe, die nie wirft, abgefragt über
`WorkspaceOperationExecutor.footprintOf`) statt an der Operation, damit `operations` ein
Verzeichnis von Funktionen bleibt; der Executor lehnt einen Fußabdruck für eine fremde Operation
beim Bau ab. Er nennt `{ roots: { aliases, runRoot }, durationMs? }`: die Laufzeit, die eine Eingabe
selbst verlangt, gehört dazu, damit `durationOf`, die letzte Stelle, an der der Sandbox-Host eine
Werkzeugeingabe las (die Zeitgrenze der Bash), entfällt; `commands.run` erklärt so sein `timeoutMs`,
und kein Aufrufer muss dafür noch `durationMs` nennen. Aliasse gibt es nur auf dem Server, deshalb
geht jeder Alias dorthin, auch ein unbekannter: der Server nennt dann die bekannten, wie in einem
Run auf dem Server, statt dass der Arbeitsplatz "bekannt: keine" meldet. Der Parameter der Bash
heißt `cwd`, relativ zum Arbeitsverzeichnis oder mit Alias, nie absolut, weil ein absoluter Pfad nur
auf einer Maschine gilt; er gehört zur Bash der Agentenlaufzeit, die Auflösung des Alias zum
Executor, und ein nur lesbarer Ordner ist erlaubt, damit eine Bash im Skill-Ordner lesen kann.
`WORKSPACE_EXECUTOR_VERSION` ist 4, weil ein älterer Arbeitsplatz `cwd` still überginge. Der
Skill-Alias ist `@skills/<name>` je Skill als eigene nur lesbare Wurzel direkt auf seinem Ordner: kein
kopierter Index, der veraltet, und keine Symlinks, die aus der Wurzel führen; der Name ist ohnehin der
Ordnername. Dafür gilt ein Skillname im ganzen Profil einmal und wird beim Start geprüft,
`files.list` und `files.read` lösen einen Alias mit Unterordner auf, und `workspaceProcessContext`
lehnt doppelte oder verschachtelte Aliasse ab. `Skill.location` ist der Ort für das Modell,
`filePath` bleibt der, aus dem der Host liest. Die Selbstbeschreibung entsteht beim Auflösen aus
`WorkspaceSandboxHost.serverRoots()`, den registrierten Wurzeln und den Skills, ohne `directoryFor`
zu rufen, das beim Auflösen aller Runs zum Start Ordner anlegen würde. Die Dateiwerkzeuge lösen
`$RAGENTS_..._DIR` am Anfang eines Pfads weiter auf, weil der globale Koordinator seinen
Journalordner nur über die Variable kennt und immer auf dem Server arbeitet.

Verworfen: die Wurzeln des Servers in Runs auf einem Arbeitsplatz gar nicht anzubieten, weil es dort
dann keine Mini-Apps und keine Skill-Dateien gäbe, und VS Code bindet jeden Run mit Ordner an den
Arbeitsplatz; eigene Dateifunktionen je Plugin nach dem Muster von `document_write`, weil jedes
Plugin mit einer Wurzel Lesen, Bearbeiten, Schreiben und Diagnostik doppelt bräuchte und die
Sprachserver seine Dateien trotzdem nicht erreichten. Nachgewiesen mit
`apps/server/tests/workspace-foreign-machine.test.ts` (Dateiwerkzeuge, Sprachserver, Bash,
`typescript_eval`, Skills, gemischter Aufruf, Selbstbeschreibung und ein Actor-Programm vom Anlegen
bis zum Aktivieren in einem Arbeitsplatz-Run), `process-sandbox.test.ts` (Bash mit Alias in der
Sandbox des Runs) und `pnpm check:remote-workspace` mit Actor-Programm und Skill. Offen bleibt, dass
Prozessleiste und Diagnosereiter eines Runs auf einem Arbeitsplatz nur zeigen, was beim Executor
der Bindung läuft (`TODO.md`).

## Zusätzliche Ordner für die Prozess-Sandbox im Arbeitsbereichs-Vertrag (24.09.2026)

Kapitel: `docs/spec/plugins.md` (Zuständigkeit je Facette, Prozess-Sandbox des Servers). Ein
Arbeitsbereich, den ein Plugin beisteuert, kann Ordner außerhalb seines Ordners brauchen: ein
Git-Worktree je Run, dessen gemeinsames Repository (`git rev-parse --git-common-dir`) woanders
liegt. Die Sandbox sperrte es, und Git per Bash scheiterte mit `not a git repository`. Festgelegt:
`SessionWorkspace.sandboxFolders`, damit auch die `WorkspaceResolution` eines Beitrags, nennt je
Ordner `directory`, absolut, und `access`, `read` oder `write`; der Sandbox-Host übernimmt sie beim
Bau der Regeln des Runs, ein relativer Pfad ist ein Fehler. Der Kern kennt dabei kein Git, und die
Freigabe gilt nur für Prozesse, nicht für die Dateiwerkzeuge. Host-API-Liste und Manifest bleiben,
wie sie sind: das Feld ist Teil eines Typs, kein neuer Wert. Nachgewiesen unter macOS mit echter
Sandbox in `apps/server/tests/process-sandbox.test.ts`: `git status` und ein Commit im Worktree
gelingen nur mit dem erklärten Ordner.

## Schemaverletzungen mit Pfad, getypte Vorlagen, Anlegen ganz oder gar nicht (24.09.2026)

Kapitel: `docs/spec/overview.md` (Verbindliche Regeln, Regel SCHEMAVERLETZUNGEN NENNEN PFAD UND
GRUND), `docs/spec/actor-programs.md` (Packages and actor binding, Dateirechte, Create, edit, and
activate, neuer Abschnitt Vorlagen und Anlegen, Offene Grenzen), `docs/spec/plugins.md`
(Dispatcher), `docs/spec/typescript-platform.md` (TypeScript-Actors). Drei Fehlerklassen hingen
zusammen: Vorlagen trugen Felder, die das maßgebliche Schema nicht mehr kennt, ohne dass es jemand
merkte; die Ablehnung nannte das Feld nicht, sodass nur Raten half; und ein gescheitertes Anlegen
ließ einen halben Ordner liegen, der den Namen sperrte, ohne als Programm zu erscheinen.

**Eine Schemaverletzung nennt Pfad und Grund, überall über `schemaComplaints`.** Dispatcher
(Eingabe, Ergebnis, Kanalparameter), Operationen und Startoptionen des Plugin-Hosts,
Werkzeugergebnisse, `package.json.ragents`, der Backend-Vertrag und das Test-SDK der
Actor-Programme (in `testing.js` mitgebündelt) antworten nicht mehr mit einem pauschalen Satz oder
der ersten Meldung von `Value.Errors`, sondern mit jedem verletzten Pfad und seinem Grund. Das
Präfix jeder Meldung bleibt. `schemaComplaints` nimmt dafür den Namen der Wurzel (`params`,
`result`, `value`, `ragents`, `contract`), weil "input" für ein Ergebnis oder eine Paketdatei falsch
wäre, und liefert nie einen leeren Grund.

**Vorlagen sind getypte Werte gegen das maßgebliche Schema und werden alle im Test angelegt und
aktiviert.** Die `ragents`-Metadaten einer Vorlage sind ein `AppPackage`, `package.json` entsteht
beim Anlegen daraus (`templateFiles`), und der Typ der Dateien schließt eine zweite Fassung als
Text aus. Verliert das Schema ein Feld, meldet der Compiler jede Vorlage, die es noch setzt; der
neue Test legt jede Vorlage an und aktiviert sie mit Typprüfung, Build und ihren Tests, damit auch
ihr Quellcode nicht unbemerkt gegen die Plattform veraltet. `width` und `height` entfallen aus den
Vorlagen und aus dem Spec-Satz; die Größe einer View bestimmt der Host.

**Anlegen ist ganz oder gar nicht, auch nach einem Absturz.** Ein Paket entsteht in
`actor-workspace/.staging/` auf demselben Dateisystem, alle Schritte laufen dort, erst ein `rename`
macht es unter `actors/<name>` sichtbar. pnpm-Workspace, Diagnose und Agenten sehen so nie ein
halbes Paket, und ein Fehler lässt den Namen frei. POSIX-`rename` ersetzt einen leeren Zielordner,
deshalb prüft der Host unmittelbar davor synchron, ob der Name belegt ist; gleichzeitige Anlagen
desselben Namens schließt eine Reservierung im Prozess aus. Reste eines abgestürzten Serverlaufs
räumt die nächste Anlage im Run weg und schont die laufenden Anlagen des Prozesses, die er kennt;
einen zweiten Prozess für denselben Run verhindert das Journal-Lock. `importPackage` legt die
Quellen eines Run-Scripts auf demselben Weg an. Der Staging-Ordner liegt im abgeglichenen
Arbeitsbereich, damit Eigentümer und Rechte wie bisher entstehen; `syncWorkspaceOwnership`
überspringt dafür Einträge, die während des Abgleichs verschwinden.

**Kein Paket kennt seinen Ordner.** `prompts.js` band `readPrompt` an den absoluten Ordner beim
Installieren, nach dem Umbenennen also an das Staging. Es bestimmt sein Paket jetzt aus
`import.meta.url`; das gilt ebenso für die Kopie im Build-Ordner. Verworfen: `prompts.js` nach dem
Umbenennen neu zu schreiben, weil dann nach dem einen sichtbaren Schritt noch etwas scheitern kann
und das Paket halb richtig stünde. Ein Backend darf das Modul dafür nicht mitbündeln; der Host baut
mit externen Paketen, `workflow-foundation.test.ts` baut jetzt ebenso.

Verworfen: nur `width` und `height` aus den Vorlagen zu löschen, weil die nächste Schemaänderung
die Vorlagen wieder unbemerkt bräche und die Meldung weiter nichts nennte; ein try/rm in
`scaffold`, weil es während des Aufbaus ein halbes Paket zeigt, nach einem Absturz nichts aufräumt
und im Fehlerfall einen Ordner löschen kann, den inzwischen ein anderer Aufruf angelegt hat.

## Eingabebrücke auch durch Mini-App-Frames (24.09.2026)

Kapitel: `docs/spec/plugins.md` (VS-Code-Erweiterung), `docs/usage.md` (VS-Code-Bedienung).
Die bisherige Tastatur- und Zwischenablagebrücke endete im Run-Panel. Eine Mini-App liegt in
einem weiteren iframe; dort funktionierte Tippen, aber HEX-Einfügen und VS-Code-Tastenkürzel
erreichten ihr Ziel nicht. Die bestehenden Handler werden gemeinsam über die bereits geprüften
Frame-Verbindungen verwendet. Die VS-Code-Wurzel aktiviert den Transport; weitere gehostete
Frames reichen ihn weiter. Es gibt keine Sonderbehandlung einzelner Textfelder und keine zweite
Shortcutliste. Lokale Textbearbeitung und behandelte Ereignisse bleiben lokal; normale Browser
verwenden weiterhin ihre native Eingabe.

## Prozess-Sandbox für alles, was ein Run auf dem Server startet (24.09.2026)

Kapitel: `docs/spec/plugins.md` (Arbeitsbereich, neuer Abschnitt Prozess-Sandbox des Servers;
Offene Grenzen), `docs/spec/profiles.md` (Rechte im Einzelnen, Offene Grenzen),
`docs/operations.md` (Prozess-Sandbox des Servers, Datenablage). Vorgabe des Owners: Auf dem
Server laufen `bash`, `commands.run` und die Node-Prozesse der TypeScript-Plattform in einer
Prozess-Sandbox; auf einem Arbeitsplatz bleibt es die Bash des Entwicklers.

**Warum.** Die Rechte des Profils begrenzen, welche Methoden ein Benutzer ruft, nicht, was nativer
Code eines Runs auf dem Serverrechner liest. Ein Snippet des globalen Koordinators konnte die
Journale anderer Benutzer lesen, jede Bash eines Runs die Ablage anderer Runs und die Geheimnisse
im Home des Serverkontos, und alles durfte ins Netz. Eine Systemkennung je Benutzer hätte das nur
für Dateien geschlossen und einen Server mit root-Rechten verlangt.

**Festlegung.** Die Sandbox ist `@anthropic-ai/sandbox-runtime` in fester Fassung 0.0.77
(Apache-2.0): Seatbelt unter macOS, bubblewrap mit Netz- und PID-Namensraum unter Linux, Netz nur
über einen Proxy mit Domain-Allowlist. Sie hängt an einer Stelle: der Sandbox-Host des Servers gibt
sie dem Prozesskontext eines Runs mit, jeder Prozessstart im Executor packt sich über
`sandboxedLaunch` ein; kein Werkzeug und kein Kern kennt sie. Die Regeln entstehen je Run aus
seinen Ordnern (lesen und schreiben: Arbeitsbereich, Serverordner, registrierte Wurzeln, Home,
NuGet-Cache, eigener Temp-Ordner; gesperrt: Homes, Temp und Datenordner des Servers, wieder lesbar:
Host-Ordner, Toolchains, eigene Ablage, nur lesbare Wurzeln). Die Allowlist steht in der Sektion
`ragents.workspace` (`PROCESS_SANDBOX_NETWORK`); die Vorgabe npm, NuGet und GitHub deckt
Paketinstallation, Restore und Git über HTTPS, die eigene Adresse des Servers ist immer dabei, weil
der globale Koordinator seinen Server über sie erreicht. Abschalten geht nur ausdrücklich
(`PROCESS_SANDBOX: "off"`); Windows ohne diese Angabe, Linux ohne bubblewrap und ein Rechner, auf dem
der Probeprozess beim Start scheitert, brechen den Start ab. Windows fällt heraus, weil die
Bibliothek dort Ordnerregeln nur für die ganze Sitzung setzt, nicht je Run.

**Was dafür nachgezogen wurde.** Werkzeuge geben Orte vor, die die Sandbox sonst bräche: `PATH`
nennt in der Sandbox die Ziele seiner Symlinks, unter macOS sind `/tmp/.dotnet*` und
`/tmp/MSBuild*` samt Unix-Sockets unter `/tmp` erlaubt und `trustd` erreichbar, .NET bleibt auf IPv4
und MSBuild ohne wiederverwendete Knoten, Build-Server und gemeinsamen Compiler, damit kein
Build-Prozess eines Runs Aufträge eines anderen annimmt. Lesbare Ordner, die einen beschreibbaren
enthalten, werden in ihre übrigen Einträge zerlegt, weil bubblewrap sie sonst schreibgeschützt
darüberlegt; ebenso freigegebene Ordner, die einen gesperrten enthalten (etwa ein Projektordner um
den Datenordner), weil Seatbelt die Freigaben innerhalb der Sperre sonst wieder sperrt. Nachgewiesen mit `apps/server/tests/process-sandbox.test.ts`, `pnpm
check:remote-workspace` und einem echten `dotnet build` samt NuGet-Restore, `npm install`, `pnpm
install` und `git clone` im Arbeitsbereich unter macOS und Linux (Container).

## Durchgehender Hintergrund für Mini-App und Chat (24.09.2026)

Kapitel: `docs/spec/plugins.md` (Run-Panel).
Die Grundfarbe der Mini-App (`--app`) setzt sich hinter dem reservierten Chatbereich fort.
Die Bereiche bleiben im Layout getrennt, ohne den bisherigen Farbsprung. Der äußere Rahmen
bekommt gerade Ecken oben und unten; die innere Chatkarte behält Rahmen und Schatten.

## Statuszeile bündig zur Chat-Eingabe (24.09.2026)

Kapitel: `docs/spec/plugins.md` (Run-Panel).
Die Antwortvorschau im eingeklappten Chat verwendet denselben horizontalen Abstand wie
die Eingabe. Ihr bisheriger eigener Abstand ließ den Text links über die Feldkante hinausragen.

## Chat-Zeitstempel an der ersten Textzeile ausrichten (24.09.2026)

Kapitel: `docs/spec/plugins.md` (Chat-Bausteine).
Zeitstempel und Inhalt teilen die erste Textgrundlinie. Ein fester oberer Versatz passte nicht
zu den unterschiedlichen Innenabständen von Schrittgruppen und Nachrichtenblasen; dadurch
stand die Uhrzeit sichtbar höher als die zugehörige Nachricht.

## Ein Begriff je Sache (24.09.2026)

Kapitel: `docs/spec/overview.md` (neuer Abschnitt Glossar, Begriffe), alle Spec-Kapitel,
`docs/spec/actor-programs.md` (früher `run-modules.md`), `docs/usage.md`, `docs/operations.md`,
`docs/development.md`, `README.md`, Homepage und Guide (Kapitel `guide-plugins`, früher
`guide-extensions`), `docs/concepts/run-fork.md` (früher `run-templates.md`). Vorgabe des Owners:
Doku, Oberfläche und Code sprachen für dieselbe Sache verschiedene Wörter (Canvas, Arbeitsfläche,
Kachelfläche; Umgebung, Ziel, Target, Connection; Lauf, Unterhaltung, Session; Einstieg,
Startvorlage, Kachel; übergeordneter Koordinator, Overseer), und dasselbe Wort für verschiedene
Sachen (Bühne, Vorlage, Arbeitsbereich, Extension).

**Festlegung.** Die Tabelle "Glossar" in `overview.md` ist maßgeblich: Fläche (Code `surface`),
Kachel nur auf der Fläche, Bühne für die eine Mini-App im Run-Panel, Vorlage für Einträge der
Startseite (Arten Skill und Script, Code bleibt `StartEntry`), Run-Fork für das Konzept der Kopie,
Arbeitsbereich und Arbeitsplatz getrennt, Leiste für die Reiterleiste, Server für einen Eintrag der
VS-Code-Erweiterung (Code `connection`), globaler Koordinator, Profil für die Profildatei und Rolle
für die Modellvorgabe, Plugin für RAgents und Erweiterung nur für VS Code, Hook statt
Agent-Extension, Run statt Lauf, Unterhaltung und Session, Actor-Programm als einziger Name der
Programme. Server statt Umgebung, weil "Umgebung" auf derselben Seite schon Umgebungsvariablen meint
und jeder Eintrag genau ein RAgents-Server ist, auch das lokal gestartete Profil; so heißt es auch
in der Bindung (`machine: "server"`).

**Code ohne Altnamen.** Die Host-API 5 ist noch nicht veröffentlicht, darum ändern sich ihre Namen
ohne neue Nummer und ohne Übergang: `runManagementToken` (Typ `RunManagement`), `runGuardToken`,
`runWorkspaceProviderToken`, `SurfaceControllerProvider`, `useSurfaceController`, `actorTone`;
`stopChatActor` entfällt samt `stop` in `SessionContext` und `useChat`. Die Nachrichtenschicht nennt
`ragents.runs.list`, `ragents.runs.delete` und den Kanal `ragents.runs` statt `ragents.sessions.*`.
Im Web heißen Slot und Beiträge `surface` und `surfaceElements`, der Dialogbereich `surface`, das
Chat-Ereignis eines Plugins `kind: "plugin"` (`pluginEvents`), die Einstellungen `agentHooks`. Wo
"surface" schon etwas anderes meinte, heißt es jetzt nach seiner Sache: Farbton (`actorTone`,
`data-tone`), Anzeigeort eines Chats (`display`), Seite im Standort des globalen Koordinators
(`page`) und Platzierung einer Startoption auf der Startseite (`page`). Die VS-Code-Erweiterung
spricht im Code nur noch von `connection`, Befehls-IDs und Context-Keys eingeschlossen.

**Was bleibt.** Journalisierte Namen ändern sich nicht, weil es keine Migrationen gibt: das Werkzeug
`canvas_layout_replace` (steht in der Werkzeugauswahl von Actors und in Capabilities aktivierter
Programme; ein unbekannter Name ließe deren nächsten Turn scheitern), die Platzierungsart `canvas`
im Zustand der Actor-Programme und die Rolle als `profile` in Journal und `model_list`. Der
Plugin-Vertrag nennt einen Run in Typnamen noch `Session` (`SessionContext`, `sessionMetadata`,
`storage.session`); das sind rund 3800 Stellen, teils Agent- und Anmeldesitzungen, und bekommt
einen eigenen Umbau (TODO). Verworfen: Aliasse für alte Methoden-, Befehls- und Host-API-Namen,
weil der Kurs keine Altpfade kennt. `docs/decisions.md` bleibt als Geschichte unverändert, nur
Kapitelverweise zeigen auf die neuen Dateien.

**Globaler Koordinator ohne Shell bei Anmeldung.** Mit Benutzern hat der globale Koordinator kein
`bash` mehr: die Shell liefe als Serverprozess und könnte die Journale anderer Benutzer lesen. Seine
JSON-RPC-Aufrufe schickt er dann aus Snippets mit `fetch` und seinem Token aus `process.env`; ohne
Anmeldung bleibt `bash`. Ein vorhandener Koordinator mit `bash` in der Werkzeugauswahl meldet
`global-tools-changed`, bis sein Gespräch zurückgesetzt ist. Die Grenze schließt sich damit nicht
ganz: Snippets sind nativer Node-Code des Servers ohne eigene Systemkennung (`profiles.md`, Offene
Grenzen). Kapitel: `core.md` (Globaler Koordinator), `profiles.md`.

## Bindung eines Runs: Rechner und Ordner getrennt (24.09.2026)

Kapitel: `docs/spec/plugins.md` (Zuständigkeit je Facette, Run-Panel, Host-API, Arbeitsbereich,
Sandbox-Werkzeuge und Prozesse samt Shell, Dateien, Prozessen und Browser, Offene Grenzen),
`docs/spec/core.md` (Umzug, Serverordner), `docs/spec/profiles.md` (core), `docs/operations.md`
(Browser, Session-Isolation, Umzug), `docs/development.md`. Vorgabe des Owners: `ragents.workspace.binding`
mit `fresh`, `path` und `client` vermischte, WO ein Run arbeitet, mit WELCHEM Ordner, und
`WorkspaceRuntime.kindOf` vermischte die Art eines beigesteuerten Arbeitsbereichs mit der Bindung.

**Zwei Angaben.** Die Bindung ist `{ machine, folder }`: `machine` ist `"server"` oder
`{ client, label }`, `folder` ist `"fresh"` oder `{ path }`, alle vier Kombinationen gelten.
`machine`, weil der Executor genau einer Maschine entscheidet, wo gearbeitet wird, und Spec und
Executor schon so reden; verworfen: `where` (kein Substantiv, liest sich im Code schlecht) und
`host` (im Code für `PluginHost` und die Host-API belegt). `folder` statt `workspace`, weil der
Arbeitsbereich beides zusammen ist.

**Neuer Ordner je Run auf dem Arbeitsplatz.** Der Arbeitsplatz nennt bei der Anmeldung seinen
Ordner für Runs (`runsDirectory`, Pflicht; VS Code und kopfloser Arbeitsplatz nehmen `runs` in
ihrem Datenordner), und `accept` hält den Ordner des Runs darunter als `{ path, fresh: true }` fest.
Die Auflösung braucht den Pfad ohne den Arbeitsplatz und für immer denselben, weil der Server beim
Start alle Arbeitsbereiche auflöst und Prompt wie Laufzeit ihn nennen. Verworfen: den Pfad beim
Auflösen aus der Registry zu nehmen (scheitert ohne Verbindung), ein symbolisches `cwd`, das erst der
Arbeitsplatz auflöst (der Server braucht den Pfad), und den Ordner für Runs im `machine`-Teil
festzuhalten (er gehört zum Ordner, und die Trennzeichen-Logik stünde zweimal da). Angelegt wird er
vom Executor dort, mit dem neuen Modul `runFolder` (`create`, `remove`); der des Servers lehnt beides
ab, weil dort der Host den Ordner anlegt. Der Host legt ihn vor dem ersten Auftrag an, nie beim
Aufräumen, und nimmt ihn beim Löschen des Runs mit. `WORKSPACE_EXECUTOR_VERSION` ist deshalb 3; ein
Arbeitsplatz mit älterem Paket wird bei der Anmeldung abgewiesen.

**Beitrag auf dem Arbeitsplatz.** `WorkspaceResolver.workstation` stellt den neuen Ordner dort mit
Bezeichnung und Schritten, Operationen des Executors mit Eingabe (`prepare` nach dem Anlegen,
`release` vor dem Wegräumen), weil Code eines Plugins nie auf dem Arbeitsplatz läuft. Ein Git-Worktree
geht so mit `commands.run` (Test `workspace-foreign-machine.test.ts`); verworfen ist eine eigene
Worktree-Operation im Executor, solange sie keinen zweiten Nutzer hat. Ein Beitrag ohne
`workstation` schließt den neuen Ordner auf dem Arbeitsplatz aus (`workspace-binding-unsupported`),
statt dort still einen leeren anzubieten, der seine Art ersetzt; ein solches externes Plugin bietet ihn deshalb nicht an.

**`placementOf` statt `kindOf`.** Die Laufzeit beantwortet je Run `machine`, `folder` und, wenn ein
Beitrag den neuen Ordner gestellt hat, `kind`. Ein externes Plugin fragt seinen Worktree jetzt als "auf dem Server und
von seiner Art" ab. Weil der Dienst hinter `workspaceRuntimeToken` damit ein Mitglied verliert, das
ein gebautes Bundle aufruft, ist die Host-API 5; neu ist `RUN_FOLDER_OPERATIONS`.

**Keine Migration, eine Abbildung.** Ältere Journale tragen `{ kind: ... }`. `storedWorkspaceBinding`
bildet die drei Werte beim Lesen auf je genau eine Kombination ab (neuer Ordner auf dem Server,
vorhandener Ordner auf dem Server, vorhandener Ordner auf dem Arbeitsplatz); Server, `ownerOnly` und
Web lesen gespeicherte Werte nur über sie. Das ist der einzige Altpfad: Journale sind unveränderlich,
die Abbildung verliert und erfindet nichts, und Sperren hätte jeden bestehenden Run unbrauchbar
gemacht, ohne dass etwas unklar wäre. `accept` und festgelegte Startoptionen nehmen nur die neue Form;
eine Vorlage mit alter Form scheitert beim Start des Profils an der Schemaprüfung. Was keiner Form
entspricht, sperrt den Run mit Ursache wie bisher.

## Steering: Nachrichten an einen laufenden Turn kommen in diesen Turn (24.09.2026)

Kapitel: `docs/spec/core.md` (Scheduler and turns, Agent-Session und Agentenlaufzeit, Unterbrechen
eines Turns, Chatprojektion, Dateiformat, Offene Grenzen), `docs/spec/overview.md` (Turn),
`docs/development.md` (Die fünf Begriffe, Journalbeispiel), dazu die Eingriffs-Liste im Eintrag
"Eigenes Verhalten in der Agentenlaufzeit". Vorgabe des Owners: Steering sauber verdrahten. Spec
und Oberfläche versprachen "Dazwischenfunken", die Agentenlaufzeit hatte Warteschlangen dafür,
aber RAgents rief sie nie: jede Nachricht an einen arbeitenden Agenten wartete auf dessen Ende und
bekam einen eigenen Turn.

**Die Engine holt, die Laufzeit schiebt nicht.** Die Agentenschleife fragt vor jeder Modellanfrage
eine Steering-Quelle ab; die Engine beantwortet sie über `TurnRequest.claimSteering`, und erst in
diesem Augenblick schreibt der Scheduler `turn.input-steered` für die übernommenen Inputs. So gibt
es kein Fenster, in dem eine Nachricht in der Laufzeit steckt, aber im Journal noch wartet oder
umgekehrt: was die Quelle nicht mehr abfragt, weil der Turn endet oder abgebrochen ist, bleibt
wartend und beginnt den nächsten Turn. Verworfen: `AgentSession.steer` bei jedem neuen Input
aufzurufen, weil die Engine dann nicht wüsste, ob die Schleife die Nachricht vor ihrem Ende noch
gesehen hat; eine Nachricht wäre entweder doppelt (eigener Turn danach) oder verloren.

**Ein eigenes Ereignis statt eines zweiten Turn-Starts.** `turn.input-steered` nennt Turn und Input;
der Input gilt als von diesem Turn beansprucht (`steered: true`). `turn.started` bleibt der eine
Beginn eines Turns, die Wiedergabe alter Journale ändert sich nicht. Weil ein älterer Stand das neue
Ereignis ablehnen würde, schreibt das Journal Dateiformat 6 und liest weiter 4 und 5. Die
Journalprüfung verlangt, dass der Turn läuft und kein älterer wartender Input übersprungen wird;
dass nur ein Agent Steering nimmt, prüft allein die Entscheidung, damit diese Regel später ohne
Journalbruch wachsen kann.

**Regeln.** Steering gibt es nur für Actors mit dem Agententreiber und nur während ihres Turns; ein
TypeScript-Actor hat kein Modell, das etwas vor einer nächsten Anfrage sehen könnte, seine Inputs
warten wie bisher. Übernommen werden alle wartenden Inputs des Actors auf einmal, in
Journal-Reihenfolge, bis vor den ersten mit mehr als 30000 Zeichen Inhalt: das ist die Grenze, die
die Spec schon für Steering-Text nannte; ein längerer Text wartet samt allem danach auf einen
eigenen Turn, statt gekürzt zu werden oder die Reihenfolge zu brechen. Nach dem Abbruchsignal
übernimmt ein Turn nichts mehr; was er vorher übernommen hat, gehört ihm wie sein Start-Input.
Die Quelle wird schon vor der ersten Anfrage gefragt, deshalb fasst ein Turn auch Nachrichten
zusammen, die vor seinem Start schon warteten. Anhänge gehen denselben Weg wie beim Turn-Start;
scheitert ihre Aufbereitung, scheitert der Turn mit dieser Ursache.

**Werkzeuge laufen zu Ende.** Die Laufzeit konnte einen laufenden Werkzeugaufruf bei Steering in
den Hintergrund schieben: Zwischenergebnis ans Modell, das echte Ergebnis später als getaggte
Nachricht. Mit dem Journal verträgt sich das nicht: der Aufruf bliebe über seinen Turn hinaus
offen, und ein Turn mit offenen Aufrufen scheitert. Entfernt sind deshalb das Weiterlaufenlassen,
die Follow-up-Warteschlange (RAgents beginnt nach einem Turn ohnehin einen neuen), `steer`,
`followUp`, `queue_update`, `streamingBehavior` und die Queue-Modi. Wer nicht warten will,
unterbricht den Turn.

**Sichtbar im Verlauf.** Chat und Actor-Verlauf tragen an jeder eingehenden Nachricht ihre
Input-Kennung; `turn.input-steered` markiert sie an ihrer Stelle mit "In den laufenden Turn
eingespeist". Der Senden-Knopf heißt während eines Turns "In den laufenden Turn einspeisen".
`ragents send` folgt einer eingespeisten Nachricht bis zum Ende ihres Turns. Der Kern kennt dabei
kein Werkzeug; er kennt Turn, Input und Treiberart.

## Ein globaler Koordinator je Benutzer, seine Werkzeuge handeln als dieser (24.09.2026)

Kapitel: `docs/spec/core.md` (Übergeordneter Koordinator), `docs/spec/profiles.md` (Run ownership,
Eigentum im Einzelnen, Rechte im Einzelnen, Offene Grenzen), `docs/spec/plugins.md` (Rechte des
Koordinators, Kopfzeile), `docs/usage.md` (globaler Koordinator). Vorgabe des Owners: jeder
angemeldete Benutzer hat seinen eigenen Koordinator, ohne Anmeldung genau einen.

**Warum.** Der gemeinsame Run `overseer` handelte über den Token der Dienstidentität `host-service`
mit `runs.read.all`, `runs.create` und `runs.inspect`. Jeder, der ihm schreiben durfte, bekam damit
diese Rechte, sah fremde Runs und legte Runs an, die `host-service` gehörten; dazu las die Shell den
Journalordner aller Benutzer, und alle Benutzer teilten ein Gespräch samt Modellkontext.

**Kennung und Eigentum.** Die Run-ID bildet das Plugin aus dem Benutzer: `overseer-` und 24
Hexzeichen von SHA-256 der Kennung, ohne Anmeldung `overseer-single`. Ein Hash, weil
Benutzerkennungen Großbuchstaben und Punkte enthalten dürfen, Run-IDs nicht. `GlobalChatPolicy`
nennt statt `runId` jetzt `runIdFor` und `isCoordinator`, `workspaceDirectory` je Run,
`resetIntentDirectory` mit einem Marker je Koordinator, und `inputContext`, `contextPrompt` sowie
`model.forTurn` bekommen die Run-ID. Die Rechteprüfung (`runOwned`, `runReachable`) lässt eine
Koordinatorkennung nur für den Benutzer zu, dem sie gehört: nicht für `runs.read.all` und auch
nicht, solange unter ihr noch kein Run liegt, sonst könnte ein anderer den Koordinator eines
Benutzers zuerst anlegen und besitzen. Die erste Nachricht an den eigenen Koordinator braucht kein
`runs.create`; sie legt keinen freien Run an. Web fragt die Kennung mit der neuen Methode
`ragents.overseer.coordinator` ab; VS Code zeigt keinen Koordinator und brauchte nichts. Verworfen:
eine Alias-Kennung `overseer`, die der Server je Aufrufer umschreibt, weil jede Route, jeder Kanal
und jede Dateiadresse mit Run-Bezug sie dann kennen müsste.

**Zugang der Werkzeuge.** Die Dienstidentität `host-service` entfällt. Jeder Koordinator bekommt
einen Token für seinen Benutzer (`coordinatorAccessToken`), gültig nur über Loopback und nur für
`/rpc`, `/rpc/stream` und `/help/`; der Server löst ihn bei jedem Aufruf in den aktuellen Stand des
Benutzers aus der Profildatei auf (`coordinatorSnapshot`), ein entfernter Benutzer ist nicht
angemeldet. Mit `anonymousUser` steht der Token für den anonymen Zugang, mit `ACCESS_TOKEN` bleibt
es dieser Token, offen gibt es keinen. Wem ein Koordinator gehört, leitet der Host aus seiner
Kennung und den konfigurierten Benutzern ab, nicht aus dem Journal. Mit Benutzern entfällt der
Journalordner als Lesewurzel; Journale liest der Koordinator über `ragents.overseer.readEvents`.
Die Host-Shell bleibt ohne eigene Systemkennung (Offene Grenze in `profiles.md`).

**Keine Übernahme des alten Gesprächs.** Der frühere gemeinsame Run `overseer` wird keinem Benutzer
zugeordnet: Er enthält Nachrichten und Ergebnisse mehrerer Benutzer und einen gemeinsamen
Modellkontext, die sich nicht nach Benutzern trennen lassen, und seine Ergebnisse entstanden mit
den Rechten von `host-service`. Jedem Benutzer, etwa seinem ersten Schreiber, gehörte damit, was
andere gefragt hatten. Dazu gilt der Kurs ohne Migrationen. Die Kennung bleibt reserviert
(`isCoordinator`), damit das Journal nicht als gewöhnlicher Run in Listen auftaucht; der Server
öffnet ihn nicht, niemand erreicht ihn, sein Journal bleibt bytegleich liegen, und ein Turn scheitert
an `coordinator-without-access`. Wer ihn nicht mehr braucht, löscht `runs/overseer` und
`sessions/overseer` bei gestopptem Server. Dasselbe gilt für den Koordinator eines entfernten
Benutzers.

**Nebenbei.** `ragents.overseer.listRuns` lieferte seit `workspaceAccessible` in der Run-Liste Felder
außerhalb seines Vertrags und scheiterte über die Nachrichtenschicht; es gibt jetzt nur die
vertraglichen Felder aus. Die Modellwahl bleibt für alle Koordinatoren gemeinsam. Host-API bleibt
4: die Form von `globalChatToken` ändert sich, aber keine gelistete Kennung, und nur
`ragents.overseer` stellt den Vertrag bereit.

## Betriebsdoku geteilt: Bedienung in usage.md, Betrieb in operations.md (24.09.2026)

Kapitel: `docs/usage.md` (neu), `docs/operations.md`, `docs/development.md` (Dokumentation,
Werkzeuge, Prüfläufe und Veröffentlichung), `docs/spec/core.md` (Übergeordneter Koordinator,
Sicherheits-Lockdown der Agentenlaufzeit), `docs/spec/plugins.md` (Beispiel eines
Skill-Einstiegs), `docs/spec/actor-programs.md` (Frame, Layout, Formulare und Chat-Bausteine),
`docs/spec/overview.md`, `docs/spec/profiles.md`, `scripts/homepage/homepage-guide.ts`. Anlass war
der Doku-Scan: `operations.md` mischte auf rund 1800 Zeilen Bedienung, Betrieb, Entwicklerwerkzeuge
und Wiederholungen der Spec.

**Bedienung und Betrieb getrennt.** `docs/usage.md` sagt, was ein Benutzer oder ein Agent als
Benutzer sieht und tut: Startfläche, Run-Chat, Fläche, Einstellungen, globaler Koordinator,
Run-Panel, VS-Code-Erweiterung, `ragents run` und `pnpm driver`. `docs/operations.md` sagt, wie
man RAgents installiert, startet und betreibt: Zugang, Browser, Paket, Connect, Run-Umzug,
Windows, Datenablage, Arbeitsbereich. Build- und Prüftasks, Homepage-Build, Konzept-Audit,
Veröffentlichen von Paket und Erweiterung, die echte Browserprobe und der Prüfläufer für den
entfernten Arbeitsbereich stehen jetzt in `docs/development.md` unter "Werkzeuge, Prüfläufe und
Veröffentlichung". Verworfen: eine einzige Datei mit schärferen Überschriften, weil Benutzer und
Betreiber verschiedene Fragen stellen und die Datei trotzdem weiter gewachsen wäre.

**Dubletten zur Spec durch Verweise ersetzt.** Was schon in der Spec stand, ist aus der
Betriebsdoku verschwunden und wird dort verlinkt: TypeScript-Funktionen und Snippets
(`typescript-platform.md`), Autorenhinweise zu Actor-Programmen und Skill-Einstiegen
(`actor-programs.md`, `plugins.md`), Aufbau der Run-Scripts, Prozessstopp, Browserprüfung,
Arbeitsplätze, Anmeldung, Eigentum und gespeicherte Modell- und Titelvorgaben. Mechanik, die nur
in der Betriebsdoku stand, ist in die Spec gewandert: die Umgebungsvariablen und die Dienstidentität
des globalen Koordinators und der Sicherheits-Lockdown nach `core.md`, das Beispiel eines
Skill-Einstiegs nach `plugins.md`, drei Autorenregeln nach `actor-programs.md`. Der Abschnitt "Feste
Abläufe" entfällt ganz; er wiederholte `core.md` und beschrieb das Löschen noch ohne Bestätigung.

**Guide-Kapitel aus mehreren Dateien.** `guideChapters` nennt je Kapitel eine Liste von
Quelldateien desselben Ordners; die Blöcke werden in dieser Reihenfolge zusammengefügt. "Get
started" nimmt Installation, Start und Neubau aus `operations.md` und danach den ersten Run und
die Kachelfläche aus `usage.md`, "Web and VS Code" kommt ganz aus `usage.md`, "Distributed work"
ganz aus `operations.md`. Die Kapitel bleiben dieselben; nur "Get started" ist neu geordnet, und
sein Absatz zum Entwicklungsbetrieb mit Vite steht jetzt deutsch in `development.md`, weil er
Entwickler betrifft und nicht Benutzer.

## Nacharbeit zum Unterbrechen: CLI, Agentenschleife, Werkzeugnamen, Stoppgrund (24.09.2026)

Kapitel: `docs/spec/core.md` (Unterbrechen eines Turns, Equipping subagents, Chatprojektion),
`docs/operations.md` (Control RAgents as an agent, Drive runs from external clients). Anlass war
die Durchsicht nach dem Umbau "Chat-Stopp unterbricht nur den Turn".

**`ragents stop` und `pnpm driver stop` unterbrechen.** Beide versprachen, den laufenden Turn
abzubrechen, riefen aber `ragents.chat.stop` und hielten damit den ganzen Run an. Jetzt lesen sie
den Primary-Actor aus `ragents.runs.view` und rufen `ragents.runs.interruptTurn`, wie die
Chat-Eingabe; der Not-Aus heißt ausdrücklich `stop <run> --run` und bleibt `ragents.chat.stop`,
das auch eine laufende Startvorbereitung abbricht. Verworfen: den Befehl nur ehrlich
umzubenennen, weil ein Agent als Nutzer der Kommandozeile fast immer nur den Turn meint und sonst
jeden Run mit dem ersten Stopp verlöre. Ein Run ohne Primary-Actor ist ein Fehler mit Verweis auf
`--run`, kein stiller Wechsel zum Not-Aus. Die Beschreibung von `ragents.chat.stop` im Vertrag
nennt jetzt den Not-Aus statt "Turn des Koordinators".

**Keine Modellanfrage nach dem Abbruch.** Die Agentenschleife fragte nach einem Abbruch während
eines Werkzeugaufrufs das Modell noch einmal mit dem Werkzeugfehler an, und ein Kontext-Hook, der
erst nach dem Abbruch zurückkam, führte ebenso zu einer Anfrage. Die Prüfung sitzt deshalb direkt
vor dem Aufruf des Anbieters, nach allen Hooks, und nicht nur am Schleifenanfang: nur dort sieht
sie auch Abbrüche, die während Kontextumbau oder Schlüsselauflösung kommen. Das Ergebnis ist eine
abgebrochene Assistant-Nachricht ohne Inhalt, dieselbe Form wie ein abgebrochener Stream, damit
Schleife und Laufzeit keinen eigenen Pfad brauchen.

**Unbekannte Werkzeugnamen stoppen den Actor beim Anlegen.** `agent_spawn` wies unbekannte Namen
schon ab, aber Actors, die Host, Run-Script oder Actor-Programm anlegen, prüfte nur der Turn, und
für den Agententreiber gar nicht: ein Tippfehler in `toolNames` fiel nie auf, das Werkzeug fehlte
einfach. Der Scheduler löst für jeden Actor, den er ausführt (alle Treiber außer `manual`), beim
Anlegen (`agent.spawned`, `script.created`) und beim Neustart die Namen auf wie ein Turn, zählt dabei gerade nicht verfügbare Funktionen als bekannt und stoppt den
Actor mit den unbekannten Namen als Grund, bevor er einen Turn bekommt; bis die Prüfung fertig ist,
startet der Actor keinen Turn. Verworfen: die Prüfung in die Entscheidung des Commands zu legen,
weil Entscheidungen synchron sind und die Werkzeugauflösung asynchron vom Actor-Kontext abhängt;
und nicht verfügbare Namen mitzuzählen, weil Rechte und Zustand sich im Lauf ändern dürfen.

**Stoppgrund einmal im Chat.** Stoppte der Owner einen Actor mitten im Turn, stand der Grund im
Primary-Chat und im Actor-Verlauf zweimal, aus `turn.interrupted` und aus `actor.stopped`
desselben Commands. Die Projektion fragt am `actor.stopped` nach, ob derselbe Command einen Turn
des Actors unterbrochen hat, und lässt die Zeile dann weg; die Unterbrechung behält sie, weil sie
auch die offenen Werkzeuge mit dem Grund schließt. Verworfen: die Zeile an der Unterbrechung
wegzulassen, weil ein reines `interruptTurn` sonst gar keinen Grund zeigte.

**Dateiansicht nennt die Quelle einer Umbenennung.** `GitWorkspaceView.file` nimmt optional
`previousPath`, die Quelle einer Umbenennung aus der Änderungsliste, die der Client schon kennt.
So kann ein Anbieter die eine Datei nachschlagen, statt für jeden Klick die ganze Liste neu zu
berechnen; ohne die Quelle paart Git eine Umbenennung nur über den ganzen Baum. Der Parameter ist
optional, damit bestehende Anbieter und Aufrufer gültig bleiben.

## Chat-Stopp unterbricht nur den Turn, gestoppter Actor zeigt den Weg zurück (24.09.2026)

Kapitel: `docs/spec/core.md` (Interrupting a turn, stopping an actor ..., Unterbrechen eines
Turns, IDs, handles, and creating actors again), `docs/spec/plugins.md` (Rechte in Server- und
Web-Beiträgen, Web als Plugin-Host), `docs/operations.md` (Run-Chat und Arbeitsfläche, Run panel
and VS Code extension, globaler Koordinator). Anlass war ein echter Lauf: Der Knopf
"Arbeit stoppen" in der Chat-Eingabe stoppte mit `ragents.runs.stopActor` den Primary-Actor samt
Nachfahren dauerhaft, obwohl gar kein Modell lief, sondern ein beauftragter Actor arbeitete; ohne
Primary-Actor stoppte er über `ragents.chat.stop` den ganzen Run. Danach war der Chat tot und die
Eingabe verschwunden. Vorgabe des Owners: "Modell stoppen" und "Run stoppen" sind zwei Dinge.

**Unterbrechen statt Stoppen.** Neu ist `ragents.runs.interruptTurn` (`runId`, `actorId`,
optional `reason`) mit den Rechten des Stoppens. Es beendet nur den laufenden Turn des Actors über
`TurnScheduler.interruptTurn`: Abbruchsignal (auch für laufende Funktionsaufrufe), begrenztes
Warten auf den Treiber, damit die sichtbare Teilantwort als `model.output.interrupted` bleibt,
dann `turn.interrupted` im Namen des Owners. Der Actor, seine Modell-Session, seine Kinder und
der Run bleiben; ohne laufenden Turn geschieht nichts. Verworfen: das Ereignis zuerst ins Journal
zu schreiben und den Scheduler folgen zu lassen, weil dann die Teilantwort verloren ginge, wie
heute bei `actor_stop`; und das Warten ohne Frist, weil ein Treiber, der den Abbruch ignoriert, die
Anfrage sonst endlos hielte. Nach der Frist endet der Turn im Journal allein.

**Knopf nur für den eigenen Turn.** Jede Chat-Eingabe (Run-Chat, Actor-Chats in Kachel, Pop-out
und Run-Panel, globaler Koordinator) zeigt "Arbeit stoppen" nur, solange ihr Actor einen Turn hat,
und ruft dann `interruptTurn`. Arbeitet nur ein anderer Actor, pulsiert die Eingabe weiter, bietet
aber keinen Stopp. `ragents.chat.stop` ruft keine Eingabe mehr; "Run stoppen" in der Titelleiste
(`ragents.runs.stopAll`) und "Stop" auf der Actor-Karte (`stopActor`) bleiben die bewussten Wege.
Der Abbruch einer noch laufenden Startvorbereitung aus der Eingabe entfällt damit; einen sichtbaren
Knopf dafür gab es während der Vorbereitung ohnehin nicht (TODO).

**Gestoppter Actor mit Weg zurück.** Statt einer gesperrten oder fehlenden Eingabe zeigt ein Chat,
dessen Actor gestoppt ist, `@handle gestoppt: <Grund>` und, mit `runs.write` und `runs.inspect`,
"Neu starten" (`restartActor`, dessen Rechte unverändert bleiben). Für den Run-Chat reichte das
nicht: Das Stoppen des Primary-Actors setzt `primaryActorId` auf `null`, und ein Neustart machte ihn
nicht wieder zum Primary-Actor, der Chat blieb tot. Deshalb merkt sich der Run den als Primary
gestoppten Actor (`stoppedPrimaryActorId`, bis ein Primary-Actor gewählt wird), und `restartActor`
durch Owner oder `run.configure` wählt ihn im selben Command wieder. Das ist eine neue
Entscheidung, keine geänderte Projektion alter Ereignisse; Journale bleiben gültig. Verworfen:
den gestoppten Actor Primary bleiben zu lassen, weil Session, Rollen und Stopp-Grenzen sich darauf
verlassen, dass ein Primary-Actor aktiv ist. Host-API bleibt 4; neu sind `interruptActorTurn`,
`chatPrimaryId` und das Modul `@ragents/web/chat/StoppedActorNotice`, `stopChatActor` bleibt bis
zum nächsten Sprung.

## Eingeklappter Chat behält Rahmen und Schatten (24.09.2026)

Kapitel: `docs/spec/plugins.md` (Run-Panel), `docs/operations.md` (Run-Panel).
Rahmen, Hintergrund und Schlagschatten gelten auch für den eingeklappten Chat. Die Griffzeile
wird kompakter; ihre breite Fokusumrandung entfällt. Tastaturfokus bleibt am kleinen Balken
sichtbar, damit die Größenbedienung weiterhin per Tastatur erkennbar ist.

## Chat-Griff verändert die ausgeklappte Höhe (24.09.2026)

Kapitel: `docs/spec/plugins.md` (Run-Panel), `docs/operations.md` (Run-Panel).
Die gezogene Höhe gehört zum ausgeklappten Chat. Eingeklappt bleibt nur die gemessene Höhe
von Griff, Status und vollständiger Eingabe. Bisher veränderte Ziehen die Ruhelage, während
Öffnen immer auf 90 Prozent führte; das kehrte die gewünschte Bedienung um. Ziehen und
Tastaturänderungen öffnen auf die gewählte Höhe, die je Run gespeichert wird. Automatisches
Öffnen verwendet denselben Wert; ohne gewählte Höhe bleiben 90 Prozent die Vorgabe.

## Run-Liste und Oberfläche halten sich an den Lesezugang zum Arbeitsbereich (24.09.2026)

Kapitel: `docs/spec/plugins.md` (Session-Metadaten, Zugriff im Browser, Workspace-Tabs,
Run-Panel, Arbeitsbereich und Arbeitsplatz, Offene Grenzen), `docs/spec/profiles.md` (Run
ownership), `docs/operations.md` (Rechte). Anlass: zwei offene Punkte aus dem Review des
Arbeitsbereichs.

**Metadaten nach Zugang.** `sessionMetadata.describe` bekam keinen Zugang; sah ein Admin mit
`runs.read.all` einen fremden Run, der nur seinem Eigentümer gehört, fragte etwa ein Branch-Beitrag
für ihn den Executor auf dem Arbeitsplatz des Eigentümers. Jetzt erklärt ein Beitrag, der den
Arbeitsbereich erreicht, das mit `requiresWorkspace: true`, und der Host ruft ihn nur, wo der
Aufrufer den Arbeitsbereich erreichen darf (`runWorkspaceAccessible`, dieselbe Regel wie
`assertRunWorkspaceAccess`); sonst steht er ohne Aufruf unter `metadataUnavailable`. Verworfen ist,
`describe` den Zugang mitzugeben: dann müsste jeder Beitrag selbst prüfen, und ein Zwischenstand je
Run (wie der Branch-Zwischenstand) diente fremden Aufrufern weiter. Ohne Aufrufer, also hostintern,
erreicht die Liste keinen `ownerOnly`-Arbeitsbereich, passend zur Dienstidentität. Die Erklärung ist
freiwillig; ein Beitrag, der sie vergisst, erreicht den Executor weiter (Offene Grenze).

**Reiter nach Zugang.** Web und VS Code zeigten bei solchen Runs Dateien, Prozessleiste und
Sprachserver, die dann scheiterten. Die Run-Liste meldet je Run `workspaceAccessible`; Reiter und
Kopfbeiträge mit `requiresWorkspace` fehlen, wenn es `false` ist. Der Reiter Dateien bleibt, weil
die Dateiablage des Servers lesbar bleibt, und bietet dann nur sie an. Ein noch nicht gelisteter Run
gilt als erreichbar, weil ein neuer Run dem Betrachter gehört; die Prüfung bleibt beim Server.
Host-API bleibt 4, `workspaceAccessible` kommt als Name des Webs hinzu.

## Keine Personennamen in Doku und Tests (24.09.2026)

Kapitel: `docs/development.md` (Regeln). Entscheidungen, Regeln, Selbsttest und Tests nennen keine
Person mehr beim Namen: Wünsche stehen als Vorgabe oder mit "der Owner", Zitate als sachliche
Aussage, Testbenutzer heißen `alice`. Namen bleiben nur, wo sie rechtlich oder als Metadaten
gebraucht werden (`LICENSE`, `author`, Lizenzabschnitt).

## Arbeitsplatz: Stopp nachholen, Strom-Verlust, Fenster, Lesezugang und Anmeldung (24.09.2026)

Kapitel: `docs/spec/plugins.md` (Arbeitsbereich und Arbeitsplatz, Prozesse, Reiter Dateien, Offene
Grenzen), `docs/spec/profiles.md` (Run ownership, Eigentum im Einzelnen), `docs/operations.md`
(Prozesse beenden, Rechte, Session-Isolation, Prüfläufer), `scripts/remote-workspace/README.md`.
Anlass: Review des Arbeitsbereichs vom 24.09.2026 mit sieben wesentlichen Befunden.

**Stopp während einer Trennung.** Der Executor eines Arbeitsplatzes überlebt eine Trennung samt
Hintergrundprozessen, Sprachservern und Browser; ein Stopp oder Löschen in dieser Zeit lief mit
`whenReachable` leer durch und kam nie an. Jetzt merkt die Registry einen Stopp, der den
Arbeitsplatz nicht erreicht (nicht verbunden, zehn Sekunden ohne Antwort, abgelöste Verbindung), je
Besitzer, Kennung und Run vor und stellt ihn bei der nächsten Anmeldung zu, vor jedem neuen Auftrag
dieses Runs; bleibt der Arbeitsplatz angemeldet und stumm, alle 30 Sekunden erneut. Verworfen ist
der Abgleich durch den Arbeitsplatz beim Wiederverbinden: ein Stopp ist ein Ereignis, kein Zustand,
ein gestoppter Run kann weiterlaufen, und der Arbeitsplatz könnte nur gelöschte Runs erkennen, nicht
gestoppte. Der Preis steht als Offene Grenze: ein Serverneustart vergisst den Vormerk.

**Verlust des Ereignisstroms.** Der `RpcClient` bricht beim Verlust des Stroms alle Handler ab, die
noch für den Server laufen (`RpcPeer.cancelIncoming`), und erkennt einen halb offenen Strom an 45
Sekunden ohne Daten; vorher liefen `files.watch` und lange Bash-Befehle weiter, und nach jeder
Wiederverbindung kam eine Beobachtung hinzu. Das Dateimodul hat `stopRun` und `shutdown`, die offene
Beobachtungen beenden. Der Kanal `ragents.workspace.browse` beobachtet nach dem Ende einer laufenden
Beobachtung alle fünf Sekunden neu, statt bis zum Neuabonnieren tot zu bleiben. Löst eine neue
Verbindung die Anmeldung desselben Arbeitsplatzes ab, scheitern die offenen Aufrufe der alten sofort.

**Stopp ohne Ordnerprüfung.** `stop` auf dem Arbeitsplatz scheiterte an der Prüfung des angebotenen
Ordners, sobald ein Fenster den Ordner des Runs geschlossen hatte; er prüft jetzt keinen Ordner.
Dieselbe Prüfung nimmt, wie die des Dateimoduls, eine Laufwerkswurzel wie `/` richtig an
(`containsWorkspacePath` über `path.relative`).

**Kennung je Fenster.** Alle VS-Code-Fenster teilten eine Kennung aus dem `globalState`; das zweite
Fenster verdrängte das erste beim Server, und die Abmeldung des einen löschte den Eintrag des anderen.
Die Kennung liegt jetzt im `workspaceState` des Fensters, und `unregister` wirkt nur über die
Verbindung, die den Eintrag hält. Runs, die an die alte gemeinsame Kennung gebunden sind, finden
ihren Arbeitsplatz nicht mehr; migriert wird nicht.

**Prozessanzeige je Run.** Ein gemeinsamer Abfragetakt über alle Runs ließ einen hängenden
Arbeitsplatz die Anzeige aller Benutzer bis zu 15 Minuten einfrieren. Jeder Run wird jetzt für sich
abgefragt, mit fünf Takten Zeitgrenze, die auch den Executor abbricht; `whenReachable`-Aufräumen
wartet zehn Sekunden, unter der Stoppgrenze der Plugins. Die Abmeldung des Arbeitsplatzes wartet
höchstens drei Sekunden auf den Server und beendet den Executor sofort, damit ein hängender Server
beim Schließen von VS Code nichts festhält; die Reihenfolge von An- und Abmeldung bleibt.

**Lesen nur durch den Eigentümer.** Entschieden: den Arbeitsbereich eines Runs, den nur sein
Eigentümer bedient, erreicht auch lesend nur dieser, auch nicht `runs.read.all` und nicht die
Dienstidentität `host-service`. Mit der Umstellung reichte "lesen" bis auf den Rechner des
Eigentümers; über den Koordinator mit Dienst-Token konnte jeder, der ihm schreiben darf, Dateien
fremder Arbeitsplätze lesen. Die Prüfung ist generisch (`assertRunWorkspaceAccess` über `ownerOnly`
und Eigentümer) und steht als Hostdienst `workspaceGuardToken` bereit; Reiter Dateien
(Arbeitsverzeichnis), Prozessanzeige und Stand der Sprachserver rufen ihn vor jedem Weg zum Executor.
Das Journal bleibt für Berechtigte lesbar, die Dateiablage des Servers auch. Host-API bleibt 4, der
Name kommt hinzu. Die Entscheidung vom 23.09.2026 zu `host-service` gilt damit nur noch fürs Journal.

**Anmeldung nur mit Benutzer.** Entschieden: einen Arbeitsplatz anmelden darf über das Netz nur ein
angemeldeter Benutzer eines Profils mit `users`; ohne Benutzer gibt es für alle Zugänge nur einen
Besitzer, und jeder mit dem gemeinsamen Token hätte Runs an den Rechner eines anderen binden können.
Ohne Benutzer gilt die Anmeldung nur über Loopback (`MethodContext.local`), sonst
`workspace-client-login-required`. Die Erweiterung meldet sich dann nicht an und nennt den Grund an
der Umgebung.

## Bundles: benutzte Namen im Manifest, Dateitausch statt Ordnertausch, nur Veraltetes bauen (24.09.2026)

Kapitel: `docs/spec/plugins.md` (Build and ship a plugin, Web-Hälften zur Laufzeit, Bundle,
Bauwerkzeug und Host-API, Profilverteilung, Offene Grenzen), `docs/spec/profiles.md`
(Startwege, servergelieferte Profile, Zugangstoken), `docs/development.md`, `docs/operations.md`.
Anlass war die Durchsicht der Plugin-Bundles mit acht wesentlichen Befunden.

**Namen statt nur Nummer.** Neue Namen der Host-API kommen ohne neue Nummer; ein Bundle, gebaut
gegen einen neueren Host derselben Nummer, lief auf einem älteren und bekam im Web still
`undefined`, und über `Promise.all` fiel dann die ganze Oberfläche aus. Jetzt nennt das Manifest
(Format 3) in `hostNames` jeden benutzten Namen, der Host prüft sie beim Auflösen der Pluginliste,
und ein Name, der im Register trotzdem fehlt, wirft beim Laden. Das Web-Shim liest jeden Namen
aus einem eigenen Wertmodul ohne Nebenwirkung: so verwirft esbuild Unbenutztes weiter, und das
Metafile nennt genau die benutzten Namen, ohne die Ausgabe zu durchsuchen. Eine Web-Hälfte, die
nicht lädt, ist ein Plugin-Fehler über der Oberfläche statt ihres Ausfalls. Die Nummer der
Host-API blieb 4, weil sich die Liste nicht geändert hat; das Manifestformat stieg, damit ein
älterer Host neue Bundles mit klarer Meldung ablehnt. Laden und Bauen lesen `host-api.json` über
dieselbe Prüfung gegen `HOST_API_VERSION`.

**Namensräume und `import()`.** Beides umging die Namensliste: im Server liest das Werkzeug jetzt
jeden Zugriff auf einen Namensraum und lehnt einen weitergereichten ab, im Web ist die Warnung
`import-is-undefined` ein Fehler, und `import()` eines Host-Moduls ist ein Baufehler, im Server
außer für ganz freigegebene Bibliotheken.

**CommonJS im Server.** esbuilds `__require` wirft in ESM-Ausgabe; ein Banner des Werkzeugs bildet
`require` aus `createRequire(import.meta.url)`. Die Regel gegen `createRequire` bleibt für
Plugin-Code, der sich damit selbst suchen würde.

**Kein Ordnertausch.** Zwei Umbenennungen ließen einen laufenden Server kurz ohne Bundle-Ordner, und
parallele Läufe kollidierten am Ziel. Einen Ordner atomar tauschen kann Node nicht (dafür bräuchte
es `renameat2` oder `renamex_np`, oder Verknüpfungen, die Paket, Archiv und `tsx watch` jeweils anders
behandeln). Deshalb kommt jede geänderte Datei einzeln per Umbenennen an ihren Platz, das Manifest
zuletzt, Reste danach; unveränderte Dateien bleiben, und `tsx watch` startet nur bei geänderten
Server-Dateien neu. Eine Sperrdatei je Ziel lässt parallele Läufe warten. Dasselbe gilt für das
Web. `pnpm build:plugins` baut nur Veraltetes; damit ein Bibliotheks- oder Werkzeugupdate trotzdem
ankommt, nimmt `sourceStand` die Eingaben des Hosts auf (Lockfile beziehungsweise `package.json`,
Host-API, Bauwerkzeug).

**Kleineres.** `--watch` baut jedes Mal aus frisch gelesener Beschreibung. Das Stylesheet wird neu
übersetzt, sobald sich eine Klassenliste ändert, nicht nur im Dev-Modus. Ohne Token frei sind nur
die ausgelieferten Dateien der Web-Hälften, keine Sourcemaps (sie tragen den Quelltext) und keine
Plugin-Routen unter `/plugins/`. `stand` hat jetzt Leser: Paketbau, `connect` und die
Veraltet-Prüfung. Ein Client-Profil mit absolutem oder `~/`-Pfad lehnt der Verteiler ab, statt
dass der Client ein fremdes oder kein Bundle lädt; `connect` legt keine Verknüpfungen aus dem
Archiv an.

## Run-Liste: erst Rechte, dann Metadaten, parallel und mit Zeitgrenze; Widerspruch zur Vorlage vor dem Start (24.09.2026)

Kapitel: `docs/spec/plugins.md` (Session-Metadaten, Startoptionen), `docs/operations.md`
(Einstiege mit festgelegten Startoptionen). Anlass: Durchsicht von Web, VS Code und einem externen
Plugin-Repository. Seit ein Workspace-Plugin den Branch über den Executor des Runs liest, kostete
jeder Abruf von `ragents.sessions.list` je Run im Journal einen Aufruf, nacheinander und auch für
Runs, die der Aufrufer gar nicht sehen darf; ein verbundener, aber stummer Arbeitsplatz hielt die
Liste aller Benutzer je Run bis zu seinem Abbruch auf, bei jedem Poll erneut.

**Erst filtern, dann beschreiben.** `ChatSessionProvider.list` nimmt einen Filter nach Kennung;
`ragents.sessions.list` und die Liste des übergeordneten Koordinators reichen die Rechteprüfung
hinein, statt danach zu filtern. Titel und Metadaten entstehen je sichtbarem Run zugleich.

**Zeitgrenze je Beitrag statt je Liste.** `SessionMetadataContributionRegistry.describe` fragt alle
Beiträge zugleich und wartet je Beitrag höchstens 1,5 s. Ein Beitrag, der nicht rechtzeitig antwortet
oder wirft, fehlt unter `metadata` und steht mit dem Grund unter `metadataUnavailable`; vorher ließ
ein werfender Beitrag die ganze Liste scheitern. Der Grund ist kein stiller Ersatzwert, die
Oberfläche des Plugins entscheidet, wie sie ihn zeigt. Die Grenze ist fest, weil die Liste von jedem
Client alle paar Sekunden kommt; wer teuer rechnet, hält selbst einen Zwischenstand.

**Widerspruch zur Vorlage vor dem Start.** `StartOptionState.chosen` sagt, ob vor dem Start jemand
gewählt hat. Nur eine Wahl, keine Vorgabe, lässt einen Start über eine Vorlage mit
`start-option-fixed` scheitern; der Vorbereitungschat zeigt so einen Widerspruch an der festen Option,
sperrt "Run erstellen" und bietet "Werte der Vorlage übernehmen" an. Überschrieben wird weiter nichts
ohne ausdrückliche Handlung.

## Durchsicht der Engine: Wiederholung, Abonnements, Journalformat, Handles, Skills (24.09.2026)

Kapitel: `docs/spec/core.md` (Agentenlaufzeit, Stoppablauf, Abonnements, Handles, Dateiformat),
`docs/operations.md` (Journale des Overseers), `docs/development.md` (Journalbeispiel). Anlass
war die Durchsicht von Engine, Agentenlaufzeit und Serverseite nach dem Einschmelzen der
Agentenlaufzeit.

**Ein Turn scheitert an der letzten Antwort, nicht an der ersten.** Der Turn-Dispatcher hielt den
ersten Anbieterfehler fest; die Session wiederholte danach (429, 503) oder kompaktierte nach einem
Kontextüberlauf und setzte erfolgreich fort, der Turn endete trotzdem als `failed`, und der
Ersteller bekam "GESCHEITERT". Damit waren Wiederholung und Overflow-Rettung, die der Eintrag zum
Einschmelzen ausdrücklich behält, im Journal wirkungslos. Jetzt merkt sich der Dispatcher nur den
Fehler der jeweils letzten Assistentennachricht; Abbruch und Hook-Fehler bleiben endgültig.

**Turn-Enden und Stopps gehören ihrem Betroffenen.** Abonnements verglichen `sourceActorIds`,
`sourceActorKinds` und `includeSelf` mit dem Schreiber eines Events. Ein Koordinator, der das
Ende seines Workers abonniert, erfuhr so nichts, wenn der Mensch oder ein anderer Actor den Worker
stoppte - genau der Weg, den der Eintrag zu Stopp und Handles empfiehlt. `eventSubjectOf`
(`domain/model.ts`) nennt für `turn.finished` und `turn.interrupted` den Besitzer des Turns, für
`actor.stopped` und `actor.restarted` den Ziel-Actor, sonst den Schreiber; Zustellung und
Journalprüfung verwenden dieselbe Funktion. Ohne `includeSelf` weckt die Unterbrechung des eigenen
Turns einen Abonnenten nicht mehr. Die Meldung an den Ersteller löste den Betroffenen schon so auf.

**Dateiformat 5, Format 4 bleibt lesbar.** Die Kodierung hat sich nicht geändert, wohl aber die
Regeln: seit dem Scan vom 24.09.2026 scheitern Turns mit offenen Aufrufen, und Abonnements
stellen nach dem Betroffenen zu. Ein älterer Stand lehnte solche Journale mit einem semantischen
Widerspruch ab ("still has running tool calls"), etwa ein älteres npm-Paket auf demselben
Datenordner wie ein Checkout. Jetzt schreibt das Journal Format 5 und liest 4 und 5; ein älterer
Stand scheitert an der ersten neuen Zeile mit der Formatversion. Ein Run-Umzug war nie betroffen,
er verlangt denselben Host-Commit. Die Nummer steigt künftig, sobald ein älterer Stand neu
geschriebene Zeilen ablehnen würde; alte Journale, die eine neue Regel verletzen, werden wie
bisher isoliert, nicht migriert.

**Wiederholter Run-Stopp mit derselben Kennung.** Der `RunStopper` schrieb seine Sammelstopps unter
`<kennung>:pass:1:before-cleanup`. Wiederholte ein Aufrufer den Stopp mit derselben Kennung,
nachdem ein neuer Actor entstanden war, kollidierte die Kennung mit anderer Nutzlast, und der neue
Actor lief weiter. Ein Hash der gestoppten Actors gehört jetzt zur Kennung.

**Ein Handle nennt genau einen Actor.** Die Journalprüfung vergibt jeden Handle im Run nur einmal,
auch an gestoppte Actors, und ein neuer Spawn bekommt einen Zusatz wie `worker-1`. Die Regel
"aktiv vor gestoppt" in `actorByHandle` und die Prüfung auf einen fremden aktiven Träger in
`restartActor` waren damit unerreichbar und erweckten den Eindruck, ein Neustart per Handle könne
den falschen Actor treffen. Beide sind gestrichen, die Tests mit erfundenen Zwillingen ebenso.

**Gleichnamige Skills sind wieder ein Fehler.** Seit der Host die Skills liest, standen zwei
gleichnamige Skills verschiedener Plugins im Katalog, und das Vorladen nahm still den ersten. Das
Öffnen der Laufzeit scheitert jetzt mit beiden Pfaden, wie früher beim Lader der Laufzeit.

**Die Prüfung des Sitzungsordners ist weg.** `SessionManager.open` setzt den Ordner immer auf den
übergebenen, `#assertRuntimeDirectory` verglich ihn also mit sich selbst. Gegen den Kopf zu prüfen
hätte Sitzungen nach einem Umzug und alte Sitzungen mit dem Arbeitsbereich im Kopf gesperrt; ein
Test hält fest, dass eine Sitzung in einem anderen Ordner samt Verlauf weiterläuft.

Offen bleiben die doppelte Stoppzeile im Primary-Chat und der Wettlauf zwischen Scheduler und
Sammelstopp beim Run-Stopp (`TODO.md`).

## Agentenlaufzeit eingeschmolzen: nur noch, was RAgents nutzt (24.09.2026)

Kapitel: `docs/spec/core.md` (Agentenlaufzeit), `docs/spec/plugins.md` (Regeln der Host-API,
Bauwerkzeug), `docs/development.md` (Ordner), `docs/operations.md` (Sicherheits-Lockdown), die
Liste "Eigenes Verhalten in der Agentenlaufzeit" unten, die READMEs von `packages/agent` und
`packages/ai`. Anlass: Seit Host-API 4 ist der Fork kein Plugin-Vertrag mehr, und der Scan vom
24.09.2026 zählte rund ein Drittel des handgeschriebenen Forks ohne Nutzer. Jede Streichung ist
per Suche über dieses Repository und das externe Plugin-Repository belegt; die Host-API bleibt,
wie sie ist.

**Keine Suche, keine Installation.** Paketverwaltung, Git-Hilfen, Ausgabewächter,
Projektvertrauen, Prompt-Vorlagen, Projektdateien wie `AGENTS.md` und das Laden von Erweiterungen
aus Dateien sind weg, mit ihnen die Abhängigkeiten `jiti`, `glob`, `semver`, `hosted-git-info`,
`minimatch` und `chalk`. Eine Erweiterung ist nur noch eine Inline-Fabrik. Die stille
Paketinstallation, gegen die der Eintrag zu Server, Executor und Skripten eine Weigerung eingebaut
hatte, ist damit strukturell ausgeschlossen; ihr Test entfällt.

**Kein Werkzeugersatz aus der Laufzeit.** Die Session brachte eigene lokale read, bash, edit und
write mit, die die Engine nie aktivierte. Nur wenn ein Arbeitsbereichswerkzeug nicht als Funktion
des Hosts kam, lud die Engine die Laufzeit neu und schaltete das eingebaute ein, bei `client` auf
dem Ordner des Servers. `ragents.workspace` liefert Namen und Funktionen im selben Plugin, der Weg
war nur in Tests erreichbar. `TurnRequest.workspaceTools`, der Neuladepfad der Engine,
`AgentSession.reload` und die eingebauten Werkzeuge der Session sind weg; alle Werkzeuge eines
Agenten kommen über die Funktionen des Hosts. Ebenso gestrichen: `model-resolver.ts` (beide
Aufrufer geben immer ein Modell, eine Sitzung ohne Modell ist jetzt ein Fehler), die
Werkzeugfabriken `create*Tool` und `createCodingTools` samt Verwandten und die Bilderzeugung in
`packages/ai`.

**Sitzung ohne Kommandozeile.** Modellzyklus, Baumnavigation samt Zweigzusammenfassung,
Bash-Ausführung durch den Benutzer, Slash-Befehle und die `/skill:`-Erweiterung, Export, manuelle
Kompaktierung, Sitzungsnamen und Labels, Sitzungsstatistik sowie Wechsel, neue Sitzung, Fork und
Import der Session-Runtime sind weg, dazu `SessionManager.list`, `forkFrom`, `continueRecent` und
`createBranchedSession`. Die Erweiterungs-API hat nur noch, was der Hook-Adapter
`drivers/agent-hooks.ts`, das Skill-Vorladen und der Werkzeug-Dispatcher der Engine brauchen
(Liste unten). Mit `session_shutdown` entfällt die Frist für Abschlusshandler; Fabriken und
hängende Hooks wartet das Beenden eines Runs weiter ab, die Tests dazu laufen über den
`context`-Hook. Steering bleibt als offene Grundsatzfrage, automatische Kompaktierung und
Wiederholung bleiben.

**Einstellungen und Zugang als Werte.** Der `SettingsManager` las `settings.json` aus
`AGENT_HOME_DIR` und schrieb bei jedem Modell- und Denktiefenwechsel `defaultModel` und
`defaultThinkingLevel` zurück; die Denktiefe wurde so zur Vorgabe späterer Sitzungen ohne
ausdrückliche Wahl, ein Zustand außerhalb des Journals. Jetzt gibt es `AgentSettingsInput` mit
Kompaktierung, Wiederholung und Anfragezeitgrenzen und sonst feste Vorgaben; ohne Wahl von
Aufrufer oder Sitzung gilt `medium`. `auth.json`, `models.json`, der Auflöser für `!befehl`- und
`$VARIABLE`-Werte, OAuth, Anmeldung, Zugangsspeicher und dynamische Modellkataloge sind weg: ein
Schlüssel kommt wörtlich aus der Registrierung eines Anbieters oder beim eingebauten Anbieter aus
`OPENROUTER_API_KEY`. Eine ungültige Registrierung bricht den Start ab, statt den Anbieter still
fehlen zu lassen. Der Hostschlüssel `AGENT_HOME_DIR`, der Ordner `apps/server/agent-home` und sein
Eintrag im Paket entfallen; das externe Plugin-Repository kopiert ihn im Container nicht mehr.

**Eine Quelle für Skills.** Der Host prüft jede SKILL.md streng (`plugin-support/skills.ts`), die
Laufzeit las dieselben Ordner mit eigenen, laxeren Regeln noch einmal. Jetzt reicht der Server die
gelesenen Skills (`skillOfDirectory`) über `resolveSkills` an die Engine; die Laufzeit kennt nur
den Typ und die Katalogzeilen im Prompt.

**Ein Paket weniger.** `@ragents/agent-core` liegt als `packages/agent/src/loop/` im einzigen
Paket, das es importierte; mit ihm fallen die ungenutzten Deklarationen `ignore` und `yaml` und die
Entwicklungsabhängigkeit der Engine darauf. Die Engine führt `@ragents/ai` jetzt als
Laufzeitabhängigkeit, weil sie Werte daraus nutzt. `@ragents/agent` beschreibt sich nicht mehr als
"Coding agent CLI", `appConfig`, `agentConfig` und `config.ts` sind weg, ebenso das Voranstellen von
`~/.agent/agent/bin` an den PATH der lokalen Bash, die der Executor mit eigenen Operationen ersetzt.

Offen bleibt, was nur mit einem Grundsatzschnitt geht: die Engine direkt auf die Schleife zu setzen
(Session, Session-Runtime und Dienste sind dann Adapterreste), Steering, das Reasoning-Replay und
die Werkzeuge im Executor.

## Sprachregel der Doku: Guide-Blöcke englisch, alles andere deutsch (24.09.2026)

Kapitel: `docs/development.md` (Dokumentation: drei Orte, eine Regel), dazu alle Spec-Kapitel,
`docs/operations.md`, `README.md` und `TODO.md`. Welche Sprache in Spec und Betriebsdoku gilt,
stand nirgends. Tatsächlich galt schon, dass die Abschnitte zwischen `<!-- guide:... -->`
englisch sind, weil sie zum öffentlichen Guide werden, und der Rest deutsch. Die Folgen waren
englische Absätze außerhalb der Marker, deutscher Text unter englischen Überschriften und
dieselbe Sache zweimal im selben Kapitel, einmal je Sprache.

Festgelegt: Guide-Blöcke englisch, alles andere in Spec, `docs/operations.md`,
`docs/decisions.md`, `TODO.md` und `docs/concepts/` deutsch. Ein Guide-Block umfasst ganze
Abschnitte samt Überschrift; deutscher Text danach bekommt eine eigene deutsche Überschrift. Der
Guide zitiert die Oberfläche so, wie sie heißt, also deutsch, mit englischer Umschreibung in
Klammern; erfundene englische Beschriftungen gibt es in keiner Oberfläche. Verworfen: den Guide
getrennt übersetzen, weil er dann eine zweite Textkopie wäre. Doppelte Fassungen sind
zusammengelegt (`profiles.md`: Anmeldung, Funktionsauswahl, Grenzen, der englische Abschnitt
"Current limits" entfällt; `plugins.md`: Vertrag, Bundle und Host-API, Skills). Offene Arbeit
steht nur noch in `TODO.md`, dauerhafte Grenzen nur unter "Offene Grenzen".
`ragents.config.example.ts` ist gelöscht: Sie war nicht startbar, seit den Bundles mit einem
Quellordner in `PLUGINS` falsch, und die Vorlagen sind `core` und `developer`.

## Host-API 4: nur was Plugins importieren, ohne Agentenlaufzeit, toter Code im selben Zug (24.09.2026)

Kapitel: `docs/spec/plugins.md` (Core boundary, Plugin contract samt neuem Abschnitt Agent-Hooks,
Build and ship a plugin, Bundle, Bauwerkzeug und Host-API mit den Regeln, Chat-Bausteine,
Arbeitsbereich), `docs/spec/core.md` (Eingaben während eines Turns), `docs/development.md`,
`docs/operations.md`. Anlass waren die Scans von Server, Web und Erweiterung, Plugins und
Agentenlaufzeit auf dem Stand vom 24.09.2026, die unabhängig empfahlen, die Host-API vor dem
nächsten Einschmelzen zu kürzen, solange neben diesem Repository nur ein Plugin-Repository daran
hängt. Jede Streichung eines Namens ist eine neue `HOST_API_VERSION` und ein Neubau aller Bundles;
deshalb ist alles in einem Sprung auf 4 gesammelt.

**Die Host-API nennt Namen, nicht nur Module.** Bisher gab ein Modul in `host-api.ts` jeden Wert
frei, den es exportierte, und jeder davon war eine versionierte Zusage: Server 71 Module mit 953
Namen, davon 451 aus Code des Hosts, 145 aus der gegabelten Agentenlaufzeit und 357 aus
Bibliotheken, Web 47 Module mit 617 Namen, davon 272 aus Code des Hosts. Jetzt nennt `host-api.ts` je Modul des Hosts die Werte,
die Plugins importieren; eine Bibliothek (`react`, `typebox`, `tar` und die übrigen) steht mit
`LIBRARY` ganz darin, weil ihre Namen mit ihrer Fassung kommen. Stand jetzt: Server 63 Module mit
171 Namen aus Code des Hosts, Web 46 Module mit 112. Gemessen wurden die Listen, indem jede Hälfte
jedes Plugins dieses Repositorys und des externen Plugin-Repositorys mit Messattrappen für die
Host-Module gebündelt wurde; was das Tree-Shaking überlebt, steht in der Liste. Ein Modul, aus dem
Plugins nur Typen beziehen, hat eine leere Liste; das Web-Register legt es nicht mehr ab.
`pnpm update:host-api` prüft jeden Namen gegen die Werte des Moduls und weist eine Bibliothek mit
Namensliste und Code des Hosts ohne Liste ab. Das Bauwerkzeug hat die Namen schon vorher
durchgesetzt (Shims im Web, Prüfung der Server-Importe), jetzt setzt es die kurze Liste durch.
Alle anderen Exporte der Module sind wieder intern.

**Fünf Regeln, festgeschrieben in der Spec.** Nur was ein Plugin tatsächlich importiert; Plugins
außerhalb dieses Repositorys zählen mit, weil ihre Bundles genauso brechen (damit ist Frage 2 des
Server-Scans beantwortet). Was genau ein Plugin nutzt und der Host nicht, liegt in diesem Plugin.
Die Agentenlaufzeit gehört nicht dazu, Plugins bekommen schmale Verträge im Host. Aus dem Executor
nur die Namen, die Plugins brauchen. Ein Eintrag ohne Nutzer fällt beim nächsten Sprung. Mehrere
Einträge, die die Scans als ungenutzt führten, nutzt das externe Plugin-Repository und bleiben:
`useOptionalPageOpener` (zwei Plugins dort, das Run-Panel stellt den Öffner in VS Code bereit; die
page-opener-Kette ist also nicht tot), `awaitWithSignal`, `frontMatterOf`, `createPromptReader`,
`DiffCode`, `errorFrom`, die Unterpfade `git-config-environment`, `managed-process` und
`session-ident` des Executors, `handlebars`, `withAbort`, dazu im Executor `terminationGraceMs` und
`ManagedService.exited()`, die der Server-Scan für tot hielt.

**Was in Plugins wanderte.** `actor-programs/capability-resolver`, `limits` und `operations` liegen
jetzt in `ragents.actor-programs` (`assertSharedDescriptorContract` hatte keinen Aufrufer und ist
weg), `workspace-tool-naming` und `shell-platform` in `ragents.workspace`. Im Host bleiben trotz
eines einzigen Plugins `actor-programs/client-runtime`, weil es das CSS des Host-Webs liest und in
einem Bundle nicht lauffähig wäre, und `runtime-bridge`: `ragents.ask` muss das Journal ab dem
Start der Engine abonnieren, weil es auch die Antwort auf eine vor einem Neustart gestellte Frage
an den Fragenden weitergibt; ein Abonnement erst beim ersten `ask()`, wie der Plugin-Scan
vorschlug, verlöre sie. Die Produktbausteine (`product-model-settings`, `product-relay`,
`product-start-options`, `model-choice`, `chat-display-policy`, im Web `product/*`) nutzen zwei
Produkt-Plugins, den Sprachserver-Teil drei; nach Regel 2 bleiben sie im Host. Ob die drei
Sprachserver-Plugins eines werden, bleibt Grundsatzfrage.

**Die Agentenlaufzeit ist nicht mehr Teil der Host-API.** `@ragents/agent`, `@ragents/ai`,
`@ragents/ai/providers/all` und `@ragents/ai/providers/openrouter` sind aus der Liste. Was Plugins
von ihr brauchten, hat einen Vertrag im Host:

- Die Agent-Extensions im Plugin-Vertrag (`InlineExtension`, `ExtensionAPI`) sind zwei Hooks:
  `beforeModelCall` gibt einen verborgenen Hinweis vor dem nächsten Modellaufruf zurück und hält
  mit `call.kept`/`call.keep` einen JSON-Wert im Gesprächsverlauf, `afterToolCall` ersetzt das
  Ergebnis eines Werkzeugaufrufs. Mehr nutzte keines der drei Plugins mit Beitrag (Projektprüfung
  der Actor-Programme, Bildanzeige des Browsers, ein Fortschrittshinweis außerhalb). Die Engine
  übersetzt einen Beitrag in eine Erweiterung der Laufzeit (`drivers/agent-hooks.ts`); die Felder
  `global` und `tools` hatten keinen Nutzer und sind weg, Werkzeuge kommen über `host.functions`.
  Mit ihnen fielen `AgentToolDescriptor`, `describeTools` und die Werkzeugarten `agent-extension`
  und `agent-builtin` der Einstellungen, für die es keine Quelle mehr gab.
- Den eingebauten Katalog eines Anbieters holen die Produkt-Plugins über `builtinCatalog` aus
  `plugin-support/model-choice`, das es schon gab.
- Eine einzelne Modellfrage ohne Verlauf und Werkzeuge (der Suchinterpreter eines Plugins
  außerhalb baute dafür selbst ein Modellregister mit OpenRouter) ist
  `openRouterCompletionModel` aus `plugin-support/model-completion`: Modell aus dem eingebauten
  Katalog mit seinen Denktiefen, Anfrage und Ergebnis als eigene Typen des Hosts, schnellster
  Anbieter, keine Wiederholung, eine abgeschnittene, gescheiterte oder abgebrochene Antwort ist
  `unfinished`.
- `defineTool` samt `agentToolFrom` ersetzt dort `defineRunFunction`; `agentToolFrom` bleibt
  intern im Host, `AgentToolMetadata` ist ein eigener Typ statt eines Ausschnitts aus der Laufzeit.

Signaturen des Hosts nennen weiter Typen der Laufzeit, etwa ein Modell im Katalog; Plugins reichen
sie nur durch. Damit ist jede weitere Einschmelzung der Laufzeit intern.

**Toter Code, im selben Zug gestrichen.** Belegt tot heißt: kein Aufrufer in diesem Repository
und im externen Plugin-Repository, Tests ausgenommen.

- Erweiterung: die Befehle `ragents.openRun`, `openRunInBrowser`, `stopRun`,
  `moveAppToRunPanel` und `openArtifact` aus der Zeit des Explorers samt Stopp-Helfer, Dokumenten
  für Artefakte, `artifactText`/`artifactUrl` und `textArtifact`; `ragents.openAppInCenter` nur
  noch in der Form, die der Host-Test ruft; `ragents.openJournal` bleibt (`TODO.md`). Die
  Zusammenfassung eines Runs trägt nur noch, was die Seiten lesen (Kennung, Titel, Zeit, Zustand,
  offene Aktionen, Problem); mit `apps` fällt der Import von `ragents.actor-programs` und dem
  Vertrag von `ragents.workspace` in `run-model.ts`, der den Wurf aus dem Eintrag vom 24.09.2026
  auslöste; die Isolation einer unlesbaren Laufansicht bleibt. Der Host-Test liest die Mini-Apps
  aus der Laufansicht. Dazu `selectedRunId`, `select`, `streamStatus`, `streamMessage` und der
  Arbeitsplatzzustand im Schnappschuss.
- Web: `centerMode` samt Rückmeldung der Kachelfläche, von `ChatSurfaceOptions` bleiben 4 von 21
  Feldern; der Zeitstempelschalter des Run-Chats folgt immer der gespeicherten Wahl.
- Server: `Engine.registry`, `catalogModels` (die Engine trägt den Katalog mit `modelList`),
  `onChatSessionPersisted` samt `persisted` im Sitzungsspeicher der Laufzeit, der Reexport von
  `assertRights`, `isRpcPath`, `PLUGIN_SERVER_FOLDER`, `canUseWorkspace`; `stopLineage` und
  `lineageSteps` aus der Engine (Eintrag vom 24.09.2026); `ManagedRunStart.user` gilt jetzt mit
  der neuen Nummer. Der Index des Executors exportiert 29 Namen ohne Importeur nicht mehr.
- Engine: `agentFrom`, `promptFor`, `emptyRegistry`, `AgentToolPlugin`, die Schemas der
  TypeScript-Diagnose, `SchemaOf`, die Aliase `WorkingActor` und `AgentThinkingLevel`,
  `modelSelectionOf`, `SubscriptionStatus`, `isExecutableActor`, `defaultContract`;
  `manualExecution` nutzten nur Tests und liegt in deren Hilfen.
- Agentenlaufzeit: die nie erreichten Dateien `core/index.ts`, `core/experimental.ts`,
  `utils/tools-manager.ts`, in `ai` `utils/node-http-proxy.ts`, `abort-signals.ts`,
  `deferred-tools.ts` und `hash.ts`, dazu `footer-data-provider.ts` mit `fs-watch.ts` (nur als
  Typ reexportiert), `session-resources.ts` (nie registrierte Aufräumfunktionen, der Aufruf war
  wirkungslos) und in `http-dispatcher.ts` alles außer der Vorgabe und dem Parser der
  Zeitgrenze; damit entfällt die Abhängigkeit `undici`.

**TypeScript-Werkzeuge einmal registriert.** `typescript_api` und `typescript_eval` registrierte
die Profilkomposition und danach die Engine noch einmal, geschützt nur durch ein `WeakSet`. Jetzt
registriert allein die Komposition, vor dem Versiegeln des Hosts; die Engine findet sie unter den
Werkzeugen des Hosts. Tests, die einen Host von Hand zusammensetzen, registrieren sie selbst.

## Engine: Stopp eines Zweigs in einem Command, eine Regel für Actor-Referenzen, offene Werkzeugaufrufe enden mit dem Turn, kein Pfad aus der Agentenlaufzeit (24.09.2026)

Kapitel: `docs/spec/core.md` (Scheduler und Turns, Stoppen, Werkzeugaufrufe, Wake-up und
Meldungen an den Ersteller, Systemprompt, IDs und Handles), `docs/spec/plugins.md`
(Laufzeitmethoden, Arbeitsbereich bei `client`). Anlass war der Scan von Engine, Plugins und
Agentenlaufzeit auf dem Stand vom 24.09.2026; jede Behebung hat einen Test, der vorher rot war.

**Meldungen an den Ersteller.** Die automatische Meldung "Der Turn deines Actors ... wurde
unterbrochen" nahm als Kind den Schreiber von `turn.interrupted`, nicht den Besitzer des Turns:
stoppte ein Worker seinen Unter-Worker, meldete die Engine dem Koordinator, der Turn des Workers
sei unterbrochen. Jetzt gilt der Actor, dem der Turn gehört. Zugleich war offen, wer bei einem
absichtlichen Stopp gemeldet wird. Festgelegt: ein Stopp meldet niemandem etwas, gleich wer
stoppt; es meldet nur eine Unterbrechung ohne Stopp (Abbruch, Zeitgrenze, Neustart) und ein
gescheiterter Turn. Wer stoppt, weiß es selbst, und ein Run-Stopp darf den Primary-Actor nicht mit
Meldungen über seine gestoppten Worker neu anstoßen; mit der richtigen Zuordnung hätte genau das
sonst jeder Stopp des Owners ausgelöst. Wer auf einen Actor wartet, den ein anderer stoppen kann,
abonniert dessen Ende. Abonnements vergleichen weiter den Schreiber des Events, das steht offen in
`TODO.md`.

**Der Stopp eines Zweigs ist eine Entscheidung.** `actor_stop`, die Methode
`ragents.runs.stopActor` und der `RunStopper` stoppten einen Actor und danach jeden Nachfahren in
einem eigenen Command; scheiterte einer, liefen Kinder eines gestoppten Actors weiter, und
`actor_stop` schrieb die Stopps der Nachfahren im Namen des Owners statt des Aufrufers. Jetzt
erzeugt `stopActor` Unterbrechung, `actor.stopped` und das Entfernen der Abonnements für den Actor
und alle aktiven Nachfahren in einem Command, im Namen dessen, der stoppt; der `RunStopper` stoppt
mit `stopActors` alle aktiven Nachfahren des Owners außer dem Primary-Actor in einem Command vor und
einem nach dem Aufräumen. `stopLineage` und `lineageSteps` braucht die Engine nicht mehr; als Namen
der Host-API bleiben sie bis zum nächsten Versionssprung und stoppen die Linie ebenfalls in einem
Command. `descendantsOf` nimmt jetzt jede Sammlung von Actors, eine Laufansicht passt weiter.

**Eine Warteschlange je Run.** Die schreibenden Laufzeitmethoden liefen über eine einzige
Warteschlange für alle Runs, und `stopAll` hielt sie, bis der Stopp samt Plugin-Aufräumen fertig
war (bis zu 15 s Endstopp); so lange hingen Eingaben, Antworten und Stopps aller anderen Runs.
Jetzt serialisiert `KeyedSerialQueue` je Run und vergisst einen Run, sobald seine Schlange leer ist.

**Eine Regel für Actor-Referenzen.** Handles wurden an sechs Stellen verschieden aufgelöst: mit oder
ohne NFC, mit oder ohne Kleinschreibung, mit oder ohne Vorrang des aktiven Actors, und drei
Funktionen hießen `actorOf` mit drei Bedeutungen. Jetzt steht die Regel einmal in
`domain/actor-reference.ts` (`handleKey`, `actorByHandle`, `actorByReference`: `@` optional, NFC,
klein, aktiv vor gestoppt), die Engine löst damit in `guards.ts`, `agents/tools.ts`,
`http/methods.ts` und den Mediatoren auf, `restartActor` und `stopActor` der Methoden nehmen
ebenfalls ID oder Handle. Plugins bekommen sie über die Host-API (`@ragents/engine`, und für
beide Hälften `@ragents/engine/src/http/contracts`), neu sind nur Namen, die Version bleibt; sie
lösen damit in `ragents.watch`, `ragents.transcript`, `ragents.actor-programs` (Server und
Chat-Ziele im Web) und `ragents.orchestration` auf. Die gleichnamigen Funktionen heißen jetzt
`commandActorOf` (wer einen Command gibt, in seinem Turn) und `existingActorOf` (Journalprüfung),
`handleLabelOf` formatiert in `agents/tools.ts` ein Handle; `agentActorOf` und
`isActiveCommandActor` hatten keinen Aufrufer und sind weg.

**Offene Werkzeugaufrufe haben einen Zustand und eine Quelle.** Brach der Scheduler einen Turn
ab, schrieb er für offene Aufrufe `tool.call.failed`, ein Stopp und die Wiederherstellung nach
Neustart schrieben nur `turn.interrupted`, und die Projektion machte daraus "interrupted"; der
Scheduler suchte offene Aufrufe dafür im ganzen Journal, und die Journalprüfung führte eine dritte
Tabelle. Jetzt beendet das Ende eines Turns seine offenen Aufrufe als `interrupted`, bei
`turn.interrupted` wie bei einem gescheiterten `turn.finished`, und niemand schreibt dafür ein
Fehlerereignis. Scheduler und Journalprüfung lesen die `toolCalls` des Turns; die Prüfung merkt sich
nur noch, welche Aufrufe schon eine Quelle haben. Primary-Chat und Actor-Verlauf schließen die
Aufrufe mit dem Grund des Turn-Endes; der Primary-Chat zeigt dafür auch eine Unterbrechung, die ein
anderer geschrieben hat, und ein Ergebnis gilt dort nur noch dem letzten Aufruf mit dieser
Kennung, weil Kennungen in einem späteren Turn wiederkommen dürfen. Journale aus der Zeit davor
lesen sich unverändert.

**Die Agentenlaufzeit nennt keinen Pfad.** Zwei eigene Eingriffe, `omitCwd` und
`workingDirectory`, ließen die Laufzeit die Zeile `Current working directory` schreiben, wenn
kein Arbeitsbereichskapitel im Prompt stand, also genau für Actors ohne
Arbeitsbereichswerkzeuge, und zwar mit dem Pfad des Arbeitsbereichs. Bei der Bindung `client` ist
das ein Ordner auf dem Arbeitsplatz, während `typescript_eval` dieser Actors im Ordner des Servers
läuft; der Eintrag vom 22.09.2026 wollte ihnen gerade den Serverordner nennen. Der
Vorbereitungs-Chat bekam so den Serverpfad `AGENT_HOME_DIR`. Festgelegt: Beide Optionen sind
gestrichen; ein eigener Systemprompt bleibt im Fork, wie der Aufrufer ihn gibt, und RAgents gibt
immer einen. Das Arbeitsverzeichnis nennt allein das Kapitel, das der Scheduler für Actors mit
Arbeitsbereichswerkzeugen anhängt. Ein Actor ohne diese Werkzeuge bekommt keine Zeile, auch nicht
die des Servers, anders als der Eintrag vom 22.09.2026 festgelegt hatte: `typescript_eval` arbeitet
über `context.functions` und relative Pfade, der Ordner, in dem es läuft, ist ein Detail des Hosts
und bei `client` nicht das Projekt, ein absoluter Serverpfad im Prompt wäre nur eine Einladung, am
Arbeitsbereich vorbei zu schreiben, und die Engine kennt ohnehin weder das Werkzeug noch einen
Prompttext dafür. Die Liste "Eigenes Verhalten in der Agentenlaufzeit" ist nachgeführt: der eine
Eingriff ersetzt die beiden, dazu sind Scope, Pfade, bisher fehlende Eingriffe und die Tests je
Eingriff richtiggestellt.

## Server, Executor und Skripte: Eigentümer für verwaltete Runs, keine Paketinstallation, Pfade ab dem Aufrufer (24.09.2026)

Kapitel: `docs/spec/profiles.md` (Optionale Anmeldung und Rechte), `docs/spec/plugins.md`
(Umgebung des Executors, Language Server, Offene Grenzen), `docs/operations.md` (Als Agent
bedienen, Run-Umzug). Anlass war der Scan von Server, Executor und Skripten auf dem Stand vom
24.09.2026; jede Behebung hat einen Test, der vorher rot war.

**Verwaltete Runs gehören ihrem Aufrufer.** `ragents.overseer.createRun` und die übrige
Sitzungsverwaltung legten Runs ohne Eigentümer an; mit Anmeldung sah der Aufrufer seinen Run
danach nicht mehr, und `readRun`, `sendMessage` und `stopRun` fanden ihn nicht. `ManagedRunStart`
trägt jetzt den handelnden Benutzer (`user` statt `userId`), der Host reicht ihn an Start, Nachricht
und Paketstart weiter, und der Run bekommt ihn als Eigentümer, genau wie beim Chat. Der
Dienstzugang des Hosts ist dabei der Benutzer `host-service`, wie schon bei `chat.send`. Die
Form von `ManagedRunStart` ist Teil der Host-API; ein fremdes Plugin, das die Sitzungsverwaltung
direkt aufruft, muss `user` liefern. Die Versionsnummer der Host-API steigt mit dem nächsten
gesammelten Sprung.

**RAgents installiert keine Pakete.** Die gegabelte Agentenlaufzeit installierte ein fehlendes
Paket aus `packages` der Einstellungen still per npm oder git, sobald der Ressourcenlader sie
auflöste, ebenso eine Erweiterungsquelle `npm:`/`git:`. Der Lader löst Einstellungen jetzt gar
nicht auf, wenn Erweiterungen, Skills und Prompts abgeschaltet sind (so rufen Engine und
Vorbereitungs-Chat ihn), und sonst mit einer Weigerung statt einer Installation; eine nicht lokale
Erweiterungsquelle ist ein harter Fehler. Das ist ein weiterer eigener Eingriff in die
Agentenlaufzeit; die Paketverwaltung selbst wird später ganz gestrichen.

**Sandbox ohne Konto trägt den Benutzer der Maschine.** Ohne eigenes Konto setzte der Executor
`USER` und `LOGNAME` auf `root`, obwohl der Prozess unter dem Benutzer der Maschine läuft; nun
bleiben die Werte des Prozesses, mit Konto gilt dessen Name.

**Eine gescheiterte Sprachserver-Wurzel sperrt die anderen nicht.** `<id>_diagnostics` ohne
`root` scheiterte an der ersten gescheiterten Instanz, auch wenn andere Wurzeln bereit waren.
Jetzt nennt das Ergebnis die Ursache der gescheiterten Instanz neben den Befunden der übrigen; nur
wenn alle gescheitert sind, ist es ein Fehler. Eine schon bei der Pfadprüfung gescheiterte Wurzel
steht aufgelöst statt als Rohtext und lässt sich mit `<id>_close(root)` schließen. Die
Operationen prüfen ihre Eingabe selbst, weil nicht jeder Aufrufer über ein TypeBox-Schema kommt.

**Skripte rechnen Pfade ab dem Aufrufer.** `pnpm workspace-client` meldete ohne Ordnerangabe
`apps/server` an, weil pnpm und der Befehl `ragents` dort starten; wie `ragents run` nimmt es jetzt
`callerDirectory()`. `pnpm provision` löst einen Profilpfad ab dem Aufrufer statt ab der
Repository-Wurzel, `pnpm run-transfer --workspace` verlangt einen absoluten Pfad, weil er auf dem
Zielserver gilt. Der Treiber liest Port, Datenordner und Passwort wie der Server
(`readProfileTarget`, `resolveProfileUsers`); ein `env(...)` in `host.DATA_DIR` ohne gesetzte
Variable ist dort und in `readProfileTarget` ein Fehler statt des Vorgabeordners.

**Kleinere Härtungen.** `stop --host` beendet die gemerkte PID nur, wenn der Host unter der
gemerkten Adresse dieselbe PID aus `/health` meldet; `/health` liefert sie dafür mit. `pnpm connect`
nimmt Stand, Profil und Datei der Serverbeschreibung nur an, wenn sie im Cache bleiben. Die
Prüfung des entfernten Arbeitsplatzes liest die Ansage des Servers erst als ganze Zeile.
`install-local.sh` startet einen neu gestarteten Server mit dessen bisherigem Port und
Datenordner.

## Web und VS Code: Leitfaden auch beim Kachelstart, abgelöste Starts zählen nicht, Anmeldeablauf über /rpc, ein kaputter Run bleibt eine Zeile (24.09.2026)

Kapitel: `docs/spec/plugins.md` (Start, Runs und der Start einer Vorlage im Run-Panel),
`docs/spec/profiles.md` (Optionale Anmeldung und Rechte). Anlass war die Durchsicht von Web und
Erweiterung auf dem Stand vom 24.09.2026.

**Ein Weg für Vorlagen mit Leitfaden.** Der Kachelstart in VS Code startete jede Vorlage direkt,
ein Run-Script mit dem Startwert `null`; ein Leitfaden wie der der Gesprächsrunde wurde nie
gefragt, das Paket nahm still seinen Vorgabewert. Das Run-Panel entscheidet jetzt mit
`registry.guideFor` selbst, denn nur das Web kennt die Leitfäden der aktiven Plugins: ohne
Leitfaden bleibt es beim Klick, der sofort startet, mit Leitfaden nimmt es die Startauswahl samt
`openStartEntry`, denselben Weg wie die Web-App. Ein zweiter Nachbau des Leitfadens im
Startvorgang des Panels hätte eine `SessionContext` gebraucht, die es dort nicht gibt. Die
Erweiterung übernimmt `guide` aus den Vorlagen nur für die Beschriftung ("Einrichten" statt
"Starten", wie in der Web-App).

**Ein Start zählt nur, solange er der laufende ist.** `RunLaunch` startete im Effekt und schützte
sich mit einem Merker gegen den doppelten Effekt des StrictMode; ohne Schlüssel verschluckte das
eine zweite Vorlage, und das weiterlaufende Versprechen der ersten öffnete später seinen Run über
einen inzwischen gewählten. Der Start läuft jetzt im Befehl selbst, einmal je Klick, und sein
Ergebnis wirkt nur, wenn seine Kennung noch die des laufenden Starts ist; jeder Übergang des Panels
setzt diese Kennung über eine Stelle (`replaceLaunch`). Den angelegten Run auf dem Server
abzubrechen ist nicht vorgesehen; er bleibt in der Liste.

**Ablauf der Anmeldung.** `observeAccessExpiry` kannte noch die alten Präfixe `/chat` und
`/ragents`; die Daten laufen aber über `/rpc` und `/rpc/stream`, geschützt sind `/api`, `/rpc` und
`/files`. Das Muster folgt jetzt dem Server; ein 401 des Ereignisstroms geht über denselben
`fetch` und zeigt die Anmeldung sofort, nicht erst beim nächsten Fensterfokus.

**Ein kaputter Run legt die Erweiterung nicht mehr lahm.** Ein ungültiger Programmzustand warf in
`actorProgramViews`; über `store.runs` erreichte der Wurf `syncContext` und blockierte Panel und
Statusleiste aller Umgebungen. `runSummaryFrom` fängt jetzt je Run und liefert die Listenzeile mit
dem Grund (`problem`), die Seite zeigt ihn an der Zeile. Das Feld `apps`, das den Wurf auslöst,
liest niemand; es fällt mit dem gesammelten Rückbau des toten Codes, bis dahin schützt die Isolation
auch jeden anderen Lesefehler einer einzelnen Laufansicht.

## Plugins als Bundles abgeschlossen: die Profilverteilung verteilt Bundles, das Paket baut fremde Plugins, das Konzept ist Spec (24.09.2026)

Kapitel: `docs/spec/plugins.md` (Build and ship a plugin, Bundle, Bauwerkzeug und Host-API,
Bundles an beliebiger Stelle, Profilverteilung, Offene Grenzen), `docs/spec/profiles.md`
(Produktprofile, Servergelieferte Profile), `docs/operations.md` (Build- und Prüftasks, Work
without a checkout, Connect to a server), `docs/development.md`, `scripts/package/README.md`,
Homepage (Distributed work, Plugins and profiles). Mit diesem Eintrag ist der Umbau aus
`docs/concepts/plugin-bundles.md` fertig: Schritt 5 (Verteilung und Paket) und Schritt 6 (Spec).
Das Konzept ist gelöscht; was es festlegte (Bundle und Manifest, Beschreibung, Host-API-Liste und
Exportnamen, Versionsvertrag, Bauwerkzeug, native Abhängigkeiten, eingebaute Plugins, Plugin-Repos
neben dem Host), steht jetzt in den genannten Kapiteln, die Anleitung für fremde Autoren als
Guide-Abschnitt "Build and ship a plugin".

**Die Profilverteilung bleibt.** Erwogen war ihr Rückbau (`TODO.md`), weil seit dem Rückbau des
Client-Profils im externen Plugin-Repo kein Profil `CLIENT_PROFILE_FILE` nennt; entschieden ist,
sie zu behalten und auf Bundles umzustellen, weil sie der Weg ist, ein Profil samt eigenen Plugins
an Rechner ohne Checkout zu geben. Das Archiv enthält jetzt genau die Profildatei und die Dateien
der Bundles, die sie per Pfad nennt, gepackt aus ihrem gemeinsamen Ordner ohne Zwischenkopie.
Kein Web mehr: seit Schritt 4 ist das Web des Hosts für jedes Profil dasselbe und liegt in jeder
Host-Installation, die Kopie im Archiv war doppelt und machte das Archiv von der Fassung des
Server-Hosts abhängig. `WEB_DIST_DIR` hatte außer `connect` keinen Nutzer mehr und ist als
Host-Schlüssel entfallen; der Server liefert immer `apps/web/dist/` seines Hosts aus, und die
Prüfung des Webs gegen seine Quellen gilt in einem Checkout damit ohne Ausnahme. Mit `server/web.ts`
fiel der einzige Nutzer von `@ragents/host/host-web` unter den Plugins weg; das Modul ist aus der
Host-API-Liste, `HOST_API_VERSION` ist deshalb 3, und jedes Bundle muss neu gebaut werden.

**Versionsvertrag der Verteilung: Host-API statt Commit.** Bisher verlangte `connect` genau den
Commit des Servers, weil das Archiv das Web des Server-Hosts trug und die eingebauten Plugins aus
dem Host des Clients kamen. Jetzt nennt `ragents.profile.describe` die Nummer der Host-API
(`hostApi`), gegen die die Bundles im Archiv gebaut sind; der Verteiler prüft sie beim Start mit
demselben Leser wie der Server. `connect` prüft vor dem Herunterladen zweierlei am lokalen Host:
dieselbe Nummer, weil die Bundles dagegen gebaut sind und das lokale Web ihre Web-Hälften nur über
das Register derselben Host-API lädt, und ein eingebautes Bundle für jedes per Kennung genannte
Plugin, weil diese vom lokalen Host kommen. Warum nicht weiter der Commit: Bundles und Web passen
über die Host-API zusammen, nicht über einen gemeinsamen Build; ein Commit-Vergleich zwänge jeden
Entwickler bei jeder Serverfassung auf ein neues Paket, auch wenn sich an der Host-API nichts
änderte. Commit und Paketfassung stehen weiter in der Beschreibung, nur noch als Rat bei einer
Abweichung (`npm install -g @schlenkr/ragents@<fassung>` oder `git checkout <commit>` samt
`pnpm build:plugins` und `pnpm build:web`); `HOST_VERSION` bleibt dafür für Container ohne `.git`.
Nicht geprüft werden die Schlüssel je Plugin (das tut der Start des Clients) und die deklarierten
Exporte eingebauter Plugins, die nicht zur Host-API gehören (Offene Grenze in `plugins.md`, Zeile
in `TODO.md`). Die Nummer liest `readHostApiVersion` aus `host-api.json` eines Hosts an beliebiger
Stelle, weil die VS-Code-Erweiterung den Host prüft, den sie starten wird, nicht sich selbst; das
Plugin nimmt dieselbe Funktion und braucht so kein neues Modul der Host-API. Ein geholtes Bundle,
das der Start ablehnt, nennt jetzt `ragents connect` statt `ragents plugin build` als Abhilfe
(`isFetchedBundle`).

**Das Paket baut fremde Plugins.** Es trug schon fertiges Web und alle eingebauten Bundles. Neu
ist `pnpm check:package` (`scripts/package/package-plugin.test.ts`): das gebaute Paket per
`npm install --global` in ein eigenes Präfix, darin in einem leeren Ordner `ragents plugin build`
für ein Plugin mit Server- und Web-Hälfte samt Typprüfung, ein Plugin mit Typfehler scheitert mit
Ursache, dann `ragents start` mit einem eigenen Profil; der Host liefert Methode, Web-Hälfte,
Klasse im Stylesheet und das Web aus dem Paket. Der Test fand eine Lücke: die gegabelte
Agentenlaufzeit läuft aus ihren Quellen, ihre Typen gibt es nur gebaut unter `dist/`, und die lag
nicht im Paket; jedes Plugin, das `@ragents/ai` oder `@ragents/agent` nennt, scheiterte dort an
der Typprüfung. Das Paket trägt jetzt deren `.d.ts` (`declarationFolders`), `pnpm build:package`
baut dafür vorher `build:agent`. `pnpm check:package` steht nicht in `pnpm check`, weil es gegen
die Registry installiert. In `pnpm check` kam nach dem Web-Build
`scripts/remote/connect-start.test.ts` dazu: ein echter Server verteilt ein Profil mit einem
fremden Bundle, `connect` holt es in einen leeren Datenordner und startet es mit dem Web seines
Hosts.

**Modell-Relay.** Geprüft, ob `ragents.model-relay` ohne Verteilung einen Nutzer hätte: ja. Jedes
Profil kann mit `AGENT_PROVIDER: "relay"` die Modelle eines anderen Servers nehmen, und das Profil
eines externen Plugin-Repos tut das für ein lokales Programmierprofil. `core` und `showcase` führen
das Relay, ohne dass ein neutrales Profil es nutzt; es bleibt unverändert.

Nachweis: `pnpm -r typecheck`, `pnpm lint`, alle Suiten bis auf die bekannten Ausfälle
(`reference-run-scripts` dreimal, `workflow-foundation` einmal, acht Web-Tests), der Browsertest
gegen das gebaute Web, `pnpm check:homepage`, `pnpm check:remote-workspace` (47 ok),
`pnpm check:package`, im externen Plugin-Repo die volle Prüfung mit Bundles gegen Host-API 3.

## Das Web lädt Plugins als Bundles, und es gibt ein Web für alle Profile (23.09.2026)

Kapitel: `docs/spec/plugins.md` (Plugin-Vertrag zum Bootstrap, Bundles an beliebiger Stelle,
Tailwind, Profilverteilung, Offene Grenzen), `docs/spec/profiles.md` (Produktprofile, Start,
Servergelieferte Profile, Zugang), `docs/spec/overview.md` (Build-Skripte), `docs/development.md`,
`docs/operations.md`, `scripts/package/README.md`, `apps/web/README.md`,
`docs/concepts/plugin-bundles.md` (Schritt 4). Bis heute baute Vite je Profil ein eigenes Web aus
den Plugin-Quellen, die jedes Bundle über das Manifestfeld `source` nannte, in den Datenordner;
das Paket brachte dafür Vite mit, und jeder Start mit neuem Profil oder neuer Host-Fassung baute.
Jetzt baut der Host sein Web einmal nach `apps/web/dist/`, unabhängig vom Profil, und die
Web-Hälften kommen zur Laufzeit als Bundles vom Server: `ragents.plugins.bootstrap` nennt statt
`web: boolean` die Adressen `web.entry` und `web.css` unter `/plugins/<id>/web/`, beide Einstiege
des Webs legen vorher das Register der Host-Module an, und das Web lädt jede Web-Hälfte mit
`import(url)`. Das Stylesheet ist eins, `/ragents.css`, beim Start übersetzt aus den Klassen der
Host-Quellen und den `classes.json` der Bundles, weil Tailwind die Reihenfolge von Utility und
Variante festlegt und getrennte Stylesheets je Plugin sie verletzen (Konzept, Abschnitt 3).
`/plugins/...` und `/ragents.css` sind wie `/assets/` ohne Token erreichbar: das Run-Panel im
Webview von VS Code ist ein fremdes iframe ohne Cookie, und Plugin-Oberflächen sind so wenig
geheim wie das Web des Hosts; ausgeliefert wird nur der Ordner `web/` eines Bundles, nie Server-Code
oder Assets.

Veraltete Bundles und ein veraltetes Web sind in einem Checkout ein harter Startfehler des
Servers mit dem Befehl zum Neubauen; nur `scripts/start.sh` baut selbst. Warum nicht bauen,
wie `start.sh` es tut: der Server ist der gemeinsame Weg von `pnpm start`, `ragents run`,
`ragents start` und der VS-Code-Erweiterung, und alle vier laufen genauso aus dem Paket, wo es
nichts zu bauen gibt. Ein Bau beim Start bräuchte Vite, kostete rund 7 s, würde bei mehreren
Hosts eines Checkouts um dasselbe `apps/web/dist` und `bundles/` konkurrieren und verdeckte, dass
der Checkout sich geändert hat. Erkannt wird über Hashes: das Bauwerkzeug schreibt ins Manifest
`sourceStand` (Hash über den Quellordner ohne `node_modules` und ohne sein Ziel) statt `source`,
der Web-Build `host-web.json` mit jeder gelesenen Quelldatei samt Hash. Ein externes Bundle nennt
seinen Quellordner nicht mehr; ob es passt, prüft deshalb nur sein Repo, das vor Start und Tests
baut. Das Manifest hat damit `format` 2, und weil `@ragents/host/web-build` aus der Host-API-Liste
fiel (dafür `@ragents/host/host-web`) und `webEntryOf` wie `webSourceOf` entfielen, ist
`HOST_API_VERSION` 2.

Die Profilverteilung wartet auf eine Entscheidung (`TODO.md`) und ist nur so weit angepasst,
dass sie läuft: statt eines eigenen Vite-Builds legt sie das fertige Web des Hosts als `web/` ins
Archiv; `connect` und das Archivformat sind unverändert. Das Paket trägt jetzt das gebaute Web
samt Hilfe und kein Vite mehr; seine Prüfungen laufen in `pnpm check` nach dem Web-Build. Der
Homepage-Generator komponiert `showcase` aus den Bundles, damit die Referenz zeigt, was ein
Benutzer bekommt. Verworfen: ein Cache des Stylesheets im Datenordner, weil die Übersetzung rund
70 ms kostet und ein Cache eine eigene Ungültigkeit bräuchte. Dabei aufgefallen: Das Web aus dem
Paket hatte bisher keine Hilfe; jetzt liegt sie im gebauten Web. `start.sh --dev` blieb stehen,
weil `pnpm build:plugins --watch` beim Start alle Bundles noch einmal baute, während der Server sie
las: im Moment des Tauschs fehlte eine Klassenliste, und `tsx watch` wartete danach auf eine
Änderung, die nicht mehr kam. Der Watch baut beim Start deshalb nur, was fehlt oder nicht zu den
Quellen passt; ein Stylesheet-Abruf, der einen Tausch trifft, scheitert allein mit 500. Im Image
eines externen Repos scheiterte der Tausch des gebauten Webs am Umbenennen des alten Ordners
(`EXDEV` im Overlay-Dateisystem); der Web-Build löscht jetzt und benennt dann um.

Nachweis: `pnpm -r typecheck`, `pnpm lint`, alle Suiten bis auf die bekannten Ausfälle, der
Browsertest gegen das gebaute Web, `pnpm check:remote-workspace --vscode` (49 ok), `start.sh core`
und `start.sh core --dev` mit Blick auf die Oberfläche, beide Startfehler (verändertes Plugin,
fehlender Quellstand des Webs) von Hand ausgelöst.

## Der Server lädt Plugins nur noch als Bundles (23.09.2026)

Kapitel: `docs/spec/plugins.md` (Plugin contract, Self-contained Plugin-Ordner, Bundles an
beliebiger Stelle, Provisionierung je Plugin, Profilverteilung, Offene Grenzen),
`docs/spec/profiles.md` (Produktprofile, Start), `docs/development.md`, `docs/operations.md`
(Custom profiles and plugins), `docs/concepts/plugin-bundles.md` (Schritt 3). `PLUGINS` nennt eine
Kennung, also ein eingebautes Bundle unter `bundles/<id>/`, oder den Pfad eines Bundle-Ordners;
geladen wird `server/index.js` ohne Übersetzung, die Provisionierung als dessen Export `provision`.
Ein Quellordner im Profil ist ein harter Fehler, der den Befehl zum Bauen nennt; einen Rückweg
über Quellen gibt es nicht, weil sonst jede Regel des Bauwerkzeugs (Host-API-Liste, Exporte,
keine Dateisuche über den eigenen Ort) auf einem zweiten Weg umgangen werden könnte. Beim Start
prüft der Host `format`, `api` gegen `HOST_API_VERSION` und `uses` gegen Pluginliste und
`requires`, jeweils mit Ursache und Befehl zum Neubauen. Der Auflösungshaken ist für Code in
einem Bundle streng: `@ragents/plugins/<id>/<export>` führt auf `server/exports/<export>.js` des
Bundles, nackte Importe nur aus der Server-Liste und so, als kämen sie aus `apps/server/src/main.ts`,
damit Host-Module ihre Identität behalten; `@ragents/workflow` ist ein Alias im Haken statt eines
tsconfig-Pfades. Die Zuordnung von Kennung zu Ordner bekommt der Loader-Thread über einen Port mit
Quittung, weil externe Bundles an beliebiger Stelle liegen. Beim Bau aufgefallen: `tsx` lädt eine
`.js`-Datei ohne `package.json` mit `"type": "module"` als CommonJS, und deren `require` umgeht
den ESM-Haken; der Haken lädt Bundle-Dateien deshalb immer als ESM, statt jedem Bundle eine
`package.json` abzuverlangen. Für Code außerhalb von Bundles (Profildateien, Tests über
Plugin-Quellen) bleibt der offene Rückfall. Der Läufer `pnpm check:remote-workspace` fand dazu
einen Fehler: `pnpm provision --workspace` löste nur die drei Plugins mit Werkzeugen auf, das
Bundle von `ragents.browser` importiert aber einen Export von `ragents.documents`, und die
Prüfung von `uses` brach die Anmeldung jedes Arbeitsplatzes ab. Die Provisionierung eines
Arbeitsplatzes lädt deshalb die Bundles mit, deren Exporte diese Plugins nutzen.

`pnpm build:plugins` baut die eingebauten Plugins ohne Typprüfung (entschieden: `pnpm -r
typecheck` prüft die Quellen schon, die Typprüfung kostete 9 s je Start); `scripts/start.sh` baut
vor jedem Start, mit `--dev` zusätzlich laufend, der Test-Einstieg von `apps/server` ebenfalls,
`pnpm build:package` legt die Bundles ins Paket und bricht ab, wenn eines fehlt. Das Web baut
in diesem Schritt noch per Vite aus Quellen; damit es die Quellen eines Bundles findet, trägt das
Manifest bis zum Laden von Web-Bundles das Feld `source` (relativ zum Bundle), das auch die
Profilverteilung für ihr Client-Web nimmt. Der Composer liest `manifest.web` aus dem Bundle und
nicht mehr aus dem Ordner (`ProfileComposition.web`). Die komponierenden Tests laden Bundles;
Tests, die Klassen eines Plugins per Prototyp ersetzen, erreichen dessen Klassen im Bundle nicht,
das ist im Konzept festgehalten.

## Das Bauwerkzeug ragents plugin build und die Exportnamen der Host-API (23.09.2026)

Kapitel: `docs/concepts/plugin-bundles.md` (Schritt 2, Abschnitte 2 bis 4 und 9); Namen und Pfade
aus Schritt 1 in `docs/spec/` und `docs/operations.md` nachgezogen. `ragents plugin build
<ordner...> [--out] [--watch] [--no-typecheck]` (`apps/server/src/plugin-build/`, im Checkout
`pnpm ragents plugin build`) baut einen Plugin-Quellordner zu einem Bundle mit genau einem
Einsprungpunkt `ragents-bundle.json`; der Ladeweg von Server und Web bleibt bis Schritt 3 und 4
unverändert. Warum ein eigenes Werkzeug mit festen esbuild-Einstellungen statt einer Vorlage für
den Autor: nur so sieht jedes Bundle gleich aus und jede Stelle, die im Bundle nicht trägt, fällt
beim Bauen mit Ursache auf statt beim Laden (Importe außerhalb von Host-API, eigenem Ordner und
deklarierten Exporten, Dateizugriffe über den eigenen Ort, Binärdateien, Typfehler, Assets, die
nicht mitkommen). `apps/server/src/host-api.json` hält die Wertnamen jedes Moduls der Host-API,
aus den Typen und für JavaScript-Bibliotheken geschnitten mit der Laufzeit; daraus entstehen die
Shims der Web-Hälfte, und ein Test macht jede Änderung der Namen rot, bis sie mit `pnpm
update:host-api` bewusst übernommen ist, das entfernte Namen ohne höhere `HOST_API_VERSION`
verweigert. Warum Namen statt Signaturen: ein gebautes Bundle bricht an fehlenden Namen hart,
geänderte Bedeutung bleibt Entscheidung des Entwicklers, den der rote Test dorthin führt. Das
Register der Web-Module liegt als `apps/web/src/host-modules.ts` bereit und wird erst mit
Schritt 4 aufgerufen. `ragents-plugin.json` kennt zusätzlich `assets`. Nebenbei leitet
`apps/web/vite.config.ts` jetzt `/rpc`, `/files` und `/health` an den Server weiter; ohne das
erreichten `pnpm dev:web` und `--dev` die Nachrichtenschicht nicht.

## Paketnamen @ragents/*, eine Host-API-Liste und Querimporte nur über Exporte (23.09.2026)

Kapitel: `docs/concepts/plugin-bundles.md` (Schritt 1); `docs/spec/plugins.md`, `profiles.md`,
`core.md`, `overview.md`, `actor-programs.md` und `docs/operations.md` ziehen die Namen und Pfade nach
ihrer laufenden Übersetzung nach (`TODO.md`). Vorarbeit dafür, dass Plugins als fertige Bundles
geladen werden: Ein Bundle darf vom Host nur beziehen, was der Host ausdrücklich anbietet, und von
anderen Plugins nur, was diese ausdrücklich exportieren. Bisher reichte jedes Plugin in beliebige
Dateien von Host und Nachbarn, und die Actor-Programme griffen über `import.meta.url` in den
Host-Baum. Festgelegt: Die Pakete heißen `@ragents/*`; `@aicontainer/server` heißt `@ragents/host`,
weil `@ragents/server` das SDK der Actor-Programme ist, `@aicontainer/ragents` heißt
`@ragents/engine`. `apps/server/src/host-api.ts` nennt je Hälfte die Module der Host-API und
`HOST_API_VERSION`, gegen die Bundles künftig gebaut werden; `apps/server/tests/host-api.test.ts`
prüft die eingebauten Plugins dagegen. Jedes Plugin beschreibt sich in `ragents-plugin.json`
(Kennung, Exporte je Hälfte); ein Import eines anderen Plugins braucht einen Export und den Besitzer
in `requires`. Dateien des Plugins findet es über `pluginAsset(id, name)`, `pluginAssetPath` ist
entfernt. In den Host zogen die Werkzeugkette der Actor-Programme
(`plugin-support/actor-programs/`, `apps/web/src/actor-programs/client-ui/`), die Laufansicht
(`@ragents/web/run-view`), die Actor-Unterhaltung, der Reiter der Sprachserver und die
Produktbausteine; die Orchestrierung kennt die Actor-Programme nur noch über ihren Kontext
`ProgramSlot`, die Actor-Programme verlangen dafür `ragents.orchestration`. Das Verhalten ist
unverändert. Eigene Profildateien und Plugins außerhalb des Repos stellen ihre Importe um.

## Die öffentliche Homepage besteht aus Produktseite und Guide (23.09.2026)

Kapitel: `docs/development.md` (Dokumentation), `docs/operations.md` (öffentliche Guide-Abschnitte).
Die Homepage soll die Idee und die Arbeitsweise von RAgents erklären. Ausführbare Samples und die
vollständige technische Referenz lenken davon ab und sind vor allem für Entwicklung und interne
Prüfung relevant. Deshalb enthält der öffentliche Export nur die Produktseite, den Guide und die
konzeptionelle Mini-App. Bausteinreferenz, Entwicklerreferenz, LLM-Index, JSON-RPC- und OpenRPC-Dateien
sowie Sample-Vorschauen bleiben außerhalb von `docs/homepage/dist/`. Technische Quellen und Generatoren
bleiben im Repository erhalten, damit Verträge und interne Dokumentation weiterhin erzeugt und geprüft
werden können.

## Ein Läufer prüft den Arbeitsbereich auf einem fremden Rechner, und die Agentenlaufzeit arbeitet für sich auf dem Server (23.09.2026)

Kapitel: `docs/spec/core.md` (Systemprompt und Agentenlaufzeit, Chat-Anhänge, Run-Stopp),
`docs/spec/plugins.md` (Arbeitsbereich, Sandbox-Werkzeuge und Prozesse; Offene Grenzen),
`docs/spec/profiles.md` (Startmodi) und `docs/operations.md` (Session-Isolation, Build- und
Prüftasks, Dienste und Hintergrundprozesse beenden, Anhänge im Chat, Übergeordneter Koordinator,
Wählbares Modell). Bis heute liefen alle Tests mit Server und Arbeitsplatz auf einem Rechner, auf
dem jeder Pfad auf beiden Seiten existiert. Der Läufer `pnpm check:remote-workspace`
(`scripts/remote-workspace/`) fährt einen Run gegen einen Linux-Container als Arbeitsplatz aus dem
gebauten Paket, mit einem Skriptmodell statt eines Sprachmodells, und fand sofort Fehler.

Erstens scheiterte jeder Modell-Turn eines an einen Arbeitsplatz gebundenen Runs, bevor das Modell
gefragt wurde: Die Agentenlaufzeit bekam den Pfad des Arbeitsplatzes als `cwd` und prüfte beim
Anlegen, dass es ihn gibt (`assertSessionCwdExists`). Durchgesehen, was sie mit ihrem `cwd` sonst
lokal tut: Sitzungskopf und Existenzprüfung; Einstellungen des Projekts unter `.agent/` und
Ressourcen von dort (bei uns nicht vertrauenswürdig, gelesen wird nichts); Kontextdateien
`AGENTS.md` und `CLAUDE.md` bis zur Wurzel (mit `noContextFiles` aus); `cwd` und `exec` der
Erweiterungen, Auflösung relativer Pfade und die eingebauten Werkzeuge (inaktiv, die Werkzeuge
kommen vom Executor). Gegriffen hat also die Existenzprüfung, jede andere Stelle hätte gegriffen,
sobald eine Option sie einschaltet. Derselbe Fehlgriff steckte im Treiber: einen binären
Chat-Anhang schrieb er nach `<arbeitsverzeichnis>/attachments` auf dem Server, bei `client` in
einen Ordner, den es dort nicht gibt, oder in die gleichnamige Kopie des Servers.

Festgelegt: zwei Begriffe statt einer Weiche. `TurnRequest.workspace` ist das Arbeitsverzeichnis
der Werkzeuge, wie das Modell es sieht, für die Laufzeit nur ein Name. `TurnRequest.runtimeDirectory`
liefert erst beim Anlegen einer Laufzeit ihren Ordner auf diesem Rechner; der Host nimmt dafür
`Workspaces.runtimeDirectory`, auf dem Server der `cwd` von `serverProcessContextFor`: bei `client`
der eigene Ordner des Runs in der Session-Ablage, sonst der Arbeitsbereich selbst, bei `fresh` und
`path` ändert sich also nichts. Die Laufzeit bekommt ihn als `cwd`, den Pfad für den Prompt
getrennt als `workingDirectory` (zehnter eigener Eingriff, im Eintrag "Eigenes Verhalten in der
Agentenlaufzeit" nachgetragen). Bestehende Sitzungen öffnen weiter, weil der Treiber den `cwd` einer
Sitzungsdatei beim Öffnen ohnehin vorgibt. Anhänge legt der Host über `Workspaces.storeAttachment`
ab, auf dem Server über die neue Operation `files.attach` des Executors, die die bisherige Ablage
mit freiem Namen übernimmt; so liegen sie, wo die Dateiwerkzeuge lesen. `FixedWorkspaces` nimmt
keine Anhänge an, weil es keinen Executor kennt und die Ablage sonst zweimal existierte.

Dabei aufgefallen und behoben: Die Beschreibung des Arbeitsbereichs (Eintrag "Der Arbeitsbereich
beschreibt sich selbst im Systemprompt jedes Actors" vom 22.09.2026) erreichte im Server nie einen
Prompt. Der Scheduler hängte sie nur an, wenn Arbeitsbereichswerkzeuge aus der Agentenlaufzeit
kamen; `ragents.workspace` stellt sie aber als Funktionen, und dann fielen sie aus dieser Liste. Der
Test des Schedulers kannte nur den ersten Weg. Jetzt zählt jedes Werkzeug des Arbeitsbereichs,
gleich woher; der Agent eines Arbeitsplatz-Runs liest "Your working directory is the project
folder ... on the workplace ..., not on the server" statt einer rohen Zeile, ein Actor ohne diese
Werkzeuge behält die Zeile mit dem Pfad des Arbeitsbereichs.

Zweitens scheiterte der Not-Aus nach einer Browsernutzung im Container. Die Ursache war nicht das
Beenden von Chrome: der Marker des Runs in Chrome ist gewollt, das Prozessmodul beendet ihn, und
der Arbeitsplatz blieb in allen Läufen am Leben. Beim Beenden startet Chrome einen Hilfsprozess,
der sich mit `PR_SET_DUMPABLE` unlesbar macht; seine `/proc/<pid>/environ` liefert `EACCES`, und
die Linux-Tabelle hielt das für ein fehlendes Recht und brach Anzeige und Stopp ab. Auf jedem
Linux-Arbeitsplatz mit laufendem `ssh-agent` wäre so jeder Stopp gescheitert. Festgelegt: Ohne
root liest die Tabelle nur eigene Prozesse, und ein gesperrter davon trägt keinen erkennbaren
Marker und zählt zu keinem Run; als root bleibt es der Fehler mit dem Hinweis auf CAP_SYS_PTRACE.
Ein unbehandelter Fehler von playwright trat nicht auf, und die Reihenfolge der Module beim Stopp
ist nicht die Ursache, weil `ragents.processes` ohnehin parallel dazu aufräumt. Einmal verlor der
Arbeitsplatz im abschließenden Aufräumen stattdessen die Verbindung; danach nicht mehr, die
Ursache ist ungeklärt und steht in `TODO.md`.

Die Folge war unabhängig vom Browser ein eigener Fehler: Scheiterte das abschließende Aufräumen,
blieb der Run in Quarantäne, bis ein weiterer Stopp gelang; Nachrichten wurden angenommen, aber
kein Turn startete mehr, ohne Meldung. So hatte es der Eintrag "Abschließende Bereinigung gehört
zur Stop-Antwort" vom 08.09.2026 gewollt. Jetzt gilt die Quarantäne, solange das Aufräumen läuft;
endet es mit Fehler, meldet der Stopp den Fehler, das Serverprotokoll nennt ihn, und der Run nimmt
wieder Arbeit an. Ein erneuter Stopp räumt noch einmal auf.

Drittens zeigt `ps -E` auf einem Mac die Umgebung von Programmen aus dem Systemvolume nicht,
gemessen für `/bin/sleep`, `/bin/bash`, `/bin/sh`, `/bin/zsh`, `/usr/bin/perl`, `/usr/bin/ruby` und
`/usr/bin/tail`; Node, Homebrew-Programme und das Python von Xcode sind lesbar. Im Produkt mit dem
Executor des Servers nachgeprüft: ein aus einem `bash`-Aufruf abgesetztes `/bin/sleep` mit Marker
erscheint nicht in der Anzeige und überlebt den Stopp, ein ebenso abgesetztes `node` erscheint
und endet mit ihm. Eine belastbare zweite Erkennung ohne Umgebung gibt es nicht: ein Prozess, der
den Aufruf überlebt, hat dessen Prozessgruppe und Sitzung verlassen, und sein Elternprozess ist
dann launchd; was in der Gruppe bleibt, beendet der Bash-Aufruf selbst. Das ist eine Offene Grenze
in `plugins.md` und eine Zeile in `TODO.md`.

Kleinere Befunde: Mit `--port 0` bekam der übergeordnete Koordinator `RAGENTS_API_BASE_URL` mit
Port 0, weil sein Arbeitsbereich beim Aufbau des Servers entsteht und der Port erst danach
feststand. Der Server bindet jetzt zuerst und beantwortet Anfragen erst nach dem Aufbau; ohne HTTP
fehlt die Variable. Ohne `AGENT_MODELS` brach der Start ab, wenn Agent und Koordinator dasselbe
Modell nennen, weil die Dopplungsprüfung auch die Liste der Profilmodelle traf; sie gilt nur noch
einem ausdrücklichen `AGENT_MODELS`, und das Prüfprofil kommt ohne aus. Der Host-Test der
VS-Code-Erweiterung sucht Sprachserver und `sleep 120` nur noch unter den Nachfahren seines
Extension-Hosts, verfolgt die gefundenen PIDs bis zu ihrem Ende und erkennt einen falsch
platzierten Sprachserver am Marker seines Runs; ein zweiter RAgents daneben stört ihn nicht mehr.

Nachweis: `pnpm check:remote-workspace` ohne Schalter, mit `--shared-path` und mit `--browser`,
jeweils dreimal hintereinander grün; er prüft jetzt auch, dass ein binärer Anhang im Container
liegt und der Prompt den Ordner des Arbeitsplatzes nennt, nicht den der Laufzeit. `--vscode` ist
nicht gefahren.

## Ein beendeter Executor wird nie wiederverwendet, jede Anmeldung eines Arbeitsplatzes baut ihren eigenen (23.09.2026)

Kapitel: `docs/spec/plugins.md` (Arbeitsbereich, Sandbox-Werkzeuge und Prozesse; Browserprüfungen).
Der Arbeitsplatz (`WorkspaceClient`) hielt einen Executor für seine ganze Lebenszeit. Die
Abmeldung, auch die aus `update` ohne Ordner, beendete ihn mit `shutdown`, eine spätere Anmeldung
benutzte ihn weiter: der Sprachserver-Host blieb beendet (`TypeScript-Start wurde beendet`), bis
die Erweiterung neu startete, und das Browsermodul verzichtete nur deshalb auf eine Sperre.

Festgelegt: `shutdown` von Executor und Modul ist endgültig, ein Modul darf danach mit Ursache
ablehnen. Der Arbeitsplatz baut je Anmeldung einen frischen Executor aus
`workspaceExecutorModules()` und beendet ihn mit der Abmeldung. Das ist einfacher und robuster als
eine Abmeldung, die nur die Runs freigibt, weil `shutdown` so seine eine Bedeutung behält, kein
Modul einen Neustart können muss und kein Aufrufer ein zusätzliches Beenden braucht. Das
Browsermodul lehnt nach `shutdown` jede Operation an der Seite ab, weil einen danach gestarteten
Chrome niemand mehr schlösse; das nimmt die Ausnahme aus dem Eintrag darunter zurück.

Beim Bau entschieden: Die Abmeldung meldet beim Server ab, bevor sie den Executor beendet, und
wartet dafür auf eine laufende Anmeldung; eine spätere Anmeldung wartet auf die Abmeldung. Sonst
überholte das erneute Angebot eines Ordners die Abmeldung, die noch auf einen langsamen
Sprachserver wartete, und der Server entfernte den gerade neu angemeldeten Arbeitsplatz. Die
Antwort auf eine alte Anmeldung ändert den Zustand nicht mehr, und ein Auftrag, der mitten in der
Abmeldung ankommt, läuft nicht mehr im beendeten Executor. Ein Verbindungsverlust beendet nichts;
danach meldet sich der Arbeitsplatz mit dem laufenden Executor erneut an.

## Die Browserprüfung läuft beim Executor des Runs, ihre Evidenz hält der Server (23.09.2026)

Kapitel: `docs/spec/plugins.md` (Browserprüfungen; Arbeitsbereich, Sandbox-Werkzeuge und
Prozesse; Provisionierung je Plugin; Self-contained Plugin-Ordner und Ownership; Offene Grenzen),
`docs/operations.md` (Webanwendungen im Browser prüfen, Session-Isolation) und
`docs/development.md` (Entwickeln). `ragents.browser` startete Chrome immer auf dem Server. Bei
einem an einen Arbeitsplatz gebundenen Run startet der Agent die geprüfte Anwendung aber auf dem
Arbeitsplatz, und `localhost` des Server-Browsers ist ein anderer Rechner. Der Eintrag "Der
Arbeitsbereich hat genau einen Zugang" vom selben Tag hatte die Browserprüfung deshalb als
nächstes Modul des Executors angekündigt.

Festgelegt: Browser, Seite und alles, was die Seite anfasst, sind ein Modul des Executors
(`browserModule`, Operationen `browser.open` bis `browser.close`), auf Server und Arbeitsplatz
derselbe Code; `stopRun` und `shutdown` des Moduls schließen den Browser. Die Server-Hälfte des
Plugins behält Werkzeuge, Schemata, Skill, die Ablage der Aufnahmen in der Dateiablage von
`ragents.documents`, Evidenz, Viewport und Lebenszyklus und ruft den Rest über
`SandboxServices.execute`. Geschnitten ist entlang dessen, was bisher in `RunBrowser` lag:
Sitzung, Warteschlange, Seite, Fehlerliste, Navigation und die Gültigkeit einer Prüfung betreffen
die Seite und liegen beim Executor; Aufnahmeliste, `restore`, letzte Aufnahme und die Evidenz,
die andere Plugins über `browserRuntimeToken` synchron lesen, sind im Run dauerhaft sichtbar und
liegen beim Server. Damit der Server die Evidenz ohne Rückfrage kennt, liefert jede Operation
neben ihrem Ergebnis den Stand der Seite. Nach einem gescheiterten Aufruf holt er ihn mit
`browser.state` nach, weil eine gescheiterte Prüfung oder Aktion die Gültigkeit beim Executor
schon verworfen hat und eine alte Prüfzeit sonst stehen bliebe; ist der Executor nicht
erreichbar, gilt die Seite als geschlossen, das ist die sichere Richtung. Die aktuellen Aufnahmen
kennt der Executor nur als Kennungen, die der Server vergibt; Namen und Adressen bleiben beim
Server. Die Prüfzeit setzt der Server mit seiner Uhr, nicht der Arbeitsplatz, weil Abläufe sie mit
Zeiten des Servers vergleichen und zwei Rechner nicht dieselbe Uhr haben. Ein Bildschirmfoto kommt
als Base64 im Ergebnis zurück; ein eigener Weg für Binärdaten lohnt für Bilder dieser Größe nicht.

playwright-core wird nicht Teil des Executor-Pakets. Das Modul importiert nur Typen und lädt die
Bibliothek im Aufruf über `createRequire` aus der Host-Wurzel dieser Maschine, wie der
TypeScript-Adapter seinen Sprachserver. So bleibt das Bundle der VS-Code-Erweiterung ohne
playwright-core, und ein Arbeitsplatz ohne Host scheitert erst bei `browser_open` mit Ursache.
Chrome kommt aus `BROWSER_EXECUTABLE_PATH` in der Umgebung dieser Maschine, sonst aus dem Chromium
der Provisionierung. Auf dem Server schreibt die Profilsektion den Wert wie bisher in dessen
Umgebung; auf den Arbeitsplatz wandert er nicht, weil ein Pfad des Servers dort nichts bedeutet.
`pnpm provision --workspace` provisioniert deshalb neben den Sprachservern auch `ragents.browser`:
ohne eigenen Chrome lädt der erste Start von `pnpm workspace-client` oder der Erweiterung
Chromium, wie er Roslyn und FSAC lädt. Chrome startet wie bisher mit der sicheren Umgebung, dem
`HOME` dieser Maschine und dem Marker des Runs.

Beim Bau entschieden: Den gewählten Viewport hält der Server und gibt ihn jedem `browser.open`
mit. Die Spec versprach seit dem 16.09.2026, dass er einen Neustart des Browsers im selben Run
übersteht; der Code vergaß ihn mit der Sitzung. Jetzt stimmt es, bis zum Neustart des Servers.
Browseroperationen aus Werkzeugaufrufen tragen deren Kennung, damit der Arbeitsplatz sie wie die
übrigen Werkzeugaufrufe protokolliert. Der Shutdown des Moduls schließt jeden Browser, sperrt den
Executor aber nicht, weil sich ein Arbeitsplatz nach einer Ordneränderung mit demselben Executor
neu anmeldet (zurückgenommen im Eintrag "Ein beendeter Executor wird nie wiederverwendet" vom
selben Tag); "Der Browserdienst ist beendet" sagt weiterhin die Server-Hälfte nach ihrem
Shutdown. `WORKSPACE_EXECUTOR_VERSION` bleibt 2: der Stand vom selben Tag ist noch in keinem
Commit, und eine Version deckt Umbau, Befehle und Browser.

Nebenbei zurückgebaut, weil die Dateien jetzt frei waren: `SessionWorkspace.ensureWritable` hatte
seit dem Umbau keinen Aufrufer mehr und ist samt seinen Umsetzungen im Arbeitsbereich-Plugin und
beim globalen Koordinator entfernt; `WorkspaceClientExecution.tool` heißt `operation`, wie das
Feld des Vertrags.

## Ein Plugin ruft ein Programm im Arbeitsbereich als Befehl ohne Shell beim Executor (23.09.2026)

Kapitel: `docs/spec/plugins.md` (Arbeitsbereich, Sandbox-Werkzeuge und Prozesse). Seit der Executor
der einzige Zugang zum Arbeitsbereich ist (Eintrag "Der Arbeitsbereich hat genau einen Zugang" vom
selben Tag), hatte ein Plugin, das selbst ein Programm im Ordner eines Runs braucht, keinen Weg
dorthin. `bash` ist ein Werkzeug des Modells: mit Shell, seriell je Run und mit einer Ausgabe für
das Modell statt einem Exit-Code für Code. Die übrigen Module lesen Dateien, Prozesse oder
Diagnosen. Anlass war die Änderungsansicht eines Produkt-Plugins, die `git` im Ordner des Runs
aufruft und die Ausgabe auf dem Server auswertet; sie griff dafür lokal zu und blieb bei einem
Arbeitsplatz leer.

Festgelegt: Ein neues Modul des Executor-Pakets, `commandModule` mit der Operation `commands.run`,
führt ein Programm mit Argumenten aus, ohne Shell, in einem Ordner relativ zur Wurzel des Runs, mit
Umgebung und Konto des Executors, mit Pflicht-Zeitgrenze und begrenzter Ausgabe, und liefert
Exit-Code, `stdout` und `stderr`. Damit gilt für Programme dasselbe wie für Dateien: ein Weg für
jede Bindung, die Bindung entscheidet über den Rechner, und der Aufrufer wertet aus.

Warum kein Git-Lesemodul: Es wäre enger, müsste aber jede Frage einer Ansicht (Branch,
Merge-Basis, Liste, Diff) als eigene Operation abbilden oder Git-Argumente durchreichen, und dann
ist es derselbe Befehl mit dem Programm `git`. Wie ein Arbeitsbereich seine Branches benennt und
woran er Änderungen misst, weiß ohnehin nur das Plugin; der Executor soll davon nichts kennen. Warum
ohne Shell: Argumente kommen oft aus Daten, etwa Dateinamen, und dürfen nicht gedeutet werden.
Eine Befehlsperre ist das nicht; wer `execute` erreicht, erreicht auch `bash`.

Beim Bau entschieden: Die Zeitgrenze hat keine Vorgabe, weil nur der Aufrufer weiß, wie lange sein
Programm braucht; über der Sicherheitsgrenze eines Arbeitsplatzes gibt er dieselbe Dauer als
`durationMs` mit. Die Ausgabe ist je Datenstrom auf 2 MiB begrenzt, weil das Ergebnis eines
Arbeitsplatzes als JSON über eine Anfrage mit 32 MiB Grenze zurückkommt und ein Steuerzeichen dort
sechs Zeichen belegt; darüber verwirft das Modul, meldet die Kürzung und lässt den Befehl zu Ende
laufen, damit der Exit-Code erhalten bleibt. Ein Exit-Code ungleich null ist wie bei `bash` ein
Ergebnis. Der Aufruf nimmt keinen Zusatz zur Umgebung an, damit kein Geheimnis des Servers in einen
Prozess auf dem Arbeitsplatz wandert. Der Befehl läuft im Rahmen des Arbeitsbereichs
(`runOperation`), sodass Löschen und Stoppen auf ihn warten wie auf ein Werkzeug, und `stopRun`
und `shutdown` brechen laufende Befehle ab. Unter Windows lehnt das Modul `.cmd` und `.bat` ab,
weil Node sie nur über eine Shell startet. Den Ordner prüft dieselbe Funktion wie beim Dateimodul
(`workspaceDirectory`). Die Fassung des Executors zählt dafür nicht eigens hoch; sie ist mit dem
Umbau desselben Tages ohnehin gestiegen.

## Der Arbeitsbereich hat genau einen Zugang, den Executor des Runs (23.09.2026)

Kapitel: `docs/spec/plugins.md` (Arbeitsbereich, Sandbox-Werkzeuge und Prozesse;
Language-Server-Plugins; Offene Grenzen), `docs/spec/typescript-platform.md` (native Ausführung,
Code ausführen, Offene Grenzen) und `docs/operations.md` (Dienste und Hintergrundprozesse beenden,
Unter Windows arbeiten, Datenablage, Session-Isolation). Ein an einen Arbeitsplatz gebundener Run
schickte nur die Werkzeugaufrufe des Modells zum Arbeitsplatz, und zwar über eine feste Liste im
Executor: vier Sandbox-Werkzeuge, fest verdrahtete Sprachservernamen, `stop`. Alles andere, was
den Rechner des Arbeitsbereichs anfasst, holte sich einen lokalen Griff auf dem Server. Der Reiter
Dateien las `SessionWorkspace.currentRoot()` mit `readdir`, `readFile` und `fs.watch`, die
Prozessanzeige scannte und beendete in der Prozesstabelle des Servers, `typescript_eval` las eine
Datei unter `path` lokal, und TypeScript-Plattform und Actor-Programme bekamen über
`processContextFor` den Pfad des Arbeitsplatzes als `cwd`. Bei `fresh` und `path` ist der lokale
Griff zufällig richtig, bei `client` still der falsche Rechner: 404, falscher Inhalt, und wer
einen eigenen Arbeitsplatz mit dem Ordner `/` anmeldete und einen Run daran band, las über den
Reiter Dateien die Dateien des Servers. Gesehen hat das niemand, weil in den Tests Server und
Arbeitsplatz auf einem Rechner laufen und jeder Pfad auf beiden existiert; jede neue Funktion war
damit erst einmal lokal und nur entfernt, wenn jemand daran dachte.

Festgelegt: Der Arbeitsbereich eines Runs hat genau einen Zugang,
`SandboxServices.execute(runId, operation, input, options)`, und wo eine Operation läuft,
entscheidet allein `executorFor` über die Bindung. Der Executor ist eine offene Registrierung:
`WorkspaceOperationExecutor` entsteht aus Modulen, jedes Modul registriert benannte Operationen
und optional `stopRun` und `shutdown`, der Executor selbst kennt keinen Namen, und ein unbekannter
ist `workspace-operation-unknown`. Sandbox-Werkzeuge, Sprachserver, Dateien und Prozesse sind
Module des Pakets (`workspaceExecutorModules()`); Server und Arbeitsplatz tragen dieselben, und
die Browserprüfung auf dem Arbeitsplatz wird ein weiteres. Nach `edit` und `write` fragt das
Werkzeugmodul alle Module nach einer Anmerkung, so hängen die Sprachserver ihre Diagnostik an,
ohne dass ein Modul das andere kennt. Fortschritt ist ein JSON-Wert (`bash` bleibt bei
`{ text }`). Dauer, Beobachtung bis zum Abbruch (`untilAborted`) und Aufräumen ohne Gegenstelle
(`whenReachable`) stehen ausdrücklich in den Optionen des Aufrufs, nicht in einer Namensliste
oder in der Eingabe eines Werkzeugs; so würgt die Sicherheitsgrenze in `clients.ts` keine
Beobachtung ab. Der Vertrag `ragents.workspace.client.execute` nimmt `operation` statt `tool` und
`toolCallId` nur noch bei einem Werkzeugaufruf, `stop` gehört zum Vertrag statt zum Executor, und
`WORKSPACE_EXECUTOR_VERSION` ist 2. Ein fachlicher Fehler trägt Kennung und Status
(`WorkspaceOperationError`) und kommt beim Server als derselbe `DomainError` an, gleich wo er
entstand.

Plugins bekommen keinen lokalen Griff mehr: `processContextFor` ist aus `SandboxServices`
verschwunden. Was wirklich auf dem Server läuft, TypeScript-Plattform und Actor-Programme,
bekommt `serverProcessContextFor`; bei `client` zeigt er auf einen eigenen Ordner des Runs in der
Session-Ablage, nie auf den Pfad des Arbeitsplatzes, der dort nicht existieren muss.
`currentRoot()` und `ensureWritable()` scheitern bei `client` laut mit Ursache, damit ein künftiger
Fehlgriff sofort auffällt, statt still den Server zu lesen (`ensureWritable` entfällt im Eintrag
"Die Browserprüfung läuft beim Executor des Runs" vom selben Tag). Reiter Dateien, Prozessanzeige und
`typescript_eval` mit `path` gehen über den Executor; die Dateiablage von `ragents.documents` liegt
auf dem Server, gehört nicht zum Arbeitsbereich und wird mit denselben Funktionen des Pakets direkt
gelesen. Das Prozess-Plugin behält Vertrag, Rechte, Methoden, Kanal, Takt und Lebenszyklus.

Beim Bau entschieden: Pfade der Dateioperationen sind relativ zur Wurzel des Runs und werden dort
geprüft, wo gelesen wird. Ein Alias steht in einem eigenen Feld statt im Pfad, weil ein Ordner
namens `@irgendwas` im Projekt sonst im Reiter nicht mehr zu öffnen wäre; `typescript_eval`
zerlegt `@actors/...` dafür selbst und nimmt kein `..` mehr an, das ohnehin nie in eine andere
Wurzel führte. Das Prozessmodul beendet im `stopRun` jeden markierten Prozess des Runs, auch ohne
`ragents.processes` im Profil; bei einem Arbeitsplatz stoppt der Sandbox-Host dessen Executor und
den des Servers, weil die TypeScript-Plattform dort mit demselben Marker läuft. Die Rechteprüfung
zwischen SIGTERM und SIGKILL entfällt, weil kein Rückruf über die Verbindung reicht; die Methode
prüft Rechte und Run vor dem Aufruf, der Abbruch der Anfrage erreicht den Executor. Gleichzeitige
Abfragen mehrerer Runs teilen sich im Executor einen Tabellenscan, so bleibt es beim Server bei
einem Scan je Takt. Unter Windows lehnt das Prozessmodul Stand und Beenden mit Ursache ab, statt
das Plugin beim Start abzulehnen, weil ein Server unter Windows Runs auf einem anderen
Arbeitsplatz bedienen kann; sein Aufräumen entfällt dort. Der Arbeitsplatz protokolliert nur noch
Werkzeugaufrufe des Modells, damit die Prozessanzeige im Zwei-Sekunden-Takt sein Protokoll nicht
flutet. Den Weg hält ein Test mit einem Arbeitsplatz fest, dessen Ordner es auf dem Server nicht
gibt (`apps/server/tests/workspace-foreign-machine.test.ts`): jeder lokale Zugriff scheitert dort
am fehlenden Pfad, und ein Arbeitsplatz mit dem Ordner `/` liefert nur seine eigenen Dateien.

## Eine Startvorlage legt Startoptionen fest, geprüft an einer Stelle (23.09.2026)

Kapitel: `docs/spec/plugins.md` (Plugin-Vertrag: Einstiege und Startoptionen; Web als
Plugin-Host: Startfläche und Vorbereitungschat; VS-Code-Erweiterung: Neuer Run), `docs/operations.md`
(Run-Scripts, VS-Code-Erweiterung) und `docs/spec/typescript-platform.md` (Run-Scripts). Befund aus
einem echten Lauf: "Neuer Run" in der VS-Code-Erweiterung belegte die Bindung
`ragents.workspace.binding` immer mit dem geöffneten Ordner vor, auch für Vorlagen, die nur im Ordner
je Run auf dem Server arbeiten können. Diese Abläufe merkten das erst zur Laufzeit und sagten ab.
Eine Vorlage hatte keinen Weg zu sagen, welche Startoption sie braucht, und die Startwege mit
Einstieg (Kachel, Vorbereitungschat, `ragents.chat.start`, übergeordneter Koordinator, Treiber)
setzten Startoptionen jeweils nach eigener Logik.

Festgelegt: Ein Einstieg trägt optional `fixedStartOptions` (Option-Id auf Wert), explizit
beigetragen oder in einer `RUN.md` als Kopfzeile `fixed-start-options` mit einem JSON-Objekt. Der
Kern kennt nur diese Zuordnung, keinen Arbeitsbereich und keinen Ablauf. Beim Versiegeln prüft er,
dass jede festgelegte Option registriert ist und ihr Wert ihrem Schema genügt. Ob `accept` den
Wert annimmt, entscheidet erst der Start, weil es vom Handelnden abhängen kann. Angewandt wird an
genau einer Stelle, `RunChatSession.#startChoice`: der festgelegte Wert ersetzt Wahl und Vorgabe,
`accept` prüft ihn mit dem Benutzer, der startet, und eine vorher abweichend gewählte Belegung ist
`start-option-fixed` (409) mit Vorlage und Option in der Meldung. Still überschrieben wird nichts,
weil eine bewusste Wahl sonst ohne Rückmeldung verschwände. Bei einem schon angelegten Run gilt
dasselbe gegen den gespeicherten Wert. Damit ein Skill-Einstieg denselben Weg nimmt, nennt die
erste Nachricht seine Kennung: `ragents.chat.send` hat das Feld `entry`. Bisher kam beim Server nur
der vorbereitete Text an. Run-Scripts laufen ohnehin über `ragents.chat.start` mit Kennung, auch aus
dem Treiber, aus `ragents run --entry` und aus `ragents.overseer.createRun`.

Die Oberflächen richten sich danach, statt es nachzubilden. Die Startfläche zeigt eine
festgelegte Option in der Vorschau der Vorlage und im Vorbereitungschat fest mit ihrem Wert, statt
eine Auswahl anzubieten, die am Ende scheitert. Das Run-Panel belegt beim Start aus VS Code nur,
was die Vorlage nicht festlegt. Die Erweiterung fragt bei einer Vorlage mit festgelegtem
Arbeitsbereich nach keinem Ordner und belegt die Bindung nicht vor. Die Laufzeitabsage der
Abläufe bleibt als Sicherung für Runs, die ohne diese Vorlage entstanden sind.

Nebenbei: Der Parameter `userId`, den der Eintrag darunter durch die Sitzung reicht, ist dort zu
einem `StartChoice` aus Benutzer und festgelegten Werten geworden. Es bleibt ein Parameter je
Aufruf, kein gemerkter Zustand.

## Arbeitsplätze gehören ihrem Benutzer, einen daran gebundenen Run bedient nur sein Eigentümer (23.09.2026)

Kapitel: `docs/spec/plugins.md` (Plugin-Vertrag: Startoptionen; Rechte in Server- und
Web-Beiträgen; Arbeitsbereich, Sandbox-Werkzeuge und Prozesse; Offene Grenzen),
`docs/spec/profiles.md` (Benutzerrechte) und `docs/operations.md` (Anmeldung und Profilrechte,
Session-Isolation, Run-Umzug). Ein Run mit Bindung `client` führt `read`, `write`, `edit`, `bash`
und die Sprachserver auf dem Rechner eines Arbeitsplatzes aus, mit dessen `HOME` und damit mit
den Git-, SSH- und NuGet-Zugangsdaten seines Entwicklers. Die Anmeldung merkte sich den
Benutzer, geprüft hat ihn danach niemand. Daraus folgten vier Lücken.
`ragents.workspace.clients.list` zeigte jedem Leseberechtigten alle Arbeitsplätze. Die
Startoption nahm jeden angemeldeten Arbeitsplatz an und bot im Web alle an, weil
`StartOptionContext` nur den Run kannte; ein zweiter Benutzer konnte seinen Run so an den
Rechner eines anderen binden und dort `bash` ausführen. Ausgeführt wurde über die Kennung
allein, und weil ein getrennter Arbeitsplatz die Registry verlässt, konnte sich danach ein
anderer Benutzer mit derselben Kennung anmelden: er bekam die Werkzeugaufrufe fremder Runs samt
Befehlen und Dateiinhalten und hätte gefälschte Ergebnisse zurückgeben können. Und `runs.read.all`
heißt "sehen und bedienen": `assertRunRights` und die Nachrichtenschicht ließen Nachrichten,
Eingaben und Antworten in einen fremden gebundenen Run durch und damit Befehle auf dem Rechner
seines Eigentümers.

Festgelegt: Die Registry führt einen Arbeitsplatz unter Besitzer und Kennung. Anmelden,
Abmelden, `info`, `executorFor` und `list` nehmen immer den Besitzer mit; zwei Benutzer mit
derselben Kennung haben zwei Einträge, die sich nie berühren. Damit gibt es keinen fremden
Eintrag mehr, gegen den eine Anmeldung oder Abmeldung laufen könnte, und
`workspace-client-foreign` entfällt; eine Abmeldung trifft nur den eigenen Eintrag.
`clients.list` liefert nur die Arbeitsplätze des Aufrufers, auch mit `runs.read.all`.
`StartOptionContext` trägt den handelnden Benutzer (`userId`, ohne Anmeldung `null`), und jeder
Weg zu `defaultValue`, `accept` und `describe` reicht ihn als Parameter aus dem Zugang seiner
Anfrage durch: Liste, Wahl, Vorbereitung, Anhangsprüfung, die Vorgaben beim Anlegen, Katalog und
`createRun` des übergeordneten Koordinators. Die Session merkt ihn sich nicht. Die
Bindungsoption nimmt und zeigt nur Arbeitsplätze dieses Benutzers; ein fremder verhält sich wie
ein nicht verbundener, damit die Antwort nicht verrät, dass es ihn gibt. Die eigentliche Grenze
ist aber die Ausführung: sie sucht immer den Arbeitsplatz des Run-Eigentümers
(`RunState.ownerUserId`, Entscheidung vom 22.09.2026) mit der Kennung der Bindung, auch der
Promptbeitrag zur Plattform. Das greift auch, wenn Wahl und Anlage eines Runs von verschiedenen
Benutzern kommen. Ein Run ohne Eigentümer passt nur zu einem Arbeitsplatz, der ohne Benutzer
angemeldet ist. Einen Ausweg auf irgendeinen Arbeitsplatz mit derselben Kennung gibt es nicht,
denn genau das war die Lücke.

Für den vierten Punkt kennt der Kern einen einzigen neuen, generischen Zustand: "nur der
Eigentümer bedient diesen Run". Eine Startoption erklärt ihn über das optionale
`ownerOnly(value)` für ihren gespeicherten Wert, und der Host liest ihn wie den Eigentümer aus
dem Journal (`runOwnerOnly`), ohne Zwischenspeicher. Er hängt an der Startoption, weil die
Bindung selbst eine ist und damit schon im Journal steht; ein eigener Erweiterungspunkt hätte
einen zweiten Ort für dieselbe Tatsache gebraucht. Die Bindungsoption erklärt ihn für `client`,
nicht für `path`: ein Serverordner arbeitet mit den Mitteln des Servers, die ein Zugang mit
`runs.read.all` ohnehin mitverwaltet. Durchgesetzt wird an denselben Engstellen wie die
Zugehörigkeit: `assertRunRights` lehnt die Arten `write` und `write-inspect` für jeden außer dem
Eigentümer mit `run-owner-only` ab, die Nachrichtenschicht tut dasselbe für jeden Vertrag mit
`runs.write`, so dass Rückfragen, Mini-App-Aktionen und künftige Beiträge ohne eigenen Code
mitgeschützt sind, und die Nachricht über den übergeordneten Koordinator geht durch dieselbe
Prüfung. Stoppen bekommt dafür die eigene Art `stop` mit den Rechten von `write`, damit
`ragents.chat.stop`, `ragents.runs.stopActor` und `ragents.runs.stopAll` erlaubt bleiben; Lesen ist
nicht betroffen. Status 403 statt 404, weil der Zugang den Run sieht und eine Tarnung nur
verwirren würde. Das Beenden eines einzelnen Prozesses verlangt `runs.write` und zählt damit als
Bedienen; den ganzen Run zu stoppen bleibt möglich, es geht also nichts verloren. Ohne Anmeldung
gibt es genau einen Zugang, dort greift der Vorbehalt nicht.

Die private Dienstidentität des Hosts (`host-service`) behält `runs.read.all`, bedient einen
solchen Run aber nicht. Sie handelt für den Server, und über sie handelt jeder, der mit dem
gemeinsamen übergeordneten Koordinator schreiben darf; nähme man sie aus, könnte jeder mit diesem
Recht über den Koordinator Befehle auf dem Rechner eines anderen auslösen. Den Menschen hinter
dem Werkzeugaufruf durch die Dienstidentität zu reichen, damit der Eigentümer seinen Run auch
über den Koordinator bedienen kann, wäre ein eigener Umbau; lesen und stoppen kann sie weiter.

Bestandsruns ohne Eigentümer, die an einen Arbeitsplatz gebunden sind, finden ihn nur noch, wenn
er ohne Benutzer angemeldet ist; mit `anonymousUser` heißt das, den Run neu anzulegen. Journale
werden dafür nicht umgeschrieben. Über `ragents.overseer.createRun` angelegte Runs haben
weiterhin keinen Eigentümer; eine Arbeitsplatz-Bindung dort wird für den Aufrufer geprüft,
findet bei der Ausführung aber keinen Arbeitsplatz, sobald das Profil Benutzer oder einen
anonymen Zugang nennt. Das ist die sichere Richtung und steht in `TODO.md`.

## Das Run-Panel zeigt einen durchgehenden Ladezustand und in VS Code nie die Run-Liste (22.09.2026)

Kapitel: `docs/spec/plugins.md` (Chat-Bausteine mit `ChatSurfaceOptions.notice`, Run-Panel,
VS-Code-Erweiterung, Offene Grenzen) und `docs/operations.md` (Run-Panel und
VS-Code-Erweiterung, Bedienung). Beim Start eines Runs aus VS Code blitzte kurz die Run-Liste des
Run-Panels auf: Die Erweiterung zeigt das Run-Panel zuerst ohne Run und schickt die
Startanforderung erst danach, und ohne Run zeigte das Panel die Liste, die nur im Browser ohne
Start-Seite einen Sinn hat. Danach stand, während der Server den Run vorbereitete und das
Run-Script Agenten und Mini-App einrichtete, mehrere Sekunden ein leerer Chat ohne jeden Hinweis
im Run-Panel.

Festgelegt: Im Host `vscode` zeigt das Run-Panel nie die Run-Liste. Ohne Run steht dort ein
Ladezustand, bis die Startanforderung kommt; bleibt sie fünf Sekunden aus oder kann das Panel sie
nicht ausführen, nennt es den Grund und führt zur Start-Seite, statt endlos zu laden. Die Lösung
liegt ganz im Web, die Erweiterung bleibt unverändert, weil ihr Ablauf richtig ist und nur die
Anzeige dazwischen fehlte. Vom Klick bis zum ersten Inhalt, einer Mini-App oder einem
Gesprächsbeitrag im Chat, sieht der Aufbau wie eine einzige Anzeige aus: Laden des Profils,
Warten auf den Host, `RunLaunch` und der Aufbau im Chat teilen sich die Komponente
`StartupNotice`, dieselbe Kopfzeile und dieselbe Stelle; die Kachelfläche verwendet dieselbe
Komponente. Was angezeigt wird, entscheidet die vorhandene generische Logik der Kachelfläche
(`canvasStartupState`), sie kennt nur Zustände wie Vorbereitung, Arbeit, Rückfrage, Stopp und
Fehler und nie ein Werkzeug oder eine Mini-App. Der Chat bekommt den Hinweis über
`ChatSurfaceOptions.notice` statt des Verlaufs, damit die Eingabe bedienbar bleibt. Systemzeilen
und Arbeitsschritte zählen nicht als Inhalt, weil schon die Vorbereitung des Arbeitsbereichs eine
Systemzeile schreibt. Eine Haltezeit von 1,5 Sekunden überbrückt die Lücke, bis die Run-Ansicht
einem beendeten Startstatus nachgezogen hat; für den Verbindungsaufbau gilt sie nicht, damit ein
leerer, untätiger freier Run ohne Ladezustand bleibt.

## Die Homepage erklärt Konzepte mit statischen Systembildern (22.09.2026)

Kapitel: `docs/homepage/index.html` und die Generatorquellen unter `scripts/homepage/`. Die
Produktseite hatte mehrere interaktive Demos als Illustration benutzt. Dadurch wirkten konkrete
Beispiele wie die eigentliche Produktdefinition, die alte frei angeordnete Arbeitsfläche blieb
sichtbar, und Events und Journal erschienen als zwei getrennte Funktionen.

Festgelegt: Die öffentliche Homepage ist englisch und nennt Web und VS Code als die beiden
Oberflächen. Die vier Kerngedanken Setups, Agentenkommunikation, TypeScript und Mini-Apps erhalten
kleine statische Konzeptbilder. Der aktuelle Run-Panel-Aufbau ersetzt die freie Fläche. Events und
Journal sind ein gemeinsamer Punkt mit einem geordneten Ereignisprotokoll. Server und Arbeitsplatz
erscheinen in einem einzigen verteilten Systembild. Die Konsole bleibt ein Automatisierungsweg,
aber kein auf der Produktseite beworbener Client. Die Bilder erklären Verträge und Beziehungen;
sie behaupten keine ausgeführten Modellläufe.

## Der Arbeitsbereich hat einen Besitzer, eine eigene Art ist ein Beitrag (22.09.2026)

Kapitel: `docs/spec/plugins.md` (Self-contained Plugin-Ordner und Ownership; Arbeitsbereich,
Sandbox-Werkzeuge und Prozesse), `docs/spec/profiles.md` (Profil core) und `docs/operations.md`
(Datenablage, Session-Isolation). Ein Profil, das seinen Arbeitsbereich anders baut als der Host,
hatte bisher nur einen Weg: ein eigenes Plugin, das `workspaceRuntimeToken` und
`sandboxServicesToken` selbst anmeldet. Damit kann es nicht neben `ragents.workspace` laufen -
`ServiceRegistry.provide` bricht beim zweiten Anbieter ab -, und alles, was der Host an
Arbeitsbereichs-Mechanik schon kann (die Bindungen `fresh`, `path` und `client`, die
Arbeitsplatz-Registry, die Startoption, der Bindungszustand), musste dort nachgebaut oder
importiert werden. Jede Annahme "es gibt einen Ordner auf dem Server" knallte dann einzeln,
sobald ein Run an einen Arbeitsplatz gebunden war.

Festgelegt: Der Arbeitsbereich gehört `ragents.workspace`, und eine eigene Art ist ein Beitrag
über den vorhandenen `workspaceResolverToken`. Der Haken wird dafür so weit erweitert, wie es
diese Rolle braucht, und nicht weiter: `WorkspaceResolver.kind` benennt die Art (`id`, `label`,
`serverFolders`, optional `directoryPattern`), die Auflösung darf jetzt alles liefern, was
`SessionWorkspace` kennt - bis hin zu `hostSandbox.ident`, dem Konto, unter dem die Sandbox
ausführt -, und `stopSession(runId, sandbox)` sowie `deleteSession(runId)` geben dem Beitrag sein
eigenes Aufräumen je Run, gelegt um den Stopp der Sandbox des Hosts. Die Bindungen selbst bleiben
unverändert; die Art besetzt `fresh` und schließt `path` aus, wo ein Arbeitsbereich mit eigenen
Rechten keinen Serverordner verträgt. Wer zentral fragen will, welcher Art der Arbeitsbereich
eines Runs ist, fragt `WorkspaceRuntime.kindOf(runId)` - eine Stelle statt einer Fallunterscheidung
je Ablauf.

Dazu ein Fehler, der über zwei Rechner sichtbar wird: Bei Bindung `client` setzte
`ragents.workspace` das `cwd` der Session auf einen Ordner des Servers, obwohl die Werkzeuge auf
dem Arbeitsplatz laufen. Die Agentenlaufzeit hängt dieses `cwd` als `Current working directory`
an jeden Systemprompt, der Agent nannte also einen anderen Pfad, als er benutzte. Jetzt ist der
gebundene Ordner `cwd`, `currentRoot()` und `ensureWritable()`, und der Server legt für einen
gebundenen Run nichts mehr an. Actor-Programme haben ohnehin ihren eigenen Ordner; `typescript_eval`
läuft damit im Ordner des Arbeitsplatzes und ist auf dem Server nicht mehr vorgesehen - das ist
die ehrlichere Ansage als ein zweiter Pfad, den niemand sieht.


## Ein Run gehört dem Benutzer, der ihn angelegt hat (22.09.2026)

Kapitel: `docs/spec/profiles.md` (Benutzerrechte) und `docs/operations.md` (Anmeldung und
Profilrechte). Bisher teilten sich alle Leseberechtigten die Runs eines Profils. Damit sah jeder
Entwicklerzugang die Aufträge, Journale und Arbeitsverzeichnisse aller anderen, und eine geratene
Run-Kennung genügte, um einen fremden Lauf zu öffnen.

Festgelegt: Der Run merkt sich seinen Benutzer dort, wo seine übrigen Metadaten stehen, nämlich im
Journal. `run.created` führt neben dem menschlichen Teilnehmer ein optionales `owner.userId`, der
projizierte `RunState` daraus `ownerUserId`; die Laufansicht für Clients bleibt unverändert und
nennt ihn nicht. Es entsteht kein zweiter Speicher, und ein Neustart ändert nichts, weil der Wert
aus denselben Ereignissen wiedergegeben wird wie der Rest des Runs. Das neue Recht
`runs.read.all` steht für "sieht die Runs aller Benutzer"; `*` schließt es wie jedes andere Recht
ein.

Durchgesetzt wird ausschließlich serverseitig, und zwar an den Engstellen, durch die alles läuft,
statt in jeder einzelnen Methode: `assertRunRights` prüft nach den Rechten die Zugehörigkeit und
deckt damit Chat, Start, Stopp, Laufansicht, Journal, Artefakte und die Ereigniskanäle des Hosts
ab; die Nachrichtenschicht prüft zusätzlich jede Eingabe und jeden Kanalparameter mit `runId`, so
dass ein Beitrag einer Erweiterung ohne eigenen Code mitgeschützt ist; die Auslieferungsrouten
prüfen den Abschnitt `runs/<kennung>` ihrer Adresse; die Run-Liste filtert; der übergeordnete
Koordinator löst seine Laufreferenzen nur über die Runs des Aufrufers auf; und der
Oberflächenkontext einer Nachricht darf keinen fremden Run nennen. Ein fremder Run antwortet wie
ein nicht vorhandener (`run-not-found`, 404), damit eine geratene Kennung nichts verrät.

Bestandsruns bekommen keinen Eigentümer nachgetragen. Das Journal wird nicht umgeschrieben, und
es gibt keine belastbare Quelle dafür, wem ein solcher Run gehörte: Der menschliche Teilnehmer
trägt nur einen Anzeigenamen und einen normalisierten Handle. Sie gelten deshalb als Runs ohne
Eigentümer und bleiben Zugängen mit `runs.read.all` vorbehalten - die sichere Richtung, denn
niemand bekommt dadurch etwas zu sehen, was er vorher nicht durfte. Dasselbe gilt für jeden Run,
der ohne Anmeldung entstanden ist, und für einen importierten Run ohne Eigentümer im Archiv.
Profile ohne Anmeldung bleiben unberührt: Dort gibt es genau einen Zugang, die Regel greift erst
bei eingeschalteter Benutzeranmeldung. Die private lokale Dienstidentität des Hosts führt
`runs.read.all` mit, weil sie für den Server handelt und nicht für einen Bediener.

## Zustandssymbol und Text im Umgebungs-Chip haben getrennten Raum (22.09.2026)

Kapitel: `docs/spec/plugins.md` (VS-Code-Erweiterung: Start). Der eigene Symbolknopf im
Umgebungs-Chip hatte links 10 Pixel und rechts 4 Pixel Innenabstand. Dadurch saß das Symbol
sichtbar rechts, während der Inhalt nach der Kante mit nur 4 Pixel Abstand begann. Der
Symbolbereich ist jetzt 32 Pixel breit und zentriert das Symbol; der Inhaltsbereich beginnt mit
8 Pixel Innenabstand. Ein Browser-Test prüft beide Maße geometrisch.

## Geheimnisse für den lokalen Host stehen in der SecretStorage (22.09.2026)

Kapitel: `docs/operations.md` (VS-Code-Erweiterung). Ein lokal gestarteter Host erbte nur die
Umgebung der Erweiterung. Startet VS Code über Dock oder Finder, fehlen darin die Variablen der
Shell, und ein Profil, das seine Werte über `env("NAME")` auflöst, kam nicht hoch. Die Werte in
die Einstellungen zu schreiben schied aus: `settings.json` ist eine Klartextdatei und wandert in
Sicherungen und Sync. Die neue Einstellung `ragents.hostEnvironment` führt deshalb nur die Namen,
geprüft gegen `^[A-Za-z_][A-Za-z0-9_]*$`; die Werte liegen unter `ragents.host-env:<NAME>` in der
SecretStorage und kommen erst beim Start des Hosts über die geerbte Umgebung. Fehlt ein Wert,
startet der Host trotzdem, und der Kanal `RAgents` nennt nur den Namen.

## Stopp erhält den sichtbaren Antwortanfang (22.09.2026)

Kapitel: `docs/spec/core.md` (Stopppfade). Live-Text lag bis zum regulären Modellabschluss nur
im flüchtigen Chat. Ein Abbruch verlor deshalb den schon gelesenen Antwortanfang bei der
nächsten Wiedergabe. Die Agentenlaufzeit hält den offenen Text beim Abbruch als
`model.output.interrupted` fest, bevor der Scheduler den Turn unterbricht. Auch der Dispose-Pfad
sichert ihn, bevor er den Dispatcher entfernt. Der neue Event ist nur Gesprächshistorie:
kein fertiges Ergebnis, kein `Turn.outputs`-Eintrag und keine Subscription-Quelle. Die bestehenden
Textcursor verhindern eine doppelte Darstellung beim Übergang vom Stream zum Journal.

## Die Homepage veröffentlicht keine zusammenkopierte LLM-Gesamtdatei (22.09.2026)

Kapitel: `docs/spec/overview.md` (öffentliche Referenzen) und `docs/operations.md` (Homepage-Build).
Die HTML-Dokumentation und ihre gezielten Markdown-, TypeScript- und OpenRPC-Referenzen decken
denselben Inhalt bereits strukturiert ab. `llms-full.txt` duplizierte alle Texte in einer großen
Datei, vergrößerte den Export und bot keinen zusätzlichen Vertrag. Der Generator erzeugt und
veröffentlicht sie deshalb nicht mehr; `llms.txt` bleibt der kurze Index zu den einzelnen Quellen.

## Ein lokaler Host überlebt seine Erweiterung nicht (22.09.2026)

Kapitel: `docs/spec/profiles.md` (Startmodi) und `docs/spec/plugins.md` (Web als Plugin-Host).
Startete die VS-Code-Erweiterung den Host einer lokalen Profil-Umgebung, überlebte der Kindprozess
jeden Reload des Fensters und jeden Absturz von VS Code: `deactivate` war leer, und der
`dispose`-Eintrag warf die Promise von `disconnect()` mit `void` weg, so dass niemand auf
`RunningHost.stop()` wartete. Der verwaiste Host hielt weiter das Writer-Lock unter
`<DATA_DIR>/runs/.writer.lock` samt frischem Herzschlag; der neue Host brach mit "Another runtime
process already owns ..." ab und die Umgebung stand im Panel als gescheitert.

Festgelegt: zwei voneinander unabhängige Wege. `startHost` gibt dem Kindprozess
`RAGENTS_PARENT_PID` mit, und der Host überwacht diesen Prozess mit
`apps/server/src/parent-watch.ts` alle fünf Sekunden über `process.kill(pid, 0)` (ESRCH heißt weg,
EPERM heißt lebendig unter fremdem Besitzer); ist der Aufrufer fort, nennt eine Zeile auf stderr
die Ursache und danach läuft genau die `shutdown`-Funktion der Signal-Handler, das Lock geht also
regulär zurück. Das Intervall ist `unref()`ed und hält den Host nie am Leben; ein gesetzter, aber
unsinniger Wert ist ein harter Startfehler, eine fehlende Variable ändert nichts (Start über
`scripts/start.sh`, CLI, Tests). Dazu wartet `deactivate` jetzt auf eine modulweite
Aufräumfunktion, die alle Sitzungen trennt und dabei jeden eigenen Host stoppt; sie ist wie
`shutdown` im Server als Promise gemerkt, so dass der `dispose`-Eintrag der subscriptions
denselben Lauf abwartet statt eines zweiten. Das Warten ist auf vier Sekunden begrenzt, weil VS
Code den Extension-Host beim Neuladen nur kurz räumen lässt - der geordnete Weg ist der schnelle,
der Wächter im Host deckt den Rest.

## Der Chat-Griff bestimmt die Einfahrtiefe (22.09.2026)

Kapitel: `docs/spec/plugins.md` (Run-Panel). Das automatische Ausfahren des unteren Chats
bleibt erhalten. Der bisher nur klickbare Griff verändert zusätzlich durch Ziehen die sichtbare
Ruhehöhe und merkt sie je Run als Abstand zum gemessenen Minimum. So bleiben auch wachsende
Eingaben vollständig sichtbar. Die Mindesthöhe zählt Rahmen und tatsächliche Elementhöhen
mit, damit die obere Rundung der Eingabe nicht abgeschnitten wird. Während des Ziehens pausiert
die Automatik; anschließend verwendet sie wieder die gewählte Ruhelage.

## Neue Runs in VS Code beginnen mit Fokus im Chat (22.09.2026)

Kapitel: `docs/spec/plugins.md` (Run-Panel und Host). Das Öffnen des VS-Code-Panels fokussierte
bisher nur die Hülle; vor dem Tippen war ein zusätzlicher Klick in den Chat nötig. Ein neuer Run
fordert deshalb einmalig den Fokus seiner sichtbaren Chat-Eingabe an, sobald die Verbindung
steht und die Eingabe schreibbereit ist. Das gilt auch nach einem Vorlagenstart. Vorhandene Runs
und Browser-Ansichten behalten ihr Verhalten; spätere Nachrichten und Wiederverbindungen setzen
den Cursor nicht erneut um.

## Die Regeln des Arbeitsbereichs hängen an seinen Werkzeugen (22.09.2026)

Kapitel: `docs/spec/plugins.md` (Promptbeiträge). `plugins/ragents.workspace/prompt.hbs` nennt die
Schreibgrenzen, das Verbot entfernter Git-Operationen und das fehlende Netz in `bash`. Der Beitrag
nannte kein `requiresTools` und erreichte deshalb nur den Koordinator: `basePromptFor` gibt Actors,
die nicht Koordinator sind, nur Beiträge mit `delivery: "initial"` UND passendem `requiresTools` -
ausgerechnet die Sub-Agenten, die mit denselben Werkzeugen im selben Ordner schreiben, sahen die
Regeln nie.

Festgelegt: Die Registrierung bindet den Beitrag mit `boundToTools` an `read`, `edit`, `write` und
`bash` und hält dabei ausdrücklich `delivery: "initial"` fest; der Standard von `boundToTools` wäre
`on-demand` und würde den Text nur noch im Kapitel-Abruf zeigen. Die Namen kommen aus
`agentWorkspaceToolNames` in `apps/server/src/plugin-support/workspace-tool-naming.ts`, also aus
derselben Tabelle, aus der der Scheduler die Werkzeuge eines Actors benennt; Engine und Server-Kern
kennen weiterhin kein Werkzeug. Doppelt steht der Text nicht im Prompt: `composeWith` baut den
Koordinatorprompt, der zweite Zweig von `basePromptFor` den der übrigen Actors, und beide Wege
schließen einander aus.

## Der Arbeitsbereich beschreibt sich selbst im Systemprompt jedes Actors (22.09.2026)

Kapitel: `docs/spec/core.md` (Systemprompt je Turn), `docs/spec/plugins.md` (WorkspaceRuntime).
Befund aus einem echten Lauf: Ein an einen Projektordner auf einem Arbeitsplatz gebundener Run
antwortete "Das Arbeitsverzeichnis ist aktuell noch leer". Zwei Ursachen.

Erstens erreichte die Meldung des Arbeitsbereichs das Modell nie: `emitSystem` erzeugt ein
Chat-Event für die Oberfläche, nicht für den Modellkontext. `plugins/ragents.workspace/prompt.hbs`
behauptete trotzdem "A system note at the start says where it is"; der Satz ist raus. Zweitens
hängte die Agentenlaufzeit den serverseitigen Ablageordner als `Current working directory: ...` an
den Systemprompt - bei der Bindung `client` genau der leere Ordner, während die Werkzeuge im
echten Projekt auf dem Arbeitsplatz laufen.

Festgelegt: `SessionWorkspace` bekommt das optionale Feld `description`, das der Arbeitsbereich
selbst formuliert (Bindung `path`, `client`, `fresh`; bei `fresh` mit dem Pfad, den der Resolver
geliefert hat). Der Kern reicht es generisch durch - `SessionWorkspaces` merkt es sich je Run,
`Workspaces.description(runId)` liest es, der `TurnScheduler` hängt es als letztes Kapitel an den
Systemprompt jedes Actors, der Arbeitsbereichswerkzeuge hat, auch beim zweiten Aufbauweg
`refreshTools`. Der Scheduler entscheidet das über die bereits vorhandenen `workspaceTools`; Engine
und Server-Kern kennen weiterhin kein Werkzeug und keinen Prompttext.

Ein Beitrag über `host.prompts` hätte nicht gereicht: `basePromptFor` gibt Actors, die nicht
Koordinator sind, nur Beiträge mit `delivery: "initial"` UND passendem `requiresTools`, und genau
deshalb sah bisher kein Sub-Agent `prompt.hbs`.

Abweichung vom ursprünglichen Entwurf: Die Beschreibung steht genau einmal im Prompt. Der Entwurf
sah vor, dass die Agentenlaufzeit die Beschreibung ANSTELLE des rohen Pfads ausgibt; zusammen mit
dem Kapitel des Schedulers stünde derselbe Absatz zweimal hintereinander. Stattdessen unterdrückt
die Laufzeit nur ihre eigene Zeile (neunter eigener Eingriff, siehe "Eigenes Verhalten in der
Agentenlaufzeit"): der Turn-Request führt `workspaceDescribed`, der Agent-Treiber reicht es als
`omitCwd` in die Session, und `buildSystemPrompt` lässt `Current working directory: ...` dann weg.
Ein Actor ohne Arbeitsbereichswerkzeuge behält den rohen Pfad, denn für ihn ist der serverseitige
Ordner tatsächlich das Arbeitsverzeichnis von `typescript_eval`.

## VS-Code-Tastenkombinationen aus dem eingebetteten Run-Panel weiterreichen (22.09.2026)

Kapitel: `docs/spec/plugins.md` (VS-Code-Erweiterung), `docs/operations.md` und
`apps/vscode/README.md`. Tastaturereignisse verlassen ein iframe nicht; VS Codes Webview-Listener
hörte deshalb nur die Hülle. Das Run-Panel reicht unbehandelte Keydown-/Keyup-Ereignisse samt
physischer Taste, Keycode und Modifikatoren an die Hülle weiter. Diese prüft Quelle und Herkunft
und stellt sie als DOM-Ereignisse für VS Codes bestehende Tastenauflösung bereit. So gelten auch
benutzerdefinierte Belegungen, ohne Befehle in der Erweiterung nachzubauen.

Die vorhandene Zwischenablage-Brücke bleibt bestehen: Hex simuliert Cmd+V, während VS Codes
Einfügebefehl nur sein direktes Webview-Dokument erreicht. Lokale Bearbeitung, IME und bereits
vom Chat behandelte Tasten gehen daher nicht durch den neuen Weg. Wegen der asynchronen
Frame-Grenze haben diese lokalen Tasten Vorrang vor konkurrierenden VS-Code-Belegungen.

## Default-Einstieg je Umgebung, Kachel je erreichbarer Umgebung, das Plus nimmt den Default, Fehlermeldung hinter dem Zustandssymbol (22.09.2026)

Kapitel: `docs/spec/profiles.md` (Export `defaultStartEntry`), `docs/spec/plugins.md` (Bootstrap,
VS-Code-Erweiterung: Start), `docs/operations.md` (Bedienung der Erweiterung),
`apps/vscode/CHANGELOG.md`. Entscheidung des Owners nach der Abnahme der Start-Seite.

**Eine Umgebung kann einen Default-Einstieg haben, und der ist eine Eigenschaft des Profils.** Die
Profildatei bekommt neben `config`, `users` und `anonymousUser` den vierten optionalen Export
`defaultStartEntry`, ein String mit der Kennung eines Einstiegs. `config-file.ts` prüft die Form,
`profile/compose.ts` gibt ihn dem `PluginHost`, und der lehnt beim Versiegeln einen Einstieg ab,
den kein Plugin des Profils registriert hat - mit der Liste der registrierten Einstiege, ein harter
Startfehler. `publicProfile` liefert ihn als `PublicPluginProfile.defaultStartEntry` nur, wenn der
Einstieg unter den für den Benutzer freigegebenen Vorlagen ist; sonst fehlt das Feld, die
Vorlagen bleiben. Die Erweiterung reicht ihn durch (`RunStore.defaultEntry`,
`TargetSnapshot.defaultEntry`, `TargetView.defaultEntry`); ein Default, der nicht unter den
gelieferten Vorlagen ist, ist im Store ein Fehler der Umgebung, die Seite rät nichts. `core`,
`showcase` und `developer` setzen keinen Default. Warum: welcher Einstieg der normale ist, weiß
das Profil, nicht die Oberfläche und nicht der Benutzer je Klick.

**Neu beginnt je erreichbarer Umgebung mit einer Kachel.** Mit Default ist das dessen Vorlage,
optisch wie die anderen, mit dem Kennzeichen "Standard" in der Kategoriezeile und nicht ein
zweites Mal in der Liste; ohne Default die Kachel "Neuer Chat" (Kategorie "Ohne Vorlage",
"Leerer Run, der Auftrag entsteht im Chat.", gestrichelte Kante, Plus), wie sie am Vortag in der
Übersicht stand. Der Abschnitt erscheint damit, sobald eine Umgebung verbunden ist und neue Runs
erlaubt, und der Zähler zählt alle Kacheln. Warum: der leere Chat war nur noch hinter dem Plus
erreichbar und der Abschnitt fehlte ohne Vorlagen ganz.

**Das Plus am Chip nimmt denselben Default.** Mit Default schickt es `newRun` mit `entryId`
("Neuer Run aus <Vorlage> auf <Umgebung>"), ohne wie bisher ohne `entryId` ("Neuer Chat auf
<Umgebung>"). `RAgents: Neuer Run` bleibt, nur die erste Zeile je Umgebung ist bei vorhandenem
Default dessen Vorlage (Zusatz "Standard") statt "ohne Vorlage". Warum: ein Klick, ein Ergebnis,
und das Profil entscheidet, welches.

**Die Fehlermeldung steht hinter dem Zustandssymbol.** Bei `failed`, `unreachable` und `forbidden`
ist das Symbol im Chip ein eigener kleiner Knopf ("Fehler von <Umgebung> anzeigen"), der ein
`Popover` aus `ui/popover.tsx` öffnet: Zustandswort als Überschrift, die vollständige Meldung aus
`TargetState.message` als markierbarer Text (`stateDetail`, dieselbe Quelle wie die Seite
Umgebungen; Monoschrift bei mehrzeiliger Ausgabe), darunter "Ausgabe öffnen" (neue Panel-Aktion
`showOutput`, die Erweiterung zeigt den Kanal RAgents) und das Aktionswort des Chips ("Erneut
versuchen" oder "Anmelden"). Das Popover überlebt das kurze `connecting` eines automatischen
Neuversuchs und schließt sich, sobald die Umgebung ohne Fehler ist. Bei `login-required` öffnet
das Schloss den Anmeldedialog, in allen anderen Zuständen hat das Symbol keine eigene Aktion; der
linke Teil des Chips behält seine Aktion. Ein Popover statt eines Dialogs, weil die Meldung zum
Chip gehört und der Blick dort bleiben soll. Warum: bisher zeigte Start bei einem Fehler nur das
rote Symbol und "Erneut versuchen", die Ursache stand nur auf der Seite Umgebungen.

## Aktionen nur in der VS-Code-Titelzeile, geteilte Umgebungs-Chips mit Aktionswort und Zielzeile, Stopp einheitlich rot (22.09.2026)

Kapitel: `docs/spec/plugins.md` (VS-Code-Erweiterung: Seiten, Vokabular, Stopp),
`docs/spec/core.md` (Run stoppen), `docs/operations.md` (Run-Panel und VS-Code-Erweiterung:
Bedienung), `apps/vscode/CHANGELOG.md`. Befund des Owners am ersten Tag der neuen Panelseiten.

**Die Aktionen stehen nur in der Titelzeile der Ansicht.** Start, Runs, Umgebungen, Neuer Run und
Aktualisieren gab es dreimal: in der nativen Titelzeile (`view/title`), in der Kopfzeile der Seite
und als Zahnrad neben der Überschrift "Umgebungen". Jetzt nur noch in der Titelzeile, wie VS Code
es vorsieht; `PanelHeader` trägt nur Zurück-Pfeil und Titel, Start hat gar keine Kopfzeile mehr,
weil der Titel "RAgents" schon oben steht. Der Sprung in die `settings.json` ist von der Kopfzeile
der Seite Umgebungen nach unten neben "Neue Umgebung" gewandert. Warum: dreimal dasselbe Symbol
übereinander liest sich als drei verschiedene Dinge.

**Der Umgebungs-Chip ist ein geteilter Knopf.** Bisher war nur das winzige Zustandssymbol
klickbar, das sah niemand. Der linke Teil ist ein `button` mit Zustand, Name und einem Aktionswort,
das vom Zustand abhängt (Anmelden, Erneut versuchen, Starten, Verbinden, Runs; "startet ..." ist
gesperrt); der rechte Teil das Plus. "Runs" öffnet die Seite Runs gefiltert auf die Umgebung: die
Aktion `page` trägt dafür `environment`, die Erweiterung gibt es als `PanelState.runsEnvironment`
zurück, die Seite zeigt den Filter als gedrückten Schalter, den ein Klick aufhebt. Die
abgeschalteten Filterchips über allen Umgebungen kommen nicht zurück; der Filter ist der Weg vom
Chip, nichts, was auf der Seite Runs von selbst dasteht. Warum: ein Klick auf einen Chip muss
sichtbar etwas tun, und das Wort sagt, was.

**Die Zielzeile kommt aus der Erweiterung.** Unter dem Namen steht in der Monoschrift der Zeit,
wohin die Umgebung geht: `lokal · <profil>`, der Host des Servers oder `<host> · lokal` für ein vom
Server verteiltes Client-Profil. Die Daten liefert `TargetView.route`, gebaut in
`overview-model.ts` aus der Verbindung (`profileNameOf`, `serverHost`) und dem neuen
`TargetSnapshot.localHost` (die Sitzung spricht mit einem selbst gestarteten Host). Warum: die Seite
hätte den Profilnamen aus dem Pfad und die Verteilung aus gar nichts raten müssen.

**Ein Stopp, eine Glyphe, ein Wort.** Der Stopp-Knopf war nicht als Stopp zu erkennen; üblich ist
ein rotes Zeichen. Zwei Regeln: Zustandssymbole tragen nie ein Quadrat
(gestoppt ist jetzt ein leerer Kreis statt Kreis mit Punkt), und jeder echte Stopp-Knopf ist
`StopButton` aus `ui/stop-button.tsx`, ein gefülltes Quadrat in `--destructive` mit gleichem Hover
und Disabled - im Run-Panel-Kopf (bisher `CircleStopIcon` grau), an der Chat-Eingabe, an den
Prozessen und im Menüeintrag von `ragents.orchestration`. Das Beenden des ganzen Runs heißt überall
"Run stoppen", nie mehr "Lauf stoppen"; "Arbeit stoppen" bleibt das Unterbrechen im Chat, eine
andere Aktion. Die übrigen "Lauf"-Reste in Oberflächentexten heißen jetzt "Run". Warum: der Begriff
ist im ganzen Repo "Run", und ein grauer Kreis mit Quadrat ist weder Zustand noch Knopf.

**Die Run-Liste ist ein Raster.** `RunList` ist ein CSS-Grid mit den Spalten Kontrollkästchen (nur
im Auswahlmodus), Zustand, Titel, Zeit und Umgebung (nur ab zwei Umgebungen); Zeile und Knopf sind
`grid-cols-subgrid`, damit Zeit und Umgebung in allen Zeilen an derselben Kante stehen, gleich wie
lang der Titel oder der Name ist. Der Browser-Test prüft genau das. Warum: Spalten, die je nach
Zeile springen, sind keine Spalten.

## Die Erweiterung ist eine App aus vier Seiten, mit einem Vokabular und kompakter Zeit (22.09.2026)

Kapitel: `docs/spec/plugins.md` (Web als Plugin-Host: Run-Panel in der Erweiterung),
`docs/operations.md` (Run-Panel und VS-Code-Erweiterung), `apps/vscode/README.md`,
`apps/vscode/CHANGELOG.md`, `TODO.md`. Grundlage ist der abgenommene Gesamtentwurf
`docs/ui-drafts/app-2026-09-22.html` (Stand 6) mit der Auswahl der Schalter durch den Owner; Bilder der Seiten
liegen als `docs/ui-drafts/app-2026-09-22-*.png` daneben.

**Vier Seiten statt Übersicht und Einstellungen.** `PanelState.page` trägt jetzt `start`, `runs`,
`run` und `environments`; eine Kopfzeile nennt die Seite, zwei Symbole führen zu Runs und
Umgebungen. Warum: die Übersicht war eine Seite mit drei Aufgaben, und die volle Run-Liste hätte
sie so lang gemacht, dass die Kacheln darunter nie mehr in den Blick kommen.

**Ein Vokabular für alle Seiten, das Wort nur im Tooltip.** Je Zustand ein farbiges Symbol
(`apps/web/src/ui/state-icon.tsx`) und genau ein Wort
(`apps/web/src/ui/state-vocabulary.ts`, ohne React, damit die Erweiterung es mitlesen kann): ein Run
läuft, wartet auf Eingabe, ruht, ist beendet, fehlgeschlagen oder abgebrochen; eine Umgebung ist
verbunden, bereit, startet, verlangt eine Anmeldung, ist nicht erreichbar oder gestoppt. Warum: bei
420 Pixeln kostet jedes Wort Titelbreite, und drei Seiten, die denselben Zustand verschieden
nennen, sind drei Wahrheiten.

**Kein Werkzeugbegriff im Panel.** Der wartende Run nennt die Zahl offener Eingaben, nicht den
Begriff des Plugins, das gerade fragt; "Rückfrage" steht nirgends mehr. Warum: das Panel gehört dem
Produkt, nicht dem Plugin, das zufällig gerade wartet - dieselbe Grenze, die die Engine am selben
Tag gezogen hat.

**Die Zeit ist kompakt und ohne "vor".** `jetzt` unter einer Minute, dann `5 min`, `3 h`, `1 d`,
`2 d`, ab sieben Tagen das Datum `13.09.` (`apps/web/src/ui/relative-time.ts`); die ausgeschriebene
Form steht nur im `title`. Kein Sonderfall für gestern - eine Reihe ohne Ausnahme liest sich
schneller als eine mit. Warum: die Zeit steht in einer festen Spalte neben Zustand und Umgebung, und
"vor 5 Minuten" passt dort nicht.

**Der Explorer-Baum entfällt.** `explorer.ts`, `explorer-model.ts`, der Ansichts-Container in der
Aktivitätsleiste, sein Welcome-Text und seine Menüs sind weg; das Abzeichen der wartenden Eingaben
sitzt jetzt an der Ansicht des Run-Panels. Warum: Start und Runs zeigen dieselben Umgebungen, Runs
und Vorlagen flacher und mit Zustand; ein zweiter Navigationsbaum daneben wäre eine zweite Wahrheit,
die bei jeder Änderung mitzupflegen wäre. Preis: das Journal eines Runs hat im Panel keinen Einstieg
mehr; der Befehl `ragents.openJournal` bleibt, steht aber in `TODO.md`.

**Ein lokales Profil startet beim Aktivieren, nicht bei Bedarf.** Der Zustand "nicht gestartet" wird
nicht mehr gezeigt, die Knöpfe "Starten" und "Stoppen" entfallen aus der Seite; `startProfile` und
`stopProfile` bleiben vorerst im Vertrag, weil der Host-Test sie für den Lauf aus einem geholten
Paket braucht. Warum: eine Umgebung ohne Vorlagen ist eine leere Kachel, und der Umbau auf stdio,
der den Port ganz spart, kommt später gesondert.

**Die Kopfzeile des Run-Panels bekommt einen Zurück-Pfeil.** Der Aufklapp-Pfeil mit der Run-Liste
als Overlay (`listOpen`) entfällt; an seiner Stelle führt der Pfeil immer auf die Start-Seite, als
eigene Nachricht `showStart` in `run-panel/host-contract.ts`. Rechts stehen die Umgebungspille (neu
als `?environment=` in `RunPanelPageQuery`), das Zustandssymbol und der Stopp als Symbol. Warum:
`runChanged` meldet eine Folge, keine Absicht, und die aufgeklappte Liste war eine zweite Fassung
derselben Liste ohne Ausgang aus dem Run.

**Löschen bleibt Sache des Hosts.** Die Seite Runs schickt `deleteRuns` je Umgebung mit den
Kennungen, bestätigt vorher im Dialog; die Erweiterung ruft `ragents.sessions.delete` und frischt
die Liste auf. Auch das Entfernen einer Umgebung fragt jetzt im Dialog zurück statt in der Zeile.
Warum: eine Rückfrage, die in der Zeile steht, verschiebt die Liste unter der Hand, und eine
Mehrfachauswahl passt dort ohnehin nicht hin.

## Die Engine kennt keine Werkzeugform mehr: eine wartende Aktion mit undurchsichtigem Payload (22.09.2026)

Kapitel: `docs/spec/core.md` (Wartende Aktionen), `docs/spec/plugins.md` (Kern-Grenze, Web als
Plugin-Host), `docs/operations.md` (Run-Panel und VS-Code-Erweiterung). Befund des Owners: Die
Engine darf kein Werkzeug und keine Werkzeugform kennen, kannte aber genau eine.
`packages/ragents/src/domain/events.ts` trug neben dem generischen `kind: "action"` den Fall
`kind: "question"` mit `question: { options, multi }`; verarbeitet in `model.ts`,
`projection.ts`, `event-validation.ts`, `event-semantics.ts` und
`runtime/decisions/actions.ts`, erzeugt vom Plugin `ragents.ask`, dargestellt bis in
`apps/server/src/chat-events.ts` (Rolle `question`), `apps/web/src/chat/QuestionCard.tsx` und
die Zähler in `apps/vscode/src` und `apps/web/src/panel`. Der Grundsatz stand schon in
`docs/spec/overview.md` ("Plugins besitzen Fachlichkeit und Integrationen. Der Core kennt keine
Fachdomäne.") und in der Kern-Grenze von `plugins.md`; die Fallunterscheidung im Ereignis war
sein direkter Bruch.

**Ein Fall statt zweier.** `action.proposed` trägt jetzt `owner: string | null` und
`payload: JsonObject | null`, `action.resolved` statt `response: string | null` ein
`result: JsonValue | null`. `ActionKind` und `ActionQuestion` gibt es nicht mehr. Der Payload
wird nur als JSON-Objekt geprüft und nie gelesen. Der Eigentümer ersetzt die bisherige
Fallunterscheidung auch bei der Berechtigung: eine Aktion ohne Eigentümer ist der generische
Genehmigungsfall des Kerns (`action_propose`) und verlangt `action.propose`, eine Aktion mit
Eigentümer gehört dem Plugin und verlangt sie nicht. Das war vorher an `kind` gebunden.

**Die Form gehört dem Plugin.** `ragents.ask` legt `{ question, options, multi }` in den
Payload und beantwortet über seinen eigenen Vertrag `ragents.ask.answer`. Sein Web-Teil
registriert die Darstellung über den neuen Erweiterungspunkt `actionViews` (je Eigentümer genau
eine Komponente, symmetrisch zu den Tool-Presentern; der Host reicht sie wie `renderTool` über
einen Kontext an `ChatMessages`). `QuestionCard` ist aus `apps/web/src/chat/` in
`plugins/ragents.ask/web/` gezogen; an seine Stelle tritt die generische `PendingActionCard`
mit Titel, "wartet auf Eingabe" und "Verwerfen". Der bisherige `questionResponder` und
`SessionContext.respond` entfallen - ein Plugin ruft seinen eigenen Vertrag auf, der Host nur
das generische Verwerfen. Der `FlowInspector` zeigt Aktionen jetzt ebenfalls generisch samt
Eigentümer und Nutzdaten und hängt nicht mehr an `ragents.ask`.

**Alte Journale werden abgelehnt, nicht migriert.** Ein `action.proposed` mit `kind` scheitert
in der Ereignisprüfung mit genau dieser Ursache; der betroffene Run wird wie jeder Run mit
einem ungültigen Ereignis isoliert, Server und übrige Runs laufen weiter. Grund: Eine Migration
beim Lesen hätte der Engine dauerhaft beigebracht, dass `question` zu `ragents.ask` gehört -
genau die Kopplung, die hier verschwindet. Dateiformat 4 und Eventschema 3 bleiben unverändert;
es ist kein Versionssprung nötig, weil die vorhandene Isolierung schon die richtige Antwort ist.

**Der Zähler heißt generisch.** Aus `questions` wird `pendingActions` (Run, Actor, Mini-App,
Umgebungsliste), aus `openQuestions` im Wächterzustand ebenfalls `pendingActions`, und die
Beschriftungen sagen "wartet auf Eingabe" statt "Rückfrage" (`apps/vscode/src/{store,
explorer-model,overview-model,run-model,extension}.ts`, `apps/web/src/panel/{contract,
target-state}.ts`). `pendingInputs` blieb frei: das zählt weiterhin wartende ActorInputs.

## Chatoptionen bleiben von außen gesetzte Eigenschaften (22.09.2026)

Kapitel: `docs/spec/plugins.md` (Chat-Bausteine). Schrift und Abstände, Zeitformate und
Tagestrenner, Codeblöcke, Sprechblasen und Absender, Nachrichtenaktionen, Sendetaste und
Scrollen nach dem Senden sind optionale Props. Der Owner will diese Möglichkeiten ausschließlich
von außen konfigurieren; dafür entsteht keine neue Einstellungsoberfläche. Die vorhandenen
Standardwerte bleiben erhalten. Bearbeiten und erneutes Anfordern sind Host-Callbacks, damit
die gemeinsamen Chatbausteine keine produktspezifischen Journal- oder Modelloperationen
erfinden. Der Sprung nach dem Senden ist lokal auf das jeweilige ChatPanel begrenzt und folgt
nur auf eine erfolgreiche, nicht leere Eingabe.

## Chatbreite und Zeitstempel sind vom Host steuerbar (22.09.2026)

Kapitel: `docs/spec/plugins.md` (Chat-Bausteine), `docs/operations.md` (Run-Chat und
Arbeitsfläche). Der Verlauf war auf 760 Pixel begrenzt, die Eingabe auf 880 Pixel; Antworten
verloren zusätzlich acht Prozent Breite. Verlauf und Eingabe teilen jetzt ihre Breite und
Seitenabstände, standardmäßig ohne Maximalbreite. Einbettungen können beide Werte gemeinsam
setzen. Der Run-Chat bekommt einen Uhrknopf mit gespeicherter Auswahl je Run und primärem
Actor. Zeitstempelwert, Änderungs-Callback und Sichtbarkeit des Knopfs bleiben getrennt von
außen steuerbar; der wiederverwendbare Schalter besitzt keinen eigenen Speicher.
Die 120-Pixel-Toleranz des Ende-Pfeils betrifft nur dessen Sichtbarkeit. Sie verändert nicht
die bestehende Erkennung absichtlichen Zurücklesens und verhindert damit ungewolltes
Zurückspringen während laufender Antworten.

## Das Run-Panel bekommt die Arbeitsbereichs-Tabs als Leiste am rechten Rand, der Netz-Tab entfällt (21.09.2026)

Kapitel: `docs/spec/plugins.md` (Web als Plugin-Host: Workspace-Tabs, Canvas-Leiste und
Actorliste, Run-Panel, Offene Grenzen), `docs/spec/actor-programs.md` (Actorliste),
`docs/operations.md` (Run-Chat und Arbeitsfläche, Run-Panel und VS-Code-Erweiterung, Als Agent
bedienen), `docs/homepage/index.html` (Zugänge), `apps/web/README.md`, `apps/vscode/README.md`,
`apps/vscode/CHANGELOG.md`, `scripts/homepage/homepage-extensions.ts`, `TODO.md`. Vorgabe: Das
Run-Panel ist die Arbeitsansicht und soll die Web-Ansicht ersetzen; in VS Code fehlten Dateien,
Dokumente, Funktionen, Executions und die Diagnostik der Sprachserver bisher komplett, weil
`ChatWorkspace` im Layout `panel` nur die Kennungen der Reiter weiterreichte. Von vier
Mockup-Varianten (A: schmale Symbolleiste am rechten Rand wie die Activity Bar von VS Code, B:
Chip-Reihe am unteren Rand wie die Mini-App-Chips, C: Schublade am unteren Rand mit Griff, D: kein
Platz im Panel, Reiter im Explorer-Baum und als Editor-Reiter in der Mitte) ist A gewählt.

**Die Leiste ist Teil des Run-Panel-Rahmens, nicht des Orchestrierungs-Plugins.** `RunPanelRail`
und `RunPanelWorkspace` liegen unter `apps/web/src/run-panel/`; `ChatWorkspace` zeichnet sie im
Zweig `layout === "panel"` rechts neben und unter dem `RunPanel` des Canvas-Beitrags. So gibt es
sie mit jedem Canvas-Beitrag und ohne einen (nur Chat), und Bühne, Sheet und Chat des
Orchestrierungs-Panels bleiben unberührt: die Tab-Fläche ist ein Geschwister unter ihnen, das
Sheet endet an ihrer Oberkante. Deshalb liegt auch der gemerkte Zustand (offener Reiter, Höhe)
in einem Schlüssel des Kerns, `ragents.run-panel.workspace:<runId>`, und nicht im
`ragents.orchestration.run-panel:<runId>` des Plugins, nach demselben Muster
(`createLocalStorageSetting`, strenger Parser, harter Fehler). `PluginChat` führt weiterhin EINEN
Reiterzustand für beide Layouts; im Run-Panel speist ihn der gespeicherte Reiter, sodass
`navigation.openTab` und `activeTabId` dort genauso gelten wie im Web. Die Fläche ist zu, bis
jemand einen Reiter wählt, damit jeder Reiter einen Punkt für Neues tragen kann; `activeTabId`
ist bei geschlossener Fläche leer.

**Netz ist weg.** Der Reiter war der Actor-Chat, den das Run-Panel längst selbst zeigt, plus die
Inspektionsseiten (Eingang mit Routing, Turn, Subscription, Aktion, Artefakt mit Diff), die
später aus dem Chat heraus erreichbar werden sollen. Entfernt sind `ORCHESTRATION_TAB_ID`,
`OrchestrationInspectorPanel`, `IconOrchestration`, der Verlauf mit Zurück (`navigateFromPanel`,
`navigateBack`, `useOrchestrationController`), `tabId` und `selectionRevision` an
`CanvasContribution` und `CanvasController` samt der Prüfung "Canvas-Tab ist nicht registriert"
und der Ausnahme in `PluginChat.openTab`, der `run-app`-Entity-Presenter des Programm-Plugins und
der Namensknopf "im Inspector öffnen" in der Actorliste. Geblieben ist der Canvas-Controller als
die eine Auswahl auf der Fläche: App-Zugänge der Canvas-Leiste, Kacheln und Pop-outs melden sie,
ein Artefakt öffnet die Dokumente, alles andere wird die gewählte Kachel und der Standort für den
globalen Koordinator. `FlowInspector` und seine Tests bleiben für den späteren Einstieg aus dem
Chat; bis dahin führen Verweise auf seine Detailseiten nur zur Auswahl (Offene Grenzen).

## Die Arbeitsspalte heißt Run-Panel (21.09.2026)

Kapitel: `docs/spec/plugins.md` (Web als Plugin-Host, Run-Panel in der Erweiterung, Offene
Grenzen), `docs/operations.md` (Run-Panel und VS-Code-Erweiterung, Einstellungen),
`docs/development.md`, `docs/homepage/index.html` (Zugänge), `apps/web/README.md`,
`apps/vscode/README.md`, `apps/vscode/CHANGELOG.md`, `TODO.md`. Die eingebettete Run-Ansicht
hieß bisher Arbeitsspalte, im Code `column`: die Seite `column.html`, der Ordner
`apps/web/src/column/`, der Canvas-Beitrag `Column`, die View `ragents.column` der Erweiterung.
Begründung: "Spalte" beschreibt nur die Form, nicht die Rolle. Das Run-Panel ist die eingebettete
Run-Ansicht, im Browser wie in VS Code, und soll mittelfristig die volle Web-Ansicht ersetzen;
der Name sagt, was es zeigt, nicht wie schmal es ist.

**Eine reine Umbenennung, kein Verhalten ändert sich.** Die Seite heißt `run-panel.html`
(`apps/web/src/run-panel.tsx`, `src/run-panel/`), der Layout-Wert der Adresse `panel` statt
`column` (`app` bleibt), der Canvas-Beitrag `RunPanel` neben `Center`, die Nachricht an den Host
`returnToRunPanel`; das Orchestrierungs-Plugin liefert es aus `web/run-panel/` (`RunPanel`,
`RunPanelSettings`, `run-panel-state.ts`, `run-panel-actors.ts`). In der Erweiterung heißen die
View `ragents.runPanel` (Befehl `ragents.runPanel.focus`), der Container `ragents-run-panel`, der
Befehl `ragents.moveAppToRunPanel` und der Kontextwert `app-panel`. Die Einstellung heißt
`ragents.orchestration.runPanel` mit dem Label "Run-Panel". Die Browser-Schlüssel wandern mit
(`ragents.orchestration.run-panel:<runId>`, `ragents.orchestration.run-panel-settings`); alte Werte
verfallen, Kurs "keine Migrationen". Unverändert bleiben `panel.html` mit `apps/web/src/panel/`
(die Übersichts- und Einstellungsseite der Erweiterung ohne Run), `WorkspacePanel` (die
Seitenleiste des Webs) und die Eigenschaft `Panel` der Plugin-Beiträge (Werkstatt-Reiter,
Übersicht); "Spalte" bleibt, wo eine Tabellen- oder Rasterspalte gemeint ist. Die früheren
Einträge dieser Datei behalten ihren Wortlaut, das ist Chronik; wo sie das Kapitel "Arbeitsspalte
und VS-Code-Erweiterung" nennen, heißt es heute "Run-Panel und VS-Code-Erweiterung".

## Die Homepage sagt, dass Agenten mit Agenten reden (21.09.2026)

Kapitel: `docs/spec/overview.md` (Produkt-Homepage), `docs/homepage/index.html` (Agenten),
`README.md`, `apps/vscode/README.md`, `TODO.md` (Ideen). Anlass war ein Blick auf Hermes Agent 0.21
(Pantheon): benannte Bots in Gruppenräumen, die sich gegenseitig ansprechen, mit
Erwähnung eines bestimmten Agenten und nachlesbaren Übergaben. RAgents hat das seit dem Kern:
Handles, `actor_input` an genau einen Beteiligten, `agent_spawn` samt Fork, `event_subscribe`,
jedes Gespräch als Kachel und im Journal. Nur stand es auf der Homepage als "Agenten parallel
nutzen" und "Ergebnisse aneinander weitergeben", ohne das Wort Adressierung. Der Sticker heißt
jetzt "Agenten reden mit Agenten", der Abschnitt erklärt Handle, direkte Nachricht, Helfer, Fork
und Abonnement und sagt, dass jedes Gespräch sichtbar bleibt; die beiden READMEs ziehen nach.
Was Hermes darüber hinaus hat und hier fehlt, steht als Idee in `TODO.md`: Kosten je Helfer im
Werkzeugergebnis und eine Schema-Prüfung für LLM-Antworten.

## Die Beispiele verlassen core und bekommen ein eigenes Profil showcase (21.09.2026)

Kapitel: profiles (Produktprofile), plugins (Skill-Einstiege und Referenzfälle), operations (Ein
Sample auswählen, Lokal installieren, Ohne Checkout arbeiten), `ragents.config.core.ts`, neu
`ragents.config.showcase.ts`, `scripts/homepage/homepage-catalog.ts`,
`scripts/package/build-package.ts`. `core` führte bisher `ragents.reference` mit: 27 Skills und
6 Run-Scripts vom Wortspiel über die Balkon-Planung bis zur moderierten Runde. Wer `core` als
Vorlage für ein echtes Profil nahm, bekam 33 Startvorlagen geschenkt, die mit seiner Arbeit
nichts zu tun haben.

**core ist die Vorlage, die Beispiele sind Lehrmaterial.** Deshalb nennt `core` das Plugin nicht
mehr, und das neue Profil `showcase` ist genau `core` und zusätzlich `ragents.reference`.
Nichts wird gelöscht: die Beispiele bleiben im Repository, lassen sich mit
`./start.sh showcase` starten und stehen jeder eigenen Profildatei weiterhin als Plugin-ID
offen. Anmeldung, Modelle, Relay-Aliasse und Language Server entsprechen `core`; eigen sind nur
Profilname, Produkt-Deskriptor (`ragents-showcase`) und Port.

**Port 4711, nicht 4712.** `showcase` soll neben `core` laufen können, also braucht es einen
eigenen Port; 4712 gehört laut Spec der nicht startbaren Konfigurationsvorlage
`ragents.config.example.ts`. Damit gilt: core 4710, showcase 4711, Vorlage 4712, developer 4715,
und im Dev-Modus jeweils plus 1000.

**Nachtrag am selben Tag: 4713 statt 4711.** Port 4711 ist in der lokalen Entwicklungsumgebung
bereits belegt. `showcase` bekommt deshalb 4713. Damit gilt: core 4710,
Vorlage 4712, showcase 4713, developer 4715, und im Dev-Modus jeweils plus 1000.

**Die öffentliche Referenz kommt aus showcase.** Der Katalog der Homepage liest die Pluginliste
einer Profildatei statisch aus (`showcasePluginIds`); ohne Beispiele im Profil verlöre die
Referenz ihre Beispielseiten und die eingebaute Hilfe ihren Knopf "Sample starten". Sie wird
deshalb aus `showcase` erzeugt, während `core` schlank startet. Läuft ein Server mit `core`,
bleibt der Startknopf in der Hilfe aus - sie zeigt nur, was das Profil anbietet.

## Die README wird ein kurzer englischer GitHub-Einstieg, das Handbuch zieht nach docs/development.md, die Homepage geht über GitHub Pages online (21.09.2026)

Kapitel: `README.md`, neu `docs/development.md`, `AGENTS.md`, `CLAUDE.md`,
`docs/operations.md` (Öffentliche Homepage und Entwicklerreferenz), `scripts/package/build-package.ts`
(`homepage` im Paketmanifest), neu `.github/workflows/homepage.yml`. Die README war viel
zu geschwätzig für das, was sie auf GitHub ist: die erste Seite für jemanden, der das Repository
findet. Sie war in Wahrheit das Handbuch für Entwicklung und KI-Assistenten, fast 600 Zeilen
Deutsch, mit einem Vorspann, der wie die alte Homepage jede Bedienungsänderung angesammelt hatte.

**Zwei Dateien, zwei Leser.** Die `README.md` ist jetzt der kurze englische Einstieg: was RAgents
ist, die sieben Kernfunktionen der Homepage in je einem Satz, Installation aus npm und Marketplace,
Loslegen, Verbinden mit einem zentralen Server, Bauen aus dem Quellcode, Links, Lizenz. Alles, was
vorher darunter stand (Begriffe, Journal, Aufbau, Ordner, Plugins, Profile, Konfiguration,
Entwickeln, die Regeln für KI-Assistenten), steht unverändert in `docs/development.md`; nur der
Vorspann mit den Bedienungsdetails ist weg, weil `docs/operations.md` sie schon hat. `AGENTS.md`
und `CLAUDE.md` zeigen dorthin. Die README ist damit keine Quelle für Regeln mehr, und das steht
auch dort.

**Deutsch entwerfen, übersetzen lassen.** Der englische Text ist nicht von Hand geschrieben:
Der deutsche Entwurf sollte von einem RAgents-Agenten mit GLM 5.3 übersetzt werden. Das
war zugleich der erste Gebrauch von `ragents run` für eine Schreibarbeit im eigenen Haus: der
Entwurf lag in einem Scratch-Ordner, der Run war mit `path` daran gebunden, das Modell kam über
`AGENT_MODEL`, `AGENT_COORDINATOR_MODEL` und `AGENT_MODELS` (als JSON-Array) aus der Umgebung,
und der Agent hat mit `read` und `write` genau eine Datei erzeugt. Nachgearbeitet wurden fünf
Wörter. Der deutsche Entwurf ist Arbeitsmaterial und liegt nicht im Repo; wer die README ändert,
schreibt wieder auf Deutsch und übersetzt auf demselben Weg.

**GitHub Pages aus dem Build.** `.github/workflows/homepage.yml` baut bei jedem Push auf `main`
die Agentenlaufzeit und die Homepage und veröffentlicht `docs/homepage/dist/` über
`actions/deploy-pages` unter https://schlenkr.github.io/RAgents/. Gebaut wird aus den Quellen,
nicht der eingecheckte `dist/`-Ordner hochgeladen, damit die Seite nie hinter dem Code liegt und
ein Fehler im Generator im Workflow auffällt statt auf der Seite. README, Handbuch,
Betriebsdokumentation und das `homepage`-Feld des npm-Pakets nennen diese Adresse. Einmalig
einzustellen bleibt in den Repository-Einstellungen unter Pages die Quelle "GitHub Actions"; bis
dahin scheitert der Deploy-Job mit genau diesem Hinweis.

## Das Paket baut sein Web selbst, und ein lokales Profil braucht keinen Checkout mehr (21.09.2026)

Kapitel: profiles (Produktprofile, Servergelieferte Profile), plugins (Profilverteilung),
operations (Ohne Checkout arbeiten, Nach Änderungen bauen, Als Agent bedienen, Run-Panel und
VS-Code-Erweiterung), `scripts/package/README.md`, `apps/vscode/README.md`. Der offizielle Weg
endete bisher an einer Stelle: wer `@schlenkr/ragents` und die Erweiterung installierte, konnte
damit nur Profile starten, die ein Server verteilt. Ein eigenes Profil mit eigenen Plugins
ging nur aus dem Checkout, weil das Web je Profil mit Vite
gebaut wird und Vite nur dort lag.

**Der Normalfall eines Entwicklers ist ein lokales Profil mit eigenen Plugins**, kein
servergeliefertes. Deshalb baut das Paket sein Web selbst, mit demselben Code, den der Checkout
ruft (`apps/server/src/web-build.ts`). Vite und die Abhängigkeiten des Web-Builds sind
Abhängigkeiten des Pakets; aufgelöst wird Vite ab `apps/web` des Host-Ordners - im Checkout aus
`apps/web/node_modules`, im Paket aus dessen eigenen. Es gibt damit keinen Zweig "Paket oder
Checkout", sondern einen Startweg mit einem Anker.

**Gebaut wird in den Datenordner, nicht ins Paket.** Das Ergebnis liegt unter
`<Datenordner>/web/<profil>/`, der Merkzettel daneben als `<profil>.json` mit Host-Ordner,
Profildatei und Host-Fassung; fehlt die `index.html` oder passt der Merkzettel nicht, wird gebaut,
sonst nicht. Das ist dieselbe Regel, die die Erweiterung vorher mit `ensureWebBuilt` und ihrem
globalen Zustand hatte, nur an der Stelle, an der auch der Datenordner liegt: ein Paketordner
gehört npm, und zwei Profile desselben Hosts dürfen sich nicht überschreiben. `scripts/start.sh`
nimmt denselben Weg und setzt `WEB_DIST_DIR` darauf; `apps/web/dist` bleibt für `pnpm build:web`.

**`ragents start` nimmt jetzt einen Pfad**, nicht nur einen Namen: ein Profil des Hosts (`core`,
`developer`), eine `ragents.config.<profil>.ts` an beliebiger Stelle oder einen geholten Stand.
Die Reihenfolge ist fest, der Dateiname trägt den Profilnamen, und der Start provisioniert,
baut und fährt hoch. `ragents run` bleibt ohne Web und sagt das in seiner Hilfe - ein Agent
braucht keine Oberfläche, und der Web-Build würde jeden Start um Sekunden verlängern.

**Die Erweiterung holt das Paket auch für ein lokales Profil.** Ohne `ragents.hostPath` und ohne
Checkout daneben installiert sie `@schlenkr/ragents` in der Fassung, die in ihrer eigenen
`package.json` unter `ragents.packageVersion` steht; ein Server nennt seine Fassung weiter selbst.
Die Regel "eine Entwicklerverbindung mit `profileFile` verlangt einen Checkout" fällt damit weg.
Das Feld wird beim Publish des Pakets mitgeschrieben, und der Publish der Erweiterung lehnt eine
Abweichung von der zuletzt veröffentlichten Paketfassung ab, damit beide nie auseinanderlaufen.

**Kosten.** Das Paket bringt `vite`, `@vitejs/plugin-react` und `@tailwindcss/vite` mit und dazu
die in `apps/web/package.json` deklarierten Web-Abhängigkeiten, weil die `web/`-Hälften fremder
Plugins gegen das Web des Hosts bauen und sich sonst an `dompurify` und seinesgleichen
verschlucken. Das Archiv wächst dabei kaum: 773 auf 780 Dateien, 4,20 auf 4,22 MB entpackt,
1,06 MB gepackt. Bezahlt wird in der Installation, die von 43 auf 47 direkte Abhängigkeiten und
damit von 244 auf 283 MB unter `node_modules` kommt. Dafür braucht kein Entwickler mehr pnpm, und ein erster Start kostet je
Profil einmal rund zwei bis zehn Sekunden Build. Die Hilfe (`/help`) bleibt aus dem Paketbuild
draußen: sie kommt aus `docs/homepage/dist` mit rund 12 MB, das Vielfache des ganzen Pakets.

## Die Panel-Übersicht ist eine Fläche mit Kacheln, die Umgebung heißt Umgebung, und ein Klick ist ein Klick (21.09.2026)

Kapitel: `docs/spec/plugins.md` (Web als Plugin-Host, Arbeitsspalte in der Erweiterung, Startauswahl),
`apps/vscode/README.md`. Entwurf A aus `docs/ui-drafts/panel-overview-2026-09-21.html`, überarbeitet
in `-v2.html`, mit den Änderungen des Owners. Die Karte je Ziel, die Chipreihe zum Filtern und die
Problemstreifen darüber sind weg.

**"Umgebung" statt "Ziel", überall wo es jemand liest.** Überschriften, Knöpfe, Fehlermeldungen,
Befehlstitel, die Einstellungserklärung und die README sagen Umgebung; im Code dürfen die Typen
`Target*` bleiben, weil ein Umbenennen des Vertrags nichts erklärt, was der Text nicht schon sagt.
Grund: "Ziel" hat in einer Werkstatt voller Runs und Aufträge eine zweite Bedeutung, "Umgebung"
nicht.

**Die Übersicht ist Entwurf A ohne Filter: Umgebungen, Runs, Startvorlagen auf einer Fläche.**
Die Umgebungen stehen als flache Zeilen mit Zustandspunkt; nur eine Umgebung mit Problem trägt
einen Knopf (Anmelden, Erneut versuchen, Starten, Verbinden), Trennen und Stoppen gehören in die
Einstellungen. Darunter die Runs aller Umgebungen als eine Liste nach Zeit, darunter die Vorlagen
als Kachelraster mit Suche und Kategoriegruppen. Grund: eine Fläche statt einer Karte je Umgebung
zeigt bei 420 Pixeln viermal so viel, und der Filter war eine Bedienung, die dieselbe Liste nur
kleiner gemacht hat.

**Kein `ListDetail` für die Kacheln.** Er misst sich seit dem 19.09.2026 selbst und würde bei
420 Pixeln zur Liste mit Detailseite; dann wäre jeder Start wieder zwei Klicks. Das Raster ist
`repeat(auto-fill, minmax(182px, 1fr))` - zwei Spalten bei 420, vier bei 900 -, Form und Ton
(Skill rund und `--primary`, Run-Script eckig und `--success`) kommen aus `ListDetail`, damit
beide Startflächen dieselbe Sprache sprechen.

**Die Umgebung steht als gedämpfte Zeile über dem Titel, dazu eine Farbkante.** Zur Wahl standen
Gruppen je Umgebung, eine reine Farbkante und ein Präfix im Titel. Gruppen hätten bei zwei
Umgebungen den ganzen Katalog zweimal erzählt und doppelt so viele Überschriften gekostet; ein
Präfix kostet Titelbreite genau dort, wo sie am knappsten ist; eine Farbe allein ist kein Name.
Die eigene Zeile kostet nichts vom Titel, bleibt lesbar und lässt die Struktur gleich, egal ob eine
oder fünf Umgebungen da sind. Die Farbe entsteht aus einem Hash des Namens, nicht aus der
Reihenfolge, damit sie beim Umsortieren steht. Bei genau einer Umgebung - dem Alltag mit
`core` - entfällt Zeile wie Kante, und der Abschnitt "Umgebungen" schrumpft auf seine eine Zeile.

**Ein Klick heißt ein Klick.** Eine Kachel legt den Run auf ihrer Umgebung an, startet ihn und
öffnet die Arbeitsspalte auf dem laufenden Run; ein Run-Script über `ragents.chat.start` mit dem
Startwert `null`, ein Skill über `ragents.chat.send` mit seinem vorbereiteten Auftrag. Die Kachel
"Neuer Run" öffnet einen leeren Run, dessen Auftrag im Chat der Spalte entsteht. Grund: der Weg
war Übersicht, Neuer Run, Neuer Run, Vorlage, Run - vier Klicks für etwas, das die Übersicht schon
vollständig beschrieben hatte.

**Damit entfällt die Startauswahl der Spalte im Panel-Fall.** `StartSurface` bleibt für den
Browser (`host !== "vscode"`); im Host `vscode` startet die Spalte den Einstieg selbst
(`RunLaunch`) und zeigt dabei nur einen Ladehinweis und, wenn es schiefgeht, den Grund. Ein
Leitfaden eines Run-Scripts wird dabei übergangen - `null` ist der dokumentierte Weg, seine
Vorgaben zu nehmen. Grund: zwei Startauswahlen hintereinander sind keine Auswahl, sondern eine
Rückfrage ohne Frage.

**Dialoge statt Inline-Formularen in den Einstellungen.** Die Seite ist eine Zeilenliste; "Neue
Umgebung" und "Bearbeiten" öffnen denselben Dialog, "Anmelden" einen zweiten, aus der Übersicht
wie aus den Einstellungen. Bearbeiten ist eine eigene Aktion (`updateServer`, `updateProfile`), die
den Eintrag an seiner Stelle in `ragents.connections` ersetzt; Entfernen und neu Anlegen hätte die
gespeicherten Anmeldedaten verloren. Grund: drei aufgeklappte Formulare untereinander waren auf
400 Pixeln länger als die Liste, um die es ging.

**`TargetEntry` trägt `kind` und `category`, ein Run-Script darf eine Kategorie nennen.** Die
Kachelgruppen brauchen eine Kategorie je Einstieg; Skills hatten sie, Run-Scripts nicht. Der
Serververtrag hat sie additiv bekommen (`category` in der `RUN.md`, optional), ohne Kategorie steht
ein Run-Script weiter unter "Run-Scripts" - in der Kachelansicht wie in `StartSurface`.

## Die Spalte bleibt im iframe und holt sich die Zwischenablage über die Hülle (21.09.2026)

Kapitel: `docs/spec/plugins.md` (Web als Plugin-Host, Arbeitsspalte in der Erweiterung),
`apps/vscode/README.md`. Der Owner diktiert mit Hex. Im Copilot-Chat und in der Weboberfläche im
Browser landete der Text, im Eingabefeld der Arbeitsspalte in der Erweiterung nicht, obwohl
Tippen dort geht.

**Die Ursache liegt nicht bei Hex und nicht bei den Bedienhilfen.** Hex schreibt den Text in die
Zwischenablage und schickt ein simuliertes Cmd+V (`Hex/Clients/PasteboardClient.swift`,
`pasteWithClipboard` und `postCmdV`); der Weg über die Bedienhilfen steht zwar als dritte
Strategie dahinter, wird aber nie erreicht, weil `postCmdV` blind `true` meldet. Auf macOS erzeugt
kein Programm den Einfügen-Befehl selbst: AppKit liefert ihn über das Menü der Anwendung. VS Code
hat dafür kein Menüfeld mit der Rolle `paste`, sondern fängt den Tastendruck im Webview ab
(`webview/browser/pre/index.html`, `handleInnerKeydown`) und schickt den Befehl danach als
`execCommand("paste")` an das Dokument des Webviews zurück. `execCommand` wirkt nur im eigenen
Dokument. Ein iframe fremder Herkunft bekommt es nie - weder den abgefangenen Tastendruck noch den
nachgelieferten Befehl. Gemessen in einer eigenen VS-Code-Instanz: dieselbe Textarea direkt im
Webview nimmt das Einfügen an, im verschachtelten iframe passiert nichts; mit dem Befehl, den
AppKit liefern würde, nimmt sie es auch dort an. Beides ist mit Hex bestätigt. Dasselbe gilt
für Kopieren und Ausschneiden, die damit ebenfalls tot waren.

**Die Behebung sitzt in der Hülle, nicht in einem Umbau.** Die Spalte führt die drei Befehle im
Host `vscode` selbst aus (`apps/web/src/column/clipboard.ts`): Kopieren und Ausschneiden kann sie
allein, weil sie aus einer echten Tastengeste heraus in die Zwischenablage schreiben darf. Lesen
darf sie nicht - `clipboard-read` ist in einem iframe fremder Herkunft verweigert, im Dokument des
Webviews dagegen erteilt. Die Hülle liest den Text deshalb für sie und schickt ihn zurück
(`clipboardRead`, `clipboardText`); die Erweiterung sieht davon nichts. Eingefügt wird mit
`execCommand("insertText")`, damit die Eingabe ein echtes `input`-Ereignis bekommt und React, die
Schreibmarke und das Rückgängigmachen stimmen.

**Damit entfällt Stufe 2.** Der Umbau der Spalte zu einem eigenen Bundle im Webview stand in der
TODO für genau diesen Fall. Er bleibt ungebaut, weil er den Befund nicht besser trägt als sechzig
Zeilen: die Spalte bündelt die Web-Teile der Plugins ihres Servers und wird je Profil gebaut, ein
Bundle in der Erweiterung könnte sie nicht enthalten. Sie müsste also weiter vom Server kommen,
nur ohne iframe - mit CORS für wechselnde `vscode-webview:`-Herkünfte, absoluter Basis-URL in
jedem Abruf, Asset-Auflösung zur Laufzeit und einer geöffneten CSP. Das ist ein Vielfaches an
Fläche für dasselbe Ergebnis. Das iframe bleibt auch für die Mini-App-Reiter, die dieselbe Hülle
benutzen und die Brücke mitbekommen.

## Sprachserver: eine Instanz je Run UND Wurzel statt je Run (21.09.2026)

Kapitel: `docs/spec/plugins.md` (Language-Server-Plugins). Bisher gab es je Run und Sprache genau
einen Sprachserver: ein zweites `roslyn_open` mit einer anderen Wurzel ersetzte den ersten
stillschweigend. Das ist genau die Art stiller Überraschung, die ein Agent nicht bemerkt - er
öffnet die zweite Solution, bekommt eine Erfolgsmeldung und fragt danach Diagnosen der ersten ab,
die es nicht mehr gibt. Und es passt nicht zu der Arbeit, um die es geht: ein Repository hat
häufig mehrere Solutions, und eine Änderung an der gemeinsamen Bibliothek will man in beiden
gleichzeitig prüfen, ohne zwischen ihnen hin und her zu laden.

Der Schlüssel ist deshalb Run plus Wurzel. `<id>_open` startet eine Instanz für genau diese
Wurzel, wenn es sie noch nicht gibt, und lässt die übrigen stehen; für dieselbe Wurzel bleibt der
Aufruf idempotent. Die Rückgabe nennt die Wurzel und die Zahl der offenen Instanzen, damit das
Modell ohne zweite Abfrage weiß, womit es arbeitet. Es gibt bewusst KEINEN Zweig "eine oder
mehrere": der Host hält `Map<runId + "\n" + root, ServerEntry>` plus die gemerkten Wurzeln je Run,
und jeder Pfad - Leerlauf, Fehlerzustand, Stopp, Shutdown - läuft über denselben Schlüssel.

Die Wahl der Instanz ist überall dieselbe Regel, nicht drei: das längste Wurzel-Präfix. Ohne
`paths` fragt die Diagnostik jede offene Instanz mit ihrem eigenen `git status -- .` in ihrer
Wurzel; mit `paths` beantwortet jede Datei die Instanz, deren Wurzel sie enthält; die Anmerkung
nach `edit`/`write` nimmt dieselbe Wahl und bleibt still, wenn keine Instanz passt. Eine Datei
außerhalb jeder offenen Wurzel ist ein benannter Fehler, der die offenen Wurzeln nennt, statt
still die falsche Instanz zu fragen. Dafür kennt jeder Adapter jetzt neben `resolveRoot` auch
`rootDirectory`: Roslyn und FSAC bekommen eine Projektdatei, TypeScript einen Ordner, und der
Host braucht für das Präfix den Ordner - eine Angabe des Adapters statt eines `stat` im Host.

Neu ist `<id>_close(root?)`, weil das Ersetzen als Aufräumweg weggefallen ist: eine Instanz
gezielt beenden, ohne `root` alle des Runs. Der Leerlauf von 20 Minuten gilt weiter je Instanz,
Run-Ende und Shutdown beenden alle. Der Schnappschuss des Diagnosereiters ist damit eine Liste
von Instanzen mit Wurzel, Zustand und Zusammenfassung statt eines einzelnen Zustands; der Zustand
`closed` entfällt, ein Run ohne Instanzen hat eine leere Liste. Der Reiter zeigt je Instanz eine
Karte, das Abzeichen zählt die Fehler aller Instanzen zusammen.

## Homepage: drei Stufen je Kernfunktion, verteiltes Arbeiten und die drei Zugänge als Kernfunktionen (21.09.2026)

Kapitel: `docs/spec/overview.md` (Produkt-Homepage), `docs/spec/core.md` und `docs/spec/plugins.md`
(Offene Grenzen), `docs/operations.md` (Guide-Marker `clients` und `distributed`, Run-Chat und
Arbeitsfläche, Runs wechseln), README (Für KI-Assistenten), `docs/homepage/index.html`,
`scripts/homepage/homepage-guide.ts`, neu `scripts/homepage/homepage-structure.ts`. Der Owner wollte
die Bauweise der Homepage festgehalten haben, die bisher nur gelebt wurde: ein Sticker im
Einstieg, ein Abschnitt auf der Hauptseite, ein Kapitel im Guide. Und er wollte zwei Dinge auf
diese Stufen heben, die auf der Seite bisher Nebensätze waren: den verteilten Betrieb (Host beim
Entwickler, Profil und Modelle vom Server, Werkzeuge beim Projekt, Run-Umzug) und die drei
Zugänge Web, VS Code und Konsole, deren Erweiterung und npm-Paket heute veröffentlicht wurden.

**Die Regel ist prüfbar, nicht nur beschrieben.** Ein Abschnitt trägt `data-core-feature`, ein
Sticker `data-sticker` mit dem Anker des Abschnitts. `assertHomepageStructure` verlangt beim
Erzeugen und Prüfen die Bijektion zwischen Stickern und Abschnitten, je Abschnitt einen Link auf
ein vorhandenes Guide-Kapitel und höchstens zwei Zeilen je Sticker. Ein Sticker ohne Abschnitt
oder eine Fähigkeit ohne Guide-Kapitel fällt damit im Build auf, nicht erst beim Lesen. Das war
die einfachste Form, in der die Regel mehr ist als ein Satz in der README, die Agenten wörtlich
nehmen oder übersehen.

**Der Arbeitsbereich geht im Abschnitt "Verteilt arbeiten" auf.** Der eine Vertrag für den
Run-Ordner ist genau der Mechanismus, der Verteilung möglich macht; ein eigener Sticker daneben
hätte dasselbe zweimal erzählt. Es bleiben sieben Sticker. Das Funktionsschema zeigt Server,
Host und Projektordner mit den drei Verbindungen Profil holen, Modellaufruf und Run umziehen.

**Die Hauptseite ist entschlackt.** Der Abschnitt zur Oberfläche hatte 1700 Wörter, davon zwei
Absätze Bedienungsprotokoll (Kopiersymbol, Scrollraum, Pixelbreiten, Checkbox Canvas); die
Regel 6 der README ("Homepage im selben Commit mitbringen") hatte Agenten dazu gebracht, jede
UI-Änderung dort anzuhängen. Was davon nicht schon in `docs/operations.md` stand, steht jetzt
dort (Run-Chat und Arbeitsfläche, Runs wechseln); die Hauptseite sagt je Fähigkeit einen Satz
und verweist in den Guide. Dasselbe für Mini-Apps, Journal, Start und Plugins. Regel 6 sagt das
jetzt ausdrücklich. Mit dem Rückbau des freien Canvas ist auch der letzte Satz verschwunden, der
ihn noch verneinte.

**Zwei Guide-Kapitel aus der Betriebsdokumentation.** `clients` übernimmt Arbeitsspalte und
Erweiterung (Bedienung, Installation, Anmeldung; nicht Veröffentlichung und Entwicklung), Als
Agent bedienen und Läufe von außen fahren. `distributed` übernimmt Ohne Checkout arbeiten (ohne
den Publish-Teil), Mit einem Server verbinden, Run umziehen und Unter Windows arbeiten. Dafür
sind die Beispielhosts in der Betriebsdokumentation neutral (`ragents.example.com`,
`/pfad/zum/projekt`), weil die Ausschlussregel private Namen und Pfade auf den öffentlichen
Seiten abweist. Die Kapitel stehen in der Guide-Gruppe Ausprobieren hinter Samples starten.

**Vier Konzeptdateien mit Status "Gebaut" sind aufgelöst**, wie es die README verlangt:
`docs/concepts/remote-profile.md`, `host-distribution.md`, `run-transfer.md` und
`workspace-tools-proxy.md`. Ihr Was steht in `profiles.md` (Servergelieferte Profile),
`plugins.md` (Modell-Relay, Profilverteilung, Arbeitsbereich, Provisionierung) und `core.md` (Run
auf einen anderen Server umziehen), ihr Warum in den Einträgen vom 19. bis 21.09.2026 hier. Was
in ihren Grenzen noch fehlte, steht jetzt in den Offenen Grenzen: Kontingente und zwei
Entwickler auf einem Rechner (Relay), Teilresultate bei Verbindungsverlust (Arbeitsplatz),
geholte Fassungen ohne Aufräumen (Erweiterung), kein gebautes Web für mitgelieferte Profile des
Pakets, sowie Host-Commit und `DOCUMENTS_DIR` beim Umzug. Ältere Einträge hier nennen die Dateien
weiterhin als damaligen Ort des Plans; das ist Chronik und bleibt.

## Die Arbeitsspalte bekommt eine dritte Ansicht "Nur Chat" (21.09.2026)

Kapitel: `docs/spec/plugins.md` (Arbeitsspalte, Offene Grenzen), `docs/operations.md`
(Arbeitsspalte und VS-Code-Erweiterung), `docs/homepage/index.html` (Oberfläche). Das Sheet
bleibt richtig, solange man die Mini-App im Blick behalten will: es gleitet hoch, wenn die Maus
darüber liegt, und wieder zurück. In der VS-Code-Erweiterung steht die Spalte aber stundenlang
daneben, und dort soll der Chat ruhig und angeheftet sein, ohne Rein- und Rausfahren. Statt
das Sheet dafür umzubauen, kommt eine dritte Ansicht dazu: "Nur Chat" neben "Chat unten" und
"Chat rechts", umgeschaltet über eine Segmentgruppe oben in der Spaltenkopfzeile, sichtbar
sobald eine Mini-App gewählt ist. Die Wahl liegt wie die übrigen Spaltenwerte je Run im
Browser; die früheren Werte `auto`, `floating` und `docked` bilden auf die heutigen ab, jeder
andere Wert ist ein harter Fehler.

In "Nur Chat" wird die Bühne abgebaut, nicht versteckt. Das ist die einfachere Regel: ein Zweig
weniger in der Sheet-Mechanik und kein unsichtbarer Frame, der weiterläuft. Der Preis steht in
der Spec, der flüchtige Zustand der Mini-App überlebt den Wechsel nicht; der journalisierte
Zustand kommt beim Zurückschalten von selbst wieder. In der Erweiterung ist das ohnehin die
naheliegende Kombination: die App als Editor-Reiter in der Mitte, die Spalte daneben nur als
Chat.

Dabei ist die Spec auf den Code gekommen: `closeDelay` steht bei 150 Millisekunden, nicht bei
450, und die 220 Millisekunden nach Fokusverlust standen bisher nirgends.

## Der freie Canvas ist zurückgebaut, es bleibt die Kachelfläche (21.09.2026)

Kapitel: `docs/spec/plugins.md` (Web als Plugin-Host, Offene Grenzen),
`docs/spec/actor-programs.md` (Werkzeugkarten und Kacheln, Kachel-Host und Funktionen-Reiter),
`docs/spec/typescript-platform.md`, `docs/spec/overview.md`, `docs/spec/core.md`,
`docs/spec/profiles.md`, `docs/operations.md` (Die Kachelfläche verwenden, Run-Chat und
Arbeitsfläche, Einstellungen), `README.md`, `docs/homepage/index.html` und der Wortlaut in
`docs/concepts/`. Gearbeitet wird nur noch mit der Kachelansicht. Die freie Fläche daneben war
der größte Einzelposten des Web-Codes: Kamera, eine eigene measure/arrange-Engine mit sieben
Layoutgruppen, Formen, Linien mit Labelabständen, Größenanfasser, Einklappen, Übersichtsmodus
und Pfeiltasten-Navigation, zusammen rund 3500 Zeilen Code und Tests. Für die tägliche Arbeit,
die in Kacheln und in der Arbeitsspalte stattfindet, hat davon nichts getragen. Also
einschmelzen statt ausbauen: die Arbeitsfläche eines Runs ist die Kachelfläche, es gibt keinen
Modus mehr, kein Pan, kein Zoom und keine Kamera.

Der Werkzeugvertrag wird dadurch schlank. `canvas_layout_replace` hat nur noch `root`, ersetzt
den Zustand vollständig und prüft Tiefe, Anzahl, eindeutige Teilnehmer und Gewichte an einer
Stelle. Der Run-Koordinator bekommt dafür einen eigenen kurzen Prompt, der globale gibt
Aufteilungswünsche nur noch weiter. Was ein Modell falsch machen kann, ist damit auf einen
Parameter zusammengeschrumpft.

Migriert wird nichts. Die persönliche Anordnung liegt unter einem neuen Browser-Schlüssel, die
alten Einträge verwaisen. Ein Programmzustand mit `nodes`, `shapes`, `lines` oder `mode` wird
beim Lesen abgewiesen und nennt die gefundenen Schlüssel; der Run läuft weiter mit der
abgeleiteten Startaufteilung, und ein einziger Werkzeugaufruf setzt ihn wieder gerade. Stille
Toleranz für Altzustände hätte die Prüfung wieder aufgeweicht, um einen Fall zu bedienen, den
es hier zweimal gibt.

Zwei Dinge fielen mit: Die Schichtwerk-Tiefe hatte nur auf den freien Karten einen Sinn, Kacheln
haben keine, also verschwinden die Tiefenstufen aus den Einstellungen und der Stil bleibt als
Optik - matte Flächen, gerade Konturen, 17 Pixel Radius, Kopfzeilen um vier Prozent abgedunkelt.
Und die drei Reference-Skills 120, 130 und 140 führten ausschließlich freie Layouts vor; sie
sind gelöscht, im Konzeptkatalog steht dafür das Konzept "Kachelfläche" mit zwei
Bedienbeispielen. Ein Skill-Einstieg, der das Layout-Werkzeug vorführt, fehlt und steht in
`TODO.md`.

## Der Executor löst den TypeScript-Server erst beim Aufruf auf, aus dem Host-Ordner (21.09.2026)

Kapitel: `docs/spec/plugins.md` (Language-Server-Plugins), `docs/concepts/workspace-tools-proxy.md`
(Randbedingungen). Die installierte `.vsix` blieb beim Aktivieren hängen: "Cannot find module
'typescript-language-server/lib/cli.mjs'". Der TypeScript-Adapter des Executors löste den
Sprachserver beim Laden des Moduls auf (`createRequire(import.meta.url).resolve(...)` als Konstante
in `packages/workspace-executor/src/language-server/adapters/typescript.ts`). Die `.vsix` wird
bewusst ohne `node_modules` gepackt, und das Bundle zieht den Executor beim Aktivieren mit; im
Checkout und im Host-Test fiel das nie auf, weil dort `node_modules` danebenliegen.

Zwei Regeln statt einer Ausnahme. Erstens: kein Modul des Executors löst beim Import etwas auf,
lädt etwas herunter oder sieht auf der Platte nach. Roslyn und FSAC machten es schon richtig, ihr
`serverPath()` läuft im `launch`; TypeScript tut es jetzt auch, und `typescript_open` scheitert
dort mit Ursache statt die ganze Erweiterung mitzureißen. Zweitens: woher der TypeScript-Server
kommt, ist ein Parameter, kein Zweig. Symmetrisch zum Werkzeugordner von Roslyn und FSAC trägt der
Kontext des Runs ein `hostRoot`, aus dem `createRequire(<hostRoot>/package.json)` auflöst. Den Wert
setzt jeder Aufrufer: der Server und `pnpm workspace-client` ihre eigene Wurzel (`hostRoot()`), die
Erweiterung `ragents.hostPath` oder den Host, den sie zuletzt gestartet hat (`ragents.lastHostPath`,
das geholte Paket unter `<globalStorage>/hosts/<fassung>/`). Kennt die Erweiterung noch keinen Host,
fehlt nur TypeScript; Übersicht, Einstellungen und Verbinden arbeiten.

Gefangen hätte das ein Test, den es nicht gab: `apps/vscode/tests/extension-bundle.test.ts` baut
`dist/extension.js`, kopiert es in einen leeren Temp-Ordner ohne `node_modules` und ruft dort in
einem Kindprozess `activate` mit einem Stub-`vscode` auf. Dazu nimmt der Host-Test in echtem VS Code
mit `RAGENTS_HOST_TEST_VSIX=<pfad>` die gepackte Datei statt des Checkouts: `launch.mjs` entpackt
sie und nimmt `extension/` als `--extensionDevelopmentPath`.

## Die VS-Code-Erweiterung geht über ein eigenes Skript in den Marketplace (21.09.2026)

Kapitel: operations (Arbeitsspalte und VS-Code-Erweiterung). Die Erweiterung war `private` und kam
nur als selbst gepackte `.vsix` auf einen Rechner. Sie geht als `schlenkr.ragents-vscode` in den
Marketplace, und der Weg dorthin ist `pnpm publish:vscode` nach demselben Muster wie
`publish:package`: der Token nur in der Umgebung des Kindprozesses (`VSCE_PAT` aus
`AZURE_DEVOPS_VSCE_RAGENTS_PAT`), jede Ausgabe durch eine Maske, jede Fehlermeldung eine Zeile,
nach dem Publish keine Rückfrage. Geprüft wird vor dem Bauen: `vsce verify-pat schlenkr` und
`vsce show schlenkr.ragents-vscode --json` gegen die Fassung, damit ein zweiter Lauf mit derselben
Fassung an der Prüfung scheitert und nicht am Marketplace. Nachtrag am selben Tag: Der Herausgeber
heißt `purestate`, nicht `schlenkr` - so ist er im Marketplace angelegt, und nur für ihn
läuft `vsce verify-pat` durch; die Erweiterung heißt damit `purestate.ragents-vscode`. Der
npm-Scope bleibt davon unberührt `@schlenkr`: Marketplace und npm sind getrennte Namensräume.

Die Fassung der Erweiterung bleibt eine eigene Zahl in `apps/vscode/package.json`; sie an die
`version` der Wurzel zu hängen hieße, das npm-Paket und die Erweiterung immer gemeinsam zu
veröffentlichen, obwohl sie unterschiedlich oft etwas Neues haben. Nachtrag am selben Tag:
Erhöht wird sie nicht mehr von Hand. `pnpm publish:vscode` fragt `vsce show` nach den
veröffentlichten Fassungen, zählt die letzte Stelle der höchsten hoch und schreibt sie vor dem
Packen in die `package.json` - ein Schritt statt zwei, und keine Veröffentlichung scheitert mehr
am vergessenen Erhöhen. Steht dort schon eine höhere Fassung als die veröffentlichte, gewinnt die
Datei; Handarbeit bleibt damit genau für Minor und Major. Der Probelauf nennt die Fassung und
schreibt nichts. Derselbe Weg gilt für das npm-Paket (siehe den Eintrag dazu), und der Task
`publish: all` macht beides nacheinander. `vsce` kommt
über `pnpm dlx @vscode/vsce@4.0.0` statt als devDependency: eine feste Fassung reicht für
Reproduzierbarkeit, und das Werkzeug gehört nicht in die Abhängigkeiten der Erweiterung, die ohne
`node_modules` gepackt wird.

`.vscodeignore` ist eine Positivliste (`**` und Ausnahmen), weil `vsce` Ausnahmen immer gewinnen
lässt: ein `!dist/**` holt auch die Sourcemap und den Testläufer wieder herein, deshalb stehen
`dist/extension.js` und `dist/webview/**` einzeln. Aus 14 Dateien und 3,2 MB werden so 12 und
1,2 MB. Die `LICENSE` nimmt `vsce` nur aus dem Ordner der Erweiterung; das Skript kopiert die der
Wurzel für den Lauf daneben und entfernt sie danach wieder, statt eine zweite Kopie im Repository
zu führen.

## PolyForm Shield 1.0.0 als Lizenz, Metadaten und README im npm-Paket (21.09.2026)

Kapitel: README (Lizenz), `docs/concepts/host-distribution.md` (Grenzen). Vor dem ersten echten
Publish von `@purestate/ragents` fehlten Lizenz, Metadaten und eine README fürs npm-Listing. Gewählt
ist die PolyForm Shield License 1.0.0; der Text steht wörtlich in `LICENSE`, darüber die von
PolyForm vorgesehene Zeile `Required Notice` mit dem Rechteinhaber.

**Warum Shield.** Die drei Dinge, die gelten sollen, sind genau die drei Dinge, die Shield sagt:
Ein Unternehmen darf RAgents benutzen und betreiben, auch kommerziell und auch für eigene Kunden
ohne Weiteres; es darf es ändern und weitergeben; es darf daraus kein Produkt und keinen Dienst
machen, das oder der RAgents Konkurrenz macht. Das trifft den Fall, um den es geht - jemand nimmt
den Host, hängt ein eigenes Profil daran und verkauft ihn als seine Werkstatt. Shield formuliert
diese Grenze eng am Wettbewerb und lässt alles andere frei; eine Klausel, die den Weiterverkauf
eigens verbietet, braucht es daneben nicht.

**Warum nicht FSL.** Die Functional Source License sagt dieselbe Wettbewerbsgrenze, lässt sie aber
nach zwei Jahren je Fassung in Apache 2.0 oder MIT fallen. Ein Ablauf ist eine Entscheidung über
eine Zukunft, die niemand kennt, und er macht die Lizenz erklärungsbedürftig: Jede Fassung hätte
ihr eigenes Datum. Ohne Ablauf bleibt die Aussage über alle Fassungen dieselbe.

**Warum nicht PolyForm Noncommercial.** Sie verbietet genau das, was erlaubt sein soll. Der
erwartete Benutzer ist ein Entwickler in einem Unternehmen, der RAgents auf Firmenrechnern
betreibt; das ist kommerzielle Nutzung und wäre unter Noncommercial ein Lizenzverstoß, obwohl es
niemandem Konkurrenz macht.

**Was ins Paket geht.** `build-package.ts` kopiert `LICENSE` und `scripts/package/README.md` an die
Wurzel des Pakets (dort als `README.md`, die Quelle erscheint nicht zusätzlich unter
`scripts/package/`) und schreibt `license: "PolyForm-Shield-1.0.0"` als SPDX-Kennung, `author`,
`repository`, `homepage`, `bugs` und `keywords` in die erzeugte `package.json`. Dieselben drei
Felder `license`, `author` und `repository` stehen in der Wurzel-`package.json` und in
`apps/vscode/package.json`; die Wurzel bleibt `private`, die Erweiterung nicht mehr (siehe den
Eintrag zum Marketplace). Die Paket-README ist englisch wie das Listing
und nennt Installation, die acht Unterbefehle mit je einem Beispiel, die Voraussetzungen und die
Lizenz; die Dokumentation selbst bleibt im Repository, das Paket verweist nur darauf.

## Vier Befehle für einen Agenten: `ragents run` wartet, `developer` wird ein Profil des Repos (21.09.2026)

Kapitel: profiles (Produktprofile), operations (Als Agent bedienen, Ohne Checkout arbeiten),
`docs/concepts/host-distribution.md`, README, `skills-for-agents/ragents/SKILL.md`. Ziel war,
dass ein fremder KI-Agent - etwa Claude Code - RAgents auf demselben Rechner startet und damit ein
Projekt programmieren lässt, in wenigen Befehlen und mit einer Anleitung, die er lädt.

**Warum eine eigene Befehlsfassade und nicht `pnpm driver`.** Der Treiber ist ein Testwerkzeug und
kein Client im Sinne dieser Architektur (Eintrag zum Remote-Betrieb vom 19.09.2026); er feuert und
kommt sofort zurück. Ein Agent braucht drei Dinge, die er nicht hat: **Warten** bis der Turn zu
Ende ist, **Buchhaltung** in Form eines Exit-Codes, und einen **stabilen Vertrag**, der wenig
Kontext kostet. Deshalb `ragents run`, `send`, `journal`, `stop` - vier Befehle, eine feste
Ausgabeform, die letzte Zeile immer `run: <id>`. Exit-Code `0` bei `turn.finished` mit
`outcome: "completed"`, `2` bei `turn.interrupted`, `1` bei einem gescheiterten Turn oder einem
Verbindungsproblem. Der Treiber bleibt unverändert das Testwerkzeug; die Journal-Auswertung teilen
sich beide über `scripts/agent/journal.ts`, und `run-driver.ts` ist darauf umgestellt.

**Bindung `path`, nicht `client`.** Der Server läuft auf demselben Rechner wie das Projekt, also
gibt es nichts zu proxyen: `ragents.startOptions.select` mit `{ kind: "path", path }` vor der
ersten Nachricht. Ein Arbeitsplatz-Client wäre ein zweiter Prozess, eine zweite Anmeldung und ein
Rundlauf ohne Gegenwert.

**Gewartet wird auf genau den eigenen Turn.** Die Nachricht landet als `actor.input.enqueued` mit
dem gesendeten Text als `content` im Journal; darüber findet der Befehl `inputId`, dann den
`turn.started` mit dieser `inputId` und schließlich dessen Ende. Das gilt für einen neuen Run wie
für einen Folgeauftrag und braucht keine Kenntnis des primären Actors. Gelesen wird das Journal
fortlaufend aus `<Datenordner>/runs/<runId>/journal.jsonl` ab dem letzten Byte-Offset, nicht über
`ragents.runs.events`: dieselbe Maschine, und ein Neuabruf des ganzen Journals bei jedem Ereignis
wäre bei großen Werkzeugausgaben quadratisch. Der Preis ist eine Latenz von 400 Millisekunden und
die Bindung an denselben Rechner - genau die Annahme, die auch die Bindung `path` trägt.

**Der Host wird gestartet, aber nie geraten.** `run` prüft `GET /health` wie
`scripts/start-vscode.sh`, startet sonst `apps/server/src/main.ts` losgelöst (`detached`,
Log unter `<Datenordner>/host.log`) und merkt Adresse und PID in `<Datenordner>/host.json`.
`ragents stop --host` beendet genau diese PID, nie ein Prozessmuster. Gestartet wird direkt der
Server und nicht `scripts/start.sh`, weil derselbe Weg im Paket und im Checkout gelten muss
(Entscheidung 7 in `host-distribution.md`); dafür baut dieser Host kein Web.

**`developer` wird ein Profil des Repositories.** Es lag als `selftest/ragents.config.developer.ts`
neben der Testhilfe, damit die Zusicherung über die Profile des öffentlichen Repos gilt
(20.09.2026). Ein Programmierprofil ist aber genauso neutral wie `core` und jetzt das Vorgabeprofil
der Agenten-Befehle; die Zusicherung in `start-script.test.ts` lautet deshalb
`["core", "developer"]`. Sein Schlüssel heißt `OPENROUTER_API_KEY`, weil `env(...)` bewusst
keinen Rückfall kennt - ein fehlender Wert ist
ein harter Startfehler mit Ursache, kein stiller zweiter Versuch. Beide Profile gehen ins Paket,
und `ragents start <profil>` fährt ein Profil des Hosts, bevor es im Cache geholter Stände sucht.
Ein Ad-hoc-Profil ist eine Kopie dieser Datei; einen Generator gibt es nicht, weil eine
Profildatei schon die einfachste Form ihrer selbst ist.

**Nachtrag 21.09.2026: dasselbe Profil für alle Befehle, samt Anmeldung.** Der Kernfall "starte
RAgents mit einem externen Profil und implementiere Work Item 1234" scheiterte an vier Stellen, die
alle dieselbe Ursache hatten: die Fassade kannte ein Profil nur als Namen neben dem Host.
`--profile` nimmt jetzt Namen **oder** Pfad und verwendet dafür dieselbe Funktion wie
`ragents start` (`localProfile` in `apps/server/src/profile-target.ts`, dazu `selectProfileTarget`
für Port und Datenordner); es gibt keinen zweiten Auflösungsweg mehr, und `RAGENTS_PROFILE` setzt
dasselbe für eine ganze Shell. Der Vermerk `host.json` wurde nach
`apps/server/src/host-record.ts` gezogen, weil ihn beide Startwege schreiben: `ragents run` für
seinen losgelösten Host und `ragents start` für seinen Vordergrundprozess (`noteHost` in
`scripts/remote/connect.ts`, beim Ende wieder weggeräumt). Damit trifft `stop --host --profile
<profil|pfad>` beide gleich; nur `--port 0` lässt sich nicht merken, weil der Port erst im Lauf
feststeht. `ragents --help` und `ragents help` zeigen die Verwendung mit Exit 0 - die
`.mjs`-Fassade filterte sie vorher als unbekannten Befehl weg -, ohne Argument bleibt Exit 1.

Die Anmeldung geht denselben Weg wie bei `connect`: ein Profil mit `users` verlangt in
`RAGENTS_TOKEN` den persönlichen Token des Benutzers, den das Profil als `token: env("...")`
nennt. Ein Anmeldedialog gehört in die Oberfläche, nicht in eine Fassade für Agenten, und ein
Passwort in einer Umgebungsvariablen wäre der schlechtere Tausch. Ein fehlendes `env` ist dabei
kein Startfehler mehr: ohne gesetzte Variable hat der Benutzer keinen Token und meldet sich
weiter mit seinem Passwort an - sonst könnte ein externes Profil auf einem anderen Rechner nicht starten,
auf dem `RAGENTS_TOKEN` fehlt. Bei `401` nennt die Fassade nicht die Serverantwort allein,
sondern den Weg: "Das Profil verlangt eine Anmeldung; setze RAGENTS_TOKEN auf den persönlichen
Token deines Benutzers".

Zwei Dinge fielen beim echten Durchlauf mit einem externen Profil auf und sind mitgelöst. Ein Profil
ohne `ragents.workspace` kennt die Startoption `ragents.workspace.binding` nicht; `run` fragt
deshalb erst `ragents.startOptions.list` und bindet nur, wenn es die Option gibt - sonst sagt es
auf stderr, dass der Ordner ungebunden bleibt, statt den Run gar nicht anzulegen. Und ein
Run-Script bestimmt seinen Chatpartner erst im Lauf (`run_configure` mit `primaryActor`); bis
dahin lehnt der Server die erste Nachricht mit `actor-chat-unsupported` ab. `run --entry` wartet
darauf, statt daran zu scheitern - eine Minute lang, im selben Takt wie das Journal.

## Die Erweiterung kennt keine aktive Verbindung mehr: alle Ziele gleichzeitig, eine Übersicht davor (21.09.2026)

Kapitel: plugins (Web als Plugin-Host), operations (Arbeitsspalte und VS-Code-Erweiterung),
`apps/vscode/README.md`. Gewünscht war es nicht mehr stufig: Server wählen, anmelden, dann Runs.
Statt dessen eine Einstellungsseite für Server und lokale Profile und davor eine zusammengeführte
Übersicht, wo was läuft, über alle Ziele hinweg, mit dem neuen Run von dort aus.

**Alle konfigurierten Ziele gleichzeitig.** `extension.ts` hält eine Map Ziel zu Sitzung statt
einer Sitzung; jeder Servereintrag verbindet sich beim Aktivieren von selbst, jede Sitzung hat
ihre Verbindung, ihren Store, ihren Arbeitsplatz-Client und, bei einem lokalen Profil, ihren Host
(`src/sessions.ts`). Ein Ziel, das eine Anmeldung verlangt oder nicht antwortet, ändert nur seinen
eigenen Zustand; die anderen arbeiten weiter. Damit fallen `ragents.chooseConnection`, die aktive
Verbindung im globalen Zustand und die Statusleiste "aktive Verbindung" weg - sie zählt jetzt die
verbundenen Ziele und öffnet mit einem Klick die Übersicht. Der Arbeitsplatz-Client dieses Fensters
meldet sich mit derselben Kennung bei jedem verbundenen Server an; die Bindung `client` bleibt der
Weg für neue Runs, egal auf welchem Ziel.

**Lokale Profile bei Bedarf.** Ein Eintrag mit `profileFile` steht als "nicht gestartet" in der
Übersicht; der Host startet erst, wenn dort ein Run angelegt wird oder jemand "Starten" wählt, und
läuft bis zum Ende der VS-Code-Sitzung oder bis "Stoppen". Seine Startvorlagen kommen erst nach
dem Start: ein Einstieg entsteht mit den registrierten Plugins, nicht aus der Profildatei. Offline
ließen sich zwar `skills/` und `run-scripts/` der Pluginordner lesen, aber das wäre eine zweite,
unvollständige Quelle - die im Code registrierten Einstiege fehlten - und bräuchte gesetzte
`PRODUCT_*`-Variablen, nur um eine Liste zu zeigen. Eine Quelle ist besser als eine halbe.

**Die Übersicht ist die Aggregation, kein weiterer Schritt.** Ohne gewählten Run zeigt das Panel
je Ziel eine Karte mit Zustand, seinen Runs, "Neuer Run" und seinen Startvorlagen; eine Vorlage
öffnet die Startauswahl gleich mit diesem Einstieg (`newRun` trägt dafür eine `entryId`, und
`StartSurface` nimmt sie jetzt für Skills wie für Run-Scripts an). Die Einstellungsseite daneben
legt Server **und** lokale Profile an, entfernt sie und hält die Anmeldedaten je Server; bisher
ging `profileFile` nur über die `settings.json`. Beide Seiten sind ein Einstieg der Web-App
(`panel.html`, `apps/web/src/panel/`, gebaut mit `pnpm build:panel`), der ohne Server läuft; er
löst die Verbindungsseite ab. Die Arbeitsspalte bleibt, was sie war: der Run läuft weiter im
iframe seines eigenen Servers, mit dessen Web und dessen Token.

**Nicht `ListDetail`.** Die Startauswahl benutzt ihn zu Recht, aber im Panel ist die Fläche rund
400 Pixel breit; dort wird er zur Liste mit Detailseite, und jeder Run bräuchte zwei Klicks statt
einem. Die Übersicht ist deshalb eine Karte je Ziel aus denselben UI-Bausteinen (`Card`, `Button`,
`Input`), und die Vorlagen stehen aufklappbar darunter.

**Befehle verteilen sich.** `ragents.newRun` fragt in einem QuickPick nach Ziel und Vorlage, nach
Zielen gruppiert; `Run stoppen`, `Abmelden`, `Trennen` und `Verbinden` nehmen das Ziel des
gewählten Runs, sonst das einzige passende, sonst fragen sie. Die Entscheidung darüber ist eine
reine Funktion (`resolveTarget`, `newRunChoices` in `src/overview-model.ts`), damit sie ohne VS
Code prüfbar ist; dasselbe gilt für die Übersicht selbst und für den Explorer, der die Ziele als
Gruppen mit ihren Runs zeigt. Der Host-Test hat einen dritten Pfad bekommen: zwei Server
gleichzeitig, ein neuer Run mit Bindung `client` auf dem zweiten und ein Trennen, das nur eines
der beiden trifft.

Dabei aufgefallen: `typescript_diagnostics` ohne `paths` prüft die laut Git geänderten Dateien.
Seit `selftest/workspace-project` eingecheckt ist, taucht das absichtlich fehlerhafte
`src/broken.ts` dort nicht mehr auf; der Host-Test prüft jetzt die Datei, die der Lauf selbst
geändert hat.

## Das Paket heißt `@purestate/ragents`, eine Quelle für die Fassung, und die Erweiterung holt es selbst (21.09.2026)

Kapitel: profiles (Servergelieferte Profile), plugins (Profilverteilung), operations (Ohne
Checkout arbeiten, Mit einem Server verbinden, Arbeitsspalte und VS-Code-Erweiterung),
`apps/vscode/README.md`; Konzept `docs/concepts/host-distribution.md`. Das Paket vom 20.09.2026
war gebaut, aber unveröffentlicht: Name, Fassungsschema und der Weg zum Benutzer standen noch
offen. Jetzt geht es öffentlich auf npm.

**Der Name `ragents` ist vergeben**, also bekommt das Paket den Scope des Absenders:
`@purestate/ragents`. Der Befehl heißt weiter `ragents` - der `bin`-Eintrag hängt nicht am
Paketnamen, und im `PATH` ist der kurze Name der richtige. Ein Paket mit Scope ist bei npm
standardmäßig privat, deshalb trägt das erzeugte Manifest `publishConfig.access: "public"`; das
steht im Paket statt in der Kommandozeile, weil sonst ein vergessenes `--access` eine private
Veröffentlichung wäre. Nachtrag am selben Tag: Der Scope ist `@schlenkr`, nicht `@purestate` - die
Organisation `purestate` gibt es auf npm nicht, und der Benutzer-Scope ist der, den der Token
ohnehin schreiben darf; das Paket heißt damit `@schlenkr/ragents`.

**Eine Quelle für die Fassung**: das Feld `version` in der `package.json` der Wurzel. Der Build
übernimmt sie, der verteilende Server nennt sie (`packageVersion` in `ragents.profile.describe`),
und erhöht wird sie von Hand, eine Zeile. Kein automatischer Bump: ob eine Änderung eine neue
Fassung wert ist, weiß nur ein Mensch. Nachtrag am selben Tag: Das Veröffentlichen ist ein Schritt
geworden, und dazu gehört die Fassung. `pnpm publish:package` fragt `npm view` nach den
veröffentlichten Fassungen, zählt die letzte Stelle der höchsten hoch und schreibt sie vor dem
Bauen in die `package.json` der Wurzel - der Mensch entscheidet mit dem Aufruf, dass es eine neue
Fassung gibt, und muss die Zeile nicht auch noch selbst ändern; vergessenes Erhöhen und der
Abbruch daran fallen weg. Steht in der Datei schon eine höhere Fassung als die veröffentlichte,
gewinnt die Datei: Minor und Major bleiben Handarbeit, die letzte Stelle nicht. Geschrieben wird
nur die Zeile mit `version`, der Probelauf rechnet die Fassung nur aus. Die Wahrheit über den genauen Stand bleibt der Commit in
`ragents.hostVersion`; die Fassung ist das, was ein Entwickler installiert. Genau dafür nennt der
Server sie: `connect` sagt bei Abweichung nicht mehr "hol die passende Fassung", sondern
`npm install -g @purestate/ragents@<fassung>`. `pnpm publish:package` baut, prüft und
veröffentlicht; es lehnt eine Fassung ab, die auf npm schon liegt, und nennt die Zeile, die zu
ändern ist. Der Token kommt aus `npm_key` und geht nur als Registrierungsschlüssel in die
Umgebung des `npm`-Kindprozesses - nicht auf die Kommandozeile, nicht in eine Datei, und jede
Ausgabe von npm läuft durch eine Maske.

**Die Erweiterung holt den Host selbst.** Eine veröffentlichte `.vsix` läuft aus keinem Checkout
und wäre ohne Host nutzlos. Ist `ragents.hostPath` leer und liegt neben der Erweiterung kein
Host, installiert sie das Paket in ihren eigenen Speicher
(`<globalStorage>/hosts/<paketfassung>`, ein Ordner je Fassung) - in der Fassung, die der Server
nennt, mit dem `npm` aus dem `PATH`. Danach ist es derselbe Start wie immer: Der Startcode sieht
nur einen anderen `hostPath`, es gibt keinen zweiten Weg. Ohne Server weiß niemand, welche
Fassung richtig wäre; eine Entwicklerverbindung mit `profileFile` bleibt deshalb auf einen
Checkout angewiesen, und das steht als Grenze. Geholte Fassungen bleiben liegen: Aufräumen
bräuchte die Frage, welcher Stand noch in Benutzung ist, und die stellt sich erst, wenn es mehr
als eine Handvoll sind.

## Der Host wird ein npm-Paket: nur Node beim Entwickler, das Web baut der Server (20.09.2026)

Kapitel: profiles (Servergelieferte Profile), plugins (Profilverteilung, Offene Grenzen),
operations (Ohne Checkout arbeiten, Mit einem Server verbinden, Nach Änderungen bauen, Unter
Windows arbeiten), `apps/vscode/README.md`; Konzept `docs/concepts/host-distribution.md`.
Paket 9 aus `remote-profile.md` war die letzte offene Zeile dort: ein Entwickler sollte nur noch
Node brauchen. Bisher verlangte `connect` einen Git-Checkout auf genau dem Commit des Servers,
mit pnpm, `pnpm install`, `pnpm build:agent` und einem Web-Build je Profil.

**Das Paket hat die Form des Repositories.** `apps/server/src`, `apps/web/src`, `packages/*/src`,
`plugins/*`, `scripts/*` - dieselben Ordner an denselben Stellen. Der Host rechnet an vielen
Stellen von seiner eigenen Datei in die Wurzel (`hostRoot`, `pluginsRoot`, `WEB_DIST_DIR`, die
`createRequire`-Anker der Actor-Programme); behält das Paket die Form, bleibt jeder dieser Pfade
richtig und es gibt keinen zweiten Fall im Code. Was das Paket ausmacht, ist allein seine
Auswahl: keine Tests, keine Dokumentation, keine Erweiterung, kein `node_modules`.

**Gebaut heißt ausgewählt, nicht übersetzt.** Der Server lädt zur Laufzeit `.ts`: die
Profildatei, jedes Plugin, die Plugins aus dem Archiv des Servers, den Compiler-Worker. Ein
Bundle müsste diese Regel aufgeben; das Paket bringt statt dessen `tsx` mit und startet wie der
Checkout mit `node --import tsx apps/server/src/main.ts`. Profile bleiben `.ts` und werden nicht
vorkompiliert. Zwei Dinge musste das kosten: Der Resolve-Hook `host-resolution-hooks` ist jetzt
JavaScript, weil Node ihn im Loader-Thread lädt und dort unter `node_modules` keine Typen
entfernt; und der geholte Profilstand bekommt eine `package.json` mit `type: "module"`, weil
Node eine `.ts`-Datei ohne diese Marke als CommonJS liest und dann weder der Hook noch die
`@aicontainer/*`-Verknüpfungen greifen. Beides ist im Checkout wie im Paket dieselbe Regel.

**Das Web kommt vom Server, je Profil.** Ein Web-Build hängt am Pluginsatz des Profils, und
Plugins aus dem Archiv bringen eigene `web/`-Teile mit. Deshalb baut der verteilende Server das
Web seines Client-Profils selbst und legt es unter `web/` ins Archiv; `connect` setzt
`WEB_DIST_DIR` darauf. Der Stand des Archivs deckt damit auch das Web ab. Die Pluginliste für
diesen Build kommt aus derselben Prüfung, die das Archiv packt (`PLUGIN_LIST_FILE`), nicht aus
einem zweiten Laden der Profildatei: deren `env(...)` sind auf dem Server nicht gesetzt. Der
Preis steht als Grenze: ein verteilender Server braucht Vite und baut bei jedem Start einmal.

**Der Host-Commit-Abgleich wird der Abgleich der Paketfassung.** Das Paket trägt den Commit, aus
dem es gebaut wurde, in seiner eigenen `package.json` (`ragents.hostVersion`); `readHostVersion`
liest ihn dort und sonst aus `.git`. Die Prüfung bleibt dieselbe und bleibt hart, nur der Rat
unterscheidet sich: `git checkout` für den Checkout, "hol die passende Fassung" für das Paket.

**Ein `bin` mit vier Unterbefehlen** (`connect`, `start`, `provision`, `workspace-client`), weil
vier Namen im `PATH` vier Wege wären. Jeder startet dieselbe Datei, die auch `pnpm connect`,
`pnpm provision` und `pnpm workspace-client` starten; `ragents start <profil>` fährt einen schon
geholten Stand ohne Rückfrage beim Server hoch, den `connect` als `current.json` notiert hat.
Damit fällt pnpm aus dem Startweg: `connect` ruft Provisionierung und Server als
`node --import tsx <skript>`, und der Web-Build entfällt ganz.

**Die Erweiterung unterscheidet Paket und Checkout nicht.** `ragents.hostPath` zeigt auf beides,
Merkmal ist `package.json` neben `apps/server/src/main.ts`, der Startbefehl ist derselbe. Nur
eine Entwicklerverbindung mit `profileFile` baut noch ein Web, weil dort kein Server eines
liefert; das ist der Checkout-Weg und bleibt es.

**Die Abhängigkeiten bestimmt der Build aus dem Code**, nicht aus einer gepflegten Liste: aus den
Importen der aufgenommenen Dateien (auch `require.resolve` und `@import` der CSS-Dateien) plus
den Bibliotheken, die die Actor-Programme zur Laufzeit in ihren Arbeitsbereich verlinken
(`runtimeLibraries`, jetzt eine eigene Datei, damit Plugin und Build dieselbe Wahrheit lesen).
Jede Fassung wird auf die im Checkout installierte festgenagelt; ein Name ohne Fassung bricht den
Build ab. Der Checkout hält einzelne Pakete in zwei Fassungen nebeneinander (`typebox`,
`@types/node`), das Paket nennt eine davon und der Build sagt, welche - das steht als Grenze.

## Ein Run zieht als Archiv um: gleiche Host-Version, gleiche Kennung, Wiedergabe wie nach einem Neustart (20.09.2026)

Kapitel: core (Run auf einen anderen Server umziehen, Offene Grenzen), operations (Run umziehen,
Datenablage); Konzept `docs/concepts/run-transfer.md`. Der Punkt "Run-Umzug zwischen Servern"
stand als Später-Zeile in `remote-profile.md` mit drei offenen Fragen. Sie sind jetzt
entschieden, und zwar jede in Richtung der einfachsten Lösung, die trägt.

Ein Run ist sein Journal plus die Dateien, die das Journal nicht enthält, und beides liegt schon
heute an genau zwei Orten: `runs/<id>` und `sessions/<id>`. Der Umzug packt diese zwei Ordner und
ein Manifest in ein `tar.gz`; mehr Wissen über den Inhalt braucht er nicht. Damit ziehen
Modellkontexte, Actor-Programme, die Dateiablage von `ragents.documents` und das
Arbeitsverzeichnis der Bindung `fresh` ohne eigene Regel mit, weil sie alle unter
`sessions/<id>/plugins/<plugin-id>/` liegen. Auf dem Ziel gibt `Journal.adopt` die Records ein
und schreibt die Payloads aus den gelesenen Inhalten neu; danach löst der Server den
Arbeitsbereich auf und öffnet die Session - dieselben Schritte, die sein Start für jeden Run
geht. Es gibt keinen zweiten Ladepfad, der veralten könnte.

**Absolute Pfade im Journal** bleiben stehen. Das Journal ist unveränderlich, und die Pfade in
`tool.call.*` sind Historie: die Wiedergabe ruft weder Modelle noch Werkzeuge erneut auf, also
löst sie niemand erneut auf. Neu aufgelöst wird allein der Arbeitsbereich, und der kommt aus der
Session-Ablage des Ziels, nicht aus dem Journal. Der Preis steht als Grenze im Kapitel: das
Modell sieht in seinem Kontext weiterhin die Pfade der Quelle und scheitert an der
Arbeitsbereichsgrenze, wenn es sie wieder aufgreift; relative Pfade und der je Turn neu gebaute
Systemprompt tragen.

**Die Bindung `path`** hat auf dem Ziel keinen Ordner. Der Import lehnt sie ab, es sei denn, der
Aufrufer nennt einen Ersatzordner; dann hängt er ein neues `plugin.state-replaced` mit der neuen
Bindung ans Journal, statt ein altes Ereignis umzuschreiben. Die Startoption wird ohnehin als
Plugin-Zustand gespeichert, also ist das kein Sonderweg, sondern derselbe Weg noch einmal.
`fresh` zieht mit seinem Serverordner um, `client` bleibt `client`. Der Server kennt die Bindung
nicht selbst: `WorkspaceRuntime` hat dafür die Fassette `transfer` mit `boundDirectory`,
`assertDirectory` und `rebind` bekommen, die das Plugin `ragents.workspace` beantwortet.

**Die Artefaktablage** brauchte keine eigene Entscheidung mehr, sobald die ganze Session-Ablage
mitzieht. Eine Ablage, die ein Profil mit `DOCUMENTS_DIR` bewusst nach außen legt, bleibt
zurück; das steht als Grenze.

Dazu vier Festlegungen, die Schaden verhindern. Das Manifest trägt Host-Commit und
Executor-Version, und das Ziel lehnt bei Abweichung ab - ohne Zwang-Schalter, weil ein Journal
aus einer anderen Version kein Fall für "wird schon gutgehen" ist. Der Run behält seine Kennung,
und eine belegte Kennung bricht den Import ab, bevor etwas angelegt wird; zwei Runs mit derselben
Kennung gibt es nie. Der Export verlangt einen ruhenden Run, weil ein Archiv mitten im Turn ein
Schnappschuss halber Schreibvorgänge wäre. Und der Export kopiert: die Quelle bleibt liegen, weil
ein Export, der gleich abräumt, bei einem gescheiterten Import Arbeit vernichtet - wer den Run
dort nicht mehr braucht, löscht ihn ausdrücklich.

Der Weg sind zwei Operationen der Nachrichtenschicht (`ragents.runs.export` mit `runs.read` und
`runs.inspect`, weil das Archiv Modellkontexte enthält; `ragents.runs.import` mit `runs.read`,
`runs.write` und `runs.create`) und das Skript `scripts/run-transfer/`. Keine Oberfläche:
solange es einen Benutzer gibt, ist die Kommandozeile die ehrliche Fassung. Das Archiv geht als
Base64 durch JSON und ist deshalb auf 16 MiB begrenzt, ein Drittel unter der Body-Grenze von
32 MB; die Grenze ist ein harter Fehler mit Größe und Zahl, kein stilles Kürzen.

## Die Erweiterung in echtem VS Code geprüft: kein `flush`, Verbinden von selbst, Registry ohne Leichen (20.09.2026)

Kapitel: plugins (Arbeitsbereich, Arbeitsplatz-Registry), operations (Arbeitsspalte und
VS-Code-Erweiterung), `apps/vscode/README.md`; Konzept `docs/concepts/workspace-tools-proxy.md`.
Ein Lauf der Erweiterung mit Bindung `client` in echtem VS Code hat drei Dinge gezeigt.

Erstens brauchte `ragents.chat.stop` über die eigene Verbindung der Erweiterung 15 Sekunden und
endete an der Zeitgrenze des Plugin-Stopps, während derselbe Stopp über eine fremde Verbindung
839 ms brauchte. Der Arbeitsplatz wartete am Ende jedes Auftrags auf `transport.flush()`, also
auf alle laufenden POSTs seiner Verbindung - darunter der `chat.stop`-POST, den der Server erst
beantworten kann, wenn die Antwort des Arbeitsplatzes da ist. Zirkuläres Warten. `flush` ist
ersatzlos gestrichen, weil die Reihenfolge schon in der Nachrichtenschicht sitzt: `RpcClient`
reiht Benachrichtigungen und Antworten über `#outgoing` hintereinander, ein Fortschritt geht also
ohnehin vor seinem Ergebnis raus. Eine Variante, die nur Benachrichtigungen und Antworten zählt,
wäre dieselbe Zusicherung ein zweites Mal gewesen.

Zweitens verband sich die Erweiterung im frischen Benutzerordner nicht, obwohl genau eine
Verbindung konfiguriert war: sie öffnete nur die gemerkte aktive. Die Entscheidung vom 19.09.2026
("Mit genau einer konfigurierten Verbindung verbindet die Erweiterung sich von selbst") gilt und
ist jetzt umgesetzt - `initialConnection` nimmt die einzige konfigurierte Verbindung, sonst die
zuletzt aktive. Damit fällt im Host-Test der Ausweg über `connectTo` weg.

Drittens sammelte die Registry verwaiste Arbeitsplätze: jede beendete Erweiterungsinstanz blieb
als `connected: false` stehen und stand in der Bindungsauswahl. Ein getrennter Arbeitsplatz
verlässt die Registry jetzt ganz, und `WorkspaceClientInfo` verliert das Feld `connected`. Nichts
braucht den toten Eintrag: ein Run trägt Kennung und Label in seiner Bindung, die Auswahl im Web
zeigt einen gebundenen, fehlenden Arbeitsplatz weiterhin als "(nicht verbunden)", und
`executorFor` meldet bei fehlendem Eintrag dieselbe Ursache "Der Arbeitsplatz <label> ist nicht
verbunden" wie vorher. Die Wiederanmeldung legt den Eintrag ohnehin neu an. Nachtrag desselben
Tages: weil der Arbeitsplatz beim Abmelden zuerst seine Handler freigibt und der Server die
Trennung damit vor der Abmeldung sehen kann, ist `ragents.workspace.clients.unregister` jetzt
idempotent - ein unbekannter Arbeitsplatz liefert `null`, nur ein fremder bleibt 403.

## Das Relay nennt nur den Alias, Titel ohne Titelmodell blockieren keinen Start (20.09.2026)

Kapitel: plugins (Modell-Relay, Offene Grenzen), profiles (Modellanbieter, Modell für
automatische Überschriften), operations (Mit einem Server verbinden). Der Relay-Lauf mit zwei
lokalen Servern hat zwei Produktfehler gezeigt.

Erstens startete ein Client-Profil mit `COMPACTION_PROVIDER: "relay"` und leerem
`COMPACTION_MODEL` nicht, sobald der Aliaskatalog kein Textmodell mit der Denkstufe `off`
enthielt: `TitleSettingsStore.create` warf bei leerem Katalog, obwohl eine leere Vorgabe die
Titelerzeugung ausschaltet. Die Prüfung ist ersatzlos gestrichen, weil sie ohnehin doppelt war:
Eine Vorgabe oder ein gespeicherter Stand, der kein Modell des Katalogs nennt, scheitert
weiterhin an der Validierung der Auswahl. Bleibt der Katalog leer und nennt niemand ein Modell,
ist die Auswahl `null`, es entstehen keine Titel, und die Einstellungen sagen, dass der Anbieter
kein Modell für Überschriften anbietet.

Zweitens trug die Antwort des Anbieters ihr eigenes `model`-Feld, das die Agentenlaufzeit als
`responseModel` in den Modellkontext des Entwicklers schreibt - also genau das Geheimnis, das
der Alias verbergen soll. Das Relay ersetzt jetzt auf dem Rückweg in jedem SSE-Block und in der
nicht gestreamten Antwort `model` durch den Alias und entfernt `provider`, weil dieses Feld den
Anbieter beim Namen nennt. Je Feld entschieden: `id` und `system_fingerprint` bleiben, weil sie
weder Modell noch Anbieter nennen und der Client die Kennung zum Zuordnen braucht; alles andere,
auch ein Fehlertext des Anbieters, geht unverändert weiter. Dazu leitet der Relay-Provider einen
abgelehnten Modellaufruf mit seiner Adresse ein ("Relay <adresse> (401): ..."), sonst stand im
Journal des Entwicklers nur der nackte Text des Relays ohne Quelle.

Nachtrag zu "Remote-Betrieb gebaut" (19.09.2026), Punkt 7: Der Satz "das Relay liest den Strom
nur mit, verändert nichts" gilt so nicht mehr. Er bleibt in der Absicht richtig - kein Parsen der
Modellantwort, keine eigene Streaming-Logik, kein Puffern der Ausgabe - aber die beiden Felder,
die das Geheimnis verraten, ersetzt beziehungsweise entfernt das Relay zeilenweise im selben
Durchlauf, der `usage` mitliest.

## Provisionierung je Plugin statt install.sh (20.09.2026)

Kapitel: plugins (Provisionierung je Plugin, Self-contained Plugin-Ordner, Plugin-Ordner an
beliebiger Stelle, Language-Server-Plugins, Profilverteilung, Offene Grenzen), profiles
(Datenablage, `provisioned(...)`, Servergelieferte Profile, Offene Grenzen), operations (Lokal
installieren, Browserprüfung, Mit einem Server verbinden, Session-Isolation), README; Paket 6 aus
`docs/concepts/remote-profile.md`. Bisher brachte ein Plugin seine Abhängigkeiten als `install.sh`
mit, eingesammelt von `scripts/install-plugin-dependencies.sh`, und ein Profil trug danach einen
absoluten Rechnerpfad auf den Language Server. Das lief nur mit Bash, kannte nur die Repo-Plugins,
sagte nie, ob etwas fehlt, und `pnpm connect` richtete auf einem fremden Rechner gar nichts ein.

Festgelegt: (1) Ein Plugin, das Werkzeuge braucht, bringt eine `provision.ts` mit `check(target)`
und `apply(target, log)` mit. `check` liefert `ready` oder eine benannte Lücke mit Anweisung und
der Angabe, ob `apply` sie schließen kann; `apply` beginnt selbst mit `check` und tut bei `ready`
nichts. Damit ist Idempotenz eine Eigenschaft des Vertrags und nicht der Disziplin des Aufrufers.
(2) `target` ist `<Datenordner>/tools/<plugin-id>/`, hängt also am Datenordner des Hosts und nicht
am Repository; zwei Profile auf einem Rechner haben zwei Werkzeugordner, und das ist der Preis
dafür, dass ein Profil sein Werkzeug pinnen darf. Eine `provisioned.json` neben den Dateien hält
die gepinnte Fassung; ein Fassungswechsel ist wieder eine Lücke. (3) Alles ist reiner Node-Code:
Roslyn und fsautocomplete lädt `fetch` als NuGet-Paket, ein kleiner ZIP-Leser im Host
(`plugin-support/zip.ts`) packt sie aus. Statt `dotnet tool install` wählt die Provisionierung von
FSAC den Ordner der höchsten .NET-Laufzeit, die `dotnet --list-runtimes` meldet, und der Adapter
startet die `.dll` über `dotnet`; damit braucht kein Provisionierungsschritt eine Shell.
(4) Fehlendes `dotnet` und ein `BROWSER_EXECUTABLE_PATH` ins Leere sind Lücken, die `apply` nicht
schließen darf; Chromium dagegen holt `ragents.browser` über die gepinnte `playwright-core`-CLI in
deren eigenen Cache, weil Playwright seinen Browsercache selbst verwaltet. (5) Ein Profil nennt
eine provisionierte Datei mit `provisioned("<plugin-id>", "<pfad>")`, aufgelöst beim Laden der
Profildatei gegen denselben Datenordner, den der Start verwendet. Kein Rechnerpfad mehr in `core`,
`example` und dem Entwicklerprofil, und ein Client-Profil kann dasselbe. (6) `pnpm provision
[<profil>|<pfad>]` lädt die Profildatei wie der Server und berichtet je Plugin `bereit`,
`installiert` oder `fehlt: <Grund>`; `connect` ruft es zwischen Holen und Start, die
VS-Code-Erweiterung vor dem Start des lokalen Hosts. Eine verbliebene Lücke bricht den Start ab.

Zum Arbeitsplatz entschieden: Er wird mit derselben Provisionierung und demselben
Werkzeugordner-Schema versorgt und ruft sie selbst - `pnpm workspace-client` beim Start,
die Erweiterung beim Aktivieren über denselben Befehl im Host-Checkout. Er hat kein Profil,
deshalb ist sein Datenordner `~/.local/share/ragents/workspace/`, und provisioniert werden genau
die Plugins der Sprachserver, die sein Executor anbietet. Die Alternative, ihm einen eigenen
Mechanismus oder ein eigenes Werkzeugverzeichnis zu geben, hätte eine zweite Wahrheit ergeben;
die Alternative, ihn gar nicht zu provisionieren, hätte den Entwickler mit zwei
Umgebungsvariablen zurückgelassen. Passend dazu kennen die Adapter im Executor den Werkzeugordner
als Vorgabe: `hostToolFile` löst `DATA_DIR` auf, sonst den Arbeitsplatzordner, und
`ROSLYN_LANGUAGE_SERVER` beziehungsweise `FSHARP_LANGUAGE_SERVER` sind nur noch Übersteuerung für
einen selbst installierten Server. Auf dem Arbeitsplatz ist eine Lücke kein Startfehler: er kann
ohne Roslyn lesen, schreiben und bauen, und erst der Aufruf des Sprachservers scheitert mit ihr.

Rückbau fertig gezogen: `install.sh` von `ragents.lsp-roslyn`, `ragents.lsp-fsharp` und
`ragents.browser`, `scripts/install-plugin-dependencies.sh` und das `install`-Feld in
`plugin-list.ts` sind gelöscht; die Profilverteilung schließt `install.sh` nicht mehr aus, sondern
packt die `provision.ts` eines Archiv-Plugins bewusst mit, weil der Client sie ausführt. Geprüft:
zweimal `pnpm provision selftest/ragents.config.developer.ts` gegen einen leeren Werkzeugordner
(erst `installiert`, dann `bereit`, keine Datei verändert), ein Server mit diesem Profil und ein
kopfloser Arbeitsplatz mit `roslyn_open` und `typescript_diagnostics` auf beiden Wegen.

## Windows als Client-Plattform, gebaut ohne echten Lauf (20.09.2026)

Kapitel: plugins (Sandbox-Werkzeuge und Prozesse, Offene Grenzen), operations (Unter Windows
arbeiten, Datenablage); Konzept `docs/concepts/remote-profile.md`, Paket 7. Der Executor startete
fest `/bin/bash`, schickte Signale an negative PIDs, legte seine Daten immer unter
`~/.local/share` ab, und der Promptbeitrag zur Shell-Plattform kannte nur darwin und linux. Auf
einem Windows-Arbeitsplatz wäre davon nichts gelaufen. Grundsatz bleibt: Node-Standard-APIs und
Git Bash, keine eigene Plattformschicht, eine unbekannte Plattform bleibt ein Fehler.
Festgelegt: (1) Die Bash des Executors kommt aus der Shell-Auflösung des Agent-Pakets
(`getShellConfig`), die unter Windows Git Bash findet und das alte `System32\bash.exe` über
stdin bedient; `getShellConfig` bekommt die Plattform als Parameter, damit der Windows-Zweig
ohne Windows-Rechner prüfbar ist. Was keine Bash ist, weist der Executor ab: der `sh`-Ausweg
der Auflösung wäre ein stiller Fallback unter einem Werkzeug, das bash heißt.
(2) Statt eines Signals an die negative PID beendet unter Windows `taskkill /T /F` den
Prozessbaum, über den vorhandenen `killProcessTree` des Agent-Pakets; das gilt für die Bash wie
für `managed-process.ts`, und die Frist vor SIGKILL entfällt dort, weil Windows nichts Sanftes
anzubieten hat. Der Baum wird nur beendet, wenn der
Prozess noch existiert, damit nicht jeder fertige Befehl ein taskkill nach sich zieht.
(3) Der Datenordner liegt unter `%LOCALAPPDATA%\ragents\<profil>`; fehlt `LOCALAPPDATA`, ist das
ein harter Startfehler statt eines geratenen Pfads. Die HOME-Umleitung der Sandbox setzt auch
`USERPROFILE`, und die sichere Umgebung reicht die Windows-Grundvariablen durch (`SystemRoot`,
`ComSpec`, `PATHEXT`, `APPDATA`, `LOCALAPPDATA` und Geschwister), ohne die dort kaum ein
Programm startet. (4) `ragents.processes` lehnt den Start unter Windows mit benannter Ursache ab,
wie im Konzept vorgeschlagen: eine Prozesstabelle für win32 wäre Arbeit für eine Anzeige, die
niemand verlangt hat, und eine leere Anzeige wäre eine stille Lüge.

Symmetrie dazu: Der Promptbeitrag zur Shell-Plattform nennt jetzt die Plattform des Executors,
der den Run ausführt, nicht die des Servers - bei `fresh` und `path` die des Servers, bei
`client` die, die der Arbeitsplatz bei der Anmeldung gemeldet hat. Der Schnappschuss der
Prompt-Beiträge entsteht weiter genau einmal beim Start; ein Beitrag darf dafür ein
`renderForRun(runId)` mitbringen, das der Server je Run über den gerenderten Text legt
(`PromptContributionRegistry.runOverrides`). Synchron, weil der Prompt eines Turns synchron
zusammengesetzt wird; alles andere hätte `basePrompt` im Scheduler asynchron gemacht und den
ganzen Prompt je Turn neu gerendert. Ist der gebundene Arbeitsplatz gerade nicht angemeldet,
sagt der Beitrag genau das, statt eine Plattform zu raten oder den Turn scheitern zu lassen.

Ungeprüft: Es gibt hier keinen Windows-Rechner. Geprüft ist alles nur mit Unit-Tests, die die
Plattform simulieren (Shell-Auflösung, Datenordner, Umgebung, Promptbeitrag je Plattform,
Ablehnung von `ragents.processes`). Der echte Lauf unter Windows mit `connect`, `read`, `edit`,
`bash` und Diagnostik steht als einzige offene Zeile zu Paket 7 im TODO.

## Ein gescheiterter Werkzeugaufruf nennt immer seine Ursache (20.09.2026)

Kapitel: core (Werkzeugaufrufe im Journal), plugins (Dateiablage). In Lauf 82d041c3 standen
`browser_check` und `actor_program_activate` ohne Fehlertext im Journal: `failToolCall` wies
einen leeren `error` als ungültigen Wert ab, und damit verschwand das ganze Ereignis samt
Ursache. Leer werden konnte der Text an drei Stellen: ein `Error` ohne `message` (die Ursache
steckte nur im `cause`), ein Fehlerabschluss des Modells mit leerem Ergebnistext, und ein
Diagnoseband ohne Eintrag. Festgelegt: (1) `tool.call.failed` trägt immer einen nicht leeren
`error` - die Meldung, sonst den Text der Ursache, sonst "Fehler ohne Ursache"; die
Entscheidungsschicht ersetzt statt abzuweisen, weil ein Ereignis ohne Ursache schlechter ist als
ein Ersatztext. (2) Die Fehlerlisten des Actor-Programm-Plugins fallen auf einen benannten Text
zurück, wenn keine Meldung übrig bleibt. (3) `show_document` ist wie `document_write` ein
natives Modellwerkzeug: über `typescript_api` plus `typescript_eval` kostete eine Anzeige drei
Runden statt einer.

## Ein Arbeitsplatz-Executor, überall derselbe (20.09.2026)

Kapitel: plugins (Arbeitsbereich, Sandbox-Werkzeuge und Prozesse; Language-Server-Plugins;
Self-contained Plugin-Ordner; Offene Grenzen), operations (Session-Isolation); Konzept
`docs/concepts/workspace-tools-proxy.md`. Die Bindung `client` aus dem 18.09.2026 schickte fünf
Grundoperationen (`readFile`, `writeFile`, `access`, `mkdir`, `exec`) zum Arbeitsplatz und ließ
die Werkzeuglogik auf dem Server. Das erzwang eine Entscheidung je Pfad, verbot Language Server
bei `client`, schickte Git-Zugangsdaten des Servers in eine fremde Bash und gab
`typescript_eval` ein `cwd`, das es auf dem Server nicht gibt. Festgelegt: (1) Es gibt genau
einen Executor für die Arbeitsplatz-Werkzeuge, das Paket `packages/workspace-executor`: die vier
Sandbox-Werkzeuge, Prozessgruppen, Umgebung, Pfadprüfung und die Language-Server-Sitzungen samt
den drei Adaptern. Server und Erweiterung importieren dasselbe Paket; die Anmeldung meldet seinen
Stand, ein Unterschied ist ein Fehler mit Ursache. (2) Der Vertrag `ragents.workspace.client.*`
hat nur noch `execute` neben Register, Unregister und List; Fortschritt ist die Ausgabe als
`{ text }`, Abbruch bleibt `rpc.cancel`. (3) Im Server ist jedes Arbeitsplatz-Werkzeug nur
Beschreibung, Schema, Promptbeitrag und Weiterreichung an `SandboxServices.execute`; es gibt
keinen Zweig "lokal oder entfernt" mehr, `onRemote`, `remoteEnvAdditions`,
`SessionWorkspace.remote` und `assertLocalWorkspace` sind weg. (4) Die Erweiterung bindet immer
`client`, auch auf demselben Rechner; `sameMachine` entfällt, der Rundlauf über localhost kostet
nichts und es gibt nur einen Weg. (5) Jeder Executor sieht die Ordner seiner Maschine und baut
seine Umgebung daraus; vom Server kommen nur Run-Marker, `CI`, `GIT_OPTIONAL_LOCKS` und die
Git-Regeln der Sandbox. (6) Die drei LSP-Adapter wandern in den Executor, damit jeder Executor
dieselbe Menge anbietet; die Plugins schrumpfen auf Beschreibung, Konfigurationsschlüssel, Reiter
und Weiterreichung, und `registerEditAnnotator` entfällt, weil der Executor seine eigenen
Sprachserver kennt. (7) Die Dateiablage ist kein Bash-Pfad mehr: `document_write` in
`ragents.documents` schreibt hinein, `source` holt eine Projektdatei über den `read`-Proxy des
Runs; `RAGENTS_FILES_DIR` verschwindet aus Umgebung, Pfadauflösung und Prompt, die Anzeige
bleibt. (8) Ein Run mit Bindung `client` bekommt zusätzlich seinen Ordner auf dem Server, damit
`typescript_eval` und die Actor-Programme ein `cwd` haben, das es gibt.

Beim Bau entschieden: Die Schnittstelle `execute(runId, tool, input)` trägt auch die
UI-Abfrage `<id>_snapshot` und das Aufräumen `stop`, damit der Vertrag bei einer Operation bleibt
und der Diagnosereiter auch bei `client` funktioniert. Der Fortschritt ist die gekürzte
Ausgabemomentaufnahme des Bash-Werkzeugs (`{ text }`) statt roher Blöcke, weil das Werkzeug sie
ohnehin erzeugt. `contributeSandboxEnv` stand nur noch in der Spec und fällt ersatzlos: der
Executor findet seine Toolchain über `PATH` seiner Maschine. Die gemeinsame Client-Hälfte liegt
als `plugins/ragents.workspace/client/`, weil dort der Vertrag wohnt; die Erweiterung und der
neue kopflose Arbeitsplatz `pnpm workspace-client` benutzen genau diesen Code. Offen bleibt der
Zwei-Rechner-Lauf; der Promptbeitrag zur Shell-Plattform nennt weiter die Plattform des Servers.

Nachbesserung nach dem ersten Ende-zu-Ende-Lauf (20.09.2026): `HOME` bleibt auf dem Arbeitsplatz
das Home des Entwicklers - er arbeitet dort mit seinen eigenen Zugangsdaten für Git, SSH und
NuGet, eine Umleitung würde das brechen; die Umleitung ist eine Eigenschaft des Executors im
Container. Damit dabei nichts ins Home geschrieben wird, trägt der Prozesskontext ein eigenes
`logDirectory` für Sprachserver-Protokolle, das jeder Aufrufer setzt (Server: Session-Ablage,
Arbeitsplatz: `os.tmpdir()`); der Executor hat dafür keinen Zweig. `document_write` verliert
`source`: der Modus holte die Projektdatei über die Modell-Ausgabe des `read`-Werkzeugs, und die
ist bei großen Dateien gekürzt und bei Bildern verkleinert - für eine Kopie nicht verlässlich.
Eine Projektdatei kommt jetzt über `read` und dann `content` in die Ablage. Weiter: `<id>_open`
und `document_write` sind native Werkzeuge, weil das Modell sie sonst über `typescript_api` plus
`typescript_eval` rufen muss (drei Runden statt einer); `<id>_diagnostics` ohne `paths` löst
`git status` gegen `git rev-parse --show-toplevel` auf und grenzt mit `-- .` ein, damit ein
Arbeitsbereich ein Unterordner eines Repos sein darf; die Bash wartet auf `close` statt `exit`,
damit die stdio-Ströme geleert sind, bevor das Ergebnis entsteht; und ein Verbindungsverlust
mitten im Aufruf meldet `workspace-client-disconnected` mit dem Namen des Arbeitsplatzes statt
"Der Ereignisstrom wurde beendet". Gekürzt: `createSandboxTools` liefert eine typisierte Abbildung
Name zu Aufruf statt eines Arrays mit Cast auf eine fünfstellige Signatur, die zweite Zeitgrenze
über der des Executors wird eine einzige Sicherheitsgrenze, `WorkspaceSandboxHost.shutdown` stoppt
nur noch den Executor des Runs (bei Bindung `client` entsteht im Server nie eine Sandbox),
`storageRoot` fällt aus dem gemeinsamen Kontext (nur der Server setzt und liest ihn), und der
Alias `SandboxProcessContext` sowie unbenutzte Exporte des Pakets sind weg. Das Entwicklerprofil
liegt als `selftest/ragents.config.developer.ts` neben der Testhilfe, damit die Zusicherung über
die Profile des öffentlichen Repos gilt; `scripts/start.sh` und `pnpm driver` nehmen dafür einen
Pfad (`PRODUCT_PROFILE_FILE`).

## `ListDetail` misst sich selbst: Drill-in statt zwei enger Spalten (19.09.2026)

Kapitel: plugins (Startauswahl, Dialoge), actor-programs (`ListDetail`). In VS Code ist die Fläche
oft 700 bis 1000 Pixel breit. Dort blieb die Startauswahl zweispaltig, weil die Umschaltung an
einer Media-Query auf das Browserfenster hing und erst bei 700 Pixeln griff; Liste und Vorschau
bekamen je rund 350 Pixel und wurden unlesbar. Festgelegt: (1) Der Baustein ist ein eigener
`@container/list-detail` und schaltet nach seiner eigenen Breite um, wie `Grid` und die
Arbeitsspalte es schon tun. (2) Die Schwelle liegt bei 900 Pixeln; CSS und die Messung im Code
verwenden dieselbe Konstante, damit Darstellung und Klickverhalten nie auseinanderlaufen.
(3) Unter der Schwelle ist die Detailansicht eine eigene Seite: Such- und Filterleiste weichen
mit der Liste, es bleiben Eintrag und Zurück-Knopf. (4) Ein `ResizeObserver` an der Wurzel
ersetzt `window.matchMedia` und räumt die Detailansicht weg, sobald die Fläche wieder breit
wird. Das gilt für jede Verwendung des Bausteins, also auch für Mini-Apps und den
Referenzkatalog.

## Die Erweiterung startet den Host selbst: Verbindungen statt einer Serveradresse (19.09.2026)

Kapitel: operations (Arbeitsspalte und VS-Code-Erweiterung), `apps/vscode/README.md`; Paket 8
aus `docs/concepts/remote-profile.md`. Gewünscht war, in VS Code wählen zu können: ein komplett
lokales Profil, konfigurierbar und gespeichert, oder ein Serverprofil mit Adresse, dazu eine
kleine Einstellungsseite mit Wahl, Anlegen und Trennen. Festgelegt: (1) Eine Verbindung ist ein
benannter Eintrag in `ragents.connections` mit drei Arten: Profil (die Erweiterung startet den
Host aus `ragents.hostPath` mit `--port 0` und liest die Ansage), Server (Token in der
SecretStorage, Ablauf von `pnpm connect` über dieselbe Funktion `prepareProfile`, kein zweiter
Weg) und laufender Server (die bisherige `ragents.serverUrl`, die ohne Altpfad darin aufgeht).
(2) Die Verbindungsverwaltung sitzt in der Spalte rechts, nicht im Explorer (Vorgabe des Owners): ohne
verbundene Sitzung zeigt das Webview der Spalte statt des iframes eine eigene Seite mit Zustand,
Verbindungsliste, Verbinden, Trennen und Neu; der Explorer zeigt nur einen Zeiger dorthin, die
Statusleiste wechselt bei bestehender Verbindung, der Assistent zum Anlegen ist ein QuickPick. (3) Alles je Verbindung
lebt in einer Sitzung, die ein Wechsel entsorgt und neu baut; ein Fensterneuladen ist nicht mehr
nötig, auch nicht bei Einstellungsänderungen. (4) Der Host bekommt den persönlichen Token als
`RAGENTS_TOKEN`; ein Client-Profil nennt ihn so, wie es `pnpm connect` schon tut. (5) Das Web wird
nur gebaut, wenn `apps/web/dist` fehlt oder Profil oder Host-Commit sich seit dem letzten Bau
geändert haben, sonst dauerte jedes Verbinden eine Minute. (6) Mit genau einer konfigurierten
Verbindung verbindet die Erweiterung sich von selbst; sonst öffnet sie die zuletzt aktive. Der
Hoststart ist reines Node mit `taskkill /T` unter Windows, aber ungeprüft; Windows bleibt Paket 7,
mit Fokus auf macOS und Windows, Linux nachrangig.

## Remote-Betrieb gebaut: Token, Modell-Relay, Relay-Provider, Profilverteilung, connect (19.09.2026)

Kapitel: profiles (Servergelieferte Profile, Anmeldung, Modellanbieter, Offene Grenzen),
plugins (Modell-Relay, Profilverteilung), operations (Anmeldung, Modellzugang, Mit einem Server
verbinden, Datenablage), README. Die Pakete 1 bis 5 aus `docs/concepts/remote-profile.md` sind
gebaut; das Konzept behält nur die offenen Pakete 6 bis 9. Beim Bau entschieden: (1) Zwei
eigene Rechte statt `runs.read`: `models.use` fürs Relay und `profile.fetch` für die
Profilverteilung, damit ein Entwickler-Token keine Runs des zentralen Servers lesen muss.
(2) Die Host-Version muss exakt passen (Git-Commit), passend zu "keine Migrationen"; `connect`
nennt den Befehl zum Wechseln und wechselt nicht selbst. (3) Das Archiv enthält die
Profildatei und nur die per Pfad genannten Plugins; Plugins per Kennung nimmt der Client aus
seinem Host-Checkout, der ohnehin auf dem verlangten Commit steht. Das erspart ein zweites
Exemplar der Repo-Plugins und hält das Archiv klein. (4) `CLIENT_PROFILE_FILE` ist ein
Schlüssel des Verteiler-Plugins, nicht des Hosts, weil das Fachplugin seine Konfiguration
besitzt; der Pfad gilt relativ zur Server-Profildatei. (5) Der Server hat jetzt EINE
Modelllaufzeit: Titelmodell, Vorbereitung und Engine teilen sie, und `ProfileContribution`
bekam `providers`, damit ein Plugin dort Anbieter registriert, bevor irgendwer ein Modell
nachschlägt. Das Produkt-Plugin baut seine Modelleinstellungen deshalb erst bei der
Initialisierung, nach dem Katalogabruf beim Relay. (6) Der Relay-Katalog liefert Reasoning,
Denkstufen, Eingabearten, Kontextgröße, Ausgabegrenze und `compat`, aber keine Kosten, weil der
Preis das Modell verriete; Relay-Modelle kosten beim Verbraucher 0. (7) Das Relay liest den
durchgereichten Strom nur mit, um `usage` zu protokollieren; verändert wird nichts. (8) Der
Anbieter hinter einem Alias kommt über den neutralen Dienst `modelUpstreamsToken`, den das
Produkt-Plugin liefert; so kann auch ein anderes Produkt-Plugin das Relay speisen, und der
OpenRouter-Schlüssel bleibt einmal deklariert. (9) Das Client-Profil wird ohne seine Umgebung
geprüft (Struktur, Sektionen, Secrets als `env`), die Schlüssel je Plugin erst beim Client,
weil ein Probe-Compose fremder Plugins auf dem Server Nebenwirkungen hätte. (10) `tar` ist eine
Abhängigkeit der Repository-Wurzel wie der TypeScript-Language-Server, damit Plugins es finden.
Provisionierung (Paket 6) und Windows (Paket 7) fehlen noch; `connect` richtet keine
Language Server ein. Nachtrag (20.09.2026): Punkt 7 gilt nur noch eingeschränkt - das Relay
ersetzt im durchgereichten Strom `model` durch den Alias und entfernt `provider`; siehe den
Eintrag "Das Relay nennt nur den Alias" oben.

## Remote-Betrieb: der Server läuft beim Entwickler, Modelle und Profil kommen vom Server (19.09.2026)

Kapitel: keins geändert; Plan in `docs/concepts/remote-profile.md`. Gewünscht war ein Konzept
für RAgents mit entferntem Server. Zuerst stand "ein Plugin-Host an zwei Orten" im Raum: jede
Funktion mit Ausführungsort (Server, Client oder dort, wo ihre Ressource liegt), dieselbe
Runtime-Hälfte eines Plugins in Server und VS-Code-Erweiterung, Client-Bundle vom Server. Ein
Challenger-Review (Fable 5.1) hat das gegen Code und Regeln geprüft und verworfen: `create(host)`
der Kandidaten zieht Engine-Dienste (`ragents.workspace/server/index.ts:29`,
`language-server/plugin.ts:18`), ein Client-Host bräuchte Attrappen oder zwei Zweige je Hälfte;
`ToolScope` enthält `runtime` und `invokeFunction`, ein kleinerer Scope wäre eine zweite
Funktionsart; die Funktionen, um die es geht, haben zwei Ressourcen an zwei Orten
(`typescript_eval` mit `cwd` im Client-Ordner, Language Server für `@actors` und Projekt,
Browserprüfung gegen den Teststand, Git mit Zugangsdaten vom Server); Lebenszyklus und
Prozessverwaltung entstünden beim Client ein zweites Mal; Roslyn, FSAC und Chrome sind keine
JavaScript-Bundles. Dazu hat die Bindung `client` nie über zwei Rechner gelaufen.

Festgelegt: (1) Der RAgents-Server läuft dort, wo die Dateien sind, also beim Entwickler, mit
Bindung `path`; Language Server, Browser, Prozesse, Git bleiben unverändert. (2) Der Zugang zu
den Modellen ist ein Geheimnis des zentralen Servers: ein Plugin liefert ein OpenAI-kompatibles
Relay mit Aliasnamen, beim Verbraucher ist es ein weiterer Provider (`AGENT_PROVIDER: "relay"`).
(3) Das Profil wird serverseitig gepflegt und vor dem Start als Archiv in einen Cache geholt;
der Server startet per Pfad wie mit jedem Profil, die Regel "kein Nachladen zur Laufzeit" bleibt.
(4) Persönliche Token im Profil statt eines eigenen Anmeldedienstes. (5) Plugins bekommen eine
idempotente Provisionierung statt `install.sh`; Windows wird Client-Plattform mit Node-APIs
und Git Bash. (6) Die Erweiterung bleibt dünn und startet den lokalen Host. Zurückgestellt:
Arbeitsplatz-Client und Zwei-Orte-Idee als Zukunftsfeature mit festgehaltenen Randbedingungen,
Run-Umzug zwischen Servern. `pnpm driver` ist ein reines Testwerkzeug und kein Client im Sinne
dieser Architektur.

## Die API ist JSON-RPC mit typisierten Verträgen, HTTP und stdio sind Transporte (18.09.2026)

Kapitel: plugins (Nachrichtenschicht, Plugin-Vertrag, Web als Plugin-Host, Arbeitsbereich),
core (Schichten, Overseer), profiles (Startmodi, Rechte), typescript-platform, actor-programs,
README. Der Server sollte auch als Konsolenprozess ohne Port starten und die Erweiterung
zwischen HTTP und stdio wechseln können, mit einer Nachrichten-API, die im Web und im Backend
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
nicht, und core arbeitet je Run in einem leeren Ordner. Vorgabe: die Erweiterung soll wissen, wo
die Dateien sind, und ein Arbeitsplatz soll sich später auch an einen entfernten Server hängen
können, mit den Dateien lokal und Modellen, Wissensbasis und Werkzeugen auf dem Server.
Festgelegt: (1) Der Server bleibt der eine Prozess je Profil, die Erweiterung ist Client; sie
startet keinen Server je Fenster wie Claude Code seine CLI. (2) `WorkspaceRuntime` und
`SandboxServices` sind die einzige Naht zum Arbeitsverzeichnis, jetzt ausgesprochen in der Spec;
in core gilt das bereits. (3) Die Bindung je Run ist die Startoption `ragents.workspace.binding`
mit den Arten `fresh`, `path` und `client`; auf ausdrücklichen Auftrag, alles an einem Stück zu bauen, sind
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
bearbeitet wird. Vorgabe:
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
Feldnamen) und half dem Modell nicht. Entschieden: nicht mehr ablehnen. Festgelegt: (1) Die
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
in `instructions`. Auf Wunsch des Owners bekommt `agent_spawn` das Feld `forkOf`: `agent.spawned`
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
nachvollziehbar, weil sie nicht journalt wurden. Vorschlag des Owners: das ohne LLM
lösen, imperativ mit einem gut gebauten TypeScript-Skript. Dazu: Der Wächter darf
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
   Selbstanstoß, Parallelität 25 (50 war zu hart), Programmtest mit 33 Regeln bei 25.
   Die Grenze der Laufzeit bleibt; sie schützt vor Endlosschleifen.
2. Der Koordinator hat den Steueractor gelesen, gepatcht und aktiviert. Entschieden: Koordinatoren
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
   jedes OpenRouter-Modell in jeden Folgeaufruf zurückschickt. Einschätzung: ob ein Modell das
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

Kapitel: plugins. Die dunkle Darstellung, wie sie die Spalte in VS Code aus dem
Editor-Theme übernimmt, soll auch im Browser die Vorgabe sein. Ohne gespeicherte Wahl startet
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
Fläche hochgleitet, ohne das Layout zu verschieben (ausdrücklich gewünscht war das Gefühl der
iPhone-Sheets: unten bündig, seitlich frei, oben rund, und keine Bewegung der Eingabe beim
Aufklappen, deshalb gleitet allein die Höhe und die Eingabe bleibt am unteren Rand verankert);
die Nadel dockt ihn wie bisher an, ab 900 Pixel Breite liegt er rechts daneben. Der Adressat
wandert als Pop-out in die Eingabeleiste neben Detailgrad und Senden, dazu der erste arbeitende
Actor mit Spinner. Die Actor-Anzeige hat jetzt überall die Vorgabe `Sichtbare`: was auf dem Canvas
ausgeblendet ist, gehört auch in Kopfzeile und Pop-out hinter die Zahl. `ChatSurfaceOptions`
bekommt dafür `toolbarRight`, `ActorChatControls` die Darstellung `column` mit beiden Slots.
Nicht gebaut: ein kompaktes Format der Kopfzeilenbeiträge; das Popover zeigt sie unverändert,
solange nur die Spalte es braucht. Nachtrag am selben Tag: der Owner will Breite und beide
Verzögerungen selbst stellen, deshalb stehen sie als Einstellung `Arbeitsspalte` unter Darstellung
statt als Konstanten im Code. Zweiter Nachtrag: die Nadel ist einem Layout-Schalter mit
`Automatisch`, `Sheet`, `Unten`, `Daneben` gewichen, weil der Owner die Anordnung auch von Hand
festlegen will; daneben bekommt der Chat einen senkrechten Griff für seine Breite. Zugeschoben
zeigt das Sheet keinen Rahmen, dafür eine Statuszeile (Rückfrage, aktuelle Arbeit oder letzte
gesprochene Zeile), damit man sieht, ob der Chat etwas tut. Dritter Nachtrag: der Vierfach-Schalter
war zu viel. Gewählt wird nur noch rechts oder unten, und unterhalb der eingestellten Breite
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
Niemand soll erst den Server und dann die Instanz von Hand starten müssen, deshalb startet das Skript
zu jedem Profil den Server selbst mit, wenn er nicht antwortet, und wartet auf `/health`.

## Gruppierte Schritte als Vorgabe aller Chats, Plugin-Quellen im Tailwind-Build (17.09.2026)

Kapitel: plugins. Der Detailgrad `grouped` gilt überall als Vorgabe: Host-Policy,
globaler Koordinator, Server-Fallback der Produkt-Policy und die Konfiguration der Profile stehen
jetzt auf `grouped`; im Browser gespeicherte Auswahlen bleiben wie bisher vorrangig.
Dabei fiel auf, dass der Vite-Build die Plugin-Ordner nicht scannte: `@source` mit einem
Verzeichnis-Glob (`plugins/*/web`) findet keine Dateien, erst `plugins/*/web/**/*`. Die
Utilities der Plugins (Inspector-Abstände, Statusleiste, Materialfarben) fehlten deshalb im
gebauten Stylesheet; Fixtures und Mini-App-Compiler waren nicht betroffen, weil sie die
Ordner ausdrücklich übergeben.

## Arbeitsspalte und VS-Code-Erweiterung, Anmeldung per Token (17.09.2026)

Kapitel: plugins, profiles. Gewünscht war RAgents am Rand von VS Code: links ein Explorer der
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
Koordinator-Eingabe, der Kurzantwort-Toast war schmal und sein X saß im Text. Der Owner wollte den
Koordinator 50 Prozent breiter (570 statt 380 Pixel), den Toast doppelt so breit und sauber
gesetzt, eine Kopfzeile, die nie wächst, und Toasts nur, wenn der Verlauf nicht ausgeklappt ist.
Die Toolbar-Eingabe ist jetzt fest einzeilig und scrollt, Kopfzeile und Beitrag haben feste
45 Pixel; der Toast ist eine Zeile aus Textfläche und rundem X; eine Kurzantwort bei offenem
Verlauf wird verworfen.

## Gesamte Oberfläche auf Tailwind und shadcn, ein Token-File (17.09.2026)

Kapitel: plugins, actor-programs. Seit dem 15.09. galt Tailwind nur für die Controls und die
Mini-App-Frames, die übrige Oberfläche lief über rund 8.700 Zeilen eigenes CSS in Host und
Plugins mit `--qsl-*`-Tokens und einer zweiten Token-Schicht in `theme.css`. Ziel war
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
ist. Die Leiste soll sich auf das beschränken, was auf der Fläche zu sehen ist; `Aktive` blendet
nur gestoppte Actors aus und wirkt ohne gestoppte Actors wie `Alle`. Grundlage sind die
Bühneneinträge aus `publishStageEntities`, die schon die ausgegrauten Zugänge bestimmen; damit
gilt der Modus in freiem Canvas und Kacheln gleich. Kapitel: `docs/spec/plugins.md`; Bedienung
und Homepage sind angepasst.

## Detailgrad "gruppiert" für Schritte (17.09.2026)

Zwischen `chips` und `compact` steht der neue Detailgrad `grouped`: alle Denk- und
Werkzeugschritte zwischen zwei Antworten fallen zu einer aufklappbaren Zeile "N Schritte"
zusammen, aufgeklappt erscheinen sie als die einzeiligen Zeilen des `compact`-Modus mit
demselben Popover. Gewünscht war die Gruppierung, wie Codex sie zeigt, ohne dass die Gruppe
beim Öffnen sofort alle Details ausbreitet; erst die Gruppe, dann die Zeile, dann das Popover.
Die einzeilige Darstellung ist dafür aus `Bubble` in `TraceLine` gezogen und wird von beiden
Modi verwendet. Kapitel: `docs/spec/plugins.md`.

## Detailgrad je Anzeigefläche (17.09.2026)

Canvas-Karte, Seiteninspector und Popout desselben Actors teilten sich bisher den gemerkten
Detailgrad (Schlüssel Run + Actor). Gewünscht ist er je Fläche: im Inspector "alles" lesen,
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
   aus der Zeit vor dem Compiler-Pool). Festgelegt: Parallelität 50, praktisch unbegrenzt; die
   Reihenfolge "erster Aufruf allein, dann alle" für den Anbieter-Cache bleibt.
4. Werkzeugzählung: 86 Aufrufe eines Agenten, davon 39 `typescript_eval`-Snippets ohne eine
   Zeile Logik, nur Einzelaufrufe von Browser-, Report-, Status- und Diagnostikfunktionen;
   weitere 36 Snippets für Kontext und Bericht. Jede Hülle kostet Kontext, rund eine Sekunde
   Compiler und liefert Vertragsfehler als TS-Diagnose. Entschieden: mehr Werkzeuge nativ. Die
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
Run-Driver, Modellkatalog und Konzept-Audit lagen neben den beiden Einstiegen. Vorgabe: thematische
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
Einschätzung: das ist ein sinnvolles Werkzeug und gehört ins Repository, konfigurierbar statt
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
zurücksetzte. Vorgabe: Zeitgrenzen bleiben, Prüfungen dürfen lange dauern. Festgelegt:

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

Zwei autonom gefahrene Läufe lieferten zehn Reibungspunkte; der Owner hat je Punkt entschieden, ob
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
ohne Vergrößerung, passend zur bestehenden Screenshot-Konvention). Ergänzung:
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

Einwand des Owners: Die README ist der bessere Einstieg, die meisten lesen ohnehin sie; ein
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
Run war aber mit den Schemata vom Vorabend gebunden, und nichts aktivierte es neu. Die
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

Kapitel: plugins, actor-programs. Die eigene Control-Bibliothek vom 07.09. (Button, IconButton,
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
nur Aktionen. Kapitel: `docs/spec/actor-programs.md`.

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
Betroffen: `docs/spec/actor-programs.md`.

## Mehr Abstand zwischen Diagrammkarten (15.09.2026)

Die Standardabstände der automatischen Anordnung steigen um etwa 30 Prozent: von 40 auf 52
innerhalb einer Ebene und von 72 auf 94 zwischen Ebenen. So bleibt zwischen den Kästen mehr
Freiraum. Betroffen: `docs/spec/actor-programs.md`.

## Diagrammkarten an der äußeren Rundung begrenzen (15.09.2026)

Bei Karten ohne Unterpunkte reichte die rechteckige Kopffläche über die unteren runden Ecken.
Die Karte beschneidet jetzt ihre Inhaltsflächen an ihrer Außenkontur. Abmessungen, Schatten
und Verbindungen bleiben unverändert. Betroffen: `docs/spec/actor-programs.md`.

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
impliziten Standardwerts. Betroffen: `docs/spec/actor-programs.md`.

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
zu den übrigen Mini-App-Inhalten. Betroffenes Kapitel: `docs/spec/actor-programs.md`.

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
`docs/spec/actor-programs.md`, `docs/spec/plugins.md` und die öffentliche Bausteinreferenz.

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
Betroffene Kapitel: `docs/spec/actor-programs.md`, `docs/spec/typescript-platform.md`, `docs/spec/plugins.md`.

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
Vorlage und Abhängigkeit entfällt. Kapitel: `docs/spec/actor-programs.md`, `docs/spec/plugins.md`;
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
Kapitel: `docs/spec/actor-programs.md`, `docs/spec/plugins.md`; Bedienung und Homepage angepasst.

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

Die Chat-Pop-outs der LLM-Actors verwenden auf Wunsch des Owners 784 statt 560 CSS-Pixel
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
Kapitel: `docs/spec/plugins.md`, `docs/spec/actor-programs.md`; Bedienung und Homepage angepasst.

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
für bereits installierte Views beim erneuten Laden. Kapitel: `docs/spec/actor-programs.md`;
Homepage angepasst.

## Erweiterungsleitfaden aus konkreten Integrationsbefunden (14.09.2026)

Die Arbeit an Datenzugriff, Koordinator und Worker, Sprachservern und Mini-Apps zeigte dieselben
Grenzen an mehreren Stellen: Fachfunktion und Ansicht, Prompt und tatsächlicher Aufbau,
Aktivität und Ergebnis sowie Render-Test und bedienbarer Host-Frame. Der öffentliche Guide
erklärt daraus acht Strategien und eine Entscheidungshilfe für Funktionen, Scripts, Actors
und Views. Konkrete Belegpfade und ihre Reichweite bleiben im internen Spec-Kapitel; feste
Modelle, Fachfilter und Produktpfade werden nicht zu allgemeinen Regeln. Es entsteht kein
neuer Abstraktionsmechanismus und keine zweite Dokumentationsablage.
Kapitel: `docs/spec/plugins.md`, `docs/spec/actor-programs.md`; Homepage und Guide-Verweise angepasst.

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
Kapitel: `docs/spec/plugins.md`, `docs/spec/profiles.md`, `docs/spec/actor-programs.md`; Bedienung angepasst.

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
Kapitel: `docs/spec/actor-programs.md`; Bedienung und Homepage angepasst.

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
Kapitel: `docs/spec/actor-programs.md`; öffentliche Bausteinreferenz und Homepage ergänzt.

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

Auf Wunsch des Owners haben Kacheln jetzt null Tiefenstufen. Die gemeinsame Kastenoptik bleibt,
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

Chat-Actors starten auf Wunsch des Owners mit doppelter Breite und Höhe, 720 mal 520 CSS-Pixel.
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

LLM-Karten im freien Canvas lassen sich auf Wunsch des Owners bis 2880 mal 2700 CSS-Pixel
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

Die Schichtwerk-Karten verwenden auf Wunsch des Owners standardmäßig eine Tiefenstufe. Die
Vorgabe gilt auch beim Zurücksetzen; ausdrücklich gespeicherte Browserwerte bleiben gültig.
Kapitel: `docs/spec/plugins.md`; Bedienung und Produkt-Homepage angepasst.

## Mini-App-Innenabstand zentral im Host (13.09.2026)

Äußere Abstände lagen bisher in den einzelnen App-Styles und konnten bei generierten Views
fehlen. Echte Mini-App-Frames erhalten jetzt einen gemeinsamen Innenabstand am scrollenden
Mountpunkt. Der Scrollbalken bleibt am rechten Frame-Rand, `AppLayout` verdoppelt den Abstand
nicht und sein `fill`-Layout bleibt möglich. Die mitgelieferten Apps verzichten auf ihr eigenes
äußeres Padding; die Autorenanleitung überlässt Seitenlayout und Abstand ausdrücklich dem Host.
Standalone-Vorschauen behalten ihren Dokumentfluss.
Kapitel: `docs/spec/actor-programs.md`; Produkt-Homepage entsprechend ergänzt.

## Innenabstand der Mini-App-Statuszeile herstellen (13.09.2026)

Die eingebettete Host-Statuszeile setzte ihren seitlichen und unteren Innenabstand auf null.
Meldungen wie "Aktion läuft" klebten dadurch am Kartenrand. Sie verwenden nun den gemeinsamen
seitlichen Workspace-Abstand und acht Pixel oben und unten.
Kapitel: `docs/spec/plugins.md`; Produkt-Homepage entsprechend ergänzt.

## Sichtbarer Start (13.09.2026)

Ein lokaler Start wartete ohne Meldung auf einen unerreichbaren Dienst; zugleich
war ein Wunschport bereits von einem fremden Prozess belegt. Auf Wunsch des Owners bleibt
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
Kapitel: `docs/spec/profiles.md`, `docs/spec/plugins.md`, `docs/spec/actor-programs.md`;
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
Kapitel: `docs/spec/core.md`, `typescript-platform.md`, `actor-programs.md`, `plugins.md`.

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
`docs/spec/plugins.md`, `docs/spec/core.md`, `docs/spec/actor-programs.md`; die Homepage
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
Kapitel: `docs/spec/core.md`, `actor-programs.md`, `profiles.md` und `plugins.md`;
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
Kapitel: `docs/spec/plugins.md`, `docs/spec/actor-programs.md`; Bedienung und Homepage folgen mit.

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
`docs/spec/plugins.md`, `actor-programs.md`; die Produkt-Homepage folgt der neuen Anordnung.

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
Kapitel: `docs/spec/overview.md`, `core.md`, `typescript-platform.md`, `actor-programs.md`,
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
Kapitel: `docs/spec/actor-programs.md`.

## Actors direkt neben den globalen Koordinator setzen (12.09.2026)

Das Actors-Symbol sitzt direkt rechts neben dem globalen Koordinator und vor dem Run-Titel.
Ein eigener Beitrag in der Kopfzeile hält es unabhängig vom rechten Panel erreichbar.
Kapitel: `docs/spec/plugins.md` und `actor-programs.md`.

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
Kapitel: `docs/spec/actor-programs.md`.

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
Geändert: `overview.md`, `typescript-platform.md`, `actor-programs.md`, `plugins.md` und `core.md`;
README, Bedienung, öffentliche Homepage und generierte Referenzbeispiele folgen demselben Zugang.

## Zusätzlichen Fußstreifen unter Canvas-Inhalten entfernen (12.09.2026)

Kapitel: actor-programs. Die zusätzliche Leerzeile unter der einzeiligen Eingabe ist unerwünscht.
Die pauschalen 32 Pixel Innenabstand für den Größenanfasser entfallen bei LLM-Karten und
Mini-Apps. Der Griff bleibt in der Ecke; die bisherige knappe Innenkante der Eingabe genügt.

## Balkon als vorbereitetes Demo und Abstand zum Größenanfasser (12.09.2026)

Kapitel: plugins, actor-programs. Ausdrücklich beauftragt ist ein Balkon-Demo-Setup.
Das Referenzpaket richtet den Berater und seine eigene App in TypeScript ein; Fragen und
Empfehlung bleiben beim Modell. Es verwendet die bestehenden Actor- und Chat-Verträge.
Ein Startknopf trennt den Aufbau vom ersten Modellaufruf, eine erneute Anforderung nach
Modellfehlern zählt keine zusätzliche Antwort. Die Promptkarte bleibt ein separater Auftrag
an den Builder. Daraus entsteht keine allgemeine fachliche Wizard-Vorgabe.
Weil der innenliegende Größenanfasser über Fehlermeldungen und Eingaben lag, reservieren
vergrößerbare Canvas-Apps und LLM-Karten unten Platz für ihn.

## Run-Aufbau und Werkzeugauswahl ausdrücklich begrenzen (12.09.2026)

Kapitel: core, typescript-platform, plugins, profiles. Der Balkon-Test zeigte trotz geladener
Anweisung direkten Aufbau und einen Gesprächsberater mit geerbtem Rückfragewerkzeug. Beauftragt
sind allgemeine Plattformkorrekturen, ausdrücklich keine fachliche Wizard-Vorgabe.
Der Run-Builder bereitet TypeScript vor und startet es; direkte strukturelle Modellwerkzeuge
entfallen. Fachagenten wählen ihre Werkzeuge beim Spawn ausdrücklich, ohne stille Vererbung.
Der bestehende Host-Erzeugungsbefehl hält Builder-Prompt und Koordinator-Beiträge auch nach
Primary-Wechsel oder Fork beim richtigen Actor. Canvas und View-Sichtbarkeit teilen ihre
Namensauflösung. Bekannte Views gestoppter Actors werden aus der Szene entfernt, damit ein
Stopp keine verwaisten Fehlplatzhalter erzeugt. Der Run-Koordinator erhält auf Wunsch des Owners
high als Standard-Denktiefe. Ein reparierter Einzellauf gilt nicht als Nachweis für den Builder.

## Zusätzliche Schatteneffekte vollständig entfernen (12.09.2026)

Kapitel: plugins, actor-programs, overview. Der Owner möchte den Effekt nach erneut sichtbaren
Nachziehspuren entfernen. WebGL-Kontaktschatten, Iframe-Runtime, Material-Portnachrichten und
die Schattenregler entfallen vollständig. Auch der Filter-Schlagschatten der Karten entfällt.
Die Materialtiefe bleibt unabhängig davon einstellbar. Die bisherigen Offline-Entwürfe bleiben
als Entwürfe in der gemeinsamen Übersicht erhalten.

## Kartenkopf vereinfachen und innenliegende Griffe erreichbar halten (12.09.2026)

Kapitel: plugins. Der Owner möchte im LLM-Kartenkopf nur Symbol, Name und Größenknopf;
Rollenüberschrift und Eingabezähler entfallen. Nach dem Versetzen nach innen lag der Griff
unter der Eingabeleiste. Seine Zeichenebene liegt jetzt darüber. Kopfzeile, rechtes Panel und
Statusleiste erhalten ein eigenes deckendes Schieferblau, damit der Hintergrund keine warmen
Farben in diese Flächen mischt.

## Anwendung auf die Canvas-Palette abstimmen (12.09.2026)

Kapitel: plugins. Die übrige Anwendung wirkte farblich nicht zusammengehörig.
Kühle blaugraue Grundflächen, Lavendel für Auswahl und Aktionen sowie violettgraue Konturen
ersetzen die warmen Schalenfarben. Kopfzeile, Panels, Dialoge und Einstellungen übernehmen
sie über die gemeinsamen Tokens. Die bisher fest eingetragenen Datei-, Aufgaben-, Dokument-
und Entwicklungsstatusfarben verwenden ebenfalls zentrale Farben mit passender dunkler Variante.

## Canvas-Hintergrund beleben und Griffe nach innen setzen (12.09.2026)

Kapitel: plugins. Der Hintergrund war zu einflächig, die Karten weiterhin zu eng.
Mehrere weiche Farbverläufe bringen Lavendel, Mint, Blau und einen warmen Randbereich zurück;
die Materialstruktur wird schwächer. Zwischen den Tiefenkörpern bleiben mindestens 72 statt
40 CSS-Pixel. Der Größenanfasser sitzt wieder innerhalb der Kartenecke und verwendet
Schwarz mit 70 Prozent Deckkraft, auch beim Darüberfahren.

## Balkon-Gespräch durch eine eigenständige Canvas-App vermitteln (12.09.2026)

Kapitel: plugins, typescript-platform. Der erzeugte Wizard stellte fünf feste Fragen und nutzte
den Berater erst für die Auswertung. Gewünscht ist hingegen ein begrenztes LLM-Gespräch:
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

Kapitel: plugins. Neben den Eingaben erschienen vergrößerte, versetzte Schatten.
Der Renderer nahm an, dass der GPU-Puffer die angeforderte Browserauflösung übernimmt.
Ein großer Test-Viewport reproduziert die Abweichung: Statt 24000 Pixel Breite stellt die GPU
nur 8192 bereit. Shader und Ausschnitt rechnen deshalb mit dem tatsächlichen Drawing Buffer
und der gemessenen Bildschirmfläche des Canvas. Die Zuordnung folgt auch Zoom und Panning.

## Kartenabstand und Mini-App-Farbe korrigieren (12.09.2026)

Kapitel: plugins, actor-programs. Der Owner möchte mehr Abstand zwischen den Tiefenkörpern und
keine beige Mini-App. Der Mindestabstand wächst von 18 auf 40 CSS-Pixel zusätzlich zur
Extrusion. Mini-App-Fläche und gemeinsame Controls wechseln zu mattem Blaugrau. Der einzelne
Größenanfasser bleibt außen, sitzt aber zwölf Pixel näher an der Kartenecke.

## Einzeilige Quassel-Eingabe in LLM-Karten (12.09.2026)

Kapitel: plugins. Der Owner möchte mehr Platz für das Gespräch in den LLM-Actor-Karten.
Der gemeinsame Quassel-Composer erhält eine Inline-Darstellung mit Textfeld, Anhang,
Detailgrad und Senden nebeneinander. Anhänge, Fehlerbehandlung und Entwurfswiederherstellung
bleiben im selben Baustein; im rechten Inspector bleibt die bisherige Eingabehöhe erhalten.

## Schichtwerk-Tiefenkörper als Canvas-Material übernehmen (12.09.2026)

Kapitel: plugins, actor-programs, overview. Der Owner möchte die ausgearbeitete Materialwirkung des Entwurfs
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

Kapitel: plugins. Der Owner möchte den Balkon-Wizard erneut aus der Startauswahl aufbauen können.
Die neutrale Referenz erhält dafür eine kurze Promptkarte: fünf aufeinander aufbauende Fragen
in einer eigenen Oberfläche und anschließend eine Gestaltungsempfehlung. Gemeinsame Layout-
und Formularbausteine sowie sichtbare Lade- und Fehlerzustände gehören zum Auftrag. Die Karte
registriert einen Aufbauwunsch, kein fest installiertes Programm. Die zuvor erweiterten
Textanalyse- und Listenprompts werden ebenfalls wieder auf kurze fachliche Aufträge verdichtet.

## Mauslicht aus dem Entwurf entfernen (12.09.2026)

Kapitel: overview. Der Owner möchte keine Beleuchtung, die der Maus folgt. Der Entwurf entfernt
Schalter, Maussteuerung und den zusätzlichen Frontverlauf vollständig. Feste matte Fronten,
gestufte Tiefenkörper und größenabhängige Kontaktschatten bleiben erhalten.

## Bewegliches Licht im Entwurf sichtbar machen (12.09.2026)

Kapitel: overview. Der frühere Frontverlauf dunkelte maximal um etwa 3,5 Prozent ab und
bewegte sich relativ zur gesamten Bühne; die Wirkung war nicht erkennbar.
"Licht folgt Maus" verwendet jetzt die Koordinaten jeder Box und einen deutlicheren matten
Verlauf ohne Aufhellung. Bei reduzierter Bewegung startet der Effekt aus, lässt sich aber
bewusst aktivieren; zuvor blockierte die Einstellung den eingeschalteten Schalter unsichtbar.
Ausschalten und Verlassen der Bühne brechen noch wartende Aktualisierungen ab.

## Kontaktschatten an die Größe des Controls anpassen (12.09.2026)

Kapitel: overview. Die Kontaktschatten im Schichtwerk-Entwurf waren bei Checkboxen
zu stark. Der Shader skaliert Ausdehnung, Versatz und Deckkraft deshalb nach der kürzeren
Controlkante. So bleiben kleine und schmale Elemente dezent, während größere Flächen die
bisherige Tiefe behalten. Der Stärkeregler wirkt weiterhin auf alle Controls, erhält aber
deren Größenverhältnis. Der bestehende Entwurf und seine beiden Vorschauen werden aktualisiert.

## Mini-App-Grundlayout und Formularaufbau gemeinsam liefern (12.09.2026)

Kapitel: actor-programs. Der Balkon-Wizard zeigte Browser-Standardschrift und ein überlagertes
Textfeld. Die Bibliothek lieferte Fachcontrols, überließ Grundlayout und Typografie jedoch den
erzeugten App-Quellen. Der Host liefert nun die Basis zentral; AppLayout, Stack und Grid übernehmen
Rahmen, Abstände und an der Containerbreite orientierte Spalten. Textanalyse und gemeinsame
Liste nutzen dieselben Bausteine und Form für ihre Eingaben. Die Autorenanleitung lenkt auch
Wizards auf Form; Feld-CSS wirkt nur noch an echten Eingabeelementen. Die vorhandenen Demos
zeigen Textareas und einen lokalen Interview-Schritt. Eigene App-Quellen bleiben bearbeitbar;
die Änderung ersetzt keine alten Programme automatisch.

## Modellwahl beim Agent-Spawn direkt am Werkzeug erklären (12.09.2026)

Kapitel: core. Der Balkon-Wizard-Aufbau versuchte einen LLM-Agenten nur mit Handle und
Prompt anzulegen. Profil und Modell waren im Schema einzeln optional und ohne Erklärung
ihrer Abhängigkeit. Werkzeug- und Feldbeschreibungen nennen jetzt die notwendige ausdrückliche
Modellwahl; der Orchestrierungsprompt verlangt sie bei jedem LLM-Spawn. Der harte Fehler bleibt
erhalten, statt die fehlende Auswahl durch ein stilles Standardprofil zu ersetzen. Ob das
verwendete Modell die klarere Anleitung zuverlässig befolgt, braucht einen weiteren echten Lauf.

## Mehrteilige Run-Aufbauten bevorzugt als TypeScript ausführen (12.09.2026)

Kapitel: core, typescript-platform. Der Owner möchte zusammengehörige Einrichtungsschritte als
prüfbaren Code statt als lange Folge einzelner Modell-Werkzeugaufrufe. Der globale Koordinator
soll vorhandene Run-Scripts bevorzugen oder eigene Pakete erstellen; im bestehenden Run nutzt
der Koordinator denselben Actor-Programmpfad mit Setup-Handler. Einfache Starts und gezielte
Einzeländerungen bleiben direkt. Die Prompts verlangen den Aufbau vor Arbeitsaufträgen und
Bestandsprüfung vor Wiederholungen, weil Capability-Aufrufe keinen gemeinsamen Rollback haben.
Die Änderung verwendet bestehende Verträge und führt keine neue Setup-Abstraktion ein.

## Nicht lesbare Journale auf ihren Run begrenzen (12.09.2026)

Kapitel: core, overview. Ausdrücklich verlangt ist, dass alte oder beschädigte Journale
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

Kapitel: plugins, actor-programs. Der bisherige Hauptactor fiel nach einem Wechsel auf eine
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

Kapitel: core, actor-programs, overview. Der Owner möchte eine stärkere Dateisystemablage und weniger
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

Kapitel: plugins, actor-programs. Der Mini-App-Dialog belegt nur die Arbeitsfläche und lässt das
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
die fünf zentralen Fähigkeiten heraus. Die Mini-App-Erklärung zeigt auf Wunsch des Owners die
bedienbare gemeinsame Liste statt eines weiteren technischen Schemas. Deren Originaloberfläche
und Listenfunktion laufen für die Homepage lokal im Browser. Scrollen ergänzt Beispielnotizen,
bis der Benutzer selbst eingreift. Beim Wechsel der Darstellung bleibt seine Eingabe erhalten.
Die lokale Demo wird zusammen mit der Homepage gebaut und in der Hilfe ausgeliefert.
Ein Feinschliff entfernt den dekorativen Klebestreifen am Setup-Sticker. Zusätzlicher Abstand
und ein auslaufender Hintergrund vermeiden die harte untere Kante bei gleicher Elementplatzierung.

## Großbuchstaben in Mini-App-Funktionsaufrufen zulassen (12.09.2026)

Kapitel: actor-programs. Der Actor-Vertrag erlaubte `addEntry`, die Mini-App-Aufrufroute dagegen
nur kleingeschriebene Namen. Ein Klick wurde dadurch vor der Funktionsausführung mit 404
abgewiesen. Die Route akzeptiert jetzt dieselben Namen wie der direkte Actor-Funktionsaufruf;
ein HTTP-Regressionstest prüft den vollständigen Weg bis zum gespeicherten Ergebnis.

## Bestehende Mini-Apps tatsächlich an die gemeinsame UI binden (12.09.2026)

Kapitel: actor-programs. Die Umstellung der Vorlagen änderte bestehende Programmpakete nicht.
Die gezeigte Notizliste verwendete weiterhin eigene blaue HTML-Buttons und Feldregeln statt
der gemeinsamen UI. Ihre vorhandene Oberfläche wird auf den gemeinsamen Button und die
Feldklasse umgestellt. Die Autorenanleitung verlangt diese Bindung für Standardcontrols
ausdrücklich, damit zentrale Stiländerungen beim Laden auch bestehende Apps erreichen.

## Funktionen direkt im Detailpanel aufrufen (12.09.2026)

Kapitel: actor-programs. Die Funktionsdetails erhalten ein generisches Eingabeformular samt
Aufrufstatus, Rückgabewert und Fehleranzeige. Damit lassen sich installierte Funktionen auch
ohne eigene Mini-App direkt bedienen. Detailpanel und Werkzeugkarten teilen den Formularbaustein;
der bestehende Funktionsvertrag und Host bestimmen Eingaben, Aufruf und Bestätigungen.
Ein zusätzlicher Modell-Turn ist dafür nicht nötig.

## Entwurfssammlungen statt einzelner Varianten auflisten, neueste zuerst (12.09.2026)

Kapitel: overview. Die gewachsene Entwurfsübersicht zeigt oben und im Kartenraster nur noch
einen Eintrag je Entwurfsseite. Deren eigenes Menü erschließt die einzelnen Varianten; die
doppelten Einträge entfielen auf Wunsch des Owners. Bisherige Variantenlinks bleiben erreichbar.
Tabs und Karten stehen nach Datum absteigend, innerhalb desselben Tages in der gepflegten
Reihenfolge. So sind neue Sammlungen vor den älteren erreichbar.
Das Raster erhält eine explizite verfügbare Breite und schrumpfbare Spalten und Karten;
seine bisherige Mindestbreite führte zu horizontalem Überlauf. Die neuesten Sammlungen stehen
oben links, und beim Öffnen der Übersicht kehrt die Tab-Leiste an ihren linken Anfang zurück.

## Signal bis in die Mini-App-Vorlagen durchziehen (12.09.2026)

Kapitel: actor-programs. Die gemeinsamen Controls verwendeten bereits Signal, die Vorlagen für
Textanalyse und gemeinsame Liste sowie das Sammelboard aber noch eigene blaue Buttons,
große runde Felder und feste helle Farben. Sie verwenden jetzt die gemeinsamen Controls und
Theme-Tokens. Die Chat-Eingabe erhält ebenfalls die Signal-Kontur. So kommt der gewählte
Entwurf auch in den mitgelieferten Mini-Apps an. Vorhandene Run-Quellen werden nicht umgeschrieben.

## Actor-Oberflächen für Benutzer Mini-Apps nennen (12.09.2026)

Kapitel: overview, actor-programs, plugins. Der Owner möchte die Bezeichnung Mini-App für die
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

Kapitel: plugins, actor-programs, overview. Gewählt ist Signal aus den Control-Entwürfen. Die bestehenden
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

Kapitel: plugins, actor-programs. Auswahlmenüs wurden von begrenzten Composer-Flächen
abgeschnitten. Das gemeinsame SelectMenu verwendet deshalb den nativen Popover-Toplayer und
passt seine Position an den verfügbaren Platz an; DOM-Zugehörigkeit und Dialogkontext bleiben
erhalten. Die Chat-Eingabe leert einen gültigen Auftrag nun sofort beim Absenden. Bei Fehlern
kehrt der Auftrag automatisch zurück, solange kein neuer Text geschrieben wurde; andernfalls
bleibt er separat zum bewussten Einfügen verfügbar. So bleiben sowohl der neue Entwurf als
auch der fehlgeschlagene Auftrag samt Anhängen erhalten.

## Canvas-Licht und runde Dialogaktionen deutlicher gestalten (11.09.2026)

Kapitel: plugins, actor-programs, overview. Der Aquaglass-Canvas erhält eine zusammenhängende
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

Kapitel: overview. Der Owner möchte bisherige und künftige UI-Drafts dauerhaft in der bestehenden
Übersicht wiederfinden. Die Regel steht ausdrücklich in der Projekt-AGENTS.md und in den
globalen Codex-Arbeitsanweisungen: neue Tabs ergänzen, vorhandene erhalten und fehlende ältere
Entwürfe nachtragen. Team-Raster, Gesprächsrunde und Synth-Oberflächen sind jetzt ebenfalls
in docs/ui-drafts/index.html eingetragen.

## Vorschauaktionen sichtbar am unteren Rand halten (11.09.2026)

Kapitel: plugins, actor-programs. Bei langen Vorlagen scrollte die gesamte rechte Detailfläche
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

Kapitel: plugins, actor-programs, overview. Nach den Canvas-Entwürfen fällt die Wahl auf Aquaglass:
plastische, durchscheinende grünblaue Flächen mit hellen Kanten und kleinen Eckradien.
Gerade Karten behalten ihre klare Ausrichtung; TypeScript-Actors verwenden dafür denselben
rechteckigen CSS-Aufbau statt des SVG-Umrisses mit abgeschnittenen Ecken. Gemeinsame Tokens
verbinden Host, Canvas und Actor-View-Controls. Hell, Dunkel und System bleiben die vorhandene
Darstellungswahl; eine zusätzliche Stilauswahl ist nicht nötig. Das Homepage-Schema folgt der
neuen Gestaltung. Die alte Textanalyse-Aufnahme wird bis zu einem neuen echten core-Lauf
entfernt, damit die öffentliche Seite keine überholte Oberfläche zeigt.

Für die Mini-App-Controls fällt die Wahl anschließend auf Variante B, Fluss, aus dem Control-Entwurf.
Offene Eingabefelder und weichere Schaltflächen übernehmen die Aquaglass-Farben. Der Stil gilt
über einen Marker nur innerhalb der Mini-Apps und ihrer Referenzdemos; die gemeinsame
React-Implementierung und ihre Props bleiben erhalten. So schließen sich die App-Inhalte an
den Canvas an, ohne die Bedienelemente des Hosts ebenfalls auf Fluss umzustellen.

## Startauswahl und Auftragsvorbereitung mit gemeinsamen Controls (11.09.2026)

Kapitel: plugins, actor-programs. Gewählt ist Variante C aus den Offline-Entwürfen, weil die
bisherigen Karten kaum unterscheidbar waren. Eine gruppierte Liste mit Vorschau nutzt deshalb
den neuen gemeinsamen `ListDetail`-Baustein, auch für Actor-Views und den öffentlichen Katalog.
Die originale Quassel-Eingabe verwendet dieselbe begrenzte Breite wie der Chat. Eine Promptkarte
führt in einen zweiten Modalschritt: Der Benutzer arbeitet den Auftrag dort mit der KI aus
und startet den Run getrennt. Der Vorbereitungsaufruf nutzt dieselbe Modellwahl, erzeugt aber
keinen Run und kein Arbeitsverzeichnis. So bleibt Besprechen eine ausdrückliche Vorstufe zur
Ausführung. Laufende Modelländerungen sperren die Sendeaktionen bis zum gespeicherten Stand.

## Automatische Überschriften getrennt konfigurieren und zeitnah anzeigen (11.09.2026)

Kapitel: profiles, plugins, core. Der Owner möchte ein kleines aktuelles Gemma für Listenüberschriften.
Die Vorgabe ist deshalb Gemma 4 A4B (`google/gemma-4-26b-a4b-it`). Der bestehende Host-Dienst
besitzt eine eigene gespeicherte Modellwahl, ausgeschaltetes Reasoning, kleine Ein- und
Ausgabebudgets und eine begrenzte Laufzeit ohne Client-Wiederholungen. Nach dem Speichern
meldet der Server den fertigen Titel an offene Run-Listen; bis dahin bleibt der Auftrag sichtbar.
Bereits gespeicherte und ausdrücklich gesetzte Titel bleiben erhalten. Die Auswahl erlaubt
weitere geeignete Modelle und das Abschalten, ohne Agentenmodelle zu verändern.

## Actors erreichbar halten, Canvas-Sichtbarkeit persönlich wählen (11.09.2026)

Kapitel: plugins, actor-programs. Eine Mini-App erschien bisher zusätzlich zur Canvas-Karte ihres
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

Kapitel: overview. Der Owner möchte Animationen, die den Wert der Funktionen sichtbar machen.
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

Kapitel: core, plugins, actor-programs. Nach der Aktivierung eines Actor-Programms behielt der laufende
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

Kapitel: overview, core, typescript-platform, actor-programs, plugins, profiles. TypeScript- und
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

Kapitel: plugins, overview. Der Owner möchte pro Promptkarte nur den bisherigen freien Auftrag.
Die technische Fassung und die Auswahl zwischen Technisch und Frei entfallen aus Karten,
Plugin-Vertrag, Einstellungen und öffentlicher Referenz. Ein Klick auf die Karte übernimmt
den Auftrag in die Eingabe. Die Kartendateien enthalten nach dem Kopf direkt den Prompt;
die freien Texte bleiben unverändert. So braucht derselbe Einstieg nur einen Inhalt und eine
Aktion.

## Mini-Apps und Run-Programme auf natives TypeScript umstellen (10.09.2026)

Kapitel: overview, core, typescript-platform, actor-programs, plugins. Die bisherigen Mini-App-
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
Es gibt keine Kompatibilitätsschicht oder Migration alter App- und Scriptstände; die
vorhandenen Läufe sind auf ausdrücklichen Auftrag gelöscht. Das umgesetzte TypeScript-Konzept entfällt.

## Homepage mit GSAP ScrollTrigger auf die Kernfunktionen konzentrieren (10.09.2026)

Kapitel: overview. Der Owner möchte eine bewegtere Homepage, auf der die wichtigsten Funktionen
früher sichtbar werden. Eine Textstrecke mit rechts fixierter, wechselnder Grafik ersetzt die
bisherige vollflächige Bühne und die anschließende doppelte Erklärung von Agenten, TypeScript
und Mini-Apps. Der kürzere Einstieg führt direkt dorthin; die Oberfläche und vertiefende
Funktionen folgen im normalen Seitenfluss. Die vorhandenen HTML-/SVG-Schemata zeigen die
Zusammenhänge ohne neue Bildressourcen. GSAP und ScrollTrigger werden als festgelegte lokale
Paketversion gebündelt, damit auch der statische Export ohne CDN funktioniert. Kleine Ansichten,
reduzierte Bewegung und Druck ordnen die Grafiken ihren Texten zu; Details bleiben aufklappbar.

## Dialogfähigkeit der Mini-Apps entfernen (10.09.2026)

Kapitel: overview, typescript-platform, actor-programs, plugins. Mini-Apps sollen kleine
Anwendungen auf dem Canvas sein. Die zusätzliche journalisierte Dialogansicht brachte eigene
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

Kapitel: actor-programs. Kleinere App-Fenster allein ließen die enthaltenen Schriften und
Steuerelemente zu groß gegenüber der restlichen Oberfläche erscheinen. Der Canvas-Host
stellt deshalb den gesamten Frame-Inhalt mit 80 Prozent und entsprechend größerem inneren
Viewport dar. Das greift auch für installierte Apps mit fest definierten Pixelgrößen;
ein neuer App-Build ist dafür nicht erforderlich. Vollansicht und App-Dialog behalten ihre
Originalgröße, die Fensterbedienung folgt weiterhin den gemeinsamen Host-Größen.

## Dialogbereiche, Kurzantworten und Kopfzeilenbedienung präzisieren (09.09.2026)

Kapitel: plugins, core, actor-programs. Drei reguläre Dialogbereiche machen die Abdeckung
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

Kapitel: plugins, core, actor-programs, typescript-platform. Dieselben Werkzeugbeschreibungen
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

Kapitel: plugins, actor-programs. Der Owner hat Studio aus der Gestaltungsstudie als Grundlage
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

Kapitel: plugins, actor-programs. Haupteinträge der Kopfzeile nutzen wie die Übersichtsecke die
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

Kapitel: actor-programs. Die Bindung der vollständigen Mini-App-Anleitung an das direkt verfügbare
Nachschlagewerkzeug vergrößerte auch den initialen Kontext fachfremder Aufträge. Eine kurze
Einführung beschreibt deshalb zunächst die Fähigkeit. Die vollständige Anleitung folgt beim
ausdrücklichen Abruf mit `mini_app_controls` und `topic: "guide"` aus der gerenderten Promptdatei.
Sie ist kein registrierter Systemprompt-Beitrag. Das anschließende Öffnen der Bauwerkzeuge mit
`tool_open` liefert deren Verträge und bettet die Anleitung nicht erneut ein. Damit dupliziert
die Folge aus Nachschlagen und Werkzeugöffnung den langen Text auch in späteren Turns nicht.
Der direkte Control-Katalog und die automatisch aus TypeScript gewonnenen Einzelverträge bleiben
erhalten; eine Control-Auswahl beim Abruf der Anleitung ist ein ausdrücklicher Eingabefehler.

## Eingabehilfen im Feld und kompaktere Controls (09.09.2026)

Kapitel: actor-programs. Separate Beschreibungszeilen beanspruchten in Werkzeugkarten viel Höhe.
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

Kapitel: actor-programs. Bei falschen Mock-Antworten verdeckte bisher ein vollständiger Ergebnistyp
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

Kapitel: actor-programs. Eine einzelne Control-Abfrage lieferte bisher sämtliche UI-Typdateien.
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

Kapitel: plugins, actor-programs. Der Inspector zeigte auch die eigenen Antworten des ausgewählten
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

Kapitel: overview. Der Owner möchte die Kernfähigkeiten visuell stärker inszenieren und den
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

Kapitel: plugins, actor-programs. Die Kamera erkannte bisher vor allem vertikal überlaufende
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

Kapitel: plugins, actor-programs. Die Run-Liste lag in einem seitenweiten Dialog, der übergeordnete
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

Kapitel: actor-programs, plugins. Große anfängliche Appfenster nahmen auf dem Canvas viel Platz
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

Kapitel: actor-programs. Für Redaktionsnotizen oder Prüfstatus braucht eine Mini-App häufig
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

Kapitel: actor-programs, plugins. Ganz ohne Rahmen fehlten den Canvas-Apps erkennbare Grenzen
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

Kapitel: actor-programs, plugins, overview. Die zusätzliche App-Vollansicht im rechten Reiter
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

Kapitel: plugins, actor-programs. Die Oberfläche hatte über dreißig eigene Schaltflächen-Stile:
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
Der Wunsch nach erklärenden Illustrationen ergänzt die bisherige Screenshot-Regel.
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

Kapitel: overview, plugins, actor-programs. Verschachtelte Kopfzeilen und Rahmen machten kleine
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

Kapitel: core, plugins, actor-programs, overview. Der globale Koordinator soll nach einem erledigten
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

Kapitel: overview. Die verdichtete Faktenliste war zu trocken und ließ den Einstieg
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
`llms.txt`-Index, einzelne Markdown-Referenzen und `run-api.d.ts`.
Die API verwendet den echten Compiler-Deklarationsgenerator mit den registrierten core-Verträgen;
Beispiele übernehmen sämtliche Dateien der mitgelieferten Run-Script-Pakete. So sind auch Tests
und eingebettete Mini-Apps nachvollziehbar, ohne eine zweite API-Liste zu pflegen. Der normale
Referenzcheck prüft Drift und kompiliert die Beispielquellen gegen die veröffentlichte API.

## Einstellungen nach Extension oder Fähigkeit (06.09.2026)

Kapitel: plugins. Der Owner möchte sowohl von einer Extension ausgehen als auch sehen können,
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

Kapitel: overview. Zum Bauen fehlte der direkte Zugang zur fertigen Seite. Der Task
`open: homepage` und der Alias `pnpm open:homepage` verwenden `build/open-homepage.sh`.
Das Skript öffnet auf macOS die lokale Datei-URL im Standardbrowser; ein Neuaufbau ist ein
eigener Task. Die URL wird aus dem Dateipfad erzeugt, damit auch Leerzeichen korrekt bleiben.

## Gemeinsame Dropdowns und einstellbarer globaler Koordinator (06.09.2026)

Kapitel: core, plugins, profiles. Der Owner möchte Modell und Reasoning-Tiefe des übergeordneten
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

Kapitel: overview. Der Owner möchte VS-Code-Tasks ohne eigene Ablauflogik und einen gemeinsamen
Ordner `build` für die aufgerufenen Skripte. Die Tasks starten deshalb ausschließlich Bash-
Skripte unter `build/`; auch die bisherigen pnpm-Befehle delegieren dorthin. Reihenfolgen und
Fehlerbehandlung stehen damit einmalig im Skript statt verteilt in Editor- und Paketkonfiguration.
Der Standardbuild erzeugt Agentenlaufzeit, Web und Homepage; die Gesamtprüfung behält ihre
bisherigen Schritte. Nur `.vscode/tasks.json` wird aus dem ignorierten Editorordner freigegeben.

## Öffentliche Baustein- und Entwicklerreferenz (06.09.2026)

Kapitel: overview. Der Owner möchte die vorhandenen neutralen Bausteine sichtbar machen und alle
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

Kapitel: core, plugins, actor-programs. Der Owner möchte Bilder aus der Zwischenablage und Dateien
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

Kapitel: overview, core. Der Owner möchte die Fähigkeiten über ihren Nutzen und ihre Konstruktion
erklären: vorbereitete Setups, programmierte Ablaufregeln und eigene Mini-Oberflächen stehen
deshalb vor den weiteren Funktionen. Die Homepage verbindet kurze Erklärungen mit aufklappbaren
technischen Details. Das Journal erhält ein lokales, interaktives Lesebeispiel und eine Erklärung
von Command-Records, Events, Projektion und Neustartgrenzen. Der falsche Satz in der README,
eine Journalzeile sei immer genau ein Event, wird samt Beispiel korrigiert.

Weil parallel entwickelt wird, werden keine neuen Läufe aufgenommen. An den Bildstellen stehen
deshalb ausdrücklich beschriftete Platzhalter; die Homepage-Regel erlaubt diese Zwischenform.
Refactoring und Unternehmensabläufe bleiben als Anwendungsideen gekennzeichnet und werden in
`docs/concepts/homepage-use-cases.md` geführt. Die Prüfungen betreffen ausschließlich die statische
Homepage. Die Anwendung und ihre Laufzeitdaten werden dafür nicht gestartet oder verändert.

## Run-Liste als Dropdown und direkter Zugang zum Koordinator (06.09.2026)

Kapitel: plugins. Der Owner möchte die Run-Liste links oben über der Arbeitsfläche öffnen, ohne
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

Kapitel: plugins. Der Owner möchte die beiden Kopfbereiche zusammenführen und mehr Platz für die
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

Kapitel: plugins. Der Owner möchte die Startfläche übersichtlicher gestalten. Die Auftragseingabe
steht jetzt allein oben, darunter folgen die vorhandenen Startoptionen und getrennte Bereiche
für durchsuchbare Promptvorlagen sowie vorbereitete Skills und Run-Scripts. Der eigenständige
Eingabebaustein braucht keine Nachrichtenliste oder Chat-Fläche um sich herum. Eine Promptfassung
ersetzt den Entwurf und fokussiert ihn; sie startet weiterhin keinen Lauf. Die Modellwahl nutzt
das gemeinsame Auswahlmenü mit kompakter Denktiefe daneben.

Die Neuordnung erhält den Plugin-Vertrag: Nur wählbare, noch nicht gesperrte Startoptionen werden
angeboten. Freigaben aus dem Profil, Leitfäden und die bestehenden Sende- und Startwege bleiben
maßgeblich. Die Homepage und die Bedienhinweise beschreiben die neue Anordnung.

## Vorgefertigte Chat-Controls für Mini-Apps (06.09.2026)

Kapitel: actor-programs, plugins. Der Owner möchte mehr vorhandene UI-Bausteine auf dem Canvas nutzen
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

Kapitel: actor-programs, plugins. Der Owner möchte die kleinen Bedienoberflächen auf dem Canvas stärker
in den Vordergrund stellen. Die zusätzliche Kopfzeile mit App-Icon, Titel und Einklapp-Knopf
entfällt; die App bekommt die gesamte Fläche. Laufzeitmeldungen wandern kompakt an den unteren
Rand, Skalieren bleibt möglich. Mit dem einzigen Nutzer entfällt auch die Einklapp-Logik aus dem
Canvas-Beitragsvertrag und dem Layout. Die Hervorhebung anhand des rechts gewählten Reiters und
der harte Schlagschatten entfallen ebenfalls. Der Agentenprompt bevorzugt Canvas-Platzierungen
für neue Bedienoberflächen. Eine spätere Ablösung des rechten Panels bleibt als Richtung in TODO;
die vorhandenen Reiter bleiben nutzbar.

## Seitenweiter Koordinator und getrennte Dialogbereiche (06.09.2026)

Kapitel: plugins, core, profiles, actor-programs. Der Owner möchte einen jederzeit erreichbaren Chat
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

Kapitel: plugins. Auftrag: die Koordinator-Chat-View vom Canvas entfernen.
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

Kapitel: plugins, core, typescript-platform. Gewünscht war das Run-Script-Feature komplett, also
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
die Frage war, wie sich solche Locks verhindern lassen. Befund: SIGINT und SIGTERM
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

Kapitel: plugins. Rückmeldung zum ersten Stand der Startfläche: Skills und vorgebaute Runs sollen
nicht in Kästen gruppiert sein. Die zwei gerahmten Bereiche Skills und Vorgebaute Runs mit ihren
Kopfzeilen und der Gruppierung nach Plugin sind weg. Neben dem Chat-Control steht jetzt EINE Fläche
mit den Einstiegen, die den Run ohne Nachricht starten, als Karten direkt auf dem Grund: heute die
Starter mit dem Abzeichen Skill und dem Plugin klein an der Karte, später die Run-Scripts als
weitere Karten (`apps/web/src/StartSurface.tsx`, `start-layout`, `start-entries`, `entry-grid`).
Die Promptkarten bleiben unverändert Teil des Chat-Controls. Entwurf 5 der Mockups ist
nachgezogen.

## Produkt-Homepage unter docs/homepage (05.09.2026)

Kapitel: keines; geändert sind AGENTS.md (Dokumentation, Arbeitsregel 6) und README (Weiterlesen).
Neben Spec und Konzepten soll eine Homepage für Benutzer mitgepflegt werden: Produktsicht statt
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
Vorgabe: kein Werbeprospekt, eine nüchterne Beschreibung, was das Ding ist und was es kann, mit
einem Satz "RAgents ist ..." am Anfang. Festgelegt: Stimme der README, Überschriften benennen die
Sache, Fließtext statt Bullets, nur echte Screenshots (Schemata gestrichen), Promptkarten als
schlichter Satz "Zum Ausprobieren", ein Drittel der Länge, eine Spalte mit den Tokens und der Schrift
der App, keine Karten, Schatten oder externen Ressourcen. Der Text wurde erst als Rohfassung
freigegeben, dann ins HTML übernommen.

## Neuer Run und Startfläche statt leerem Chat (05.09.2026)

Kapitel: plugins. Erster Schritt des Konzepts `docs/concepts/run-start.md`. Einwand des Owners:
"Neue Unterhaltung" ist ein neuer Run, und der Composer ist nicht der einzige Einstieg, sondern
einer unter den Karten, die Plugins mitbringen. Festgelegt:

- Wording im Web: "Neuer Run", "Runs", "Run löschen"; der Standardtitel `runTitle` beider
  Produkt-Plugins ist "Neuer Run". Unterhaltung bleibt in Prosa und Spec das erklärende Wort.
- Die Startfläche ist ein eigener Zustand des Entwurfs (`apps/web/src/StartSurface.tsx`), nicht
  mehr der `emptyState` der Nachrichtenliste: die Startoptionen als Zeile oben, darunter drei
  gleichberechtigte Bereiche nebeneinander (Entscheidung des Owners, Entwurf 5 der Mockups): der
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

Kapitel: actor-programs, typescript-platform, core, plugins, profiles, overview. Schritt 2 des
Doku-Umbaus: `docs/concepts/mini-apps.md` und `docs/concepts/typescript-platform.md` sind in
`actor-programs.md` und `typescript-platform.md` aufgegangen und gelöscht, die Übergangssätze am
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

Kapitel: plugins. Jede Layoutgruppe bekam automatisch einen gestrichelten Rahmen; gewünscht ist
das nicht als Automatik, sondern als Entscheidung des Modells je Gruppe. Festgelegt: eine Gruppe
zeigt ihre Beschriftung (`label`) immer als Überschrift, einen Rahmen zeichnet sie nur mit
`frame: true` (Standard false). Der automatische Bereich "Nicht platziert" trägt nur die
Überschrift. Intern ist `frame` ein Pflichtfeld mit Wert, kein Optional.

## Dokumentation: Spec, Konzepte, Entscheidungen (04.09.2026)

Kapitel: alle. Die Dokumentation hatte drei Quellen für "was ist" ohne Vorrang: das
Architekturdokument, die Wissensbasis und zwei umgesetzte Konzeptpapiere, deren Kurzfassung im
Architekturdokument stand. Festgelegt:

- `docs/spec/` ist die Spec: was ist, gültig für HEAD, ein Kapitel je Thema (overview, core,
  typescript-platform, actor-programs, plugins, profiles). Jedes Kapitel endet mit seinen offenen
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
  Claude-Memory wird nicht benutzt, weil der Owner auf mehreren Rechnern arbeitet; alles für neue
  Sessions Wichtige steht im Repo.
- `HANDOFF.md` ist aufgelöst: die Arbeitsregeln stehen in `AGENTS.md`, der Testweg des
  Feature-Laufs in `docs/operations.md`, der Rest in `TODO.md`.

## Prozesse und Ports eines Laufs stehen in der Kopfzeile (03.09.2026)

Wunsch des Owners: startet ein Agent während eines Laufs einen Prozess (Node, dotnet, vite, ...) und
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

Der Owner wollte einen kleinen Dialog in der Werkstatt und fragte, wo der Unterschied zwischen
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
- Antwort auf die Frage: Mini-App-Handler und Actor-Skripte teilen sich denselben
  `runContextNamespace` - `context.state.read/replace` und `context.capabilities.call`. Verschieden
  sind nur drei Dinge: `std` gibt es allein im Skript, ein Handler liefert ein Ergebnis statt eines
  Folgezustands, und der Capability-Vorrat kommt beim Bedienerpfad aus den registrierten
  Operationen statt aus den Werkzeugen des Zielagenten.

## Profile sind Rollen, das Modell wählt der Spawn (02.09.2026)

Einwand des Owners beim Blick auf die Profilliste: Modelle an Profile zu pinnen ist falsch. Die
Engine kann es längst anders: `agent_spawn` nimmt `model` und `thinking` aus der Modellliste
zusätzlich zum Profil an (`ExecutionRequest`), ein Profil liefert nur Treiber, Provider,
Denktiefe, Timeout und Workspace-Vorgabe. Deshalb gibt es in einem Produkt-Plugin keine
`review-<modell>`-Profile und keine eigene Modellliste je Profil mehr, sondern genau drei Rollen:
`coordinator`, ein Herstellermandat (herstellen, gründlich lesen) und `reviewer` (Lesemandat).
Welche Modelle zur Wahl stehen, sagt allein `AGENT_MODELS`; der Skill verlangt je Prüfer ein
anderes Modell aus dieser Liste. Ein Modell wechseln heißt damit Konfigurationsliste ändern,
nicht Profile umbauen.

## Starter mit Leitfaden, Dialog und Auswahlmenü als Systembausteine (02.09.2026)

Wunsch des Owners: Einstiegspunkte sind nicht nur Promptkarten, sondern Skills, die ein Plugin als
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

Zwei Prinzipien des Owners für alles, was ein Modell bauen oder aufrufen soll:

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
der Scope `@ragents/*` ist unserer, bis zum 23.09.2026 `@aicontainer/*`) in ZWEI Paketen: `ai` ist
die LLM-Anbindung (nur der Provider openrouter, seit dem 13.09.2026 über AI SDK Core), `agent` sind
Agenten-Schleife (`src/loop/`, bis zum 24.09.2026 das Paket `agent-core`), Session und Werkzeuge.
Das vierte Paket `tui` (Terminal-UI) ist entfernt - ein Web-Produkt hat keine Terminal-Oberfläche.
Diese eigenen Eingriffe prägen das Verhalten; die Liste wird mit jedem Eingriff nachgeführt.
Herkunfts- und Abweichungsdokumente sind bewusst entfallen - was zählt, steht hier. In Klammern
steht, wo ein Eingriff geprüft wird.

- Steering ist eine Quelle, keine Warteschlange: `Agent.steeringSource` wird vor der ersten
  Modellanfrage und nach jeder Antwort samt ihren Werkzeugergebnissen abgefragt, was sie liefert,
  geht vor die nächste Anfrage, auch nach einer Schlussantwort; eine Ablehnung beendet den Lauf mit
  ihrem Fehler. `steer`, `followUp`, die Warteschlangen samt `QueueMode`, `queue_update`,
  `streamingBehavior` und das Weiterlaufenlassen von Werkzeugen im Hintergrund sind entfernt; ein
  Werkzeugaufruf läuft bis zu seinem Ergebnis, Steering wartet darauf (Eintrag vom 24.09.2026 zum
  Steering, `packages/agent/tests/steering.test.ts`, über die Engine in
  `packages/ragents/tests/steering.test.ts`).
- Der Systemprompt eines langlebigen Agenten ist nicht mehr unveränderlich:
  `AgentSession.setSystemPrompt` (plus `ResourceLoader.setSystemPrompt`) setzt ihn neu und erhält
  die Unterhaltung - nötig, damit werkzeuggebundene Prompt-Kapitel nach einem `tool_open` ab dem
  Folgeturn dazukommen (über die Engine in `packages/ragents/tests/agent-runtime.test.ts`).
- Das Edit-Werkzeug nennt bei mehrdeutigem `oldText` die Fundstellen mit Zeilennummern, statt nur
  zu scheitern. Optionale Anker: `occurrence` (n-tes Vorkommen), `nearLine` (nächstgelegenes,
  Gleichstand ist ein Fehler), `replaceAll` (nicht mit Anker kombinierbar).
- Ein Edit überschreibt nichts, was nach dem letzten Lesen entstanden ist: das Read-Werkzeug
  liefert einen SHA-256 des Dateiinhalts, das Edit-Werkzeug prüft ihn als `expectedHash`
  innerhalb der Datei-Mutationssperre und gibt den neuen Hash zurück (beide in
  `packages/agent/tests/edit-contract.test.ts`).
- Ein eigener Systemprompt (`customPrompt`) bleibt, wie der Aufrufer ihn gibt: `buildSystemPrompt`
  hängt ihm keine Zeile `Current working directory: ...` an; nur der Standardprompt des Upstreams
  nennt den Ordner. RAgents gibt immer einen eigenen Systemprompt, und das Arbeitsverzeichnis nennt
  dort allein die Beschreibung des Arbeitsbereichs (`packages/agent/tests/system-prompt.test.ts`,
  Eintrag vom 24.09.2026 zu Stopp, Handles und Werkzeugaufrufen). Dieser eine Eingriff ersetzt die
  früheren Optionen `omitCwd` und `workingDirectory`; `cwd` ist wieder nur der Ordner der Laufzeit.
- Eine Antwort ohne Text und ohne Werkzeugaufruf beendet die Schleife nicht sofort: sie stößt
  einmal mit `EMPTY_RESPONSE_NUDGE` nach, eine zweite leere Antwort endet als Fehler
  (`packages/agent/src/loop/agent-loop.ts`, `packages/agent/tests/empty-response.test.ts`).
- Der Aufrufer formuliert die Meldung für ein unbekanntes Werkzeug selbst
  (`formatUnknownToolError` in `packages/agent/src/loop/types.ts`); die Engine verweist dort auf
  `typescript_api` und `context.functions`. Den Weg prüft `packages/ragents/tests/tool-validation.test.ts`,
  die Formulierung selbst kein Test.
- Die zwei `package.json` laden zur Laufzeit die TS-Quellen (`main`/`import` auf `src/*.ts`),
  der Typecheck sieht die generierten `dist/*.d.ts` (`types`).
- Denktiefe `off` sendet bei openrouter explizit `reasoning: { enabled: false }` statt gar
  nichts - sonst greift der Modell-Default und das Modell denkt trotzdem
  (`packages/ai/src/api/ai-sdk.ts`, `packages/ai/tests/openrouter-streaming.test.ts`).
- Die Werkzeug-Validierungsmeldung wiederholt die empfangenen Argumente NICHT mehr (sie stehen
  schon im Tool-Call davor); sie nennt nur die Feldfehler und fordert zur Korrektur auf, bei
  Enum-Fehlern samt empfangenem Wert und den erlaubten Werten, ein Pfad nur einmal
  (`packages/ai/src/utils/validation.ts`, `packages/ai/tests/validation.test.ts`,
  `packages/ragents/tests/schema-errors.test.ts`).
- Die Laufzeit sucht, lädt und installiert nichts: eine Erweiterung ist nur eine Inline-Fabrik,
  Paketverwaltung, Erweiterungen aus Dateien, Prompt-Vorlagen und Projektdateien wie `AGENTS.md`
  oder `SYSTEM.md` gibt es nicht. Strukturell ausgeschlossen, daher ohne eigenen Test (Eintrag vom
  24.09.2026 zum Einschmelzen der Agentenlaufzeit).
- Die Erweiterungs-API hat genau drei Ereignisse, `before_agent_start`, `context` vor jedem
  Modellaufruf und `tool_result`, dazu `registerTool`, `getAllTools`, `setActiveTools` und
  `appendEntry`; der Kontext eines Handlers trägt `signal`, `model` und `sessionManager`. Nach dem
  Beenden der Sitzung wirft jeder Zugriff einer Erweiterung (über die Engine in
  `packages/ragents/tests/agent-runtime.test.ts`).
- Einstellungen sind ein Wert, keine Datei: `AgentSettingsInput` mit Kompaktierung, Wiederholung und
  Anfragezeitgrenzen, sonst feste Vorgaben; nichts wird zurückgeschrieben. Zugang kommt nur als
  API-Schlüssel aus der Registrierung eines Anbieters, wörtlich genommen, oder beim eingebauten
  Anbieter aus `OPENROUTER_API_KEY`; `auth.json`, `models.json`, `!befehl`- und `$VARIABLE`-Werte,
  OAuth und Anmeldung gibt es nicht. Eine ungültige Registrierung wirft
  (`apps/server/tests/overseer-reset.test.ts` registriert über das Profil).
- Skills liest die Laufzeit nicht selbst: der Host prüft jede SKILL.md und reicht Name,
  Beschreibung, Pfad und `disable-model-invocation` weiter; die Laufzeit formatiert daraus nur die
  Katalogzeilen des Systemprompts.
- Eine Sitzung ohne Modell ist ein Fehler; es gibt keine Modellsuche aus Einstellungen oder
  Standardanbietern.

Die vendorierten Testsuiten waren zu 60 Prozent rot und liefen in keinem `check`; sie sind samt
Vitest entfernt, das Repo testet überall mit `node --test`. Die alte Werkzeug-Suite (84 grüne
Tests) steht in der Historie unter `vendor/pi/coding-agent/test/tools.test.ts` (bef8c23) und ist
die Vorlage, wenn die Abdeckung der Werkzeuge neu aufgesetzt wird.

## Ein Profil ist eine Datei, kein Paket (01.09.2026)

`ragents.config.<profil>.ts` nennt Produkt (`PRODUCT_ID`, `PRODUCT_TITLE`), Pluginliste
(`PLUGINS`) und die Konfiguration aller beteiligten Plugins. Es gibt kein Preset und keinen
Default mehr: fehlt der Wert oder die Datei, startet der Server nicht.

Das frühere Produktprofil-Paket ist ersatzlos entfallen. Einwand des Owners: Profile werden
AUS Paketen gebaut, sie werden nicht IN einem Paket gesammelt. Dazu hielt es eine dritte,
handgepflegte Kopie der Pluginliste - Server und Web kennen ihre Plugins ohnehin, weil sie ihre
Ordner absuchen. Das Web prüft die Antwort des Servers seitdem nicht mehr gegen eine eigene Liste;
der Server ist die Autorität.

## Plugins werden geprobt, nicht kompiliert verdrahtet (31.08.2026)

Vorgabe: keine statischen Imports; Plugins werden wirklich dynamisch zur Laufzeit gefunden, per
Probing, wie Pakete in Visual Studio Code.
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
