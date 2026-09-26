# Actor-Programme: Funktionen, Zustand und Views

<!-- guide:programs -->
## Programs and mini-apps

An executable actor can own a TypeScript program with functions, journaled state, and React
views. This applies to both TypeScript and LLM actors. Users see these views as mini-apps. A
mini-app displays its actor's state and calls that actor's functions directly; the call requires
no model turn. ActorInputs remain messages to the actor: an LLM actor processes them with its
model, while a TypeScript actor uses its optional `onInput` handler.

The `ragents.actor-programs` plugin owns packages, activation, function binding, and view
hosting. Shared native execution is described in `typescript-platform.md`; actor state and
ActorInputs are covered in `core.md`. Every callable function and view belongs to the same actor
model.

<!-- /guide:programs -->

<!-- guide:programs -->
## Packages and actor binding

Programs are private packages in a prepared pnpm workspace for the run. File functions and
language servers access them through `@actors/<name>/`, and `bash` runs in a package with
`cwd: "@actors/<name>"`. The packages stay on the server, and every call that names the alias runs
there, also when the run works in a folder on a workstation. The
workspace interface exposes the actor-program collection directly. Normal relative imports
include local modules, while fixed local dependencies come from the host installation.

```text
@actors/<name>/
  package.json
  tsconfig.json
  tsconfig.client.json
  tsconfig.server.json
  src/contract.ts       backend contract, if needed
  src/server.ts         backend, if needed
  src/client.tsx        view entry point, if needed
  src/styles.css        optional, only for externally generated markup
  tests/program.test.ts
```

`package.json` contains `name`, `private: true`, `type: "module"`, and `ragents` metadata with a
title, optional description, optional backend, and optional named views. Each view has an ID and
client entry point; its title and stylesheet are optional. A view declares no size; the host sizes
its tile. At least one backend or view must exist. The host supplies HTML with a `root` element
for each view. The authoritative schemas are in
`apps/server/src/plugin-support/actor-programs/app-project.ts`; a violation names each path and
its reason, for example `views.0 has unknown field width`.

`actor_program_activate` binds a package to an existing actor with `actor: "self"` or
`actor: "@handle"`. Without an explicit actor, an existing program binding remains. A new
backend creates a TypeScript actor using the program name as its handle, while a new view-only
package binds to the calling actor. A static view needs neither a dummy actor nor an artificial
backend function.

Activation rejects a program with an input handler on an LLM actor because that actor's normal
messages remain with the model driver. A package without an input handler can still add functions
and views to it. Functions can also exist without a view. Exactly one actor program is active
per actor; a different package is rejected. Add functions and views to the existing package
instead. Reactivating that package applies its changed state, including removed functions and
views.
<!-- /guide:programs -->

### Dateirechte der Actor-Programme

Bei Runs mit eigener UID gleicht der Host Eigentümer und Schreibrechte der privaten
Quell-, SDK- und Build-Dateien innerhalb der Run-Speichergrenze ab. Bibliotheks-Symlinks bleiben
unverändert. Das Modell muss keine ausgegebenen Speicherpfade übernehmen. Der Abgleich umfasst den
ganzen Arbeitsbereich der Actor-Programme samt Staging neuer Pakete (unten, "Vorlagen und
Anlegen"); das Umbenennen erhält Eigentümer und Rechte. Einträge, die während des Abgleichs
verschwinden, etwa ein gerade umbenanntes Paket, überspringt er.

<!-- guide:programs -->
## Backend and client

The backend entry point exports `defineActor(contract, implementation)` from `@ragents/server`
as its default export. The TypeBox contract describes `state`, `functions`, and optional `input`.

State must accept the initial value `{}`. Each function declares its input and output, with
optional granted capabilities, confirmation, and publication as a tool. The implementation
contains the same functions and, when input is declared, an `onInput` handler. TypeScript derives
input, result, and state types from the contract.

Each function receives `(input, context)` and returns only its domain result.
`context.state.replace` stages state changes; a return value is never also interpreted as new
state. `context.actor` identifies the actor that owns the function and state.
`context.functions.<name>(input)` calls declared run functions under the caller's identity.
`onInput` acts as its actor. A function invoked externally retains its actor's state but not that
actor's calling identity: called from a view, it acts as the clicking human. To deliver a message
to another actor in the app actor's name, the function passes it as an ActorInput to its own
actor, whose `onInput` sends it under the actor's identity. Snippets use the same API. `context.std` supplies available standard
functions, including mediators.

An optional `tool` declaration publishes the same function in the typed run API. Without
`targets`, it is available to active executable actors; `self` refers to the program owner.
Another caller does not receive a private copy of the function or state. Bindings use names and
handles, not IDs copied from output.

React, `createRoot`, and local modules use normal imports. `context` and `useAppState` come from
`@ragents/client`, while controls come from `@ragents/client/ui`. The hook reads shared actor
state; `context.capabilities.call(functionName, input)` invokes a declared function.
`context.actor` identifies the view's actor. Local drafts, selection, and focus stay in React
state. An actor chat can use this handle to show exactly that actor's conversation.

The view runs in a host iframe with restricted browser permissions. Its accessible name comes
from `aria-label`; an empty `title` prevents a browser tooltip over the content. Forms, including
`Form`, may use `onSubmit`; the handler prevents the default action, because a native submission
to a URL stays blocked. In a search interface, a form with a `type="submit"` button lets Enter and
the button share one handler. Test this interaction in the host frame, not only in a standalone
React render.
<!-- /guide:programs -->

### Vertragsabfrage des Backend-Adapters

Der erzeugte Backend-Adapter gibt zur Vertragsabfrage ausdrücklich JSON-Daten ohne
TypeBox-Metadaten zurück. Diese Beschreibung ist getrennt von der strengen JSON-Prüfung fachlicher
Ergebnisse und Zustandswerte vor der Übertragung aus dem nativen Prozess.

<!-- guide:programs -->
## Create, edit, and activate

`actor_program_create` creates a package from a template completely or not at all. The host
builds it outside `@actors/` and moves it to `@actors/<name>` only after every step has succeeded,
so a failed attempt leaves nothing behind and the name stays free. An existing folder of that
name, even an empty one, is rejected. The six templates in `server/templates.ts` and
`controls-template.ts` demonstrate different forms:

- `blank`: a static view on an existing actor.
- `chat`: a chat view for its actor without a custom server function.
- `controls`: a local demonstration of the available UI components.
- `headless-counter`: a TypeScript actor with input handler, functions, and state but no view.
- `text-analysis`: a TypeScript function with a shared counter and React view.
- `shared-list`: the same list function for the view and an agent tool.

`actor_program_activate` checks types, builds the backend and views, runs the package tests, and
only then activates the verified version. Errors identify the location to fix.

Published functions appear in the current TypeScript API even during an active LLM turn.
`typescript_api` returns their exact contracts, and snippets call them through
`context.functions`. Reactivation updates the schemas; removed functions disappear from the same
catalog. No additional call contract is needed.

`actor_program_list` shows installed programs. `actor_program_remove` removes the binding and its
views. It also stops a TypeScript actor, while an existing LLM actor remains. Activating a package
of the same name again restarts that stopped actor with its state instead of creating another. Sources stay
editable in the private workspace. `actor_view_set_visibility` addresses a view by
`package-name/view-name` or unique title. Visibility changes neither functions nor actor state.
The host manages hashes and technical bindings.
<!-- /guide:programs -->

### Vorlagen und Anlegen

Die `ragents`-Metadaten jeder Vorlage sind ein Wert vom Typ `AppPackage` (`Static` von
`appPackageSchema`), den der Compiler gegen das maßgebliche Schema prüft; eine Vorlage kann
`package.json` nicht als Text mitbringen. `templateFiles` erzeugt daraus beim Anlegen die
`package.json` mit dem gewählten Namen und liefert dieselben Dateien für die erzeugte Referenz.
`apps/server/tests/actor-program-create.test.ts` legt jede Vorlage an und aktiviert sie mit
Typprüfung, Build und ihren Tests, damit auch ihr Quellcode nicht unbemerkt gegen die Plattform
veraltet.

Anlegen ist ganz oder gar nicht, für `actor_program_create` wie für das Paket eines Run-Scripts
(`importPackage`). Der Host baut das Paket in `actor-workspace/.staging/<name>-<uuid>`, auf
demselben Dateisystem wie `actors/`, aber außerhalb des pnpm-Workspace und des Alias
`@actors`. Dort laufen alle Schritte (Dateien, SDK, Paketprüfung, Backend-Vertrag, Client-SDK),
erst danach benennt er den Ordner nach `actors/<name>` um. Prüfung und Umbenennen folgen ohne
Unterbrechung aufeinander, weil `rename` einen leeren Zielordner still ersetzen würde: ein
vorhandener Ordner, auch ein leerer, lässt das Anlegen mit "existiert bereits" scheitern und bleibt
unberührt. Zwei gleichzeitige Anlagen desselben Namens schließen sich aus; die zweite scheitert mit
"wird gerade angelegt". Bei jedem Fehler entfernt der Host den Staging-Ordner. Reste eines
abgestürzten Serverlaufs räumt die nächste Anlage im Run weg und lässt dabei die laufenden Anlagen
dieses Prozesses stehen; ein Run wird nur von dem Prozess bedient, der das Journal hält. Das Paket
eines Run-Scripts aktiviert der Host nach dem Umbenennen; scheitert die Aktivierung, entfernt er es
wieder.

Kein erzeugtes Paket kennt seinen eigenen Ordner. `@ragents/workflow/prompts` findet sein Paket
über die eigene Moduladresse (`import.meta.url`, drei Ebenen über `node_modules/@ragents/workflow`),
alle übrigen absoluten Verweise zeigen auf Bibliotheken des Hosts. Ein Paket bleibt so nach dem
Umbenennen und als Kopie im Build-Ordner der Aktivierung gültig.

### Diagnose, Typprüfung und Fachtests

Vor jeder Modellanfrage prüft ein Laufzeitbeitrag geänderte Actor-Programme einschließlich
Typen und Build. Der Kontext erhält nur einen kurzen Unterschied zum letzten Fehlerstand;
unveränderte Projekte und Fehlerlisten werden nicht wiederholt. `actor_program_diagnostics`
liefert den letzten vollständigen Stand, optional für einen Programmnamen. Die normalen
Language-Server-Werkzeuge können dieselben Projekte direkt prüfen.

Die Typprüfung umfasst immer den Backend-Einsprungpunkt aus `package.json.ragents.backend`, auch
bei einer engeren Dateiauswahl in der erhaltenen Autoren-tsconfig. Scheitern Typprüfung oder
Client-Build bei der Aktivierung, nennt die Meldung die Zahl der Fehler und die ersten zehn als je
eine Zeile `Datei:Zeile:Spalte Meldung`, höchstens 240 Zeichen, dazu "und N weitere";
`actor_program_diagnostics` kennt die vollständige Liste (`checkFailure` in
`plugins/ragents.actor-programs/server/runtime.ts`).
Es gibt keinen getrennten Check-, Test- oder Installationsvertrag für Actor-Programme und
keine vom Modell weitergereichte Build-Referenz. Bearbeitete Quellen ändern eine laufende
Installation erst nach erneuter erfolgreicher Aktivierung.

Fachtests liegen als normale `node:test`-Dateien unter `tests/**/*.test.ts` und laufen mit
`node --import tsx --test`. Sie importieren das Programm und rufen `program.functions` oder
`program.onInput` mit konkreten Eingaben auf. `@ragents/server/testing` liefert
`createTestContext` mit Zustand und expliziten Funktions-Mocks unter `functions`. Ergebnis und gespeicherter
Zustand werden getrennt geprüft. Eine reine View braucht keine erfundene Serveraktion.
Die Aktivierung lässt die Tests mit einem eigenen Reporter laufen (`server/test-report.ts`) und
meldet einen Fehlschlag knapp: Zahl bestandener und fehlgeschlagener Tests, je fehlgeschlagenem
Test Name, Meldung, bei Assertions erwartet und tatsächlich, und die Stelle in der Testdatei
relativ zum Programm; eine Testdatei, die nicht lädt, nennt die Fehlerzeile ihrer Ausgabe.
Laufzeiten, Node-interne Stack-Zeilen und absolute Pfade fehlen.

## Werkzeugkarten und Kacheln

Einfache Eingaben an einen Agenten gehören zum Werkzeug. `card: true` erzeugt aus den
typisierten Parametern ein kompaktes Formular direkt in der Kachel des Agenten. Es hat keine eigene
Fensterhülle. Feldbeschriftungen, Pflichtmarkierungen und Sendeaktion bleiben sichtbar;
Parameterbeschreibungen dienen als Platzhalter. Checkbox und Feldname teilen sich eine Zeile.
Mehrzeilige Eingaben beginnen mit zwei Zeilen und lassen sich vergrößern.
Die Karte ruft die zugehörige Actor-Funktion direkt auf. `targets` verwendet `self` oder
`@handle`; der Host löst die Bindung bei der Aktivierung auf. Kein Modell-Turn ist nötig.

Jede Mini-App ist nach der Aktivierung sichtbar. Der zugehörige Actor ist ihr Anker; Größe
und Platz bestimmt die Kachel, in der sie steht. Der Benutzer kann sie zusätzlich in der
lokalen Vollansicht öffnen.

Der zugehörige Actor steht in der persönlichen Standardansicht nicht auf der Fläche, auch bei
einem LLM-Actor. Die Mini-App bleibt sichtbar und bedienbar. `Actors` in der Leiste über der Fläche
führt den Besitzer auf, ohne eine Kachel anzulegen; die Checkbox `Fläche`
je Actor gibt ihm auf Wunsch eine eigene.
Auch eine ausgeblendete installierte View zählt weiterhin als eigene Mini-App.

In der Kachel und in der Vollansicht zeigt der Host den ganzen
App-Inhalt bei 100 Prozent. Der Frame verwendet seine tatsächliche Breite und Höhe; Schrift,
Controls und Abstände erhalten keine zusätzliche Verkleinerung. Die Kachel besitzt eine matte
blaugraue Fläche mit Kontur und 17 Pixeln Eckradius, ohne Tiefe und ohne zweite innere
Zierkontur. Ihren Titel trägt der Kachelkopf; die App bringt keine eigene Titelzeile mit.

Der Vergrößern-Knopf öffnet eine lokale Vollansicht im Host-Bereich `surface`. Sie liegt mit
16 bis 24 Pixeln Abstand ausschließlich über der Fläche; die Reiterleiste, die Titelleiste,
die Leiste für Apps und Actors sowie die Statusleiste bleiben sichtbar und bedienbar. Der Hintergrund wird wie bei einem Dialog
abgetönt und mit 4 Pixeln Unschärfe weichgezeichnet. Rahmen, Ecken und Schatten folgen der
gemeinsamen Dialoggestaltung. Nur die darunterliegende Fläche ist währenddessen inaktiv.
Der App-Titel in der Leiste über der Fläche behält beim Umschalten
das Schriftgewicht 700; die aktive Fläche und Unterkante zeigen den Zustand, ohne die
Nachbareinträge zu verschieben. Der Provider hält genau eine Vollansicht; die Auswahl
einer anderen App ersetzt sie. Die Vollansicht hat eine eigene Titelzeile mit dem App-Namen
und einem runden Schließen-Knopf mit X. Die Inhalte erscheinen in Originalgröße.
Schließen, Escape und Hintergrundklick führen zur Fläche zurück. Ein intern behandeltes
Escape, etwa in einer Auswahlliste, schließt die Vollansicht nicht.

Der Kachel-Client bleibt beim Vergrößern gemountet. Die Vollansicht lädt einen
zweiten Client mit demselben journalisierten Zustand; ungesendete Eingaben bleiben je Ansicht
lokal. Die Vollansicht wird nicht journalisiert und allein vom
Benutzer im Host bedient; Mini-Apps besitzen keine Dialogfähigkeit oder Fenstersteuerungs-API.

Die Sichtbarkeit der View ist journalisiert. Ausblenden erhält Installation, Werkzeuge,
Aktionen und Zustand. Wiederanzeigen, Neustart und erneute Aktivierung erhalten diese Auswahl.
Die persönliche Sichtbarkeit ihres Actors wird davon getrennt im
Browser je Serveradresse und Run gespeichert; sie verändert kein Journal. Es gibt keinen
zusätzlichen Mini-App-Reiter in der Leiste.

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
Aufrufanzeigen verwenden Aktionslabels. Ohne Label zeigt der eingeschränkte Zugang nur den
Aufrufstatus; technische Aktionskennungen bleiben dem Vollzugang vorbehalten.

Der Plugin-Host registriert Fachoperationen mit Eingabe- und Ergebnisschema sowie
Operator-Policy. `direct` erlaubt die Bedieneraktion, `confirm` verlangt eine bestätigte
Journal-Frage und `unavailable` schließt die Verwendung als View-Funktionsaufruf aus. Die typisierten
Adapter prüfen Identität, Vertrag und Abbruch an der tatsächlichen Aufrufgrenze.
Die native Node-Ausführung ist keine zusätzliche Sandbox gegen beliebigen Backend-Code;
die Dateirechte und Ausführungsumgebung gehören zum Run-Workspace.

## Kachel-Host und Funktionen-Reiter

Die Leiste über der Fläche zeigt sichtbar geschaltete Apps neben direkten Zugängen zu allen
nichtmenschlichen, nicht gestoppten Actors. Der Actors-Listenknopf bleibt links stehen;
App- und Actor-Knöpfe scrollen bei Platzmangel gemeinsam horizontal. Die Leiste liegt
außerhalb des Dialogbereichs `surface` und erlaubt Appwechsel während der Vollansicht. Eine feine
untere Trennlinie grenzt sie von der Fläche ab; sie besitzt keinen eigenen Schatten.
Der App-Name wählt ihre Kachel;
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

Kachel und Vollansicht verwenden denselben Frame-Endpunkt und Build. Jede Ansicht besitzt
einen Iframe mit `sandbox="allow-scripts allow-forms allow-downloads"` und einer
Content-Security-Policy; `form-action 'none'` verhindert jede echte Formularübermittlung. Der
Browserclient wird einschließlich seiner Imports gebündelt; React und UI-Bausteine stammen aus
den vorbereiteten lokalen Abhängigkeiten. Der Host erhält keinen nachgeladenen App-Code als Plugin.

## Wiederverwendbare UI-Bausteine

Der Host exportiert unter `@ragents/client/ui` wiederverwendbare Controls (Quellen unter
`apps/web/src/actor-programs/client-ui/`).
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
Controls gehören mit Implementierung, Styling und Typverträgen direkt in diese Bausteinsammlung.
Der Client importiert benötigte Controls aus diesem Paket; der reguläre Build bündelt sie mit der App.
Die Props werden bei der TypeScript-Prüfung der Mini-App typgeprüft. Die Bausteine funktionieren in der
Kachel und in der lokalen Vollansicht.

`SvgEdge` stellt SVG-Verbindungen mit einheitlichen Pfeilen, Linien und semantischen Farben
bereit. Offene Pfeilspitzen mit abgerundeten Enden folgen der Pfadtangente und enden genau
am Anschlusspunkt. Der Baustein verwaltet eindeutige Pfeilmarker und berücksichtigt reduzierte Bewegung.
Mini-Apps importieren ihn über `@ragents/client/ui`; der Host verwendet dieselbe
Implementierung. Pfadgeometrie, Knoten und fachlicher Zustand gehören weiterhin zur jeweiligen
Darstellung. Die Autorenanleitung zeigt eine kompakte SVG-Vorlage mit beschrifteten Knoten,
responsivem Zeichenbereich und gemeinsamen Farbtokens. Controls-Vorlage und erzeugte
Bausteinreferenz enthalten ein bedienbares Beispiel. Eine automatische Graphanordnung
oder ein allgemeines Knotenmodell ist damit nicht verbunden.

<!-- guide:programs -->
## Connect workflow definition, instructions, and presentation

`@ragents/workflow` provides a shared TypeScript contract for descriptive workflows. A
`WorkflowDefinition` contains roles, steps, goals, completion sources, degrees of freedom,
prompt references, and transitions. `defineWorkflow` validates it. The canonical contract lives
in `apps/server/src/plugin-support/actor-programs/workflow/index.ts`, from which the installed SDK receives its
type declarations. The module needs neither React nor a server.

Long instructions live in separate Markdown files inside the actor package. A step references
one through `prompt`, and a role can also have a shared prompt. These are relative package paths,
not file contents the model must reproduce.

```ts
import { defineWorkflow, workflowInstructions } from "@ragents/workflow";
import { readPrompt } from "@ragents/workflow/prompts";

const definition = defineWorkflow({
  id: "draft",
  title: "Create draft",
  roles: { writer: { title: "Writer", prompt: "prompts/writer.md" } },
  steps: [{
    id: "write",
    title: "Develop draft",
    role: "writer",
    goal: "Deliver a complete draft for the task.",
    prompt: "prompts/write.md",
    completion: { source: "agent", description: "The writer reports the completed draft." },
    freedom: { mode: "extend", description: "Add relevant research.", allowSkip: true, maxItems: 12 },
  }],
  transitions: [],
});

const prompt = await workflowInstructions(definition, "writer", readPrompt);
```

`readPrompt` is server-only and bound to the installed actor package. It reads files within that
package; missing, empty, or escaping references are errors. `workflowInstructions` combines the
role prompt, instructions for relevant steps, and definition metadata. A `.hbs` file can also be
referenced, but the standard reader loads it as plain text. A plugin resolves required template
values explicitly in its own reader. The assembled text is passed as a normal
`agent_spawn.prompt` and therefore appears in the started actor's journal.

The current `WorkflowState` remains separate. The program derives it from actual data and
service results. `WorkflowDiagram` from `@ragents/client/ui` receives `definition`, `state`, and
`label`; `workflowGraph` returns the same projection as nodes and edges for custom displays. By
default, `WorkflowDiagram` fits its width automatically and lets outer content scroll
vertically. Prompt text is not loaded into diagram cards.

`freedom.mode: "extend"` permits custom items in that step; `allowSkip` applies only to custom
optional items, and a skipped item stores its reason in state. `fixed` marks mandatory steps. An
`expansion` specifies a dynamic source, role, and maximum concurrency. The program supplies the
current groups and items in `state.expansions`; new entries appear without changing the graph.
Normal transitions form an acyclic workflow, while `kind: "return"` marks return paths.
Transition conditions are descriptive text.

The definition neither starts actors nor evaluates conditions. Control programs must enforce
concurrency limits, allowed changes, and completion sources. A status set by a model does not
replace service verification or a user decision. Diagram, instructions, and execution read the
same definition, while the existing actor remains responsible for execution. The learning
afternoon sample in the showcase profile demonstrates this with two parallel LLM contributions followed by
collection. Its definition and prompt files are under
`plugins/ragents.reference/run-scripts/learning-afternoon/`.

## Display diagrams from data

`FlowDiagram` displays graph data with React Flow in the current app theme. ELK arranges nodes
and connections automatically. The mini-app supplies nodes with local IDs and edges between
those IDs; no coordinates or custom diagram language are required.

```tsx
import { FlowDiagram } from "@ragents/client/ui";

const nodes = [
  { id: "request", label: "Request", status: "done" as const },
  { id: "review", label: "Review", status: "active" as const },
  { id: "result", label: "Result", status: "pending" as const },
];
const edges = [
  { source: "request", target: "review" },
  { source: "review", target: "result" },
];

<FlowDiagram nodes={nodes} edges={edges} label="Request, review, and result" />
```

`label` describes the diagram for screen readers. Nodes can include `detail`, `status`, `kind`,
and `items`. Every item has a label, optional details, and its own status, and appears as a list
entry inside the card. By default, the diagram shows a compact overview with titles limited to
two lines and fully wrapping items. Status icons distinguish pending (circle), active, completed
(green check), blocked (exclamation mark), and skipped (minus), while the header also names the
status in text. Chips, headers, and outlines use green for completed, blue for active, and red
for blocked; pending and skipped remain neutral. Color supplements icons and labels without
changing card dimensions.

Cards clip their content at the outer rounded corners while shadows and connections remain
visible outside. Active cards and work indicators animate subtly only with `running=true`; a
missing or false value suppresses animation without changing the reported status. The system's
reduced-motion preference also disables animation. Hovering a title or item reveals complete
labels, status, and details. `detailLevel="full"` instead shows all text and status rows in the
cards. Edges can have labels, and `direction` chooses a rightward or downward layout. Automatic
layout reserves at least 52 layout pixels between adjacent cards and 94 between levels, with
labels allowed to require more. An edge with `kind: "return"` draws a return path outside the
main sequence without changing its temporal layout.

Diagrams start at 80 percent of design size, including type, cards, edges, and spacing; the
center control restores that scale. The diagram pane has no separate background, border, or dot grid,
so the diagram sits directly on the mini-app content. Zooming and panning change only the view.
With `viewport="fit-width"`, the graph fits the container automatically, shrinks further when
needed, and never grows beyond 80 percent. Remaining space is centered. Height follows complete
node and edge bounds and only the outer content scrolls; zoom, pan, and diagram controls are
hidden in this mode. Status changes that do not alter dimensions need no new graph layout.
Invalid IDs or connections appear as errors on the graph. All libraries are bundled locally,
with no external diagram service or mini-app installation. Domain actions remain normal controls
beside the diagram. The controls template and the building-block reference include a locally
switchable status example.
<!-- /guide:programs -->

## Frame, Layout, Formulare und Chat-Bausteine

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
mittlere Detailinhalt scrollt, getrennt von der Liste, auch in der schmalen Detailansicht. Icons, Artbezeichnungen und
semantische Farben sind Daten des Aufrufers; der Baustein verwendet die gemeinsamen Tokens.
Unter 900 Pixeln füllt die Liste die Fläche allein; eine Auswahl öffnet die Details als eigene
Seite mit rundem Zurück-Knopf, Fokusführung und ohne Such- und Filterleiste. Maßgeblich ist die
eigene Breite des Bausteins, nicht die des Browserfensters; dieselbe Schwelle steuert Darstellung
und Umschaltung. Wird die Fläche wieder breit, stehen Liste und Details nebeneinander.
Mini-Apps verwenden dieselbe Implementierung aus `apps/web/src/ui` wie der Host;
der erzeugte Control-Katalog und seine Demo enthalten denselben Typvertrag.

Mini-Apps verwenden die shadcn/ui-Komponenten der gemeinsamen Bibliothek (siehe plugins) und
Tailwind. Der Mini-App-Compiler kompiliert je Ansicht `apps/web/src/ui/frame.css` mit
`@tailwindcss/node` über die Host-Quellen, die Mini-App-Bausteine und die Quellen der Mini-App
und liefert das Ergebnis im Frame aus; die Gestaltung steht als Utility-Klassen im App-Code,
die mitgelieferten Mini-Apps haben kein eigenes Stylesheet mehr. Die Laufzeit setzt `data-ui-surface="mini-app"` am
Wurzelelement des Frames für Schrift und Grundmaße; die Bausteindemo der Referenz setzt
denselben Marker. `Form`, `DataTable`, `FilePicker`, `TaskProgress`, `DocumentViewer`,
`DiffViewer`, `AppLayout`, `Stack` und `Grid` sind aus `Field`, `Input`, `Checkbox`, `Select`,
`Table`, `Progress` und Tailwind-Klassen gebaut und behalten ihre eigenen Props. Die
Kartenhülle bleibt bestehen; der App-Inhalt erscheint in allen Modi bei 100 Prozent.

Die Vorlagen für Textanalyse und gemeinsame Liste sowie das Sammelboard verwenden die
gemeinsamen Bausteine. Ihre Schrift, Flächen und Listen folgen den Theme-Tokens; ein eigener
fest auf Hell gesetzter Stil entfällt. Bereits angelegte Actor-Programme behalten ihre eigenen
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
Layoutdemo der Referenz übernimmt ausdrücklich lokal eine eingegebene Antwort und erzeugt
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
Typverträgen der Bausteinsammlung; ohne `topic` gilt dieselbe Auswahl. Ohne `component` liefert es
nur die Namen. Mit einem Control enthält die Antwort nur `files`, ohne die Namensliste, und folgt dessen
TypeScript-Symbolen und enthält ausschließlich die gewählte Deklaration sowie ihre transitiv
benötigten Typen und Imports; andere Controls und unbenutzte Typen fehlen. Umbenannte Exporte
und lokale Verweise bleiben auflösbar. Mit `topic: "guide"` liefert es stattdessen die
vollständige gerenderte Actor-Programm-Anleitung im Feld `guide`. `component` ist nur für das Thema
`controls` zulässig; zusammen mit `guide` wird die Anfrage ausdrücklich abgewiesen.
Der vollständige automatische Dateisammler versorgt
weiterhin den Client-Compiler und die
erzeugte HTML-/LLM-Referenz. Die Referenz gewinnt Props, Varianten und Beschreibungen aus dem
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
Die lokale Controls-Vorlage und die UI-Demo der Referenz zeigen zwei Absender und eine
Schaltfläche, die sichtbar eine weitere lokale Nachricht anfügt.
Die Demo lässt zusätzlich auswählen, welcher Absender ohne Sprechblase erscheint.

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

Die Bausteine werden mit `import * as UI from "@ragents/client/ui"` eingebunden. `ui-field` gehört
direkt auf ein Eingabeelement, nie auf dessen Wrapper. `FlowDiagram` stellt mit `layout="star"`
den ersten Knoten in die Mitte.

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
## State and lifecycle

The backend context reads a snapshot of shared actor state. `context.state.replace` stages
changes. Only successful completion with a valid result and state commits them to the journal;
errors and cancellation discard staged state changes. File operations and calls to other
functions that already ran remain effective. An actor function is not a transaction across
those side effects, so a retry must account for the state already reached.

Changes are stored as compact field and array updates when that uses less space than the full
state. This also applies to mini-app call status changes, so unchanged results and request IDs do
not need to be stored again as a complete state. Browser and agent tool share the actor's same
intrinsic state, while local client input remains separate.

The provider observes changes to installed modules, data, and call state in the run event stream
and reloads the listing selectively, even while chat is idle. Text tokens do not trigger reloads,
and late responses cannot replace newer state. `useAppState()` moves this data through the bridge
into React without remounting the client, preserving local form drafts. Active browser calls also
poll their status until completion.

Functions on the same actor execute in order; different actors can work in parallel. Every call
receives an abort signal. The native execution platform owns processes and stop boundaries for
runs and instances. Stopping a run ends active work, while removing an actor program or
activating a new version terminates execution resources from the previous version. After a
server restart, previously pending or active mini-app function calls are marked `cancelled` and
are not retried automatically. Unclaimed ActorInputs behave differently: they remain queued for
an actor that is still executable. A mini-app click and a message to an actor use separate
execution paths. Deleting the run also removes its private app workspace.
<!-- /guide:programs -->

## Offene Grenzen

- Ein erfolgreicher Typecheck und Fachtest ist kein Nachweis der tatsächlichen Browserbedienung.
  Oberflächen müssen zusätzlich im Browser geprüft werden.
- Fortschritt innerhalb einer noch laufenden Backend-Funktion wird nicht automatisch als
  gemeinsamer Zustand veröffentlicht; die Zustandsübernahme erfolgt am erfolgreichen Ende.
- Eine View besitzt keinen eigenen Scheduler; Subscription-Ereignisse liefern normale
  ActorInputs an den Actor.
- Browser-CSP und Run-Dateirechte ersetzen keine separate Vertrauensgrenze für fremden Code.
- Zwischen der letzten Prüfung und dem Umbenennen eines neuen Pakets kann nur noch ein fremder
  Prozess, etwa eine Shell des Runs, einen leeren Ordner desselben Namens anlegen; `rename` ersetzt
  ihn dann. Node bietet kein Umbenennen ohne Ersetzen (`RENAME_NOREPLACE`).
