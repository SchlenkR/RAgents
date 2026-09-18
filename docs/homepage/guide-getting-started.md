# Samples starten

Die Grundausstattung starten, ein Sample auswählen und den Ablauf verfolgen.

## Ein Sample auswählen

Ein Sample bringt seinen Aufbau und seine Oberfläche mit. Die KI muss beides nicht erst
aus einem Auftrag erstellen. In der eingebauten Hilfe führt "Sample starten" zum gewählten
Ablauf. Alternativ öffnest Du über "Neuer Run" die Startauswahl und wählst das Run-Script.

Beim Start zeigt die noch leere Arbeitsfläche einen Ladebalken und den aktuellen
Vorbereitungsschritt. Danach erscheinen die Agenten und Mini-Apps automatisch. Fehler
oder Rückfragen werden als Hinweis angezeigt; der Balken läuft dann nicht einfach weiter.

| Sample | Was Du ausprobieren kannst |
| --- | --- |
| [Wortspiel](../../homepage/reference.html#start-ragents.reference.word-game) | Vier Modelle liefern Wörter; TypeScript regelt die Reihenfolge und endet nach zwölf Beiträgen. |
| [Lernnachmittag](../../homepage/reference.html#start-ragents.reference.learning-afternoon) | Zwei Modelle arbeiten parallel; ihre Ideen erscheinen in einer gemeinsamen Liste. |
| [Sammelboard](../../homepage/reference.html#start-ragents.reference.shared-actor-list) | Einträge über Chat und Oberfläche in derselben Liste pflegen. |
| [Balkon-Wizard](../../homepage/reference.html#start-ragents.reference.balcony-wizard) | Ein Interview über eine Mini-App führen; ein Modell stellt die Fragen. |

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
[Benutzer und Rechte](guide-access.html) beschreibt die Einrichtung eines Zugangs.
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
