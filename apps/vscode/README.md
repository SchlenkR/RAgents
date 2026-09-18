# RAgents für VS Code

Explorer und Arbeitsspalte für einen laufenden RAgents-Server. Die Erweiterung bündelt keinen
Server und keine zweite Oberfläche: der Explorer ist ein nativer Baum, die Spalte und die
Mini-Apps in der Mitte sind Webviews mit einem iframe auf `column.html` des Servers (Layout aus
`apps/web/src/column`, Spalte aus `plugins/ragents.orchestration/web/column`).

## Voraussetzungen

- Ein laufender Server, etwa `scripts/start.sh core` auf `http://localhost:4710`. Die Adresse
  steht in der Einstellung `ragents.serverUrl`; `ragents.theme` wählt `auto`, `light` oder `dark`.
- Das Web muss gebaut sein (`pnpm build:web`), weil der Server `column.html` aus `apps/web/dist`
  liefert.

## Anmeldung

Verlangt das Profil Benutzer, meldet die Erweiterung sich selbst an: Befehl `RAgents: Anmelden`
oder die Zeile im Explorer. Der Sitzungstoken liegt in VS Codes SecretStorage je Serveradresse
und geht als `Authorization: Bearer` an den Server; die iframes bekommen ihn in ihrer Adresse und
der Server nimmt ihn für GET-Abrufe ohne Header (Ereignisstrom, Mini-App-Frames) auch als
Abfrageparameter `access` an. Ein Profil mit `ACCESS_TOKEN` fragt stattdessen nach dem Token.
Nach zwölf Stunden oder einem Serverneustart meldet der Explorer die nötige Anmeldung erneut;
die Spalte bietet dann `In VS Code anmelden`. `RAgents: Abmelden` beendet die Sitzung.

## Bedienung

- Aktivitätsleiste `RAgents`: alle Runs mit Zustand und Rückfragen; je Run `Actors`,
  `Mini-Apps` (rechts oder in der Mitte), `Dateien` (Artefakte als Dokument oder im Browser) und
  `Journal` (als JSON-Dokument). Das Abzeichen am Symbol zählt offene Rückfragen aller Runs.
- Zweite Seitenleiste `RAgents`: eine Kopfzeile mit Run-Details hinter dem Titel, die Mini-App als
  Bühne, der Chat ab 900 Pixel Breite rechts daneben (Griff für die Breite, Knopf in der Eingabeleiste
  legt ihn nach unten), darunter immer als Sheet (Maus, Fokus oder Griff schieben ihn hoch); der
  Adressat als Pop-out in der Eingabeleiste; rechts oben ein Menü mit Einstellungen, Browser und Abmelden.
  Ein Klick auf einen Run im Explorer wechselt die Spalte; die Karte `Neuer Run` in der Run-Liste
  öffnet die Startauswahl, der Chevron links in der Kopfzeile klappt die Liste über den Run.
- "Anwendung öffnen" im Teststand und die Anwendungsvorschau der Implementierung öffnen die laufende
  Anwendung als Reiter im Simple Browser statt im Dialog.
- Der Pfeil an einer Mini-App legt sie als Editor-Reiter in die Mitte; Explorer und Spalte
  zeigen, wo sie liegt; `Zurück in die Spalte` schließt den Reiter.

## Entwicklung

```sh
pnpm --filter ragents-vscode build     # dist/extension.js (esbuild, CommonJS)
pnpm --filter ragents-vscode watch
pnpm --filter ragents-vscode test      # reine Tests mit einem Stub-Server
pnpm --filter ragents-vscode test:host # echtes VS Code gegen einen laufenden Server, siehe unten
pnpm --filter ragents-vscode package   # .vsix ohne node_modules
```

`scripts/start-vscode.sh core` (oder ein anderer Profilname, oder eine Serveradresse) startet bei
einem Profilnamen den Server mit, falls er nicht antwortet (Log
`~/.local/share/ragents/vscode/server.log`), baut die Erweiterung, ersetzt eine laufende
Testinstanz und startet sie neu; Benutzerordner `~/.local/share/ragents/vscode`, Ausgabe der
Instanz in `start.log` daneben. Der Task `vscode: start (core)` ruft genau das auf.
Zum Starten mit F5 braucht das Repo stattdessen eine `.vscode/launch.json` (nicht eingecheckt):

```json
{
  "version": "0.2.0",
  "configurations": [{
    "name": "RAgents-Erweiterung",
    "type": "extensionHost",
    "request": "launch",
    "args": ["--extensionDevelopmentPath=${workspaceFolder}/apps/vscode"],
    "outFiles": ["${workspaceFolder}/apps/vscode/dist/**/*.js"],
    "preLaunchTask": "vscode: build"
  }]
}
```

`test:host` baut Erweiterung und Testläufer, startet das installierte VS Code
(`VSCODE_EXECUTABLE`, Standard `/Applications/Visual Studio Code.app/Contents/MacOS/Code`) mit
einem temporären Benutzerordner gegen `RAGENTS_HOST_TEST_SERVER` (Standard
`http://localhost:4710`) und prüft: Verbindung, Laufansichten, Spalte meldet sich, Run-Wechsel,
Mini-App in der Mitte. `RAGENTS_HOST_TEST_LOGIN=benutzer:passwort` prüft die Anmeldung,
`RAGENTS_HOST_TEST_TOKEN=<token>` den `ACCESS_TOKEN`-Zugang. Der Server braucht dafür
mindestens einen Run, am besten das Sammelboard aus dem Referenz-Plugin.

## Grenzen

- Kein Betrieb ohne Server (ein fehlender Server wird alle fünf Sekunden erneut versucht; die
  Spalte zeigt solange den Hinweis mit Adresse und Fehler statt des iframes), kein
  Eingriff in den Editor, keine Datei-Synchronisation.
- Der Spaltenzustand (gewählte App, Griffhöhe, Actor) liegt im Speicher des Webviews, also je
  VS-Code-Fenster; der Explorer zeigt nur, was die Laufansicht des Servers kennt.
- `Im Browser öffnen` führt zur Startseite des Servers, weil das Web keinen Run in der Adresse trägt.
- Ändern sich `ragents.serverUrl` oder `ragents.theme`, verlangt die Erweiterung ein Neuladen des Fensters.
