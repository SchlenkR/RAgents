# Produktprofile und Konfiguration

## Produktprofile

Der Serverport steht unter `host.PORT` in der Profildatei: `core` verwendet 4710,
die Konfigurationsvorlage 4712. Eine ausdrücklich gesetzte Umgebungsvariable `PORT` überschreibt
diese Vorgabe. Zulässig sind ganze Zahlen von 1 bis 65535; `PORT=0` ist kein Startmodus.
`scripts/start.sh` prüft den festen Port vor dem Start. Der Server prüft ihn nach dem Laden
der Konfiguration erneut, bevor er Plugins initialisiert. Ein belegter Port ist ein klarer
Startfehler; es wird weder eine andere Adresse gewählt noch eine laufende Instanz beendet.
Die Startmeldung nennt die feste URL und Ablage.

Mit `--dev` bleibt der Backendport gleich. Vite verwendet fest den Backendport plus 1000, für
`core` also 5710, mit `strictPort`; `API_TARGET` zeigt auf das konfigurierte Backend. Beide Ports
werden vorher geprüft und müssen verschieden sein. Ein eigenständiges `pnpm dev:web` verwendet
Port 5710 und als Proxyziel `http://localhost:4710`, ebenfalls mit `strictPort`.

Plugins werden zur LAUFZEIT gefunden, nicht kompiliert verdrahtet. Der Server liest beim Start
`plugins/`: jeder Unterordner IST ein Plugin, der Ordnername IST die Plugin-ID, der Einstieg ist
`server/index.ts` (`profile/plugin-discovery.ts`, Wurzel aus `plugin-support/plugins-root.ts`).
Geladen wird nur, was das Profil nennt, und zwar per `await import()`. Ein Ordner ohne gültigen
Einstiegspunkt ist ein harter Fehler, kein stilles Überspringen.

`PRODUCT_PROFILE` (`core`; kein Default, fehlend oder unbekannt ist
ein harter Startfehler) wählt die Profildatei `ragents.config.<profil>.ts` aus (Produkt-Deskriptor +
Pluginliste aus schlichten String-IDs), die optionale Variable `PLUGINS` (kommagetrennte
Plugin-IDs) überschreibt die Pluginliste der Profildatei; der Produkt-Deskriptor bleibt der der
Profildatei. Eine unbekannte Plugin-ID, ein fehlendes `requires` und eine verletzte Reihenfolge
brechen den Start hart ab - geprüft, BEVOR ein Plugin gebaut wird (`profile/compose.ts`).

Im Web übernimmt `apps/web/src/plugin-discovery.ts` dieselbe Rolle: `import.meta.glob` über
`plugins/*/web/index.{ts,tsx}` findet je Ordner ein Web-Plugin, und geladen wird per
`await import()` genau der Chunk jeder ID, die der Server als aktiv meldet. Ein neuer Web-Anteil
ist damit NUR ein neuer Unterordner `web/`; eine unbekannte ID und ein fehlender Chunk bleiben
harte Fehler.

Die Werte selbst kommen aus EINER TypeScript-Konfiguration JE PROFIL
(`ragents.config.<profil>.ts`, Sektionen je Plugin-ID plus `host`; geladen von
`apps/server/src/config-file.ts`, ausgewählt allein über `PRODUCT_PROFILE`): sie wird vor jedem
anderen Modul geladen und nur für noch ungesetzte Schlüssel in `process.env` materialisiert -
gesetzte Umgebungsvariablen gewinnen also pro Schlüssel, und jeder bestehende Konsument
(`declaredEnvironment`, `config.ts`, Kind-Umgebungen) liest unverändert weiter aus der Umgebung.
Dienst-Secrets stehen als `env("ENV_NAME")`-Referenz in der Datei. Der eigene `users`-Export
erlaubt Passwörter auf ausdrücklichen Wunsch auch im Klartext.

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
produktspezifische Plugin mit einem leeren Arbeitsverzeichnis je Unterhaltung und ist damit
zugleich der gelebte Entfernungstest: Chat, Koordinator, Orchestrierungs-Canvas,
TypeScript-Actors, Dokumente und Rückfragen funktionieren ohne Fachplugin. Die neutralen Gegenstücke `ragents.product` (Koordinator, Modelle, Präambel) und
`ragents.workspace` (Arbeitsverzeichnis je Run + Sandbox-Werkzeuge aus `plugin-support`) stellen die
Pflichtverträge `ProductRuntime` und `WorkspaceRuntime`.

Pluginliste von `core` in Reihenfolge: `ragents.orchestration`, `ragents.workspace`,
`ragents.product`, `ragents.overseer`, `ragents.activity`, `ragents.processes`,
`ragents.documents`, `ragents.browser`, `ragents.ask`, `ragents.todo`, `ragents.watch`,
`ragents.transcript`, `ragents.actor-programs`, `ragents.reference`, `ragents.lsp-roslyn`,
`ragents.lsp-fsharp`, `ragents.lsp-typescript`.

`ragents.overseer` ergänzt den übergeordneten Koordinator im Kopf der Oberfläche. Das Plugin ist
auch im Beispielprofil enthalten. Seine Unterhaltung
und Laufreferenzen bleiben im jeweiligen Profildatenverzeichnis; der Zugriff übergreift keine
separat gestarteten Profile. Eine lokale Profildatei muss das Plugin ausdrücklich mit aufführen.

Der übergeordnete Koordinator besitzt eine eigene, im jeweiligen Profildatenverzeichnis
gespeicherte Modell- und Reasoning-Auswahl. Als anfängliche Vorgabe dient das Koordinatorprofil.
Die Produktvorgabe für den Run-Koordinator verwendet `high`.
Bereits gespeicherte Modellauswahlen bleiben ausdrückliche Vorgaben. Als anfängliche Vorgabe verwendet das Relay-Profil dasselbe konfigurierte Modell und dieselbe
Denktiefe wie das Koordinatorprofil. Ein Regressionstest prüft beide Profile gegen den echten Modellkatalog.
Danach verwenden Settings und Koordinator-Chat dieselbe Plugin-Einstellung. Änderungen gelten
ab dem nächsten Turn ohne Neustart und ändern weder die Startoptionen noch die Modelle anderer
Runs. Die zulässige Auswahl stammt aus dem konfigurierten Modellkatalog und wird gegen die
Modellfähigkeiten geprüft.

Startauswahl, Produkt-Modellkatalog und Koordinatoreinstellungen beziehen die Denktiefen aus
den Fähigkeiten des jeweiligen Provider-Modells im eingebauten Laufzeitkatalog. Es gibt keine
pauschale Liste pro Produkt. `AGENT_MODEL_REASONING` kann diese Auswahl ausdrücklich
einschränken; unbekannte Modelle sowie ungültige oder doppelte Stufen sind Konfigurationsfehler.
Der Server prüft den gesamten angebotenen Katalog zusätzlich gegen die tatsächlich geladene
Modelllaufzeit und validiert alle Profilvorgaben vor der Nutzung. Beim Modellwechsel auf der
Startfläche wird die konfigurierte bevorzugte Denktiefe verwendet, falls sie verfügbar ist,
sonst die erste angebotene Stufe; die Auswahl ist vor dem Absenden sichtbar. Ausdrücklich
übergebene ungültige Werte werden zurückgewiesen.

Beim Start per Chat oder Setup erhält der menschliche Run-Teilnehmer den Anzeigenamen des
serverseitig angemeldeten Benutzers. Ohne Anmeldung verwenden die Produktvorgaben "Benutzer".
Ein vorhandener Run behält seinen ursprünglichen Teilnehmer; ein Loginwechsel schreibt das
Journal nicht um. Der Run-Besitzer ist keine Festlegung auf den Rechner- oder Repositorybesitzer.
Die allgemeinen Rechte und eine Einstiegsliste begrenzen einen Bedienerzugang;
neutrale Komponenten enthalten keine Produkt- oder Benutzerabfragen. Ist `MODEL_SELECTABLE`
aktiv, bleiben freie Starts und technische Auswahl trotzdem an die jeweiligen Benutzerrechte
gebunden. Ohne jede Quelle - weder Plugin-Ordner noch `SYSTEM_PROMPTS_DIR` - bleibt der Katalog
leer, ohne Fehler; die Schlüssel wirken prozessweit und dürfen ein anderes Produkt-Plugin nicht
beim Import zerreißen. Das Häkchen "Auch an die Agenten weiterreichen" entscheidet, ob der gewählte Text
nur im Koordinatorprompt steht oder zusätzlich im Systemprompt erzeugter Agenten. Plain-LLMs mit
`tools: []` bleiben ausgenommen und erhalten ausschließlich ihren eigenen Prompt. Auswahl und
Reichweite frieren mit der ersten Nachricht in den Journal-Zustand `ragents.system-prompt` ein.

Das Startmenü bietet die Profildateien des Repositories an; `ragents.config.example.ts` bleibt
eine Vorlage. `./start.sh core` verwendet als Vorgabe Port 4710 und
`~/.local/share/ragents/core`. Bereits vorhandene Daten anderer Profile bleiben unberührt und
werden nicht migriert.

Die gemeinsame Datenpfadauflösung gilt für Startskript und direkten Serverstart: `DATA_DIR`
aus der Umgebung überschreibt `host.DATA_DIR` des Profils; ohne beide gilt
`~/.local/share/ragents/<profil>`. Vor Build und Serverinitialisierung prüft der Start die
physisch aufgelösten, bereits vorhandenen Verzeichnisse bis zur Dateisystemwurzel.
Ein Datenverzeichnis innerhalb eines Git- oder Paketprojekts (`.git`, `pnpm-workspace.yaml`
oder `package.json`) wird mit Ursache abgewiesen. Symlinks umgehen diese Prüfung nicht.
Explizite externe Pfade bleiben zulässig.
Die Werkzeuginstallation unter `.data/language-servers` ist kein Laufzeitdatenverzeichnis.

Ein Ablagewechsel ist ein bewusster Vorgang bei gestopptem Server. Er umfasst den gesamten
Profilbestand. Der Server verschiebt keine Daten und schreibt keine eingefrorenen
Journalpfade um.

Auf macOS verwendet `core` die Language Server unter `.data/language-servers` im Repository.
Explizite Umgebungsvariablen überschreiben diese Vorgaben.

`host.PLUGINS` nennt Plugins per Kennung oder Pfad; relative Pfade gelten ab der Profildatei und
werden beim Laden absolut. Die Profildatei liegt im Repo-Root oder an beliebiger Stelle:
`PRODUCT_PROFILE_FILE` nennt dann den Pfad, `PRODUCT_PROFILE` bleibt der Name, und der Dateiname
muss `ragents.config.<profil>.ts` lauten; Datenverzeichnis, Meldungen und Sektionen verwenden
weiter den Namen. `scripts/start.sh <profil>` oder `scripts/start.sh <pfad>` setzt beides; ohne
Argument listet das Skript die Profile im Repo und nimmt auch einen Pfad entgegen. Der Dev-Modus
verwendet für Vite den Backend-Port plus 1000. Eine externe Profildatei importiert
`@aicontainer/server/config-definition.js`.

## Bearbeitbare Modellvorgaben

Unter Einstellungen, Modelle stellt das aktive Produkt seine tatsächlichen LLM-Agentprofile
bereit: in core `coordinator`, `relay` und `standard`. Pro Profil sind Modell und Denktiefe
bearbeitbar. Das manuelle Profil gehört
nicht dazu. Anbieter, verfügbare Modelle und bewusst eingeschränkte Denktiefen stammen weiter
aus der Profildatei und dem geprüften Modellkatalog; die Oberfläche ist kein Konfigurationseditor.

Jede Rolle hat Modell und Denktiefe getrennt in der Profildatei: `AGENT_MODEL` und
`AGENT_THINKING` für das Standardprofil, `AGENT_COORDINATOR_MODEL` und
`AGENT_COORDINATOR_THINKING` für `coordinator` und `relay`. Ein Produkt-Plugin kann weitere
Rollen mit eigenen Schlüsseln anmelden; gespeicherte Profile lassen sich in den
Modelleinstellungen separat anpassen.
Modell- und Denktiefenvorgaben bleiben getrennt; der Run überschreibt die Denktiefe beim
Start nicht. Der Modellkatalog begrenzt die erlaubten Stufen je Modell.

Die Vorgaben liegen unter `${DATA_DIR}/plugins/<produkt-plugin>/model-settings.json`.
Jedes Produkt-Plugin besitzt seinen eigenen Store und seine eigene
`/api/plugins/<produkt-plugin>/model-settings`-Route. Lesen benötigt `settings.read`, Speichern
zusätzlich `settings.write`. Ein Speichervorgang übermittelt alle tatsächlichen Agentprofile;
fehlende, doppelte oder unbekannte Profile, nicht angebotene Modelle und unzulässige Denktiefen
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
`COMPACTION_PROVIDER`, unabhängig von `AGENT_MODELS` und den Agentprofilen. Wählbar sind
Modelle mit Texteingabe, die ausgeschaltetes Reasoning unterstützen. Die Titelausführung
setzt Reasoning immer auf `off`; es gibt keine zusätzliche Denktiefenwahl.

`COMPACTION_MODEL` ist die Vorgabe, solange `${DATA_DIR}/title-settings.json` fehlt;
eine leere Vorgabe deaktiviert die automatische Erzeugung. Die mitgelieferten Dateien für
core und das Konfigurationsbeispiel verwenden `google/gemma-4-26b-a4b-it`
(Gemma 4 A4B). Gemma 4 A4B, Qwen 3.8 Flash und GPT-5.4 nano stehen am Anfang der geeigneten
Modellauswahl; weitere passende Modelle bleiben wählbar. Gespeicherte Einstellungen haben
Vorrang. Die Datei enthält `selection` mit Anbieter und Modell oder `null` zum Deaktivieren.
Unbekannte Modelle, ungültige Datei- oder Anfrageinhalte
werden abgewiesen; ein ungültiger gespeicherter Stand verhindert den Start. Speichern ersetzt
die Datei atomar und übernimmt die Auswahl erst nach erfolgreichem Schreiben.

`GET /api/settings/titles` liefert Auswahl und verfügbaren Katalog mit `settings.read`.
`PUT` benötigt zusätzlich `settings.write` und speichert ausschließlich die Auswahl. Änderungen
gelten ab der nächsten Titelerzeugung. Bereits erzeugte oder ausdrücklich gesetzte Titel bleiben
erhalten; Modelle und Denktiefen von Agenten oder globalem Koordinator ändern sich nicht.

<!-- guide:access -->
## Optionale Anmeldung und Rechte

Benutzerrechte steuern den Zugang eines Menschen zur Anwendung. Die Auswahl der Funktionen
eines Actors und dessen technische Grants regeln die Ausführung innerhalb eines Runs.
Ein Profil stellt die Plugins bereit; Benutzerrechte erzeugen keine zusätzlichen Plugins
oder Werkzeuge.

Eine Profildatei kann neben `config` einen `users`-Export mit dem Typ
`readonly ProfileUser[]` anbieten. Der Vertrag steht in `config-definition.ts`; Passwörter
sind nicht leere Klartextwerte oder `env(...)`-Referenzen. Ohne Export bleibt der bisherige Betrieb ohne
Benutzeranmeldung erhalten. Ein vorhandener Export schaltet die Anmeldung ein und muss deshalb
mindestens einen Benutzer enthalten. Eine ausdrücklich leere Liste, doppelte Kennungen, ungültige
Rechte oder fehlende Passwortvariablen brechen den Start ab. Die Benutzerliste wird getrennt
von der Plugin-Konfiguration geladen und erscheint nicht in öffentlichen Umgebungsdeskriptoren.

Zum Beispiel ergänzt dieser Export eine Profildatei um einen gemeinsamen Lesezugang:

```ts
import { env, type ProfileUser } from "./apps/server/src/config-definition.js";

export const users = [{
  id: "reader",
  label: "Lesezugang",
  password: env("RAGENTS_READER_PASSWORD"),
  rights: ["runs.read", "ragents.overseer.read"],
}] as const satisfies readonly ProfileUser[];
```

Der Passwortwert kann aus der Serverumgebung kommen oder direkt in `password` stehen. Eine vorhandene `env`-Importzeile wird dafür
ergänzt; derselbe Import wird nicht ein zweites Mal angelegt. Die
[Entwicklerreferenz](../homepage/developer.html#access-rights) nennt die aktuellen Rechte für
Runs, Einstellungen und globalen Koordinator direkt aus den ausführbaren Verträgen.

Rechte sind exakte Strings; `*` gibt alle Rechte frei. Die verbindlichen Namen und ihre
Bedeutungen stehen in `packages/ragents/src/access.ts` und bei den beitragenden Plugins.
`AccessContext.can`, `hasRight` und `accessMode` verwenden dieselbe Prüfung. Ohne Anmeldemodus und ohne `anonymousUser` sind die Rechte freigegeben. Ein optionaler
`anonymousUser`-Export verwendet dieselben Rechte und `startEntries` ohne Passwort; er begrenzt
den Zugang auch ohne Anmeldung. `users` und `anonymousUser` gleichzeitig sind ein Startfehler.
Mit Anmeldung und ohne Sitzung sind die Rechte gesperrt. Der öffentliche
Snapshot enthält nur Anmeldemodus und Benutzer mit Kennung, Anzeigename und Rechten.
Die Entwicklerreferenz erzeugt Namen, Host-Routenzuordnung und Verträge aus diesem Code und
enthält geprüfte Beispiele für Leser, Bediener und eine eigene Extension.

Die Anmeldung verwendet Benutzerkennung und Passwort. Der Server hält eine undurchsichtige
Anmeldesitzung zwölf Stunden im Speicher; das profilbezogene Cookie ist HttpOnly und SameSite=Lax.
Abmelden, Ablauf und Neustart machen die Sitzung ungültig; zugehörige offene HTTP-Antworten
einschließlich Ereignisströmen und laufenden Abrufen werden beim Abmelden oder Ablauf abgebrochen.
Bereits gestartete Agenten-Runs werden dadurch nicht automatisch gestoppt. Der Browser kehrt bei verlorener Sitzung zur
Anmeldung zurück. Benutzeränderungen werden mit dem nächsten Serverstart wirksam.
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

Benutzerrechte steuern sowohl sichtbare beziehungsweise nur lesbare UI als auch HTTP-Routen.
Der Zugriff wird nicht pro Run und angemeldetem Benutzer getrennt: Leseberechtigte sehen
die gemeinsamen Runs des Profils.
`runs.write` erlaubt Nachrichten an vorhandene Runs und ihre App-Aktionen. Freie Runs,
Vorbereitungsgespräche und Startoptionen benötigen zusätzlich `runs.create`. Ohne dieses Recht
startet `POST /chat/<id>/start` nur ein Run-Script aus `user.startEntries`; beliebige Texte,
andere Einstiegkennungen und technische Startparameter sind gesperrt. Der Katalog enthält
für diese Benutzer nur die freigegebenen Scripts. Die Auswahl gilt für neue Starts; bestehende
Runs bleiben im gemeinsamen Profil zugänglich.

`runs.inspect` schützt Modelle, Journal, Quellen, Werkzeuge und allgemeine technische Einsicht.
Language-Server-Ansichten verwenden ihr eigenes `<pluginId>.read`. Damit lassen sich Diagnosen
unabhängig von Modell- und Werkzeugdetails freigeben. Tabs und lesende HTTP-Routen prüfen
dasselbe Recht.

`runs.trace` gibt ohne die übrige technische Einsicht die Denk- und Werkzeugschritte des Chats
mit Inhalt frei und erlaubt dem Benutzer, ihren Detailgrad selbst zu wählen. Ohne dieses Recht
sieht der Chat die Schritte nur als leere Marker.
Ohne dieses Recht enthalten Chatstream und Actor-Verlauf für Denk- und Werkzeugphasen nur
leere Statusmarker mit Start-/Abschlussinformation. Namen, Argumente, Quelltext, Ergebnisse
und Denktexte werden serverseitig entfernt. So bleibt die aktuelle Arbeitsphase sichtbar,
ohne technische Details freizugeben.
Ohne dieses Recht fehlen freie Startfelder, Modellwahl, Detailstufen, allgemeine technische Reiter und
Inspektoren. Der Canvas zeigt Mini-Apps und LLM-Gespräche; TypeScript-Steueractors bleiben
verborgen. Der Server redigiert Modelle, Prompts, Grants, Werkzeugausgaben und technische
Startzustände in den Run- und Chat-Snapshots. Fachliche Zustände und Mini-App-Aktionen bleiben
verfügbar, einschließlich der Ergebnisabfrage laufender App-Aktionen ohne technische Einsicht.
Einstellungen und globaler Koordinator behalten ihre eigenen Rechte.
Diese Rechte ersetzen keine Ausführungssandbox für selbst geschriebenen nativen Code. Der globale Koordinator hat
eigene Lese- und Schreibrechte; Änderungen seiner Modellwahl brauchen zusätzlich das Recht
zum Schreiben von Einstellungen. Sein Arbeitsbereich verwendet eine private lokale
Dienstidentität ausschließlich für die Verwaltungs-API und Hilfe. Sie darf Runs lesen,
schreiben, frei starten und technisch einsehen; Einstellungen und globaler Reset sind darüber nicht erreichbar. Diese
Identität ist kein Benutzerzugang und wird nicht an den Browser weitergegeben.
<!-- /guide:access -->

Der ältere `ACCESS_TOKEN`-Zugang gilt nur, wenn das Profil keine Benutzer definiert. Bei
konfigurierten Benutzern ersetzt die Anmeldung diesen Zugang; der alte Token umgeht sie nicht.
Er nimmt den Token als Bearer, Cookie oder Abfrageparameter `access` an; nur eine Seitennavigation
mit dem Parameter wird nach dem Setzen des Cookies auf die tokenfreie Adresse umgeleitet, iframes
und API-Abrufe laufen direkt weiter. Das gebaute Web unter `/assets/` ist frei, damit ein iframe
ohne Cookie seine Skripte laden kann; jede Datenroute verlangt den Token.

<!-- guide:access -->
## Funktionsauswahl und Actor-Rechte

Eine Engine-Capability bezeichnet eine technische Erlaubnis, etwa `workspace.use` für
Workspace-Werkzeuge. Ein Grant weist diese Erlaubnis einem Actor mit einem Geltungsbereich zu:
dem Run oder einem Workspace-Pfad. Er hält außerdem fest, ob der Actor die Erlaubnis selbst
nutzen und an neu angelegte Actors weitergeben darf. Eine Workspace-Grenze deckt den angegebenen
Pfad und seine Unterverzeichnisse ab. Beim Vererben delegierbarer Grants bleibt dieser Bereich
erhalten; ein neuer Actor bekommt dadurch nicht automatisch ein eigenes engeres Verzeichnis.
Benutzerrechte wie `runs.write` steuern dagegen den Zugang zur Anwendung und ihren Routen.

Die `tools`-Auswahl beim Spawn bestimmt die verfügbare Funktionen-API: `[]` für ein reines LLM,
eine Namensliste für eine genaue Auswahl, `null` für den dynamischen Bestand. Die Auswahl wird
nicht vom Koordinator geerbt. Delegierbare Engine-Rechte werden als Grants übernommen;
`withoutCapabilities` kann sie weiter einschränken. Rollenregeln im Prompt beschreiben den
Auftrag, erteilen aber keine technischen Rechte.
Beispielsweise ersetzt die Auswahl von `read` keinen fehlenden Grant für `workspace.use`.

Ein Actor-Programm deklariert zusätzlich seine benötigten Funktionen unter `capabilities`.
Diese Deklaration begrenzt den Aufruf, verleiht dem handelnden Actor aber keine fehlenden
Grants. Auch ein erfolgreich typgeprüftes Snippet bleibt an seine Aufrufidentität gebunden.
Übersicht, Nachschlagen und Ausführung verwenden den für diesen Actor freigegebenen Bestand.
Die [Laufzeitanleitung](../homepage/guide-runtime.html#subagenten-ausstatten) erklärt die
Auswahl für reine Gesprächsagenten und Coding-Agenten.

<!-- /guide:access -->

<!-- guide:access -->
## Offene Grenzen

- Benutzer werden in der Profildatei gepflegt; es gibt weder OAuth noch eine Benutzerverwaltung
  oder Passwortänderung in der Oberfläche. Anmeldesitzungen überleben keinen Serverneustart.
- Benutzerrechte gelten für das gesamte Profil, nicht je Run oder Agentenwerkzeug.
<!-- /guide:access -->
