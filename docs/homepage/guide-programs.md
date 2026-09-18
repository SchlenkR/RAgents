# Mini-Apps bauen

Actor-Zustand und Funktionen in bedienbaren React-Views zugänglich machen.

## Programme und Mini-Apps

Ein ausführbarer Actor kann ein TypeScript-Programm mit Funktionen, eigenem journalisiertem
Zustand und React-Views besitzen. Das gilt für TypeScript- und LLM-Actors. Diese Oberflächen
heißen für Benutzer Mini-Apps. Eine Mini-App zeigt den
Zustand ihres Actors und ruft dessen Funktionen direkt auf; ein solcher Aufruf benötigt keinen
Modell-Turn. ActorInputs bleiben Nachrichten an den Actor: Ein LLM-Actor verarbeitet sie mit
seinem Modell, ein TypeScript-Actor mit seinem optionalen `onInput`-Handler.

Das Plugin `ragents.actor-programs` besitzt Pakete, Aktivierung, Funktionsbindung und View-Host.
Die gemeinsame native Ausführung steht in `typescript-platform.md`, Actorzustand und
ActorInputs in `core.md`. Alle aufrufbaren Funktionen und Views gehören zum selben Actor-Modell.

## Pakete und Actor-Bindung

Programme sind private Pakete in einem vorbereiteten pnpm-Workspace des Runs. Dateiwerkzeuge
und Language Server erreichen sie über `@actors/<name>/`, Bash über `RAGENTS_ACTORS_DIR`.
Die Workspace-Schnittstelle liefert direkt die Sammlung der Programmpakete. Normale relative
Imports binden eigene Module ein; feste lokale Abhängigkeiten stammen aus der Hostinstallation.

```text
@actors/<name>/
  package.json
  tsconfig.json
  tsconfig.client.json
  tsconfig.server.json
  src/contract.ts       Backend-Vertrag, falls nötig
  src/server.ts         Backend, falls nötig
  src/client.tsx        Einstieg einer View, falls nötig
  src/styles.css        optional, nur für fremd erzeugtes Markup
  tests/program.test.ts
```

`package.json` enthält `name`, `private: true`, `type: "module"` und `ragents`-Metadaten mit
Titel, optionaler Beschreibung, optionalem Backend und optionalen benannten Views. Jede View
hat eine Kennung und einen Client-Einstieg; Titel, Stylesheet und Größe sind optional.
Mindestens ein Backend oder eine View muss vorhanden sein. Der Host liefert pro View das
HTML mit dem Wurzelelement `root`. Die verbindlichen Schemata stehen in
`plugins/ragents.actor-programs/server/app-project.ts`.

`actor_program_activate` bindet ein Paket mit `actor: "self"` oder `actor: "@handle"` an einen
vorhandenen Actor. Ohne ausdrückliche Actor-Angabe bleibt eine bestehende Programmbindung
erhalten; bei einem neuen Backend entsteht ein TypeScript-Actor mit dem Programmnamen als
Handle. Ein neues reines View-Paket bindet an den aufrufenden Actor. Eine statische Ansicht
benötigt weder einen Dummy-Actor noch eine künstliche Backendfunktion.

Ein Programm mit Input-Handler wird bei der Aktivierung an einem LLM-Actor mit einem Fehler
abgewiesen: Dessen normale Nachrichten bleiben beim Modelltreiber. Ein Paket ohne Input-Handler
kann ihm Funktionen und Views bereitstellen. Reine Funktionen können auch ohne View vorhanden
sein. Pro Actor ist genau ein Programmpaket aktiv; ein anderes Paket wird abgewiesen.
Zusätzliche Funktionen und Views werden im bestehenden Paket ergänzt. Eine erneute Aktivierung
dieses Pakets übernimmt den geänderten Stand, einschließlich entfernter Funktionen und Views.

## Backend und Client

Der Backend-Einstieg exportiert `defineActor(contract, implementation)` aus `@ragents/server`
als Standardexport. Der TypeBox-Vertrag beschreibt `state`, `functions` und optional `input`.

Der Zustand muss den Anfangswert `{}` akzeptieren. Jede Funktion nennt ihre Ein- und Ausgabe;
optional kommen freigegebene Capabilities, Bestätigung und die Veröffentlichung als Werkzeug
hinzu. Die Implementierung enthält dieselben Funktionen und bei deklariertem Input einen
`onInput`-Handler. TypeScript leitet Eingabe-, Ergebnis- und Zustandstypen aus dem Vertrag ab.

Jede Funktion erhält `(input, context)` und gibt ausschließlich ihr fachliches Ergebnis
zurück. `context.state.replace` merkt Zustandsänderungen vor; die Rückgabe wird niemals
zusätzlich als neuer Zustand interpretiert. `context.actor` nennt den Actor, dem Funktion und
Zustand gehören. `context.functions.<name>(input)` verwendet die deklarierten Run-Funktionen unter der
Identität des Aufrufers. `onInput` handelt als sein Actor; eine von außen aufgerufene Funktion
behält dessen Zustand, aber nicht dessen Aufrufidentität. Dieselbe API steht Snippets zur Verfügung.
`context.std` stellt die vorhandenen Standardfunktionen einschließlich der Vermittler bereit.

Eine optionale `tool`-Angabe veröffentlicht dieselbe Funktion in der typisierten Run-API.
Ohne `targets` steht es aktiven ausführbaren Actors zur Verfügung; `self` bezeichnet den
Besitzer des Programms. Ein anderer Aufrufer erhält dadurch keine eigene Kopie der Funktion
oder ihres Zustands. Bindungen verwenden Namen und Handles, keine abgeschriebenen Ausgabe-IDs.

React, `createRoot` und eigene Module werden normal importiert. `context` und `useAppState`
kommen aus `@ragents/client`, Controls aus `@ragents/client/ui`. Der Hook liest den gemeinsamen
Actor-Zustand; `context.capabilities.call(functionName, input)` ruft dessen deklarierte Funktion
auf. `context.actor` identifiziert den Actor der View. Lokale Entwürfe, Auswahl und Fokus bleiben
im React-Zustand. Ein Actor-Chat kann mit diesem Handle genau das Gespräch seines Actors zeigen.

Die View läuft im Host-Iframe mit eingeschränkten Browserrechten. Sein zugänglicher Name
kommt aus `aria-label`; ein leerer `title` verhindert einen Browser-Tooltip über dem Inhalt.
Native Formularübermittlung
ist nicht freigegeben. Aktionen verwenden deshalb ausdrückliche Ereignishandler; bei einer
Suche lösen Enter und ein Knopf mit `type="button"` denselben Handler aus. Der Enter-Handler
unterbindet die native Standardaktion. Prüfe diese Bedienung im Host-Frame, nicht nur in einer
frei gerenderten React-Ansicht.

## Erstellen, bearbeiten und aktivieren

`actor_program_create` legt ein neues Paket aus einer Vorlage an und überschreibt keine
vorhandenen Quellen. Die sechs Vorlagen in `server/templates.ts` und `controls-template.ts`
zeigen unterschiedliche Formen:

- `blank`: reine statische View am vorhandenen Actor.
- `chat`: Chat-View ihres Actors ohne eigene Serverfunktion.
- `controls`: lokale Demo der vorhandenen UI-Bausteine.
- `headless-counter`: TypeScript-Actor mit Input-Handler, Funktionen und Zustand ohne View.
- `text-analysis`: TypeScript-Funktion mit gemeinsamem Zähler und React-View.
- `shared-list`: dieselbe Listenfunktion für View und Agentenwerkzeug.

`actor_program_activate` prüft Typen, baut Backend und Views, führt die vorhandenen Fachtests
aus und aktiviert erst danach den geprüften Stand. Fehler nennen die zu korrigierende Stelle.

Veröffentlichte Funktionen stehen bereits im laufenden LLM-Turn in der aktuellen TypeScript-API.
`typescript_api` liefert ihre exakten Verträge; Snippets rufen sie über `context.functions` auf.
Erneute Aktivierung aktualisiert die Schemata; entfernte Funktionen verschwinden aus demselben Bestand. Ein zusätzlicher Aufrufvertrag ist nicht nötig.

`actor_program_list` zeigt die installierten Programme. `actor_program_remove` entfernt die
Programmbindung und ihre Views. Bei einem TypeScript-Actor stoppt es zusätzlich den Actor;
ein bestehender LLM-Actor bleibt bestehen. Die Quellen bleiben im privaten Workspace bearbeitbar.
`actor_view_set_visibility` adressiert eine View mit `Paketname/Viewname` oder eindeutigem
Titel. Die Sichtbarkeit verändert
weder Funktionen noch Actor-Zustand. Hashes und technische Bindungen verwaltet der Host.

### Ablaufdefinition, Anleitung und Darstellung verbinden

`@ragents/workflow` liefert einen gemeinsamen TypeScript-Vertrag für beschreibende Abläufe.
Eine `WorkflowDefinition` enthält Rollen, Schritte, Ziele, Abschlussquellen, Freiheitsgrade,
Promptreferenzen und Übergänge. `defineWorkflow` prüft diese Definition. Der Vertrag liegt
kanonisch in `plugins/ragents.actor-programs/workflow/index.ts`; das installierte SDK erhält
daraus seine Typdeklarationen. Das Modul braucht weder React noch einen Server.

Lange Anweisungen liegen in eigenen Markdown-Dateien im Actor-Paket. Ein Schritt verweist
darauf über `prompt`; die Rolle kann zusätzlich einen gemeinsamen Prompt besitzen. Die
Referenzen sind relative Paketpfade, keine vom Modell abzuschreibenden Dateiinhalte.

```ts
import { defineWorkflow, workflowInstructions } from "@ragents/workflow";
import { readPrompt } from "@ragents/workflow/prompts";

const definition = defineWorkflow({
  id: "draft",
  title: "Entwurf erstellen",
  roles: { writer: { title: "Autor", prompt: "prompts/writer.md" } },
  steps: [{
    id: "write",
    title: "Entwurf ausarbeiten",
    role: "writer",
    goal: "Einen vollständigen Entwurf zum Auftrag liefern.",
    prompt: "prompts/write.md",
    completion: { source: "agent", description: "Der Autor meldet den fertigen Entwurf." },
    freedom: { mode: "extend", description: "Passende Untersuchungen ergänzen.", allowSkip: true, maxItems: 12 },
  }],
  transitions: [],
});

const prompt = await workflowInstructions(definition, "writer", readPrompt);
```

`readPrompt` ist ausschließlich serverseitig verfügbar und an das installierte Actor-Paket
gebunden. Es liest Dateien innerhalb dieses Pakets; fehlende, leere oder hinausführende
Referenzen sind Fehler. `workflowInstructions` kombiniert den Rollenprompt, die Anweisungen
der zuständigen Schritte und die Metadaten der Definition. `.hbs` ist ebenfalls als Referenz
zulässig, wird vom Standardleser jedoch als Text geladen. Benötigte Templatewerte löst ein
Plugin ausdrücklich in seiner eigenen Lesefunktion auf. Der fertig zusammengesetzte Text
wird als normaler `agent_spawn.prompt` übergeben und steht damit beim gestarteten Actor im Journal.

Der aktuelle `WorkflowState` bleibt getrennt davon. Das Programm leitet ihn aus seinen
tatsächlichen Daten und Dienstergebnissen ab. `WorkflowDiagram` aus `@ragents/client/ui`
nimmt `definition`, `state` und `label` entgegen; `workflowGraph` liefert dieselbe Projektion
als Knoten und Kanten für eigene Darstellungen. Standardmäßig passt `WorkflowDiagram` seine
Breite automatisch an und lässt den äußeren Inhalt vertikal scrollen. Die Prompttexte selbst
werden nicht in die Diagrammkarten geladen.

`freedom.mode: "extend"` erlaubt eigene Punkte im jeweiligen Schritt; `allowSkip` betrifft
ausschließlich eigene optionale Punkte. Eine Begründung gehört zum Zustand eines entfallenen
Punkts. `fixed` beschreibt verbindliche Schritte. Eine `expansion` benennt eine dynamische
Quelle, eine Rolle und die maximale Parallelität. Das Programm liefert die aktuellen Gruppen
und ihre Einzelpunkte in `state.expansions`; neu hinzukommende Einträge erscheinen ohne
Änderung der Grafik. Normale Übergänge bilden einen azyklischen Ablauf, `kind: "return"`
kennzeichnet Rückwege. Übergangsbedingungen sind beschreibender Text.

Die Definition startet keine Actors und führt keine Bedingungen aus. Steuerprogramme müssen
Parallelitätsgrenzen, erlaubte Änderungen und Abschlussquellen tatsächlich durchsetzen.
Ein vom Modell gesetzter Status ersetzt keine Dienstprüfung oder Benutzerentscheidung.
Diagramm, Anleitung und Ausführung lesen dieselbe Definition; die konkrete Ausführung bleibt
beim bestehenden Actor. Der Lernnachmittag im Core-Profil zeigt dies mit zwei parallelen
LLM-Beiträgen und anschließender Sammlung. Seine Definition und Promptdateien stehen unter
`plugins/ragents.reference/run-scripts/learning-afternoon/`.

### Diagramme aus Daten anzeigen

`FlowDiagram` zeigt Diagrammdaten mit React Flow im aktuellen App-Theme. ELK ordnet Knoten
und Verbindungen automatisch an. Die Mini-App übergibt Knoten mit lokalen IDs und Kanten
zwischen diesen IDs; Koordinaten und eine eigene Diagrammsprache sind nicht nötig.

```tsx
import { FlowDiagram } from "@ragents/client/ui";

const nodes = [
  { id: "request", label: "Auftrag", status: "done" as const },
  { id: "review", label: "Prüfung", status: "active" as const },
  { id: "result", label: "Ergebnis", status: "pending" as const },
];
const edges = [
  { source: "request", target: "review" },
  { source: "review", target: "result" },
];

<FlowDiagram nodes={nodes} edges={edges} label="Auftrag, Prüfung und Ergebnis" />
```

`label` beschreibt das Diagramm für Screenreader. Knoten können `detail`, `status`, `kind` und
`items` enthalten. Jeder Punkt in `items` besitzt eine Beschriftung, optional Details und einen
eigenen Status; er erscheint als Listeneintrag in der Karte. Standardmäßig zeigt das Diagramm
eine kompakte Übersicht: Titel mit höchstens zwei Zeilen und vollständig umbrechende Punkte.
Statussymbole unterscheiden offen (Kreis), in Arbeit, erledigt (grüner Haken), blockiert
(Ausrufezeichen) und übersprungen (Minus). Die Kopfzeile nennt zusätzlich den Status als Text.
Statuschips, Kopfbereiche und Konturen kennzeichnen erledigt grün, aktiv blau und blockiert
rot; ausstehend und übersprungen bleiben neutral. Farben ergänzen Symbole und Beschriftung,
ohne die Kartenabmessungen zu verändern.
Die Karten begrenzen ihre Inhaltsflächen an der äußeren Rundung, auch wenn nur die Kopfzeile
vorhanden ist. Schatten und Verbindungen bleiben außerhalb sichtbar.
Aktive Karten und ihre Arbeitssymbole animieren nur bei explizitem `running=true` dezent.
Ein fehlendes oder falsches `running` unterdrückt die Animation, ohne den gemeldeten Zustand zu ändern. Die
Systemeinstellung für reduzierte Bewegung unterdrückt Animationen ebenfalls.
Vollständige Beschriftungen, Status und Details stehen beim Darüberfahren am jeweiligen Titel
bzw. Punkt. `detailLevel="full"` zeigt stattdessen sämtliche Texte und Statuszeilen in den Karten.
Kanten können eine Beschriftung
enthalten. `direction` bestimmt rechtswärts oder abwärts gerichtete
Anordnung. Die Darstellung verwendet normale Schrift, farbige Karten und Statusanzeigen.
Die automatische Anordnung reserviert mindestens 52 Layout-Pixel zwischen benachbarten
Karten und 94 zwischen aufeinanderfolgenden Ebenen; Beschriftungen können mehr Platz benötigen.
Eine Kante mit `kind: "return"` zeichnet einen Rückweg außerhalb des Hauptablaufs, ohne dessen
zeitliche Anordnung zu verändern.
Diagramme starten mit 80 Prozent der Entwurfsgröße, einschließlich Schrift, Karten, Kanten und
Abständen; auch die Zentriersteuerung stellt diese Skalierung wieder her. Die Fläche hat keinen
eigenen Hintergrund, keinen Rahmen und kein Punktraster; das Diagramm liegt direkt auf dem
Inhalt der Mini-App.
Zoom und Verschieben verändern die Ansicht, keine fachlichen Daten; Knoten und Kanten bleiben
unveränderlich. Mit `viewport="fit-width"` passt sich die Grafik stattdessen automatisch an
die Containerbreite an, verkleinert bei Bedarf weiter und vergrößert nie über die 80 Prozent
der Entwurfsgröße.
Übriger Platz wird durch Zentrierung verteilt; Browserzoom verkleinert die Karten wie den
übrigen Seiteninhalt. Die Höhe folgt den vollständigen Knoten- und Kantenmaßen; gescrollt
wird ausschließlich im äußeren Inhalt. Zoom, Verschieben und Diagrammsteuerung entfallen in
diesem Modus. Statusänderungen ohne geänderte Abmessungen benötigen keine neue Graphanordnung. Ungültige IDs oder
Verbindungen erscheinen als Fehler an der Grafik. Die Bibliotheken werden lokal mitgeliefert,
ohne externen Diagrammdienst oder eigene Installation in der Mini-App. Fachaktionen bleiben
normale Controls neben dem Diagramm. Controls-Vorlage und öffentliche Bausteinreferenz zeigen
ein Beispiel mit lokal umschaltbarem Status.

## Zustand und Lebenszyklus

Der Backend-Kontext liest einen Snapshot des gemeinsamen Actor-Zustands. `context.state.replace`
merkt Änderungen vor. Erst der erfolgreiche Abschluss mit gültigem Ergebnis und Zustand
übernimmt sie ins Journal; Fehler und Abbruch verwerfen diese vorgemerkten Zustandsänderungen.
Bereits ausgeführte Dateioperationen und Aufrufe anderer Funktionen bleiben dagegen wirksam.
Eine Actor-Funktion bildet keine Transaktion über diese Seiteneffekte; vor einer Wiederholung
muss der bereits erreichte Stand berücksichtigt werden.

Änderungen werden als kompakte Feld- und Arrayänderungen gespeichert, wenn das weniger
Platz als ein vollständiger Zustand benötigt. Das gilt auch für Statuswechsel der
Mini-App-Aufrufe: unveränderte bisherige Ergebnisse und Request-Kennungen müssen dabei nicht
erneut als Gesamtzustand gespeichert werden. Browser und Agentenwerkzeug teilen denselben intrinsischen Zustand des Actors. Lokale Eingaben im Client bleiben
von diesem Zustand getrennt.

Der Provider beobachtet Änderungen der Modulinstallationen, Daten und Aufrufzustände im
Run-Ereignisstrom und lädt das Listing gezielt neu, auch bei ruhendem Chat. Text-Token lösen
kein Neuladen aus; verspätete Antworten können keinen neueren Stand ersetzen.
`useAppState()` übernimmt diese Daten über die Bridge in React, ohne den Client neu zu mounten.
Lokale Formularentwürfe bleiben erhalten. Laufende Browseraufrufe fragen ihren Status bis zum
Abschluss zusätzlich ab.

Funktionen desselben Actors werden geordnet ausgeführt; unterschiedliche Actors können parallel arbeiten.
Jeder Aufruf erhält ein Abbruchsignal. Die native
Ausführungsplattform besitzt Prozesse und Stopps auf Run- und Instanzebene. Der Run-Stopp
beendet laufende Arbeit; Entfernen eines Programmpakets und Aktivieren eines neuen Stands
beenden die Ausführungsressourcen des bisherigen Stands.
Nach einem Serverneustart werden zuvor wartende oder laufende Mini-App-Funktionsaufrufe als
abgebrochen (`cancelled`) markiert und nicht automatisch wiederholt. Das unterscheidet sie
von noch nicht beanspruchten ActorInputs: Diese Nachrichten bleiben für einen weiterhin
ausführbaren Actor wartend. Ein Klick in einer Mini-App und eine Nachricht an einen Actor
verwenden unterschiedliche Ausführungswege.
Die Run-Löschung entfernt auch den privaten App-Workspace.
