# TODO

Eingang für alles, hier schreiben der Owner und die KI. Eine Zeile je Eintrag, neu oben. "Offen" ist konkrete Arbeit, "Ideen" ist noch nicht entschieden. Braucht ein Eintrag mehr als drei Sätze, wird er zu docs/concepts/<thema>.md mit Status-Zeile, und die Zeile hier verschwindet. Erledigtes wird gelöscht. Das Warum einer Änderung geht als datierter Eintrag nach docs/decisions.md, das Was ins Kapitel unter docs/spec/.

## Offen

- Beim nächsten Sprung der Host-API `stopChatActor` aus `@ragents/web/api` und `stop` aus `SessionContext`/`useChat` streichen; seit dem Unterbrechen im Chat (24.09.2026) ruft sie im Repo niemand mehr. Den Start einer Unterhaltung abbrechen kann damit keine Eingabe mehr; braucht die Vorbereitung einen eigenen Abbruch, bekommt sie ihn am Startstatus.
- Der Chat einer Mini-App nennt den Grund eines gestoppten Actors, bietet aber keinen Neustart (`plugins/ragents.actor-programs/web/chat-state.ts`, 24.09.2026); dafür bräuchte die Brücke eine Neustart-Aktion.
- Prozessleiste eines Runs mit Bindung `client`: die markierten Prozesse, die auf dem Server laufen (TypeScript-Plattform, Actor-Programme), fehlen; der Stopp räumt sie ab, einzeln beenden lassen sie sich nicht (Review Arbeitsbereich 24.09.2026). Beide Executoren zusammenführen oder die Grenze in der Spec nennen.
- `typescript_eval` mit `path` liest über `files.read`: Quellen über 256 KB und absolute Pfade innerhalb der Wurzel scheitern seit der Umstellung auf den Executor (Review Arbeitsbereich 24.09.2026). Eigene Lesegrenze für Quellen oder absolute Pfade umrechnen, sonst in der Werkzeugbeschreibung nennen.
- Prüfläufer `scripts/remote-workspace`: `processes.ts` sucht den Marker in der ganzen Befehlszeile samt Argumenten statt nur in der Umgebung, und `checkStopAll` auf einen schon gestoppten Run beweist nur Idempotenz (Review Arbeitsbereich 24.09.2026).
- Die erzeugten Referenzen `docs/homepage/developer.md` und `developer.html` nennen für `runs.read.all` noch "nur lesen und stoppen"; beim nächsten Homepage-Build neu erzeugen (24.09.2026).
- `ragents connect --clean` löscht auch einen Stand, aus dem gerade ein `ragents start` läuft, und zwei gleichzeitige `connect` teilen sich `<stand>.part` (`scripts/remote/connect.ts`, Durchsicht der Bundles 24.09.2026). Staging je Prozess und `--clean` nur für Stände ohne laufenden Host.
- `ragents connect` über `http://` nimmt Stand und Archiv aus derselben Leitung; ein Mann in der Mitte bekäme Codeausführung und Token (Durchsicht der Bundles 24.09.2026). Entscheiden, ob `http` nur für Loopback gilt und sonst `--insecure` verlangt.
- Beim Run-Stopp kann der Scheduler nach dem Abbruch eines Workers `turn.interrupted` schreiben, bevor `stopJournal` den Worker stoppt; dann bekommt der Primary-Actor eine automatische Meldung, die kein Abonnement ist und nach dem Stopp einen Turn startet (`agents/scheduler.ts` `haltRun`, `runtime/orchestration.ts` `#dispatchCreatorAlerts`, Durchsicht 24.09.2026). Meldungen an den Ersteller während einer Stopp-Grenze unterdrücken oder `stopJournal` vor dem Abbrechen der Controller schreiben; mit dem echten Agententreiber gewinnt der Stopp bisher praktisch immer.
- `ragents journal`/`follow` und `pnpm driver journal` lesen das Journal aus dem lokalen Datenordner, auch wenn `RAGENTS_URL` beziehungsweise `RAGENTS_DRIVER_URL` auf einen anderen Server zeigt; dann wartet `run` endlos oder liest einen fremden Stand (`scripts/agent/agent-cli.ts`, `scripts/driver/run-driver.ts`, Scan 24.09.2026). Mit fremder Adresse über `runContracts.events` per RPC lesen.
- `ragents plugin build` schreibt `web/classes.json` und `manifest.web` nur mit einem Web-Einstieg; ein Plugin mit Web-Exporten ohne `web/index` baut, bekommt aber keine Tailwind-Klassen ins Stylesheet (`apps/server/src/plugin-build/build.ts`, Scan 24.09.2026, im Repo betrifft es keins). Braucht ein Manifestfeld für Klassen ohne Einstieg, also ein neues `BUNDLE_FORMAT`.
- `scripts/vscode/install-local.sh` hat keinen Test; der Neustart mit bisherigem `PORT` und `DATA_DIR` (24.09.2026) ist nur per `bash -n` geprüft, weil das Skript laufende Server beendet.
- Run-Panel in VS Code: bricht man den Leitfaden einer Vorlage ab (Kachelstart, 24.09.2026), steht man in der Startauswahl der Web-App statt auf der Start-Seite der Erweiterung; erst ihr Schließen führt zurück. Entscheiden, ob ein abgebrochener Leitfaden im Host `vscode` direkt `showStart` auslöst, das braucht einen Rückweg aus `openStartEntry`.
- Web: `run-panel/workspace-state.ts` und `chat-timestamps.ts` werfen bei einem ungültigen localStorage-Wert im Rendern, `run-read-state.ts` und `storedModes` in `PluginRegistry.tsx` verzeihen ihn; eine Error-Boundary gibt es nicht, ein kaputter Wert macht das Panel weiß, bis der Speicher gelöscht ist (Durchsicht 24.09.2026). Eine Regel für lokale Einstellungen festlegen (werfen mit Grenze und Weg zum Zurücksetzen oder verwerfen mit Meldung), nicht je Datei anders.
- Web: der Mülleimer einer einzelnen Run-Zeile (`Overview.tsx`, `SessionList.tsx`) löscht ohne Rückfrage, die Mehrfachauswahl und VS Code fragen (Durchsicht 24.09.2026); mit dem Einschmelzen des Web-Layouts in das Run-Panel entscheiden, statt `Overview.tsx` vorher nachzubessern.
- `README.md` zeigt `apps/vscode/media/screenshots/run-with-explorer.png` mit dem entfallenen Explorer-Baum (Durchsicht 24.09.2026); das Bild braucht eine neue Aufnahme aus einem core-Lauf.
- Die deklarierten Exporte eingebauter Plugins (etwa `ragents.watch/contract`, `ragents.browser/server/contract`) in `host-api.json` und damit in den Versionsvertrag aufnehmen (24.09.2026): bisher bricht ein fremdes Bundle, das sie importiert, bei gleicher Host-API erst beim Laden, und ein geholtes Profil nimmt die eingebauten Plugins vom Host des Clients, der nur dieselbe Host-API haben muss, nicht denselben Commit; eine geänderte Bedeutung bemerkt niemand.

- Einmal verlor der Arbeitsplatz im Container im abschließenden Aufräumen nach einer Browsernutzung die Verbindung ("Der Ereignisstrom wurde beendet"), ohne abzustürzen und ohne sich neu zu verbinden; nach der Behebung der gesperrten `environ` trat das nicht mehr auf, die Ursache ist ungeklärt (23.09.2026). Tritt es wieder auf: Stromzustand des `RpcClient` im Arbeitsplatz und Serverprotokoll nebeneinanderlegen.
- Ein gescheitertes abschließendes Aufräumen steht im Serverprotokoll zusätzlich als "Turn fehlgeschlagen" (`onError` des Schedulers für die Quarantäne, 23.09.2026); die Meldung sollte das Aufräumen nennen.
- `WorkspaceClient`: eine Anmeldung, die kommt, während eine andere desselben Arbeitsplatzes noch auf den Server wartet (Ordneränderung direkt nach der Wiederverbindung oder zwei schnelle Ordneränderungen), hängt sich an deren Antwort und schickt ihre Ordner nicht; der Server kennt bis zur nächsten Anmeldung die alten (23.09.2026). Nach der Antwort erneut anmelden, wenn sich die Ordner inzwischen geändert haben.
- Browserprüfung auf einem fremden Arbeitsplatz weiter prüfen: `browser_screenshot` mit Aufnahme in der Dateiablage des Servers, Trennung und Wiederanmeldung bei offenem Browser (23.09.2026); `browser_open` auf `localhost` des Arbeitsplatzes und den Stopp danach prüft `pnpm check:remote-workspace --browser`, dazu Test-Browser über einen fremden Arbeitsplatz (`workspace-foreign-machine.test.ts`) und echter Chrome im Executor des Servers (`browser-live.test.ts`).
- Actor-Programme eines Runs mit Bindung `client`: die Pakete liegen unter `@actors` auf dem Server, die Dateiwerkzeuge laufen auf dem Arbeitsplatz, der keine Aliasse kennt; das Modell kann ein solches Paket deshalb nicht mit `read`, `edit` und `write` bearbeiten (23.09.2026). Entscheiden, ob Actor-Programme dort gesperrt werden oder ihre Dateien einen eigenen Weg bekommen.
- In den VS-Code-Tests (`apps/vscode/tests/workspace-client.test.ts`, CommonJS unter tsx) kommt ein `DomainError` des Arbeitsplatzes beim Stub-Server ohne Kennung an, weil `DomainError` dort zweimal geladen ist; im gebündelten Erweiterungspaket und im kopflosen Arbeitsplatz stimmt es (23.09.2026). Der Test prüft deshalb nur die Meldung; eine Prüfung ohne Klassenidentität in `rpcFailureOf` würde es beheben.

- Live in der VS-Code-Erweiterung prüfen: der Ladezustand des Run-Panels ohne aufblitzende Run-Liste bei Kachel-Klick, Plus und einer Vorlage mit Mini-App, dazu ein Neuaufbau des iframes mitten im Start (22.09.2026); Typecheck, Lint, Unit- und Browser-Tests sind geprüft.
- Der Run-Umzug kennt die Arten eines beigesteuerten Arbeitsbereichs nicht: `WorkspaceTransfer.assertDirectory` bindet einen Ersatzordner weiter als `path`, auch wenn der Beitrag `serverFolders: false` meldet (22.09.2026).
- Nach einem Absturz oder Force-Quit von VS Code beendet sich ein lokaler Host erst beim nächsten Takt seines Wächters, also bis zu fünf Sekunden später (22.09.2026); startet VS Code in dieser Zeit neu, bricht der neue Host noch am Writer-Lock des alten ab. Prüfen, ob der Takt kürzer sein soll oder das Journal einen solchen Besitzer übernehmen darf.
- `RunStore` (VS-Code-Erweiterung): ein gescheiterter Bootstrap (`ragents.plugins.bootstrap`, auch der abgelehnte Default-Einstieg vom 22.09.2026) setzt die Umgebung auf "nicht erreichbar", der nächste erfolgreiche `refresh` fünf Sekunden später stellt sie wieder auf "verbunden", ohne Vorlagen und ohne Meldung; der Fehler müsste stehen bleiben, bis der Bootstrap erneut gelingt.
- Die Web-App (`StartSurface.tsx`, Host `browser`) kennt `defaultStartEntry` aus dem Bootstrap noch nicht; nur die Erweiterung nimmt den Default (22.09.2026).
- Das Journal eines Runs hat im Panel keinen Einstieg mehr, seit der Explorer-Baum entfallen ist (22.09.2026); der Befehl `ragents.openJournal` bleibt registriert, wird aber von nichts mehr aufgerufen. Einstieg im Run-Panel vorsehen, etwa als Reiter der Arbeitsbereichsleiste.
- Lokale Profile auf stdio umstellen: die Erweiterung startet sie seit dem 22.09.2026 beim Aktivieren still, aber weiter als Host mit Port; danach entfallen `startProfile` und `stopProfile` aus `PanelAction` und der Host-Test kommt ohne sie aus.
- Ein Run-Zustand kennt bisher nur `running`, `waiting`, `idle` und `ended`; das Vokabular der Seiten (`apps/web/src/ui/state-vocabulary.ts`) trägt seit dem 22.09.2026 auch `failed` und `cancelled`, für die es in `TargetRun.state` noch keine Quelle gibt.
- Die Web-App zeigt die vier Seiten der Erweiterung noch nicht: `App.tsx`, `StartSurface.tsx` und `ui/ListDetail.tsx` sollen laut Entwurf vom 22.09.2026 auf Start, Runs und Umgebungen umgestellt beziehungsweise gelöscht werden; die Erweiterung ist umgestellt, der Browser noch nicht.
- Ein Einstieg statt zwei: `index.html` (Web-App) und `run-panel.html` (Run-Panel) sowie die Unterscheidung Seite/Frame in der VS-Code-Erweiterung zu EINER App zusammenführen, deren einzige Variable der Host ist (`browser` oder `vscode`); der Host bestimmt, was der Rahmen liefert (Seiten, Editor-Reiter) und was die App selbst zeigt (22.09.2026).
- Inspektionsseiten aus `FlowInspector` (Routing, Subscriptions, Artefakt-Diff) aus dem Chat heraus erreichbar machen, seit dem Wegfall des Netz-Tabs ohne Einstieg; bis dahin setzen Verweise darauf nur die Auswahl auf der Fläche.
- Der globale Koordinator löst eine gewählte Mini-App (`run-app` im gemeldeten Standort, seit dem App-Zugang über den Canvas-Controller) nicht auf und nennt sie als nicht auflösbares Element; die Auflösung bräuchte die App-Liste aus dem Zustand des Programm-Plugins.
- Kachel-Skill als Nachfolger der gelöschten Canvas-Skills im Reference-Plugin anlegen (etwa `120-tiles-app-beside-chat`), damit wieder ein Skill-Einstieg `canvas_layout_replace` mit einer verschachtelten Aufteilung vorführt.
- Die Checkbox "Canvas" je Actor in der Actors-Liste wirkt seit dem Canvas-Rückbau nur noch auf die abgeleitete Startaufteilung und die Actor-Chips des Run-Panels; Bezeichnung und Nutzen prüfen.
- Live in der VS-Code-Erweiterung prüfen: der Umschalter "Nur Chat" in der Kopfzeile des Run-Panels und der Wechsel aus einem offenen Sheet nach "Nur Chat"; Typecheck, Tests und Lint sind geprüft.
- Die VS-Code-Erweiterung gegen ein aus npm installiertes `@schlenkr/ragents` echt prüfen: das Paket liegt seit dem 21.09.2026 auf npm, geprüft ist bisher nur die Installation aus der gebauten `.tgz`.
- Run-Umzug über zwei Rechner echt prüfen: am 20.09.2026 mit zwei Servern auf einem Rechner geprüft (Bindung `fresh`, Bindung `path` mit Ersatzordner, Kennungskollision); der Lauf zwischen zwei physischen Rechnern und ein Archiv nahe der 16-MiB-Grenze fehlen noch.
- Startauswahl schmal: die Auftragszeile über `ListDetail` bleibt auch in der Detailseite stehen und kostet dort Höhe; sie mit der Liste auszublenden bräuchte eine Rückmeldung des Bausteins über seine Detailseite und damit eine Vertragsänderung im Control-Katalog (19.09.2026).
- Echter Lauf unter Windows mit `connect`, `read`, `edit`, `bash` und Diagnostik (Paket 7 vom 20.09.2026); einen Windows-Rechner gibt es hier nicht.
- Die Erweiterung mit zwei Zielen im Alltag fahren: am 21.09.2026 sind zwei Server auf einem Rechner im Host-Test geprüft (beide verbunden, Arbeitsplatz bei beiden angemeldet, Run mit Bindung `client` auf dem zweiten, Trennen trifft nur eines); ein lokales Profil neben einem Server und der Lauf über zwei Rechner fehlen noch.
- Artefakt-Links in `FlowInspector` (`<a href>`, `<img src>` auf `/files/runs/...`) tragen im Zugangstoken-Betrieb der VS-Code-Webviews keinen Token; entweder `withAccessToken` anhängen oder die Inhalte über den Client laden (Altstand, beim Umbau der Nachrichtenschicht aufgefallen).
- `packages/ragents/src/http/` heißt noch nach dem alten Transport, enthält aber die Laufzeitverträge und -methoden der Nachrichtenschicht (`contracts.ts`, `methods.ts`); nach `api/` umbenennen und die Importe `@ragents/engine/src/http/...` nachziehen.
- Nachrichtenschicht live prüfen: Server mit `--stdio` aus einer Konsole treiben, `--port 0` mit Ansage aus der Erweiterung lesen, Web über `/rpc` und `/rpc/stream` mit Anmeldung; Unit- und Ende-zu-Ende-Tests sind grün, ein echter Lauf fehlt.
- Arbeitsbereich mit der VS-Code-Erweiterung auf einem zweiten physischen Rechner prüfen: Server auf dem einen, Erweiterung auf dem anderen Rechner, ein Run mit Bindung `client` samt `edit` und Diagnostik; den kopflosen Arbeitsplatz auf einem fremden Rechner (read, write, bash, Anhang, Dateien, Prozesse, Stopp, Trennen und Wiederanmelden) prüft seit dem 23.09.2026 `pnpm check:remote-workspace` mit einem Linux-Container.
- Veröffentlichung der Erweiterung: das Standardprofil braucht ein `lsp-roslyn` und `lsp-fsharp` ohne festen Pfad, weil ein fehlender den Start bricht. Manifest, `.vscodeignore`, `CHANGELOG.md` und `pnpm publish:vscode` stehen seit dem 21.09.2026, der Herausgeber heißt `purestate`; die Marketplace-README ist die Wurzel-`README.md`.
- Ignorierte Werkzeugfelder (`ignoredFields` in `tool.call.started`) in der Oberfläche zeigen: Werkzeugkarte und Aktivitätsanzeige lesen nur die bereinigte Eingabe, der Hinweis erscheint nur im Modellergebnis und im Live-Ergebnis, nicht im Journal-Ergebnis.
- Thinking-Replay modellabhängig: `packages/ai` schickt für jedes OpenRouter-Modell das Reasoning aller früheren Turns in jeden Folgeaufruf (`ai-sdk-messages.ts`); in Lauf 82d041c3 waren das 70 Prozent des Koordinator-Kontexts. Modellmerkmal im Katalog einführen und mit GLM 5.3 flash prüfen, ob es ohne läuft; kein pauschales Weglassen.
- Provider-Bindung je Modell konfigurierbar machen (`compat.openRouterRouting` mit `only`/`order`, etwa `MODEL_ROUTING` in der Host-Sektion): GLM 5.3 flash läuft bei OpenRouter über 28 Provider, der Anbieter-Cache griff in Lauf 82d041c3 bei einem Drittel der Aufrufe nicht.

- Homepage: Screenshot des Run-Panels (`docs/homepage/screenshots/run-panel.png`) nach dem Sheet-Umbau neu aus einem core-Lauf aufnehmen und den Bildplatzhalter in `docs/homepage/index.html` ersetzen; braucht einen laufenden Server.

- VS-Code-Erweiterung: Artefakte ohne Textformat öffnen im Browser und brauchen dort die Anmeldung.

- Die Run-Liste der Web-App (`App.tsx`) und das Run-Panel (`run-panel/use-session-list.ts`) laden die Liste mit derselben Logik; App.tsx auf den Hook umstellen, sobald die UI-Umstellung durch ist.

- ragents.watch: zweiter Nutzer (etwa der Overseer) noch offen; optionaler Erzähler (Fortschritt als Chatnachricht ohne Koordinator) nicht gebaut.

- Nachstoß bei leerer Modellantwort im Journal sichtbar machen: heute steht nur der Modellkontext (Nutzer-Nachricht) und bei zweimaligem Leerlauf das Fehlerereignis; ein Runtime-Ereignis für den ersten Nachstoß fehlt.


- Auswertung der Journale: ein gescheiterter Funktionsaufruf innerhalb von typescript_eval steht zweimal als tool.call.failed (innere Funktion und Snippet, Lauf a866df2d seq 1288/1289); Kennzahlen über die Aufrufkennung (":function:") entdoppeln oder den Zusammenhang im Journal markieren.


- Werkzeugausgaben im Journal nicht stillschweigend kürzen (Browserfehlerlisten fehlten im Journal von Lauf fa920f6b, standen nur im Modellkontext) oder die Kürzung kennzeichnen.


- Actor-Chat-Snapshot: einen beendeten Modell-Turn ohne Text oder Fehlermeldung von einem noch wartenden Input unterscheidbar machen; sonst kann das Balkon-Demo bei leerer Modellausgabe im Ladezustand bleiben.

- Unveränderte fachliche Wortspiel-, Balkon- und Listenaufträge mit der TypeScript-API mehrfach mit echten Modellen prüfen: Ergebnis, Aufbauzeit, Reparaturen, Seiteneffekte, UI-Bedienung und Lebenszyklus. Testläufe nicht reparieren und keinen technischen Lösungsweg vorgeben.


- Nach einem Neustart des Beispielprofils showcase den Mini-App-Aufruf `addEntry` in der bestehenden Notizliste live prüfen; die Methode wurde für Großbuchstaben korrigiert, die gemeinsame Schichtwerk-UI ist dort bereits aktiviert.

- Run-Scripts: `RUN_SCRIPTS_DIR` für Pakete außerhalb des Repos erst beim zweiten Nutzer.

- Homepage: Echte Screenshots der Kachelfläche sowie von Textanalyse und gemeinsamer Actor-Liste aus einem showcase-Lauf aufnehmen und die Bildplatzhalter in `docs/homepage/index.html` ersetzen; braucht einen laufenden Server. Refactoring erst nach Umsetzung des Konzepts `docs/concepts/homepage-use-cases.md` zeigen.

- Prozessbereinigung als root im Linux-Container mit und ohne CAP_SYS_PTRACE live prüfen; den Linux-Pfad ohne root mit echtem /proc prüft seit dem 23.09.2026 `pnpm check:remote-workspace`, Parser- und Ablaufregressionen sowie echte macOS-Prozesse die Servertests.

- Reste der Vendor-Herkunft im Chat-Code: deutsche Bezeichner in apps/web/src/chat und apps/server/src/chat-handler.ts.


- Umlautverlust aus Selbsttest Runde 6 bei erneutem echtem Fehlfall zwischen Providertext und Plattform eingrenzen; interleavte Werkzeugargumente und byteweise geteiltes UTF-8/SSE sind verlustfrei getestet.

## Ideen

- Abgesetzte Prozesse nur über einen Starter des Executors entstehen lassen, der sie sich merkt, damit Prozessleiste und Stopp auf einem Mac auch Programme aus `/bin` und `/usr/bin` erreichen (Grenze in `docs/spec/plugins.md`, 23.09.2026).

- Ordner je Run auch auf dem Arbeitsplatz, vom Executor dort angelegt (etwa ein Worktree des geöffneten Repositorys), damit Abläufe, die das Repository verändern, dort mit den Zugangsdaten des Entwicklers laufen können; heute legen solche Vorlagen den Ordner je Run auf dem Server fest (23.09.2026).

- Aus dem Vergleich mit Hermes Agent 0.21 (Pantheon, 31.08.2026): Kosten je beauftragtem Helfer im Ergebnis von `agent_spawn` und `actor_input` sichtbar machen (heute nur `pnpm driver usage` je Actor), und eine optionale Schema-Prüfung für die Antwort eines LLM-Helfers, damit ein Koordinator strukturierte Ergebnisse verlangen kann; TypeScript-Actors haben das schon, LLM-Actors nicht.


- Einen Run aus der VS-Code-Erweiterung im Browser öffnen braucht einen Deep-Link `?run=`, weil das Web keinen Run in der Adresse trägt; der Befehl `ragents.openRunInBrowser` ohne Aufrufer ist seit dem 24.09.2026 gestrichen.

- Logo: zwölf fertige Prompts für den Psycho-Charakter unter docs/logo-drafts/drafts/psycho-character/error.md (gitignored) warten auf einen streng seriellen Higgsfield-Lauf (Starter-Plan: höchstens vier Jobs gleichzeitig).

- Fork und Ad-hoc-Fragetool. Wir haben jetzt hier schon unseren globalen, also quasi diesen globalen Chat, diesen globalen Koordinator. Und das könnten wir quasi auch machen. Wir könnten irgendwie so ein schnelles Ask-Ding machen. Also auch oben in der Leiste, also quasi so ein Knopf. Da könnte ich irgendwie einfach eine Frage stellen. Und wenn die Antwort kommt, könnte man die einfach als Toast oder so irgendwo hinmachen. Müssen wir gucken genau wie, aber so stelle ich mir das vor.

- Weitere feste Reiter auf die Fläche verlagern: Actor-Views bekommen bereits automatisch eine Kachel; welche übrigen Arbeitsbereiche folgen und wie sie erreichbar bleiben, ist offen.

- Context Compression: Hier müssen wir schauen, was es schon gibt. Beispiel, also von den Ideen her. Also wir können es natürlich auch selber implementieren oder wir nehmen uns ein Open-Source-Tool dafür. Headroom gibt es vielleicht, das ist ganz cool. Aber wir müssen gucken, aber generell brauchen wir das natürlich. Und wir wollen natürlich auch den Kontext nicht komplett komprimieren, sondern natürlich eben auch ich sag jetzt mal ihn trotzdem noch accessible machen, wenn man ihn doch nochmal brauchen sollte. Das ist ja eigentlich die moderne Idee. Wir müssen jetzt hier natürlich auch bei diesem Feature gucken, was ist die moderne Idee, wie wir Kontext komprimieren.

- validateConfigFileSections prüft Schlüssel inaktiver Plugins nur mit Log-Hinweis statt hart - entscheiden, ob das auch ein harter Fehler werden soll.

- Zeitplan-Trigger nach dem Trigger-Prinzip: Zeit als abonnierbares Event, das einen ActorInput erzeugt - NICHT als Warten/Timer im Script (das Turn-Modell wartet nie).
