# Prüfläufer: Arbeitsbereich auf einem anderen Rechner

Prüft Runs, deren Arbeitsbereich auf einem Arbeitsplatz liegt, also auf einem fremden Rechner. Der fremde
Rechner ist ein Linux-Container mit eigenem Dateisystem, eigener Prozesstabelle, eigenem `localhost`
und anderer Plattform; jeder Zugriff des Servers auf seine eigene Maschine fällt damit auf.

```sh
pnpm check:remote-workspace                 # Ordner /work/project, den es nur im Container gibt
pnpm check:remote-workspace --shared-path   # derselbe Pfad auch auf diesem Rechner, mit anderem Inhalt
pnpm check:remote-workspace --vscode        # zusätzlich der VS-Code-Host-Test gegen denselben Server
pnpm check:remote-workspace --browser       # zusätzlich browser_open auf eine Seite im Container
```

Voraussetzungen: macOS mit OrbStack oder Docker Desktop (`host.docker.internal` erreicht dort einen
Server auf `127.0.0.1`), Node 22, ein Checkout mit `pnpm install`. Der erste Image-Bau braucht Netz
(Node-Image, npm, mit `--browser` Chromium aus Debian); danach kommen diese Schichten aus dem Cache.
Mit `--vscode` öffnet sich ein eigenes VS-Code-Fenster.

## Ablauf

1. `scripts/package/build-package.ts` baut das Host-Paket aus dem Arbeitsstand in einen Temp-Ordner.
   Das `Dockerfile` installiert erst die Abhängigkeiten aus dem Paketmanifest mit npm unter Linux
   (gecachte Schicht), dann die Paketdateien; `node_modules` dieses Rechners gehen nie in den Container.
2. `script-model.ts` startet ein Modell-Relay auf `127.0.0.1`, das statt eines Sprachmodells Programme
   ausführt: ein Auftrag trägt `SKRIPT:<base64url>` mit Werkzeugaufrufen, das Modell gibt je Anfrage
   einen davon aus und danach einen Schlusssatz. Kein Cloud-Zugriff, kein Zufall.
3. Ein eigener Server mit `--port 0`, eigenem `DATA_DIR` unter `/tmp` und dem Profil
   `ragents.config.remote-check.ts`: `alice` und `bob` als Bediener, `admin` mit `*`, jeweils mit
   Passwort und persönlichem Token aus der Umgebung, und ohne `AGENT_MODELS`, sodass Agent und
   Koordinator dasselbe Modell `script` nennen. Der Server erbt nur `PATH`, `HOME`, Sprache und
   `TMPDIR` des Aufrufers, damit kein Profilschlüssel aus der Shell das Prüfprofil überstimmt.
4. Im Container läuft `ragents workspace-client` als Arbeitsplatz von `alice`.
5. Die Prüfungen gehen über die Nachrichtenschicht (Verträge aus den `contract.ts` der Plugins) und
   `docker exec`; jede schreibt eine Zeile `ok`, `FEHLER` mit Ursache oder `--` (übersprungen).

## Prüfungen

- Arbeitsplatz: meldet sich mit Plattform `linux`, eigenem Rechnernamen und seinem Ordner an; `bob` und
  `admin` sehen ihn nicht; `bob` kann keinen Run daran binden (`workspace-client-disconnected`).
- Run: `alice` bindet einen Run an den Ordner im Container.
- Werkzeuge: `bash` meldet Linux, den Container und den Ordner; `read` liest die Datei aus dem Container;
  `write` schreibt dort und nirgends auf dem Server; `typescript_eval` arbeitet in einem Ordner im
  Datenordner des Servers; der Systemprompt nennt Linux und den Ordner des Arbeitsplatzes, aber keine
  rohe Zeile `Current working directory` und nicht den Ordner, in dem die Agentenlaufzeit auf dem
  Server arbeitet; der Arbeitsplatz protokolliert die Aufrufe; ein binärer Chat-Anhang liegt unter
  `attachments/` im Container, wo `bash` ihn liest, und weder im Datenordner noch in der Kopie des
  Servers.
- Neuer Ordner: ein zweiter Run von `alice` mit neuem Ordner je Run auf dem Arbeitsplatz bekommt einen
  Ordner unter dem Ordner für Runs im Container; `write` und `bash` arbeiten darin, auf dem Server
  entsteht er nicht, und das Löschen des Runs nimmt ihn im Container mit.
- Dateien: Liste und Vorschau zeigen den Container; eine Änderung per `docker exec` meldet der Kanal.
- Prozesse: ein markierter Prozess im Container erscheint, ein markierter Vergleichsprozess auf diesem
  Rechner nicht; Beenden wirkt im Container.
- Rechte: `bob` sieht den Run nicht (`run-not-found`); `admin` sieht ihn und sein Journal, liest aber weder
  Dateien noch Prozesse des Arbeitsbereichs (`run-workspace-owner-only`), schreibt nicht hinein und beendet
  keinen Prozess (`run-owner-only`).
- Stopp: der Not-Aus von `admin` räumt die markierten Prozesse im Container und auf dem Server ab;
  `ragents.runs.stopAll` ist ihm erlaubt.
- Trennen: `docker stop` nimmt den Arbeitsplatz aus der Registry, Dateien-Reiter und Werkzeugaufruf
  scheitern daran; nach `docker start` meldet er sich wieder an und die Werkzeuge laufen wieder.
- Strom weg: `docker network disconnect` nimmt dem Container das Netz, der Arbeitsplatz darin lebt weiter;
  `alice` stoppt den Run in dieser Zeit, der Stopp gelingt, der markierte Prozess im Container läuft noch.
  Nach `docker network connect` meldet sich der Arbeitsplatz wieder an, der Server holt den Stopp nach, und
  der Prozess endet.
- Optional: `--browser` öffnet eine Seite, die nur auf `localhost` im Container läuft; `--vscode` führt
  `apps/vscode/tests/host/launch.mjs` mit `RAGENTS_HOST_TEST_WORKSPACE` als `bob` aus. Die Aufträge
  jenes Tests erkennt das Skriptmodell an ihrem Wortlaut (`vscode-step.ts`).

## Aufräumen

Der Läufer beendet nur, was er selbst gestartet hat: den Server und den VS-Code-Launcher über ihre
eigene PID beziehungsweise ihre eigene Prozessgruppe (nur solange deren Anführer lebt), Container nur
über das Label `ragents.remote-workspace-check.session`, Images nur mit seinem Label, Prozesse auf
diesem Rechner nur, wenn ihre Umgebung einen Run-Marker dieses Servers oder die Markierung
`RAGENTS_REMOTE_CHECK_SESSION=<Läufer-PID>-<Sitzung>` trägt. Das gilt auch bei Strg-C und Fehlern.
Nach einem harten Abbruch beendet sich der Server über `RAGENTS_PARENT_PID` selbst; Container,
Temp-Ordner und Prozesse eines toten Läufers räumt der nächste Prüflauf zu Beginn ab. Schlägt eine
Prüfung fehl, bleiben die Protokolle (Server, Arbeitsplatz, Skriptmodell, Image, VS Code) unter
`/tmp/ragents-rwc-protokoll-<sitzung>`.

Die VS-Code-Testinstanz läuft mit eigenem `--user-data-dir` und `--extensions-dir` und erbt keine
`VSCODE_*`- oder `ELECTRON_*`-Variablen; sie kann sich damit an keine laufende Instanz hängen. Bricht
ihr Launcher ab, beendet er sie über ihre eigene PID.

## Dateien

| Datei | Inhalt |
| --- | --- |
| `run-remote-workspace-check.ts` | Einstieg, Ablauf, Aufräumen |
| `checks.ts` | die Prüfungen |
| `script-model.ts` | das Skriptmodell als Modell-Relay |
| `container.ts`, `Dockerfile` | Paket, Image und Container |
| `processes.ts` | eigene Prozesse starten, beenden und wiederfinden |
| `vscode-step.ts` | der optionale VS-Code-Schritt |
| `report.ts` | Zeilen und Zusammenfassung |
| `ragents.config.remote-check.ts` | das Prüfprofil |

Typprüfung: `pnpm exec tsc -p scripts/remote-workspace/tsconfig.json`.
