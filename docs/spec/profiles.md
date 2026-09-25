# Profile und Konfiguration

## Profile

Das Repository bringt drei neutrale Profile mit: `core` ist die Werkstatt mit allen neutralen
Plugins und ohne Beispiele, `showcase` dasselbe Profil samt dem Beispielplugin
`ragents.reference`, `developer` das Programmierprofil für die Arbeit am eigenen Rechner
(Arbeitsbereich, Dokumente, Orchestrierung, Roslyn, FSAC und TypeScript, ohne Anmeldung über
`anonymousUser`, Modelle über OpenRouter mit `OPENROUTER_API_KEY`). Vorlagen für eigene
Profile sind `core` (echtes Profil) und `developer` (Ad-hoc-Profil); eine eigene Beispieldatei gibt
es nicht.

| Profil | Port | Anmeldung | Beispiele aus `ragents.reference` |
| --- | --- | --- | --- |
| `core` | 4710 | ohne Benutzerliste aus, `ACCESS_TOKEN` möglich | nein |
| `showcase` | 4713 | wie `core` | ja, 27 Skills und 6 Run-Scripts |
| `developer` | 4715 | `anonymousUser` mit allen Rechten | nein |

Der Serverport steht unter `host.PORT` in der Profildatei: `core` verwendet 4710,
`showcase` 4713, `developer` 4715. Eine ausdrücklich gesetzte Umgebungsvariable `PORT` überschreibt
diese Vorgabe. Zulässig sind ganze Zahlen von 1 bis 65535; `PORT=0` ist kein Startmodus.
`scripts/start.sh` prüft den festen Port vor dem Start. Der Server prüft ihn nach dem Laden
der Konfiguration erneut, bevor er Plugins initialisiert. Ein belegter Port ist ein klarer
Startfehler; es wird weder eine andere Adresse gewählt noch eine laufende Instanz beendet.
Die Startmeldung nennt die feste URL und Ablage.

Mit `--dev` bleibt der Backendport gleich. Vite verwendet fest den Backendport plus 1000, für
`core` also 5710, mit `strictPort`; `API_TARGET` zeigt auf das konfigurierte Backend. Beide Ports
werden vorher geprüft und müssen verschieden sein. Ein eigenständiges `pnpm dev:web` verwendet
Port 5710 und als Proxyziel `http://localhost:4710`, ebenfalls mit `strictPort`.

Plugins werden zur LAUFZEIT gefunden, nicht kompiliert verdrahtet, und nur als fertige Bundles.
Eine Kennung im Profil ist ein eingebautes Bundle unter `bundles/<id>/` (gebaut mit
`pnpm build:plugins` aus `plugins/<id>/`), ein Pfad ein Bundle-Ordner an beliebiger Stelle; der
Ordnername IST die Plugin-ID, der Einsprungpunkt `ragents-bundle.json`
(`profile/plugin-discovery.ts`, Manifest in `profile/bundle-manifest.ts`, Wurzeln aus
`plugin-support/plugins-root.ts`). Geladen wird nur, was das Profil nennt, und zwar per
`await import()` von `server/index.js`. Ein Quellordner statt eines Bundles, ein fehlendes Bundle
und ein Bundle mit anderem Format oder anderer Host-API sind harte Fehler, die den Befehl zum
Bauen nennen; Einzelheiten im Abschnitt Bundle, Bauwerkzeug und Host-API in [plugins.md](plugins.md).

`PRODUCT_PROFILE` (`core`, `showcase`, `developer`; kein Default, fehlend oder unbekannt ist
ein harter Startfehler) wählt die Profildatei `ragents.config.<profil>.ts` aus (Produkt-Deskriptor +
Pluginliste aus schlichten String-IDs), die optionale Variable `PLUGINS` (kommagetrennte
Plugin-IDs) überschreibt die Pluginliste der Profildatei; der Produkt-Deskriptor bleibt der der
Profildatei. Eine unbekannte Plugin-ID, ein fehlendes `requires` und eine verletzte Reihenfolge
brechen den Start hart ab - geprüft, BEVOR ein Plugin gebaut wird (`profile/compose.ts`).

Im Web gibt es keine Pluginliste zur Bauzeit: das Web des Hosts ist für jedes Profil dasselbe,
`ragents.plugins.bootstrap` nennt je aktivem Plugin die Adressen seiner Web-Hälfte, und das Web
lädt sie per `import(url)` vom Server (`apps/web/src/PluginActivation.ts`,
`plugin-bootstrap.ts`). Eine Web-Hälfte, die nicht lädt oder eine andere Kennung meldet, bleibt ein
harter Fehler.

Die Werte selbst kommen aus EINER TypeScript-Konfiguration JE PROFIL
(`ragents.config.<profil>.ts`, Sektionen je Plugin-ID plus `host`; geladen von
`apps/server/src/config-file.ts`, ausgewählt allein über `PRODUCT_PROFILE`): sie wird vor jedem
anderen Modul geladen und nur für noch ungesetzte Schlüssel in `process.env` materialisiert -
gesetzte Umgebungsvariablen gewinnen also pro Schlüssel, und jeder bestehende Konsument
(`declaredEnvironment`, `config.ts`, Kind-Umgebungen) liest unverändert weiter aus der Umgebung.
Dienst-Secrets stehen als `env("ENV_NAME")`-Referenz in der Datei. Der eigene `users`-Export
erlaubt Passwörter auf ausdrücklichen Wunsch auch im Klartext.

Neben `config`, `users` und `anonymousUser` kann eine Profildatei einen vierten Export
`defaultStartEntry` haben: die Kennung der Vorlage, die ein neuer Run ohne Auswahl nimmt.

```ts
export const defaultStartEntry = "ragents.reference.word-game";
```

Der Wert ist ein String in der Form einer Vorlagenkennung (`config-file.ts`,
`resolveDefaultStartEntry`); er wird nicht in die Umgebung materialisiert. Der Start prüft beim
Versiegeln des `PluginHost` (`profile/compose.ts` gibt ihn als `defaultStartEntry` weiter), dass ein
Plugin des Profils genau diese Vorlage registriert hat, sonst bricht er mit der Liste der
registrierten Vorlagen ab. `ragents.plugins.bootstrap` liefert ihn als `defaultStartEntry` nur
an Benutzer, für die die Vorlage freigegeben ist (`publicProfile`); ohne Freigabe fehlt das
Feld, die übrigen Vorlagen bleiben. Die VS-Code-Erweiterung nimmt den Default für das Plus am
Server-Chip, die erste Vorlage unter Start und die erste Zeile je Server in `RAgents: Neuer
Run` ([usage.md](../usage.md), Abschnitt Run panel and VS Code extension). `core`, `showcase` und
`developer` setzen keinen Default.

Validiert wird gegen die EINE Wahrheit der deklarierten Deskriptoren, jetzt zweistufig. Schon der
COMPILER prüft: `apps/server/src/config-definition.ts` leitet den Typ `RAgentsConfig` aus
`hostConfigDescriptors` und den Deskriptoren der Plugins ab (reine Typ-Importe, zur Laufzeit
nicht vorhanden), sodass eine unbekannte Sektion, ein unbekannter Schlüssel und ein Secret im
Klartext den Build brechen. Beim START bleiben: fehlende Referenz, doppelter Schlüssel mit
abweichendem Wert, Prüfung jeder Plugin-Sektion nach der Komposition gegen die im `PluginHost`
registrierten Konfigurationsdeklarationen; Sektionen bekannter, aber inaktiver Plugins werden mit
Hinweis ignoriert.
Listen stehen in der Datei als echte `string[]` und reisen als JSON-Array durch die Umgebung -
`process.env` ist eine String-Map und bleibt der Transport zu Sandbox-bash, Language Servern und
der Agent-Runtime.

Die Sektion ist Dokumentation und Prüfrahmen, KEIN Namensraum: jeder Schlüssel wird unter seinem
blanken Namen in `process.env` materialisiert. Zwei Produkte mit gleichnamigen Schlüsseln
(`AGENT_MODEL`, `SYSTEM_PROMPTS_DIR`, ...) lassen sich in EINER Datei also nicht auseinanderhalten -
deshalb je Variante eine eigene Datei.

Das Profil `core` (Produkt-ID `ragents`) ist die neutrale RAgents-Variante. Es bootet ohne jedes
produktspezifische Plugin mit einem Arbeitsbereich je Run, der als Startoption gewählt
wird (Rechner: Server oder verbundener Arbeitsplatz; Ordner: neu je Run oder vorhanden), und ist damit
zugleich der gelebte Entfernungstest: Chat, Koordinator, Fläche,
TypeScript-Actors, Dokumente und Rückfragen funktionieren ohne Fachplugin. Die neutralen Gegenstücke `ragents.product` (Koordinator, Modelle, Präambel) und
`ragents.workspace` (Arbeitsverzeichnis je Run + Sandbox-Werkzeuge aus `plugin-support`) stellen die
Pflichtverträge `ProductRuntime` und `WorkspaceRuntime`. Ein Profil mit eigener Art von
Arbeitsbereich tauscht `ragents.workspace` nicht aus, sondern steuert sie über
`workspaceResolverToken` bei (Abschnitt Zuständigkeit je Facette in
`plugins.md`); der Arbeitsbereich hat damit weiter genau einen Besitzer.

Pluginliste von `core` in Reihenfolge: `ragents.orchestration`, `ragents.workspace`,
`ragents.product`, `ragents.overseer`, `ragents.activity`, `ragents.processes`,
`ragents.documents`, `ragents.browser`, `ragents.ask`, `ragents.todo`, `ragents.watch`,
`ragents.transcript`, `ragents.actor-programs`, `ragents.lsp-roslyn`,
`ragents.lsp-fsharp`, `ragents.lsp-typescript`, `ragents.model-relay`,
`ragents.profile-distribution`.

Das Profil `showcase` (Produkt-ID `ragents-showcase`, Port 4713) ist dieselbe Ausstattung und
zusätzlich `ragents.reference` hinter `ragents.actor-programs`; Anmeldung, Modelle und
Language Server entsprechen `core`. Damit bleibt `core` die Vorlage für ein echtes Profil,
während die mitgelieferten Beispiele als Lehrmaterial im Repository bleiben und mit
`./start.sh showcase` zur Verfügung stehen. Die intern erzeugte Referenz und die eingebaute Hilfe
werden aus `showcase` erzeugt (`scripts/homepage/homepage-catalog.ts` liest dessen
Pluginliste), damit sie die Beispiele weiterhin zeigen.

Das Profil `developer` (Produkt-ID `ragents-developer`, Port 4715) ist die kleinere Auswahl für
die Arbeit an einem Projekt: `ragents.orchestration`, `ragents.workspace`, `ragents.product`,
`ragents.documents`, `ragents.ask`, `ragents.todo`, `ragents.activity`, `ragents.processes`,
`ragents.lsp-roslyn`, `ragents.lsp-fsharp`, `ragents.lsp-typescript`. Es hat keine `users`,
sondern einen `anonymousUser` mit allen Rechten, weil es auf dem eigenen Rechner läuft, und
bezieht seine Modelle über OpenRouter aus `OPENROUTER_API_KEY`. Es ist das Vorgabeprofil der
Agenten-Unterbefehle (`ragents run`, Abschnitt Control RAgents as an agent in
[usage.md](../usage.md)) und die Vorlage für ein Ad-hoc-Profil: Datei kopieren,
umbenennen, Port, Produkt-Deskriptor, Plugins und Modelle ändern.

`ragents.overseer` ergänzt den globalen Koordinator im Kopf der Oberfläche. Das Plugin ist
auch im Beispielprofil enthalten. Sein Run
und die Run-Referenzen bleiben im jeweiligen Profildatenverzeichnis; der Zugriff übergreift keine
separat gestarteten Profile. Eine lokale Profildatei muss das Plugin ausdrücklich mit aufführen.

Der globale Koordinator besitzt eine eigene, im jeweiligen Profildatenverzeichnis
gespeicherte Modell- und Reasoning-Auswahl. Als anfängliche Vorgabe dient die Rolle `coordinator`.
Die Produktvorgabe für den Run-Koordinator verwendet `high`.
Bereits gespeicherte Modellauswahlen bleiben ausdrückliche Vorgaben. Als anfängliche Vorgabe verwendet die Rolle `relay` dasselbe konfigurierte Modell und dieselbe
Denktiefe wie die Rolle `coordinator`. Ein Regressionstest prüft beide Rollen gegen den echten Modellkatalog.
Danach verwenden Settings und Koordinator-Chat dieselbe Plugin-Einstellung. Änderungen gelten
ab dem nächsten Turn ohne Neustart und ändern weder die Startoptionen noch die Modelle anderer
Runs. Die zulässige Auswahl stammt aus dem konfigurierten Modellkatalog und wird gegen die
Modellfähigkeiten geprüft.

Der Modellanbieter ist `AGENT_PROVIDER` im Produkt-Plugin, Vorgabe `openrouter` mit
`OPENROUTER_API_KEY`. Mit `AGENT_PROVIDER: "relay"` kommen Katalog und Modellzugang von einem
anderen RAgents-Server: `RELAY_URL` nennt dessen Adresse, `RELAY_TOKEN` (Secret, `env(...)`) den
persönlichen Token eines Benutzers dort. Das Produkt-Plugin holt beim Start `GET /relay/v1/models`
und registriert den Anbieter `relay` über einen Profil-Beitrag (`providers` in
`ProfileContribution`) in der einen Modelllaufzeit des Servers, bevor Titelmodell, Vorbereitung
oder Engine ein Modell nachschlagen. `AGENT_MODEL`, `AGENT_COORDINATOR_MODEL`, `AGENT_MODELS`,
`COMPACTION_MODEL` (mit `COMPACTION_PROVIDER: "relay"`) und das Titelmodell nennen dann Aliasse
des Relays; die Modellauswahl zeigt sie als `relay/<alias>`. Ein nicht erreichbares Relay, eine
abgelehnte Anmeldung oder ein leerer Katalog sind Startfehler mit Adresse und Ursache. Auch ein
zur Laufzeit abgelehnter Modellaufruf nennt die Relay-Adresse vor Status und Text der Antwort.

Ein Profil kann seine Modelle unter eigenen Namen anbieten: `MODEL_ALIASES` im Abschnitt `host`
ist eine Liste `alias=anbieter/modell` oder `alias=anbieter/modell@denktiefe`
(`plugin-support/model-aliases.ts`). Das Ziel ist ein Modell aus dem eingebauten Katalog eines
Anbieters, die Denktiefe eine Stufe, die dieses Modell hat; sonst bricht der Start ab. Dieselbe
Liste gilt für die eigenen Runs und für `ragents.model-relay`. Für die eigenen Runs registriert
der Server die Aliasse unter dem Anbieter `alias` in der einen Modelllaufzeit
(`ModelRuntime.registerAliases`): Ein Alias trägt Katalogdaten und Denkstufen seines Ziels unter
seinem eigenen Namen, eine Anfrage geht mit dem echten Modell an dessen Anbieter, und jede
Antwort, jeder Zwischenstand und jede Fehlermeldung kommt mit Alias und Anbieter `alias` zurück;
frühere Antworten des Alias gelten beim Ziel als eigene, damit Reasoning-Signaturen über Turns
erhalten bleiben. Mit `AGENT_PROVIDER: "alias"` nennen `AGENT_MODEL`,
`AGENT_COORDINATOR_MODEL` und `AGENT_MODELS` Aliasse; ohne `AGENT_MODELS` stehen alle Aliasse
zur Wahl. Oberfläche und Modellkatalog zeigen einen Alias ohne Anbieter (`modelLabel`), das
Journal speichert Alias und `alias`. Eine Rollen-Denktiefe (`AGENT_THINKING`,
`AGENT_COORDINATOR_THINKING`) ohne Wert übernimmt die Denktiefe des Alias, sonst `high`
(`roleThinkingLevel`); wechselt jemand im Chat auf einen anderen Alias, gilt dessen Denktiefe,
auf das Koordinator-Modell zurück die des Koordinators. Ändert sich das Ziel eines Alias, laufen
bestehende Runs unter demselben Namen mit dem neuen Ziel weiter.

Vorbereitungschat, Produkt-Modellkatalog und Koordinatoreinstellungen beziehen die Denktiefen aus
den Fähigkeiten des jeweiligen Provider-Modells im eingebauten Laufzeitkatalog oder, beim
Relay, aus dessen Aliaskatalog. Es gibt keine pauschale Liste pro Produkt. `AGENT_MODEL_REASONING` kann diese Auswahl ausdrücklich
einschränken; unbekannte Modelle sowie ungültige oder doppelte Stufen sind Konfigurationsfehler.
Der Server prüft den gesamten angebotenen Katalog zusätzlich gegen die tatsächlich geladene
Modelllaufzeit und validiert alle Profilvorgaben vor der Nutzung. Beim Modellwechsel im
Vorbereitungschat wird die konfigurierte bevorzugte Denktiefe verwendet, falls sie verfügbar ist,
sonst die erste angebotene Stufe; die Auswahl ist vor dem Absenden sichtbar. Ausdrücklich
übergebene ungültige Werte werden zurückgewiesen.

Beim Start per Chat oder Setup erhält der menschliche Run-Teilnehmer den Anzeigenamen des
serverseitig angemeldeten Benutzers, und der Run merkt sich denselben Benutzer als Eigentümer.
Ohne Anmeldung verwenden die Produktvorgaben "Benutzer", und der Run bleibt ohne Eigentümer.
Ein vorhandener Run behält seinen ursprünglichen Teilnehmer und Eigentümer; ein Loginwechsel
schreibt das Journal nicht um. Der Run-Besitzer ist keine Festlegung auf den Rechner- oder Repositorybesitzer.
Die allgemeinen Rechte und eine Vorlagenliste begrenzen einen Bedienerzugang;
neutrale Komponenten enthalten keine Produkt- oder Benutzerabfragen. Ist `MODEL_SELECTABLE`
aktiv, bleiben freie Starts und technische Auswahl trotzdem an die jeweiligen Benutzerrechte
gebunden. Ohne jede Quelle - weder Plugin-Ordner noch `SYSTEM_PROMPTS_DIR` - bleibt der Katalog
leer, ohne Fehler; die Schlüssel wirken prozessweit und dürfen ein anderes Produkt-Plugin nicht
beim Import zerreißen. Das Häkchen "Auch an die Agenten weiterreichen" entscheidet, ob der gewählte Text
nur im Koordinatorprompt steht oder zusätzlich im Systemprompt erzeugter Agenten. Plain-LLMs mit
`tools: []` bleiben ausgenommen und erhalten ausschließlich ihren eigenen Prompt. Auswahl und
Reichweite frieren mit der ersten Nachricht in den Journal-Zustand `ragents.system-prompt` ein.

Das Startmenü bietet die Profildateien des Repositories an. `./start.sh core` verwendet als Vorgabe Port 4710 und
`~/.local/share/ragents/core`, `./start.sh showcase` Port 4713 und
`~/.local/share/ragents/showcase`, `./start.sh developer` Port 4715 und
`~/.local/share/ragents/developer`. Alle drei Profile liegen auch im Paket `@schlenkr/ragents`;
`ragents start <profil|pfad>` nimmt einen Profilnamen des Hosts, den Pfad einer eigenen
`ragents.config.<profil>.ts` an beliebiger Stelle oder, wenn beides nicht zutrifft, einen Stand
aus dem Cache geholter Profile.

`scripts/start.sh` baut vor jedem Start die veralteten eingebauten Plugins neu (`pnpm
build:plugins`, aktuelle bleiben unberührt), mit `--dev` zusätzlich laufend mit `pnpm build:plugins
--watch`; `tsx watch` startet den Server neu, sobald sich eine Server-Datei eines Bundles ändert. Plugins außerhalb des Hosts baut ihr Repo selbst. Das Web gibt es
einmal für alle Profile unter `apps/web/dist/`, gebaut mit dem Host (`pnpm build:web`);
`scripts/start.sh` baut es nur, wenn es fehlt oder nicht mehr zu seinen Quellen passt, mit `--dev`
gar nicht, weil dann der Vite-Dev-Server die Oberfläche liefert. Das Paket bringt es fertig mit.
Der Server selbst baut nichts: in einem Checkout bricht sein Start ab, wenn ein eingebautes Bundle
des Profils oder das Web nicht zu den Quellen passt, und nennt `pnpm build:plugins` oder
`pnpm build:web` (Abschnitt Bundle, Bauwerkzeug und Host-API in [plugins.md](plugins.md)). Das gilt
auch für `pnpm start`, `ragents run`, `ragents start` und die VS-Code-Erweiterung mit einem
Checkout als Host. Auch ein servergeliefertes Profil nimmt das Web seines Hosts (Abschnitt
Servergelieferte Profile).

Der Server kennt drei Startmodi (`pnpm start -- <argumente>`, `apps/server/src/main.ts`): `--port N`
hört wie bisher auf dem Port des Profils oder der Umgebung und bricht bei belegtem Port ab;
`--port 0` hört auf einem freien Port nur auf `127.0.0.1`, erzeugt ohne konfigurierte Benutzer und
ohne `ACCESS_TOKEN` einen Zugangstoken je Prozess und schreibt als einzige Zeile auf stdout die
Ansage `{"ragents":{"url","token","pid"}}` für den Aufrufer; `--stdio` spricht JSON-RPC über stdin
und stdout, ohne `--port` ohne HTTP, und beendet den Server, wenn die Eingabe endet. Bei `--stdio`
und `--port 0` geht die Konsole nach stderr, damit stdout dem Protokoll gehört. Der Server bindet
seinen Port, bevor er seine Plugins und Runs aufbaut, und beantwortet Anfragen erst danach; so nennt
jede Adresse, die er beim Aufbau vergibt, etwa `RAGENTS_API_BASE_URL` des globalen
Koordinators, auch bei `--port 0` den tatsächlich gebundenen Port. Ohne HTTP (nur `--stdio`) setzt
er diese Variable nicht. Nennt der Aufrufer sich in `RAGENTS_PARENT_PID`, überwacht der Host diesen
Prozess alle fünf Sekunden (`apps/server/src/parent-watch.ts`) und fährt geordnet herunter, sobald
es ihn nicht mehr gibt; das Writer-Lock des Journals geht dabei regulär zurück wie bei SIGTERM. Ein
gesetzter Wert, der keine positive ganze Zahl ist, bricht den Start ab; ohne die Variable gibt es
keinen Wächter. Ein zweiter Prozess auf demselben Profilordner ist Sache des Aufrufers. Bereits
vorhandene Daten anderer Profile bleiben unberührt und werden nicht migriert.

Die gemeinsame Datenpfadauflösung gilt für Startskript und direkten Serverstart: `DATA_DIR`
aus der Umgebung überschreibt `host.DATA_DIR` des Profils; ohne beide gilt
`~/.local/share/ragents/<profil>`. Vor Build und Serverinitialisierung prüft der Start die
physisch aufgelösten, bereits vorhandenen Verzeichnisse bis zur Dateisystemwurzel.
Ein Datenverzeichnis innerhalb eines Git- oder Paketprojekts (`.git`, `pnpm-workspace.yaml`
oder `package.json`) wird mit Ursache abgewiesen. Symlinks umgehen diese Prüfung nicht.
Explizite externe Pfade bleiben zulässig.
Unterhalb des Datenordners liegt `tools/<plugin-id>/`: die Werkzeuge, die `pnpm provision` für die
Plugins dieses Profils holt (Abschnitt Provisionierung je Plugin in [plugins.md](plugins.md)).

Ein Ablagewechsel ist ein bewusster Vorgang bei gestopptem Server. Er umfasst den gesamten
Profilbestand. Der Server verschiebt keine Daten und schreibt keine eingefrorenen
Journalpfade um.

Ein Konfigurationswert kann statt eines Textes `provisioned("<plugin-id>", "<pfad>")` sein: er
wird beim Laden der Profildatei zu `<Datenordner>/tools/<plugin-id>/<pfad>`. So nennen `core`,
`showcase` und `developer` ihre Language Server, ohne einen Rechnerpfad festzuschreiben.
Explizite Umgebungsvariablen überschreiben auch diese Werte.

`host.PLUGINS` nennt Plugins per Kennung oder per Pfad auf ein Bundle; relative Pfade gelten ab der Profildatei und
werden beim Laden absolut. Die Profildatei liegt im Repo-Root oder an beliebiger Stelle:
`PRODUCT_PROFILE_FILE` nennt dann den Pfad, `PRODUCT_PROFILE` bleibt der Name, und der Dateiname
muss `ragents.config.<profil>.ts` lauten; Datenverzeichnis, Meldungen und Sektionen verwenden
weiter den Namen. `scripts/start.sh <profil>` oder `scripts/start.sh <pfad>` setzt beides, im
Paket `ragents start <profil>` oder `ragents start <pfad>`; ohne Argument listet das Skript die
Profile im Repo und nimmt auch einen Pfad entgegen. Der Dev-Modus
verwendet für Vite den Backend-Port plus 1000. Eine externe Profildatei importiert
`@ragents/host/config-definition.js`.

### Servergelieferte Profile

Ein Profil kann auch von einem anderen RAgents-Server kommen. Dessen Plugin
`ragents.profile-distribution` packt beim Start die Client-Profildatei und die Bundles, die sie
per Pfad nennt, zu einem Archiv (Abschnitt Profilverteilung in [plugins.md](plugins.md)).
`ragents connect <server-url>` holt es mit dem persönlichen Token aus `RAGENTS_TOKEN`
(`scripts/remote/connect.ts`, reines Node, kein Bash, im Checkout `pnpm connect`): Beschreibung
über `ragents.profile.describe`, Abgleich mit dem Host, Archiv unter
`GET /profile/<stand>.tar.gz`, Prüfung von SHA-256 und Größe, Ablage unter
`~/.local/share/ragents/remote/<host>/<profil>/profiles/<stand>/` mit einer `package.json`
(`type: "module"`), weil die Profildatei ESM ist. Danach startet `connect` den Server mit
`PRODUCT_PROFILE_FILE` auf die Datei im Cache und `DATA_DIR` auf
`~/.local/share/ragents/remote/<host>/<profil>/data/`. Ab da ist es ein gewöhnlicher lokaler
Start per Pfad: Engine, Journal, Werkzeuge, Language Server, Browser und Git laufen beim
Entwickler, das Web kommt fertig aus seinem Host, nichts wird gebaut oder installiert und nichts
zur Laufzeit nachgeladen.

Der Abgleich vor dem Holen verlangt zweierlei vom lokalen Host (Checkout oder Paket
`@schlenkr/ragents`; die Erweiterung prüft den Host, den sie starten wird). Erstens dieselbe
Host-API wie der Server (`hostApi` der Beschreibung gegen `host-api.json` des lokalen Hosts,
`readHostApiVersion`): die Bundles im Archiv sind dagegen gebaut, und das Web des lokalen Hosts
lädt ihre Web-Hälften nur über das Register derselben Host-API. Zweitens ein eingebautes Bundle
für jedes Plugin, das das Client-Profil per Kennung nennt, weil diese vom lokalen Host kommen.
Derselbe Commit wie beim Server ist nicht verlangt: Bundles und Web passen über die Host-API
zusammen, nicht über einen gemeinsamen Build, und ein Entwickler braucht für eine neuere
Serverfassung ohne neue Host-API kein neues Paket. Weicht etwas ab, bricht `connect` vor dem
Herunterladen ab und wechselt nicht selbst: im Paket mit `npm install -g
@schlenkr/ragents@<packageVersion>`, im Checkout mit `git checkout <hostVersion>` samt
`pnpm build:plugins` und `pnpm build:web`, bei einem fehlenden Bundle im Checkout zuerst mit
`pnpm build:plugins`. Nach dem Entpacken prüft `connect` den `stand` jedes Bundles im Archiv, bevor
es den Stand in den Cache übernimmt. Die übrigen Prüfungen macht der Start wie bei jedem Profil:
Manifest, `format` und `api` jedes Bundles, die benutzten Namen der Host-API (`hostNames`) gegen
`host-api.json` des lokalen Hosts, `uses` gegen Pluginliste und `requires`, die Schlüssel je Plugin
gegen dessen Deklarationen. Mitgelieferte Bundles nennt die Client-Profildatei relativ zu sich;
einen absoluten oder `~/`-Pfad lehnt der Server schon beim Packen ab.

Ein neuer Stand landet in einem neuen Ordner, alte Stände bleiben, bis `connect --clean` sie
entfernt; `--no-start` endet nach dem Holen, `--port <n>` reicht den Port an den Server durch.
Zwischen Holen und Start ruft `connect` die Provisionierung für das geholte Profil; eine Lücke, die
sich nicht schließen lässt, bricht den Start mit ihrer Anweisung ab. Beide Schritte laufen als
`node --import tsx <skript>` im Ordner `apps/server` des Hosts, also ohne pnpm. Den zuletzt
geholten Stand notiert `connect` als `current.json` neben dem Cache (Server, Profil, Stand,
Profildatei, Datenordner); `ragents start <profil>` fährt genau ihn wieder hoch, ohne den Server
zu fragen. Kein Eintrag und mehrere Server mit demselben Profilnamen sind Fehler mit der
jeweiligen Liste. Die Modelle bezieht ein solches Profil in der Regel über das Relay des Servers
(`AGENT_PROVIDER: "relay"`, oben im Abschnitt Profile). Persönliche Werte wie den Relay-Token nennt das Client-Profil
als `env(...)`, sie kommen aus der Umgebung des Entwicklers.

## Bearbeitbare Modellvorgaben

Unter Einstellungen, Modelle stellt das aktive Produkt seine tatsächlichen LLM-Rollen
bereit: in core `coordinator`, `relay` und `standard`. Pro Rolle sind Modell und Denktiefe
bearbeitbar. Die manuelle Rolle gehört
nicht dazu. Anbieter, verfügbare Modelle und bewusst eingeschränkte Denktiefen stammen weiter
aus der Profildatei und dem geprüften Modellkatalog; die Oberfläche ist kein Konfigurationseditor.

Jede Rolle hat Modell und Denktiefe getrennt in der Profildatei: `AGENT_MODEL` und
`AGENT_THINKING` für `standard`, `AGENT_COORDINATOR_MODEL` und
`AGENT_COORDINATOR_THINKING` für `coordinator` und `relay`. Ein Produkt-Plugin kann weitere
Rollen mit eigenen Schlüsseln anmelden; gespeicherte Rollen lassen sich in den
Modelleinstellungen separat anpassen.
Modell- und Denktiefenvorgaben bleiben getrennt; der Run überschreibt die Denktiefe beim
Start nicht. Der Modellkatalog begrenzt die erlaubten Stufen je Modell.

Die Vorgaben liegen unter `${DATA_DIR}/plugins/<produkt-plugin>/model-settings.json`.
Jedes Produkt-Plugin besitzt seinen eigenen Store und seine eigenen Methoden
`ragents.product.modelSettings.read` und `.save`. Lesen benötigt `settings.read`, Speichern
zusätzlich `settings.write`. Ein Speichervorgang übermittelt alle tatsächlichen Rollen;
fehlende, doppelte oder unbekannte Rollen, nicht angebotene Modelle und unzulässige Denktiefen
werden vor dem Schreiben zurückgewiesen. Die Datei wird atomar ersetzt.

Fehlt die Datei, gelten die validierten konfigurierten Vorgaben. Beschädigte oder ungültige
Dateiinhalte brechen den Start ab. Neue Actors und die Standardauswahl noch nicht gestarteter
Runs verwenden die gespeicherten Vorgaben ohne Serverneustart. Explizite Start- oder
Spawn-Auswahl bleibt maßgeblich; bestehende Actors behalten ihre eingefrorene Ausführung.

Der globale Koordinator hat weiterhin seine eigene sofort wirksame Modellwahl und seinen
eigenen Store. Seine anfängliche Auswahl wird schon bei der ersten Initialisierung gespeichert.
Änderungen der Produktvorgaben stellen ihn deshalb auch nach einem Neustart nicht um; seine
eigene Auswahl ändert umgekehrt keine Vorgaben für neue Runs oder Agenten.

## Modell für automatische Überschriften

Die Titelerzeugung ist ein Host-Dienst mit einer eigenen Modellwahl unter Einstellungen,
Modelle, Überschriften. Sie verwendet den vorhandenen Laufzeitkatalog des konfigurierten
`COMPACTION_PROVIDER`, unabhängig von `AGENT_MODELS` und den Rollen. Wählbar sind
Modelle mit Texteingabe, die ausgeschaltetes Reasoning unterstützen. Die Titelausführung
setzt Reasoning immer auf `off`; es gibt keine zusätzliche Denktiefenwahl.

`COMPACTION_MODEL` ist die Vorgabe, solange `${DATA_DIR}/title-settings.json` fehlt;
eine leere Vorgabe deaktiviert die automatische Erzeugung. Bietet der Anbieter kein geeignetes
Modell an, bleibt die Auswahl leer: ohne Vorgabe startet der Server mit abgeschalteter
Titelerzeugung und sagt das in den Einstellungen, eine Vorgabe ohne passendes Modell bleibt ein
Startfehler. Die mitgelieferten Dateien für
core und showcase verwenden `google/gemma-4-26b-a4b-it`
(Gemma 4 A4B). Gemma 4 A4B, Qwen 3.8 Flash und GPT-5.4 nano stehen am Anfang der geeigneten
Modellauswahl; weitere passende Modelle bleiben wählbar. Gespeicherte Einstellungen haben
Vorrang. Die Datei enthält `selection` mit Anbieter und Modell oder `null` zum Deaktivieren.
Unbekannte Modelle, ungültige Datei- oder Anfrageinhalte
werden abgewiesen; ein ungültiger gespeicherter Stand verhindert den Start. Speichern ersetzt
die Datei atomar und übernimmt die Auswahl erst nach erfolgreichem Schreiben.

`ragents.settings.titles.read` liefert Auswahl und verfügbaren Katalog mit `settings.read`.
`ragents.settings.titles.save` benötigt zusätzlich `settings.write` und speichert ausschließlich die Auswahl. Änderungen
gelten ab der nächsten Titelerzeugung. Bereits erzeugte oder ausdrücklich gesetzte Titel bleiben
erhalten; Modelle und Denktiefen von Agenten oder globalem Koordinator ändern sich nicht.

<!-- guide:access -->
## Sign-in and permissions

User permissions control a person's access to the application. An actor's function selection
and technical grants control execution inside a run. Profiles provide plugins; user permissions
do not create additional plugins or functions.

A profile can export `users` as `readonly ProfileUser[]`. Each user has an ID, label, password,
and exact permission strings. Passwords can be non-empty values or `env(...)` references. When
the export is absent, the profile runs without sign-in. An empty list, duplicate IDs, invalid
permissions, or missing required password variables prevent startup.

```ts
import { env, type ProfileUser } from "./apps/server/src/config-definition.js";

export const users = [{
  id: "reader",
  label: "Read-only access",
  password: env("RAGENTS_READER_PASSWORD"),
  rights: ["runs.read", "ragents.overseer.read"],
}] as const satisfies readonly ProfileUser[];
```

A user can also have a personal token through `token: env("RAGENTS_TOKEN")`. It acts as a bearer
token with the same identity and permissions as that user, but has no session expiry. It is
intended for clients without a sign-in dialog. The server stores only its SHA-256 hash. Removing
the token from the profile and restarting the server revokes it.

Permission names are exact strings; `*` grants all permissions. Without `users` or
`anonymousUser`, access is unrestricted. An optional `anonymousUser` applies the same permissions
and allowed templates without a password. It cannot be combined with `users`. With sign-in
enabled and no valid session, all permissions are denied.
<!-- /guide:access -->

### Anmeldung und Token im Einzelnen

Der Vertrag `ProfileUser` steht in `config-definition.ts`. Ein vorhandener `users`-Export
schaltet die Anmeldung ein. Die Benutzerliste wird getrennt von der Plugin-Konfiguration geladen
und erscheint nicht in öffentlichen Umgebungsdeskriptoren. Steht ein Passwort als `env(...)` in
der Datei, wird eine vorhandene `env`-Importzeile ergänzt, nicht ein zweites Mal angelegt. Die
interne [Entwicklerreferenz](../homepage/developer.md) nennt die aktuellen Rechte
für Runs, Einstellungen und globalen Koordinator direkt aus den ausführbaren Verträgen.

Ein persönlicher Token steht nur als Referenz auf die Serverumgebung in der Datei, nie im
Klartext; er hat 16 bis 512 druckbare ASCII-Zeichen ohne `$` und `!`. Er gilt als
`Authorization: Bearer` und bei GET-Abrufen als Abfrageparameter `access`, ohne Cookie; gedacht
ist er etwa für einen lokalen RAgents-Server, der Modelle und Profil von diesem Server bezieht.
Der Server vergleicht zeitkonstant; derselbe Token bei zwei Benutzern ist ein Startfehler. Ist
die genannte Umgebungsvariable nicht gesetzt oder leer, hat der Benutzer keinen persönlichen
Token und meldet sich weiter mit seinem Passwort an; das ist kein Startfehler. Abmelden
widerruft keinen persönlichen Token.

Die verbindlichen Rechtenamen und ihre Bedeutungen stehen in `packages/ragents/src/access.ts`
und bei den beitragenden Plugins. `AccessContext.can`, `hasRight` und `accessMode` verwenden
dieselbe Prüfung. Ein `anonymousUser` begrenzt den Zugang auch ohne Anmeldung. Der öffentliche
Snapshot enthält nur Anmeldemodus und Benutzer mit Kennung, Anzeigename und Rechten. Die
Entwicklerreferenz erzeugt Namen, Host-Routenzuordnung und Verträge aus diesem Code und enthält
geprüfte Beispiele für Leser, Bediener und ein eigenes Plugin.

Die Anmeldung verwendet Benutzerkennung und Passwort. Der Server hält eine undurchsichtige
Anmeldesitzung zwölf Stunden im Speicher; das profilbezogene Cookie ist HttpOnly und SameSite=Lax.
Abmelden, Ablauf und Neustart machen die Sitzung ungültig; zugehörige offene HTTP-Antworten
einschließlich Ereignisströmen und laufenden Abrufen werden beim Abmelden oder Ablauf abgebrochen.
Bereits gestartete Agenten-Runs werden dadurch nicht automatisch gestoppt. Der Browser kehrt bei
verlorener Sitzung zur Anmeldung zurück, sobald eine Anfrage an einen geschützten Pfad (`/api`,
`/rpc` samt Ereignisstrom `/rpc/stream`, `/files`) mit 401 antwortet (`observeAccessExpiry`).
Benutzeränderungen werden mit dem nächsten Serverstart wirksam.
Die Anmeldung gilt je Browser, nicht je Tab: Eine neue Anmeldung in einem zweiten Tab ersetzt
das Cookie für alle Tabs, und deren Anfragen laufen ab dann unter dem neuen Benutzer. Ein Tab
lädt deshalb bei jedem Fokus den angemeldeten Benutzer nach und übernimmt einen Wechsel sofort.
Zwei Benutzer gleichzeitig brauchen zwei Browser oder ein privates Fenster. Prompts, Skills und
Tests nennen keinen echten Benutzer; der Eigentümer eines Runs kommt allein aus der Anmeldung.
Clients ohne Cookie-Speicher (die VS-Code-Erweiterung und ihre iframes) lesen den Sitzungstoken
aus dem `Set-Cookie`-Header der Anmeldeantwort und senden ihn als `Authorization: Bearer`; für
GET-Abrufe, die keinen Header setzen können (Ereignisstrom, Mini-App-Frames), gilt er auch als
Abfrageparameter `access` (`ACCESS_TOKEN_QUERY` in `packages/ragents/src/access.ts`). Ein
Bearer-Header hat Vorrang vor Cookie und Abfrageparameter; Abmelden mit Bearer widerruft die
Sitzung genauso.

Der ältere `ACCESS_TOKEN`-Zugang gilt nur, wenn das Profil keine Benutzer definiert. Bei
konfigurierten Benutzern ersetzt die Anmeldung diesen Zugang; der alte Token umgeht sie nicht.
Er nimmt den Token als Bearer, Cookie oder Abfrageparameter `access` an; nur eine Seitennavigation
mit dem Parameter wird nach dem Setzen des Cookies auf die tokenfreie Adresse umgeleitet, iframes
und API-Abrufe laufen direkt weiter. Das gebaute Web unter `/assets/`, die Dateien der Web-Hälften
unter `/plugins/<id>/web/` ohne ihre Sourcemaps und das Stylesheet `/ragents.css` sind frei, damit
ein iframe ohne Cookie seine Skripte laden kann; jede Datenroute, jede Sourcemap und alles andere
unter `/plugins/` verlangt den Token.

<!-- guide:access -->
## Run ownership

A run belongs to the user who created it. Users normally see and operate only their own runs;
`runs.read.all` adds visibility across owners. Ownership is recorded once in the journal and is
never rewritten. Runs created without authentication have no owner and are visible only with
`runs.read.all` when authentication is later enabled.

The server enforces ownership on lists, methods, event channels, and file routes before opening a
run. An inaccessible run responds like a missing one. Each signed-in user has a global coordinator
of their own, reachable by nobody else, not even with `runs.read.all`; its tools act with that
user's access and rights, and runs it creates belong to that user. Without sign-in there is exactly
one coordinator. A start option can additionally mark a run
as `ownerOnly`, as the workspace binding does for tools running on the owner's machine. Other
users with visibility may still read its journal and stop it, but only its owner can send messages,
answer actions, restart actors, or invoke operations requiring `runs.write`. Its workspace is the
owner's alone even for reading: the workspace files in the Dateien tab, the process rail, and
language-server state are refused to everyone else, including `runs.read.all`
(`run-workspace-owner-only`). The run list asks nothing from such a
workspace on their behalf, and web and VS Code hide what needs it; the Dateien tab then shows only
the server's file store.

Only a signed-in user of a profile with `users` can register a workstation over the network. A
server without users (open, `ACCESS_TOKEN`, or `anonymousUser`) has one owner for every client, so it
accepts a workstation only over a loopback connection and otherwise refuses with
`workspace-client-login-required`. The VS Code extension then does not register and shows the reason
on the server.

`runs.write` permits messages and app actions in existing owned runs. Free-form runs,
preparation chats, and start options additionally require `runs.create`. Without it, a user can
start only explicitly allowed run scripts. `runs.inspect` protects models, journals, source code,
tools, and general technical views. Language-server views use their own plugin read permission.
`runs.trace` separately reveals reasoning and function-call content in chat. Without it, those
phases appear only as empty progress markers while arguments, source, results, and reasoning are
removed on the server.
<!-- /guide:access -->

### Eigentum im Einzelnen

Das Eigentum gilt für jeden Weg, einen Run anzulegen, auch für `ragents.overseer.createRun`:
Eigentümer wird der aufrufende Benutzer, beim Aufruf aus den Werkzeugen eines globalen
Koordinators dessen Benutzer. Die Rolle mit `*` hat `runs.read.all` automatisch. `run.created` führt neben dem
menschlichen Teilnehmer dessen `owner.userId`, der Serverzustand des Runs führt ihn als
`ownerUserId`; die Run-Ansicht für Clients nennt ihn nicht. Auch ein Run aus der Zeit vor dieser
Regel hat keinen Eigentümer; ein Run ohne Eigentümer fällt keinem Bediener zu.

Durchgesetzt wird das allein auf dem Server, nicht in der Oberfläche, für die Beiträge der
Plugins genauso wie für die des Hosts: Die Nachrichtenschicht prüft jede Eingabe mit `runId`
und jede Adresse mit dem Abschnitt `runs/<kennung>`, der globale Koordinator löst seine
Run-Referenzen nur über die Runs des Aufrufers auf, und auch der Oberflächenkontext einer
Nachricht darf keinen fremden Run nennen. Ein fremder Run antwortet mit `run-not-found` (Status
404); eine geratene Kennung verrät also nicht, dass es den Run gibt. Eine Kennung, unter der noch
kein Run liegt, bleibt frei: Sie gehört dem, der den Run unter ihr anlegt. Ein Profil ohne
Anmeldung (`anonymousUser` oder ganz ohne Benutzerliste) hat genau einen Zugang und sieht alles.
Jeder Benutzer hat seinen eigenen globalen Koordinator (`core.md`, Globaler
Koordinator); dessen Kennung erreicht nur er, auch nicht `runs.read.all`, auch nicht, solange noch
kein Run unter ihr liegt, und der Koordinator behält die Rechte seines Plugins. Ein importierter Run behält den Eigentümer aus seinem Journal; stammt er von
einem Server ohne Anmeldung, ist er nach dem Import ein Run ohne Eigentümer.

`ownerOnly` erklärt ein Plugin mit einer Startoption; in core tut das die Bindung an einen
Arbeitsplatz, weil die Werkzeuge eines solchen Runs auf dem Rechner und mit den Zugangsdaten des
Eigentümers laufen. Lesen und stoppen dürfen einen solchen Run alle, die ihn sehen, auch mit
`runs.read.all`. Zum Bedienen gehören Nachrichten, Vorlagen, Eingaben an einzelne Actors, der
Neustart eines Actors, Antworten auf wartende Aktionen und jeder Beitrag eines Plugins,
dessen Vertrag `runs.write` verlangt. Jeder andere Zugang bekommt dafür `run-owner-only` (Status
403); er sieht den Run, eine Tarnung als nicht vorhanden wäre hier falsch. Ein solcher Run ohne
Eigentümer ist nur ohne Anmeldung bedienbar, denn dort gibt es genau einen Zugang, für den der
Vorbehalt nicht greift. Der Kern kennt dabei nur diesen Zustand, kein Werkzeug und keinen
Arbeitsplatz. Die Werkzeuge eines globalen Koordinators handeln als sein Benutzer; einen
fremden solchen Run sehen und bedienen sie also genau so wenig wie dieser.

### Rechte im Einzelnen

Ohne `runs.create` startet `ragents.chat.start` nur ein Run-Script aus `user.startEntries`;
beliebige Texte, andere Vorlagenkennungen und technische Startparameter sind gesperrt. Der
Katalog enthält für diese Benutzer nur die freigegebenen Scripts. Die Auswahl gilt für neue
Starts; bestehende eigene Runs bleiben zugänglich. `runs.delete` erlaubt, Runs samt ihren
gespeicherten Daten zu löschen (`ragents.runs.delete`).

`runs.inspect` schützt Modelle, Journal, Quellen, Werkzeuge und allgemeine technische Einsicht;
Tabs und lesende Methoden prüfen dasselbe Recht. Ohne `runs.inspect` fehlen technische Reiter,
Inspektoren und Programmquellen, die Fläche zeigt Mini-Apps und LLM-Gespräche, und
TypeScript-Steueractors bleiben verborgen. Der Server redigiert dann Modelle, Prompts, Grants,
Werkzeugausgaben und technische Startzustände in den Run- und Chat-Snapshots (`access-projection.ts`).
Startoptionen verlangen `runs.create` (die Wahl dazu `runs.write`); jede Option nennt darüber
hinaus ihre eigenen Rechte (`rights`). Modellwahl und Systemprompt-Wahl verlangen `runs.inspect`,
weil ihre Darstellung Modelle, Anbieter und Prompttexte zeigt; die Ordnerbindung
`ragents.workspace.binding` verlangt nichts Zusätzliches. Ohne ein solches Recht fehlt die Option
in `ragents.startOptions.list`, und ihre Wahl scheitert mit `access-denied`; beim Start gilt ihr
Standardwert oder der Wert der Vorlage. Dieselben Rechte gelten für die Modellwahl in der
Chat-Eingabe eines laufenden Runs, die derselbe Aufruf ist; ohne sie fehlt dort die Auswahl. Fachliche
Zustände und Mini-App-Aktionen bleiben verfügbar, einschließlich der Ergebnisabfrage laufender
App-Aktionen. Language-Server-Ansichten verwenden ihr eigenes `<pluginId>.read`; damit lassen sich
Diagnosen unabhängig von Modell- und Werkzeugdetails freigeben.

`runs.trace` gibt ohne die übrige technische Einsicht die Denk- und Werkzeugschritte des Chats
mit Inhalt frei und erlaubt dem Benutzer, ihren Detailgrad selbst zu wählen. Ohne dieses Recht
(und ohne `runs.inspect`) enthalten Chatstream und Actor-Verlauf für Denk- und Werkzeugphasen nur
leere Statusmarker mit Start- und Abschlussinformation; Namen, Argumente, Quelltext, Ergebnisse
und Denktexte entfernt der Server. So bleibt die aktuelle Arbeitsphase sichtbar, ohne technische
Details freizugeben.

Einstellungen und globaler Koordinator behalten ihre eigenen Rechte. Diese Rechte ersetzen keine
Ausführungssandbox für selbst geschriebenen nativen Code; die übernimmt auf dem Server die
Prozess-Sandbox ([plugins.md](plugins.md), Prozess-Sandbox des Servers). Der globale Koordinator hat eigene
Lese- und Schreibrechte; Änderungen seiner Modellwahl brauchen zusätzlich das Recht zum Schreiben
von Einstellungen. Sein Arbeitsbereich erhält einen lokalen Token für den Zugang seines Benutzers,
ausschließlich für die Nachrichtenschicht und Hilfe über Loopback; der Server löst ihn bei jedem
Aufruf in den aktuellen Stand dieses Benutzers auf. Er hat damit genau dessen Rechte, keine
weiteren, auch für Einstellungen und den eigenen Gesprächsreset; die Anmeldung ist darüber nicht
erreichbar, und der Token geht nicht an den Browser. Ohne Benutzer, aber mit `anonymousUser` steht der Token für den anonymen Zugang.

<!-- guide:access -->
## Function selection and actor grants

An engine capability is a technical permission such as `workspace.use`. A grant assigns it to
an actor for the run or a workspace path and records whether the actor may use or delegate it.
User permissions such as `runs.write` instead control access to application routes.

The `tools` value on spawn selects the actor's function API: `[]` for a plain LLM, a list of
names for an exact selection, or `null` for the dynamic full set. The selection is not inherited
from the coordinator. Delegable engine capabilities are inherited as grants and can be reduced
with `withoutCapabilities`. Prompt instructions describe a role but grant no technical access.
Actor programs also declare required functions under `capabilities`; this limits calls but does
not supply missing grants. The [runtime guide](../homepage/guide-runtime.html#equipping-subagents)
shows selections for conversation and coding agents.
<!-- /guide:access -->

### Grants im Einzelnen

Eine Workspace-Grenze deckt den angegebenen Pfad und seine Unterverzeichnisse ab. Beim Vererben
delegierbarer Grants bleibt dieser Bereich erhalten; ein neuer Actor bekommt dadurch nicht
automatisch ein eigenes engeres Verzeichnis. Die Auswahl von `read` ersetzt keinen fehlenden
Grant für `workspace.use`. Auch ein erfolgreich typgeprüftes Snippet bleibt an seine
Aufrufidentität gebunden; Übersicht, Nachschlagen und Ausführung verwenden den für diesen Actor
freigegebenen Bestand.

## Offene Grenzen

- Benutzer werden in der Profildatei gepflegt; es gibt weder OAuth noch eine Benutzerverwaltung
  oder Passwortänderung in der Oberfläche. Anmeldesitzungen überleben keinen Serverneustart.
- Benutzerrechte gelten für das gesamte Profil, nicht je Run oder Agentenwerkzeug.
- Mit Benutzern hat der globale Koordinator keine Host-Shell. Seine TypeScript-Snippets laufen wie
  alle Prozesse des Servers in der Prozess-Sandbox und lesen weder das Datenverzeichnis noch die
  Journale anderer Benutzer. Schaltet die Profildatei die Sandbox ab (`PROCESS_SANDBOX: "off"`),
  laufen sie als nativer Node-Prozess des Servers ohne eigene Systemkennung und könnten beides
  lesen. Über den Server selbst erreicht der Koordinator weiter genau die Rechte seines Benutzers.
- Die Modellwahl der Koordinatoren prüft beim Wechsel die Anhänge aller Koordinatorgespräche,
  auch die eines früheren gemeinsamen oder eines entfernten Benutzers.
- Die Provisionierung holt nur, was die Bundles eines Profils als `provision` exportieren;
  Voraussetzungen wie `dotnet` oder ein eigener Chrome bleiben Sache des Entwicklers und brechen
  den Start mit ihrer Anweisung ab. Zu Windows siehe `plugins.md`, Offene Grenzen.
- Modelle eines Relays tragen Kosten 0, weil der Preis das echte Modell verraten würde;
  Tokenzahlen bleiben richtig.
