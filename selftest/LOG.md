# Selbsttest-Protokoll

## Allgemeine Builder-Grenzen und Werkzeugverträge, 12.09.2026

Nach dem fehlgeschlagenen Balkon-Test wurden allgemeine Plattformgrenzen geprüft. Keine
fachlichen Abläufe oder neuen Wizard-Vorlagen; keine weitere Reparatur einzelner Testläufe.

- Der echte Scheduler bietet dem Run-Builder die vier direkten strukturellen Werkzeuge
  nicht an und weist auch das nachträgliche Öffnen ab. Die native Programmaktivierung erlaubt
  ihm ein TypeScript-Programm mit onInput, aber keine direkte Teilnehmer-View.
- Builder- und Fachprompts bleiben bei Primary-Wechsel, Fork und Journal-Replay korrekt
  zugeordnet. Script-Actors behalten ihre Aufbauwerkzeuge.
- agent_spawn verlangt tools ausdrücklich; fehlende oder unbekannte Auswahl erzeugt keinen
  Actor. Explizites null unterstützt anschließend aktivierte dynamische Actor-Funktionen.
- Canvas und Sichtbarkeit lösen dieselben Paket- und Actor-Referenzen auf. Gestoppte Views
  verschwinden mit ihren Linien; tatsächlich unbekannte Ansichten bleiben Fehler.
- 279 Engine-Tests, 330 Server-Tests, 278 Webtests und 44 Homepage-Tests bestanden.
  Drei optionale Language-Server-Livetests wurden übersprungen. Typechecks, Lint,
  Homepage-Generierung und Web-Build sind grün. Server-HTTP-Tests benötigten wegen
  Sandbox-Portbeschränkungen einen genehmigten Lauf außerhalb der Sandbox.
- Die gespeicherte Standard-Denktiefe des core-Run-Koordinators wurde über die Settings-API
  auf high gesetzt; Relay und Standardprofil behielten ihre Auswahl. Quellvorgaben sind high.

Die Codeänderungen benötigen einen Serverneustart. Ein neuer unveränderter Modell-Testlauf
steht noch aus; diese Regressionen sind kein Beleg, dass ein Modell jede Aufgabe korrekt löst.
Der frühere Testbericht hatte den Zustand nach Stoppen nicht geprüft: Dabei verschwanden die
Apps, während ihre expliziten Canvas-Verweise Fehlerplätze erzeugten. Dieser Lifecycle-Fehler
ist nun durch eine eigene Regression abgedeckt.

## Balkon-Wizard mit echtem Modell, 12.09.2026

Geprüft nach dem von Ronald ausdrücklich erlaubten core-Neustart gegen Port 3000 mit
Produktions-Webbuild und isoliertem Headless-Chrome. Echter Modelllauf, keine simulierten
Antworten. Run `85530558-c195-47bd-b1b1-644779a2f1d6`, Titel
"Selbsttest Balkon-Wizard 12.09.2026" (Lauf 7). Startauftrag ist unverändert der Text der
korrigierten Balkon-Promptkarte. Ergebnis: fehlgeschlagen, bereits vor der ersten Nutzerantwort.

- Der tatsächlich geladene Koordinatorprompt enthält die verschärfte TypeScript-Setup-Regel.
  GLM 5.3 Flash mit Denktiefe low ignoriert sie dennoch: direkter `agent_spawn` in Sequenz 46,
  direkte Aktivierung in Sequenz 89, direkte Canvas-Aufrufe ab Sequenz 92. Es entsteht nur
  `balkon-wizard` mit React-View, kein Setup-Handler. Der Aufbau benötigt rund 3 Minuten 51 Sekunden,
  42 Werkzeugaufrufe und sechs fehlgeschlagene Aufrufe. Mehrere fehlerhafte Quelltextentwürfe
  werden unterwegs korrigiert; die Aktivierung besteht schließlich die Typ- und Bauprüfung.
- Der Berater wird mit gültigem Modellprofil angelegt. Das frühere Problem des fehlenden
  Modells tritt hier nicht auf. Seine Werkzeugauswahl bleibt aber `null`, er erbt damit die
  allgemeine Auswahl. Sein Fachprompt fordert nächste Fragen als Text; die Beschreibung des
  verfügbaren Werkzeugs `ask_user` verlangt für Benutzerentscheidungen dagegen einen Werkzeugaufruf.
  Der ungebundene Promptbeitrag `ask.hbs` wird dem sekundären Actor nicht automatisch zugestellt.
- Die Canvas-Prüfung weist eine unbekannte Gruppe, den falschen View-Verweis und eine Linie
  zum menschlichen Owner vor dem Speichern zurück. Der Koordinator korrigiert die Aufrufe;
  am Ende ist `app:@balkon-berater/main` als reale App platziert. Keine Fehlerbox für eine
  nicht vorhandene App. Die eigene Beraterkarte ist standardmäßig ausgeblendet.
- Die App erscheint als eigenständiges Canvas-Fenster und verwendet AppLayout, Stack und Form.
  Beim Klick auf "Beratung starten" erreicht der Auftrag den Berater. Dieser ruft in Sequenz 113
  `ask_user` auf, worauf Sequenz 114 eine wartende Aktion anlegt. Die Rückfrage erscheint im
  Koordinator-Inspector, während die App ihren Modell-Turn als laufend betrachtet. Im realen DOM
  bleiben Textarea und "Antwort senden" deaktiviert. Der Ablauf ausschließlich über das Formular
  ist blockiert; fünf Antworten und die Schlussauswertung konnten deshalb nicht geprüft werden.
- Zusätzlich zeigt der Fortschritt zwei interne Aufgaben statt fünf Fragen. Schon der
  Startauftrag wird als Gesprächsnachricht in der App angezeigt. Die Standardgröße erfordert
  Scrollen bis zum Formular. Diese Beobachtungen ersetzen keine abgeschlossene Interviewprüfung.

Der Fehlfall wurde ohne korrigierende Nachrichten oder Änderungen an seinem Programm geprüft.
Der eigene Testlauf wurde anschließend gestoppt und zur Nachprüfung erhalten; core bleibt laufen.
Screenshots der Prüfung liegen temporär unter `/private/tmp/ragents-balcony-qa/`.
Die bloße Promptverschärfung ist mit diesem Modell in diesem Lauf nicht ausreichend.

## Oberflächenkontext für den globalen Koordinator, 11.09.2026

Geprüft mit dem Produktions-Webbuild, einem isolierten core-Server auf Port 4317 und einem
eigenen Headless-Chrome auf Port 4318. Ein protokollierender Modelltreiber erfasste die tatsächlich
vom Scheduler zusammengesetzten Requests; diese Prüfung verwendet keinen externen Modellaufruf.

- Die Browsernachricht auf der leeren Startansicht übermittelt home ohne Run oder Auswahl.
  Nach Öffnen von Kontextprüfung Alpha und Auswahl des Koordinators über die Actorliste
  erreichen Laufreferenz, Titel, der Bereich Netz und Actor @coordinator den Modellkontext.
- Nach dem Wechsel zu Kontextprüfung Beta übermittelt die nächste Nachricht den zweiten
  Run und keine alte Actor-Auswahl. Netzwerkrequest, serverseitige Namensauflösung und
  tatsächlicher Systemprompt stimmen überein. Der sichtbare Chattext bleibt unverändert.
- Die Prüfung erfasst keine Browserfehler. Navigation erzeugt keine Koordinator-Nachricht;
  der Standort wird nur mit der ausdrücklich abgesendeten Eingabe aufgenommen.
- Sechs Serverregressionen prüfen mehrere wartende Eingaben, spätere Titeländerungen,
  Journal-Neuladen, Nachrichten ohne Kontext, normale Runs, ungültige oder überlange Daten,
  nicht mehr verfügbare Ziele und die tatsächliche HTTP-Übergabe. Sechs Webregressionen
  prüfen Run-Wechsel, Abwahl, Übersicht, eingeklappte Bereiche und getrennte Requestdaten.
- Prompt, Spec, Betrieb, Homepage und der bestehende Koordinator-Walkthrough sind angepasst.
  Eine zusätzliche Promptkarte ist für die automatische Orientierung nicht nötig.

Abschluss: `PRODUCT_PROFILE=core pnpm check` mit Exitcode 0. 883 Tests bestanden
(AI 13, Agent 7, Engine 247, Server 318, Web 256, Homepage 42); drei optionale
Language-Server-Livetests übersprungen. Typechecks, Lint, Homepage-Prüfung und Web-Build sind grün.
Die eigenen Testinstanzen wurden beendet; reguläre Profilserver und Daten blieben unberührt.

## Kleine Gemma-Titel und eigene Modellwahl, 11.09.2026

Geprüft mit isoliertem core-Server auf Port 4317, Daten unter `/private/tmp` und eigenem
Headless-Chrome auf Port 4318. Die Titel liefen über die echte ModelRuntime und OpenRouter
mit Gemma 4 A4B; nur der Gesprächstreiber war für diese Prüfung ersetzt.

- Drei deutsche Aufträge erzeugten passende Titel mit 3 bis 8 Wörtern und unter 80 Zeichen.
  Vom Anstoßen der Titelerzeugung bis zur Browseranzeige vergingen 718, 593 und 617 ms.
  Jeder gespeicherte Titel löste eine SSE-Listenänderung aus. Die abgeschlossenen Run-Journale
  blieben dabei bytegleich. Die Zeiten sind Einzelmessungen, keine garantierte Antwortzeit.
- Der kurze Titelprompt erhält die Begriffe des Auftrags. Die echten Ergebnisse nennen
  Einkaufsliste, CSV-Import mit deutschen Dezimalkommas und Familienausflug nach Hamburg.
  Eine vorherige Messung hatte die unpassende Verkürzung Familienplanung gezeigt.
- Die Browserprüfung bestätigt Gemma als Vorgabe, Modellsuche, ungespeicherte Auswahl,
  Verwerfen, Deaktivieren, erneutes Speichern und Wiederherstellung nach Neuladen.
  Die tatsächliche Einstellungsdatei enthält die gewählte Auswahl beziehungsweise null.
  Visuell geprüft bei 1500 x 1050 und 390 x 844; Auswahl und Speichern bleiben erreichbar.
- Die gezielten Regressionen prüfen dynamische Modellwahl, unveränderte vorhandene Titel,
  parallele Anfragen ohne doppelte Erzeugung, Reasoning aus, Token- und Zeitbudget,
  keine Client-Wiederholungen, Abbruch bei Löschung und Shutdown, SSE-Abmeldung,
  Zugriffsrechte, ungültige Einstellungen und Schreibfehler ohne Änderung des aktiven Stands.

Abschluss: `pnpm check` mit Exitcode 0. 844 Tests bestanden
(AI 13, Agent 7, Engine 247, Server 301, Web 234, Homepage 42); drei optionale
Language-Server-Livetests übersprungen. Nach der finalen Gemma-Vorgabe und Promptanpassung
bestanden die 19 gezielten Serverprüfungen und die 42 Homepage-Prüfungen erneut.
Typechecks, Lint, generierte Homepage-Referenzen und abschließender Web-Build sind grün.
Die eigenen Testinstanzen wurden beendet; reguläre Profilserver und Daten blieben unberührt.

## Actorliste und persönliche Canvas-Ansicht, 11.09.2026

Geprüft gegen den Produktionsbuild mit isoliertem core-Server auf Port 4317 und eigenem
Headless-Chrome auf Port 4318. Der native Sammelboard-Start verwendet echte TypeScript-Prozesse,
HTTP und iframe-Bridge; sein Modelltreiber ist für diese UI-Prüfung ersetzt. Die regulären
Profilserver und ihre Daten blieben unberührt.

- Alle vier Beteiligten stehen in der durchsuchbaren Actorliste. Der LLM-Listenhelfer mit
  eigener Mini-App startet ohne zusätzliche Canvas-Karte. Sein Name öffnet den Inspector,
  ohne die Karte einzublenden. Einzelwahl und Gruppenwahl zeigen oder verbergen sie gezielt.
- Das App-iframe bleibt beim Umschalten dasselbe DOM-Element. Ein echter Aufruf ergänzt
  einen Listeneintrag; ein anschließender ungespeicherter Entwurf bleibt beim Ein- und
  Ausblenden erhalten. Die drei ursprünglichen Turns bleiben abgeschlossen, ohne neue Turns.
- Verbindungen und Actor-Sichtbarkeit bleiben nach Neuladen und erneutem Öffnen des Runs
  gespeichert. Zurücksetzen stellt die Standardansicht wieder her. Das Journal ist vor und
  nach der reinen Ansichtsprüfung bytegleich; die App-Funktion journalisiert separat ihre Arbeit.
- Suche, gegenseitiges Ablösen der Pop-outs, Escape mit Fokusrückgabe, Verlassen per Tab und
  Schließen beim Öffnen der Einstellungen sind geprüft. Keine Browserfehler. Visuelle Prüfung
  bei 1500 x 1050 und 390 x 844: Liste, Suche und Schalter bleiben erreichbar.
- 18 neue Regressionen prüfen Standard- und Einzelsichtbarkeit, Speicherung je Run, Suche,
  Listeninhalt, ausgeblendete Vorfahren, erhaltene Nachfolger und Apps, explizite Platzierung,
  wiederverwendete Handles, fehlende Referenzen und entfernte Verbindungen samt Beschriftung.

Abschluss: `pnpm check` mit Exitcode 0. 826 Tests bestanden
(AI 13, Agent 7, Engine 247, Server 288, Web 229, Homepage 42); drei optionale
Language-Server-Livetests übersprungen. Typechecks, Lint, generierte Homepage-Referenzen
und Web-Build sind grün. Die eigenen Testinstanzen wurden beendet.

## Modelleinstellungen und Promptkategorien, 10.09.2026

Geprüft gegen den Produktionsbuild mit isoliertem core-Server auf Port 4317, eigenen
temporären Datenverzeichnissen und eigenem Headless-Chrome auf Port 4318. Die regulären
Profilserver und ihre Daten blieben unberührt. Diese Prüfung benötigt keine Modellaufrufe.

- Die Browserauswahl speichert Run-Koordinator GLM 5.3 mit Denktiefe high über die echte
  Produkt-API in der Einstellungsdatei. Vermittler und globaler Koordinator behalten
  GLM 5.3 Flash mit low. Ein neu geöffneter Run-Entwurf zeigt die gespeicherte Auswahl.
- Ein simulierter Verbindungsfehler beim Speichern zeigt einen Fehler, erhält den lokalen
  Entwurf und erlaubt einen erneuten Versuch. Verwerfen stellt die gespeicherte Auswahl wieder her.
- Eine frische Instanz persistiert bereits die erste globale Auswahl. Nach Änderung der
  Produktvorgabe und echtem Prozessneustart bleiben beide Einstellungen getrennt erhalten.
  Der Test fand zuvor die unerwünschte erneute Ableitung der globalen Auswahl aus dem
  Produktprofil; Erstpersistenz und Regression beheben diesen Fehler.
- Engine-Integrationstests prüfen mit ersetztem Modelltreiber tatsächliche Actor-Erzeugung
  und Turns: Neue Actors verwenden neue Vorgaben, bestehende Actors und ausdrücklich
  gewählte Startoptionen behalten ihre Ausführung. Unvollständige, ungültige und unberechtigte
  Speicheranfragen werden abgewiesen; Schreibfehler ändern den gespeicherten Stand nicht.
- Die Startfläche zeigt 27 Referenzkarten in sechs Gruppen, zuerst zwölf Mini-Apps.
  Die Suche nach Mini-Apps lässt genau diese zwölf Karten stehen. Die neue Karte für eine
  Liste mit zwei Ansichten übernimmt ihren vollständigen Quellprompt unverändert ins
  Eingabefeld und sendet ihn nicht. Die hier neu ergänzten Beispielaufträge wurden nicht
  zusätzlich mit einem echten Modell ausgeführt; die Actor-Liveprüfungen stehen unten.
- Visuelle Prüfung bei 1500 x 1050 und 390 x 844: Modellfelder bleiben bedienbar,
  die schmale Ansicht ist scrollbar. Titel und Beschreibungen der Promptkarten sind kürzer;
  Schlagworte bleiben such- und filterbar, ohne die einzelnen Karten zu füllen.

Abschluss: `pnpm check` mit Exitcode 0. 808 Tests bestanden
(AI 13, Agent 7, Engine 247, Server 288, Web 211, Homepage 42); drei optionale
Language-Server-Livetests übersprungen. Typechecks, Lint, deterministische
Homepage-Referenzen und Web-Build sind grün. Die eigenen Testinstanzen wurden beendet.

## Actor-Programme, 10.09.2026

Geprüft mit einer isolierten core-Instanz auf Port 4317 und eigenem Datenverzeichnis unter
`/private/tmp`; die regulären Profilserver wurden nicht neu gestartet. Echte Modellaufrufe
verwendeten die im Profil vorhandenen Modelle Qwen 3.8 Max und GLM 5.3 Flash. Die Browserprüfung
lief in einer eigenen Chrome-Instanz gegen den echten Web-Build, einschließlich iframe und IPC.

- Textanalyse, Run `8f1e480b-389d-4217-83bb-60e089cb4689`: Die freie Promptkarte erzeugte
  ein Actor-Paket mit einer erfolgreichen Aktivierung. Zwei Browseraufrufe mit
  `Die Welt ist groß.\nUnd schön.` lieferten jeweils 29 Zeichen, 6 Wörter und 2 Zeilen.
  Canvas und Vollansicht zeigten denselben Aufrufzähler 2. Das Journal enthielt weiterhin
  genau den einen Koordinator-Turn; die Bedienung erzeugte keinen weiteren Modell-Turn.
  Die geprüfte Vollansicht steht unter `docs/homepage/screenshots/actor-text-analysis.png`.
- Zähler, Run `adaf5d01-84a9-4ef5-8555-6a9774f6979a`: Die unveränderte freie Karte erzeugte
  einen Actor ohne View, aktivierte ihn einmal und schickte drei getrennte ActorInputs.
  Drei abgeschlossene native Turns mit jeweils null Modelltokens ergaben
  `{texts: ["eins", "zwei", "drei"], count: 3}`. `read_counter` lieferte diesen Stand noch
  im selben Koordinator-Turn wie die Aktivierung. Zehn Werkzeugaufrufe, kein Fehler und
  kein unbekannter Werkzeugname. Der vorherige Lauf mit derselben Karte und demselben
  Modell benötigte 22 Aufrufe und scheiterte wiederholt am eingefrorenen Werkzeugbestand.
  Das ist ein einzelner Vorher-/Nachher-Lauf, keine allgemeine Leistungsstatistik.
- Sammelboard, Run `fdfe706b-e213-4778-b192-a2be83bb2395`: Das native Run-Script richtete
  einen LLM-Actor mit Funktion und View ein. Sein Modell schrieb den ersten Listeneintrag
  über `append_to_list`; anschließend ergänzten die echte iframe-View und die Funktionskarte
  je einen weiteren Eintrag. Alle drei standen im intrinsischen Zustand desselben LLM-Actors.
  Beide UI-Aufrufe waren erfolgreich und erzeugten keine weiteren Turns. Setup, Listenhelfer
  und Koordinator schlossen ihre drei ursprünglichen Turns erfolgreich ab.
  Der anschließende Not-Aus über die Oberfläche stoppte die erzeugten Actors und entfernte
  deren View und Funktionskarte aus der Arbeitsfläche.

Die Live-Läufe fanden drei konkrete Integrationsfehler: Workspace-Vorbereitung vor Anlage
des Runs, neue Funktionen erst im nächsten Turn sichtbar und ein festes `thinking: off`
im Relay-Profil trotz konfigurierter Denktiefe. Alle drei wurden korrigiert und mit
Regressionen abgesichert. Der wiederholte Zähler- und Sammelboard-Lauf bestätigt die Fixes.
Automatische Diagnostik meldete zudem im Textanalyse-Lauf die vom Modell erzeugten
TypeScript-Fehler vor der Aktivierung; sie wurden mit normalen Dateiänderungen behoben.

Der Gesamtcheck fand außerdem ein macOS-Prozessrennen: Ein zwischen den
`ps`-Abfragen beendeter oder durch exec veränderter Prozess ließ den gesamten Scan scheitern.
Eindeutige `<defunct>`-Einträge werden ausgelassen. Bei lebenden Prozessen muss die
Befehlszeile vor und nach der Umgebungsabfrage identisch sein; nur veränderte PIDs werden
mit frischen Daten erneut gelesen, insgesamt höchstens dreimal. Dauerhaft instabile Prozesse,
Zugriffs- und Parserfehler bleiben harte Fehler. Der Zombie-Fall wurde mit einem eigenen
Prozess reproduziert; injizierte ps-Antworten prüfen Wechsel, Wiederholungsgrenze und Fehler.
Der Stop-Regress verwendet die bestätigte Prozess-ID aus dem erfolgreichen Funktionsaufruf;
eine zwar angelegte, aber noch leere Markerdatei darf nicht als PID 0 gelesen werden.

Ein erster Textanalyse-Versuch mit GLM 5.3 Flash endete mit fehlerhaft formatiertem
Werkzeugtext und ohne App. Dieser Modellfehler ist nicht als erfolgreicher Aufbau gewertet;
es gibt dafür keinen stillen Modellwechsel. Der anschließende Qwen-Lauf wurde ausdrücklich
als eigener Test gestartet. Prompts priorisieren jetzt die passende Vorlage und vorhandene
Fachtests, damit unnötige Neuimplementierungen und Vertragsabfragen entfallen.

Alle zuvor vorhandenen regulären Runs wurden auf Ronalds ausdrücklichen Auftrag gelöscht.
Die abschließende Kontrolle fand unter `.data/*/runs` keine Run-Journale; die aktive
Schreibsperre des regulären Servers blieb erhalten.
Die isolierten Testinstanzen wurden beendet und ihre Run- sowie Sessiondaten anschließend
gelöscht. Die Ergebnisse bleiben hier und im geprüften Homepage-Screenshot dokumentiert.

Abschluss: `pnpm check` vollständig mit Exitcode 0. 783 Tests bestanden
(AI 13, Agent 7, Engine 244, Server 274, Web 204, Homepage 41); die drei ausdrücklich
optionalen Language-Server-Livetests blieben übersprungen. Paket-Typechecks, Lint,
generierte Homepage-Referenzen und Web-Produktionsbuild sind ebenfalls grün.

Autonome Selbstverbesserungs-Schleife, gestartet 27.08.2026 um 20:51, Laufzeit mindestens
bis 22:51. Ablauf je Runde: 12 Testfälle aus CATALOG.md mit je zwei Prompts, parallel
gefahren von Subagenten (medium) gegen den lokalen Server
(Koordinator deepseek/deepseek-v4-flash-0731). Danach End-Analyse, Fixes, Neustart des
Servers, nächste Runde.

## Runde 1 (20:52 bis 21:13, 12 Agenten, 24 Läufe)

Urteile: 12x erfüllt, 6x teilweise, 2x verfehlt (T02-B, T11-B), 2x Abbruch (T01-B
Deadlock, T09-A Race). Wichtigste Cluster:

1. ask_user reproduzierbar kaputt (10 Fehlschläge, "Canonical values cannot contain
   undefined") - Regression der heutigen strikten canonicalJson.
2. event_subscribe akzeptierte keine Handles (5 Fehlschläge, in T09-A Deadlock-Ursache),
   während actor_input/actor_stop Handles können.
3. Script-Werkzeuge: Array-Parameter kommen vom Modell als JSON-String an (T07, je 5
   Fehlaufrufe).
4. compilationHash-Abtippen bleibt größtes Modell-Ärgernis (T06/T07: verstümmelte Hashes
   und Pfade).
5. Modellverhalten deepseek-v4-flash: erfindet keine Werkzeuge, aber (a) meldet Schritte
   als erledigt, die nie liefen (T01-B), (b) wartet auf Events ohne Abo (Deadlocks),
   (c) spawnt Gesprächsrollen mit vollem Werkzeugprofil, die dann minutenlang das Repo
   durchsuchen, (d) Formattreue mäßig (T11-B), (e) interne Namen im Chat.
6. Prompt-These bestätigt sich differenziert: nicht die Länge entscheidet, sondern ob
   Rollen, Rundenzahl und Endebedingung genannt sind (T01-A vs. T01-B).

Fixes nach Runde 1 (alle verifiziert, Engine 166 + Server 60 Tests grün):
- canonicalJson: undefined-Objektfelder werden wie bei JSON.stringify ausgelassen
  (ask_user funktioniert wieder); undefined in Arrays bleibt harter Fehler.
- event_subscribe löst Handles auf wie actor_input.
- JSON-String-Koersion an der Handler-Grenze (coercedHandlerInput): Arrays/Objekte/Zahlen
  als String werden ausgepackt, wenn sie dem Vertrag entsprechen.
- compilationHash KOMPLETT aus den Modell-Verträgen entfernt (logic_test/install,
  script_tool_test/install, run_module_test/install) - der Attestat-Store bindet den
  Build serverseitig; Prompts und Doku nachgezogen.
- Orchestrierungs-Prompt: Gesprächsrollen immer mit tools: []; erst abonnieren, dann
  beauftragen; nur journalbelegte Schritte berichten; keine internen Namen im Chat.

Server um 21:4x mit den Fixes neu gestartet.

## Runde 2 (gestartet 21:4x)

Gleicher Katalog, gleiche Besetzung. Erwartung: T02-B/T04 (ask_user), T07 (Arrays),
T06/T07 (kein Hash-Abtippen mehr), T01-B/T09-A (Abo-Reihenfolge) sollten sich deutlich
verbessern.

Ergebnis Runde 2 (21:22 bis 21:37): 17x erfüllt, 6x teilweise, 1x verfehlt (T11-B
Formattreue). ALLE Runde-1-Fixes bestätigt: ask_user 0 Fehlschläge, keine Deadlocks,
kein Hash-Abtippen, Arrays kommen an, T09 sauber. Neue Wurzelursachen:

1. Logic-Interpreter kannte kein Optional Chaining (?. warf statt kurzzuschließen) -
   T08-Kaskade inkl. scheinbar falschem Test-Grün (Modell testete mit state {} statt
   null, um den ?.-Fehler zu umgehen).
2. Kein number[]-Parametertyp für Script-Werkzeuge - vier Compile-Umwege in T07.
3. Modelle tippen weiterhin IDs/Pfade ab und verstümmeln sie (Subscription-ID in T01-B,
   Tippfehler-Ordner .ronard im Workspace-Root durch abgetippten relativen Pfad).
4. Kleinere Punkte notiert: Chat-Antwort löst offene Frage-Karte nicht auf (T02-B),
   edit-Werkzeug kann JSON bei mehrdeutigen Blöcken zerlegen (T06-B), Koordinator kann
   Dateiablagen fremder Läufe listen (T04-A).

Fixes nach Runde 2 (verifiziert, Engine 167 + Server 60 Tests grün):
- Optional Chaining (?.) im Logic-Interpreter, sync und async, mit Chain-Kurzschluss.
- Parametertyp number[] für Run-Modul-/Script-Werkzeuge.
- Prompts: IDs/Pfade nie abtippen ($RAGENTS_FILES_DIR wörtlich nutzen); exakte
  Formatvorgaben sind bindend; logic_test mit realem Startzustand (frischer Actor liest
  null); Ziel-Agenten müssen vor script_tool_check existieren; stateSchema-Anforderungen
  explizit.
- Tippfehler-Ordner .ronard aus dem Workspace-Root entfernt.

Server um 22:0x neu gestartet.

## Runde 3 (gestartet 22:0x)

Gleicher Katalog. Fokus: T08 (Optional Chaining), T07 (number[]), T11 (Formattreue),
T01-B (ID-Abtippen).

Ergebnis Runde 3 (22:03 bis 22:14): 17x erfüllt, 6x teilweise, 1x verfehlt - gleiche
Quote wie Runde 2, aber die Fehler sind gewandert: T06/T07/T08 jetzt sauber (Optional
Chaining und number[] greifen, kein Hash-/Token-Thema mehr), T09-A und T04 stabil.
Neue Wurzelursachen:

1. write/read/edit lösen $RAGENTS_FILES_DIR nicht auf (bash schon): write legte einen
   Ordner mit literalem Dollarzeichen im Arbeitsverzeichnis an und meldete Erfolg; die
   Selbstheilung des Modells lief auf ein riskantes rm -rf hinaus (T01-B).
2. show_document verlangt den Inhalt als Parameter - das Modell tippt Dokumente aus dem
   Gedächtnis ab und produziert Abweichungen bis hin zu Sinnfehlern (T05).
3. Verbleibende Ausfälle sind Modellverhalten von deepseek-v4-flash: Formatvorgaben
   werden trotz expliziter Prompt-Regel gebrochen (T11), knappe Aufträge werden
   umgedeutet (T02-B), Häkchen vorab gesetzt (T03-B), Agenten zu früh gestoppt (T09-B).

Fixes nach Runde 3 (verifiziert, Server 60 Tests grün):
- Datei-Werkzeuge expandieren $RAGENTS_FILES_DIR (auch ${...}- und ./-Schreibweise) auf
  die echte Run-Ablage, bevor der Pfad geprüft wird.
- show_document-Beschreibung: Inhalt wörtlich aus read/write übernehmen, nie neu tippen.
- todo_replace-Beschreibung: Häkchen erst NACH getaner Arbeit, höchstens ein active.

Server um 22:2x neu gestartet, Runde 4 als Verifikationsrunde gestartet.

## Runde 4 (gestartet 22:2x)

Verifikationsrunde für die Pfad-Expansion und die Beschreibungs-Nudges.

Ergebnis Runde 4: 19x erfüllt, 4x teilweise, 1x verfehlt - beste Runde bisher.
Verifiziert: $RAGENTS_FILES_DIR-Expansion greift (T01-B/T05 ohne Pfadfehler), die
Format-Regel wirkt (T11-A jetzt erfüllt), To-do-Führung besser. Neuer harter Fund
(T07-B): agent_spawn ohne Profil erzeugt einen dauerhaft arbeitsunfähigen Agenten -
der Turn scheitert leise, der Koordinator wartet auf eine Antwort, die nie kommt,
und meldet trotzdem Erfolg.

Fix nach Runde 4 (verifiziert, Engine 167 + Server 60 Tests grün):
- agent_spawn ohne profile/driver/model wird hart abgelehnt, mit der Liste der
  bekannten Profile in der Fehlermeldung (Selbstkorrektur im nächsten Zug).

Notiert für kommende Runden (nicht mehr in dieser Session):
- Fehlgeschlagene Turns erzeugter Agenten sind für den Erzeuger unsichtbar; ein
  Standard-Abo auf turn.finished/failed der eigenen Kinder wäre der strukturelle Fix.
- show_document sollte einen path-Parameter bekommen (Datei serverseitig lesen),
  damit Inhalte nie mehr abgetippt werden; braucht Web-Presenter-Anpassung.
- Chat-Antwort löst eine offene Frage-Karte nicht auf (T02-B, Runde 2).
- tools-Auswahl der Actors ist in der Run-Sicht nicht ablesbar (T02-A, Runde 3).
- event_query-Polling neben aktiver Subscription kostet Turns (Prompt-Thema).
- Restliche Ausfälle sind Modellverhalten von deepseek-v4-flash (Formattreue,
  Umdeutung knapper Aufträge, Profil 'relay' für normale Rollen geraten).

## Runde 5 (Verifikationsrunde für den Spawn-Guard)

Ergebnis Runde 5: 20x erfüllt, 3x teilweise, 1x verfehlt - beste Runde. Der Spawn-Guard
ist verifiziert (kein arbeitsunfähiger Agent mehr), die Pfad-Expansion trägt, T09 beide
Varianten sauber. Hartnäckigster Rest: show_document zwang weiter zum Abtippen (T05-A,
Sechsfach-Schleife mit Selbstbezichtigung).

Fix nach Runde 5 (verifiziert, Server 60 Tests + Web tsc/lint/build grün):
- show_document hat jetzt einen path-Parameter (relativ zur Run-Ablage, $RAGENTS_FILES_DIR-
  Präfix wird toleriert): der Viewer lädt den Inhalt direkt aus der Datei (contentUrl),
  nichts wird mehr abgetippt. content bleibt für nicht gespeicherte Inhalte. Werkzeug
  erzwingt genau eines von beiden.

Server neu gestartet. Ende der Selbstverbesserungs-Schleife nach fünf Runden.

## Gesamtbilanz

Verlauf der Urteile (24 Läufe je Runde):
  Runde 1: 12 erfüllt, 6 teilweise, 2 verfehlt, 2 Abbrüche/Deadlocks
  Runde 2: 17 erfüllt, 6 teilweise, 1 verfehlt
  Runde 3: 17 erfüllt, 6 teilweise, 1 verfehlt
  Runde 4: 19 erfüllt, 4 teilweise, 1 verfehlt
  Runde 5: 20 erfüllt, 3 teilweise, 1 verfehlt

Behobene Wurzelursachen (alle mit grünen Suiten):
  1. canonicalJson-Regression (ask_user komplett kaputt)
  2. event_subscribe ohne Handle-Auflösung (Deadlock-Quelle)
  3. JSON-String-Koersion an der Handler-Grenze (Arrays als String)
  4. compilationHash aus allen Modell-Verträgen entfernt
  5. Optional Chaining im Logic-Interpreter
  6. number[]-Parametertyp
  7. $RAGENTS_FILES_DIR-Expansion in den Datei-Werkzeugen
  8. agent_spawn ohne Profil wird hart abgelehnt
  9. show_document mit path statt Abtippen
  plus Prompt-Härtungen (Gesprächsrollen tools: [], erst abonnieren dann beauftragen,
  nichts Unbelegtes berichten, Formatvorgaben bindend, Häkchen erst nach Arbeit).

Verbleibende Ausfälle sind überwiegend Modellverhalten von deepseek-v4-flash:
Formattreue bei Kleinaufträgen (T11-B in allen Runden verfehlt), Umdeutung sehr knapper
Aufträge (T02-B), event_query-Polling neben aktiver Subscription, gelegentliche
Wortverstümmelungen im Deutschen. Prompt-Erkenntnis über alle Runden: nicht die Länge
entscheidet, sondern ob Rollen, Mengen und Endebedingung genannt sind - ein kurzer
Prompt mit genau diesen drei Angaben schlägt lange Prosa.

Offene Punkte für die nächste Session stehen im Abschnitt von Runde 4.

## Runde 6 (02.09.2026, 14:15 bis 14:26, 13 Agenten, 26 Läufe plus 4 Wiederholungen)

Rahmen abweichend vom Guide: Profil core auf einer Wegwerf-Instanz (Port 3999, Daten im
Scratchpad), Arbeitsverzeichnis eine Kopie der Unterlagen über STATIC_WORKSPACE_DIR,
Koordinator z-ai/glm-5.3-flash (Profilstandard). Neu: jede verfehlte oder abgebrochene Variante
wurde einmal mit deepseek/deepseek-v4-pro-0813 wiederholt, um Modellschwäche von Plattformfehlern
zu trennen. Neuer Katalogfall T13 (Hallo Welt im Dialog) aus dem Fehllauf desselben Tages.
Vorher eingebaut: journalisierte Validierungsfehler und flache Eingabeschemata.

Urteile glm-5.3-flash: 19 erfüllt, 4 teilweise (T02-A, T08-A, T08-B, T13-B), 3 verfehlt
(T02-B, T06-B, T11-B), 0 Abbrüche. Wiederholungen mit deepseek: T06-B, T08-A, T11-B erfüllt,
T02-B teilweise. Kosten je Lauf zwischen 0,0001 und 0,03 USD, deepseek bis 0,08 USD.

Die beiden Fixes des Tages tragen: T13 lief ohne Unteragent, ohne leere Argumente, ohne
Schleife; das flache mini_app_test-Schema wurde in T06, T07 und T13 von beiden Modellen beim
ersten Versuch getroffen; abgelehnte Aufrufe stehen jetzt als started+failed im Journal (T07,
T13, T02 belegt).

Plattform-Befunde (Kategorie bug/ux), nach Häufigkeit:

1. agent_spawn ohne profile oder model scheitert beim ersten Versuch in sieben Läufen (T01-B,
   T02-A/B, T08-A, T09-A/B), immer mit derselben Meldung, immer mit Selbstheilung über
   model_list. Die Meldung sollte die Profile direkt nennen, dann entfällt der Umweg.
2. expect.error "" wird in script_tool_test und mini_app_test als erwarteter Fehlertext gegen
   null verglichen (T07-A/B, T13-A/B), kostet je Lauf einen Versuch. Leeren String wie
   weggelassen behandeln oder im Schema ablehnen.
3. Mock-Validierung nennt nie das falsche Feld, sondern wiederholt den ganzen Union-Typ
   (T02-A: sieben identische Fehlschläge am event_subscribe-Mock, danach Aufgabe des
   Script-Vermittlers; T13: dialog_close-Vertrag geraten). Fehlertext muss Pfad und erwarteten
   Typ des ersten abweichenden Feldes nennen.
4. script_actor_check meldet bei fehlendem Grant eine Liste von Aufrufnamen statt den Grant
   (T02-A), das Modell streicht daraufhin die Capability und läuft in den Folgefehler.
5. "Tool script_tool_check not found" für ein indexiertes, noch nicht geöffnetes Werkzeug
   (T07-A); die Meldung muss auf tool_open zeigen.
6. tool_open verwirft bei einem falschen Namen auch die richtigen (T13-B), zwei Runden verloren.
7. ls mit unexpandiertem $RAGENTS_FILES_DIR meldet "(empty directory)" statt eines Fehlers
   (T04-B).
8. Umlaute in gestreamten Werkzeugargumenten gehen vereinzelt verloren ("frs Format",
   "auerhalb"), der Prosatext derselben Nachricht ist intakt (T04-A). Streaming-Pfad der
   Argumente prüfen.
9. thinking "off" wird für glm als thinkingLevel "low" in die Agentensession geschrieben, bei
   deepseek korrekt "off" (T11); dazu passend Reasoning-Ereignisse trotz "off" (T03, T10, T12).
10. POST /stop auf einer offenen Rückfrage reiht erst die verworfene Antwort als Eingabe ein
    und bricht dann ab (T06-B); der Antworttext bleibt stehen.
11. Prüfen: artifacts in der RunView bleibt nach show_document leer (T05); Subscription weckte
    den Koordinator nicht, event_query war nötig (T02-Wiederholung); Unterhaltungstitel bleibt
    "Neue Unterhaltung" bei schnellen Folgenachrichten (T11, T12).

Prompt-Befunde: Script-Actor wird fast nur als Vermittler beschrieben, der Fall "eigener
Zustand" (Zähler) fehlt als Beispiel, glm weicht deshalb auf einen LLM-Agenten aus (T08);
Grant- gegen Aufrufname wird an der Capability-Liste nicht vorweggenommen (T02, T08);
Wartezustände erzeugen Füllnachrichten und Leerlauf-Turns statt Turn-Ende (T01, T09);
mini_app_test startet jeden Test mit frischem Zustand, das steht nirgends (T06-A).

Modellverhalten glm-5.3-flash: Rollen-Kollaps bei knappem Prompt (T02-B: drei Rollen in
einem Agenten), Vorlagenname im Dateisystem gesucht und dann Rückfrage statt Bauen (T06-B),
Formatvorgabe und Domäne verfehlt (T11-B), Stummel-Datei und ASCII-Umlaute per bash statt
write (T05-B), Vorlagenreste (T13-B). Mit deepseek-v4-pro in allen Wiederholungen behoben
oder verbessert; deepseek fällt dafür mitten im Lauf ins Englische (T02, T06).

Prompt-These: in dieser Runde gewinnt in 9 von 13 Fällen die ausführliche Variante A, bei
gleichem Ergebnis ist B billiger. Entscheidend bleibt, ob Rollen, Zweck und Format genannt
sind, nicht die Länge.

Verfahren: eine offene ask_user-Rückfrage ist keine Stille, der Testagent muss sie über die
Ask-Route beantworten (T02-Wiederholung, T06-B); Testagenten brauchen eigene Unterordner im
Scratchpad (T05). Beides im Guide nachgezogen.
