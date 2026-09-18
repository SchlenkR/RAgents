# TODO

Eingang für alles, hier schreiben Ronald und die KI. Eine Zeile je Eintrag, neu oben. "Offen" ist konkrete Arbeit, "Ideen" ist noch nicht entschieden. Braucht ein Eintrag mehr als drei Sätze, wird er zu docs/concepts/<thema>.md mit Status-Zeile, und die Zeile hier verschwindet. Erledigtes wird gelöscht. Das Warum einer Änderung geht als datierter Eintrag nach docs/decisions.md, das Was ins Kapitel unter docs/spec/.

## Offen

- Paketnamen `@aicontainer/*` sind ein Relikt; für fremde Plugin-Autoren wäre ein Name wie `@ragents/host` klarer, `@ragents/server` ist aber schon das Actor-Programm-SDK.
- `scripts/install-plugin-dependencies.sh` kennt nur die Repo-Plugins; externe Plugins mit `install.sh` laufen ihre Installation selbst.
- Ignorierte Werkzeugfelder (`ignoredFields` in `tool.call.started`) in der Oberfläche zeigen: Werkzeugkarte und Aktivitätsanzeige lesen nur die bereinigte Eingabe, der Hinweis erscheint nur im Modellergebnis und im Live-Ergebnis, nicht im Journal-Ergebnis.
- Thinking-Replay modellabhängig: `packages/ai` schickt für jedes OpenRouter-Modell das Reasoning aller früheren Turns in jeden Folgeaufruf (`ai-sdk-messages.ts`); in Lauf 82d041c3 waren das 70 Prozent des Koordinator-Kontexts. Modellmerkmal im Katalog einführen und mit GLM 5.3 flash prüfen, ob es ohne läuft; kein pauschales Weglassen.
- Provider-Bindung je Modell konfigurierbar machen (`compat.openRouterRouting` mit `only`/`order`, etwa `MODEL_ROUTING` in der Host-Sektion): GLM 5.3 flash läuft bei OpenRouter über 28 Provider, der Anbieter-Cache griff in Lauf 82d041c3 bei einem Drittel der Aufrufe nicht.
- `tool.call.failed` ohne `error` im Journal (browser_check, actor_program_activate in Lauf 82d041c3); Fehlertext immer journalen.

- Homepage: Screenshot der Arbeitsspalte (`docs/homepage/screenshots/column.png`) nach dem Sheet-Umbau neu aus einem core-Lauf aufnehmen und den Bildplatzhalter in `docs/homepage/index.html` ersetzen; braucht einen laufenden Server.

- VS-Code-Erweiterung, Stufe 2 erst bei Bedarf: Spalte als eigenes Bundle im Webview statt iframe (Basis-URL in http.ts und events.ts, CORS, Token statt Cookie), nur wenn Theme-Bruch, Fokus- oder Tastaturprobleme im doppelten Rahmen auftreten; heute läuft die Spalte im iframe mit Token.

- VS-Code-Erweiterung: Klick auf einen Actor im Explorer könnte den Chip in der Spalte wählen (Nachricht selectRun mit actorId, Zustand liegt heute allein im Orchestrierungs-Plugin der Spalte); Artefakte ohne Textformat öffnen im Browser und brauchen dort die Anmeldung.

- Die Run-Liste der Web-App (`App.tsx`) und die Spalte (`column/use-session-list.ts`) laden die Liste mit derselben Logik; App.tsx auf den Hook umstellen, sobald die UI-Umstellung durch ist.

- ragents.watch: zweiter Nutzer (etwa der Overseer) noch offen; optionaler Erzähler (Fortschritt als Chatnachricht ohne Koordinator) nicht gebaut.

- Nachstoß bei leerer Modellantwort im Journal sichtbar machen: heute steht nur der Modellkontext (Nutzer-Nachricht) und bei zweimaligem Leerlauf das Fehlerereignis; ein Runtime-Ereignis für den ersten Nachstoß fehlt.


- Auswertung der Journale: ein gescheiterter Funktionsaufruf innerhalb von typescript_eval steht zweimal als tool.call.failed (innere Funktion und Snippet, Lauf a866df2d seq 1288/1289); Kennzahlen über die Aufrufkennung (":function:") entdoppeln oder den Zusammenhang im Journal markieren.


- Werkzeugausgaben im Journal nicht stillschweigend kürzen (Browserfehlerlisten fehlten im Journal von Lauf fa920f6b, standen nur im Modellkontext) oder die Kürzung kennzeichnen.


- Actor-Chat-Snapshot: einen beendeten Modell-Turn ohne Text oder Fehlermeldung von einem noch wartenden Input unterscheidbar machen; sonst kann das Balkon-Demo bei leerer Modellausgabe im Ladezustand bleiben.

- Unveränderte fachliche Wortspiel-, Balkon- und Listenaufträge mit der TypeScript-API mehrfach mit echten Modellen prüfen: Ergebnis, Aufbauzeit, Reparaturen, Seiteneffekte, UI-Bedienung und Lebenszyklus. Testläufe nicht reparieren und keinen technischen Lösungsweg vorgeben.


- Nach core-Neustart den Mini-App-Aufruf `addEntry` in der bestehenden Notizliste live prüfen; die HTTP-Route wurde für Großbuchstaben korrigiert, die gemeinsame Schichtwerk-UI ist dort bereits aktiviert.

- Canvas nach Neustart live prüfen: Wiederherstellung von Panning, Zoom und Elementgrößen nach Neuladen und Run-Wechsel, Panning bei eintreffender LLM-Nachricht, 32 Pixel Startabstand und Panelschatten in beiden Themes; Web-Typecheck, Tests und Lint sind geprüft.

- Run-Scripts: `RUN_SCRIPTS_DIR` für Pakete außerhalb des Repos erst beim zweiten Nutzer; die Mockups unter docs/ui-drafts/run-start.html zeigen noch den Entwurfsstand.

- Homepage: Echte core-Screenshots im Schichtwerk-Stil für Arbeitsfläche, Textanalyse und gemeinsame Actor-Liste aufnehmen; Refactoring erst nach Umsetzung des Konzepts `docs/concepts/homepage-use-cases.md` zeigen.

- Serverstart-Regel bestätigen: die README (Für KI-Assistenten) übernimmt die Übergabe vom 02.09. (Ronald startet den Server selbst über die VS-Code-Tasks); die frühere Erlaubnis zum Neustart ohne Rückfrage ist raus.


- Prozessbereinigung: Linux-Containerpfad mit echtem /proc und CAP_SYS_PTRACE live prüfen; Parser- und Ablaufregressionen sowie echte macOS-Prozesse sind geprüft.

- Reste der Vendor-Herkunft im Chat-Code: deutsche Bezeichner in apps/web/src/chat und apps/server/src/chat-handler.ts.


- Umlautverlust aus Selbsttest Runde 6 bei erneutem echtem Fehlfall zwischen Providertext und Plattform eingrenzen; interleavte Werkzeugargumente und byteweise geteiltes UTF-8/SSE sind verlustfrei getestet.

## Ideen


- Logo: zwölf fertige Prompts für den Psycho-Charakter unter docs/logo-drafts/drafts/psycho-character/FEHLER.md warten auf einen streng seriellen Higgsfield-Lauf (Starter-Plan: höchstens vier Jobs gleichzeitig).

- Fork und Ad-hoc-Fragetool. Wir haben jetzt hier schon unseren globalen, also quasi diesen globalen Chat, diesen globalen Koordinator. Und das könnten wir quasi auch machen. Wir könnten irgendwie so ein schnelles Ask-Ding machen. Also auch oben in der Leiste, also quasi so ein Knopf. Da könnte ich irgendwie einfach eine Frage stellen. Und wenn die Antwort kommt, könnte man die einfach als Toast oder so irgendwo hinmachen. Müssen wir gucken genau wie, aber so stelle ich mir das vor.

- Weitere feste Reiter auf die Fläche verlagern: Actor-Views stehen bereits automatisch auf dem Canvas; welche übrigen Arbeitsbereiche folgen und wie sie erreichbar bleiben, ist offen.

- Context Compression: Hier müssen wir schauen, was es schon gibt. Beispiel, also von den Ideen her. Also wir können es natürlich auch selber implementieren oder wir nehmen uns ein Open-Source-Tool dafür. Headroom gibt es vielleicht, das ist ganz cool. Aber wir müssen gucken, aber generell brauchen wir das natürlich. Und wir wollen natürlich auch den Kontext nicht komplett komprimieren, sondern natürlich eben auch ich sag jetzt mal ihn trotzdem noch accessible machen, wenn man ihn doch nochmal brauchen sollte. Das ist ja eigentlich die moderne Idee. Wir müssen jetzt hier natürlich auch bei diesem Feature gucken, was ist die moderne Idee, wie wir Kontext komprimieren.

- validateConfigFileSections prüft Schlüssel inaktiver Plugins nur mit Log-Hinweis statt hart - entscheiden, ob das auch ein harter Fehler werden soll.

- Zeitplan-Trigger nach dem Trigger-Prinzip: Zeit als abonnierbares Event, das einen ActorInput erzeugt - NICHT als Warten/Timer im Script (das Turn-Modell wartet nie).


