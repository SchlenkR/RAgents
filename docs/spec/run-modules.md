# Actor-Programme: Funktionen, Zustand und Views

<!-- guide:programs -->
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

<!-- /guide:programs -->

<!-- guide:programs -->
## Pakete und Actor-Bindung

Programme sind private Pakete in einem vorbereiteten pnpm-Workspace des Runs. Dateiwerkzeuge
und Language Server erreichen sie über `@actors/<name>/`, Bash über `RAGENTS_ACTORS_DIR`.
Die Workspace-Schnittstelle liefert direkt die Sammlung der Programmpakete. Normale relative
Imports binden eigene Module ein; feste lokale Abhängigkeiten stammen aus der Hostinstallation.
<!-- /guide:programs -->

Bei Sessions mit eigener UID gleicht der Host Eigentümer und Schreibrechte der privaten
Quell-, SDK- und Build-Dateien innerhalb der Run-Speichergrenze ab. Bibliotheks-Symlinks bleiben
unverändert. Das Modell muss keine ausgegebenen Speicherpfade übernehmen.

<!-- guide:programs -->
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
<!-- /guide:programs -->

<!-- guide:programs -->
## Backend und Client

Der Backend-Einstieg exportiert `defineActor(contract, implementation)` aus `@ragents/server`
als Standardexport. Der TypeBox-Vertrag beschreibt `state`, `functions` und optional `input`.
<!-- /guide:programs -->

Der erzeugte Backend-Adapter gibt zur Vertragsabfrage ausdrücklich JSON-Daten ohne
TypeBox-Metadaten zurück. Diese Beschreibung ist getrennt von der strengen JSON-Prüfung fachlicher
Ergebnisse und Zustandswerte vor der Übertragung aus dem nativen Prozess.
<!-- guide:programs -->
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
<!-- /guide:programs -->

<!-- guide:programs -->
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

<!-- /guide:programs -->

Vor jeder Modellanfrage prüft ein Laufzeitbeitrag geänderte Programmpakete einschließlich
Typen und Build. Der Kontext erhält nur einen kurzen Unterschied zum letzten Fehlerstand;
unveränderte Projekte und Fehlerlisten werden nicht wiederholt. `actor_program_diagnostics`
liefert den letzten vollständigen Stand, optional für einen Programmnamen. Die normalen
Language-Server-Werkzeuge können dieselben Projekte direkt prüfen.

<!-- guide:programs -->
`actor_program_activate` prüft Typen, baut Backend und Views, führt die vorhandenen Fachtests
aus und aktiviert erst danach den geprüften Stand. Fehler nennen die zu korrigierende Stelle.
<!-- /guide:programs -->

Die Typprüfung umfasst immer den Backend-Einstieg aus `package.json.ragents.backend`, auch
bei einer engeren Dateiauswahl in der erhaltenen Autoren-tsconfig.
Es gibt keinen getrennten Check-, Test- oder Installationsvertrag für Actor-Programme und
keine vom Modell weitergereichte Build-Referenz. Bearbeitete Quellen ändern eine laufende
Installation erst nach erneuter erfolgreicher Aktivierung.

<!-- guide:programs -->
Veröffentlichte Funktionen stehen bereits im laufenden LLM-Turn in der aktuellen TypeScript-API.
`typescript_api` liefert ihre exakten Verträge; Snippets rufen sie über `context.functions` auf.
Erneute Aktivierung aktualisiert die Schemata; entfernte Funktionen verschwinden aus demselben Bestand. Ein zusätzlicher Aufrufvertrag ist nicht nötig.

<!-- /guide:programs -->

Fachtests liegen als normale `node:test`-Dateien unter `tests/**/*.test.ts` und laufen mit
`node --import tsx --test`. Sie importieren das Programm und rufen `program.functions` oder
`program.onInput` mit konkreten Eingaben auf. `@ragents/server/testing` liefert
`createTestContext` mit Zustand und expliziten Funktions-Mocks unter `functions`. Ergebnis und gespeicherter
Zustand werden getrennt geprüft. Eine reine View braucht keine erfundene Serveraktion.

<!-- guide:programs -->
`actor_program_list` zeigt die installierten Programme. `actor_program_remove` entfernt die
Programmbindung und ihre Views. Bei einem TypeScript-Actor stoppt es zusätzlich den Actor;
ein bestehender LLM-Actor bleibt bestehen. Die Quellen bleiben im privaten Workspace bearbeitbar.
`actor_view_set_visibility` adressiert eine View mit `Paketname/Viewname` oder eindeutigem
Titel. Die Sichtbarkeit verändert
weder Funktionen noch Actor-Zustand. Hashes und technische Bindungen verwaltet der Host.
<!-- /guide:programs -->

## Werkzeugkarten und Canvas

Einfache Eingaben an einen Agenten gehören zum Werkzeug. `card: true` erzeugt aus den
typisierten Parametern ein kompaktes Formular direkt in der Agentenkarte. Es hat keine eigene
Fensterhülle. Feldbeschriftungen, Pflichtmarkierungen und Sendeaktion bleiben sichtbar;
Parameterbeschreibungen dienen als Platzhalter. Checkbox und Feldname teilen sich eine Zeile.
Mehrzeilige Eingaben beginnen mit zwei Zeilen und lassen sich vergrößern.
Die Karte ruft die zugehörige Actor-Funktion direkt auf. `targets` verwendet `self` oder
`@handle`; der Host löst die Bindung bei der Aktivierung auf. Kein Modell-Turn ist nötig.

Jede Mini-App erscheint nach der Aktivierung sichtbar auf dem Canvas. Ohne eigene Angaben
setzt der Host 480 mal 320 Pixel und den zugehörigen Actor als Anker. Die Metadaten der View
können Breite und Höhe setzen; der Actor ist ihr Anker, freie Koordinaten legt das Canvas-Layout fest.
Die anfängliche sichtbare Fenstergröße ist auf 400 mal 280 CSS-Pixel begrenzt. Der Benutzer
kann das Fenster danach vergrößern oder in der lokalen Vollansicht öffnen.

Die zugehörige Actor-Karte ist in der persönlichen Standardansicht ausgeblendet, auch bei
einem LLM-Actor. Die Mini-App bleibt sichtbar und bedienbar. `Actors` in der Canvas-Leiste
erschließt den Besitzer und seinen Inspector, ohne dessen Karte einzublenden. Die persönliche
Ansicht kann die Karte einzeln oder über `Actors mit Mini-App anzeigen` einblenden.
Auch eine ausgeblendete installierte View zählt weiterhin als eigene Mini-App.

Im freien Canvas, im Kachelmodus und in der Vollansicht zeigt der Host den ganzen
App-Inhalt bei 100 Prozent. Der Frame verwendet seine tatsächliche Breite und Höhe; Schrift,
Controls und Abstände erhalten keine zusätzliche Verkleinerung. Titelzeile und
Größenanfasser behalten ihre Host-Größe. Der Schichtwerk-Host besitzt eine matte blaugraue
Fläche mit Kontur, 17 Pixeln Eckradius und einem gestuften Tiefenkörper nach rechts oben.
Die Anzahl der Tiefenstufen folgt den Darstellungseinstellungen des Hosts; bei 0 bleibt die
Karte flach. Die Front besitzt keine zweite innere Zierkontur.
Die App besitzt eine 44 Pixel hohe Titelzeile und einen
Größenanfasser mit 20 mal 20 Pixel großer Trefferfläche. Jede Canvas-Karte mit Größenanfasser reserviert am gemeinsamen Host-Container acht Pixel unten und 22 Pixel rechts. Das gilt unabhängig vom Inhalt für Actor-Chats, Dokumentabschnitte und Mini-Apps. Die Chat-Eingabe fügt keinen eigenen Abstand unten oder rechts hinzu; es entsteht keine zusätzliche Zeile in Höhe des Anfassers.
Eingeklappte Apps brauchen keinen seitlichen Freiraum für den Anfasser. Eingeklappt belegt sie
einschließlich Rahmen 47 Pixel Höhe. Aufklappen stellt die gewählte
Größe wieder her und erhält den gemounteten Client.

Der Vergrößern-Knopf öffnet eine lokale Vollansicht im Host-Bereich `canvas`. Sie liegt mit
16 bis 24 Pixeln Abstand ausschließlich über dem Canvas; das rechte Panel, die Titelleiste,
die Leiste für Apps und Actors sowie die Statusleiste bleiben sichtbar und bedienbar. Der Hintergrund wird wie bei einem Dialog
abgetönt und mit 4 Pixeln Unschärfe weichgezeichnet. Rahmen, Ecken und Schatten folgen der
gemeinsamen Dialoggestaltung. Nur der darunterliegende Canvas ist währenddessen inaktiv,
auch für Pfeiltasten. Der App-Titel in der Canvas-Leiste behält beim Umschalten
das Schriftgewicht 700; die aktive Fläche und Unterkante zeigen den Zustand, ohne die
Nachbareinträge zu verschieben. Der Provider hält genau eine Vollansicht; die Auswahl
einer anderen App ersetzt sie. Die Vollansicht hat eine eigene Titelzeile mit dem App-Namen
und einem runden Schließen-Knopf mit X. Die Inhalte erscheinen in Originalgröße.
Schließen, Escape und Hintergrundklick führen zum Canvas zurück. Ein intern behandeltes
Escape, etwa in einer Auswahlliste, schließt die Vollansicht nicht.

Der Canvas-Client bleibt beim Einklappen und Vergrößern gemountet. Die Vollansicht lädt einen
zweiten Client mit demselben journalisierten Zustand; ungesendete Eingaben bleiben je Ansicht
lokal. Vollansicht und Einklappen werden nicht journalisiert. Die Vollansicht wird allein vom
Benutzer im Host bedient; Mini-Apps besitzen keine Dialogfähigkeit oder Fenstersteuerungs-API.

Wheel-Eingaben über der Mini-App gehören ihrem Inhalt und lösen keinen Canvas-Zoom aus.
Die Canvas-Sichtbarkeit der View ist dagegen journalisiert. Ausblenden erhält Installation, Werkzeuge,
Aktionen und Zustand. Wiederanzeigen, Neustart und erneute Aktivierung erhalten diese Auswahl.
Die persönliche Sichtbarkeit ihrer Actor-Karte und der Verbindungen wird davon getrennt im
Browser je Serveradresse und Run gespeichert; sie verändert kein Journal. Es gibt keinen
zusätzlichen Mini-App-Reiter im rechten Arbeitsbereich.

## Capabilities und Identität

Actor-Funktionen rufen Run-Funktionen über `context.functions.<name>(input)` auf.
Snippets verwenden dieselben registrierten Funktionen. Ein Snippet handelt als Aufrufer,
`onInput` als sein Actor; eine veröffentlichte Funktion verwendet Besitzerzustand und
Aufruferidentität. Ein `event_subscribe` gilt für die handelnde Identität.
Die deklarierte Capability-Liste und die gebundene Identität bestimmen den verfügbaren Vorrat.
Client-Aufrufe verwenden dagegen nur die im Actor-Vertrag deklarierten Funktionsnamen. Der
Browser kann keinen anderen Run, keine Identität und keine freie Host-Capability wählen.
Die Methoden für Mini-Apps und direkte Actor-Funktionen akzeptieren dieselben
Funktionsnamen einschließlich Großbuchstaben, etwa `addEntry`.
Der Browser fragt laufende Mini-App-Aufrufe über deren App-Route ab; dafür genügt `runs.read`.
Die technische Abfrage direkter Actor-Funktionen bleibt durch `runs.inspect` geschützt.
Laufanzeigen verwenden Aktionslabels. Ohne Label zeigt der eingeschränkte Zugang nur den
Laufstatus; technische Aktionskennungen bleiben dem Vollzugang vorbehalten.

Der Plugin-Host registriert Fachoperationen mit Eingabe- und Ergebnisschema sowie
Operator-Policy. `direct` erlaubt die Bedieneraktion, `confirm` verlangt eine bestätigte
Journal-Frage und `unavailable` schließt die Verwendung als View-Funktionsaufruf aus. Die typisierten
Adapter prüfen Identität, Vertrag und Abbruch an der tatsächlichen Aufrufgrenze.
Die native Node-Ausführung ist keine zusätzliche Sandbox gegen beliebigen Backend-Code;
die Dateirechte und Ausführungsumgebung gehören zum Run-Workspace.

## Canvas-Host und Funktionen-Reiter

Die Leiste oben am Canvas zeigt sichtbar geschaltete Apps neben direkten Zugängen zu allen
nichtmenschlichen, nicht gestoppten Actors. Der Actors-Listenknopf bleibt links stehen;
App- und Actor-Knöpfe scrollen bei Platzmangel gemeinsam horizontal. Die Leiste liegt
außerhalb des Canvas-Dialogbereichs und erlaubt Appwechsel während der Vollansicht. Eine feine
untere Trennlinie grenzt sie vom Canvas ab; sie besitzt keinen eigenen Schatten.
Der App-Name fokussiert das Canvas-Element;
der Vergrößern-Knopf schaltet die lokale Vollansicht. Die aktive Vollansicht ist hervorgehoben.
Der Funktionen-Reiter zeigt Programme, Besitzer-Actors, Funktionen und installierte Quellen.
Die Detailansicht einer Funktion enthält ein generisches Parameterformular aus ihrem Vertrag.
Sie verwendet denselben Formularbaustein wie die Werkzeugkarten: Texte, Zahlen, Ganzzahlen,
Checkboxen und Listen sowie JSON für strukturierte Werte. Pflichtfelder und ungültige Eingaben
werden vor dem Aufruf geprüft. Auch Funktionen ohne Parameter lassen sich direkt ausführen.
Der Aufruf erfolgt ohne Modell-Turn über denselben Host wie bei Mini-Apps und Werkzeugkarten;
deklarierte Bestätigungen bleiben erforderlich. Laufender Aufruf, Rückgabewert und Fehler
erscheinen direkt im Detailpanel. Beschreibung, Parametervertrag und Quellcode bleiben erreichbar.
Die Actor-Detailansicht bietet für installierte Programme einen eigenen Quelltext-Reiter,
einschließlich Headless-Actors. Erst sein Öffnen lädt die Dateien des aktivierten Builds über
den bestehenden Quellcode-Endpunkt. `src/server.ts`, sonst eine TypeScript-Datei, ist
vorausgewählt. Die Dateiauswahl und Syntaxhervorhebung stammen vom gemeinsamen Quellcode-Viewer.
Eine neue Programmrevision lädt die aktuellen Quellen; abgebrochene frühere Antworten
überschreiben sie nicht. Der Quellcode bleibt lesend und setzt `runs.inspect` voraus.
Laufende Werkzeugaufrufe erscheinen in der allgemeinen Aktivitätsanzeige.

Canvas und Vollansicht verwenden denselben Frame-Endpunkt und Build. Jede Ansicht besitzt
einen Iframe mit `sandbox="allow-scripts"` und einer Content-Security-Policy. Der Browserclient
wird einschließlich seiner Imports gebündelt; React und UI-Bausteine stammen aus den
vorbereiteten lokalen Abhängigkeiten. Der Host erhält keinen nachgeladenen App-Code als Plugin.

## Wiederverwendbare UI-Bausteine

Die Extension `ragents.actor-programs` exportiert unter `@ragents/client/ui` wiederverwendbare Controls.
Standardaktionen verwenden diese Controls; Textfelder und Textareas sind `Input` und
`Textarea` derselben Bibliothek.
Die Autorenanleitung verlangt, Controlfarben, Rahmen, Schrift
und Zustände nicht im App-CSS nachzubauen. Die Utility-Klassen eines Programms werden bei der
Aktivierung einmal je Programm über die Host-Quellen, die Bausteine und alle View-Quellen
kompiliert und als `frame.css` im Build-Ordner des Programms abgelegt (`stylesFile` der
Programmdefinition); die Stylesheets für fremd erzeugtes Markup
(Codehervorhebung, Diff, Flussdiagramm) lädt der Host bei jedem Frame-Aufruf. Eine zentrale
Änderung an Tokens oder Bausteinen erreicht installierte Programme erst mit erneuter
Aktivierung.
Chat, Markdown, Codehervorhebung, Auswahl und `ListDetail` verwenden vorhandene Oberflächenbausteine; weitere
Controls gehören mit Implementierung, Styling und Typverträgen direkt zur Extension.
Der Client importiert benötigte Controls aus diesem Paket; der reguläre Build bündelt sie mit der App.
Die Props werden bei der TypeScript-Prüfung der Mini-App typgeprüft. Die Bausteine funktionieren auf dem
Canvas und in der lokalen Vollansicht.

`SvgEdge` stellt SVG-Verbindungen mit einheitlichen Pfeilen, Linien und semantischen Farben
bereit. Offene Pfeilspitzen mit abgerundeten Enden folgen der Pfadtangente und enden genau
am Anschlusspunkt. Der Baustein verwaltet eindeutige Pfeilmarker und berücksichtigt reduzierte Bewegung.
Mini-Apps importieren ihn über `@ragents/client/ui`; der Canvas verwendet dieselbe
Implementierung. Pfadgeometrie, Knoten und fachlicher Zustand gehören weiterhin zur jeweiligen
Darstellung. Die Autorenanleitung zeigt eine kompakte SVG-Vorlage mit beschrifteten Knoten,
responsivem Zeichenbereich und gemeinsamen Farbtokens. Controls-Vorlage und öffentliche
Bausteinreferenz enthalten ein bedienbares Beispiel. Eine automatische Graphanordnung
oder ein allgemeines Knotenmodell ist damit nicht verbunden.

<!-- guide:programs -->
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
<!-- /guide:programs -->

Der Host liefert für Mini-App-Frames die gemeinsame Basisschrift, Schriftfarbe, Zeilenhöhe,
Box-Sizing und einen Body ohne Standardrand. In echten Frames begrenzt er die Seite auf die
Frame-Höhe. Der bereitgestellte Mountpunkt `#root` scrollt und hält auf allen Seiten den
gemeinsamen Workspace-Innenabstand von 18 Pixeln, auch ohne `AppLayout`. Sein Scrollbalken
liegt am rechten Frame-Rand; der Body erzeugt keinen zusätzlichen Scrollbereich. Ein direkt
darin liegendes `AppLayout` ergänzt keinen zweiten äußeren Abstand. Die Autorenanleitung
verlangt, in `#root` zu rendern und Seitenmaße, Scrollverhalten und äußere Abstände dem Host
zu überlassen. Utility-Klassen gestalten die Abstände innerhalb des Inhalts. Standalone-Vorschauen
ohne Frame-Markierung behalten ihren Dokumentfluss. Bereits installierte Views erhalten
die gemeinsamen Regeln beim erneuten Laden; ihre eigenen Quellen und dort zusätzlich
gesetzte Inhaltsabstände bleiben erhalten.

`AppLayout` ordnet Titel, Beschreibung, Inhalt und optionale Aktionen mit gemeinsamen Abständen
an. Standardmäßig wächst es im Dokumentfluss. Mit `fill` füllt es einen höhenbegrenzten Elternbereich;
nur sein Inhalt scrollt, Kopf und Aktionen bleiben sichtbar. Der Inhaltsbereich reserviert
vier Pixel für äußere Fokusrahmen, ohne die Ausrichtung zu Kopf und Aktionen zu verändern.
`Stack` hält vertikale Abstände
oder bildet eine umbrechende Zeile. `Grid` ordnet gleich breite Spalten nach der Breite seines
Containers an und reduziert sie auf schmalen Flächen bis auf eine Spalte. Dafür ist die Breite
der Mini-App maßgeblich, nicht die des gesamten Browserfensters. Die Typverträge begrenzen
Abstände, Richtung und Spaltenauswahl; beliebige CSS-Parameter sind nicht Teil dieser Bausteine.
Die Vorlagen Textanalyse und gemeinsame Liste verwenden das Raster für Eingabe und Ergebnis;
die leere View und die Controls-Demo verwenden ebenfalls die gemeinsame Layoutbasis.

`Dialog` ist derselbe modale Baustein wie im Host: `Dialog` mit `open`/`onOpenChange`,
`DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogBody` und
`DialogFooter`, mit Fokusführung und Escape. Der Dialog liegt über dem Inhalt des Frames und
verändert dessen Maße nicht; das SDK liefert die erforderlichen Styles mit.

`ListDetail` verbindet eine kontrollierte, optional gruppierte Auswahl mit einer Detailfläche.
Such- und Filterleiste, Detailkopf, Inhalt und Aktionen sind Slots. In einer höhenbegrenzten
Fläche bleiben Detailkopf und Aktionen stehen; die Aktionen liegen am unteren Rand. Nur der
mittlere Detailinhalt scrollt, getrennt von der Liste, auch in der mobilen Detailansicht. Icons, Artbezeichnungen und
semantische Farben sind Daten des Aufrufers; der Baustein verwendet die gemeinsamen Tokens.
Auf schmalen Ansichten wechselt die Auswahl zur Detailansicht mit einem runden Zurück-Knopf
und Fokusführung.
Die Startauswahl und Mini-Apps verwenden dieselbe Implementierung aus `apps/web/src/ui`;
der öffentliche Control-Katalog und seine Demo enthalten denselben Typvertrag.

Mini-Apps verwenden die shadcn/ui-Komponenten der gemeinsamen Bibliothek (siehe plugins) und
Tailwind. Der Mini-App-Compiler kompiliert je Ansicht `apps/web/src/ui/frame.css` mit
`@tailwindcss/node` über die Host-Quellen, die Mini-App-Bausteine und die Quellen der Mini-App
und liefert das Ergebnis im Frame aus; die Gestaltung steht als Utility-Klassen im App-Code,
die mitgelieferten Mini-Apps haben kein eigenes Stylesheet mehr. Die Laufzeit setzt `data-ui-surface="mini-app"` am
Wurzelelement des Frames für Schrift und Grundmaße; die öffentliche Bausteindemo setzt
denselben Marker. `Form`, `DataTable`, `FilePicker`, `TaskProgress`, `DocumentViewer`,
`DiffViewer`, `AppLayout`, `Stack` und `Grid` sind aus `Field`, `Input`, `Checkbox`, `Select`,
`Table`, `Progress` und Tailwind-Klassen gebaut und behalten ihre eigenen Props. Die
Kartenhülle bleibt bestehen; der App-Inhalt erscheint in allen Modi bei 100 Prozent.

Die Vorlagen für Textanalyse und gemeinsame Liste sowie das Sammelboard verwenden die
gemeinsamen Bausteine. Ihre Schrift, Flächen und Listen folgen den Theme-Tokens; ein eigener
fest auf Hell gesetzter Stil entfällt. Bereits angelegte Programmpakete behalten ihre eigenen
Quellen bis zur ausdrücklichen Bearbeitung und Aktivierung.

Statusfarben und Diff-Markierungen verwenden weiter die semantischen Tokens des Hosts.
Die Host-Bridge setzt bei der ersten
Verbindung und bei späteren Theme-Wechseln die aufgelöste Darstellung am Wurzelelement des
Frame-Dokuments. Dafür werden weder Frame noch Actor-Zustand neu geladen; lokale Eingaben
bleiben erhalten. Ein optionales eigenes Stylesheet einer Mini-App bleibt nach dem gemeinsamen
CSS geladen. Fest vorgegebene App-Farben werden nicht automatisch umgefärbt.

Formulare verwenden deklarierte Felder und kontrollierte Werte, prüfen Eingaben und warten auf
asynchrone Sendeaktionen. Die Autorenanleitung bevorzugt `Form` auch für einzelne Interviewfragen
und Wizard-Schritte. Fragen und Fortschritt bleiben im Zustand der App; Beschriftungen,
Feldhöhe, Fehlermeldungen und asynchrones Absenden übernimmt das Formular. Innerhalb von
`AppLayout` entfällt sein eigener Außenabstand. Textanalyse und gemeinsame Liste nutzen
Formulare mit mehrzeiligen Eingaben; die Controls-Demos zeigen ebenfalls Textareas. Die
öffentliche Layoutdemo übernimmt ausdrücklich lokal eine eingegebene Antwort und erzeugt
keine Agentenantwort. Kurze Eingabehilfen gehören als `placeholder` in leere Text-, Zahl- und
Mehrzeilenfelder; ausdrücklich gesetzte `hint` bleiben als dauerhafte Hinweise unter dem Feld.
Feldnamen und Pflichtmarkierungen bleiben sichtbar. Checkboxen stehen mit ihrer Beschriftung
in einer Zeile. Bearbeitbare Auswahlfelder zeigen Feldname und Pflichtmarkierung direkt im
Auswahlknopf; bei schreibgeschützter Darstellung steht der Feldname über dem Wert.
Mehrzeilenfelder beginnen ohne
eigene `rows`-Angabe mit zwei Zeilen und lassen sich vergrößern. Formulare, Datei- und Aufgabenlisten
sowie Tabellen verwenden kompakte Innen- und Zeilenabstände bei unveränderter Schriftgröße.
Datentabellen haben typisierte Spalten, Suche, Sortierung, kontrollierte
Zeilenauswahl und asynchrone Zeilenaktionen. Fehler bleiben sichtbar und Eingaben erhalten.
Die Tabellensuche steht mit dem Platzhalter "Tabelle durchsuchen" in einer Zeile; dieselbe
zugängliche Beschriftung bleibt unabhängig vom eingegebenen Suchtext erhalten.
Host-Chat und Mini-App-Dateiauswahl teilen die Aufnahme von Dateien per Input, Drop und Paste.
Texteinfügen an der Auswahl bleibt beim Chat; Dateifilter, Auswahlregeln und Vorschau beim
jeweiligen Control. Die gemeinsame Drag-Erkennung reagiert nur auf Dateien.
Dateiauswahl unterstützt Auswahl, Drop und Paste mit gemeinsamen Typ-, Mengen- und Größengrenzen;
Dateien bleiben lokal, bis die App ihre Sendeaktion ausführt. Medienvorschauen verwenden temporäre
Objekt-URLs, Textvorschauen sind begrenzt. Aufgabenfortschritt zeigt vorgegebene Statuswerte;
Dokumente lassen sich als Text, Markdown oder Code lesen. Die Diff-Ansicht stellt einen gelieferten
Unified-Diff dar, berechnet und schreibt selbst keine Änderungen.

`actor_program_controls` liest mit `topic: "controls"` den Control-Katalog aus den exportierten
Typverträgen der Extension; ohne `topic` gilt dieselbe Auswahl. Ohne `component` liefert es
nur die Namen. Mit einem Control folgt die Antwort dessen
TypeScript-Symbolen und enthält ausschließlich die gewählte Deklaration sowie ihre transitiv
benötigten Typen und Imports; andere Controls und unbenutzte Typen fehlen. Umbenannte Exporte
und lokale Verweise bleiben auflösbar. Mit `topic: "guide"` liefert es stattdessen die
vollständige gerenderte Actor-Programm-Anleitung im Feld `guide`. `component` ist nur für das Thema
`controls` zulässig; zusammen mit `guide` wird die Anfrage ausdrücklich abgewiesen.
Der vollständige automatische Dateisammler versorgt
weiterhin den Client-Compiler und die
öffentliche HTML-/LLM-Referenz. Die Referenz gewinnt Props, Varianten und Beschreibungen aus dem
TypeScript-Vertrag und prüft dessen Übereinstimmung mit den Runtime-Exports. Es gibt keine
zweite manuell gepflegte Komponenten- oder Props-Liste. Die Vorlage `controls` zeigt die
Bausteine als lokale, interaktive Mini-App ohne fachliche Aktionen.

`UI.Chat` hat zwei ausdrücklich getrennte Formen:

- `actor="primary"` bindet den Chat an den aktuell gewählten primären Actor des Runs.
  Er teilt den Live-Verlauf des Hauptchats. `actor="@handle"` bindet ihn an einen benannten Actor
  desselben Runs. Dessen Verlauf zeigt Eingaben, veröffentlichte Antworten, Denkschritte und
  Werkzeugaufrufe mit Argumenten und Ergebnissen in Journalreihenfolge. Diese Schritte bleiben
  auch nach einem Wechsel des primären Actors beim ursprünglichen Gespräch erhalten.
  Die Ansicht aktualisiert sich auf Nachrichtenebene; für diese Actor-Ansicht werden keine Token-Deltas
  übertragen. Eingaben laufen über die Chat-Route des Hosts als Benutzernachricht an den Actor.
  Die App benötigt dafür keine eigene Aktion,
  keinen Handler und keine Capability im Actor-Vertrag. Unbekannte oder gestoppte Actors werden
  ausdrücklich gemeldet. Freie Run-IDs, fremde Journale und eigene Fetch-Verbindungen sind nicht
  Teil dieser Anbindung.
- `messages={messages}` und ein optionales `onSend` ergeben einen vom App-Code gesteuerten Chat.
  Die App liefert ihre Nachrichten und verarbeitet Eingaben selbst, zum Beispiel über eine
  deklarierte Aktion und den gemeinsamen Actor-Zustand. Der Baustein ergänzt weder Nachrichten
  noch Antworten automatisch. Er ist auch für einen Verlauf ohne Actor geeignet. Diese Form
  kann nicht mit `actor` kombiniert werden.

Ein an TypeScript gebundenes `UI.Chat` erhält den vorhandenen Verlauf schreibgeschützt,
einen erklärenden Hinweis und keine Eingabe. Die Host-Bridge erhält diese Einschränkung
auch bei Schreibrechten am Run; direkte Sendeversuche werden abgewiesen. Ein kontrollierter
Chat mit eigenem `onSend` bleibt eine vom Programm definierte Oberfläche.

`showInput={false}` zeigt in beiden Formen nur den Verlauf. Titel, Eingabeplatzhalter,
Zeitstempel und Detaildarstellung lassen sich über Props einstellen. `UI.ChatMessages` und
`UI.ChatInput` bieten Verlauf und Eingabe getrennt an. `UI.Markdown` rendert seinen `text`,
`UI.Select`, `UI.Button`, `UI.Toggle`, `UI.ToggleGroup`, `UI.Tabs`, `UI.Dialog` und die
übrigen shadcn-Komponenten sind dieselben Steuerelemente wie in der Hauptoberfläche (siehe
plugins); eine Mini-App baut keine eigenen Schaltflächen oder Reiter, Icons kommen aus
`lucide-react`. Die verbindlichen Props und Nachrichtentypen stehen in den UI-Verträgen im
Code; für die shadcn-Komponenten sind es die von shadcn und Base UI dokumentierten.

`UI.Chat` und `UI.ChatMessages` können mit `owner` einen Absender bestimmen, dessen
Nachrichten ohne Sprechblase erscheinen. Der Wert wird mit `sender` verglichen; Rollen und
Sprechblasen der anderen Absender bleiben erhalten. Ein Actor-Chat übernimmt ohne eigene
Angabe automatisch den aufgelösten Actor als Owner. `owner={null}` schaltet diese Vorgabe ab.
Bei frei gelieferten Nachrichten bleiben ohne Owner die jeweiligen Nachrichtenvorgaben
wirksam. Der Owner betrifft ausschließlich die Darstellung, keine Identität oder Rechte des Runs.

`UI.MessageList` stellt eine schlichte, nur lesbare Folge mit frei benannten Absendern dar.
Die Mini-App übergibt die Nachrichten als Props; ein neuer Arraywert aktualisiert die Anzeige.
Die Reihenfolge bleibt die des Arrays, Nachrichtenschlüssel bleiben stabil. Der Baustein
verwendet dieselbe Nachrichtendarstellung wie der Seitenchat, mit Markdown, Anhängen und
optional sichtbaren Zeitstempeln. Absender erhalten ohne eigene Farbangabe eine stabile Farbe;
die Seite kann je Nachricht ausdrücklich gewählt werden. Auch hier zeigt `owner` die
Nachrichten des passenden Absendernamens ohne Sprechblase; ohne Owner oder mit `null` bleiben
alle Absender in Sprechblasen. Die vollständigen Felder und Props
stehen im automatisch erfassten Control-Vertrag.

Die Liste besitzt keine eigene Eingabe, Titelleiste, Actor-Verbindung oder Netzwerkanfrage.
Sie ergänzt keine Nachrichten selbst und modelliert keine Werkzeug- oder Denkschritte.
Die App kann ihre Daten aus lokalem React-Zustand oder dem bereits verfügbaren Actor-Zustand
ableiten. Gemeinsame Zustandsänderungen erreichen die Anzeige über die Host-Bridge.
Die lokale Controls-Vorlage und die öffentliche UI-Demo zeigen zwei Absender und eine
Schaltfläche, die sichtbar eine weitere lokale Nachricht anfügt.
Die öffentliche Demo lässt zusätzlich auswählen, welcher Absender ohne Sprechblase erscheint.

Die gemeinsame Chat-Eingabe leert Text und Anhänge beim Beginn einer gültigen Sendeaktion.
Ein zwischenzeitlich neu geschriebener Entwurf bleibt bei Erfolg und Fehler erhalten. Ohne
Textänderung stellt ein Fehler die ursprüngliche Eingabe samt Anhängen automatisch wieder her;
sonst bleibt sie separat abrufbar. "Nicht gesendete Eingabe einfügen" hängt sie ausdrücklich an
den aktuellen Entwurf an und prüft dabei die Anhangsgrenzen. Weitere Sendeaktionen und neue
Anhänge bleiben bis zum Ende der Anfrage gesperrt. Die vollständigen Regeln einschließlich
Zurücksetzen stehen im Kapitel plugins.

Auch diese Eingaben unterstützen Dateiauswahl, Drag-and-drop und Einfügen aus der Zwischenablage.
Bei gesteuerten Chats erhält `onSend(text, attachments)` die Dateinamen, MIME-Typen und
Base64-Inhalte als zweites Argument; die App übernimmt die Zustellung. Sie kann über
`attachmentCapabilities` die Fähigkeiten ihres Zielmodells angeben. Ein Actor-Chat erhält diese
Informationen vom Host. Anhangsfehler erhalten den gesamten Entwurf. Der Verlauf verwendet
dieselben Medienvorschauen und Downloadverweise wie der Hauptchat.

Die Vorlage `chat` verbindet diese Bausteine mit dem normalen Aktivierungspfad. Weil
sie keine eigenen aufrufbaren Oberflächen hat, benötigt sie keine simulierte Chat-Antwort und
keinen Aktionstest. Fügt eine App eigene Aktionen oder Werkzeuge hinzu, gilt für diese die
gewöhnliche Testpflicht.

## Host-Bridge

Die Host-Bridge läuft als erstes Script im Dokument, erzeugt einen `MessageChannel` und meldet
sich mit dessen übertragenem Port und einem zufälligen Fragment-Token beim Host. Der Host hört
bereits vor dem Laden des Frames, prüft Token, opaque Origin und das aktuelle `contentWindow` und
nimmt genau den zuerst übertragenen, an dieses Dokument gebundenen Port an. Öffentlich sieht der
Client den importierten, typisierten `context`:

- `context.ready` wartet auf die Bridge.
- `context.capabilities.call(actionId, input)` ruft eine fest installierte Aktion auf.
- `context.state.read()` liest den zuletzt empfangenen intrinsischen Actor-Zustand.
- `context.state.subscribe(listener)` meldet spätere Zustandsänderungen.
- `context.chat.read(actor)` liefert den aktuellen Snapshot mit `messages`, `running`,
  Modellfähigkeiten für Anhänge, optionalem `owner` als aufgelöstem Actor und optionalen Fehlern,
  vor der ersten Lieferung `undefined`.
- `context.chat.subscribe(actor, listener)` abonniert Änderungen dieser Actor-Ansicht und liefert
  eine Abmeldefunktion; `actor` ist `primary` oder `@handle` im Run der App.
- `context.chat.send(actor, text, attachments?)` sendet eine Benutzernachricht mit optionalen
  Anhängen über den Host und liefert ein
  Promise. Diese feste UI-Verbindung ist keine beliebige Modul-Capability und erlaubt keinen
  Wechsel in einen anderen Run. Eine App sendet erst nach einer ausdrücklichen Bedieneraktion.

Der Host prüft Nachrichtentyp, Request-ID, JSON-Tiefe und Größe. Clients erzeugen eindeutige
Request-IDs. Der Host merkt sich die letzten 512 IDs eines Frames und weist deren Wiederholung
ab; die Anzahl aufeinanderfolgender gültiger Aufrufe ist unbegrenzt. Der Server prüft die
Wiederverwendung von Aktions-IDs zusätzlich. Regelmäßig aktualisierte Mini-Apps können dadurch
auch in langen Runs weiter ihren Status lesen.
Aktionsaufrufe tragen den installierten `compilationHash`. Eine spätere Navigation trennt den
Port sichtbar; das Zieldokument erhält keine neue Bridge. App-Code ist trotzdem
vertrauenswürdiger Inhalt des Runs und keine Vertraulichkeitsgrenze gegen einen bösartigen
App-Autor: ein sandboxed Iframe darf sein eigenes Dokument navigieren, und der Navigationsrequest
kann gesendet sein, bevor der Host trennt.

<!-- guide:programs -->
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
<!-- /guide:programs -->

## Offene Grenzen

- Ein erfolgreicher Typecheck und Fachtest ist kein Nachweis der tatsächlichen Browserbedienung.
  Oberflächen müssen zusätzlich im Browser geprüft werden.
- Fortschritt innerhalb einer noch laufenden Backend-Funktion wird nicht automatisch als
  gemeinsamer Zustand veröffentlicht; die Zustandsübernahme erfolgt am erfolgreichen Ende.
- Zeittrigger sind weiterhin nicht umgesetzt. Subscription-Ereignisse liefern normale
  ActorInputs an den Actor; eine View besitzt keinen eigenen Scheduler.
- Browser-CSP und Run-Dateirechte ersetzen keine separate Vertrauensgrenze für fremden Code.
