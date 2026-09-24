---
name: ragents
description: RAgents lokal starten und ein Projekt programmieren lassen - Host hochfahren, einen Run auf einen Projektordner binden, Aufträge schicken und das Journal lesen.
---

# RAgents als Programmierer beauftragen

RAgents ist eine Werkstatt für KI-Agenten. `ragents run` startet den Host auf diesem Rechner,
bindet einen Run an einen Projektordner und lässt einen Koordinator darin arbeiten: lesen,
schreiben, Bash, Diagnostik über Roslyn (C#), FSAC (F#) und den TypeScript-Sprachserver.
Je Sprache öffnet `<sprache>_open` eine Instanz je Wurzel; mehrere Wurzeln bleiben nebeneinander
offen, etwa zwei Solutions, und `<sprache>_close` beendet eine davon wieder.

## Voraussetzungen

- Node 22 und das Paket `@schlenkr/ragents` (`npm install -g @schlenkr/ragents`) oder ein
  Checkout des Repositories; dort heißen dieselben Befehle `pnpm ragents ...`.
- `dotnet` (.NET 10 SDK) für die Diagnostik von C# und F#; ohne bleibt nur TypeScript.
- Ein Modellzugang: entweder `OPENROUTER_API_KEY` in der Shell, oder `ragents connect <server-url>`
  gegen einen RAgents-Server, der die Modelle stellt.
- Einmal je Rechner: `ragents provision developer` holt Sprachserver und Werkzeuge nach
  `~/.local/share/ragents/developer/tools/`. Ein zweiter Aufruf lädt nichts nach.

Das Profil `developer` läuft ohne Anmeldung auf Port 4715, Daten unter
`~/.local/share/ragents/developer`. `PORT` und `DATA_DIR` überschreiben beides.

## Die vier Befehle

```sh
ragents run /pfad/zum/projekt "Behebe den Typfehler in src/broken.ts und lauf typescript_diagnostics"
ragents send 7f3c1e64-... "Lies README.md und nenne das Kennwort"
ragents journal 7f3c1e64-... --tools
ragents stop 7f3c1e64-...        # laufenden Turn des Primary-Actors unterbrechen, der Run bleibt aktiv
ragents stop 7f3c1e64-... --run  # Not-Aus: alle Turns abbrechen, alle Actors stoppen
ragents stop --host              # den gemerkten Host beenden
ragents --help                   # die Verwendung, wie ragents help
```

`run` startet den Host, falls unter seiner Adresse keiner antwortet, legt den Run mit der Bindung
`path` auf den absoluten Ordner an (der Server läuft auf demselben Rechner), schickt den Auftrag
und blockiert, bis der Turn zu Ende ist. `--profile <profil|pfad>` wählt ein anderes Profil,
`--entry <einstieg>` startet den Run zusätzlich über einen Skill oder ein Run-Script.
`send` arbeitet im selben Run weiter und wartet genauso. `journal` liest den Verlauf ohne Server,
`--tools` zeigt die Werkzeugaufrufe statt des Gesprächs.

## Ausgabe und Exit-Code lesen

Auf stdout stehen die Werkzeugaufrufe und die Antwort des Modells, auf stderr die Meldungen des
Befehls (Hoststart, Run-Kennung, Abbruchgrund):

```
> read {"path":"src/broken.ts"}
< read 0.4s ok
> bash {"command":"pnpm -s tsc --noEmit"}
< bash 12.1s ok
Der Typfehler kam von greet(42); jetzt steht dort greet("42").
run: 7f3c1e64-9a2b-4d11-8c30-1f5e9a77c001
```

Die letzte Zeile ist immer `run: <id>` - damit gehen `send`, `journal` und `stop` weiter.
`--json` liefert statt der Zeilen die Journalereignisse als JSON, eine je Zeile.
Exit-Code: `0` der Turn ist fertig, `2` er wurde abgebrochen, `1` er ist gescheitert oder die
Verbindung zum Host ist weg. Ein Exit-Code `0` heißt, dass der Turn sauber endete, nicht dass der
fachliche Auftrag erfüllt ist; das prüfst Du selbst am Ergebnis im Projektordner.

## Ein eigenes Profil

`--profile` nimmt einen Namen neben dem Host **oder** den Pfad zu einer eigenen
`ragents.config.<profil>.ts` an beliebiger Stelle; `RAGENTS_PROFILE` setzt dasselbe für alle
Befehle. Verlangt das Profil eine Anmeldung (`users`), gehört in `RAGENTS_TOKEN` der persönliche
Token des Benutzers, den das Profil als `token: env("...")` nennt:

```sh
export RAGENTS_TOKEN="$MY_RAGENTS_TOKEN"
ragents run <ordner> "Implementiere Work Item 1234" --profile <pfad>/ragents.config.custom.ts --entry custom.tickets.implement-task
ragents stop --host --profile <pfad>/ragents.config.custom.ts
```

Legt das Profil seinen Arbeitsbereich selbst an (kein `ragents.workspace`), bleibt `<ordner>`
ungebunden; der Befehl sagt das auf stderr und der Run läuft trotzdem.

Ein Ad-hoc-Profil ist eine Kopie: `ragents.config.developer.ts` neben die Vorlage legen, in
`ragents.config.<name>.ts` umbenennen und darin `PORT`, `PRODUCT_PROFILE`, `PRODUCT_ID`,
`PLUGINS` und die Modelle ändern. Danach `ragents provision <name>` und
`ragents run <ordner> "..." --profile <name>`. Das Vokabular der Profildatei - Sektionen,
`env(...)`, `provisioned(...)`, `anonymousUser`, `users` - steht in `docs/spec/profiles.md`.

## Was Du nicht tust

- Keine Secrets in eine Profildatei schreiben; ein Schlüssel steht als `env("NAME")` darin und
  sein Wert in der Shell. Die Profildatei lehnt Klartext-Secrets beim Start ab.
- Den Host nicht mit `pkill`, `killall` oder einem Prozessmuster beenden. `ragents stop --host`
  nimmt die PID aus `<Datenordner>/host.json` und trifft damit genau den gemerkten Prozess - auch
  bei einem Host aus `ragents start`, der dieselbe Datei schreibt.
- Keinen zweiten Host auf demselben Port starten; ein belegter Port ist ein harter Startfehler.
- Den Projektordner nicht parallel selbst umbauen, solange ein Turn läuft.
