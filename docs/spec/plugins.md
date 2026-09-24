# Plugins: Vertrag, Ordner und Web-Host

<!-- guide:plugins -->
## Core boundary

A plugin bundles a workspace capability such as file access, questions, or actor programs. It
can contribute functions, prompts, skills, services, and an interface. A profile selects which
plugins load together. The core provides `PluginHost` and typed registries but knows no
product-specific integrations, tools, or tool shapes. Anything a plugin needs from the user is
carried in a payload opaque to the core and rendered by that plugin (`docs/spec/core.md`, Pending
actions).

A function is one callable plugin action. A skill is guidance for a model, with an optional
starting task and supporting files. A run script is executable TypeScript that builds a prepared
run. These contributions can live in one plugin but serve different purposes.

Snippets and actor programs use the same registered typed run functions. The host derives the
TypeScript API and explicitly native agent tools from them. Agent hooks resolve for a particular
run and agent: one runs before every model call and may add a hidden note, the other after every
tool call and may replace its result; the agent runtime behind them is not part of the plugin
contract. HTTP routes, UI contributions, and host-wide services remain plugin facets outside an
individual agent.
<!-- /guide:plugins -->

<!-- guide:plugins -->
## Plugin guide

Start with the domain result and the state that people and models need to share. Then choose the
smallest existing plugin form that fully supports the task. These strategies use the current
functions, actor programs, language servers, and interfaces; they add no new mechanism.

| Need | Suitable form | Boundary |
| --- | --- | --- |
| Reusable domain action or external data access | Typed run function in the owning plugin | One implementation for snippets and programs; keep presentation separate |
| One-off composition of existing functions | TypeScript snippet | No separate actor needed |
| Fixed workflow with later inputs and state | TypeScript actor | Define state and lifecycle explicitly |
| Shared source for instructions and diagram | `WorkflowDefinition` with prompt files | Describes roles, transitions, and freedom; the control program executes and verifies |
| Investigation, conversation, or multi-step implementation | LLM actor with suitable functions | Context and tools must match the task |
| Controls or status for an existing actor | View on that actor | An interface alone does not justify another actor |
| Repeatable prepared run | Run script in the owning plugin | Setup in code, domain decisions in the responsible model |
| Reusable work instructions | Skill in the owning plugin | Describes the approach but does not perform required initialization |

### 1. Keep capabilities and workflows separate

The plugin owns data access, domain rules, configuration, and related guidance. A workflow built
on it decides when to use the capability and where its result goes next, through a registered
function contract or typed service token. General query functions must not open a particular
mini-app or assume its workflow. Removing a plugin should remove its contributions; dependent
plugins declare it through `requires`. The neutral host contains only behavior shared by several
real users. Product paths, account names, and domain selection rules remain in the calling
plugin. A shared host component is justified when several adapters need the same processes,
state, and cleanup, not for a single integration.

### 2. Use one contract for model and interface

A mini-app calls declared actor functions through `context.capabilities.call`. The backend
connects them to existing run functions or domain operations, and a model can perform the same
action. Shared state stays on the server and both paths receive a projection. Credentials and
external query logic belong in the backend. Define input, result, and errors before presentation.
Share schemas where data crosses layers, or verify agreement at the integration boundary. Store
large results and technical cursors with their owner. Models pass understandable references
instead of copying IDs, cursors, or file contents from prior output. Include every context field
needed for the next decision in the result contract.

### 3. Put deterministic work in code and judgment in models

Initialization, querying, validation, storage, and displaying current state are deterministic;
run scripts and functions should perform them directly. Prompting a model to "open the service
first" does not guarantee readiness when the app appears. Required preparation belongs in an
actual setup call. Independent steps can run in parallel; dependencies stay explicitly ordered.
A narrow transformation can use one model request inside a plugin function when no history or
tool loop is needed, but output, timeout, cancellation, uncertainty, and valid empty results need
a verifiable contract. This is a plugin implementation choice, not a replacement for actors.
Use fixed filters only when the domain is equally constrained; if the target already has a read
query language, prefer that contract with shared validation. A separate worker is valuable for a
separate task or context. Configure model and reasoning level for the task and validate them
against the runtime catalog; reusable workflows should not hard-code model names or uniformly
high reasoning.

### 4. Compose prompts by responsibility

A role prompt defines the goal, responsibility, handoffs, and completion criteria. Capability
rules belong to the providing plugin and bind to its actual functions. Short introductory notes
can load initially; detailed contracts and chapters are fetched through `typescript_api` when
needed. Duplicated domain chapters drift and enlarge every turn. Verify composed instructions for
every role, including scripted coordinators and workers. A path in a prompt grants neither read
access nor tools. Remove repetition while preserving responsibilities, boundaries, and sources.

### 5. Build lifecycle into the capability

Starting, loading, ready, failed, and stopped are distinct states. A visible tab or living
process does not prove domain readiness. Report success only after confirmation from the
responsible system, and keep status queries responsive during long startup. Concurrent starts of
the same resource should share one initialization. Stops or task changes invalidate late results.
Propagate cancellation, bound local waiting, and clean up at the owner on run stop, deletion, or
host shutdown. Define what survives restart and what must reopen. Startup failures need a cause
and an explicit retry path; diagnostics must not hide them by silently starting again.

### 6. Present activity and results separately

The runtime knows whether an actor is working; a domain report says what it last worked on.
Combine them without presenting an old report as current activity. Waiting, stopped, and failed
also need understandable presentation. A completed response or screenshot alone does not prove
a successful check. A compact status contract can expose state and work step without raw
reasoning or tool arguments. Grant diagnostic and change permissions independently from full
technical inspection and enforce them on the server. Roles belong in configuration; neutral
components check permissions, not user names.

### 7. Develop mini-apps in the actual host

The iframe constrains interaction, layout, and communication. Use shared controls and the
declared function bridge. For a dialog spanning host areas, the app signals intent through a
function and the owning web-plugin contribution opens it in the correct area. Keep applied server
state separate from unsent input. Unchanged polling responses must not overwrite drafts, and old
responses must not replace newer state. Keep loading and errors visible during actions, and retain
the last valid result after a failed request. Polling must neither overlap nor continue forever
in hidden areas. Test Enter, buttons, focus, narrow tiles, and dialogs inside the real host
iframe; a render test alone does not prove native interactions work there.

### 8. Choose evidence for what it proves

Contract tests verify inputs, state transitions, and errors. Integration tests verify real
registration, prompt composition, permissions, and the UI-to-service connection. Process tests
cover startup, concurrency, and cleanup. Browser tests exercise the mini-app inside its sandbox.
Choose layers whose behavior changed; tests should target failure risks, not restate the
implementation. Simulated model responses prove validation and error handling, not natural
interpretation quality, which needs separate model runs with representative ambiguous requests.
External connections and real projects require live acceptance. Keep test data isolated in
temporary directories and fail visibly when product connections are absent. Build affected
packages and state whether a restart or new prepared run is required.

## Implementation sequence

1. Identify the owner, domain state, and required decisions; inspect existing functions and
   reference programs.
2. Define the smallest complete contract, including errors, cancellation, and permissions.
3. Connect capability and workflow; equip only the necessary model roles and prompt chapters.
4. Add interaction and an observable lifecycle; explicitly prove startup and success.
5. Check and build the affected boundaries, then name any remaining live acceptance work.
6. Update this specification or the relevant neighboring chapter, record the reason in the
   decision log, and carry public changes into the guide.

Contract examples are in the [plugin guide](../homepage/guide-plugins.html). The guide to
[building mini-apps](../homepage/guide-programs.html) covers packages, state, and views.
<!-- /guide:plugins -->

## Befundgrundlage des Plugin-Leitfadens

Die Regeln oben übertragen beobachtete Grenzen auf Plugins. Die folgende Zuordnung
nennt ihre konkreten Belege; sie ist keine weitere Vertragsliste.

| Beobachtung | Belege im Repository | Reichweite |
| --- | --- | --- |
| Enter und Knopf scheiterten im Sandbox-Frame; lange Statusabfragen erschöpften die Bridge | `apps/web/tests/actor-view-frame.test.ts`, `plugins/ragents.actor-programs/web/ActorViewFrame.tsx` | Host-Interaktion und längere Nutzung prüfen; Einschränkung gilt für Mini-App-Iframes |

Diese Befunde begründen keine neue generische Such-, Modell- oder Polling-Plattform. Gemeinsame
Codeabstraktionen entstehen weiterhin erst bei mindestens zwei echten Nutzern.

<!-- guide:plugins -->
## Plugin contract

A plugin is a source folder named after its ID that keeps both halves and their assets together;
the built-in plugins live under `plugins/<id>/`:

```
plugins/ragents.actor-programs/
  ragents-plugin.json  ID, declared exports, and additional assets
  server/index.ts    server half and runtime-discovery entry point
  web/index.tsx      web half in its own chunk, when present
  contract.ts        import-free contract shared by both halves, when present
  prompt.hbs         assets at the plugin root, alongside prompts/, skills/,
                     run-scripts/, provision.ts
```

`server/index.ts` exports exactly one entry point:

```ts
export const plugin: PluginModule = {
  requires: ["ragents.ask"],           // optional, checked before composition
  create: (host) => ({ manifest: { id: "ragents.actor-programs" }, register: (registration) => { ... } }),
};
```

`create` receives `PluginHost` and creates the plugin instance with its manifest and registration
function. `register` then contributes functions, prompts, services, methods, channels, and other
features through the plugin-bound `PluginRegistration`.

The plugin folder name, meaning the parent of `server/`, is its ID; a different `manifest.id`
causes startup to fail. `requires` belongs in the module contract, not the manifest, preserving
one source of truth. Anything needed beyond the plugin folder is obtained through `PluginHost`,
with services addressed by tokens. There is no special external wiring, and a missing required
service is a startup error.

The server never loads this source folder. `ragents plugin build <folder>` turns it into a bundle
with exactly one entry point, `ragents-bundle.json`, and the profile names that bundle; the
built-in plugins become bundles under `bundles/<id>/` with `pnpm build:plugins`. A source folder
in the profile is a startup error that names the build command.
<!-- /guide:plugins -->

### Registrierungen des PluginHost

Der serverseitige `PluginHost` hat Registries für:

- Agent-Hooks (`host.agentRuntime`, Abschnitt Agent-Hooks), Skill-Pfade und Zielgruppen
- Vorlagen (`host.startEntries`): alles, was ein Plugin auf die Startseite legt, in EINEM
  Vertrag mit `id`, `title`, `description`, `order`, optional `guide` (Kennung eines Web-Leitfadens),
  optional `tags` (eindeutige Suchschlagworte) und dem Diskriminator `action`: `skill` trägt den
  registrierten Skillnamen, eine frei benannte `category` und den bearbeitbaren Startauftrag
  `prompt`; `script` trägt ein Run-Script-Paket (`handle`, `coordinator`, `files`, `programs`),
  das nur der Server sieht. Optional legt `fixedStartOptions` Startoptionen fest (Option-Id auf
  Wert, in einer `RUN.md` als Kopfzeile `fixed-start-options` mit einem JSON-Objekt in einer
  Zeile); ein Run über diese Vorlage läuft genau mit diesen Werten. Der Host prüft beim Start
  hart, dass jeder Skill registriert, jedes Paket vollständig und jede festgelegte Startoption
  registriert ist und ihr Wert ihrem Schema genügt; das Web prüft, dass ein aktives Plugin den
  Leitfaden liefert.
  Ein Produkt-Plugin liest zusätzlich `SKILLS_DIR` ein, sodass lokale Skills samt Vorlage
  ohne Code und ohne Frontend-Build entstehen
- typisierte Run-Funktionen (`host.functions`) mit optionaler nativer Werkzeugdarstellung
- benannte Fachoperationen mit Eingabeschema, Operator-Policy und gemeinsamer Ausführung für
  mehrere Oberflächen
- Rollen und Promptteile
- Methoden und Kanäle der Nachrichtenschicht (`host.methods`, `host.channels`, Abschnitt
  Nachrichtenschicht) sowie Auslieferungsrouten (`host.http`) für Dateien und Frames
- öffentliche Client-Konfiguration; darüber publizieren die Produkt-Plugins auch
  die globale Chat-Display-Policy (`chatSteps` aus `CHAT_STEPS_MODE_COORDINATOR/_AGENTS`,
  `_VISIBLE`, `_EXPANDABLE`, `_SELECTABLE`), die das Web als at-most-one-Beitrag
  `chatDisplayPolicy` an alle Schritt-Render-Stellen durchreicht; gibt das Produkt sie frei,
  schaltet der Benutzer den Detailgrad je Chat selbst um. Die Browserpräferenz ist nach Run,
  Actor und Anzeigeort getrennt: Kachel, Seiteninspector und Popout desselben Chats
  merken sich je einen eigenen Detailgrad. Andere Actors und Runs bleiben unverändert. Die Rollenwerte der Policy sind nur Vorgaben; ohne Produktvorgabe gilt für Koordinator,
  Agenten und den globalen Koordinator `grouped`
- typisierte Dienste und namespaced Storage
- namespaced Run-Metadaten
- Startoptionen (`host.startOptions`): Werte, die der Benutzer auf der Startseite wählt und die beim
  Start eines Runs als Plugin-Zustand ins Journal eingefroren werden. Eine Option nennt Schema,
  Standardwert, `selectable`, `accept` (prüft und normalisiert einen Wert oder wirft) und `describe`
  (Darstellung für das Web). Der Host hält den Wert je noch nicht gestartetem Run über
  `ragents.startOptions.list` und `ragents.startOptions.select`, schreibt beim Start jeden Wert als initialen
  Plugin-Zustand unter der Option-Id und sperrt danach. Jeder Aufruf bekommt im
  `StartOptionContext` neben dem Run den handelnden Benutzer (`userId`, aus dem Zugang der
  jeweiligen Anfrage, ohne Anmeldung `null`): Liste und Wahl den Benutzer der Anfrage, die beim
  Start geschriebenen Vorgaben den Benutzer, der den Run anlegt; gemerkt wird er nirgends.
  Optional erklärt `ownerOnly(value)`, dass einen Run mit diesem gespeicherten Wert nur sein
  Eigentümer bedient ([profiles.md](profiles.md), Benutzerrechte). Optional nennt `rights` Rechte, die über
  `runs.create` hinaus nötig sind, etwa `runs.inspect` für eine Option, deren Darstellung
  technische Einsicht gibt: Ohne sie fehlt die Option in der Liste, die Wahl (auch über `options`
  von `ragents.overseer.createRun`) scheitert mit `access-denied` (403), und beim Start gilt ihr
  Standardwert oder der Wert der Vorlage. Startet ein Run über eine
  Vorlage, die Startoptionen festlegt, gilt deren Wert statt Wahl und Vorgabe: `accept` nimmt
  ihn mit dem Benutzer an, der startet, und eine vorher abweichend gewählte Belegung, bei einem
  schon angelegten Run ein anderer gespeicherter Wert, ist der Fehler `start-option-fixed` (409)
  mit Vorlage und Option in der Meldung; still überschrieben wird nichts. Jeder Zustand der Liste nennt
  mit `chosen`, ob vor dem Start jemand den Wert gewählt hat (eine Vorgabe ist keine Wahl); damit
  zeigt der Vorbereitungschat den Widerspruch schon vor dem Start (`conflictingStartOptions` in
  `apps/web/src/StartOptions.tsx`), sperrt "Run erstellen" und bietet an, die Werte der Vorlage zu
  übernehmen. Das geschieht an einer
  Stelle in `RunChatSession` für jeden Weg mit Vorlage: `ragents.chat.start` (Run-Script, auch
  aus `pnpm driver`, `ragents run --entry` und `ragents.overseer.createRun` mit `script`) und
  `ragents.chat.send` mit `entry` (Skill-Vorlage, erste Nachricht aus Vorbereitungschat oder
  Startseite). Der Kern kennt dabei nur "diese Vorlage legt diese Option auf diesen Wert fest".
  Modell- und Systemprompt-Wahl sind die
  Startoptionen `ragents.model` und `ragents.system-prompt` des Produkt-Plugins
  (`plugin-support/product-start-options.ts`), der Arbeitsbereich ist die Startoption
  `ragents.workspace.binding` des Workspace-Plugins; der Engine-Kern liest nur den
  Systemprompt-Zustand für die Promptkomposition
- Initialisierung, Run-Vorbereitung, Stopp, Löschen und Shutdown

Ein Plugin implementiert nur die Facetten, die es braucht:

```typescript
const documentsPlugin: RAgentsPlugin = {
  manifest: { id: "ragents.documents" },
  register: (host) => {
    host.provide(documentStoreToken, store)
    host.config(...ragentsDocumentsConfigDescriptors)
    host.functions(createDocumentToolContributor(filesFor))
    host.prompts(documentPrompt)
    host.methods(createFilesMethod(files))
    host.http(createFileContentRoute(files))
  },
}
```

Ein Agent-Hook allein wäre als System-Plugin zu klein. TypeScript-Actors rufen kein Modell auf,
und Tabs, Methoden oder Projektionen sind hostweit. Das Plugin bündelt diese Facetten, während
seine optionalen Agent-Hooks genau in die Modellaufrufe der Agenten eingreifen.

### Agent-Hooks

`host.agentRuntime(...contributions)` nimmt Beiträge mit einer Kennung und mindestens einem von
zwei Hooks; einer ohne Hook ist ein Registrierungsfehler. Beide bekommen zuerst den Agenten
(`AgentContributionContext`: Run, Agent, Audience, Arbeitsverzeichnis) und laufen für jeden
Agenten außer dem globalen Koordinator:

- `beforeModelCall(agent, call)` vor jedem Modellaufruf eines Turns. Ein zurückgegebener Text
  erreicht das Modell als verborgener Hinweis hinter dem Gesprächsverlauf, nur für diesen Aufruf;
  der Chat zeigt ihn nicht, das Journal nennt ihn nicht. `call.kept` ist der JSON-Wert, den dieser
  Beitrag zuletzt mit `call.keep(value)` im Gesprächsverlauf des Agenten abgelegt hat, auch nach
  einem Neustart des Hosts; das Modell sieht ihn nie.
- `afterToolCall(agent, outcome, call)` nach jedem Werkzeugaufruf mit dessen Namen und ob er
  scheiterte. Ein zurückgegebenes Ergebnis aus Text- und Bildteilen ersetzt, was das Modell von
  dem Aufruf sieht; `isError` markiert es als Fehler.

Beide sehen `call.signal` des laufenden Aufrufs und `call.modelReadsImages`. Nutzer sind die
Projektprüfung der Actor-Programme (Hinweis bei neuen oder behobenen Fehlern, Stand in
`call.kept`) und die Bildanzeige des Browsers (ersetzt das Ergebnis von `browser_view_screenshot`
durch die Aufnahme). Ein Beitrag registriert keine Werkzeuge, die kommen über `host.functions`.
Die Engine übersetzt jeden Beitrag in genau eine Erweiterung der Agentenlaufzeit, benannt nach
seiner Kennung (`packages/ragents/src/drivers/agent-hooks.ts`); die Einstellungen zeigen ihn so.

<!-- guide:plugins -->
## Provide functions

A plugin registers functions with `defineRunFunction` and `host.functions`, including a
short `description`, optional `longDescription`, input and result schemas, and implementation.
`label` is the human-readable name. The host derives `context.functions.<name>(input)` signatures
from this data. Snippets and actor programs use the same catalog and execution. Availability and
bound identity apply equally, while a program's `capabilities` limit its installed build.

Every domain function is available through `context.functions` in `typescript_eval`.
`nativeTool: true` additionally exposes it as a native model tool when the model normally must
read its result before taking the next step: browser interactions, domain reports and status,
language diagnostics, `read`, `edit`, `write`, `bash`, `document_write`, `show_document`, and
`browser_view_screenshot`, which can return image pixels only natively. Snippets remain the right
form for calls that combine, filter, or pass results onward, including data queries, management
functions, list results, and values passed from earlier responses without transcription. Native
tools remain callable from snippets. The building-block reference marks them in the catalog and
the system overview calls them direct tools.

The server registers `typescript_api` and `typescript_eval` as native foundation independent of
plugins. Models use them to discover functions and execute TypeScript snippets. The optional
actor-program plugin adds persistent programs and views; removing it does not remove snippets or
other plugin functions. A named `typescript_api` request returns exact declarations, long
descriptions, and attached guidance; list and search return short descriptions. Catalog and
signatures come from the live registry, with no second hand-maintained capability list.

Model-facing functions return compact results. Lists and large structures appear only on
explicit request and in reduced form; mini-apps obtain complete state through their own
operations. Observers create an ActorInput only when something changes and name that change;
unchanged intermediate states create no model turn. `ragents.watch` provides neutral watchers
whose wake condition is a TypeScript function body, evaluated without a model.

For a closed input object (`additionalProperties: false`), the engine removes unknown top-level
fields before a native tool runs, records them as `ignoredFields` in `tool.call.started`, and
mentions them in the result. Open schemas pass all fields through. Missing required fields,
wrong types, and unknown fields in nested objects remain errors. Field semantics belong in
TypeBox property descriptions, which appear as comments in generated declarations. Function
descriptions do not name fields. The description-drift test verifies this across all registered
contracts.

Activating, replacing, or removing dynamic actor functions changes the API during a running
turn. Every equipped LLM actor automatically receives names and short descriptions for the
functions available to it, including subagents and the global coordinator. The overview updates
after API changes; schemas and long descriptions stay on demand. Resolution, overview, catalog,
type checking, and execution all use the same current set. `tools: []` leaves an LLM without run
or workspace access and without a function overview. Named selection and grants constrain
availability; choosing a snippet or actor program creates neither a second implementation nor
additional permissions.
<!-- /guide:plugins -->

### Promptbeiträge und Orchestrierungsanleitung

Bereits gespeicherte `actor.tools.opened`-Ereignisse bleiben als historische
Journalinformationen lesbar; sie steuern keine Funktionsverfügbarkeit mehr. Neue
Öffnungsbefehle gibt es nicht.

Promptbeiträge unterscheiden über `delivery` zwischen `initial` und `on-demand`. Ohne Angabe
gilt `initial`; der Helfer `boundToTools` setzt werkzeuggebundene Beiträge standardmäßig auf
`on-demand`. Kurze Hinweise können ausdrücklich initial bleiben, etwa die Mini-App-Einführung,
der Dokumenthinweis und die Regeln des Arbeitsbereichs. Die Bindung prüft die tatsächlich verfügbaren Funktionen. Worker erhalten ebenfalls passende gebundene Initialhinweise.
Lange Detailkapitel werden nur auf Anfrage gerendert und nicht in spätere Systemprompts
übernommen. Die Actor-SDK-Typen verwenden die aktuellen Funktionsverträge; die endgültige Buildprüfung
grenzt sie anhand des Programms und seines Actors ein.
Mini-Apps liefern ihre vollständige Anleitung separat über `actor_program_controls` mit `topic: "guide"`.

Die Orchestrierungsanleitung verlangt, Aufträge standardmäßig selbst auszuführen. Mehrere
Sprachen, Dateien oder Schritte allein rechtfertigen keine zusätzlichen Actors. Delegation
setzt einen konkreten Nutzen einer getrennten Rolle, eines eigenen Kontexts oder einer
unabhängigen Teilaufgabe voraus, oder einen ausdrücklichen Wunsch nach weiteren Beteiligten.
Auch bei mehrphasiger Arbeit sind die tatsächlichen Arbeitsschritte auszuführen und ihre
Ergebnisse zu prüfen; Vorstellungen, Ratschläge und Rollenspiele erfüllen keinen Bau- oder
Prüfauftrag. Die Werkzeugauswahl richtet sich nach der Aufgabe: `tools: []` passt nur, wenn
der mitgelieferte Text ausreicht. Ein Experte oder Kritiker, der Dateien prüfen, Diagnosen
verifizieren oder Code ändern soll, benötigt die passenden Werkzeuge.

Die Orchestrierungsanleitung verlangt nach angelegter Subscription und erteiltem Auftrag das
Ende des Turns ohne bloße Wartemeldung. Substanzielle Ergebnisse und tatsächliche Phasenwechsel
werden weiterhin knapp berichtet. Deterministische Aufgaben mit dauerhaftem Zustand werden
ausdrücklich neben Routing als Einsatz für TypeScript-Actors genannt.

### Web-Hälften zur Laufzeit

Das Web des Hosts ist für jedes Profil dasselbe; die Web-Hälften kommen zur Laufzeit als Bundles
vom Server, genau die des Profils. Die Methode `ragents.plugins.bootstrap` liefert in der
Reihenfolge der Pluginliste je Plugin Kennung, öffentliche Konfiguration und bei einer Web-Hälfte
deren Adressen (`web.entry`, mit eigenem CSS auch `web.css`, beide unter `/plugins/<id>/web/`),
dazu die Vorlagen (`startEntries`) und `defaultStartEntry`, wenn die Profildatei eine
Default-Vorlage nennt und der Benutzer sie starten darf (`profiles.md`); eine Script-Vorlage trägt
dort nur `action`, `coordinator` und die Anzeigetexte, nie ihre Quelle. Beide Einsprungpunkte des Webs
(`main.tsx`, `run-panel.tsx`) legen vor dem ersten Bundle jedes Modul der Web-Liste der Host-API in
das Register `globalThis.__ragentsHostModules` (`apps/web/src/host-modules.ts`); die Shims der
Bundles lesen daraus, so teilen Host und Plugins ein React und jeden Kontext. Der Web-Host lädt
jeden Einsprungpunkt mit `import(url)` und verlinkt dessen CSS hinter dem des Hosts. Eine Web-Hälfte, die
nicht lädt oder kein `webPlugin` mit ihrer Kennung exportiert, reißt die Oberfläche nicht mit: sie
erscheint als Plugin-Fehler mit Kennung, Adresse und Ursache über der Oberfläche
(`PluginFailureNotice`), das Plugin behält seinen Platz in der Liste ohne Web-Beiträge, und seine
Server-Seite bleibt nutzbar. Nur wenn danach kein Plugin mehr ein Branding liefert, gibt es keine
Oberfläche; die Meldung nennt dann auch die gescheiterten Web-Hälften. Bundle und Host passen über
die Nummer der Host-API und die benutzten Namen zusammen, nicht über einen gemeinsamen Build
(Abschnitt Bundle, Bauwerkzeug und Host-API).

Öffentliche Plugin-Konfiguration steuert auch die tatsächlich aktiven Web-Beiträge. Ein
installiertes, aber für die aktuelle Konfiguration deaktiviertes Plugin bleibt für den Listenabgleich
im Profil, liefert jedoch weder Provider noch Tabs oder Presenter, und seine Vorlagen fallen weg. So verschwindet
ein Fachplugin in einer Installation ohne seine Voraussetzungen gemeinsam mit seinen serverseitigen Beiträgen.

### Transkript eines Actors

`ragents.transcript` ist ein reines Funktionsplugin ohne Web-Hälfte: `actor_transcript` liefert
den Verlauf eines Actors dieses Runs als kompaktes Transkript aus dem Journal, für Agenten und
TypeScript-Actors mit `event.subscribe`. Eingaben, Antworttexte und Werkzeugaufrufe stehen je auf
einer Zeile, Werkzeugeingaben und -ergebnisse werden auf 200 und 300 Zeichen gekürzt, Reasoning
entfällt; bei Überschreitung der Zeichengrenze (Vorgabe 20000) entfallen die ältesten Zeilen
zuerst mit einer sichtbaren Auslassungsmarke. Gedacht für Übergaben, Statusberichte des
Koordinators und Zusammenfassungen; es ersetzt keinen Fork und keine Kompaktierung und wird
nicht in den Reviewstand des Regelreviews aufgenommen, damit Reviewer den Code prüfen und nicht
die Erzählung des Implementierers.

## Zuständigkeit je Facette

Jeder Plugin-Ordner besitzt die zu seiner Fähigkeit gehörenden Assets und Beiträge; ein rein
serverseitiges Plugin braucht keinen leeren Web-Ordner. Nicht jedes Plugin braucht jede Facette,
aber eine vorhandene Facette bleibt bei ihrem Besitzer:

| Facette                   | Besitzer                                                                  |
| ------------------------- | ------------------------------------------------------------------------- |
| Prompt                    | `.hbs` beim Server-Plugin, das die Regel oder Fähigkeit liefert           |
| Skill                     | `skills/<name>/SKILL.md` beim besitzenden Plugin, inklusive Zielgruppe und optionalem Startauftrag |
| Run-Script                | `run-scripts/<name>/` beim Plugin, dessen Fähigkeit der Run vorführt      |
| Auswählbarer Systemprompt | `prompts/<name>.md` oder `.hbs` beim Produkt-Plugin                       |
| API                       | Verträge im `contract.ts`, Methoden im Server-Plugin, `rpc.call` im Web-Plugin |
| UI und CSS                | Komponenten und Styles im passenden Web-Plugin                            |
| Konfiguration             | Deklaration und Auswertung im passenden Server-Plugin                     |
| Storage                   | `host.storage`, immer unter `plugins/<plugin-id>`                         |
| Lebenszyklus              | Start, Run-Vorbereitung, Löschen und Shutdown beim Besitzer               |
| Provisionierung           | `provision.ts` im Plugin-Ordner, im Bundle ein Export von `server/index.js`; Werkzeuge in `<Datenordner>/tools/<plugin-id>/` |

Die drei Asset-Ordner `skills/`, `run-scripts/` und `prompts/` liest der Host per KONVENTION aus
dem Bundle-Ordner jedes komponierten Plugins (`pluginFolder(id)` in
`plugin-support/plugin-folder.ts`, angewandt in `profile/compose.ts`). Ein fehlender Asset-Ordner ist kein Fehler; ein vorhandener mit kaputtem
Inhalt bleibt ein harter Fehler. Meldet ein Plugin dieselbe Vorlage oder denselben Skill-Pfad
zusätzlich ausdrücklich an - etwa weil es dabei eine Zielgruppe setzt -, gewinnt die
ausdrückliche Anmeldung und der Konventionsbeitrag entfällt.
Assets und Code kommen aus demselben Bundle-Ordner, der den Quellordner spiegelt, sodass ein
Plugin vollständig in seinem Verzeichnis lebt.

Es gibt deshalb keine zentrale Sammlung für Produktprompts, Skills oder Plugin-Konfiguration.
Das Entfernen eines Fachplugins entfernt Prompt, Werkzeuge, Projektion, Methoden, Kanäle, Auslieferung,
Konfiguration, Web-Tab, CSS und Run-Datenzugriff als eine Fähigkeit. Bereits
persistierte Daten werden dadurch nicht stillschweigend gelöscht. Generische Hilfen für das Laden
eines Assets oder das Registrieren eines Prompts bleiben wiederverwendbare Host-Komponenten und
besitzen keine Produktfachlichkeit.

`ProductRuntime` und `WorkspaceRuntime` verhindern umgekehrt, dass der neutrale Host Produktwissen
benötigt. Das Produkt-Plugin liefert Koordinator-Descriptor, Standardprofil, Anzeige und den
Rollenvertrag. Das Workspace-Plugin löst den Arbeitsbereich je Run auf und beschreibt seinen
Modus. `ragents.workspace` liest die Bindung des Runs aus der Startoption
`ragents.workspace.binding` (Abschnitt Arbeitsbereich, Sandbox-Werkzeuge und Prozesse). Für einen
neuen Ordner je Run auf dem Server legt es je Run ein leeres Verzeichnis unter der
Run-Ablage an; den Inhalt oder ein anderes `cwd` liefert dafür optional ein Plugin über
`workspaceResolverToken` (`resolve({ runId, directory, choice, emitSystem })`). Meldet der Resolver
eine `optionId`, liest `ragents.workspace` die Wahl des Benutzers aus dem Journal und reicht sie als
`choice` durch.

Ein Beitrag darf eine eigene **Art** von Arbeitsbereich mitbringen, ohne den Arbeitsbereich zu
übernehmen: `WorkspaceResolver.kind` nennt `id` (woran ein Ablauf sie erkennt), `label` (wie die
Startoption und die Run-Metadaten sie nennen), `serverFolders` (ob daneben ein Ordner des
Serverrechners gebunden werden darf) und optional `directoryPattern` für die Anzeige in den
Einstellungen. Die Art besetzt den neuen Ordner je Run auf dem Server: Startoption und Auswahl zeigen
statt "Leerer Ordner je Run" ihr `label`, und ein vorhandener Ordner des Servers wird ohne
`serverFolders` mit `workspace-binding-unsupported` (400) abgelehnt. `WorkspaceRuntime.placementOf(runId)`
beantwortet je Run getrennt, wo er arbeitet (`machine`: `server` oder `client`) und in welchem Ordner
(`folder`: `fresh` oder `existing`), dazu mit `kind` die `id` der Art, wenn ein Beitrag den neuen
Ordner gestellt hat. Das ist die eine Stelle, an der ein Ablauf zentral fragt, wo und worin ein Run
arbeitet; einen Mischwert aus beidem gibt es nicht. Meldet ein Beitrag eine Art, legt `ragents.workspace`
für ihn kein eigenes Verzeichnis an; er bringt seines selbst mit. Die Auflösung liefert dann alles,
was `SessionWorkspace` kennt: neben `cwd` auch `description`, `gitEnv`, `gitConfig`, `extraEnv`,
`currentRoot`, `runOperation`, `hostSandbox` (Heimatordner, nur lesbare
Wurzeln und mit `ident` das Konto, unter dem die Sandbox ausführt) und `sandboxFolders` (Ordner
außerhalb des Arbeitsbereichs, die die Prozess-Sandbox des Runs zulässt, Abschnitt Prozess-Sandbox
des Servers). Beenden und Löschen eines Runs
gehen mit: `stopSession(runId, sandbox)` legt den Stopp des Beitrags um den Stopp der Sandbox des
Hosts, `deleteSession(runId)` räumt danach weg, was `resolve` angelegt hat. Beide gelten nur für
Runs mit einem neuen Ordner auf dem Server; einen Run auf einem Arbeitsplatz räumt allein der Host
auf.

Den neuen Ordner je Run auf einem Arbeitsplatz legt dessen Executor an (Abschnitt Arbeitsbereich,
Sandbox-Werkzeuge und Prozesse). Ohne Beitrag bleibt er leer. Mit einem Beitrag gibt es ihn dort nur,
wenn der Beitrag ihn mit `WorkspaceResolver.workstation` ausdrücklich stellt, sonst lehnt die
Startoption ihn mit `workspace-binding-unsupported` ab: der Beitrag besetzt den neuen Ordner, und
ein leerer an seiner Stelle wäre ein stiller Ersatz. `workstation` nennt `label` (Kurzform für
Startoption und Run-Metadaten), `prepare` und optional `release` und `description`. `prepare` und
`release` bekommen `runId`, den Pfad des Ordners auf dem Arbeitsplatz, dessen Label und die Wahl
aus `optionId` und liefern Schritte: Operationen des Executors dort samt Eingabe, etwa
`commands.run` mit `git worktree add` in einem angebotenen Repository. Code läuft dafür nicht auf
dem Arbeitsplatz; ein Beitrag kann nur benutzen, was jeder Executor kann. Die Schritte von
`prepare` laufen einmal, direkt nachdem der Executor den Ordner angelegt hat; die von `release` vor
dem Wegräumen beim Löschen des Runs.

Vor dem Start des Runs gibt es kein Arbeitsverzeichnis (Fehler `run-not-started`, Status 409), und die
Auflösung muss für dieselbe Bindung deterministisch sein, weil die Agentenlaufzeit nach einem
Neustart dasselbe Arbeitsverzeichnis erwartet. Der Host ruft die Auflösung erst nach dem Anlegen des
Runs auf, damit die Startoptionen im Journal stehen; der Scheduler bekommt das `cwd` je Run über den
Provider-Cache und reicht es der Agentenlaufzeit als Arbeitsverzeichnis der Werkzeuge weiter; ihren
eigenen Ordner bekommt sie getrennt davon (`core.md`, Systemprompt). Neben dem `cwd` liefert die
Auflösung mit `SessionWorkspace.description` einen Text, der den aufgelösten Arbeitsbereich
beschreibt; er wird Kapitel im Systemprompt jedes Actors mit Arbeitsbereichswerkzeugen (Abschnitt
Systemprompt in `core.md`). `ragents.workspace` formuliert ihn je Bindung: ein vorhandener Ordner
auf dem Server heißt Projektordner auf dem Serverrechner, einer auf einem Arbeitsplatz Projektordner
dort samt dessen Namen; der neue Ordner auf dem Server ist der private, zunächst leere Ordner des
Runs mit dem Pfad, den der Resolver geliefert hat, der neue auf einem Arbeitsplatz derselbe
dort, mit `workstation.description` des Beitrags an seiner Stelle. Hat der Server Wurzeln mit
Alias (`WorkspaceSandboxHost.serverRoots()`: die registrierten und `@skills`), hängt
`ragents.workspace` an jede dieser Beschreibungen einen Absatz über sie, je Bindung: auf dem Server
nennt er die Aliasse mit Zugriff, dass Dateiwerkzeuge und Sprachserver einen Pfad mit Alias nehmen,
dass `bash` darin mit dem Pfad als `cwd` läuft und welche Variablen `bash` dafür hat; auf einem
Arbeitsplatz nennt er dieselben Aliasse als Wurzeln des Servers, die Dateiwerkzeuge und Sprachserver
auch von dort erreichen, dass `bash` dort läuft und nur mit einem Alias als `cwd` auf dem Server,
dass nur diese Bash die Variablen hat, und dass ein Aufruf nur einen Rechner erreicht. Kein anderer
Promptbeitrag und keine Werkzeugbeschreibung nennt eine solche Variable, nur den Alias. Die
Chat-Systemnotiz beim Auflösen bleibt daneben der Hinweis für den Benutzer.

Die Dateiablage ist ein eigener Dienst: `ragents.documents` stellt `documentStoreToken`
(`directoryFor(runId)`) bereit, standardmäßig unter `host.storage.session(runId, "documents")`,
mit `DOCUMENTS_DIR` als Unterordner je Run unter einem externen Pfad. Die Ablage liegt nicht im Arbeitsbereich und ist
kein Bash-Pfad: `document_write` (`path` in der Ablage plus `content`) ist der einzige Weg hinein.
Eine Datei des Arbeitsbereichs kommt über `read` und dann `content` hinein; eine Kopie über die
Modellausgabe des `read`-Werkzeugs wäre bei großen Dateien gekürzt. Je Thema entsteht darin ein Unterverzeichnis, `ragents.documents` zeigt es im
Dokumente-Tab an.
Actor-Programme verwenden einen eigenen privaten pnpm-Workspace unter ihrer Run-Ablage.
Seine `actors/`-Sammlung ist eine Wurzel des Servers mit dem Alias `@actors`
(`registerWorkspaceRoot`): Dateiwerkzeuge und Language Server erreichen sie in jeder Bindung über
den Alias und laufen dafür beim Executor des Servers, eine Bash mit `@actors/...` als `cwd` ebenso,
und nur dort gibt es `RAGENTS_ACTORS_DIR` (Abschnitt Arbeitsbereich, Sandbox-Werkzeuge und
Prozesse). Den Alias `@skills` hält der Host für die Skill-Ordner frei. Die Autorisierung und
Auflösung dieser Plugin-Arbeitsbereiche erfolgt über den gemeinsamen Workspace-Vertrag;
das Modell muss keine privaten Speicherpfade aus Antworten übertragen.
Weitere Plugins konsumieren die Workspace-Dienste über typisierte Tokens.

`show_document` öffnet eine Dokumentanzeige aus den protokollierten Werkzeugargumenten oder
einer Datei der Ablage. Wie `document_write` ist es ein natives Modellwerkzeug, damit eine
Anzeige eine Runde kostet und nicht drei. Es veröffentlicht kein Core-Artefakt: `RunView.artifacts` bleibt dabei
unverändert. Unveränderliche, versionierbare Run-Ergebnisse entstehen über `artifact_publish`;
die Dokumente-Ansicht führt diese Ergebnisse zusätzlich zu Dateien und Anzeigen auf.
Die Dokumentknöpfe im primären Chat und in den Actor-Gesprächen der Kacheln sowie in den
Actor-Pop-outs verwenden denselben registrierten Tool-Presenter und öffnen die Dokumente-Ansicht.
Deren Chat-Sammlung berücksichtigt alle geladenen Actor-Verläufe und führt denselben
Werkzeugaufruf aus Hauptverlauf und Actor-Verlauf nur einmal auf.

`ProductRuntime` und `WorkspaceRuntime` sind Pflichtverträge jedes Profils: fehlt einer der beiden
Dienste, bricht der Server beim Start mit einer klaren Fehlermeldung ab, statt in einem halben
Zustand zu laufen. Das ist eine dokumentierte Ausnahme vom ENTFERNUNGSTEST - das jeweilige Plugin
ist nicht optional, sondern Teil des Vertrags zwischen Profil und Engine. Der Logik-Beitrag ist
dagegen optional: ohne `ragents.orchestration` startet der Server, und ein TypeScript-Actor findet
zur Laufzeit keinen Treiber.

Run-Metadaten sind ebenfalls Beiträge. Der Server sammelt sie je Run unter der Plugin-ID, das
Web rendert die passende Darstellung aus seiner Registry. Ein Workspace-Plugin liefert so
zum Beispiel den Branch für Run-Liste und Chat, ohne dass der Core
Git-Fachlogik kennt. Die Run-Liste fragt Beiträge nur für die Runs ab, die der Aufrufer sehen darf,
für alle Runs und Beiträge zugleich, und wartet je Beitrag höchstens `SESSION_METADATA_TIMEOUT_MS`
(1,5 s, `apps/server/src/provider.ts`). Wer bis dahin nicht antwortet oder scheitert, verliert nur
seinen Wert: er fehlt unter `metadata` und steht mit dem Grund unter `metadataUnavailable` des Runs,
die Liste selbst kommt. Weil jeder Client die Liste alle paar Sekunden abfragt, hält ein Beitrag mit
teurer Arbeit (etwa ein Aufruf beim Executor eines Runs) selbst einen kurzlebigen Zwischenstand.
Ein Beitrag, der den Arbeitsbereich des Runs erreicht, erklärt das mit `requiresWorkspace: true`.
Der Host ruft ihn nur für Runs, deren Arbeitsbereich der Aufrufer erreichen darf (dieselbe Regel wie
`workspaceGuardToken`); sonst steht er ohne Aufruf mit dem Grund unter `metadataUnavailable`. Eine
Liste ohne Aufrufer (hostintern) erreicht keinen Arbeitsbereich eines `ownerOnly`-Runs. Je Run
meldet die Liste dazu `workspaceAccessible`, das generische Signal für die Oberflächen.

Speicherpfade sind reine Konvention und nicht deklarierbar: `host.storage.root(...)` liegt unter
`${DATA_DIR}/plugins/<plugin-id>/`, `host.storage.session(runId, ...)` unter
`${DATA_DIR}/sessions/<runId>/plugins/<plugin-id>/`. Ein Plugin bekommt diese Pfade nur über
`host.storage` und kennt kein rohes `DATA_DIR`. Ein Workspace-Plugin legt darunter zum Beispiel
UID-Zuordnung und Git-Infrastruktur ab, ein Build-Plugin seine Caches und Zugangskonfiguration -
jedes unter seinem eigenen Wurzelverzeichnis, ohne gemeinsamen Ordner und ohne Querverweis.

<!-- guide:plugins -->
## Build and ship a plugin

A plugin written outside this repository takes the same path as a built-in one. The host never
loads plugin sources; it loads finished bundles, and the author builds them. The npm package
`@schlenkr/ragents` carries everything this needs, so an empty folder and the package are enough.

**Source folder.** One folder per plugin, named after its ID, such as `acme.tickets`. It holds
`ragents-plugin.json`, `server/index.ts` exporting `plugin`, optionally `provision.ts` for tools the
plugin installs, `web/index.tsx` exporting `webPlugin` when there is an interface, and assets such
as `prompt.hbs`, `prompts/`, `skills/`, and `run-scripts/` at the root. `ragents-plugin.json`
names the ID, the files other plugins may import (per half, as paths without extension), and
additional assets that go into the bundle:

```json
{ "id": "acme.tickets", "exports": { "server": ["server/contract"], "web": ["contract"] }, "assets": ["templates"] }
```

**Imports.** Host code comes only from the modules of the host API list in
`apps/server/src/host-api.ts`: `@ragents/engine`, `@ragents/host/...`, `@ragents/web/...`,
`react`, `typebox`, and the other entries there. From a host module a plugin imports only the
values the list names; types are free. A library such as `react` or `typebox` counts whole. The
agent runtime behind the host (`@ragents/agent`, `@ragents/ai`) is not part of it: hooks into an
agent's model calls come through `host.agentRuntime`, a single question to a model through
`openRouterCompletionModel` from `@ragents/host/plugin-support/model-completion`, and the
built-in model catalog of a provider through `builtinCatalog` from
`@ragents/host/plugin-support/model-choice`. Another plugin is reachable only through its
declared exports as `@ragents/plugins/<id>/<export>`, and only if its ID is in `requires`; plugins
of the same repository may keep relative imports of such exports. A host module is imported
statically, by name or as a namespace read by name, so that the build checks every name; `import()`
of a host module is a build error. Any other library, such as `lucide-react`, is bundled into the
plugin, CommonJS libraries that `require` Node modules included. A plugin finds its own files with
`pluginFolder(id)` and `pluginAsset(id, name)`, never through `import.meta.url`, `__dirname`, or
`createRequire`.

**Build.** `ragents plugin build <folder...>` type-checks the plugins and writes one bundle per
folder to `./dist/plugins/<id>`; `--out <folder>` changes the target, and `--watch` rebuilds after
every change without type checks, reading `ragents-plugin.json`, entries, and assets afresh each
time. Each broken rule is a build error with file, line, and cause, and nothing is written for a
plugin that fails. An existing bundle is updated file by file, so a running host never loses its
folder, and parallel builds into the same folder wait for each other. For editor support, a project can extend
`apps/server/tsconfig.plugin.json` and `apps/web/tsconfig.plugin.json` of the host.

**Start.** The profile names the bundle by a path relative to the profile file, next to built-in
plugins named by ID:

```ts
PLUGINS: ["ragents.orchestration", "ragents.workspace", "ragents.product", "./dist/plugins/<id>"],
```

`ragents start <path-to-profile>` starts it. A changed server half needs a restart, a changed web
half only a page reload, new Tailwind classes included. A source folder in the profile stops the
start and names the build command. The host does not check whether a bundle still matches its
sources, so build before starting and before tests.

**Versions.** A bundle records the number of the host API it was built against and every name of
the host API it uses. A host with a different number refuses the bundle and asks for a rebuild, and
so does a host with the same number that lacks one of the names, as an older host may. The number
changes only when the host API changes incompatibly, not with every host release.

**Ship.** A bundle is a plain folder without `node_modules` or native binaries and runs wherever a
host offers the same host API with the names it uses. Native tools such as language servers come through the plugin's
provisioning. To hand a profile together with its bundles to other machines, a server adds
`ragents.profile-distribution`; `ragents connect` fetches the profile and its bundles and starts
them with the local host ([Distributed work](../homepage/guide-distributed.html)). The client
profile names such bundles relative to itself (`./` or `../`); the client resolves an absolute or
`~/` path on its own machine, so the server refuses it.
<!-- /guide:plugins -->

## Bundle, Bauwerkzeug und Host-API

Der Host baut keine Plugins, weder beim Start noch sonst; er lädt nur fertige Bundles. Das gilt
für die eingebauten `ragents.*`, für Plugin-Repos neben dem Host und für jedes fremde Plugin.
Nicht betroffen sind Actor-Programme und Run-Scripts, die `ragents.actor-programs` je Run aus
Quellen übersetzt, die im Run bearbeitet werden.

**Quelle und Beschreibung.** Ein Plugin-Quellordner heißt wie seine Kennung und beschreibt sich in
`ragents-plugin.json` (`apps/server/src/plugin-build/plugin-description.ts`): `id` (gleich dem
Ordnernamen), `exports` je Hälfte (`server`, `web`) als Pfade im Plugin-Ordner ohne Endung,
importierbar als `@ragents/plugins/<id>/<pfad>`, und `assets` für Dateien oder Ordner, die neben
der Vorgabe ins Bundle kommen. Andere Felder sind ein Fehler. Die Einsprungpunkte bleiben Konvention:
`server/index.ts`, `web/index.tsx`, `provision.ts`. Quelle und Bundle haben verschiedene
Dateinamen, damit sie nie verwechselt werden.

**Bundle.** Ein Bundle ist ein Ordner, sein Name ist die Kennung, sein einziger Einsprungpunkt
`ragents-bundle.json`; es spiegelt den Quellordner, damit `pluginFolder(id)` und die
Asset-Konvention für Quelle und Bundle gleich gelten:

```
<id>/
  ragents-bundle.json    geschrieben vom Bauwerkzeug, nie von Hand
  server/index.js        ESM, exportiert plugin und optional provision
  server/exports/        deklarierte Exporte für andere Plugins
  server/chunks/         was Einsprungpunkt und Exporte teilen
  web/index.js           ESM, nur mit Web-Hälfte; Lazy-Chunks unter web/chunks/
  web/index.css          eigenes CSS der Web-Hälfte, nur wenn es welches gibt
  web/classes.json       Tailwind-Kandidaten der Web-Hälfte
  web/exports/           deklarierte Exporte für den Browser
  web/assets/            Bilder und Schriften, die der Code importiert
  prompt.hbs, prompts/, skills/, run-scripts/, ...   Assets wie im Quellordner
```

Das Manifest (`profile/bundle-manifest.ts`, `format` 3) nennt `id`, `api` (die Nummer der
Host-API, gegen die gebaut wurde), `hostNames` (je Hälfte und Modul die Namen der Host-API, die das
Bundle tatsächlich benutzt), `stand` (Hash über alle Dateien des Bundles außer dem Manifest und
`.DS_Store`), `sourceStand` (Hash über den Quellordner ohne `node_modules` und ohne das Ziel des
Baus, dazu über die Eingaben des Hosts, die jedes Bundle prägen: `host-api.ts`, `host-api.json`,
Bauwerkzeug und Beschreibungsleser, im Checkout `pnpm-lock.yaml`, im Paket dessen `package.json`),
`server`, bei einer
Web-Hälfte `web` mit `entry`, `classes` und optional `css`, `exports` je Hälfte als Zuordnung von
Exportname zu Datei, `uses` und `assets`. Exporte gibt es je Hälfte, weil eine gemeinsame Datei
(`contract.ts`) für Node und Browser getrennt gebaut wird; der Name ist derselbe, die Hälfte des
Importeurs wählt die Datei. `uses` nennt die Plugins, deren Exporte das Bundle importiert; das
Bauwerkzeug schreibt es, weil `requires` im Code steht, und der Host prüft beim Start, dass jede
Kennung daraus in der Pluginliste und in `requires` steht. Ein Bundle enthält keine
plattformabhängigen Binärdateien und kein `node_modules`, damit es auf jedem Rechner dasselbe
ist; `provision` ist ein Export von `server/index.js`, damit es keinen dritten Einsprungpunkt gibt, und
der Import eines Bundles ist deshalb nebenwirkungsfrei. `stand` prüfen alle, die ein Bundle
kopieren oder wiederverwenden: `pnpm build:package` nach dem Kopieren in das Paket, `ragents
connect` nach dem Entpacken des Archivs und das Bauwerkzeug, bevor es ein Bundle als aktuell
liegen lässt.

**Im Profil.** Das Profil nennt ein Plugin per Kennung (ein Bundle unter `bundles/`) oder per Pfad
auf einen Bundle-Ordner: absolut, mit `./` relativ zur Profildatei oder mit `~/`. Harte Startfehler
mit Ursache sind: eine Kennung, die zweimal vorkommt; ein Pfad ohne Ordner; ein Ordner ohne
`ragents-bundle.json` (hat er `server/index.ts` oder `ragents-plugin.json`, heißt die Meldung
"Quellordner, kein Bundle" samt `ragents plugin build`); ein eingebautes Plugin, dessen Bundle fehlt
(samt `pnpm build:plugins`); ein Manifest mit anderem `format` oder einer anderen `api` als
`HOST_API_VERSION` (samt Befehl zum Neubauen); ein Name aus `hostNames`, den `host-api.json` dieses
Hosts nicht nennt (Versionsvertrag); eine Kennung aus `uses`, die nicht in der Pluginliste
oder nicht in `requires` des Modulvertrags steht. `loadPlugins` in
`apps/server/src/profile/plugin-discovery.ts` prüft das, trägt jeden Bundle-Ordner mit
`registerPluginFolder` ein und importiert `server/index.js`; `pluginFolder(id)` liefert danach den
Bundle-Ordner für Skills, Prompts, Run-Scripts und Assets. Für eine Kennung ohne Registrierung, also
Code, der Plugin-Quellen direkt lädt (Unit-Tests, Homepage-Generator), gilt `plugins/<id>`. Hat das
Bundle eine Web-Hälfte, setzt der Composer `manifest.web` auf ihre Adressen.

**Abgleich mit den Quellen.** In einem Checkout (erkennbar an `.git`) prüft der Server beim Start
zusätzlich, dass die eingebauten Bundles des Profils zu ihren Quellen unter `plugins/` passen: das
Manifestfeld `sourceStand` ist ein Hash über den Quellordner und die Eingaben des Hosts, geschrieben
vom Bauwerkzeug; weicht er ab, bricht der Start mit den Kennungen und `pnpm build:plugins` ab. Ein
Update einer gebündelten Bibliothek, des Bauwerkzeugs oder der Host-API macht so jedes Bundle
veraltet. Ein Paket hat keine Quellen, die sich ändern. Bundles von anderswo prüft der Host
nicht (Offene Grenzen). Das gilt für jeden Weg zum Server, also für `scripts/start.sh`, `pnpm
start`, `ragents run`, `ragents start` und die VS-Code-Erweiterung mit einem Checkout als Host; nur
`scripts/start.sh` baut selbst vor dem Start, die übrigen nennen den Befehl.

**Importe.** In den Quellen importieren Plugins Host-Code über Paketnamen, nie über relative Pfade
nach `apps/`: `@ragents/host/<pfad>`, `@ragents/web/<pfad>`, `@ragents/web/ui`, `@ragents/engine`
und die übrigen Module der Host-API-Liste `apps/server/src/host-api.ts`; andere Plugins nur über
deren deklarierte Exporte als `@ragents/plugins/<id>/<export>`. Testhelfer stehen unter
`@ragents/host/tests/<datei>` und `@ragents/web/tests/<datei>`.

**Auflösung zur Laufzeit.** `apps/server/src/host-resolution.ts` registriert den Loader-Hook aus
`host-resolution-hooks.mjs`, mit einem Port, über den `loadPlugins` dem Loader-Thread vor dem
ersten Import die Zuordnung von Kennung zu Bundle-Ordner meldet. Für Code in einem Bundle gilt:
`@ragents/plugins/<id>/<export>` führt auf `server/exports/<export>.js` des Bundles `<id>` der
Pluginliste; ein nackter Bezeichner nur, wenn er in der Server-Liste der Host-API steht, und dann
so aufgelöst, als käme der Import aus `apps/server/src/main.ts`, damit Host-Module ihre Identität
behalten (eine Klasse aus dem Host ist im Bundle dieselbe); `@ragents/workflow` führt auf
`apps/server/src/plugin-support/actor-programs/workflow/index.ts`; alles andere ist ein Startfehler
("importiert <x>, das der Host nicht bereitstellt"). Bundle-Dateien lädt der Hook immer als ESM,
auch ohne `package.json` daneben. Für Code außerhalb eines Bundles (Profildateien, Tests über
Plugin-Quellen, Skripte) bleibt der offene Rückfall: scheitert die normale Auflösung eines
nackten Bezeichners, gilt er wie aus `apps/server/src/main.ts`, danach aus
`apps/web/src/main.tsx`. Der Server-Einsprungpunkt `main.ts` und `plugin-discovery.ts` registrieren den
Hook selbst; Skripte und Tests, die externe Dateien laden, importieren `host-resolution.ts` per
`--import`.

Ausnahme: `apps/web/src/actor-programs/client-ui` importiert Host-Code weiter relativ, weil das
Client-SDK der Actor-Programme diese Dateien samt Importpfaden in Actor-Projekte kopiert.

**Web.** Der Host baut sein Web einmal, unabhängig vom Profil (`pnpm build:web` nach
`apps/web/dist/`; Vite schreibt daneben, dann kommt jede geänderte Datei einzeln per Umbenennen an
ihren Platz, Seiten und `host-web.json` zuletzt, Reste gehen danach, so verliert ein laufender Server
den Ordner nie und liefert keine halb geschriebene Datei aus). `apps/web/dist/host-web.json` nennt jede Quelldatei, die der Build
gelesen hat, mit ihrem Hash, dazu `vite.config.ts` und `pnpm-lock.yaml`. Der Server liefert das
Web aus, unter `/plugins/<id>/web/...` den Ordner `web/` jedes Bundles seines Profils (nur diesen,
nie Server-Code oder Assets; mit ETag und `Cache-Control: no-cache`, weil Einsprungpunkt und Exporte
ihren Namen über jeden Bau behalten) und unter `/ragents.css` das eine Stylesheet (Abschnitt zu
Tailwind unten). Diese Adressen prüft der Server vor jeder Plugin-Route, eine Route darunter ist
also nie erreichbar. Mit Zugangstoken sind genau diese Dateien ohne Sourcemaps, das Stylesheet und
`/assets/` frei, damit ein iframe ohne Cookie sie lädt, etwa das Run-Panel im Webview von VS Code;
eine Sourcemap trägt den Quelltext des Plugins und verlangt wie jede Datenroute den Token, bei einer
Anmeldung den angemeldeten Benutzer, und alles andere unter `/plugins/` bleibt hinter dem Zugang.
Ohne gebautes Web (`index.html`, `run-panel.html`) startet der Server nicht; in einem Checkout
auch nicht, wenn eine Datei aus `host-web.json` sich geändert hat (samt `pnpm build:web`).
`scripts/start.sh` baut das Web nur dann. Parallele Web-Bauten warten über `apps/web/.dist.lock`
aufeinander. Das Web liegt immer unter `apps/web/dist/` des Hosts,
auch für ein Profil, das `ragents connect` von einem Server geholt hat; einen Schlüssel für einen
anderen Ort gibt es nicht. Im Dev-Modus
(`RAGENTS_DEV=1` aus `scripts/start.sh --dev`) entfallen die Prüfungen von Web und Bundles: das Web
kommt vom Vite-Dev-Server über die Quellen des Hosts, die Bundles hält `pnpm build:plugins --watch`
aktuell (beim Start baut es nur, was fehlt oder veraltet ist), eine geänderte Plugin-Oberfläche
greift nach Neuladen der Seite. Das Stylesheet übersetzt der Server beim Start und neu, sobald sich
die Klassenliste eines Bundles ändert, auch außerhalb des Dev-Modus; im Dev-Modus je Abruf samt den
Klassen des Host-Codes. Scheitert es, antwortet nur dieser Abruf mit 500. Ein Plugin, das `web`
selbst deklariert, wird wie eines mit `requires` im Manifest abgewiesen.

**Host-API.** `apps/server/src/host-api.ts` nennt je Hälfte jedes Modul, das der Host liefert und
das nie ins Bundle darf, ausdrücklich und ohne Platzhalter, weil das Web-Register jedes einzeln
importiert, und bei Code des Hosts dazu jeden Wert, den ein Plugin daraus importieren darf. Stand
Host-API 5: Server 63 Module mit 173 Namen aus Code des Hosts (die Engine samt ihren
Vertragsmodulen, `@ragents/workspace-executor`, `@ragents/workflow`, die Bausteine unter
`@ragents/host/...`) und die Bibliotheken `typebox`, `typebox/value`, `handlebars`,
`playwright-core`, `tar` (`node:*` ist immer extern); Web 46 Module mit 112 Namen aus Code des
Hosts (die Module unter `@ragents/web/...` und die browserfähigen Verträge von Engine und Host)
und die Bibliotheken `react`, `react-dom`, `react/jsx-runtime`, `typebox`. Eine Bibliothek steht
mit `LIBRARY` ganz darin, so wie ihre installierte Fassung sie ausliefert; ein Modul des Hosts
steht mit einer Namensliste darin, ein Modul, aus dem Plugins nur Typen beziehen, mit einer
leeren. Typen stehen in keiner Liste, weil sie im Bundle verschwinden. Hinein gehört, was
Modulzustand, React-Kontext oder Klassenidentität mit dem Host teilt; reine Bibliotheken wie
`lucide-react`, `dompurify` oder `@base-ui/react` bleiben draußen, weil jedes Modul im Register
ein Namensraum-Import ist und das Tree-Shaking des Host-Webs aushebelt (gemessen: `lucide-react`
im Register kostete 1,0 MB, die übrige Liste 0,18 MB). Dieselbe Liste lesen das Bauwerkzeug
(Externals, Namen), der Auflösungshaken (Erlaubnis), das Web-Register und
`apps/server/tests/host-api.test.ts`, der die eingebauten Plugins dagegen prüft.
`apps/server/src/host-api.json` hält je Modul die Wertnamen und die Nummer, gegen die sie
gelten, erzeugt mit `pnpm update:host-api`: für Code des Hosts die Liste aus `host-api.ts`,
geprüft gegen die Werte, die das Modul laut seinen Typen exportiert, für eine Bibliothek ihre
Typen, geschnitten mit dem, was Node beziehungsweise ein Produktions-Bundle zur Laufzeit sieht
(`handlebars` hat unter Node nur `default`, `react` ohne `act` und `captureOwnerStack`). Ein
Name, den die Liste nicht nennt, ist beim Bauen ein Fehler, auch wenn das Modul ihn exportiert:
das Shim im Web kennt ihn nicht, und die Prüfung der Server-Importe weist ihn ab. Das gilt auch für
einen Namensraum-Import (`import * as ui`): im Web ist ein Zugriff auf einen fehlenden Namen die
esbuild-Warnung `import-is-undefined`, die das Werkzeug zum Fehler macht, im Server prüft es jeden
Zugriff `ns.name` und lehnt einen Namensraum ab, der als Ganzes weitergereicht wird. `import()`
eines Host-Moduls ist ein Fehler, im Server außer für eine ganz freigegebene Bibliothek, weil der
Bau dessen Namen nicht sieht.

**Was in die Host-API gehört.** Die Liste folgt fünf Regeln, und jede Streichung ist eine neue
`HOST_API_VERSION`, deshalb werden Streichungen gesammelt:

1. Nur was ein Plugin tatsächlich importiert. Plugins außerhalb dieses Repositorys zählen mit,
   denn ihre Bundles brechen genauso; wer einen Namen streicht, prüft deren Quellen.
2. Was genau ein Plugin nutzt und der Host selbst nicht braucht, liegt in diesem Plugin, nicht im
   Host. Code, der nur mit dem Host lauffähig ist, weil er dessen Dateien liest (etwa
   `actor-programs/client-runtime` mit dem CSS des Webs), bleibt im Host.
3. Die gegabelte Agentenlaufzeit (`@ragents/agent`, `@ragents/ai`) gehört
   nicht dazu. Was Plugins von ihr brauchen, bekommt einen schmalen Vertrag im Host: die Hooks in
   die Modellaufrufe eines Agenten (`host.agentRuntime`, Abschnitt Agent-Hooks), den eingebauten
   Modellkatalog eines Anbieters (`builtinCatalog` aus `plugin-support/model-choice`) und eine
   einzelne Modellfrage ohne Verlauf und Werkzeuge (`openRouterCompletionModel` aus
   `plugin-support/model-completion`). Signaturen des Hosts dürfen Typen der Laufzeit nennen,
   etwa ein Modell im Katalog; Plugins reichen sie nur durch.
4. Aus `@ragents/workspace-executor` nur die Namen, die Plugins brauchen, wie bei jedem Modul des
   Hosts.
5. Ein Eintrag ohne Nutzer fällt beim nächsten Sprung heraus, ebenso ein Name.

**Versionsvertrag.** `HOST_API_VERSION` steigt bei jeder unverträglichen Änderung eines
Listeneintrags, eines gelisteten Namens oder einer ganz freigegebenen Bibliothek, nicht mit jeder
Paketfassung; was ein Modul des Hosts sonst exportiert, ändert sich ohne neue Nummer. Das Manifest nennt sie
in `api`, der Host verlangt Gleichheit und bricht sonst mit Ursache und Befehl zum Neubauen ab;
`format` versioniert das Manifest selbst. Neue Namen kommen ohne neue Nummer hinzu; damit ein
Bundle, das gegen einen neueren Host derselben Nummer gebaut ist, auf einem älteren nicht still
`undefined` bekommt, nennt das Manifest in `hostNames` jeden benutzten Namen (Server aus der
Importanalyse der gebauten Dateien, Web aus den Wertmodulen, die esbuild behält), und der Host
prüft sie beim Auflösen der Pluginliste gegen seine `host-api.json`: ein fehlender Name ist ein
Startfehler mit Modul, Name und dem Rat, den Host zu aktualisieren oder neu zu bauen. Laden und
Bauen lesen dieselbe `host-api.json` über `checkedHostApiRecord` (`host-version.ts`), das deren
Nummer gegen `HOST_API_VERSION` prüft; eine vergessene `pnpm update:host-api` hält also auch den
Start an. Ein Wert, der im Register des Webs trotzdem fehlt, wirft beim Laden der Web-Hälfte mit
Modul und Namen. `apps/server/tests/host-api-names.test.ts` macht jede
Abweichung der Wertnamen vom gespeicherten Stand rot, und `pnpm update:host-api` verweigert
entfernte Namen ohne höhere Nummer; geänderte Bedeutung bei gleichem Namen bleibt die Entscheidung
dessen, den der rote Test dorthin führt. Die deklarierten Exporte eingebauter Plugins gehören
nicht zur Host-API und tragen keine eigene Nummer; ein fremdes Bundle, das sie importiert, bricht
bei gleicher Host-API erst beim Laden, wenn ein Name fehlt.

**Bauwerkzeug.** `ragents plugin build <quellordner...> [--out <ordner>] [--watch]
[--no-typecheck]` (`apps/server/src/plugin-build/`, `scripts/plugin/plugin-cli.ts`, im Checkout
`pnpm ragents plugin build`) baut mit dem esbuild des Hosts und festen Einstellungen, damit jedes
Bundle gleich aussieht; `tsconfigRaw: {}` schaltet eine `tsconfig.json` des Plugins ab.

- Server: `platform: node`, `format: esm`, `target: node22`, `splitting`, ein Einsprungpunkt aus
  `server/index.ts` (mit `provision.ts` ein erzeugter Einsprungpunkt, der beide weiterreicht) und je
  Export einer; extern sind `node:*`, die Server-Liste und Exporte anderer Plugins. Sourcemap
  verlinkt, nicht minifiziert. Jede Datei beginnt mit einem Banner des Werkzeugs, das `require` aus
  `createRequire(import.meta.url)` bildet, damit eine gebündelte CommonJS-Bibliothek Node-Module
  laden kann (in ESM-Ausgabe wirft esbuilds `__require` sonst "Dynamic require"); die Regel gegen
  `import.meta` und `createRequire` gilt für Plugin-Code, nicht für das Banner. `require` eines
  Host-Moduls ist ein Baufehler, weil der Host es nur als ESM-Import mit eigener Identität liefert.
- Web: `format: esm`, `jsx: automatic`, `splitting`, `target: es2022`, minifiziert mit verlinkter
  Sourcemap, `process.env.NODE_ENV` gleich `production`. Ein Host-Modul wird ein ESM-Shim mit
  ausdrücklicher Exportliste aus `host-api.json`; jeder Name kommt aus einem eigenen Wertmodul ohne
  Nebenwirkung, das aus dem Register liest, damit esbuild unbenutzte verwirft und das Metafile die
  benutzten nennt. Ein unbekannter Name ist ein Baufehler, und fehlt Register, Modul oder Name,
  wirft das Wertmodul beim Laden mit Modul und Namen. Ein
  Export eines anderen Plugins wird `/plugins/<id>/web/exports/<export>.js`, sodass der Browser das
  Modul über seine Adresse teilt; wegen `splitting` teilen Einsprungpunkt und Exporte desselben Plugins
  eine Instanz. Bilder und Schriften gehen nach `web/assets/`, eigenes CSS nur über den Einsprungpunkt
  nach `web/index.css`, die Tailwind-Kandidaten mit dem Scanner von Tailwind aus den gebündelten
  Dateien des eigenen Ordners nach `web/classes.json`.
- Nackte Importe außerhalb der Liste bündelt es; das `node_modules` des Hosts steht zuletzt im
  Suchpfad, ein eigenes des Plugins gewinnt. `react` und jedes andere Host-Modul kommen immer vom
  Host, auch wenn das Plugin eine eigene Kopie mitbringt.
- Relative Importe in ein Geschwister-Plugin (ein Ordner mit `ragents-plugin.json`) sind erlaubt,
  wenn die Datei ein deklarierter Export dieser Hälfte ist; das Werkzeug schreibt sie auf
  `@ragents/plugins/<id>/<export>` um.
- Assets: `skills/`, `prompts/`, `run-scripts/`, `*.hbs` an der Wurzel und `assets` aus der
  Beschreibung; Verknüpfungen und `node_modules` darin sind ein Fehler.
- Baufehler, je Stelle mit Datei, Zeile und Ursache: ein Import außerhalb von Liste, eigenem Ordner
  und deklarierten Exporten (auch das eigene Plugin über seinen Paketnamen und ein Node-Modul im
  Web); ein Name, den die Host-API für ein Modul nicht anbietet, auch über einen Namensraum; ein
  Namensraum eines Host-Moduls, der im Server als Ganzes weitergeht; `import()` eines Host-Moduls;
  `require` eines Host-Moduls im Server; `import.meta`, `__dirname`,
  `__filename`, `createRequire` oder `require.resolve` im Plugin-Code; eine gebündelte Bibliothek,
  die über ihren eigenen Ort Dateien sucht; `.node`-Dateien und Pakete mit `os`, `cpu` oder
  plattformabhängigen optionalen Abhängigkeiten; ein `pluginAsset("<id>", "<name>")` mit festem
  Namen, der nicht ins Bundle kommt; CSS außerhalb des Web-Einsprungpunkts; eine Kennung, die nicht dem
  Ordnernamen entspricht, unbekannte Felder und Exporte ohne Quelldatei.
- Typprüfung in einem TypeScript-Programm je Hälfte über alle genannten Plugins gegen
  `apps/server/tsconfig.plugin.json` und `apps/web/tsconfig.plugin.json` (Pfade auf die Host-API,
  gültig für jeden Ordner) samt Pfaden auf die Geschwister; Fehler in Host-Dateien bleiben dem Host.
  Typfehler und übrige Befunde erscheinen zusammen, geschrieben wird dann nichts. `--watch` prüft
  keine Typen, das tut der Editor. Gemessen: 19 eingebaute Plugins 9 s mit und 2,5 s ohne
  Typprüfung.
- Geschrieben wird in einen temporären Ordner neben dem Ziel. Gibt es das Bundle noch nicht, wird
  der Ordner umbenannt; sonst kommt jede geänderte Datei einzeln per Umbenennen an ihren Platz, das
  Manifest zuletzt, danach gehen Reste der alten Fassung (`installFolder` in
  `apps/server/src/folder-install.ts`). So verschwindet der Bundle-Ordner eines laufenden Hosts nie,
  auch nicht kurz, und unveränderte Dateien bleiben unberührt, `tsx watch` startet also nur neu, wenn
  sich Server-Dateien ändern. Jede Datei ist dabei alt oder neu, das Bundle als Ganzes wechselt nicht
  in einem Schritt; einen Ordner atomar zu tauschen kann Node nicht. Bauten in dasselbe Ziel
  warten über `<out>/.build.lock` aufeinander; die Sperre eines beendeten Prozesses wird übernommen.
  Ein abgelehntes Plugin hinterlässt nichts, und es hält die anderen nicht auf (Exit-Code dann 1).
  Vorgabe für `--out` ist `./dist/plugins` ab dem Aufrufer. `--watch` beobachtet den Plugin-Ordner
  ohne `node_modules` und das Ziel, baut nach jeder Änderung das ganze Plugin neu und liest dafür
  Beschreibung, Einsprungpunkte, Assets und die Exporte der Geschwister jedes Mal frisch; beim Start baut
  es nur, was fehlt oder veraltet ist. Veraltet ist ein Bundle mit anderem `format`, anderer `api`,
  anderem `sourceStand` oder Dateien, die nicht mehr zu `stand` passen.

Das Paket `@schlenkr/ragents` trägt das Bauwerkzeug samt esbuild, TypeScript, dem Scanner von
Tailwind, den Typen von Node und React, den Quellen der Host-API und den gebauten Typen der
Agentenlaufzeit (`packages/{ai,agent}/dist/**/*.d.ts`; Module der Host-API nennen
deren Typen in ihren Signaturen, etwa ein Modell im Katalog, ohne sie scheiterte die Typprüfung
jedes Plugins, das ein solches Modul nennt). Ein fremder Autor
braucht daneben nichts; das prüft `pnpm check:package` (`scripts/package/package-plugin.test.ts`):
Paket bauen, mit `npm install --global` in ein eigenes Präfix legen, in einem leeren Ordner ein
Plugin mit Server- und Web-Hälfte samt Typprüfung bauen, ein Plugin mit Typfehler scheitern sehen
und das eigene Profil mit `ragents start` starten. Die Anleitung für Autoren steht oben im
Abschnitt Build and ship a plugin.

**Eingebaute Plugins** gehen denselben Weg: `pnpm build:plugins`
(`scripts/plugin/build-builtin-plugins.ts`) baut von `plugins/*` ohne Typprüfung, weil `pnpm -r
typecheck` die Quellen schon prüft, nur die veralteten nach `bundles/<id>/` (gitignored), lässt
aktuelle unberührt und entfernt Bundles ohne Quellordner; `scripts/start.sh`, der Test-Einsprungpunkt von
`apps/server` und `pnpm build:package` rufen es vorher. Ein zweiter Server aus demselben Checkout
und parallele Tests behalten so ihre Bundles. Host-Code, der Plugin-Dateien importiert (VS-Code-Erweiterung, `ragents run`, `connect`,
`workspace-client`, Homepage-Generator), behandelt sie als Host-Quellen; das Paket trägt dafür
`plugins/` als Quellen, geladen wird daraus nichts.

**Plugin-Projekte außerhalb des Repos** prüfen sich selbst: Sie erweitern
`apps/server/tsconfig.plugin.json` beziehungsweise `apps/web/tsconfig.plugin.json` des Hosts per
`extends` (dort stehen `paths` und `typeRoots` auf die Host-API) und nennen eigene `include`-Listen.
Sie bauen ihre Bundles selbst, vor Start und Tests, und ihre Profile nennen die Bundles
(`./dist/plugins/<id>`). `pnpm check` im Repo prüft nur die Repo-Plugins. `pnpm provision`
provisioniert dagegen jedes Plugin des Profils, auch eines von außerhalb, weil es `provision` aus
dessen Bundle importiert.

Plugin-Repos neben dem Host stellen auf dieselbe Weise um: `ragents-plugin.json` je Plugin mit
Exporten für die Geschwister, Assets über `pluginFolder(id)`, ein Bauschritt vor Start und Tests,
Profile auf `./dist/plugins/<id>`, Container bauen die Bundles im Image. Tests eines solchen
Repos, die Klassen eines Plugins per Prototyp ersetzen, erreichen sie im Bundle nicht und
komponieren aus Quellen; was ein Host-Modul ist oder ein Plugin als Dienst bereitstellt, bleibt
ersetzbar.

## Rechte in Server- und Web-Beiträgen

Der Dispatcher prüft die `rights` eines Vertrags, bevor eine Methode läuft oder ein Kanal
öffnet, und gibt der Ausführung den Zugang als `context.access` mit der gemeinsamen Rechteabfrage
`can`. Der Host gibt ebenso jeder Auslieferungsroute einen `HttpRouteContext.access`;
`requiredRights` am Routenbeitrag nimmt eine Liste oder eine Funktion
von Request und URL entgegen. Alle genannten Rechte müssen vorliegen; der Host prüft sie vor
`handle`. Ohne eigene Angabe gelten für lesende Auslieferungen die Run-Leserechte und für andere
Methoden zusätzlich die Run-Schreibrechte. Eigene Listen ersetzen diesen Standard.
Die aktuellen Verträge und die Host-Routenzuordnung werden in der Entwicklerreferenz aus dem
Code erzeugt; weitere Rechte benennt das besitzende Plugin selbst.

Nennt die Eingabe einer Methode oder die Parameter eines Kanals eine `runId`, prüft der
Dispatcher zusätzlich die Zugehörigkeit des Runs ([profiles.md](profiles.md)). Verlangt der
Vertrag `runs.write`, bedient die Methode den Run: Hat eine Startoption den Run mit `ownerOnly`
seinem Eigentümer vorbehalten, lehnt der Dispatcher jeden anderen Zugang mit `run-owner-only`
(403) ab, bevor die Methode läuft, auch einen mit `runs.read.all`. Das gilt ohne eigenen Code
für jeden Beitrag, etwa das Beantworten einer Rückfrage, eine Mini-App-Aktion oder das Beenden
eines einzelnen Prozesses; den ganzen Run stoppen `ragents.chat.stop` und `ragents.runs.stopAll`,
den laufenden Turn eines Actors unterbricht `ragents.runs.interruptTurn`.

Im Browser liefert `useAccess` den gleichen Zugriffskontext und `logout`.
`accessMode` unterscheidet verborgen, nur lesbar und bearbeitbar. Workspace-Tabs, Run-Kopf- und Statusbeiträge können über `readRight` ein eigenes
Leserecht verlangen. Technische Beiträge verwenden `runs.inspect`. Workspace-Tabs und Kopfbeiträge,
die den Arbeitsbereich des Runs brauchen, erklären das mit `requiresWorkspace: true`; sie fehlen,
wenn die Run-Liste für den Run `workspaceAccessible: false` meldet (`workspaceAccessible` aus
`PluginRegistry`, ein noch nicht gelisteter Run gilt als erreichbar). Ein Beitrag mit gemischtem
Inhalt fragt dasselbe selbst ab, etwa der Reiter Dateien, der dann nur die Dateiablage zeigt. Settings-Beiträge können
ebenfalls ein eigenes Leserecht verlangen; ohne Angabe gilt das Settings-Leserecht.
Die Komponente prüft ihre Schreibaktionen ebenfalls. Ausblenden ersetzt keine serverseitige
Prüfung: Eigene Routen deklarieren ihre erforderlichen Rechte unabhängig von der UI.

Der globale Koordinator besitzt eigene Rechte im Vertrag von `ragents.overseer`.
Lesen erlaubt Verlauf und Modellanzeige; Aufträge und Reset brauchen zusätzlich Schreiben.
Modelländerungen verlangen außerdem Settings-Schreibzugriff. Seine Run-Routen werden über die
vom Plugin beigetragene `GlobalChatPolicy` zugeordnet: `isCoordinator` erkennt jede
Koordinatorkennung, `runIdFor` nennt den Koordinator eines Benutzers (ohne Anmeldung `null`), und
`access` nennt die beiden Rechte. Die Modellwahl gilt für alle Koordinatoren des Profils gemeinsam. Die allgemeine
Engine enthält keine fest verdrahteten Plugin-Rechtenamen. Der optionale Anmeldemodus und
seine Grenzen stehen in [profiles.md](profiles.md).

## Nachrichtenschicht

Die API des Servers ist JSON-RPC 2.0 mit typisierten Verträgen; eine REST-artige HTTP-API gibt es
nicht mehr. Ein Vertrag ist ein Objekt aus `defineOperation` oder `defineChannel`
(`packages/ragents/src/rpc/contract.ts`) im `contract.ts` des Plugins: Id mit Namensraum
(`ragents.<plugin>.<name>`), Beschreibung, Rechte und TypeBox-Schemata für Eingabe und Ergebnis
beziehungsweise Parameter und Nachricht. Server und Web ziehen ihre Typen aus demselben Objekt:
`host.methods(implement(contract, (input, context) => result))` erzwingt Ein- und Ausgabe über
`Static<>`, der Web-Client `rpc.call(contract, input)` liefert das Ergebnis typisiert. Große
Domänenwerte stehen als offenes Schema mit TypeScript-Typ (`openJson<T>`); die Laufzeit prüft
sie nicht im Detail, die Referenz nennt den Typ.

Der Dispatcher (`apps/server/src/rpc/dispatcher.ts`) bedient jede Verbindung: er prüft die
Rechte des Vertrags gegen den Zugang der Verbindung, validiert die Eingabe gegen das Schema,
führt aus und validiert das Ergebnis; eine Antwort, die ihren Vertrag verletzt, ist ein interner
Fehler und wird protokolliert. Beide Meldungen nennen jeden verletzten Pfad mit Grund, etwa
`Ungültige Eingabe für ragents.chat.send: text must be string, got 5` (`schemaComplaints`,
Regel in `overview.md`). Fehler kommen als JSON-RPC-Fehler: `-32601` unbekannte Methode,
`-32602` ungültige Eingabe, `-32000` Fachfehler mit `data.code` und `data.status` aus dem
`DomainError`, `-32001` abgebrochen, `-32003` Zeitgrenze. Rechte je Run entscheidet der Host
dynamisch (`apps/server/src/api/rights.ts`: gewöhnliche Runs über `runs.*`, der globale Chat über
die Rechte seines Plugins); solche Verträge nennen keine statischen Rechte, sondern ihre Regel
in der Beschreibung. Der `context` einer Methode: `access`, `signal` (Abbruch durch `rpc.cancel`
oder Verbindungsende), `progress` (Zwischenstände als `rpc.progress`), `connection` und
`local` (Aufruf vom eigenen Rechner: stdio oder Loopback).

Kanäle sind Benachrichtigungen: `rpc.subscribe { channel, params }` liefert eine
Abonnementkennung, danach kommen `rpc.event { subscription, channel, message }`, bis
`rpc.unsubscribe`. Ein Anbieter wiederholt beim Öffnen seinen Anfangsstand, weil ein Client nach
Verbindungsverlust neu abonniert; Nachrichten während des Öffnens werden erst nach der
Abonnementantwort zugestellt. Höchstens 64 Abonnements je Verbindung.

Das Protokoll ist symmetrisch: eine Operation mit `implementedBy: "client"` implementiert der
Client (`rpc.handle`), und der Server ruft sie über `context.connection.call` auf derselben
Verbindung, etwa die Dateioperationen eines Arbeitsplatzes. Das setzt einen Ereignisstrom voraus;
eine Verbindung ohne Strom (`streamless`) kann weder abonnieren noch zurückgerufen werden.

Transporte bedienen denselben Dispatcher. HTTP: `POST /rpc` je Nachricht (Anfrage, Antwort des
Clients auf einen Rückruf oder Benachrichtigung) und `GET /rpc/stream` als SSE-Strom je
Verbindung, der sich mit `hello` und Verbindungskennung meldet und Benachrichtigungen sowie
Anfragen des Servers trägt; die Kennung kommt im Header `x-ragents-connection` mit. Stdio: eine
JSON-Nachricht je Zeile auf stdin und stdout, der Aufrufer gilt als vertraut und hat alle Rechte.
Anmeldung ist Transportsache: HTTP mit Cookie, Bearer oder `?access=` wie bisher
(`/api/access`, `/api/access/login`, `/api/access/logout` bleiben HTTP), stdio ohne.

Kernverträge: `ragents.chat.*`, `ragents.runs.*` (Run-Liste, Run-Ansicht, Journal,
Warteschlangen, Stopp und Rückfragen aus der Engine), `ragents.startOptions.*`,
`ragents.runs.prepare`, `ragents.settings.*`, `ragents.plugins.bootstrap`, `ragents.external.set`
und die Kanäle `ragents.runs`, `ragents.run` und `ragents.chat`
(`apps/server/src/api/contracts.ts`, `packages/ragents/src/http/contracts.ts`). Was keine
JSON-Nachricht ist, bleibt Auslieferung über `host.http`: statische Oberfläche, Mini-App-Frames,
Artefakt- und Anhanginhalte unter `/files/runs/<run>/artifacts/<id>` und
`/files/runs/<run>/attachments/<id>`, Dokumentinhalte, Hilfe und `/health`. Die Registry
`http` ist nur noch dafür da; jede JSON-Antwort ist eine Methode.

Die Referenz entsteht aus den Registrierungen: `host.methods.describe()` und
`host.channels.describe()` liefern Owner, Id, Beschreibung, Rechte und Schemata für die lesbare
Referenz und das OpenRPC-Dokument. Der Web-Client (`apps/web/src/rpc/client.ts`) läuft auch
unter Node; die VS-Code-Erweiterung und `pnpm driver` verwenden ihn mit eigenem `fetch`.

## Web als Plugin-Host

Jede Seite hält genau EINE Live-Verbindung zum Server: der Client `rpc` (`apps/web/src/rpc.ts`)
öffnet `GET /rpc/stream` mit dem ersten Abonnement oder dem ersten Rückruf-Handler und schließt
ihn, wenn nichts mehr offen ist. Anfragen gehen als `POST /rpc`. Abonnements sind Kanalverträge:
`rpc.subscribe(contract, params, onMessage, onError)`; bei Verbindungsverlust verbindet der Client
neu, abonniert alle Kanäle erneut und ruft `onConnected`-Hörer, weshalb Anbieter beim Abonnieren
ihren Anfangsstand wiederholen. Kern-Kanäle: `ragents.runs` (Listenänderungen, sofort eine
Meldung), `ragents.run` (`ready` beim Abonnieren, danach `run` je Journaländerung) und
`ragents.chat` (die Chat-Ereignisse mit Replay). Plugins registrieren eigene Kanäle über
`host.channels`: `ragents.processes` je Run, `ragents.workspace.browse` je Run und Wurzel.
Hintergrund: Browser erlauben je Host nur sechs gleichzeitige HTTP/1.1-Verbindungen;
vier eigene Streams je Seite plus ein zweiter Tab hatten den Vorrat aufgebraucht, sodass keine
weitere Anfrage mehr abging.

Die Fläche verwendet Schichtwerk: matte, gerade Kacheln mit 17 Pixeln Eckradius und einer
Kontur an Front und Silhouette. Der Primary-Actor trägt Lavendel, weitere LLM-Actors Tonfarbe,
TypeScript-Actors Senfgelb und Mini-App-Hosts Blaugrau. Kacheln haben keine Tiefe.
Der Hintergrund kombiniert weiche Farbverläufe in Lavendel, Mint und Blau mit einer
hellen Mitte, einem warmen Randbereich und dezenter Materialstruktur. Die dunkle Darstellung
verwendet gedämpfte Varianten derselben Farben; ein Punktraster gibt es nicht.
Die Frontflächen bleiben matt und gleichmäßig; die Maus verändert ihre Beleuchtung nicht.
Die Kacheln verwenden keinen Filter-Schlagschatten und keinen WebGL-Schattenrenderer.
Farben, Schriften, Radien und Schatten stehen zentral in `apps/web/src/ui/theme.css`; Host, Chat,
Orchestration-Kacheln und gemeinsame Mini-App-Controls verwenden dieselben semantischen Tokens.
Kopfzeile, Leiste und Statusleiste verwenden ein gemeinsames, deckendes Schieferblau;
Dialoge und Einstellungen verwenden hellere blaugraue Flächen und lavendelfarbene Auswahlflächen. Text, Konturen und Schatten sind violettgrau abgestimmt. Datei- und
Statusfarben folgen ebenfalls den zentralen, für Hell und Dunkel definierten Farbtokens.
Eigene Benutzernachrichten stehen auf einer neutralen Fläche mit Kontur; ausdrücklich
eingefärbte Mehrparteienbeiträge behalten ihre eigenen Farben.

Unter Einstellungen, Darstellung lässt sich die Oberfläche hell, dunkel oder gemäß Systemeinstellung
anzeigen. Ohne gespeicherte Wahl startet die Oberfläche dunkel. Die Auswahl gilt sofort für
alle Runs und offenen Tabs derselben Serveradresse in diesem Browser; sie ist kein Profilwert
und wird nicht auf dem Server gespeichert. Ändern verlangt Settings-Schreibrechte.
Die Oberfläche übernimmt die gespeicherte Darstellung vor dem ersten React-Render. Nur bei
Systemauswahl folgt sie späteren Änderungen der Systemeinstellung. Theme-Wechsel verändern
weder gemountete Ansichten noch Eingabeentwürfe. Ungültige gespeicherte Werte
und Speicherfehler werden ausdrücklich angezeigt. Die Darstellung ist ein fester Host-Bereich
und bleibt unabhängig von Beitragsfiltern und dem Laden der Plugin-Einstellungen erreichbar.
Mini-App-Frames erhalten die aufgelöste Darstellung über ihre vorhandene Bridge (siehe actor-programs.md).

Menüs, Kopfzeilenhinweise, Actor-Pop-outs, Chat-Schrittdetails, Journal und globaler
Koordinator sind `Popover`, `Tooltip` und `Select` aus der UI-Bibliothek; Base UI positioniert
sie am Anker (auch an einer virtuellen Position oder unter der Headerkante), begrenzt sie auf
den verfügbaren Platz und folgt Scrollen und Layoutänderungen. Abstände, Öffnungsrichtung,
Fokusziel und Schließverhalten bleiben Eigenschaften des jeweiligen Aufrufers.

Die lokalen Header-, Kachel- und Run-Panel-Einstellungen teilen Speicherung, Validierung vor dem
Schreiben und Benachrichtigung im selben sowie in anderen Browser-Tabs. Das Theme verwendet
denselben Storage-Listener; die eigenen Parser, Schlüssel und Fehleranzeigen bleiben fachlich
getrennt. Dialog und DialogContent bieten einen gemeinsamen
Kopf mit optionalen zusätzlichen Aktionen; Vorschau-Dialoge verwenden diese Hülle ebenfalls.
Ein Dialog, der eine fremde Web-Anwendung in einem iframe zeigt, nennt ihre Adresse und bietet
immer "In neuem Tab öffnen": Anwendungen dürfen das Einbetten verweigern (X-Frame-Options,
CSP `frame-ancestors`, Office.js verlässt jedes Nicht-Top-Fenster nach `about:blank`), und der
Host kann das über die Origin-Grenze nicht erkennen. Die Vorschau hängt deshalb nie allein am
iframe.

Der Dispatcher gibt einen `DomainError` mit Code und Status als Fehlerdaten der Antwort weiter;
der Auslieferungshelfer (`guardedJsonRoute`) erhält seinen Status. Fachliche Übersetzungen
externer Fehler und gezieltes Maskieren bleiben bei den jeweiligen Plugins.

Der zentrale Chat kennt keine festen Fach-Toolnamen. `WorkspacePanel` kennt keine festen Tabs.
Plugins belegen stattdessen typisierte Slots für:

- Startoptionen der Startseite (`startOptions`: Bedienkomponente und Abzeichen je Option-Id;
  ohne Komponente ein Auswahlmenü aus einer Darstellung `{ kind: "choice", label, options }`).
  `placement` wählt die Startseite (`page`, Vorgabe) oder die Eingabeleiste (`composer`);
  der Modellbeitrag verwendet die Eingabeleiste.
- Übersichtsbeiträge (`overviewPanels`): unabhängige Bereiche mit `placement` in der Übersicht
  (Vorgabe `overview`) oder der Kopfzeile (`toolbar`); `readRight` begrenzt die Sichtbarkeit.
  Ihr Kontext enthält Registry, Öffnungszustand, `onOpen`, `onClose` und `onBusy`. Der Host
  koordiniert Übersicht und Toolbar-Verlauf. Toolbar-Beiträge sind ab Anwendungsstart gemountet,
  aktivieren eigene Verbindungen aber erst bei Nutzung und erhalten sie danach bei Run-Wechseln.
- Workspace-Tabs und Badges (`workspaceTabs`, `workspaceTabsFor`): im Web die Reiter der
  Leiste, im Run-Panel die Symbolleiste am rechten Rand mit dem Tab-Bereich
  unter dem Chat; derselbe Beitrag, dieselbe Sichtbarkeit (`readRight`, `requiresWorkspace`, `available`)
- Tool- und Entity-Presenter; die Run-Provider binden Tool-Darstellungen gemeinsam an
  Run und Navigation. Standardchat und Actor-Chat konsumieren denselben Renderer.
- Run-Metadaten
- Run-Kopfbeiträge (`sessionHeaders`): `placement: "surface"` setzt den Beitrag in die Flächenleiste
  über der Fläche; ohne Angabe beziehungsweise mit `"header"` bleibt er in der Titelleiste.
  `ActorProgramsHeader` verwendet die Flächenleiste.
- Run-Provider und Fläche (`surface`); `runToolbarContainer` nimmt links in der Flächenleiste
  die Steuerung der Fläche auf, `toolbarContainer` im Run-Panel deren Werkzeuge in der
  Kopfzeile des Run-Panels
- Run-Statusbeiträge (`sessionStatus`): nach `order` sortierte Gruppen in der gemeinsamen
  unteren Statusleiste; `Status` erhält denselben Run- und Navigationskontext wie ein
  Kopfzeilenbeitrag. Die Fläche erhält über `statusContainer` das Ziel für ihre Statusgruppe.
- Abschnitte an einem Actor (`cardSections`)
- Darstellung einer wartenden Aktion (`actionViews`): je Eigentümer genau eine Komponente, die
  Titel, Payload und Ergebnis der Aktion bekommt und ihre Form selbst kennt. Der Chat zeigt eine
  Aktion ohne registrierte Darstellung generisch: Titel, "wartet auf Eingabe" und "Verwerfen".
  `ragents.ask` erzeugt seine Aktionen mit dem Payload `{ question, options, multi }` und
  beantwortet sie über den eigenen Vertrag `ragents.ask.answer`; der Kern kennt diese Form nicht
  (`docs/spec/core.md`, Wartende Aktionen).
- Leitfäden (`guides`): je Kennung eine React-Komponente, die der Host beim Klick auf eine
  Vorlage mit `guide` in einem Dialog zeigt; `onComplete` liefert bei einem Skill den Text der
  ersten Nachricht, bei einem Run-Script den Startwert als JSON (etwa die Gesprächsrunde
  von `ragents.reference`)

Die gemeinsame Titelleiste ist 45 Pixel hoch. Direkt darunter liegt über der Fläche eine eigene
mindestens 52 Pixel hohe Leiste für Apps und Actor-Zugänge. Sie hat eine feine untere
Trennlinie und keinen eigenen
Schatten; der Schatten der Titelleiste liegt über ihr. Die Flächenleiste liegt außerhalb des
Dialogbereichs `surface`, sodass sie auch bei geöffneter App-Vollansicht bedienbar bleibt.
Bei Platzmangel erscheinen links und rechts neben den direkten App- und Actor-Zugängen
Pfeilknöpfe, die um den Großteil der sichtbaren Breite blättern. Am jeweiligen Ende ist der
Knopf deaktiviert. Mausrad, horizontales Trackpad-Scrollen und Tastaturnavigation bewegen
denselben Bereich ohne sichtbaren Scrollbalken; Anzeige und Actorliste bleiben links stehen.
Mausradereignisse innerhalb eines geöffneten Pop-outs gehören dessen Inhalt und werden nicht
in horizontales Scrollen der Leiste umgewandelt, auch nicht an den Scrollrändern des Inhalts;
solche Bereiche tragen dafür `data-surface-scroll`.
Die Pfeile passen sich an Fenstergröße, neue Einträge und Typfilter an. Bei reduzierter
Bewegung blättern sie ohne Animation. LLM-Actors tragen ein Personen-Symbol auf Tonfarbe,
TypeScript-Actors ein Code-Symbol auf Senfgelb und Mini-Apps ein Raster-Symbol auf Blaugrau.
Tooltips und zugängliche Beschriftungen nennen den Typ auch bei eigenen Anzeigenamen.

Die direkten Actor-Einträge in dieser Flächenleiste öffnen ein Pop-out unter ihrem
Knopf. LLM-Actors einschließlich des Run-Koordinators zeigen ihren Chat mit Eingabe
bei einer gewünschten Breite von 784 CSS-Pixeln, begrenzt durch den verfügbaren Fensterplatz;
TypeScript-Actors zeigen die vorhandene Actor-Ansicht mit Verlauf und Detailreitern.
Die Sprechblase in der Ansichtsleiste wählt den Verlauf. Bei einem installierten Actor-Programm
öffnet der Code-Reiter dessen Quelltext über den gemeinsamen Viewer des Programm-Plugins,
auch bei TypeScript-Actors ohne View oder veröffentlichte Funktionen. Der Zugriff benötigt
weiterhin `runs.inspect`. Ohne aktives Programm-Plugin wird kein zusätzlicher Reiter angeboten.
Ihre Ansicht enthält keine Chat-Eingabe und erklärt die Bedienung über Mini-App oder
dokumentierte Funktionen. Auch der primäre TypeScript-Actor wird dadurch kein Chatpartner.
Die Chat-Methoden für den Run und einzelne Actors weisen TypeScript-Ziele mit
`actor-chat-unsupported` (Status 400) vor dem Speichern von Anhängen oder Eingaben ab.
Das gilt auch für die Nachrichtenmethode des globalen Koordinators. Deren Beschreibung
und Prompt unterscheiden Einreihen, Verarbeitung und Aufgabenerfüllung. Die
Chat-Medienabfrage meldet für TypeScript keine unterstützten Eingabearten.
Beide verwenden die Actor-Ansicht des `FlowInspector`. Es ist jeweils ein Actor-Pop-out
offen. Erneuter Klick, Außenklick, Fokus außerhalb, Escape oder X schließen es; Escape und X
geben den Fokus an den Eintrag zurück. Besuchte Ansichten bleiben verborgen gemountet,
damit Eingabeentwürfe beim Schließen oder Actor-Wechsel erhalten bleiben. Ein Run-Wechsel
verwirft diese Ansichten. Das Pop-out ist ein `Popover` mit `keepMounted`, das am Knopf
hängt und auf den verfügbaren Platz begrenzt bleibt. Der Eintrag öffnet die Leiste nicht;
weiterführende Verweise auf einzelne Inputs, Turns und andere Entitäten verwenden deren
bestehende Navigation. Darüberliegende Dialoge blenden das Pop-out aus.

Links vor `Actors` schaltet der gleichbleibend 120 Pixel breite Knopf `Anzeige` zyklisch
zwischen `Alle`, `Aktive`, `Sichtbare`, `LLM-Agenten` und `TypeScript` um. `Sichtbare` ist die Vorgabe. `Aktive` zeigt direkte Zugänge für alle
nicht gestoppten LLM- und TypeScript-Actors. `Alle` ergänzt gestoppte Actors;
`Sichtbare` zeigt nur Actors, die gerade eine Kachel haben, dazu immer
den primären Actor; die Grundlage sind dieselben Flächeneinträge, die auch die ausgegrauten Zugänge bestimmen.
`LLM-Agenten` und `TypeScript` zeigen nur den jeweiligen Typ, einschließlich gestoppter Actors. Menschliche Beteiligte stehen
nur in der vollständigen Actorliste. Die Auswahl betrifft die direkten Actor-Zugänge,
nicht Mini-App-Einträge oder Kacheln, und bleibt im Browser je Run gespeichert.
Die vollständige Liste unter `Actors` ist in jeder Anzeige erreichbar, einschließlich
nicht platzierter und gestoppter Actors. Die Liste liegt über der Fläche und der
Leiste. Durch einen Anzeigewechsel verborgene Chats behalten ihre Entwürfe.
Actorliste und Actor-Chats verwenden dasselbe Pop-out-Control mit
gemeinsamer Positionierung, Kopfzeile und Fläche. Es schließt ohne Abstand am Knopf an und
öffnet nach unten.
Toolbar-Knöpfe zeigen während des Drückens und bei geöffneter Fläche eine vertiefte
Akzentfläche mit innerem Schatten und unterer Markierung; Hover allein vertieft sie nicht.

Die Reiter der Leiste stehen in der gemeinsamen Titelleiste neben Einstellungen
und Hilfe. Ihre kompakten Symbole wählen den Inhalt der Leiste. Der vollständige
Name bleibt als Tooltip und zugängliche Beschriftung erhalten; Hinweise auf neue Inhalte und
Badges teilen sich je Reiter maximal einen Punkt; der Hinweis auf neue Inhalte hat Vorrang.
Sprachplugins liefern ihre kurzen Kennzeichen selbst als Symbol,
etwa `C#`, `TS` oder `F#`; der Host unterscheidet dafür keine Plugin-IDs. Bei Platzmangel lässt
sich die Reiterreihe horizontal scrollen.
Header-Reiter und Panelknopf zeigen ihren ersten Tooltip nach 50 Millisekunden Hover und
sofort bei sichtbarem Tastaturfokus. Ein bereits sichtbarer Tooltip wechselt beim direkten
Übergang zum nächsten Knopf ohne erneute Verzögerung oder Einblendung. Beim Verlassen bleibt
er 110 Millisekunden bestehen, um die Lücken zwischen Knöpfen zu überbrücken; ein neuer Knopf
verwirft das geplante Ausblenden. Die Hinweise stehen sechs Pixel unter der gemeinsamen Headerkante,
mit acht Pixeln Rand zum Viewport und höchstens 320 Pixeln Breite. Eine 120 Millisekunden lange
Einblendung entfällt bei reduzierter Bewegung. Die Hinweisfläche fängt keine Zeigerereignisse
ab; Fokusverlust, Drücken und Escape entfernen sie sofort ohne Fokuswechsel. Der sichtbare
Tooltip ist ein `Tooltip` der UI-Bibliothek und über `aria-describedby` verbunden, native
Titelhinweise entfallen.

In der Actor-Ansicht (`FlowInspector`, im Pop-out und in TypeScript-Kacheln) wählt eine
einzeilige Symbolleiste genau eine Ansicht. Das X links zeigt
Chat und Eingabe; die übrigen Knöpfe zeigen jeweils einen Detailbereich an derselben Stelle
mit der gesamten verfügbaren Höhe. Tooltips und zugängliche Beschriftungen enthalten Namen
und gegebenenfalls Anzahlen. Der Infochip zeigt Status, Actor-Art, Driver, Modell, Denktiefe,
offene Inputs, Turnzahl und gegebenenfalls Kosten. Chat und Eingabe bleiben beim Wechsel
verborgen gemountet, damit der Entwurf erhalten bleibt. Pfeiltasten, Home und End wählen die
Ansicht ebenfalls; bei Platzmangel scrollt die Symbolleiste horizontal.

Die Leiste schließt ohne Außenabstände und abgerundete Außenecken an
die Titelleiste und den rechten Fensterrand an und endet oberhalb der Statusleiste. Ein
Schlagschatten an ihrer linken Kante hebt sie von der Fläche ab. Kopfzeile und Statusleiste
werfen ebenfalls einen dezenten Schatten zur Fläche hin; alle drei Schatten besitzen
eigene, für helle und dunkle Darstellung abgestimmte Tokens. Der Größenanfasser an dieser Kante verändert weiterhin
ihre Breite. Reiter und Ein-/Ausklappknopf bilden zusammen mit Einstellungen und Hilfe den
rechten Bereich der gemeinsamen Titelleiste; die Leiste hat keine eigene Reiterzeile.
Einstellungen und Hilfe öffnen ihre Dialoge.
Der Panelknopf verwendet wie Einstellungen und Hilfe `Button variant="ghost" size="icon-lg"`
mit einem 22-Pixel-Symbol.

Breite und Aufklappzustand der Leiste werden im Browser je Run gehalten. Automatisches
Öffnen eines Reiters in einem Run verändert andere Runs nicht. Der Dateibrowser hält Root,
versteckte Dateien und Baumzustand ausschließlich in seiner Komponenteninstanz; beim
Unmount wird dieser Zustand verworfen. Es gibt dafür keinen modulglobalen Speicher.
Die Leiste lässt sich vollständig einklappen. Dann bleibt von ihr nur der Öffnungsknopf in der
Titelleiste sichtbar; Reiter, Inhalt und Größenanfasser sind verborgen. Erneutes Öffnen
stellt die zuletzt gewählte Breite innerhalb des verfügbaren Platzes wieder her. Breite und
Öffnungszustand werden im Browser gespeichert. Besuchte Reiter mit `keepMounted` behalten beim
Reiterwechsel ihren Zustand; Einklappen erhält die gemounteten Inhalte mit `active: false`.
Eine ausdrückliche Navigation zu einem Reiter,
zum Beispiel über einen Dokumentknopf im Chat, öffnet die Leiste wieder.

Der Chat der Actor-Ansicht setzt den ausgewählten Actor als Darstellungs-Owner: Seine eigenen
Nachrichten erscheinen ohne Sprechblase, Beiträge anderer Beteiligter behalten ihre bisherige
Darstellung. Die Actor-Projektion liefert dafür Absenderkennungen unabhängig von Anzeigenamen.

Der Beitrag `cardSections` (`id`, `order`, `Section`) rendert Abschnitte an jedem Actor, in
seiner Kachel wie im Run-Panel; ein Beitrag ohne Inhalt liefert `null`, mehrere Beiträge
an demselben Actor sind der Normalfall. Das Kern-Web kennt das Actor-Domänenmodell an dieser Grenze NICHT: der Kontext
reicht `actor` untypisiert durch, und das beitragende Plugin parst ihn über den Vertrag des
Orchestration-Plugins. Aktuell tragen `ragents.ask` (offene Fragen mit `askedBy === actor.id`),
`ragents.orchestration` (Artefakte mit `createdBy === actor.id`) und `ragents.todo` (Actor-Scope
aus `RunView.pluginStates`) bei. Die Abschnitte bleiben in ihrer Kachel scrollbar und ändern
niemals Identität, Capabilities oder Werkzeugauswahl eines Actors.

Die Fläche eines Runs ist ein binärer Baum aus Kacheln und Teilungen,
der den verfügbaren zentralen Bereich füllt, einschließlich Anpassung an die Leiste.
Eine Kachel zeigt genau einen Actor oder eine Mini-App und scrollt ihren eigenen Inhalt. Eine
andere Anordnung gibt es nicht: kein Modus, kein Verschieben, kein Zoom, keine Kamera und keine
freie Platzierung. Kacheln verwenden die Schichtwerk-Flächen, Konturen und Radien, ohne Tiefe.
Mini-Apps füllen die Kachel in Originalgröße ohne einen zweiten App-Kopf. LLM-Kacheln zeigen
ihren Chat, standardmäßig mit Eingabe, und die vorhandenen Kartenbeiträge einschließlich
bedienbarer Rückfragen. TypeScript-Kacheln zeigen ihren Verlauf und ihre Details; ohne
`runs.inspect` erscheinen sie gar nicht auf der Fläche.

Entfernen und Umordnen von Kacheln setzen `runs.inspect` voraus, dasselbe Recht wie die
Actors-Ansicht. Ohne dieses Recht fehlen X und Verschiebegriff in den Kachelköpfen; Köpfe und
Kopfzeileneinträge sind nicht ziehbar, Andockziele und Dropannahme sind gesperrt. Die Trenner
zum Ändern der Größenverhältnisse bleiben bedienbar. Ein Rechteentzug bricht aktives Andocken ab.

Mit diesem Recht entstehen Kacheln durch Andocken: Actors und Mini-Apps lassen sich aus der Kopfzeile ziehen,
bestehende Kacheln an ihrer Titelleiste. Vier Andockziele an einer Kachel teilen sie links,
rechts, oben oder unten; Ziele am Außenrand teilen die ganze Fläche. Eine Vorschau zeigt die
Zielhälfte. Beim Umziehen wird die alte Stelle zusammengeführt, beim Entfernen bleibt der
andere Teil erhalten. Zwischen allen Teilflächen liegt ein ziehbarer Trenner. Er respektiert
die Mindestgrößen beider Teilbäume und ist per Pfeiltasten sowie Home/End bedienbar.
Beim Ziehen aktualisiert nur die lokale Vorschau die Größen, höchstens einmal je Bildschirmframe.
Erst das Loslassen speichert das Verhältnis. Escape, Zeigerabbruch, Fokusverlust oder ein
Wechsel der äußeren Anordnung brechen die Vorschau ohne Speichern ab.
Verschachtelte Teilungen bleiben erhalten. Reicht der Platz nicht für alle Mindestgrößen,
erscheint eine einzelne Kachel mit einer Auswahl zum Wechseln; die Aufteilung bleibt gespeichert.
Verschwundene Inhalte hinterlassen eine entfernbare Hinweiskachel. Neue Teilnehmer bleiben
in der Kopfzeile erreichbar und verändern eine bestehende Kachelanordnung nicht automatisch.

Die Programmanordnung ist Run-Zustand des Plugins mit `{ root: SurfaceTileNode | null }`. Ohne
gespeicherten Kachelbaum - weder vom Programm noch persönlich - teilt die Fläche die sichtbaren
Teilnehmer einmal per abgeleiteter Startaufteilung auf: sichtbare Mini-Apps und alle nicht
gestoppten, nicht persönlich ausgeblendeten Actors. Diese Aufteilung wird nicht gespeichert;
erst eine echte Benutzeränderung - Andocken, Entfernen oder eine Trennlinie - legt den Baum
samt zugrunde liegender Programmanordnung als persönliche Vorgabe je Run im Browser ab
(`ragents.orchestration.tile-presentation:<runId>` mit `{ root, programBasis }`; `programBasis`
ist die Serialisierung `{ root }` der Programmanordnung). Eine eigene Anordnung bleibt bei
unverändertem Programm erhalten, auch nach erneutem Öffnen des Runs. Ändert das Programm den
Baum, folgt die Fläche der neuen Vorgabe und die persönliche Anordnung entfällt.
"Programmvorgabe übernehmen" in der Statusgruppe "Fläche" setzt sie auch vorher zurück;
der Knopf erscheint nur bei vorhandener persönlicher Anordnung.

Ein Programmzustand mit den Altschlüsseln `nodes`, `shapes`, `lines` oder `mode` wird beim
Lesen abgewiesen: "Die Programmanordnung stammt aus der entfernten freien Fläche (<gefundene
Schlüssel>); canvas_layout_replace mit root setzt sie als Kachelaufteilung neu". Der Fehler
steht als Alert über der Fläche, der Run läuft weiter, die Fläche verwendet die abgeleitete
Startaufteilung, und ein Werkzeugaufruf mit `root` repariert den Run. Es gibt weder stille
Toleranz noch eine Migration; ältere Browser-Einträge unter `canvas-presentation`,
`canvas-layout:*:camera/sizes` und `canvas-view` verwaisen.

Die persönliche Actor-Sichtbarkeit liegt getrennt davon je Run im Browser
(`ragents.orchestration.actor-visibility:<runId>` mit `{ actorVisibility }` je Actor-Id). Ohne
eigene Wahl stehen der Primary-Actor und Actors mit eigener Mini-App nicht auf der Fläche, alle
übrigen schon; die Checkbox `Fläche` je Actor in der Actorliste überschreibt das. Sie wirkt auf
die abgeleitete Startaufteilung und auf die Actor-Chips des Run-Panels, nicht auf einen
bereits gespeicherten Kachelbaum. Sie braucht nur Leserechte und verändert weder Actors noch
Programmanordnung oder Journal.

`ragents.orchestration` stellt "Run stoppen" in der Run-Titelleiste für Benutzer mit
Schreibrecht bereit. Sein Werkzeug `run_stop` erlaubt dem
Primary-Actor mit `execution.stopOwned`, den eigenen Run über dieselbe Run-Verwaltung
vollständig zu stoppen. Die Run-Identität stammt aus dem Aufrufkontext. Der Aufruf wartet
nicht auf sein eigenes Turnende; Bereinigungsfehler meldet der Host im Serverprotokoll.

Für die Programmanordnung trägt `ragents.orchestration` das Werkzeug `canvas_layout_replace`
bei. Es hat genau einen Parameter `root`: Pflicht, `null` leert die Fläche. Der Aufruf ersetzt
den Zustand vollständig, ohne den Altzustand zu lesen. Ein Kachelblatt ist
`{ entity: "@handle" | "app:<id>", chatInput?: boolean }`, eine Teilung
`{ direction, weights, children }` mit `horizontal` (links/rechts) oder `vertical` (oben/unten),
zwei positiven Gewichten und genau zwei Kindern, die selbst wieder Teilungen sein dürfen.
Gleiche Gewichte ergeben 50:50, `[2, 1]` zwei Drittel und ein Drittel. Beispiel: `{ root:
{ direction: "horizontal", weights: [1, 1], children: [{ entity: "app:@workspace/main" },
{ entity: "@helper" }] } }`. `chatInput` gilt nur an Actor-Kacheln; `false` blendet die
Chat-Eingabe dieser Kachel aus, ändert weder Rechte noch das Pop-out und bleibt beim Andocken und
Umhängen erhalten.

Der geteilte Vertrag `plugins/ragents.orchestration/contract.ts` parst und prüft die Anordnung
auf beiden Seiten: höchstens 16 verschachtelte Teilungen und 64 Kacheln, eindeutige Teilnehmer,
endliche positive Gewichte, `chatInput` nur an Actors. Der Server prüft zusätzlich, dass jeder
platzierte Actor zum Run gehört, nicht gestoppt und nicht der Mensch im Chat ist, und löst
App-Referenzen `app:@handle/view-key` und `app:program-name/view-key` anhand aktivierter
Actor-Programme zu den internen View-IDs auf; unbekannte, mehrdeutige und zu gestoppten Actors
gehörende Ansichten werden vor dem Speichern abgewiesen. Sichtbarkeit und Fläche verwenden
dieselbe Namensauflösung, auf der Fläche mit `app:`-Präfix; strukturierte Referenzen werden vor
eindeutigen Titeln geprüft, und Fehler nennen gültige Paket- und Actor-Bezüge. Die TypeScript-API
liefert rekursive Typen bis in die verschachtelten Kinder. Der globale Koordinator gibt
Aufteilungswünsche im Run-Auftrag weiter; der Run-Koordinator erhält dafür den Prompt
`plugins/ragents.orchestration/surface.hbs` mit Werkzeugvertrag und Beispielaufteilungen.

`visible: false` nimmt ein bekanntes Flächenelement von der Fläche; seine Kachel verschwindet
und erscheint beim Wiederanzeigen erneut.

Mini-App- und Actor-Kachelköpfe teilen Schriftgröße, Titelgewicht, Icon-Rahmen und Abstände;
Mini-Apps tragen das Raster-Symbol aus der Kopfzeile, LLM-Actors ein Funkensymbol und
TypeScript-Actors ein Code-Symbol. Die Kachelköpfe sind gegenüber ihrer Kachelfarbe um vier
Prozent Schwarz abgedunkelt. Der App-Inhalt nutzt die volle innere Kachelbreite; sein
Scrollbalken liegt direkt am rechten Innenrand.

Die Fläche ist eine native React-Ansicht im Host-Dokument ohne Iframe: Kacheln, Chats und
Eingaben liegen in EINEM Dokument. Unten liegt eine Statusleiste über die volle
Anwendungsbreite, 28 Pixel hoch und mit transparentem, verschwommenem
Hintergrund. Eine feine obere Trennlinie verwendet die Farbe `border`. Der obere Schatten läuft über
den unteren Rand des Arbeitsinhalts aus; Statusgruppen und geöffnetes Journal liegen darüber.
Die Gruppen sind `Journal` und, bei persönlicher Anordnung, `Fläche`. `Actors` steht als
Symbol in der Flächenleiste bei den Apps.
Der Listenknopf bleibt links stehen, während App-Einträge und direkte Actor-Knöpfe gemeinsam
horizontal scrollen. Die durchsuchbare Liste öffnet sich nach unten. Die Gruppen nutzen die
gesamte Leistenhöhe. Links beginnen die Bedienelemente mit 12 Pixel Abstand zum Fensterrand;
kurze senkrechte Trenner mit je 6 Pixel Abstand oben und unten grenzen die Gruppen ab. Gespräche
stehen in den Kacheln und den Actor-Pop-outs.
Eine ausdrückliche App-Auswahl in der Flächenleiste wählt die zugehörige Kachel: Sie geht als
`run-app` an den Flächen-Controller des Orchestrierungs-Plugins (`SurfaceController` mit
`acceptSelection` und `selection`), der auch die Verweise aus Kacheln und Pop-outs annimmt; ein
Artefakt öffnet dabei die Dokumente, jede andere Entität wird die gewählte Kachel und der
Standort, den der Chat dem globalen Koordinator meldet. Ohne angeordnete Inhalte zeigt die
Fläche ihren Leerzustand und lädt zum Ziehen aus der Kopfzeile ein. Die Kacheln zeigen
Anzeigename und `@handle`.
Der Run-Stopp steht in der Run-Titelleiste, mit Bestätigung und den bestehenden
Schreibrechten.

Der Journalbeitrag des Orchestrierungs-Plugins öffnet nach oben eine nichtmodale Fläche,
höchstens 900 Pixel breit und 480 Pixel hoch, begrenzt durch den sichtbaren Viewport.
Sie liest tatsächliche Ereignisse des aktiven Runs aus dessen bestehendem Ereignisendpunkt.
Laden erfolgt nur bei geöffneter Ansicht, bei Änderungen der vorhandenen Run-Revision und
über Aktualisieren; ein zusätzlicher Pollingzyklus entsteht nicht. Neueste Ereignisse stehen
zuerst. Eine Suche berücksichtigt Ereignisinhalt und Actor-Handle. Zunächst werden 100 Treffer
angezeigt; ein Knopf blendet jeweils weitere 100 ein. Einträge öffnen ihren vollständigen
JSON-Inhalt im vorhandenen Codebaustein. Außenklick und Heraustabben schließen die Fläche;
Escape und X schließen mit Fokusrückgabe zum Journalknopf. Die Ansicht verwendet keinen Modal.

Der Arbeitsbereichsreiter `Executions` gehört zu `ragents.orchestration`. Er zeigt die
`typescript_eval`-Aufrufe aller Actors des aktuellen Runs, unabhängig vom ausgewählten Actor
oder primären Chat. Neueste Aufrufe stehen zuerst. Die Liste nennt Actor, Status, Startzeit und Dauer. Die Suche
erfasst Actor, Code, Pfad, Ergebnis, Logs und Fehler; der Statusfilter unterscheidet laufende,
fertige, fehlgeschlagene und unterbrochene Aufrufe. Ein ausgewählter Eintrag zeigt den gespeicherten
TypeScript-Quelltext, bei Dateiausführung den ursprünglichen Pfad, Ergebnis, Logs und Fehler.
Die Ansicht ist schreibgeschützt; sie startet keinen Code und verändert den Run nicht.

Der aktive Reiter lädt den bestehenden Ereignisendpunkt beim Öffnen und bei einer Änderung
der Run-Revision; laufende Zeitangaben zählen lokal weiter. Ein inaktiver oder eingeklappter
Reiter lädt keine Ausführungsdaten nach. Verlassen oder Run-Wechsel bricht laufende Anfragen ab.
Bei einem Ladefehler bleibt der letzte geladene Stand sichtbar; `Erneut laden` wiederholt
ausschließlich die lesende Journalabfrage. Die Anzeige entsteht aus
den journalisierten Aufruf-, Quelltext-, Ergebnis- und Fehlerereignissen; die Identität setzt
sich aus Actor, Turn und Aufruf zusammen. Auch bei fehlgeschlagener Typprüfung bleibt der geprüfte Quelltext sichtbar. Ältere Inline-Aufrufe verwenden ihren damaligen
`code`-Eingabewert. Fehlt bei einem alten dateibasierten Aufruf ein Quelltext-Snapshot, zeigt
`Executions` das ausdrücklich an und liest keine heutige Arbeitsdatei als historische Quelle.
Die native Snippet-Ausführung bleibt auch ohne das optionale Orchestrierungs-Plugin
Server-Grundausstattung; nur dieser Reiter entfällt ohne das Plugin.

Direkte Knöpfe in der Flächenleiste zeigen alle nichtmenschlichen, nicht gestoppten Actors
mit `@handle` sowie Anzeigename oder Actor-Art. Ein Klick öffnet sein Pop-out mit der Actor-Ansicht.
Der primäre Actor des Runs, normalerweise sein Koordinator, erscheint standardmäßig nur in
dieser Leiste. Sein Chat bleibt im Pop-out erreichbar; eine eigene Kachel lässt sich
über die Actorliste ausdrücklich freigeben.

`Actors` öffnet in der Flächenleiste die Liste aller Actors des Runs, einschließlich des
menschlichen Owners und gestoppter Actors. Die Liste öffnet keinen Actor; Gespräche liegen in
den Kacheln und Pop-outs. Der menschliche Owner bleibt
über die Liste erreichbar und braucht keine eigene Kachel.
Jeder Listeneintrag ordnet Handle und Anzeigename nebeneinander an, darunter kompakt Typ,
Status und gegebenenfalls `Mini-App`. Die Checkbox `Fläche` steht rechts und setzt die
persönliche Actor-Sichtbarkeit. Lange Namen und
Metadaten umbrechen innerhalb des Eintrags, auch bei schmaler Liste. Die journalisierte
Sichtbarkeit einer Mini-App bleibt davon unabhängig.

Kachelchat, Actor-Pop-out und der Actor-Chat des Run-Panels verwenden denselben
`ActorChat`-Baustein mit `ChatMessages` und derselben Nachrichtenprojektion. Markdown, Code,
Anhänge und Absenderdarstellung sind dadurch gleich: eigene Antworten des
gewählten Actors erscheinen ohne Sprechblase, andere Beiträge behalten ihre Darstellung.
Chatnachrichten werden mit Streamdown als Markdown einschließlich Trennlinien, verschachtelten
Listen und GFM-Tabellen gerendert. Offene Assistant-Nachrichten verwenden den Streaming-Modus,
der unvollständige Formatierungen vorläufig ergänzt; geschlossene Nachrichten, Benutzertexte
und Systemtexte verwenden den statischen Modus. Der unveränderte Nachrichtentext erhält
Einrückungen und Zeilenumbrüche. HTML aus Nachrichten wird nicht ausgeführt; Links behalten
die Linkbehandlung des Hosts. Die Gestaltung bleibt in der gemeinsamen Chat-CSS.
Der Chatverlauf zeigt den normalen Mauszeiger; Text bleibt markierbar, Eingaben behalten
den Textcursor. Benutzernachrichten mit Text besitzen ein kleines Kopiersymbol, auch in
farbigen Sprechblasen und ohne Sprechblase. Es kopiert den unveränderten Nachrichtentext
einschließlich Markdown und Zeilenumbrüchen; Anhänge behalten ihre Downloadlinks.
Der Knopf liegt ohne eigene Zeile oben rechts über der Nachricht und erscheint bei Hover
oder Tastaturfokus. Auf Geräten ohne Hover bleibt er erreichbar. Er bestätigt Erfolg mit
einem Haken und meldet fehlgeschlagenes Kopieren.
Der Kachelkopf ist 49 Pixel hoch und zeigt mit `runs.inspect` links den Verschiebegriff, dann
Typsymbol, Titel und rechts das X zum Entfernen.
Er besitzt acht Pixel Innenabstand oben und unten, zwölf Pixel seitlich und ein 32 Pixel großes
Symbolfeld. Symbolfeld und Knöpfe besitzen keine zusätzlichen seitlichen Margins;
sie fluchten mit den Inhaltsrändern des Verlaufs. Der Kachelchat verwendet einmal zwölf Pixel seitlichen Innenabstand; Verlauf,
Beiträge und Eingabe stapeln keine zusätzlichen Einrückungen.
Der Kachelchat zeigt keine Zeitstempel. Kachel und Pop-out verwenden den gewählten
Detailgrad für Agenten, von ausgeblendeten Schritten bis zu vollständig sichtbaren Details;
die Aufklappfreigabe bleibt wirksam. Ohne Produktvorgabe gilt `grouped` (siehe unten);
`ChatMessages` ohne Angabe verwendet `current` ("aktuell"). In `current` erscheint während
eines laufenden Chats höchstens der letzte Schritt als gemeinsamer Quassel-Chip: "Denken" oder der laufende
Werkzeugname, mit aufklappbaren Details bei entsprechender Freigabe. Eigene Werkzeugrenderer
werden in diesem Modus nicht verwendet. Ohne Aufklappfreigabe erscheinen nur "Denken" oder
"Werkzeug läuft", ohne Werkzeugnamen und ohne anklickbare Fläche.
Frühere Schritte bleiben ausgeblendet.
Eine folgende Nachricht, das Werkzeugergebnis oder das Turnende entfernt die Anzeige; normale
Nachrichten und Rückfragen bleiben sichtbar. Nachgeschobene eigene Eingaben hinter dem
laufenden Schritt entfernen den Chip nicht. Die gemeinsame Arbeitsanimation bleibt zusätzlich
sichtbar, solange der Agent läuft. Der Run-Chat des Hosts zeigt sie, solange irgendein Agent
oder Programm des Runs einen Turn ausführt und die Verbindung steht; der Platzhalter seiner
Eingabe folgt demselben Signal, der Stoppknopf nur dem Turn seines eigenen Actors (siehe unten). Kacheln und Pop-outs zeigen den Laufzustand
des jeweiligen Actors. Die bisherigen Detailgrade bleiben wählbar; gespeicherte Auswahlen und
explizite Produktvorgaben haben Vorrang. Der Detailgrad `grouped` ("gruppiert") fasst alle
aufeinanderfolgenden Denk- und Werkzeugschritte zwischen zwei anderen Nachrichten zu einer
zugeklappten Zeile "N Schritte" zusammen; solange der letzte Schritt läuft, nennt sie ihn und
pulsiert. Aufgeklappt stehen die Schritte darunter als einzeilige Zeilen wie in `compact`, jede
bei Aufklappfreigabe einzeln per Popover zu öffnen. Der Klappzustand lebt nur in der Ansicht. Das Pop-out zeigt weiterhin Zeitstempel.
Zugänge ohne `runs.inspect` erhalten bei freigegebener Schrittanzeige ausschließlich diesen
aktuellen, nicht aufklappbaren Status. Deaktivierte Schritte bleiben ausgeblendet.
Die Vorgabe aller Chats ist `grouped`; ein Produkt kann sie ohne Aufklappen oder Umschaltung verwenden.
Beide Ansichten verwenden dieselbe Linknavigation.
Der primäre Actor verwendet den vorhandenen Chatstream. Weitere Actors erhalten ihre eigene
Gesprächsprojektion aus dem Journal, mit zugestellten Eingaben, veröffentlichten Antworten,
Denkschritten und Werkzeugaufrufen samt Argumenten, Ergebnissen und Fehlern. Der Host lädt sie
über `ragents.chat.actorHistory` bei Änderungen des Runs nach; die kompakte Run-Ansicht bleibt
ohne Werkzeug-Payloads. Ein Wechsel des primären Actors entfernt keine Schritte aus dem
Gespräch des bisherigen Actors. Ladefehler werden im Chat angezeigt. Die Kachel schneidet die Nachrichtenliste nicht
auf eine feste Anzahl ab. LLM-Kacheln und Actor-Pop-out teilen dieselbe Quassel-Eingabe
mit Anhängen und Detailgradwahl. In der Kachel stehen Textfeld und Aktionen in einer Zeile;
`ChatInputToolbar` verwendet dafür `layout="inline"`. Die Textfläche bleibt eine Zeile hoch,
auch bei längerem Text oder Zeilenumbrüchen. Anhänge und Fehler bleiben separat sichtbar.
Im Pop-out wächst die Eingabe weiterhin bis zu vier Zeilen. Sie sendet mit `runs.write` direkt an den jeweiligen Actor;
bei Lesezugriff ist sie deaktiviert, bei gestopptem Actor ersetzt sie der Stopphinweis (siehe unten). Modell- und Denktiefenauswahl
gehören nicht zu dieser Eingabe. Die Kachel verwendet `ChatPanel` für Verlauf und
überlagerte Eingabe; Fehlerbehandlung und Entwurfswiederherstellung stammen aus der gemeinsamen
`ChatInputToolbar`. Menschen und TypeScript-Actors erhalten keinen Kachelchat.
Eine Kachel mit `chatInput: false` zeigt gar keinen Composer-Bereich.

Actor-Chats verwenden in der Kachel den gemeinsamen Composer-Abstand von `ChatPanel`:
24 Pixel seitlich und 14 Pixel unten. Der Kachelstil setzt keine eigenen
Composer-Abstände. Verlauf und Eingabe nutzen dieselbe verfügbare Breite;
der gemessene Composer reserviert im Verlauf auch seinen Außenabstand.

Der Verlauf ist direkt scrollbar und verwendet das Scrollverhalten von `ChatMessages`:
Am Ende folgt er neuen Nachrichten, beim Zurücklesen bleibt die gewählte Position erhalten.
Größenänderungen des Ausschnitts und seines Inhalts werden dabei berücksichtigt.
Der Leerzustand ist derselbe wie im Actor-Pop-out.
Der innere Scrollbereich ist per Tastatur fokussierbar; PageUp und PageDown bewegen den
Verlauf innerhalb der Kachel.
Der Verlauf ist keine Klickfläche; das Actor-Pop-out öffnen die direkten Zugänge der
Flächenleiste. Verweise im Verlauf (`ablauf:<art>/<id>`) und die Zeilen der Actor-Ansicht gehen
an den Flächen-Controller: ein Artefakt öffnet die Dokumente, alles andere wird die Auswahl auf
der Fläche.
Im Verlauf erscheint die Arbeitsanzeige von `ChatMessages` aus `WorkingScenes` und dem
bestehenden Laufzustand, ohne weitere Datenkanäle. Auch ohne neue Stream-Ereignisse bleibt sie
während eines laufenden Turns sichtbar und verschwindet, sobald der Agent nicht mehr läuft;
das gilt auch nach Fehler oder Stopp. Bei aktivierter Systemeinstellung für reduzierte
Bewegung bleiben die Szenen statisch: sowohl Bildtakt als auch Szenenwechsel pausieren.

Eine TypeScript-Kachel zeigt die Actor-Ansicht des Inspectors ohne Chat-Eingabe: Verlauf,
Detailreiter und den Reiter `Quelltext`. `SourceCode` hebt die TypeScript-Syntax hervor; der
Inhalt ist schreibgeschützt und scrollbar. Fehlt Quelltext in der Run-Ansicht, sagt die Ansicht
das ausdrücklich.

`ragents.actor-programs` trägt den Werkzeuge-Reiter, typisierte Werkzeugkarten und den App-Host
der Fläche zu diesen Slots bei. Jede installierte App ist dort standardmäßig sichtbar;
fehlende Platzierungen ergänzt der Server. Sichtbar geschaltete
Apps erscheinen als volle Flächen in der Flächenleiste mit Artbeschriftung und bis zu
zweizeiligem Titel. Die Hauptfläche schließt eine offene Vollansicht und wählt die zugehörige
Kachel; der separate Vergrößern-Knopf schaltet die Vollansicht um. Die
vergrößerte App bleibt in der Flächenleiste sichtbar hervorgehoben. Der Titel verwendet dort immer
dasselbe Schriftgewicht 700; beim Umschalten der Vollansicht ändern sich Fläche und Unterkante,
aber nicht die Titelbreite oder die Position benachbarter Einträge. Es gibt keine rechten Mini-App-Reiter. Installierte Werkzeuge haben keine eigenen Einträge in der Flächenleiste;
sie bleiben über den Werkzeuge-Reiter erreichbar. Die Laufzeitsichtbarkeit lässt sich über
`actor_view_set_visibility` ändern; ausgeblendete Apps behalten Installation und Zustand.
Eine Mini-App füllt ihre Kachel ohne eigene Kartenhülle, Titelzeile oder Agenten-Icon; den
Titel trägt der Kachelkopf. Im Dialogbereich `surface` lässt sie sich über der Fläche
vergrößern. Genau eine lokale Vollansicht ist offen; ihr Dialog zeigt den
Mini-App-Titel und Schließen-Knopf sowie Rand und Schatten über der weichgezeichneten Fläche.
Titelleiste, Flächenleiste, Statusleiste und Leiste bleiben bedienbar. In der Vollansicht entfällt eine normale Laufzeitstatuszeile.
In der Kachel stehen notwendige Host-Statusmeldungen unter dem App-Inhalt mit 18 Pixeln
seitlichem Innenabstand. Die einzeilige Statusfläche reserviert immer 28 Pixel Höhe,
in der Vollansicht 31 Pixel für Fehlermeldungen. Start, Abschluss und Fehler einer Aktion
ändern dadurch weder die Framegröße noch das Layout der Mini-App. Lange Details werden
gekürzt und bleiben als Hinweis am Text vollständig lesbar. Notwendige Fehler und
Bestätigungen bleiben sichtbar. Die Vollansicht wird nur im Host vom Benutzer bedient;
Mini-Apps haben keine eigene Dialogfähigkeit. Werkzeugformulare stehen weiterhin ohne eigene Fensterhülle direkt in den
Actor-Kacheln; deren Kachelrahmen bleibt erhalten.
Feldbeschriftungen, Eingaben, Aktionen und nötige Laufzeitmeldungen bleiben sichtbar.
Mini-App-Pakete liefern dafür ihren gebündelten Client und ihre Aktionsverträge. Sie registrieren
keine React-Komponenten und laden keinen eigenen Host-Code nach. Das feste Web-Plugin besitzt
Übersichten, Badges, Sandbox-Iframe, MessageChannel-Bridge und Statusanzeige.

Steuerelemente sind kein Registry-Slot: der Host stellt sie als UI-Bibliothek unter
`apps/web/src/ui/` bereit, und Plugins nutzen sie direkt statt eigene zu bauen. Die Bibliothek
sind die shadcn/ui-Komponenten auf Base UI (`components.json` in `apps/web`, Stil `base-nova`),
per CLI in den Quellbaum kopiert und mit Tailwind gestaltet: `Button`, `Badge`, `Toggle`,
`ToggleGroup`, `Tabs`, `Select`, `Dialog`, `Popover`, `Tooltip`, `DropdownMenu`, `Input`,
`Textarea`, `Checkbox`, `Switch`, `RadioGroup`, `Field`, `Label`, `Table`, `Card`, `Alert`,
`Progress`, `Separator`, `Skeleton`, `Spinner`, `Empty` mit ihren Teilen (`SelectTrigger`,
`DialogContent`, `TabsList` usw.), dazu `cn` und Icons aus `lucide-react`. Props, Varianten und
Zusammensetzung sind die von shadcn dokumentierten; die Bibliothek erfindet keine eigenen
Prop-Namen. Eigene Bausteine des Hosts darüber sind `ListDetail`, `SectionLabel`, `SvgEdge`
und, nur im Host, das Seiten-`Modal` in `modal.tsx`. Die Wahl folgt der Rolle, nicht dem
Geschmack:

- `Button` ohne Variante (`default`): die EINE Hauptaktion einer Fläche oder eines Dialogs
  (Starten, Bestätigen, Neuer Run); höchstens eine je Ansicht.
- `variant="outline"`: eine gewöhnliche Aktion mit Rahmen, mehrere dürfen nebeneinander stehen.
- `variant="ghost"`: eine stille Aktion ohne Fläche in Leisten, Reihen und im Composer.
- `variant="destructive"` für Löschendes; der Text sagt, was passiert.
- Icon-Knöpfe sind `Button` mit `size="icon"` (klein `icon-sm`, groß `icon-lg`), einem
  lucide-Icon als Kind und Pflicht-`aria-label`; `title` liefert den nativen Tooltip.
  Schließen und Zurück in Dialogköpfen sind runde Icon-Knöpfe (`rounded-full`) mit X
  beziehungsweise Pfeil. Die Übersichtsecke links in der Kopfzeile ist bewusst kein
  Bibliotheksknopf (siehe unten).
- `size="sm"` in Reihen, Karten und Werkzeugleisten, `size="lg"` für hervorgehobene
  Kopfzeilenaktionen, sonst die Standardhöhe.
- `Toggle` für einen Ein/Aus-Zustand und Filterchips; `ToggleGroup` für genau eine von
  wenigen Optionen (`spacing={0}` als zusammenhängende Segmentleiste) oder eine
  Mehrfachauswahl; `Select` für eine oder mehrere (`multiple`) von vielen, mit `items` für die
  Beschriftungen; `Tabs` für die Navigation zwischen den Ansichten einer Fläche, eine Anzahl
  je Reiter ist ein `Badge` (`destructive` für Punkte, die den Benutzer brauchen, sonst
  `secondary`). Ein Wert ist kein Reiter: `ToggleGroup` wählt eine Option, `Tabs` wechselt
  die Ansicht.
- `Card` ist die EINE Fläche des Hauses: `rounded-panel`, Hostkontur, Kartenfläche und
  `shadow-bar`. Jede statische Fläche und jede Karte ist ein `Card`; Abweichungen stehen als
  `className` daran (`shadow-pop` für Schwebendes, `p-0`, `gap-0`). Schwebende Flächen mit
  eigener Komponente (`DialogContent`, `PopoverContent`) und die Kacheln der Fläche
  bleiben, was sie sind; leichtere Innenflächen in einer Karte bleiben lokale Klassen.
- `SectionLabel` ist die kleine Gruppenbeschriftung in Versalien über einem Abschnitt;
  eine Anzahl daneben rutscht an das andere Ende. Beschriftungen, die eine Überschrift oder
  ein `dt` sind, bleiben ihr Element.
- Native `<select>`, eigene Schaltflächen und Klassen-Verträge gibt es nicht mehr; die eingebauten
  Plugins bringen kein eigenes CSS mit.

Tailwind gilt für die gesamte Oberfläche. Host, Plugins, Mini-App-Bausteine und die
mitgelieferten Mini-Apps schreiben ihre Gestaltung als Utility-Klassen direkt an die Elemente;
Stylesheets mit eigenen Klassenverträgen gibt es nicht mehr. `apps/web/src/ui/theme.css` ist
die einzige Token-Quelle: die shadcn-Variablen (`--background`, `--card`, `--primary`,
`--border`, `--radius` usw.) und die zusätzlichen Hostfarben `shell`, `app`, `surface`,
`border-soft`, `border-strong`, `success`, `warning`, `info`, `teal`, `destructive-soft` und
die Materialfarben `glass-*` stehen dort einmal je Modus, hell und dunkel folgen `data-theme`;
dazu Schrift, die kompakte Abstandsskala mit `header`, `statusbar` und `workspace-inset`,
der Kartenradius `rounded-panel`, die Schatten `shadow-bar`, `shadow-status`, `shadow-pop`,
`shadow-card`, `shadow-workspace`, `shadow-glass-icon` und die Animationen `animate-fade-pulse`,
`animate-working-pulse`, `animate-ring-pulse`, `animate-edge-flow`, `animate-progress-sweep`.
`tailwind.css` ist der Host-Einsprungpunkt mit Preflight; `frame.css` der Einsprungpunkt der Mini-App-Frames.
Das Web bekommt ein einziges Stylesheet vom Server (`/ragents.css`,
`apps/server/src/web-stylesheet.ts`): `@tailwindcss/node` übersetzt `tailwind.css` für die
Kandidaten aus den Quellen unter `apps/web/src` und aus `web/classes.json` jedes Web-Bundles des
Profils, einmal beim Start und minifiziert, im Dev-Modus je Abruf neu. Getrennte Stylesheets je
Plugin gehen nicht, weil Tailwind die Reihenfolge von Utility und Variante festlegt und ein
nachgeladenes Stylesheet Basis-Utilities hinter die Varianten des Hosts stellen würde. Eigenes
CSS eines Plugins (`web/index.css`) verlinkt das Web hinter dem Stylesheet. Die Seiten der
VS-Code-Erweiterung ohne Server baut Vite mit `@tailwindcss/vite`, der Mini-App-Compiler und die
Homepage-Builds nutzen `@tailwindcss/node` (`server/tailwind.ts`) über die Host-Quellen, die
Bausteine und die jeweiligen Mini-App-Quellen. Wiederkehrende Muster sind Komponenten, keine Klassen: Kopfzeilenzellen sind
`ToolbarItem`, `ToolbarCopy`, `ToolbarLabel` und `ToolbarText` aus `apps/web/src/Toolbar.tsx`,
Zähler `Badge`, Leerzustände `Empty`, Meldungen `Alert`, Flächen `Card`, Wartezeichen
`Spinner`. Kontextabhängige Darstellung läuft über `data-*`-Attribute am Rahmen und
`in-data-[...]`-Varianten in der Komponente, etwa `data-tone="material"` an den
Kacheln für Chat und App-Kopf darin. Eigenes CSS bleibt nur für fremd erzeugtes Markup
mit festen Klassen: die Token-Farben von highlight.js (`apps/web/src/highlighting.css`), das
Stylesheet von react-diff-view und die Kanten von xyflow im Flussdiagramm
(`client-ui/flow-diagram.css`). Tests wählen Elemente über Rollen, Beschriftungen, Text oder
`data-*`-Zustände, nie über Klassen.

`Select` öffnet seine Liste in einem Portal über dem Auslöser oder darunter, je nach Platz,
und wird von Composer- und Dialogkonturen nicht abgeschnitten. Escape schließt zuerst das
Menü und fokussiert den Auslöser; Außenklick und Deaktivierung schließen es ebenfalls.

Die gemeinsame `ChatInputToolbar` leert Text und Anhänge sofort beim Beginn einer gültigen
Sendeaktion. Während der Anfrage sind weitere Sendeaktionen und neue Anhänge gesperrt;
Texteingabe bleibt möglich, sofern die aufrufende Ansicht sie nicht ausdrücklich deaktiviert.
Erfolg verändert einen inzwischen neuen Entwurf nicht. Schlägt das Senden ohne zwischenzeitliche
Textänderung fehl, stellt die Eingabe den gesendeten Text samt Anhängen automatisch wieder her.
Andernfalls bleibt der aktuelle Text unverändert und der fehlgeschlagene Auftrag erscheint
separat mit Vorschau. "Nicht gesendete Eingabe einfügen" hängt seinen Text und seine Anhänge
bewusst an den aktuellen Entwurf an; die Anhangsgrenzen gelten auch dabei. Mehrere Fehler bleiben
einzeln abrufbar. Zurücksetzen verwirft Entwurf und fehlgeschlagene Aufträge und ignoriert
verspätete Ergebnisse der vorherigen Anfragen.

Dialoge verwenden für Schließen und Zurück runde Icon-Knöpfe mit X beziehungsweise Pfeil. Das
gilt für Startdialog, Einstellungen, Hilfe, Dokumentdialoge und die Mini-App-Vollansicht sowie
die Zurück-Aktionen in schmalen `ListDetail`-Ansichten; der gemeinsame
`DialogContent` zeigt sonst das X von shadcn oben rechts. Zugängliche Namen und Tooltips
benennen weiterhin die jeweilige Aktion.

Mini-Apps verwenden dieselben Komponenten mit demselben Look; die Mini-App-Laufzeit setzt
`data-ui-surface="mini-app"` am Frame-Wurzelelement nur noch als Marker für Schrift und
Grundmaße. Details zu Formularen, Tabellen, Theme-Bridge und eigenem App-CSS stehen in actor-programs.md.

Journalfläche und globaler Koordinator-Verlauf sind `PopoverContent`-Flächen mit eigener
Öffnungsrichtung und Eckform.

Einstellungen und Hilfe verwenden rechts in der Kopfzeile große Ghost-Icon-Knöpfe. Die übrigen
Haupteinträge verwenden wie die Übersichtsecke die volle Leistenhöhe. Gemeinsame
`app-toolbar-item`-Flächen schließen ohne Zwischenraum aneinander an und sind jeweils durch eine
rechte Trennlinie abgegrenzt. Der Titel des aktiven Runs steht linksbündig und vertikal mittig
ohne zusätzliche Artbeschriftung. Kleine Artbeschriftungen ordnen App, Aktivität, Prozess,
Startoption, Branch oder angemeldeten Benutzer ein; Namen verwenden bis zu zwei Zeilen.
Der App-Eintrag bildet eine durchgehende Kopfzeilenfläche. Rechts neben dem Namen belegt
der Vergrößern-Knopf einen 38 Pixel breiten Abschnitt über die volle Leistenhöhe. Eine
gestrichelte Trennlinie in der mittleren Hälfte der Höhe grenzt ihn ab. Die Klickfläche
bleibt beim Drücken unverändert; das Symbol ist ohne Transform-Verschiebung zentriert.
Hover oder Fokus heben den App-Eintrag gemeinsam hervor; beide Aktionen bleiben getrennt bedienbar.
Die Kopfzeilensegmente verwenden flache Flächen ohne Glanzverlauf oder zusätzliche Innenkanten.
Einstellungen und Hilfe verwenden die gemeinsame Ghost-Darstellung.
Port-Links und Beenden bleiben kompakte Unteraktionen innerhalb der jeweiligen Prozessfläche.

`DialogContent` unterscheidet mit `scope` vier reguläre App-Bereiche (`ModalScope`); das
Seiten-`Modal` des Hosts reicht ihn durch:

- `page` umfasst den gesamten Bildschirm mit Kopfzeile und unterer Statusleiste.
- `run` umfasst den Run-Inhalt zwischen Kopfzeile und Statusleiste; beide Leisten bleiben frei.
- `workspace` umfasst alles unter der Kopfzeile einschließlich der unteren Statusleiste.
- `surface` umfasst nur die Fläche; Kopfzeile, Statusleiste und Leiste bleiben frei.

Der Host liefert Run-, Workspace- und Flächenbereich über `RunModalContext`,
`WorkspaceModalContext` beziehungsweise `SurfaceModalContext` aus `apps/web/src/ui/dialog.tsx`;
das Portal des Dialogs landet in diesem Bereich. Nur der jeweilige Hintergrundbereich wird
inert, außerhalb liegende Leisten bleiben bedienbar; ein Klick dort schließt den Dialog nicht
(`disablePointerDismissal`, Backdrop-Klick schließt weiterhin). Gezielt bereitgestellte lokale
Container bleiben möglich, etwa für die Resetbestätigung über dem globalen Chat. Die
Übersichtsecke öffnet `workspace`, Einstellungen und Hilfe verwenden `page`. Der Tastaturfokus
bleibt im obersten Dialog (`page` modal, sonst `trap-focus`); Escape bearbeitet nur dessen
aktuellen Schritt. Native Steuerelemente wie `<select>` haben in der Oberfläche keinen Platz.

Das Seiten-`Modal` in `apps/web/src/ui/modal.tsx` stellt seinen Inhalten einen typisierten
Dialog-Controller bereit. `useModalController()` verlangt einen solchen Host; außerhalb ist
der Aufruf ein Fehler.
Die Verträge für Seiten und Steuerung stehen in `apps/web/src/ui/modal-controller.ts`.
Der Host bestimmt mit `nextBehavior`, wie ein weiterer Schritt denselben Rahmen verwendet:
`push` ist die Vorgabe und erhält die vorherige Seite mit Rückweg; `replace` entfernt die
aktuelle Seite und erzeugt keinen zusätzlichen Rückweg. Bereits vorhandene frühere Schritte
bleiben auch bei einem Wechsel dieser Hostvorgabe erhalten. Eine neue Seite liefert ihren Titel,
optional Untertitel und initiales Fokusziel sowie ihren Inhalt als Renderfunktion mit Controller.

Die Navigation verwendet einen Rahmen und einen Backdrop. Zurückbehaltene Seiten bleiben
gemountet, sind aber verborgen und inert. Zurück, Escape und Hintergrundklick führen bei
vorhandener Historie zum vorherigen Schritt; ohne Historie fordern Escape und Hintergrundklick
das Schließen an. Das X und `controller.close()` fordern unabhängig von der Historie das
Schließen des gesamten Dialogs an. Alle Schließwege verwenden den `onClose` des Hosts; bis
dieser seine Props ändert, bleibt ein gesperrter oder asynchron schließender Dialog bestehen.
Zurück gibt den Fokus an das auslösende Element des vorherigen Schritts zurück. `open={false}`
setzt die Navigation zurück und hält den Wurzelinhalt verborgen gemountet.
Beim Schließen stellt das Modal den vorherigen Fokus nur wieder her, wenn dieser noch im
Modal oder auf dem Dokumentrumpf liegt. Ein absichtlicher Wechsel aus einem Run-Dialog in
die weiterhin bedienbare Toolbar-Eingabe bleibt erhalten.

`ragents.orchestration` trägt die Flächenkomponente im Web-Slot `surface` bei.
Die Engine selbst stellt nur die generischen Laufzeitmethoden `ragents.runs.*` bereit. Die
Flächenkomponente nutzt diese API, ohne dass der Server eine Fläche kennen
muss. Ihre schreibenden Methoden laufen je Run nacheinander; ein laufender Stopp eines Runs hält
die Methoden anderer Runs nicht auf. Ein Actor-Feld nimmt ID oder Handle und wird wie jede
Actor-Referenz aufgelöst (`actorByReference`, `core.md`, IDs und Handles); dieselbe Regel steht
Plugins über die Host-API zur Verfügung, `@ragents/engine` im Server und
`@ragents/engine/src/http/contracts` in beiden Hälften, dazu `actorByHandle` für Stellen, die nur
Handles annehmen, und `handleKey` für die Schreibweise, in der Handles gespeichert sind.

Git-Änderungen fragen ihre Daten nur bei aktivem Tab ab. Der Ablauf besitzt im
eingebetteten Modus genau einen `RunStore` und ein Kanal-Abonnement. React verteilt dieselbe
`RunView` über einen versionierten Same-Origin-Bridge-Vertrag an Fläche und Pop-outs. Die
Fläche öffnet eingebettet keinen zweiten Stream.

Die Chat-Bausteine bleiben unabhängig: RAgents und Plugins dürfen sie verwenden, sie selbst kennen
nur den Wire-Vertrag der ChatEvents und kein Produkt.
`ChatPanel` und `ChatMessages` nutzen standardmäßig die volle verfügbare Breite mit 24 Pixeln
Seitenabstand. `maxWidth` und `horizontalPadding` passen diese Maße von außen an; die Vorgaben
des Panels gelten gemeinsam für Verlauf und Eingabe. Antworten haben keine zusätzliche
prozentuale Breitenbegrenzung. Zeitstempel bleiben über `showTimestamps` steuerbar. Der separate
`TimestampSwitch` erhält Zustand und Callback vom Host und lässt sich mit eigenen Texten und
einer bei Platzmangel ausblendbaren Beschriftung in die Toolbar setzen.
Der Run-Chat zeigt diesen Schalter neben dem Detailgrad und merkt die Wahl im Browser je Run und
primärem Actor, anfangs eingeschaltet. Eine Einbettung des Run-Chats (`renderChat` im
Flächenbeitrag) gibt mit `ChatDisplayOptions` nur, was sie heute braucht: eine zusätzliche Klasse
(`chatElementClassName`), den Zugriff auf den Scrollbereich (`chatScrollerRef`), Elemente links in
der Eingabeleiste (`toolbarLeft`) und `notice`, das statt des Verlaufs steht, solange es gesetzt
ist; die Eingabe darunter bleibt bedienbar, das Run-Panel zeigt damit seinen Ladezustand
(Abschnitt zum Run-Panel).
Die Darstellungsoptionen sind Props der gemeinsamen Bausteine (`ChatPanel`, `ChatMessages`,
`ChatInputToolbar`); sie erzeugen keine Einstellungen-Oberfläche und keine neuen gespeicherten
Präferenzen:

- `appearance` setzt Schriftgröße, Zeilenhöhe, Nachrichtenabstand und Abstand dichter Schritte.
  Zahlen für Schriftgröße und Abstände sind Pixel, numerische Zeilenhöhen sind Faktoren.
  `ChatPanel` gibt diese Werte gemeinsam an Verlauf und Eingabe weiter; `ChatMessages` kann
  sie bei eigenständiger Verwendung direkt erhalten.
- `timestampOptions` bestimmt `time`, `date-time` oder `relative`, Sprache, Zeitzone und
  optionale Tagestrenner. Relative Zeiten aktualisieren sich alle 15 Sekunden. Tagesgrenzen
  folgen der eingestellten Zeitzone, teilen auch Schrittgruppen und sind unabhängig von der
  Zeitstempelspalte. Fehlende oder ungültige Nachrichtendaten erzeugen weder Trenner noch
  ungültige Datumsanzeigen. Vorgabe bleibt die lokale Uhrzeit im Format HH:MM.
  Der Zeitstempel richtet sich an der ersten Textzeile aus, auch bei Schrittgruppen und
  mehrzeiligen Nachrichten mit unterschiedlichen Innenabständen.
- `codeBlockOptions` steuert Umbruch, maximale Höhe und einen optionalen Kopierknopf für
  Markdown-Codeblöcke. Inline-Code bleibt unverändert; Kopieren übernimmt den Codeinhalt
  ohne Bedienelemente. Vorgabe bleibt horizontaler Überlauf ohne Kopierknopf.
- `bubbleOptions` wählt die bestehende Mischung (`default`), Fließtext (`plain`) oder
  Sprechblasen (`bubbles`), begrenzt deren Breite, setzt die Seite je Rolle und steuert die
  Absenderbeschriftung samt eigener Namensauflösung. Ohne Vorgaben bleiben Nachrichtenvorgaben,
  Owner-Darstellung und vorhandene Absenderlabels erhalten. Ein expliziter Owner bleibt ohne
  Sprechblase; Standardblasen sind auf breiten Flächen höchstens 86 Prozent, mobil volle Breite.
- `messageActions` konfiguriert Kopieren je Textnachricht, Bearbeiten eigener Nachrichten,
  erneutes Anfordern von Antworten und eigene Aktionen. Bearbeiten und erneutes Anfordern
  erscheinen nur mit Host-Callback; die Komponenten verändern weder Journal noch Modelllauf.
  Asynchrone Aktionen sperren weitere Aktionen derselben Nachricht bis zur Rückkehr und melden
  Fehler sichtbar. Standard bleibt Kopieren eigener Nachrichten. `texts` ersetzt die Texte
  einschließlich Aktions- und Zwischenablagefehlern.
- `sendShortcut` an `ChatInputToolbar` wählt `enter` oder `mod-enter` (Strg/Command+Enter).
  Shift+Enter bleibt ein Zeilenumbruch; IME-Eingabe und Tastenwiederholung senden nicht mehrfach.
- `autoFocus` an `ChatInputToolbar` fordert einmalig Fokus an, sobald die Eingabe sichtbar und
  aktiviert ist; Vorgabe ist `false`. Benutzeraktionen oder ein fremder Dialog beenden die
  Anforderung. `onAutoFocusSettled` meldet sowohl Fokus als auch Abbruch an den Host, der damit
  erneuten Fokus nach einem Neuaufbau der Eingabe verhindern kann.
- `scrollOnSend` an `ChatPanel` aktiviert nach erfolgreichem Senden das Mitlaufen und springt
  ans Ende desselben Panels. Der lokale Kontext gilt auch für erst danach eintreffende
  Nachrichten; Fehler und leere Aufrufe erzwingen keinen Sprung. Vorgabe ist `false`: Eine
  bestehende Leseposition bleibt stehen, normales Mitlaufen am Ende bleibt aktiv.
  Ein zurückgesetzter oder entfernter Composer verwirft seine noch ausstehenden Abschlüsse;
  sie scrollen weder eine neue Eingabe noch eine andere Ansicht desselben Panels.

`ChatMessages` kann über `owner` einen Absender bestimmen, dessen Benutzer- und
Assistentennachrichten ohne Sprechblase erscheinen. Der Vergleich verwendet `sender`,
unabhängig von Rolle, Farbe und Beschriftung. Ohne Owner oder mit `null` bleiben die
Nachrichtenvorgaben wirksam. Dieser Darstellungs-Owner vergibt keine Rechte und ist unabhängig
vom menschlichen Owner eines Runs.
Mini-Apps erhalten daraus gebündelte, typisierte Controls unter `UI`. Das Mini-App-Plugin
ergänzt Formulare, Tabellen, Dateiauswahl, Fortschritt sowie Dokument- und Diff-Ansichten und
besitzt auch das automatisch aus den Typverträgen gespeiste Nachschlagewerkzeug. Der Host
enthält dafür keine neuen Fachzweige. Der Chat kann einem Actor desselben Runs folgen oder
Verlauf und Sendeaktion von der Mini-App erhalten (siehe actor-programs.md). Die Actor-Ansicht teilt die
Verlaufsprojektion des Inspectors und verwendet die vorhandene Run-Verbindung. Der Eingabebaustein
wartet auf die Sendeaktion und erhält den Entwurf bei Fehlern. Rückfragen ohne Antwort-Callback
werden als Text mit Optionen dargestellt.

Ein technischer Abbruch beendet das Warten auf `ask_user` und schließt die offene Frage im
Journal als `dismissed`. Das Ask-Plugin liefert daraus keine Benutzerantwort und keinen
neuen ActorInput. Ein ausdrückliches Verwerfen durch den Benutzer erreicht dagegen den
wartenden Aufruf; Antworten auf wiederhergestellte Fragen ohne aktiven Aufruf werden weiterhin
als ActorInput zugestellt.

Jeder Chatverlauf reserviert unter dem letzten Beitrag zwei normale Textzeilen freien
Scrollraum, mindestens die 40 Pixel der unteren Ausblendzone. Eine sichtbare Eingabebox
reserviert zusätzlich ihre gemessene Höhe. Der Abstand gehört zum Inhalts-Padding des
gemeinsamen Verlaufs, auch ohne Eingabe und in Materialkarten. Die Höhenmessung der Eingabe
bleibt beim Neurendern aktiv; Größenänderungen aktualisiert ihr ResizeObserver, ohne den
reservierten Platz zwischenzeitlich zu entfernen.
Manuelles Scrollen ans Ende aktiviert das Mitlaufen wieder. Neue Nachrichten, Streaming und
nachgeladene Inhalte halten dann die tatsächliche Scrollgrenze einschließlich des Fußraums;
Scrollen nach oben pausiert das Mitlaufen. Der Knopf zum Ende aktiviert es ausdrücklich.
Größenänderungen allein schalten das Mitlaufen nicht aus und bewegen keine äußeren Dialoge.
Nur eine tatsächliche Aufwärtsbewegung mit Maus, Touch, Tastatur oder Scrollbar pausiert das
Mitlaufen. Vom Browser durch Inhalts- oder Größenänderungen begrenzte Scrollpositionen
gelten nicht als manuelles Zurücklesen. Ausgeblendete Ansichten behalten ihren Folgezustand.
Der Ende-Knopf erscheint erst bei mehr als 120 Pixeln Abstand zum Ende. `jumpToEndThreshold`
passt diese Sichtbarkeit von außen an, unabhängig vom Pausieren und Wiederaufnehmen des
Mitlaufens. Kleine Aufwärtsbewegungen dürfen daher das Mitlaufen pausieren, ohne den Knopf
sofort einzublenden.

Hat der Actor eines Chats gerade einen Turn und ist die Eingabe leer, zeigt der Chat-Composer
"Arbeit stoppen". Der Knopf unterbricht nur diesen Turn über `ragents.runs.interruptTurn`
(`interruptActorTurn` aus `@ragents/web/api`): der Actor bleibt aktiv und nimmt die nächste
Nachricht an, seine Kinder, andere Actors und der Run laufen weiter. Arbeitet nur ein anderer
Actor, pulsiert die Eingabe, bietet aber keinen Stopp an. Das gilt für den Run-Chat (Partner ist
der Primary-Actor), die Actor-Chats in Kachel, Pop-out und Run-Panel und den globalen
Koordinator. Mit Text oder Anhängen bleibt die Sendeaktion verfügbar. Fehler beim Unterbrechen
erscheinen im betreffenden Chat und erlauben einen erneuten Versuch. Einen Actor dauerhaft
stoppen bietet nur die Actor-Karte ("Stop"), den ganzen Run nur "Run stoppen" in der
Titelleiste; keine Chat-Eingabe ruft `ragents.chat.stop`.

Ist der Actor eines Chats gestoppt, steht an der Stelle der Eingabe `StoppedActorNotice`
(`@ragents/web/chat/StoppedActorNotice`): `@handle gestoppt: <Grund>` und für Zugänge mit
`runs.write` und `runs.inspect` der Knopf "Neu starten" (`ragents.runs.restartActor`); die Knöpfe
der Eingabe links, etwa die Adressatenwahl des Run-Panels, bleiben darunter. Der Run-Chat
behandelt einen als Primary gestoppten Actor (`stoppedPrimaryActorId`, `chatPrimaryId` aus
`@ragents/web/run-view`) weiter als seinen Partner, auch in der Actor-Leiste und im Run-Panel;
nach dem Neustart ist er wieder Primary-Actor und der Chat geht weiter. Der Chat einer Mini-App
nennt den Grund ebenfalls, bietet den Neustart aber nicht an.

Alle Chat-Eingaben nehmen Anhänge über Dateiauswahl, Drag-and-drop und die Zwischenablage an:
Startauswahl, laufender Chat, globaler Koordinator, Actor-Pop-out und Mini-App-Controls.
Der gemeinsame Composer zeigt Bilder und Videos als Vorschau und Dateien mit Name und Größe;
Anhänge lassen sich vor dem Senden entfernen. Auch eine Nachricht ohne Text ist möglich.
Die Grenzen für Anzahl und Gesamtgröße stehen im gemeinsamen Chat-Anhangsvertrag im Code.
Ein Sendefehler erhält Text und Anhänge. Der Run-Verlauf enthält dauerhafte, run-gebundene
Downloadverweise und Medienvorschauen, auch nach erneutem Öffnen.

Der Host fragt bei ausgewählten Anhängen die Eingabefähigkeiten des Zielmodells ab. Bilder
brauchen `image`, Videos `video` und native PDFs `file`; ein Konflikt blockiert das Senden im
Composer. Der Server prüft dieselben Voraussetzungen vor der Annahme erneut. Textdateien werden
als UTF-8-Text zugestellt; andere Dateien benötigen Dateiwerkzeuge beim Zielagenten. Der
OpenRouter-Katalog enthält die vom Anbieter veröffentlichten Eingabemodalitäten. Videos werden
als Videoeingabe übertragen, PDFs mit ausdrücklich nativer Verarbeitung, ohne automatische
OCR-Ausweichverarbeitung. TypeScript-Actors erhalten Dateien als referenzierte Artefakte.

Der Composer-Slot `toolbarLeft` ist nur für den Eigentümer der Fläche erreichbar; einen allgemeinen
Composer-Toolbar-Slot bietet der Host bewusst nicht an.

Ein Run ist im Web zuerst ein ENTWURF: "Neuer Run" in der Übersicht öffnet einen großen
seitenweiten Dialog mit dem zugänglichen Namen "Neuer Run". Der vorherige Run bleibt
darunter erhalten. Der Inhalt beginnt direkt mit der STARTAUSWAHL, ohne sichtbare Titelzeile
oder Untertitel. Ein überlagerter Schließen-Knopf sitzt rechts oben; die Startauswahl hält dafür
Platz frei. In der Startauswahl schließen Escape und Hintergrundklick ebenfalls. Der gemeinsame `Modal` übernimmt
Fokusführung und Fokusrückgabe. Die Startauswahl (`apps/web/src/StartSelection.tsx`) besitzt keine
eigene Run-Statusleiste, keine Fläche und keine Leiste.
Ihr Modal liegt innerhalb der Run-, Startoptionen- und Plugin-Provider der Chat-Ansicht,
damit auch Folgeschritte dieselben Kontexte erhalten.
Der Entwurf ersetzt den aktiven Run in der gemeinsamen Kopfzeile nicht; der seitenweite Dialog
überlagert diese mit dem übrigen Hintergrund.
Schließen verwirft den lokalen Entwurf, ohne einen Run anzulegen. Das Journal entsteht erst
beim Start des Runs.

Die freie Auftragseingabe steht zentriert über der Auswahl. Sie verwendet den originalen
Quassel-`ChatInputToolbar` mit drei sichtbaren Zeilen, wachsend bis acht Zeilen. Derselbe
Breitentoken der Startauswahl begrenzt sie auf 880 Pixel. Die Auftragseingabe hat keine
zusätzliche Überschrift; die Bereiche behalten ihre zugänglichen Namen. Absenden startet den Run.
Modell und Denktiefe stehen als tastaturbedienbare `Select` in der Eingabeleiste neben
Anhängen und Detailgrad. Weitere Startoptionen der Plugins stehen darunter. Der Host zeigt
weiterhin nur wählbare, noch nicht gesperrte Optionen, jeweils an ihrer deklarierten Platzierung.
Legt die gewählte Vorlage eine Option fest, steht sie im Vorbereitungschat statt zur Wahl fest
mit dem Wert der Vorlage (dieselbe Bedienkomponente, gesperrt, Titel "Von der Vorlage
festgelegt"); die Vorschau der Vorlage zeigt dieselben festen Optionen unter "Von der Vorlage
festgelegt". Die Auswahl dafür trifft `shownStartOptions` in `StartOptions.tsx`.
Während Startoptionen geladen oder gespeichert werden, sind Senden und Starten gesperrt.
Auswahl, Vorschau, Prompt-Übernahme und Texteingabe bleiben dabei auch ohne verbundene
Chatleitung bedienbar; diese lokalen Schritte benötigen keine Serverantwort.
Während des Startdialogs pausieren Live-Stream und periodische Abfrage der verdeckten Run-Liste.
Nach dem Schließen werden sie mit einer sofortigen Aktualisierung wieder aufgenommen. Dadurch
bleibt neben bestehendem Run, globalem Chat und Entwurf eine HTTP-Verbindung für Startoptionen
und Sendeaktionen verfügbar.
Der Entwurf abonniert nur den Run-Stream zur Erkennung des Starts. Einen Chat-Stream öffnet
erst der gestartete Run; die Bereitschaft der Startaktionen hängt daher an den geladenen
Startoptionen und der laufenden Aktion, nicht an einem noch leeren Chatverlauf.

Darunter zeigt der gemeinsame UI-Baustein `ListDetail` links eine durchsuchbare Liste aller
Skills und Run-Scripts und rechts die Vorschau des ausgewählten Eintrags.
Vorschaukopf und Aktionsbereich bleiben sichtbar; der Aktionsbereich steht am unteren Rand.
Nur der mittlere Vorschauinhalt scrollt, unabhängig von der Liste. Der Auftrag bleibt oberhalb
beider Bereiche stehen; die Filterleiste gehört zur Liste und weicht mit ihr.
Icons, Artbezeichnungen und semantische Farben unterscheiden die beiden Arten.
Unter 900 Pixeln eigener Breite zeigt der Baustein zuerst die Liste; Auswahl öffnet die Details
als eigene Seite mit "Zur Auswahl" und entsprechender Fokusführung.
Jede Skill-Vorlage hat genau eine verpflichtende `category` als freien, nicht leeren Text; ein
Run-Script darf eine tragen, ohne eine steht es in seiner eigenen Gruppe.
Die Startauswahl gruppiert nach diesem Text über Plugin-Grenzen hinweg und zeigt Überschrift
und Trefferzahl. Die Reihenfolge folgt der ersten nach `order` sortierten Vorlage je Gruppe;
innerhalb der Gruppe bleiben die Vorlagen sortiert. Die Suche berücksichtigt Kategorie, Titel,
Beschreibung, Plugin und Schlagworte. Ein gemeinsames Auswahlmenü filtert zusätzlich nach
Schlagwort. Listenzeilen zeigen Titel, Kurzbeschreibung und Art. Die Vorschau enthält den
vollständigen Prompt, Schlagworte als Filteraktionen und das Plugin. Auswählen ändert nur die Vorschau.

"In Auftrag übernehmen" öffnet den nächsten Schritt im selben Modal. Dort beginnt ein
Vorbereitungs-Chat mit dem editierbaren Prompt im originalen Quassel-Control, zunächst mittig, nach
der ersten Nachricht unter dem Verlauf. `ChatPanel`, `ChatMessages` und `ChatInputToolbar` sowie
dieselben Startoptionen liefern Darstellung, Modellwahl, Denktiefe und Anhänge. Absenden bespricht
den Auftrag mit einer eigenen Vorbereitungsinstanz des Koordinators. Sie verwendet die
Agentenlaufzeit und einen gemeinsamen Grundprompt mit dem globalen Koordinator, ergänzt um die
Vorbereitungsrolle. Erst ein ausdrückliches, sinngemäßes Go des Benutzers zur Ausführung erlaubt ihr
`start_run`; feste Bestätigungssätze gibt es nicht. Detailbestätigungen, zitierte Startbefehle,
Fähigkeitsfragen und der Auftragstext eines Skills sind keine Freigabe. Bei Zweifeln soll das Modell
nachfragen. Der getrennte Knopf "Run erstellen" startet weiterhin direkt, beide über
`ragents.chat.send` mit der Kennung der Vorlage als `entry`. Beide Wege übernehmen den besprochenen
Verlauf, Skill und Anhänge als ersten Run-Auftrag; der Knopf nimmt auch die letzte ungesendete
Ergänzung mit. Modellantworten sind dabei ausdrücklich Vorschläge. Fehler erhalten die Eingabe,
"Besprechung stoppen" bricht die Anfrage ab. Zurück erhält die Startauswahl; der lokale
Vorbereitungsverlauf wird beim Verlassen seines Schritts verworfen.

`ragents.runs.prepare` erhält `RunPreparationRequest` und liefert `RunPreparationResponse`;
der Vertrag steht in `apps/server/src/run-preparation-contract.ts`. Der Host nutzt dieselbe
aufgelöste Koordinatorauswahl wie der spätere Run. `ragents.overseer` liefert den
Vorbereitungsprompt über den globalen Chat-Vertrag; fehlt er, wird die Anfrage abgelehnt.
Jede Anfrage erhält eine eigene speicherinterne Agent-Session mit dem mitgesendeten Verlauf.
Der globale Gesprächskontext, seine Verwaltungswerkzeuge und die Hooks der Plugins werden nicht
übernommen. Das einzige Werkzeug `start_run` merkt die Übergabe vor, ohne Modellargumente
für Auftrag, Kennungen oder Dateien zu verlangen. Erst nach einem erfolgreich abgeschlossenen
Agent-Turn liefert der Server entweder eine Antwort oder den vollständig vorbereiteten
Startauftrag. Der Browser übergibt diesen einmal an denselben Startpfad wie der Knopf.
Die Erkennung des Go liegt beim Modell; eine Schlüsselwortprüfung gibt es nicht.
Dabei entstehen vor der Übergabe weder Run noch Journal oder Arbeitsverzeichnis. Der Verlauf
bleibt im Browser und wird pro Anfrage mitgesendet. Anhänge werden nach Modellfähigkeit
verarbeitet; Dateien, die ein Arbeitsverzeichnis benötigen, werden ausdrücklich abgelehnt.
Bereits gestartete Runs und parallele Vorbereitungsanfragen werden abgelehnt; Schließen,
Löschen und Shutdown brechen laufende Anfragen ab. Abgebrochene, fehlgeschlagene oder verspätete
Antworten starten keinen Run.

Skills stehen in ihren Kategorien, Run-Scripts in einer eigenen Listengruppe. Ein Skill
öffnet den Vorbereitungschat oder zuerst seinen Leitfaden als nächsten Schritt im selben Modal.
Dessen Abschluss führt mit dem bearbeitbaren Auftrag in denselben Vorbereitungschat.
Beim Erstellen des Runs bleibt der ausgewählte Skill mit dem Auftrag verknüpft und wird für
seinen ersten Turn geladen. Der aktuelle, bearbeitete Auftrag hat Vorrang vor einem
Standard- oder Beispielauftrag im Skill. Zurück und Abbrechen erhalten die Startauswahl mit Entwurf,
Anhängen, Filter und Scrollposition. Ein Run-Script öffnet seinen Leitfaden oder startet direkt;
solange die Startanfrage läuft, sind weitere Starts gesperrt. Fehler erscheinen in der Startauswahl.
Ein Run-Script ruft `ragents.chat.start { runId, entry, input }` mit dem Leitfaden-Ergebnis
als `input` auf. Ein Ablauf ohne Koordinator sagt das dazu. Nach Annahme von `send` oder `start` schließt der Startdialog
und öffnet den neuen Run. Zusätzlich beobachtet der Entwurf den vorhandenen Run-Stream: Sobald
der Server einen Run liefert, wechselt die Oberfläche auch bei noch ausstehender Startantwort
in diesen Run. Der Übergang wird nur einmal gemeldet. Während einer laufenden
Run-Abfrage werden weitere Stream-Aktualisierungen zu einer Folgeabfrage zusammengefasst;
langsame Antworten bleiben dadurch auch bei fortlaufenden Events sichtbar. Ein Run-Wechsel
oder Unmount verwirft verspätete Antworten. Ein bereits geschlossener Startdialog kann durch
seine alte Startantwort keinen neuen Entwurf schließen. Eine abgelehnte Anfrage ohne angelegten
Run bleibt als Fehler im Dialog sichtbar. Die
Run-Liste heißt "Runs", der Standardtitel ist "Neuer Run"; ein Run-Script gibt dem Run seinen
Titel.
Solange die Fläche noch keine sichtbaren Inhalte hat, zeigt sie beim Laden und Einrichten
zentral einen animierten Ladebalken mit dem aktuellen Vorbereitungsschritt. Das gilt auch bei
ausgeblendeten Steueractors. Die Anzeige liegt über den Kacheln
und berücksichtigt eine geöffnete Leiste. Nach der
Vorbereitung folgen wartende Inputs und aktive Turns dem tatsächlichen Run-Zustand;
Rückfragen, Fehler und gestoppte Runs ersetzen den Balken durch einen passenden Hinweis.
Sichtbare Inhalte lösen die zentrale Anzeige ab. Die Anzeige erfindet keine Prozentwerte.
Häufige Live-Ereignisse verwerfen keine noch laufende Run-Abfrage: die erste Antwort wird
übernommen, weitere Aktualisierungen werden zu einer anschließenden Abfrage zusammengefasst.
Dadurch bleibt der Startdialog auch bei langsamen Antworten nicht hängen. Bereits geschlossene
Startdialoge ignorieren verspätete Sendeantworten, sodass diese keinen neu geöffneten Entwurf
schließen können.

Die gemeinsame Kopfzeile enthält links die Übersichtsecke und den globalen Koordinator, danach
Titel und Metadaten des aktiven Runs, seine Startoptionen, Run-Status, Fehler und Aufmerksamkeitshinweise. Die Pluginbeiträge
ergänzen sichtbare Apps, Aktivität und Prozesse. Jeder Haupteintrag nutzt die gemeinsame
volle Leistenhöhe und Abgrenzung. Installierte Werkzeugverknüpfungen erscheinen hier nicht.
Die Aktivitätsanzeige liest laufende Werkzeugaufrufe aller Actors aus den `toolCalls` der
projizierten Turns. Subagentenwerkzeuge tragen den Namen ihres Actors; die Identität eines
Aufrufs besteht aus Turn und Call-ID. Sie mischt keine zusätzlichen Einträge aus dem primären
Chatverlauf hinzu. Abgeschlossene, fehlgeschlagene und unterbrochene Aufrufe verschwinden.

Laufende Werkzeuge stehen vor den übrigen laufenden Turns, jeweils das Älteste zuerst.
Solange ein Turn laufende Werkzeuge besitzt, erscheint kein zusätzlicher Turn-Eintrag dafür;
danach kann sein Turn-Eintrag wieder erscheinen. Der primäre Turn bleibt anhand `primaryActorId`
ausgeblendet, seine Werkzeuge bleiben sichtbar. Diese Auswahl erfolgt vor der Begrenzung auf
drei Einträge und der Restzählung. Chatverläufe und ihre Detailstufe werden dadurch nicht erweitert.
Die run-gebundenen `sessionHeaders` stehen zusammen mit Einstellungen und Hilfe in derselben
Leiste. `PluginChat` setzt seinen Beitrag per Portal in diese Leiste und erhält dabei seine
Run-Provider sowie den `RunModalContext`. Eine zusätzliche Titel- oder Platzhalterleiste
über der Fläche gibt es nicht.

Die ÜBERSICHT erschließt Runs und die dafür platzierten Pluginbeiträge. Links oben in der
Kopfzeile sitzt die Übersichtsecke: ein Quadrat von Leistenhöhe mit Funkensymbol. Ein Klick
oder `Cmd+I` auf macOS beziehungsweise `Ctrl+I` öffnet die Übersicht im gemeinsamen modalen
Dialog mit `scope: "workspace"` über dem Runbereich einschließlich der unteren Statusleiste.
Die Kopfzeile bleibt erreichbar. Der globale Koordinator gehört zur Toolbar und erscheint hier
nicht erneut. Die bisherige Aufteilung in Koordinator- und Run-Spalte samt gespeichertem
Breitenregler entfällt.

Ein erneuter Klick auf die Ecke, derselbe Kurzbefehl, Escape oder ein Klick auf den Hintergrund
schließt die Übersicht mit Fokusrückgabe zur Ecke. Der gemeinsame `Modal` übernimmt
Hintergrund, Inert-Zustand, Fokus und Dialogstapel. Ist ein seitenweiter Dialog offen, tut der
Kurzbefehl nichts. Die Übersicht wird beim ersten Öffnen gemountet und bleibt anschließend
verborgen gemountet. Ihr Öffnungszustand wird nicht gespeichert; sie verändert die Aufteilung
nicht. Öffnen der Übersicht schließt einen offenen Toolbar-Verlauf; Öffnen eines Toolbar-Verlaufs
schließt die Übersicht.

Übersichtsbeiträge sind nach `order` sortiert und nach `readRight` gefiltert. Die Run-Liste zeigt in einem responsiven Raster Karten mit Titel,
Bearbeitungsstatus, Erstellungszeitpunkt mit Datum und Uhrzeit, letzter Aktualisierung und den
Plugin-Metadaten. Der Erstellungszeitpunkt kommt unverändert aus dem Journal; während der
Vorbereitung eines noch nicht angelegten Runs fehlt er. Der aktuelle Run ist markiert,
der Leerzustand lautet "Noch keine Runs." Die Auswahl öffnet den Run und schließt die Übersicht.
Das Raster ist nach letzter Journal-Aktivität absteigend in lokale Kalendertage gegliedert:
Heute, Gestern und danach einzelne Datumsüberschriften. Ältere Runs mit neuer Aktivität
erscheinen dadurch wieder oben. Die Karten erhalten einen dezenten farbigen Kopfbereich.
Blau mit Laufsymbol bedeutet laufende Arbeit eines beliebigen Actors des Runs, einschließlich
beauftragter Worker; ohne aktive Arbeit lautet der Status Ruhend oder Geöffnet, nicht Fertig.
Eine zusätzliche violette Markierung nennt Neue Aktivität, wenn die Journalrevision neuer
ist als der zuletzt angesehene Stand. Ohne persönlichen Lesestand lautet sie Nicht angesehen.
Der Browser hält den Lesestand je Benutzer und Run; andere Benutzer und Geräte erhalten keine
Lesebestätigung. Nur ein geladener Run im sichtbaren Browser-Tab und ohne darüberliegende
Übersicht, Einstellungen, Hilfe, Startdialog oder Toolbar-Verlauf aktualisiert ihn.
Listenabfragen und Hintergrundaktualisierungen markieren keinen Run als angesehen. Die
Revision kommt aus dem Journal; bloße Titelverdichtung erzeugt keine neue Aktivität.
Ohne ausdrücklich gesetzten Titel zeigt die Liste zunächst den ursprünglichen Auftrag.
Der Host kann dessen erste 4000 Zeichen im Hintergrund zu einer Titelzeile verdichten: Der
Prompt verlangt drei bis acht Wörter, die gespeicherte Ausgabe bleibt auf 80 Zeichen begrenzt.
Der Modellaufruf verwendet höchstens 48 Ausgabetokens, ausgeschaltetes Reasoning, keine
Client-Wiederholungen und eine Frist von acht Sekunden. OpenRouter wählt Provider bevorzugt
nach Latenz. Ein Fehler wird protokolliert; der ursprüngliche Auftrag bleibt als Listentext erhalten.
Diese Erzeugung verändert weder Run-Titel im Journal noch Agentenaufträge.

Nach dem Speichern eines fertigen Titels meldet der Kanal `ragents.runs` die Änderung an den
Browser. Die Liste wird dadurch ohne Warten auf den periodischen Abruf aktualisiert. Der
Fünf-Sekunden-Abruf bleibt für weitere Metadaten erhalten. Die eigentliche Modellantwort hat
keine garantierte Sofortlaufzeit. Titel aus `run_configure` oder einem vorbereiteten Setup
haben weiterhin Vorrang; gespeicherte automatische Titel bleiben bei Modellwechsel erhalten.

"Neuer Run" ist die einzige Hauptaktion der Run-Liste: die erste Karte der Liste (bei null
Runs die einzige), wie im Run-Panel, und wechselt in den Startdialog. Einzel- und Mehrfachlöschen mit Alle/Keine, Bestätigung und
sichtbaren Fehlern bleiben erhalten; die Profilrechte bestimmen, ob Öffnen, Erstellen oder
Löschen angeboten werden. Ohne Run-Leserecht und ohne sichtbaren Beitrag gibt es keine Ecke.
Die globale Kopfzeile bleibt in einer Leiste. Bei Platzmangel scrollt ihr mittlerer Run-Bereich horizontal; er ist für die
Tastatur fokussierbar. Lange Namen bleiben auf zwei Zeilen begrenzt. Übersichtsecke sowie
Einstellungen und Hilfe bleiben außerhalb dieses Scrollbereichs erreichbar.

Links stehen die Übersichtsecke und die unabhängigen
Toolbar-Beiträge. Der flexible Bereich
daneben zeigt die Angaben zum aktuellen Run; rechts stehen die Reiter der Leiste und ihr
Ein-/Ausklappknopf sowie das Zahnrad-Symbol für Einstellungen und daneben ein Fragezeichen
für die Hilfe. Beide Dialogknöpfe haben zugängliche Beschriftungen. Die Hilfe öffnet die mitgelieferte
Homepage unter `/help/index.html` in einem großen seitenweiten modalen Dialog per Iframe.
Die Seite füllt den Dialog ohne zusätzliche Titelzeile und Innenabstand. Ein überlagerter
Schließen-Button bleibt oben rechts sichtbar; der Dialogname ist für Screenreader hinterlegt.
Die eingebetteten Seiten reservieren in ihrer Kopfzeile rechts Platz für diesen Button,
ohne den eigenständigen Export zu verändern.
Der Run bleibt im Hintergrund erhalten und ist währenddessen nicht bedienbar.
Schließen, Escape (auch innerhalb der Hilfe) oder ein Klick auf den Hintergrund schließen den
Dialog und stellen den Fokus am Hilfeknopf wieder her. Interne Seitenlinks bleiben im Dialog;
externe Quelllinks öffnen einen neuen Tab. Der Tastaturfokus bleibt im Dialog.
Die Hilfe und die statisch geöffnete Dokumentation verwenden kontrastreiche native Scrollbalken.
Der Iframe passt seine Höhe an den verfügbaren Dialogplatz an; die Seite scrollt innerhalb des Frames.

"Sample starten" erscheint in der eingebauten Hilfe nur für Run-Scripts des geladenen Profils
und mit Lese- und Schreibrecht für Runs. Der Host prüft Ursprung, sendenden Hilfeframe und
Vorlagenkennung. Auch die Sample-Links unter den Homepage-Vorschauen starten in der Hilfe
den zugehörigen Run statt zur Referenz zu navigieren. Außerhalb der Anwendung bleiben sie
Links zur Sample-Beschreibung. Ein Klick öffnet die vorhandene Run-Erstellung mit dem gewählten Sample:
ein benötigter Leitfaden erscheint direkt, ein Sample ohne Leitfaden wird sofort aufgebaut.
Fehler bleiben in der Run-Erstellung sichtbar. Auf der eigenständigen Homepage bleiben
Vorschau, Quellen und Startanleitung verfügbar; sie legt keinen Run an.
Der Server liefert unter `/help/` ausschließlich die statische Hilfe aus. Fehlende Hilfedateien
liefern 404, Textreferenzen einen lesbaren Textinhalt. `/help` leitet auf `/help/` um, damit
relative Seitenlinks korrekt auflösen.

`ragents.overseer` liefert den globalen Koordinator als dauerhaften Toolbar-Beitrag rechts
neben den Übersichtsknöpfen. Der Beitrag fragt beim Anzeigen und nach jedem Benutzerwechsel mit
`ragents.overseer.coordinator` die Run-ID des eigenen Koordinators ab und bindet erst dann Chat,
Detailgrad und Anhänge daran; bis dahin bleibt der Platz leer, ein Fehler erscheint als Ausrufezeichen.
Die VS-Code-Erweiterung zeigt keinen globalen Koordinator; sie sieht Koordinatoren auch nicht in der
Run-Liste. Die Eingabe zeigt "Globaler Koordinator" als Platzhalter; eine
separate Überschrift und ein eigener Dropdown-Pfeil entfallen. Eingabe und Status stehen in
einer Zeile; die Eingabe bleibt einzeilig und scrollt bei mehr Text, die Kopfzeile behält
ihre feste Höhe von 45 Pixeln. Der Beitrag ist bis zu 570 Pixel breit. Fokus in das Textfeld
öffnet den Verlauf als nichtmodales Dropdown unter der Kopfzeile. Die Eingabe bleibt oben; im
Verlauf gibt es keinen zweiten Composer. Anhang, Detailgrad, Modell, Reasoning und Zurücksetzen
stehen in einer gemeinsamen Bedienzeile. Bei schmaler Ansicht werden Detailgrad und Reasoning
kompakt dargestellt; der Modellname wird bei Bedarf gekürzt. Der Beitrag besitzt ein Gespräch, einen Entwurf
mit Anhängen und einen Stream, unabhängig vom aktiven Run. Die gemeinsame Composer-Logik
bedient sowohl diese Anordnung als auch die übrigen Chat-Eingaben.

Fokus oder ausdrückliches Öffnen aktiviert den Stream erstmals. Danach bleibt er für Antworten
auch bei geschlossenem Dropdown verbunden, bis die Anwendung endet oder das Leserecht entfällt.
Vor der ersten Nutzung werden keine neuen Antworten gemeldet. Run-Wechsel, Schließen und
Wiederöffnen erhalten Entwurf, Anhänge, Verlauf und laufende Arbeit. Bei unterbrochener Verbindung
bleibt Schreiben möglich, Senden ist gesperrt. Eine gültige Sendeaktion leert den Entwurf sofort;
die gemeinsame Composer-Logik stellt ihn bei Fehlern wieder her oder hält ihn separat abrufbar,
wenn inzwischen neuer Text eingegeben wurde. Enter sendet, Shift+Enter ergänzt eine Zeile. IME-Bestätigung und
gehaltenes Enter versenden nichts. Die Textbox zeigt höchstens zwei Zeilen und scrollt längeren
Text; Anhangsvorschauen stehen kompakt unterhalb und vergrößern die Kopfzeile nicht.

Laufende Arbeit zeichnet denselben pulsierenden Rahmen um die Eingabe wie bei arbeitenden
Agenten in ihrer Kachel. Der Zustand beginnt bereits während der Sendeanfrage und folgt danach dem
laufenden Serverzustand. Die gemeinsame Animation verstärkt Kontur und äußeren Lichtrand
sichtbar und dauert 1,9 Sekunden; bei reduzierter Bewegung bleibt
der hervorgehobene Rahmen ohne Puls bestehen. Ein zugänglicher Status meldet "Bearbeitet";
der Stopp bleibt an der Eingabe. Ein zusätzlicher Spinner oder Hinweis "Neue Antwort" entfällt.
Fehler bleiben sichtbar zugeordnet und werden bei geschlossenem Verlauf oben kenntlich.
Antworten öffnen das Dropdown nicht und verschieben keinen Fokus.

Beim Senden an den globalen Koordinator erfasst die Oberfläche ihren aktuellen Standort:
Startansicht, Run-Übersicht oder geöffneter Run, aktiver Bereich und Reiter sowie eine vorhandene
Elementauswahl, etwa einen Actor. Die Run-Übersicht kann den darunter geöffneten Run weiterhin
nennen; Reiter und Elementauswahl werden nur für die Run-Ansicht mitgegeben. Der Browser
übermittelt nur kleine Kennungen; der Server
ergänzt Run-Titel, kurze Run-Referenz und Actor-Namen. So kann eine Frage wie "Was macht dieser
Actor?" den gerade ausgewählten KI- oder TypeScript-Actor meinen, ohne
dass der Benutzer eine Kennung abschreibt.

Die Orientierung gehört zur abgesendeten Eingabe und bleibt auch bei späterem Run-Wechsel
oder verzögerter Bearbeitung unverändert. Der sichtbare Nachrichtentext enthält keinen
angehängten Kontextblock. Eine Nachricht ohne UI-Angabe erhält keinen aktuellen Standort;
frühere Angaben werden nicht als aktueller Standort übernommen. Ansichtswechsel allein
senden nichts an ein Modell. Der Schnappschuss umfasst keine Screenshots, DOM- oder
Formularinhalte und keinen vollständigen Run-Zustand. Fachliche Einzelheiten liest der
Koordinator bei Bedarf über seine vorhandenen Werkzeuge; die Orientierung erteilt keine Rechte.

Der globale Koordinator kann mit `quick_answer` die aktuelle Nutzerfrage und seine Antwort
kurz wiedergeben, jeweils ein nichtleerer Satz mit höchstens 240 Zeichen ohne Zeilenumbrüche.
Eine neue Kurzantwort zeigt beide Texte automatisch als Toast direkt
unter der Toolbar-Eingabe, nur solange der Verlauf geschlossen ist; bei offenem Verlauf
erscheint kein Toast. Der Toast ist doppelt so breit wie die Eingabe, mindestens 480 Pixel,
und beginnt sechs Pixel unter der gemeinsamen Kopfzeilenkante; Frage und Antwort stehen
untereinander, rechts daneben ein rundes X.
Die Textfläche öffnet beim Anklicken das Gespräch und fokussiert dessen Eingabe,
bei reinem Lesezugriff den Verlauf. Nur das X entfernt den Toast, ohne das Gespräch zu öffnen.
Das Erscheinen selbst verändert weder Fokus noch Öffnungszustand.
Öffnen des Verlaufs und Gesprächsreset entfernen einen bestehenden Hinweis. Die normale
Chatantwort bleibt unabhängig davon erhalten. Das erste Replay zeigt keine alten Kurzantworten.
Nach Wiederverbindung wird die neueste zwischenzeitliche Kurzantwort anhand ihrer
Gesprächsidentität und Journal-Sequenz genau einmal berücksichtigt; erneutes Replay zeigt
verworfene Toasts nicht wieder an. Ein eigener Lesecursor und sichtbarkeitsabhängige
Lesebestätigungen werden nicht geführt.

Das Dropdown hat einen zugänglichen Namen, keine Combobox-Semantik und keine Fokusfalle.
Tab, Fokuswechsel und Klick außerhalb schließen es beim Verlassen des gesamten Bereichs.
Eingabe und Verlauf zählen dabei zusammen. Escape schließt zuerst ein offenes
Auswahlmenü und danach das Dropdown; beim Schließen aus dem Verlauf kehrt der Fokus zur oberen
Eingabe zurück, ohne es erneut zu öffnen. Ein erneuter Klick oder Schreibbeginn
öffnet es wieder. Übersicht und seitenweite Dialoge schließen den Verlauf ebenfalls, erhalten
aber das Gespräch. Die Dropdownhöhe berücksichtigt den sichtbaren Viewport; schmal nutzt
es die verfügbare Breite. Die Eingabe bleibt oben erreichbar, ebenso Übersicht, Einstellungen
und Hilfe.

Der globale Chat verwendet den Detailgrad des Koordinators, ohne Produktvorgabe `grouped`. Sein
Detailgrad bleibt umschaltbar und wird im Browser getrennt von den Run-Chats gespeichert.
Modellwahl, Reasoning, Details und Reset stehen im Dropdown. Die Modellauswahl ist auf den
verfügbaren Platz begrenzt. Erzeugte Runs erscheinen in der gemeinsamen Run-Liste.

`Gespräch zurücksetzen` öffnet einen hervorgehobenen Dialog über der gesamten Dropdown-Fläche.
Der vorhandene Modal-Host begrenzt Backdrop und unscharfen Hintergrund auf den globalen Chat;
dessen übriger Inhalt ist währenddessen inert. Der Fokus beginnt auf Abbrechen. Während eines
laufenden Resets kann die Bestätigung nicht geschlossen werden. Nach Bestätigung leert die
Plugin-Route den globalen Verlauf und Modellkontext; laufende globale Arbeit wird vorher
gestoppt. Eingabe und Modellwahl sind während des Resets gesperrt. Erfolgreicher Reset verwirft
Entwurf, Anhänge und den angezeigten Toast, auch in anderen bereits verbundenen Ansichten. Ein gewöhnlicher
Stream-Neuaufbau verwirft keinen Entwurf. Modell-/Reasoningwahl und normale Runs bleiben erhalten.
Fehler bleiben sichtbar und erlauben einen erneuten Versuch; der Reset erteilt keinen Auftrag.

Ohne Plugin oder Leserecht entfällt der gesamte Beitrag. Bei Lesezugriff ohne Schreibrecht
bleibt die Texteingabe schreibgeschützt und fokussierbar, damit sich der Verlauf weiter durch
Fokus öffnen lässt. Sendefunktionen und andere Schreibaktionen sind gesperrt.
Serververhalten und Werkzeuggrenzen stehen in `core.md`.

Modell und Reasoning-Tiefe des globalen Koordinators lassen sich im Dropdown oberhalb des
Verlaufs einstellen. Dieselbe Komponente steht in den Einstellungen unter Modelle und beim
Plugin `ragents.overseer`. Beide Ansichten teilen einen Zustand; erst eine bestätigte
Serverantwort übernimmt die neue Auswahl. Während des Speicherns sind Auswahl und Senden
gesperrt; ein Fehler erhält die bisherige Auswahl und den Nachrichtenentwurf. Verfügbar sind
die konfigurierten Modelle und deren tatsächlich unterstützte Reasoning-Stufen. Die Auswahl
ist unabhängig von der Sichtbarkeit der Startoptionen normaler Runs.

Web-Plugins tragen bearbeitbare Einstellungen über `settings` bei. Der Host ordnet jedem
Beitrag seine Plugin-Kennung zu, prüft eindeutige IDs und sortiert nach Reihenfolge und ID.
Mit `category: "models"` erscheinen Beiträge im Bereich Modelle, mit `category: "appearance"`
im Bereich Darstellung. Ohne Kategorie bleiben sie auf der zugehörigen Plugin-Seite vor dem
Beitragsinventar. Zugeordnete Beiträge sind dort zusätzlich erreichbar. Der Inventarfilter blendet diese Einstellungen nicht aus. Ohne das Plugin
verschwinden seine Einstellungsoberflächen gemeinsam mit seinen übrigen Beiträgen.

Die Einstellungen öffnen einen seitenweiten modalen Dialog mit `scope: "page"`. Sein Backdrop
umfasst auch die Titelleiste; der Hintergrund ist gesperrt und der Tastaturfokus bleibt im Dialog.

Die Einstellungen starten im Bereich Modelle mit den bearbeitbaren Beiträgen Globaler
Koordinator sowie Neue Runs und Agenten. Der Host ergänzt Überschriften mit seiner eigenen
Modellwahl oder Keine automatischen Überschriften. Größere Kataloge erhalten eine Suche;
Speichern übernimmt den Entwurf, Änderungen verwerfen stellt die bestätigte Auswahl wieder
her. Ein Ladefehler lässt sich erneut versuchen; ein Speicherfehler erhält den Entwurf.
Mit Leserechten ist der gespeicherte Stand sichtbar, Änderungen benötigen Schreibrechte.
Darstellung enthält Theme und Run-Panel.
Diese beiden Bereiche laden unabhängig vom technischen Beitragskatalog. Ein Fehler des
Katalogabrufs blockiert deshalb nicht die vorhandenen Einstellungsformulare.

Plugins enthält das technische Beitragsinventar. "Nach Plugin" zeigt links die
Plugin-Kennungen und rechts deren Details. "Nach Fähigkeit" zeigt Werkzeuge, Prompts,
Vorlagen, Skills, Hooks, Konfiguration und Web über ihre Eigentümer hinweg. Beide
Ansichten verwenden dieselben Detailkomponenten einschließlich Skill-Dateien. Laufzeit zeigt
technische Übersichtsfakten, konfigurierte Modelle, Profile und Systemprompt. Diese Kataloge
sind Leseansichten; neue Modellvorgaben werden im Bereich Modelle bearbeitet.
Skill-Vorlagen zeigen ihren einzelnen Prompt mit einer Kopieraktion.

Die Einstellungsantwort enthält bei Werkzeugen optional die benötigten Ausführungsrechte
als `requiredCapabilities`. Die Browserprüfung akzeptiert dieses Feld als Liste von Namen;
Werkzeuge ohne diese Angabe bleiben gültig. Unbekannte Werkzeugfelder, fehlende Pflichtfelder
und ungültige Feldtypen werden weiterhin abgelehnt.

Die Suche wirkt in beiden Ansichten auf die Beiträge und ihre Zähler; Fähigkeiten ohne Treffer
zeigen einen Leerzustand. Die Plugin-Ansicht behält zusätzlich den Filter nach Beitragsart.
Beim Achsenwechsel bleiben Suchtext und die letzte Auswahl je Achse erhalten. Der direkte Link
zu einem Plugin öffnet dessen vollständiges Inventar ohne Such- oder Beitragsfilter. Bei
schmalen Fenstern stehen die Navigationspunkte in einer Zeile, die seitlich gescrollt werden kann.

Das Run-Panel ist der zweite Einsprungpunkt der Web-App: `run-panel.html` (`apps/web/src/run-panel.tsx`)
lädt denselben Plugin-Host wie `index.html` und zeigt einen Run als schmale Ansicht, die in einem
Browserfenster ab 400 Pixeln Breite und im iframe eines fremden Hosts vollständig bedienbar ist.
`?run=<id>` wählt den Run; ohne `run` zeigt das Run-Panel im Browser die Run-Liste, in der
"Neuer Run" die erste Karte ist und dieselbe Startauswahl öffnet, und mit Run führt der
Zurück-Pfeil links in der Kopfzeile auf sie zurück; im Host `vscode` zeigt es die Run-Liste nie
(Abschnitt zur Erweiterung unten). `?layout=app&run=<id>&element=<id>` zeigt genau ein
Flächenelement in voller Größe. `PluginChat` erhält dafür ein `layout`: `workspace` (Fläche und Werkstatt),
`panel` und `{ element }`. Im Run-Panel bleiben die Run-Provider, die Kopfzeilenbeiträge
(als Portal in die Titelleiste des Run-Panels), der Chat und die Reiter der Leiste; die
Flächenleiste entfällt. Der Flächenbeitrag (`WebPlugin.surface`) kann neben `Center` ein `RunPanel` liefern, das
denselben `SurfaceCenterContext` erhält; ohne `RunPanel` zeigt das Run-Panel nur den Chat.

Die Reiter der Leiste (`workspaceTabs`, `workspaceTabsFor`) stehen im Run-Panel als
Symbolleiste am rechten Rand (`RunPanelRail`, `apps/web/src/run-panel/`), unterhalb der
Kopfzeile über die volle Höhe neben Chat und Mini-App-Bühne: je verfügbarem Reiter ein Knopf mit
dem `Icon` des Beitrags, dem Namen als Tooltip und zugänglicher Beschriftung, dem Badge des
Beitrags klein oben rechts und einem Punkt unten rechts, wenn seit dem letzten Besuch etwas
Neues angekommen ist. Reihenfolge und Sichtbarkeit sind dieselben wie im Web
(`registry.availableTabs`, also `readRight`, `requiresWorkspace` und `available`). Ein Klick öffnet den Tab-Bereich
(`RunPanelWorkspace`) unter dem Chat und der Bühne über die volle Breite des
Run-Panels: ein waagerechter Griff, eine Kopfzeile mit dem Namen des Reiters und einem X,
darunter das `Panel` des Beitrags mit demselben `WorkspaceTabContext` wie im Web. Der Knopf des
offenen Reiters ist gedrückt (`aria-pressed`); ein erneuter Klick oder das X schließt den Bereich.
Besuchte Reiter mit `keepMounted` bleiben verborgen gemountet und bekommen `active: false`,
wie in der Leiste des Webs (`mountedTabs`). Offener Reiter und Höhe des Bereichs liegen je Run
im Browser-Speicher (`ragents.run-panel.workspace:<runId>` mit `{ tab, height }`; `tab: null`
heißt geschlossen, Vorgabe 280 Pixel, mindestens 120, über dem Bereich bleiben 160 Pixel für den
Chat); ein anderer Wert ist ein harter Fehler. Der Griff ändert die Höhe mit der Maus und mit
Pfeil hoch und runter in Schritten von 24 Pixeln. `PluginChat` führt für beide Layouts EINEN
Reiterzustand: im Web den flüchtigen Reiter und den gespeicherten Aufklappzustand
(`ragents.workspacePanelState:<runId>`), im Run-Panel den gespeicherten offenen Reiter; deshalb
öffnet `SessionNavigation.openTab` auch im Run-Panel den Tab-Bereich mit dem verlangten Reiter,
und `activeTabId` nennt ihn, solange er offen und der Reiter verfügbar ist, sonst ist es leer.
Ein gemerkter Reiter, der gerade nicht verfügbar ist (etwa `Executions` vor der ersten
Run-Ansicht), hält den Bereich geschlossen, bis er wieder verfügbar ist. Ohne verfügbaren Reiter
gibt es weder Leiste noch Tab-Bereich; das Layout `app` (eine Mini-App im Editor-Reiter) hat beides
nie. Der Chat meldet dem globalen Koordinator den Reiter des offenen Tab-Bereichs als geöffneten
Bereich, wie das Web den Reiter der aufgeklappten Leiste.
Die Kopfzeile des Run-Panels ist eine Zeile (`RunPanelHeader`): Titel, ein pulsierender Punkt
während der Bearbeitung, das Aufmerksamkeitsabzeichen und ein Chevron; ein Klick auf den Titel
öffnet die Kopfzeilenbeiträge der Plugins, die Run-Metadaten und die Startoptionen als
Popover. Die Pop-outs des Run-Panels (Run-Details, Menü, Adressat) dunkeln wie das Sheet den Rest ab
(`dim` am Popover-Baustein), damit sie sich absetzen. Rechts außen steht ein Menü (`RunPanelMenu`) mit Einstellungen (derselbe Dialog wie in
der Web-App), im Host `vscode` "Im Browser öffnen" und bei angemeldetem Benutzer "Abmelden"; auch
die Run-Liste ohne Run und die Kopfzeile des Ladezustands vor einem Run tragen es. `ragents.orchestration` liefert das Run-Panel (`web/run-panel/`): Mini-Apps sind die
Flächenelemente mit `visible !== false`; genau eine bekommt die Bühne ohne Chipzeile und ohne
Überschrift, erst ab zwei erscheint eine Chip-Reihe darüber (ein `!` bei offener Host-Bestätigung
oder Rückfrage des besitzenden Actors). Die Bühne zeigt die gewählte App mit
`presentation: "tiled"`; ihr Knopf für die Mitte oder die Vollansicht erscheint erst beim Zeigen
oder Fokus rechts oben.

Bis der Run Inhalt hat, steht im Chat statt des Verlaufs ein Ladezustand (`useRunPanelStartup` in
`web/run-panel/run-panel-startup.ts`). Inhalt ist eine Mini-App oder ein Gesprächsbeitrag: eine
Nachricht des Benutzers, eine Antwort mit Text oder Anhang, eine Rückfrage; Systemzeilen und
Arbeitsschritte zählen nicht, denn schon die Vorbereitung des Arbeitsbereichs schreibt eine
Systemzeile. Was dort steht, bestimmt dieselbe Logik wie auf der Fläche
(`surfaceStartupState`): der Verbindungsaufbau, die Vorbereitung mit der Meldung des Servers, die
Arbeit der Actors, eine offene Rückfrage, ein gestoppter Run und als Fehler ein gescheiterter oder
abgebrochener Aufbau oder ein nicht erreichbarer Run-Status, alles an derselben Stelle und in
derselben Darstellung (`StartupNotice` in `apps/web/src/ui/startup-notice.tsx`: Titel, bei
laufender Arbeit ein Fortschrittsbalken, darunter was gerade geschieht). Das Run-Panel reicht ihn
als `notice` an `renderChat` und an den Chat eines anderen Actors; die Eingabe bleibt bedienbar,
der Hinweis steht mittig und rückt nur hoch, wo er sonst unter die Eingabe geriete. Mit dem ersten
Inhalt endet der Ladezustand und kehrt für diesen Run nicht wieder. Endet eine Arbeit, während der
Chat verbunden ist, bleibt die letzte Anzeige bis zu 1,5 Sekunden stehen, bis die Run-Ansicht
nachgezogen hat; so flackert der Übergang vom Startstatus des Servers zur Arbeit eines Run-Scripts
nicht. Der Verbindungsaufbau hält nichts fest: ein leerer, untätiger freier Run zeigt nach dem
Verbinden keinen Ladezustand.

Das Run-Panel kennt drei Ansichten: "Nur Chat" (`chat`), "Chat unten" (`bottom`) und "Chat rechts"
(`side`, Vorgabe). Eine Segmentgruppe oben in der Kopfzeile des Run-Panels schaltet um, drei Icon-Knöpfe
mit `aria-pressed`: Sprechblase, PanelBottom und PanelRight. Sie erscheint, sobald eine Mini-App
gewählt ist, auch in "Nur Chat". "Chat rechts" bleibt gesperrt, solange das Run-Panel schmaler als
die eingestellte Breite ist; der Hinweis am Knopf nennt den Grund. Die Wahl gilt je Run,
überlebt den Neustart und verhält sich in der VS-Code-Erweiterung wie im Browser.

Daraus ergibt sich die Lage des Chats: ohne gewählte Mini-App und in "Nur Chat" füllt er das
Run-Panel; sonst liegt er rechts neben der Bühne, wenn das Run-Panel mindestens die eingestellte
Breite hat (Vorgabe 900 Pixel) und "Chat rechts" gewählt ist, andernfalls unten als Sheet. In
"Nur Chat" ist die Bühne nicht sichtbar; Chip-Leiste der Mini-Apps, Griff, Statuszeile,
Verdunkler und der senkrechte Griff entfallen ebenso, und nichts fährt rein oder raus. Die
Mini-App wird dabei abgebaut und beim Zurückschalten neu aufgebaut, ihr flüchtiger Zustand geht
also verloren. Ein Wechsel aus dem offenen Sheet nach "Nur Chat" schließt es sauber.

Mini-App und reservierter Chatbereich haben einen durchgehenden Hintergrund in der
Grundfarbe der Mini-App (`--app`). Der äußere gemeinsame Rahmen hat oben und unten gerade
Ecken. Der Platz für den eingeklappten Chat bleibt reserviert, damit er keine App-Inhalte verdeckt.
Das Sheet liegt am unteren Rand (seitlich frei, oben abgerundet, mit Rahmen, Kartenhintergrund
und Schlagschatten auch im eingeklappten Zustand). Der Griff sitzt in einer kompakten Zeile;
Tastaturfokus markiert nur den kleinen Balken, nicht die gesamte Zeile.
Die Statuszeile nutzt denselben horizontalen Abstand wie die Chat-Eingabe; ihre linke Kante
ist mit dem Eingabefeld bündig.
Zugeschoben zeigt es immer nur Griff, eine Statuszeile und die Eingabe (die
Statuszeile nennt eine offene Rückfrage, sonst was der Adressat gerade tut, sonst die letzte
gesprochene Zeile mit Absender). Bei Maus darüber (nach der eingestellten
Verzögerung, Vorgabe 160 Millisekunden), Fokus in der Eingabe oder Klick auf den Griff gleitet
es auf die gewählte Höhe (standardmäßig 90 Prozent der verfügbaren Höhe) über die abgedunkelte Bühne; verlässt die Maus das Sheet, gleitet
es nach der zweiten Verzögerung (Vorgabe 150 Millisekunden) zurück, nach Fokusverlust nach
festen 220 Millisekunden. Escape, ein Klick auf die Bühne
oder den Griff senken es sofort; ein offenes Pop-out oder der Fokus in der Eingabe halten es
oben. Der Griff ist zugleich ziehbar: Hochziehen vergrößert die ausgeklappte Höhe,
Herunterziehen verkleinert sie bis zum gemessenen Minimum aus Griff, Statuszeile,
vollständiger Eingabe und Rahmen. Die Messung berücksichtigt auch mehrzeilige Eingaben.
Die maximale Höhe beträgt 90 Prozent der verfügbaren Höhe. Während des Ziehens pausieren
Automatik und Höhenanimation; danach bleibt der Chat auf der gewählten Höhe geöffnet.
Beim Einklappen kehrt er immer zum gemessenen Minimum zurück. Ein Ziehen löst keinen
anschließenden Klickwechsel aus. Pfeil hoch und runter verändern die ausgeklappte Höhe am
fokussierten Griff und öffnen den Chat, Home und End wählen Minimum und
Maximum; Escape bricht ein laufendes Ziehen ab. Breite und beide Verzögerungen stehen unter
Einstellungen, Darstellung, Run-Panel und liegen im
Browser-Speicher (`ragents.orchestration.run-panel-settings`). Der Koordinator
zeigt den Hauptchat (`renderChat`), ein anderer Actor seinen Verlauf mit den Kartenabschnitten der
Plugins und eigenem Composer. Der Adressat steht als Chip in der Eingabeleiste; sein Pop-out listet
die Actors nach der Actor-Anzeige der Kopfzeile (`actorVisibleInHeader`, Vorgabe `Sichtbare`,
hier die persönliche Actor-Sichtbarkeit; Koordinator und gewählter Actor bleiben immer dabei),
die ausgeblendeten
hinter ihrer Zahl mit Suche und die Anzeigewahl im Fuß. Daneben nennt die Leiste den ersten
arbeitenden anderen Actor mit Spinner und wartenden Eingaben. Gewählte App, gewählter
Actor, Ansicht (`chat`, `bottom` oder `side`), Chatbreite und ausgeklappte Sheet-Höhe liegen
je Run im Browser-Speicher
(`ragents.orchestration.run-panel:<runId>`); ein gespeicherter Zustand ohne Ansicht gilt als
`side`, ohne Chatbreite als 380 Pixel und ohne ausgeklappte Sheet-Höhe als 90 Prozent der verfügbaren Höhe.
Die früheren Werte `auto` gelten als `side`, `floating`
und `docked` als `bottom`, eine gespeicherte Bühnenhöhe wird übergangen; jeder andere Wert ist
ein harter Fehler.

Das Run-Panel spricht über `apps/web/src/run-panel/host.ts` mit seinem Host. Der Host `browser`
(Standard) öffnet Links selbst und kennt keine Mitte; der Host `vscode` (`?host=vscode`, nur
eingebettet) sendet `ready`, `runChanged`, `showStart`, `openInCenter`, `returnToRunPanel`, `login`, `logout`,
`openExternal` und `openPage` per `postMessage` an das umgebende Fenster und nimmt von dort `selectRun`, `newRun`
(mit vorbelegten Startoptionen und optional der Kennung einer Vorlage, die die Startauswahl dann
gleich öffnet), `placements` (welche Elemente eines Runs in der Mitte liegen) und `theme` entgegen; der
importfreie Vertrag steht in `run-panel/host-contract.ts`. Nach `newRun` im Host `vscode` fokussiert
das Panel die sichtbare, schreibbereite Chat-Eingabe einmalig, bei Vorlagen nach erfolgreichem
Start. Es wartet auf die Chat-Verbindung. Vorhandene Runs, Browser-Ansichten und reine Mini-Apps
erhalten keinen solchen Startfokus; erneute Verbindungen oder Nachrichten holen ihn nicht zurück.
Kann das Panel ein `newRun` nicht ausführen, weil das Recht auf neue Runs fehlt oder ohne
`runs.create` ein freier Run verlangt ist, zeigt es statt des Ladezustands den Grund und "Zur
Start-Seite" (`showStart`).
`?theme=light|dark` setzt die Darstellung
beim Laden. Läuft die Seite ohne Anmeldecookie, trägt sie den Zugangstoken aus `?access=`:
`apps/web/src/access-token.ts` hängt ihn als `Authorization: Bearer` an jeden Abruf an den
eigenen Server und als Abfrageparameter an Adressen ohne Header (Mini-App-Frames).
Ein Host, der Webseiten zeigen kann, stellt sich der Oberfläche als `PageOpener`
(`apps/web/src/page-opener.tsx`) bereit: Fachplugins mit einer Anwendungsvorschau fragen ihn
zuerst und öffnen eine laufende Anwendung dann dort statt im eigenen Dialog mit iframe; in VS Code ist das ein Reiter des Simple Browser
(`openPage`), im Browser gibt es keinen Host und der Dialog bleibt. Verlangt der Server dann eine Anmeldung, zeigt das Run-Panel im Host `vscode` statt des Formulars
die Bitte an den Host (`AccessGate` mit eigenem `Login`). Die Mini-App-Frames erlauben als
Vorfahren neben der eigenen Herkunft die Webviews von VS Code (`https://*.vscode-cdn.net`,
`vscode-file:`, `vscode-webview:`).

Die VS-Code-Erweiterung unter `apps/vscode` ist ein solcher Host, und zwar für mehrere Server
zugleich: jeder konfigurierte **Server** (ein RAgents-Server per Adresse oder ein lokales Profil) hat
seine eigene Sitzung mit Verbindung, Runs, Vorlagen und Arbeitsplatz. "Server" ist der Name in jedem
sichtbaren Text; im Code heißen die Typen `Connection*`. Ohne gewählten Run zeigt das Panel in
der zweiten Seitenleiste eine von drei Seiten - Start, Runs oder Server; sie sind eine eigene
Seite der Web-App (`panel.html`, `apps/web/src/panel/`), die ohne Server läuft und ihren Zustand als
`PanelState` von der Erweiterung bekommt und ihre Aktionen als `PanelAction` zurückschickt. Mit
gewähltem Run steht dort das Run-Panel seines Servers als iframe; je Mini-App kommt ein Editor-Reiter
mit `layout=app` dazu. `PanelState.page` trägt deshalb vier Werte (`start`, `runs`, `run`,
`connections`), und die Aktion `page` nur die drei, auf die das Panel selbst umschalten darf; mit
`connection` gibt der Chip auf Start der Seite Runs ihren Server mit, die Erweiterung reicht ihn
als `PanelState.runsConnection` zurück. Die Wege zwischen den Seiten und die Befehle (Start, Runs,
Server, Neuer Run, Aktualisieren) stehen ausschließlich im `view/title`-Menü der Ansicht; die
Seiten selbst tragen keine Symbole dafür (`panel/PanelHeader.tsx` hat nur Zurück-Pfeil und Titel,
Start keine Kopfzeile), und die Befehle `ragents.showStart`, `ragents.showRuns` und
`ragents.showConnections` wirken auch, während das iframe des Run-Panels steht. Einfügen, Kopieren und Ausschneiden führt das Run-Panel im Host `vscode` selbst
aus (`installClipboardBridge`, `apps/web/src/run-panel/clipboard.ts`): macOS liefert diese Befehle über
das Menü der Anwendung, und VS Code reicht sie nur an das Dokument seines Webviews weiter, nie in
ein iframe fremder Herkunft. Den Text der Zwischenablage holt das Run-Panel deshalb über die Hülle
(`clipboardRead` und `clipboardText` in `host-contract.ts`), die ihn als einzige lesen darf; die
Erweiterung sieht diese Nachrichten nicht. Unbehandelte Tastendrücke und das Loslassen gibt das
Run-Panel über `installKeyboardBridge` als `keyboardEvent` an die Hülle weiter. Diese prüft Quelle,
Herkunft und Nachrichtenform und löst dort ein `KeyboardEvent` aus; VS Code verwendet seine normale
Tastenbelegungsauflösung einschließlich eigener Belegungen und Tastenkombinationsfolgen. Die
Nachrichten gehen nicht an den Extension-Host. Einfügen, Kopieren, Ausschneiden, lokale
Textbearbeitung, IME und bereits behandelte Tasten bleiben im Chat. Normale Zeicheneingabe wird
nicht unterdrückt; Druck-, Such- und Speicher-Browserdefaults werden vor der Weitergabe verhindert.
Die asynchrone Frame-Grenze liefert keine synchrone Rückmeldung über getroffene Belegungen;
lokale Bearbeitungstasten haben deshalb Vorrang. Einen Explorer-Baum daneben gibt es nicht mehr: Start und
Runs zeigen dieselben Server, Runs und Vorlagen flacher, und ein zweiter Navigationsbaum wäre
eine zweite Wahrheit. Jede Sitzung spricht dieselbe
Nachrichtenschicht mit demselben Client (`RpcClient` mit eigenem `fetch` und Bearer), hält ihren
eigenen Ereignisstrom, meldet sich mit `POST /api/access/login` selbst an und liest ihre
Vorlagen aus `ragents.plugins.bootstrap` ihres Servers; Bedienung und Grenzen stehen in
`docs/usage.md`.

**Ein Vokabular für alle Seiten.** Je Zustand gibt es genau ein Wort und genau ein farbiges Symbol;
im Panel steht das Symbol, das Wort nur im `title`. Die Wörter liegen in
`apps/web/src/ui/state-vocabulary.ts` (ohne React, damit die Erweiterung sie mitlesen kann), die
Symbole und Farben in `ui/state-icon.tsx`. Ein Run läuft, wartet auf Eingabe (mit der Zahl offener
Eingaben daneben), ruht, ist beendet, fehlgeschlagen oder abgebrochen; ein Server ist verbunden,
bereit, startet, verlangt eine Anmeldung, ist nicht erreichbar oder gestoppt, dazu gescheitert und
kein Zugriff als die beiden Fehlerfälle. `panel/connection-state.ts` bildet `ConnectionView` darauf ab: ein
verbundenes lokales Profil ist **bereit**, ein verbundener Server **verbunden**. Kein Plugin-,
Werkzeug- oder Mini-App-Name erscheint je als Zustand. Die Zeit ist kompakt und ohne "vor"
(`ui/relative-time.ts`): `jetzt` unter einer Minute, dann `5 min`, `3 h`, `1 d`, `2 d`, ab sieben
Tagen das Datum `13.09.`; die ausgeschriebene Form steht nur im `title`. Kein Zustandssymbol trägt
je die Stopp-Glyphe (ein Quadrat, allein oder im Kreis): abgebrochen und nicht erreichbar sind ein
Kreis mit Schrägstrich, beendet ein Haken im Kreis, ruhend und gestoppt ein leerer Kreis. Jeder
echte Stopp-Knopf kommt aus `ui/stop-button.tsx`: `StopGlyph` ist das gefüllte Quadrat in
`--destructive`, `StopButton` der Knopf dazu (Symbol, Wort im `title`, gleiches Hover und Disabled),
und `RunPanelApp`, `ChatInputToolbar`, `ragents.processes` und der Menüeintrag "Run stoppen" von
`ragents.orchestration` nutzen nur ihn. Der Begriff ist im ganzen Web "Run", nie "Lauf": das Beenden
des ganzen Runs heißt überall "Run stoppen", das Unterbrechen des laufenden Turns im Chat "Arbeit
stoppen".

**Start** ist die Startseite und hat keine Kopfzeile. Die **Server** stehen als eigener Block
ganz oben, mit Zahl in der Überschrift, und filtern nicht: gleich breite Chips in einem Raster -
zwei je Zeile bei 420 Pixeln, alle in einer ab 560 (Container-Query `@[560px]/panel`). Jeder Chip
ist ein geteilter Knopf: der linke Teil ist ein `button` mit `aria-label`, Zustandssymbol, Name und
einem Aktionswort in gedämpfter kleiner Schrift, das vom Zustand abhängt ("Anmelden" bei
`login-required` und `forbidden`, "Erneut versuchen" bei `unreachable` und `failed`, "Starten" bei
einem gestoppten Profil und "Verbinden" bei einem gestoppten Server, "Runs" bei `connected` und
`ready` mit der Aktion `page` samt `connection`, "startet ..." bei `starting` als gesperrter
Knopf); darunter in der Monoschrift der Zeit die Zielzeile aus `ConnectionView.route`
(`panel/connection-state.ts`, `routeLabel`): `lokal · <profil>`, der Host des Servers oder
`<host> · lokal`, wenn ein Server ein Client-Profil verteilt hat. Die Erweiterung liefert `route`
aus der Verbindung und `ConnectionSnapshot.localHost`; die Seite rät nichts aus Pfaden oder Adressen.
Der rechte Teil ist das Plus hinter einer feinen Trennlinie: es schickt `newRun` mit dem
`entryId` aus `ConnectionView.defaultEntry`, wenn das Profil des Servers eine Default-Vorlage nennt,
sonst ohne `entryId` als leeren Chat; ohne Startrecht steht dort ein leerer Platzhalter gleicher
Breite. Bei `failed`, `unreachable` und `forbidden` ist das Zustandssymbol ein eigener Knopf
("Fehler von <Server> anzeigen"), der ein `Popover` mit dem Zustandswort als Titel, der
Meldung aus `ConnectionState.message` (`stateDetail`, dieselbe Quelle wie die Seite Server) und
den Knöpfen "Ausgabe öffnen" (Aktion `showOutput`, die Erweiterung zeigt den Kanal RAgents) und
dem Aktionswort des Chips öffnet; das Popover überlebt den kurzen Zustand `connecting` eines
automatischen Neuversuchs und schließt sich, sobald der Server wieder ohne Fehler ist. Bei
`login-required` öffnet das Schloss den Anmeldedialog ("Anmeldung an <Server>"); in allen
anderen Zuständen hat das Symbol keine eigene Aktion. Der eigene Symbolknopf ist 32 Pixel breit
und zentriert das Symbol; der anschließende Inhalt beginnt mit 8 Pixel Innenabstand. Darunter
**Weiter** mit den letzten fünf Runs aller
Server in `RunList` (`panel/RunLine.tsx`): ein CSS-Grid mit den Spalten Zustand, Titel, Zeit
und ab zwei Servern Server, im Auswahlmodus davor das Kontrollkästchen; jede Zeile und ihr
Knopf sind `grid-cols-subgrid`, damit die Spalten in allen Zeilen an derselben Kante stehen, und
"Alle N Runs" führt auf die Seite Runs. Kann die Erweiterung die Run-Ansicht eines Runs nicht
lesen, etwa wegen eines ungültigen Programmzustands, bleibt er als Zeile mit dem Grund stehen
(`ConnectionRun.problem`, ein rotes Hinweissymbol mit Tooltip); die übrigen Runs, das Abzeichen und die
Statusleiste bleiben davon unberührt. Darunter **Neu**, sobald ein Server verbunden ist und
neue Runs erlaubt: je solchem Server zuerst seine Default-Vorlage - die Vorlage aus
`ConnectionView.defaultEntry` mit dem Kennzeichen "Standard", ohne Default der Eintrag "Neuer Chat"
(Kategorie "Ohne Vorlage", gestrichelte Kante, Plus-Symbol, `newRun` ohne `entryId`) -, danach
alle übrigen Vorlagen aller Server flach, der Default nicht ein zweites Mal; die
Zahl in der Überschrift zählt alle Einträge. Ein Eintrag zeigt Kategorie,
Titel, zwei Zeilen Beschreibung, unten "Starten", bei einer Vorlage mit Leitfaden wie in der
Web-App "Einrichten" (`ConnectionEntry.guided` aus `guide` der Vorlage), und rechts den Server; Skill rund und
`--primary`, Run-Script eckig und `--success`, das Raster
`repeat(auto-fill, minmax(182px, 1fr))`. Eine Suche gibt es hier nicht, und `ListDetail` passt
nicht, weil er sich nach eigener Breite misst und bei 420 Pixeln zur Liste mit Detailseite würde
(Entscheidungen vom 19. und 21.09.2026).

**Runs** ist dieselbe zusammengeführte Liste, nur vollständig: Suche über Titel und Server,
"Beendete ausblenden", der Serverfilter aus `PanelState.runsConnection` als gedrückter Schalter
mit dem Namen (ein Klick hebt ihn auf; die Seite wird je Server neu aufgebaut) und ein
Auswahlmodus mit Kontrollkästchen, der die Zahl in einer Leiste unten
nennt und mehrere Runs nach einer Rückfrage im Dialog löscht. Das Löschen selbst ist Sache des
Hosts: die Seite schickt `deleteRuns` je Server mit den Kennungen, die Erweiterung ruft
`ragents.runs.delete` und frischt die Liste auf.

**Die Startauswahl des Run-Panels braucht der Host `vscode` nur für Leitfäden.** Ein Klick auf eine Vorlage schickt
`newRun` mit `name` und `entryId`; die Erweiterung legt den Run auf diesem Server an (gebunden an
sich selbst als Arbeitsplatz mit dem Arbeitsbereichsordner, außer die Vorlage legt den Arbeitsbereich selbst fest;
dann fragt sie auch nach keinem Ordner, `preselectable` in `overview-model.ts`), das Run-Panel
setzt im Host `vscode` die Startoptionen, die die Vorlage nicht festlegt
(`withoutFixedStartOptions`), ruft für ein Run-Script `ragents.chat.start` mit dem Startwert `null`
und für einen Skill `ragents.chat.send` mit dem vorbereiteten Auftrag des Skills und der
Vorlage als `entry`, und öffnet sich danach auf dem
laufenden Run (`startLaunch` in `run-panel/RunPanelApp.tsx`). Nennt die Vorlage einen Leitfaden
(`registry.guideFor`), startet das Run-Panel sie nicht selbst, sondern nimmt den Weg der Web-App:
die Startauswahl mit dieser Vorlage (`initialEntryId`), darin `openStartEntry` mit dem Leitfaden,
dessen Ergebnis der Startwert ist; nach dem Start öffnet sich das Run-Panel auf dem neuen Run, und
Schließen führt zur Start-Seite. Ein Start zählt nur, solange er der laufende ist: ein späterer
Klick auf eine Vorlage, ein freier Run, ein gewählter Run oder der Weg zurück lösen ihn ab, sein
Ergebnis öffnet dann nichts mehr; ein schon angelegter Run bleibt in der Liste. Der Eintrag "Neuer Chat" und das Plus eines
Servers ohne Default schicken dasselbe ohne `entryId`; das Run-Panel öffnet dann sofort einen
leeren Run, dessen Auftrag im Chat entsteht. Die Default-Vorlage kommt vom Server: `RunStore`
liest `defaultStartEntry` aus `ragents.plugins.bootstrap` und lehnt eine ab, die nicht unter
den gelieferten Vorlagen ist; `ConnectionSnapshot.defaultEntry` und `ConnectionView.defaultEntry` reichen
sie durch, die Seite rät nichts. `newRunChoices` in `overview-model.ts` macht sie zur ersten
Zeile ihres Servers im QuickPick von `ragents.newRun`.
Die Erweiterung zeigt dafür zuerst das Run-Panel ohne Run und schickt `newRun` danach, bei einem
neu gebauten iframe erst auf dessen `ready`. Ohne gewählten Run zeigt das Run-Panel im Host
`vscode` deshalb nie die Run-Liste, sondern unter derselben Kopfzeile wie ein Run (Zurück-Pfeil,
Titel, Serverpille, Menü) den Ladezustand "Run wird gestartet"; schon das Laden des
Profils davor zeigt ihn in derselben Darstellung. Der Start einer Vorlage behält Kopfzeile,
Darstellung und Stelle bei und nennt den Titel der Vorlage; das Run-Panel setzt den Ladezustand
danach im Chat fort, bis der Run Inhalt hat, und der neue Run trägt bis zu seinem Eintrag in der
Run-Liste den Titel seiner Vorlage beziehungsweise "Neuer Run". Scheitert der Start, stehen dort
der Grund und "Zur Start-Seite"; kommt binnen fünf Sekunden keine Startanforderung, steht dort
"Kein Run gewählt" mit demselben Weg zurück statt eines endlosen Ladezustands.
Die Kopfzeile des Run-Panels trägt links einen Zurück-Pfeil, der immer auf die Start-Seite führt
(`showStart`, die Absicht statt ihrer Folge `runChanged`), dann den Run-Titel, rechts die
Serverpille aus `?connection=`, das Zustandssymbol und den Stopp als Symbol.
`StartSelection` ist der Weg des Browsers und im Host `vscode` der einer Vorlage mit Leitfaden.
`ConnectionEntry` trägt dafür neben `id`, `title` und `description` auch `kind`, `category` und
`guided`; ein Run-Script darf in seiner `RUN.md`
eine eigene `category` nennen, ohne eine steht es unter "Run-Scripts".

**Server** ist die Seite, auf der eingerichtet wird: je Server eine Zeile mit Symbol,
Name, Art, Adresse oder Profildatei (gekürzt, voller Pfad im Titel) und Zustandssymbol, dazu
Verbinden und Trennen, Anmelden, Abmelden, Bearbeiten und Entfernen mit Rückfrage im Dialog, unten
neben "Neuer Server" der Sprung in die `settings.json`. Ein
lokales Profil hat kein "Starten" und kein "Stoppen" mehr: die Erweiterung startet es beim
Aktivieren still als Kindprozess, die Zeile zeigt nur "startet" und dann "bereit". Der Kindprozess
bekommt neben `PRODUCT_PROFILE`, `PRODUCT_PROFILE_FILE` und `DATA_DIR` auch `RAGENTS_PARENT_PID`
mit der Prozesskennung der Erweiterung. Beim geordneten Ende wartet `deactivate` darauf, dass alle
Sitzungen getrennt und alle eigenen Hosts gestoppt sind, höchstens vier Sekunden, weil VS Code den
Extension-Host beim Neuladen nur kurz räumen lässt; nach einem Absturz oder Force-Quit beendet sich
der Host über seinen Wächter selbst (Abschnitt Profile in [profiles.md](profiles.md)). Ein
verwaister Host hielte sonst das Writer-Lock des Profilordners. Nichts davon ist ein Formular auf der Seite: "Neuer Server" und
"Bearbeiten" öffnen denselben Dialog (`panel/PanelDialogs.tsx` auf `ui/dialog.tsx`) mit Umschalter
Server / Lokales Profil, den Feldern, dem Fehler unter den Feldern und Abbrechen/Speichern; beim
Profil wählt "Datei wählen ..." über den VS-Code-Dateidialog mit `defaultUri` auf den Host-Ordner,
daneben stehen die dort gefundenen Profile als Vorschläge (`PanelState.profileSuggestions`), und
der Name kommt aus dem Dateinamen. "Anmelden" öffnet aus beiden Seiten denselben Dialog mit
`LoginForm` im Dialogkörper. Bearbeiten schickt `updateServer` oder `updateProfile` und ersetzt den
Eintrag an seiner Stelle in `ragents.connections`, damit ein Umbenennen die gespeicherten
Anmeldedaten behält - sie hängen an der Adresse, nicht am Namen.

## Arbeitsbereich, Sandbox-Werkzeuge und Prozesse

Die Workspace-Plugins geben Agenten genau vier
Sandbox-Werkzeuge aus `@ragents/workspace-executor`: `read` (Zeilennummern, Kürzung, SHA-256
des Inhalts), `edit` (eindeutiger Treffer; bei mehrdeutigem `oldText` nennt es die Fundstellen mit
Zeilennummern, optionale Anker `occurrence`, `nearLine` und `replaceAll`; `expectedHash` aus dem
letzten `read` verhindert, dass etwas überschrieben wird, was seit dem Lesen entstanden ist),
`write` und `bash`. `ls`, `grep`, `find` oder ein eigener Typecheck sind keine Werkzeuge, weil
`bash` sie kann und die Sandbox keine Berechtigungsstufe unterhalb von Bash kennt. `git` läuft
ohne Einschränkung im Arbeitsverzeichnis des Runs; Zugangsdaten liefert ein Plugin über die
Git-Umgebung der Sandbox (`SessionWorkspace.gitConfig`) an den Executor des Servers.

Der **Executor** ist das Paket `packages/workspace-executor`, gebaut aus Modulen: jedes Modul
registriert benannte Operationen, deren Handler den Prozesskontext dieser Maschine bekommen, und
optional sein Aufräumen je Run (`stopRun`) und beim Beenden (`shutdown`). `shutdown` ist endgültig:
danach ruft niemand den Executor wieder auf, und ein Modul darf spätere Aufrufe mit Ursache
ablehnen; wer wieder einen braucht, baut einen neuen. Der Executor selbst
(`WorkspaceOperationExecutor`) kennt keinen Operationsnamen; ein unbekannter scheitert mit
`workspace-operation-unknown` (400), ein doppelt registrierter schon beim Bau. Jeder Executor trägt
dieselben Module (`workspaceExecutorModules()`): die vier Sandbox-Werkzeuge mit Prozessgruppen,
Umgebung und Pfadprüfung (`read`, `edit`, `write`, `bash`), die Language-Server-Sitzungen mit den
drei Adaptern Roslyn, FSAC und TypeScript (`<id>_open`, `<id>_diagnostics`, `<id>_close`,
`<id>_snapshot`), die Dateien (`files.list`, `files.read`, `files.watch`, `files.attach`), die
Prozesse (`processes.snapshot`, `processes.stop`, `processes.stopAll`), die Befehle (`commands.run`)
und der Browser der Browserprüfung (`browser.*`, Abschnitt Browserprüfungen). Nach `edit` und
`write` fragt das Werkzeugmodul alle Module nach einer Anmerkung zur geschriebenen Datei; die
Sprachserver hängen so ihre Diagnostik an. Die Schnittstelle ist
`execute(runId, operation, input, options)` mit Fortschritt als JSON-Wert und Abbruch, dazu
`stopRun(runId)` und `shutdown()`; der Executor kennt weder Engine noch Run-Vertrag noch Plugins,
sondern nur Ordner, Umgebung und Aufrufe seiner eigenen Maschine. Ein fachlicher Fehler einer
Operation trägt Kennung und Status (`WorkspaceOperationError`) und kommt beim Aufrufer als
`DomainError` an, gleich ob der Executor im Server oder auf dem Arbeitsplatz lief. Eine weitere
Fähigkeit, die den Rechner des Arbeitsbereichs braucht, wird ein weiteres Modul. Server und
VS-Code-Erweiterung importieren dasselbe Paket, es wird nie zur Laufzeit nachgeladen.

Dieser Vertrag ist die einzige Naht zum Arbeitsbereich: `WorkspaceRuntime` löst je Run den
Ordner auf, und `SandboxServices.execute(runId, operation, input, options)` ist der einzige Zugang
der Plugins zu ihm. Jede Wurzel gehört einer Maschine: die Wurzel des Runs der Maschine seiner
Bindung, die zusätzlichen Wurzeln mit Alias (`@actors` der Actor-Programme, `@skills/<name>` der
Skills, Abschnitt Skills and starting tasks) dem Server. Eine Operation läuft beim Executor der
Maschine, der die angesprochene Wurzel gehört; die Bindung (`executorFor`) bestimmt nur die Wurzel
des Runs und damit, wo eine Operation ohne Alias läuft: auf dem Server im Executor des Servers, auf
einem Arbeitsplatz in dessen, gleich ob im neuen oder in einem vorhandenen Ordner. Welche Wurzeln
eine Eingabe anspricht, erklärt das Modul, dem die Operation gehört, mit ihrem Fußabdruck
(`WorkspaceExecutorModule.footprints`, je Operation eine Funktion der Eingabe, die nie wirft): die
Dateiwerkzeuge mit `path`, `bash` mit `cwd`, die Sprachserver mit `root` und `paths`, `files.list`
und `files.read` mit `alias`. Ein Pfad mit Alias spricht dessen Wurzel an, jeder andere, auch ein
absoluter, die des Runs; eine Operation ohne Fußabdruck spricht keine bestimmte an. Dazu nennt der
Fußabdruck die Laufzeit, die eine Eingabe selbst verlangt, bei `bash` deren Zeitgrenze; sie gilt
als `durationMs`, wenn der Aufrufer keine nennt. `SandboxServices.execute` fragt den Fußabdruck
beim Executor des Servers, der dieselben Module trägt wie jeder Arbeitsplatz, bevor er etwas
verschickt: nennt die Eingabe einen Alias, läuft die Operation beim Executor des Servers im Kontext
des Runs dort (`serverProcessContextFor`, unten), sonst beim Executor der Bindung. Spricht ein
Aufruf eines Runs auf einem Arbeitsplatz Wurzeln beider Maschinen an, etwa `<id>_diagnostics` mit
`root: "@actors/app"` und `paths: ["src/a.ts"]`, scheitert er mit `workspace-roots-mixed` (400) und
der Ursache, dass ein Aufruf nur einen Rechner erreicht; bei einem Run auf dem Server liegen alle
Wurzeln auf einer Maschine, und nichts ändert sich. Der Sandbox-Host zerlegt keine Eingabe selbst;
eine neue Operation mit Pfaden erklärt ihren Fußabdruck in ihrem Modul. Die vier Werkzeuge, die
Language-Server-Werkzeuge, der Reiter `Dateien`, die Prozessanzeige, die Browserprüfung und die
Quelldatei von `typescript_eval` gehen alle diesen Weg; es gibt keinen Zweig "lokal oder entfernt"
im Code eines Verbrauchers. Jede Methode und jeder Kanal, der von außen zum
Arbeitsbereich eines Runs führt (Dateien des Arbeitsverzeichnisses, Prozessanzeige, Stand der
Sprachserver), prüft vorher mit dem Hostdienst `workspaceGuardToken` Run und Zugang: einen Run, den
nur sein Eigentümer bedient (`ownerOnly`), erreicht auch lesend nur dieser, gleich mit welchen Rechten
(`run-workspace-owner-only`, 403). Dieselbe Regel entscheidet, welche Run-Metadaten mit
`requiresWorkspace` die Run-Liste abfragt, und liefert je Run `workspaceAccessible` für die Oberflächen.
Die Prüfung kennt keinen Arbeitsplatz, nur das Eigentum am Run;
Werkzeuge, Lebenszyklus und die Arbeit des Runs selbst laufen in seinem Namen und brauchen sie nicht. Einen lokalen Griff auf den Ordner bekommt kein
Plugin: auf einem Arbeitsplatz scheitert `currentRoot()` der `SessionWorkspace` laut mit Ursache, statt
einen Pfad zu liefern, der auf dem Server benutzbar aussieht. Was wirklich auf
dem Server läuft, die native Ausführung von `typescript_eval`, die Actor-Programme und jede
Operation auf einer Wurzel des Servers, bekommt mit `SandboxServices.serverProcessContextFor(runId)`
einen ausdrücklich benannten Serverkontext: auf dem Server denselben wie die Werkzeuge, auf einem
Arbeitsplatz einen eigenen Ordner des Runs in der Run-Ablage (`plugins/ragents.workspace/server`)
als Wurzel des Runs, der beim ersten Bedarf entsteht, nie den Pfad des Arbeitsplatzes; die Wurzeln
des Servers und die Prozess-Sandbox des Runs gehören in beiden Fällen dazu. `typescript_eval` mit
`path` liest seine Quelle über `files.read`: relativ zur Wurzel des Runs vom Executor der Bindung
oder mit einem Alias wie `@actors/...` vom Server, auch bei einem Run auf einem Arbeitsplatz; einen
unbekannten Alias lehnt der Server mit `workspace-alias-unknown` ab und nennt die bekannten. Für das
Modell läuft `git` in `bash`. Braucht ein Plugin selbst ein Programm im Arbeitsbereich, etwa `git`
für eine Ansicht, ruft es `commands.run` beim Executor des Runs und wertet das Ergebnis selbst aus;
eigene Prozesse gegen den Ordner startet es nicht, und Pfade daran vorbei rechnet es nicht aus. Wer den
Vertrag erfüllt, entscheidet damit für alle Plugins zugleich, wo der Ordner liegt und wer darin
ausführt. `ragents.workspace` ist die Erfüllung in core; der
optionale `WorkspaceResolver` (Abschnitt Zuständigkeit je Facette) ist der
Haken, über den ein weiteres Plugin den Inhalt eines neuen Ordners, eine eigene Art von
Arbeitsbereich auf dem Server oder den neuen Ordner auf einem Arbeitsplatz beisteuert. In core nutzt
ihn kein Plugin.

Wo und worin ein Run arbeitet, entscheidet seine Bindung: die Startoption `ragents.workspace.binding`
von `ragents.workspace` mit zwei getrennten Angaben, `{ machine, folder }`
(`plugins/ragents.workspace/contract.ts`). `machine` ist der Rechner, `"server"` oder
`{ client, label }` für einen verbundenen Arbeitsplatz; `folder` ist der Ordner, `"fresh"` für einen
neuen je Run oder `{ path }` für einen vorhandenen. Alle vier Kombinationen gelten. Die Vorgabe ist
der neue Ordner auf dem Server, der leere Ordner unter der Run-Ablage. Ein vorhandener Ordner auf
dem Server ist ein absoluter, beim Wählen vorhandener Ordner des Serverrechners; der Run arbeitet
direkt darin, und weder Stopp noch Löschen des Runs fassen ihn an. Ein Arbeitsplatz ist einer des
handelnden Benutzers: `accept` verlangt, dass dieser Benutzer ihn angemeldet hat, bei einem
vorhandenen Ordner, dass der Arbeitsplatz ihn anbietet, und schreibt sein Label in den Wert, damit der
Run ihn auch ohne Registry benennen kann. Den neuen Ordner auf einem Arbeitsplatz hält `accept` mit
seinem Pfad dort fest, `{ path, fresh: true }`: der Ordner mit der Kennung des Runs unter dem Ordner
für Runs, den der Arbeitsplatz bei der Anmeldung nennt (`runsDirectory`, mit dessen Trennzeichen;
VS-Code-Erweiterung und kopfloser Arbeitsplatz nehmen `runs` in ihrem Datenordner, unter macOS und
Linux `~/.local/share/ragents/workspace/runs`). So bleibt die Auflösung ohne den Arbeitsplatz
möglich und deterministisch. Auf dem Server hat ein neuer Ordner keinen gewählten Pfad; dort ist
`{ path, fresh: true }` ungültig. Ein fremder Arbeitsplatz verhält sich wie ein nicht verbundener,
und die Auswahl im Web (`describe`) nennt nur die Arbeitsplätze dessen, der sie abruft, dazu je
Rechner, wie der neue Ordner dort heißt (`fresh.server`, `fresh.client`, `null` wo es keinen gibt),
und ob ein vorhandener Ordner des Servers erlaubt ist. Ein Arbeitsplatz, der die Registry verlassen
hat, bleibt in der Auswahl als "Arbeitsplatz <label> (nicht verbunden)" stehen, solange die Bindung
ihn nennt. Jede Bindung an einen Arbeitsplatz erklärt die Option mit `ownerOnly` zu einem Run, den
nur sein Eigentümer bedient, weil seine Werkzeuge auf dem Rechner und mit den Zugangsdaten dieses
Eigentümers laufen; sein Journal lesen und ihn stoppen dürfen alle, die ihn sehen, seinen
Arbeitsbereich nur er (oben).

Den neuen Ordner auf einem Arbeitsplatz legt dessen Executor an, mit der Operation
`runFolder.create` des Moduls für Ordner je Run; nur ein Executor, der einen Ordner für Runs kennt,
hat es in Betrieb, der des Servers lehnt es mit `run-folder-unavailable` (409) ab. Der Host ruft sie
vor dem ersten Auftrag des Runs in diesem Serverlauf, nie für Aufräumen (`whenReachable`), und lässt
danach die Schritte eines Beitrags laufen (`WorkspaceResolver.workstation.prepare`), aber nur, wenn
der Ordner eben erst entstanden ist; nach einem Neustart findet er ihn vor und ändert nichts.
Scheitert ein Schritt, räumt `runFolder.remove` den Ordner wieder weg, und der nächste Auftrag
beginnt neu. Das Löschen des Runs stoppt ihn, lässt die Schritte von `release` laufen und räumt den
Ordner weg; ist der Arbeitsplatz dabei nicht erreichbar, bleibt der Ordner mit einem Hinweis im
Protokoll liegen, und der Run ist trotzdem gelöscht. Der Arbeitsplatz selbst nimmt Aufträge nur in
seinen angebotenen Ordnern an und im Ordner des Runs unter seinem Ordner für Runs, nie im Ordner
eines anderen Runs; eine Kennung mit Pfadzeichen ist dort kein Ordnername.

Journale sind unveränderlich, und ältere tragen die Bindung in der Form vor dieser Trennung,
`{ kind: "fresh" }`, `{ kind: "path", path }` oder `{ kind: "client", client, label, path }`.
`storedWorkspaceBinding` bildet jede davon beim Lesen auf genau eine heutige Kombination ab: neuer
Ordner auf dem Server, vorhandener Ordner auf dem Server, vorhandener Ordner auf dem Arbeitsplatz.
Das ist die einzige Stelle, die die alte Form kennt; Server, `ownerOnly` und Web lesen gespeicherte
Werte nur über sie, `accept` und festgelegte Startoptionen nehmen nur die heutige Form an. Was keiner
der beiden Formen entspricht, sperrt den Run mit der Ursache "Die gespeicherte
Arbeitsbereich-Bindung ist ungültig".

Die VS-Code-Erweiterung und der kopflose Arbeitsplatz (`pnpm workspace-client`) binden immer sich
selbst mit einem angebotenen Ordner, auch wenn der Server auf demselben Rechner läuft, außer eine
Vorlage legt die Bindung fest (Plugin-Vertrag, Startoptionen); den Server als Rechner wählen Runs
ohne Arbeitsplatz (Web, `pnpm driver`, Container), den neuen Ordner auf einem Arbeitsplatz die
Startauswahl. Auf einem Arbeitsplatz ist der gebundene Ordner das ganze Arbeitsverzeichnis des
Runs und sein `cwd`: diesen Pfad nennt die Beschreibung des Arbeitsbereichs im Systemprompt, weil
ein Ordner des Servers dort dem Agenten einen anderen Pfad nennen würde, als seine Werkzeuge
benutzen. Für den Server ist er nur ein Name. Auf dem Server entsteht für einen solchen Run nur bei Bedarf der
eigene Ordner für Arbeit, die dort läuft (oben); in ihm arbeitet auch die Agentenlaufzeit für ihre
eigenen Belange (`Workspaces.runtimeDirectory`, der `cwd` von `serverProcessContextFor`): ihre
Sitzung, ihre Einstellungen und Ressourcen und die Prüfung, dass ihr Ordner existiert. Einen Pfad
für den Prompt bekommt sie nicht; den nennt allein die Beschreibung des Arbeitsbereichs. Ein angehängter Chat-Anhang, den das
Modell mit seinen Dateiwerkzeugen lesen soll, geht über die Operation `files.attach` an den Executor
des Runs und liegt unter `attachments/` im Arbeitsbereich, bei einem Arbeitsplatz also dort.
Actor-Programme behalten ihren eigenen Ordner unter der Run-Ablage. Die Auflösung scheitert nie
an einem fehlenden Client oder Ordner, weil der Server beim Start alle Arbeitsbereiche auflöst; erst
der einzelne Werkzeugaufruf meldet `workspace-client-disconnected` (409) beziehungsweise
`workspace-path-missing`. Der Prompt des Plugins sagt dem Agenten, dass ein Projektordner das echte
Projekt des Benutzers ist; welche Bindung gilt, steht als Systemnotiz zu Beginn des Runs. Dieselbe
Bindung liefert das Plugin als Run-Metadatum `ragents.workspace` (`binding`, `summary`) für
Run-Liste und Kopfzeile.

Ein Arbeitsplatz ist ein Client, der dem Server sein Dateisystem anbietet. Er meldet sich mit
einer stabilen Kennung über `ragents.workspace.clients.register` an (Label, Hostname,
Plattform, angebotene Ordner); die Verbindung dieser Anfrage wird sein Rückweg und braucht
deshalb einen Ereignisstrom. In der VS-Code-Erweiterung hat jedes Fenster seine eigene Kennung
(im `workspaceState` des Fensters), der kopflose Arbeitsplatz eine je Rechner und Ordnersatz;
zwei Fenster verdrängen sich also nie. Über das Netz nimmt der Server eine Anmeldung nur von einem
angemeldeten Benutzer eines Profils mit `users` an; ohne Benutzer (offener Server, `ACCESS_TOKEN`,
`anonymousUser`) gäbe es für alle Zugänge nur einen Besitzer, und jeder könnte Runs an den Rechner
eines anderen binden. Dort gilt eine Anmeldung deshalb nur über eine Loopback-Verbindung
(`MethodContext.local`), sonst scheitert sie mit `workspace-client-login-required` (403). Die
VS-Code-Erweiterung meldet sich in diesem Fall nicht an und nennt den Grund am Server. `ragents.workspace.clients.unregister` meldet ab,
`ragents.workspace.clients.list` zeigt den Stand: angemeldet ist, wer gerade verbunden ist. Endet
die Verbindung, verlässt der Arbeitsplatz die Registry; nichts braucht den Eintrag danach, weil
ein Run die Kennung in seiner Bindung trägt und die Wiederanmeldung ihn neu anlegt. Die Abmeldung
ist deshalb idempotent: ein Arbeitsplatz ohne Eintrag ist kein Fehler, die Methode liefert `null`.
Sie wirkt nur über die Verbindung, die den Eintrag hält; eine Anmeldung derselben Kennung über eine
neue Verbindung ersetzt den Eintrag, und die offenen Aufrufe über die alte scheitern sofort mit
`workspace-client-disconnected`, statt auf eine halb offene Verbindung zu warten.
Ein Arbeitsplatz gibt beim Abmelden zuerst seine Handler frei, damit ist sein Ereignisstrom zu;
der Server kann den Eintrag also schon entfernt haben, bevor die Abmeldung ankommt, und eine
Abmeldung nach einer Trennung muss trotzdem durchgehen. Die Registry lebt im Speicher des Servers;
nach einem Neustart meldet sich jeder Client neu an, gebundene Runs bleiben gültig.

Auf dem Arbeitsplatz (`plugins/ragents.workspace/client`) hat jede Anmeldung ihren eigenen
Executor aus `workspaceExecutorModules()`. Die Abmeldung, ob ausdrücklich oder weil kein Ordner
mehr angeboten wird, gibt die Handler frei, meldet beim Server ab und beendet zugleich den Executor
dieser Anmeldung mit `shutdown`; die nächste Anmeldung baut einen neuen. Auf den Server wartet sie
höchstens drei Sekunden, eine Anmeldung höchstens zehn; ein hängender Server hält so weder das
Beenden der Erweiterung noch Sprachserver oder Browser fest. Die Abmeldung wartet auf eine noch
laufende Anmeldung, und eine spätere Anmeldung wartet auf die Abmeldung, sodass der Server beide in
der Reihenfolge des Arbeitsplatzes sieht und eine alte Abmeldung nie eine neue Anmeldung entfernt.
Verliert der `RpcClient` den Ereignisstrom (Ende, Fehler oder 45 Sekunden ohne Daten, obwohl der
Server alle 15 Sekunden pingt), bricht er alle Handler ab, die noch für den Server laufen: ihre
Antwort erreichte ihn nicht mehr, und eine Beobachtung oder eine lange Bash liefe sonst doppelt.
Danach meldet sich der Arbeitsplatz über denselben, weiterlaufenden Executor erneut an, sobald der
Ereignisstrom wieder steht.

Ein Client gehört dem Benutzer, der ihn angemeldet hat (ohne Anmeldung niemandem, `null`), und
die Registry führt ihn unter Besitzer und Kennung. Zwei Benutzer mit derselben Kennung haben zwei
getrennte Einträge; Anmelden, Abmelden und Trennen des einen berühren den anderen nie.
`ragents.workspace.clients.list` liefert nur die Arbeitsplätze des Aufrufers, auch mit
`runs.read.all`, und die Abmeldung trifft nur den eigenen Eintrag. Ausgeführt wird immer auf dem
Arbeitsplatz des Run-Eigentümers (`RunState.ownerUserId`) mit der Kennung aus der Bindung, und
dasselbe gilt für den Promptbeitrag zur Plattform; ein Run ohne Eigentümer findet nur einen
Arbeitsplatz, der ohne Benutzer angemeldet ist. Einen Ausweg auf einen anderen Arbeitsplatz mit
derselben Kennung gibt es nicht: fehlt der des Eigentümers, scheitert der Aufruf mit
`workspace-client-disconnected`. Die Anmeldung nennt zusätzlich den Stand des Executors, den der
Arbeitsplatz mitbringt; weicht er vom Stand des Servers ab, scheitert sie mit
`workspace-executor-version` (409).

Genau eine Operation geht zum Arbeitsplatz: `ragents.workspace.client.execute` mit
`implementedBy: "client"`, mit `runId`, `operation`, `cwd`, `env`, der Eingabe der Operation und
nur bei einem Werkzeugaufruf des Modells `toolCallId`. Der Server ruft sie über die Verbindung der
Anmeldung; Fortschritt ist der JSON-Wert der Operation (bei `bash` die Ausgabe als `{ text }`, bei
`files.watch` erst `{ kind: "ready" }`, dann je Änderung `{ kind: "changed" }`), das Ergebnis ist
ihr Wert als JSON. `operation` ist eine Operation eines Moduls oder `stop`, das freigibt, was der
Arbeitsplatz für den Run hält (sein `stopRun`); `stop` prüft keinen Ordner und gelingt auch, wenn der
gebundene Ordner nicht mehr angeboten wird. Der Server wartet je Aufruf begrenzt: eine einzige
Sicherheitsgrenze von 15 Minuten plus der Dauer, die der Aufruf selbst verlangt (`durationMs`, bei
`bash` dessen Zeitgrenze), weil die eigentlichen Zeitgrenzen im Executor sitzen. Eine Beobachtung
erklärt der Aufruf ausdrücklich mit `untilAborted`: sie läuft ohne Zeitgrenze bis zum Abbruch und
braucht dafür ein Abbruchsignal. Ein Abbruch schickt `rpc.cancel`. Aufräumen ruft mit `whenReachable`:
ist der Arbeitsplatz nicht verbunden oder antwortet er nicht binnen zehn Sekunden, liefert der
Aufruf `null`. Der Stopp des Runs (`stopRun`) geht dagegen nicht verloren, weil der Executor des
Arbeitsplatzes eine Trennung überlebt und mit ihm Hintergrundprozesse, Sprachserver und Browser:
erreicht er den Arbeitsplatz nicht, merkt die Registry ihn je Arbeitsplatz und Run vor, meldet ihn im
Protokoll als ausstehend und stellt ihn bei der nächsten Anmeldung desselben Arbeitsplatzes zu, vor
jedem neuen Auftrag dieses Runs; bleibt der Arbeitsplatz angemeldet, antwortet aber nicht, versucht
sie es alle 30 Sekunden erneut. Dass der Server den Stopp vormerkt statt der Arbeitsplatz seine Runs
beim Wiederverbinden abzugleichen, hat einen Grund: ein Stopp ist ein Ereignis, kein Zustand; ein
gestoppter Run kann weiterlaufen, und nur der Server weiß, dass gestoppt wurde. Ein Verbindungsverlust lässt offene Aufrufe mit
`workspace-client-disconnected` scheitern, und die Ursache nennt den Arbeitsplatz, damit
erkennbar bleibt, dass nicht der Server weg ist; eine begonnene Bash kann trotzdem durchlaufen, das
wird nicht kaschiert. Ein fachlicher Fehler des Arbeitsplatzes kommt mit Kennung und Status als
derselbe `DomainError` an wie aus dem Executor des Servers.

Die Umgebung baut jeder Executor aus seiner eigenen Maschine: sichere Variablen des Prozesses,
`HOME`, `USER`/`LOGNAME` (mit eigenem Konto dessen Name, sonst die Werte des Prozesses dieser
Maschine) und die Variablen seiner Wurzeln. Vom Server kommt nur, was ortsunabhängig ist:
Run-Marker, `CI`, `GIT_OPTIONAL_LOCKS` und die Git-Regeln der Sandbox. Git-Zugangsdaten und
Toolchain-Pfade des Servers wandern nicht in eine fremde Bash. Ein Executor sieht ausschließlich
die Ordner seiner Maschine: im Server die Wurzel des Runs (bei einem Run auf einem Arbeitsplatz
dessen Serverordner) plus die Wurzeln des Servers (`@actors`, `@skills/<name>`), in der
Erweiterung den angebotenen Projektordner. Aliasse gibt es nur auf dem Server, und ein Aufruf
erreicht immer genau eine Maschine: welche, entscheidet die Wurzel, die seine Eingabe anspricht,
nicht ein Vergleich absoluter Pfade. Ein absoluter Pfad gilt deshalb auf der Maschine der Bindung;
eine Wurzel des Servers erreicht ein Run auf einem Arbeitsplatz nur über ihren Alias. `HOME` ist
auf dem Arbeitsplatz das Home des Entwicklers,
damit Git, SSH und NuGet mit seinen eigenen Zugangsdaten arbeiten; die `HOME`-Umleitung ist eine
Eigenschaft des Executors im Container, nicht der Betriebsart. Wohin ein Sprachserver seine
Protokolle und Zwischenstände legt, sagt der Kontext getrennt (`logDirectory`): im Server die
Run-Ablage, auf dem Arbeitsplatz ein Ordner unter `os.tmpdir()`, nie das Home des Entwicklers.

Ein Bash-Ergebnis ist die Ausgabe des Befehls; ein Exit-Code ungleich null steht als letzte
Zeile im Ergebnis (`Command exited with code N`) und ist kein Werkzeugfehler, etwa `grep` ohne
Treffer. Werkzeugfehler sind nur Start-, Zeitgrenzen- und Abbruchprobleme. Den Ordner eines
Aufrufs nennt das optionale `cwd`, auf jeder Maschine gleich: relativ zum Arbeitsverzeichnis oder
ein Pfad mit Alias wie `@actors/<name>`, nie absolut (`workspace-path-invalid`, 400), immer in
einer Wurzel des Runs, auch einer nur lesbaren, und es muss ihn geben (`workspace-path-not-found`,
404); ohne `cwd` läuft die Bash im Arbeitsverzeichnis. Mit Alias läuft sie beim Executor des
Servers, in derselben Prozess-Sandbox wie jeder andere Prozess des Runs dort (Abschnitt
Prozess-Sandbox des Servers), und nur diese Bash hat die Variablen der Wurzeln des Servers, etwa
`RAGENTS_ACTORS_DIR`. Ohne Alias läuft sie beim Executor der Bindung, bei einem Arbeitsplatz also
dort und ohne diese Variablen. Eine Bash sieht nie beide Maschinen; eine eigene Sperre für den Weg
auf den Server gibt es nicht, weil er den Node-Prozessen gleicht, die ein Run dort ohnehin
startet, und derselben Sandbox folgt. `ragents.workspace`
liefert dazu einen an `bash` gebundenen Promptbeitrag (`plugins/ragents.workspace/server/shell-platform.ts`):
macOS mit BSD-Werkzeugen (`grep` ohne `-P`, `sed -i ''`), Linux mit GNU-Werkzeugen, Windows mit
Git Bash (MSYS-Userland mit GNU-Werkzeugen, Windows-Pfade, CRLF); eine unbekannte Plattform ist
ein Fehler, kein Ratetext. Genannt wird die Plattform des Executors, der den Run ausführt: auf dem
Server die des Servers, auf einem Arbeitsplatz die, die er bei der Anmeldung gemeldet hat. Dafür darf ein Prompt-Beitrag ein `renderForRun(runId)` mitbringen; der Server
ersetzt damit den einmal gerenderten Text je Run (`PromptContribution`,
`PromptContributionRegistry.runOverrides`). Ist der gebundene Arbeitsplatz gerade nicht
angemeldet, nennt der Beitrag genau das, statt eine Plattform zu raten. Der Executor im Server
leitet `HOME` je Run um, damit Werkzeuge nur dort schreiben; unter Windows geht `USERPROFILE`
mit. `PATH` kommt aus der Umgebung des Executors, die Toolchain seiner Maschine
bleibt also erreichbar. Der uid-Wechsel und die `HOME`-Umleitung sind Konfiguration des Executors,
nicht der Betriebsart. Fehlt eine vorausgesetzte Werkzeugkette, scheitert der Aufruf mit dieser
Ursache.

Das Befehlsmodul führt mit `commands.run` ein Programm aus, ohne Shell: `program` (ein Name aus dem
`PATH` des Executors oder ein Pfad) und `args` gehen wörtlich an den Prozess, kein Argument wird
gedeutet. Der Arbeitsordner `cwd` ist relativ zur Wurzel des Runs, ohne Angabe die Wurzel selbst,
und wird geprüft wie ein Pfad des Dateimoduls: kein `..`, nicht absolut, kein Symlink aus der
Wurzel, und es muss ein Ordner sein. Der Prozess bekommt Umgebung und Konto des Executors, also
Run-Marker und Git-Regeln der Sandbox und auf einem Arbeitsplatz dessen `HOME`; einen Zusatz zur
Umgebung nimmt der Aufruf nicht an. Er läuft im Rahmen des Arbeitsbereichs (`runOperation`), wie
die Werkzeuge. `timeoutMs` ist Pflicht und verlängert als Fußabdruck des Befehls, wie lange der
Server über seine Sicherheitsgrenze hinaus auf einen Arbeitsplatz wartet; einen Alias kennt `cwd`
hier nicht. Das Ergebnis nennt `exitCode`
(`null` nach einem Signal) und `stdout` und `stderr` als UTF-8-Text, je Datenstrom höchstens
`maxOutputBytes` (Vorgabe und Obergrenze `COMMAND_OUTPUT_LIMIT`, 2 MiB, damit auch eine Antwort
voller Steuerzeichen über die Verbindung eines Arbeitsplatzes passt), dazu je ein Kennzeichen, ob
gekürzt wurde; der Befehl läuft trotzdem zu Ende. Wie bei `bash` ist ein Exit-Code ungleich null
ein Ergebnis und kein Fehler. Fehler sind eine ungültige Eingabe (`command-invalid`, 400), ein
fehlendes oder nicht ausführbares Programm (`command-unavailable`, 409), die überschrittene
Zeitgrenze (`command-timeout`, 504) und der Abbruch; Abbruch, `stopRun` und `shutdown` beenden den
Prozess, und außer unter Windows endet mit ihm seine Prozessgruppe samt allem, was er im
Hintergrund zurücklässt. Unter Windows lehnt das Modul `.cmd` und `.bat` ab, weil Node sie nur über
eine Shell startet. Eine Befehlsperre ist das Modul nicht: ohne Shell heißt, dass kein Argument
gedeutet wird, nicht, dass nur bestimmte Programme laufen. Binäre Ausgabe ist nicht vorgesehen; sie
kommt als UTF-8-Text an.

Nach einem Bash-Aufruf wartet der Host auf das Ende seiner Prozessgruppe. Unter macOS kann
eine bereits beendete Gruppe mit verbliebenen Zombie-Einträgen bei der Signalprüfung `EPERM`
melden. In diesem Fall prüft der Host ausschließlich Prozessgruppen-ID und Prozessstatus;
nur eine nachweislich leere oder vollständig beendete Gruppe gilt als aufgeräumt. Lebende
Prozesse, eine fehlgeschlagene Statusabfrage und unlesbare Ergebnisse bleiben Fehler. Ein
solcher beendeter Rest verwirft damit weder Ausgabe noch Exitstatus des eigentlichen Befehls.

Unter Windows läuft der Executor mit denselben Node-Standard-APIs und ohne eigene
Plattformschicht. Die Bash kommt aus der Shell-Auflösung des Agent-Pakets
(`packages/agent/src/utils/shell.ts`): Git Bash aus `%ProgramFiles%\Git\bin\bash.exe`, sonst
`bash.exe` vom `PATH`, und das alte `System32\bash.exe` bekommt seinen Befehl über stdin. Ohne
Bash ist der Aufruf ein Fehler mit Anleitung; ein stiller Ausweg auf `sh` ist ausgeschlossen,
auch unter Unix. Prozessgruppen gibt es dort nicht:
statt eines Signals an die negative PID beendet `taskkill /T /F` den Prozessbaum
(`killProcessTree` im Agent-Paket), und weil taskkill nebenher läuft, gibt es keine Zusage, wann
der letzte Enkel weg ist; eine Frist vor SIGKILL entfällt damit ebenfalls. Der Datenordner liegt
unter `%LOCALAPPDATA%\ragents\<profil>`; ist `LOCALAPPDATA` nicht gesetzt, bricht der Start ab.
Die Rechte 0700 und 0711 bleiben unter Windows wirkungslos, erzeugen aber keinen Fehler, und der
uid-Wechsel der Sandbox gilt weiter nur für den Container. Die sichere Umgebung reicht zusätzlich
die Windows-Grundvariablen durch (`SystemRoot`, `ComSpec`, `PATHEXT`, `APPDATA`, `LOCALAPPDATA`
und Geschwister), ohne die kaum ein Windows-Programm startet. Eine Prozesstabelle für win32 gibt es
nicht: das Prozessmodul eines Windows-Executors lehnt Stand und Beenden mit dieser Ursache ab,
statt eine leere Anzeige zu liefern, und beim Run-Stopp bleibt es beim Beenden der Bash-Bäume.

Jeder Sandbox-Prozess (Bash-Kinder, Sprachserver, auch was die TypeScript-Plattform im
Serverkontext startet) trägt den Marker `RAGENTS_RUN_ID=<runId>` in seiner Umgebung. Von einem
Plugin gestartete Dienste tragen denselben Marker und erscheinen automatisch. Das Prozessmodul des
Executors liest darüber die Prozesstabelle seiner Maschine je Plattform (macOS `ps -E` und `lsof`,
Linux `/proc`; als root braucht das Lesen fremder `environ` CAP_SYS_PTRACE); gleichzeitige Abfragen
mehrerer Runs teilen sich einen Scan. Ohne root liest der Executor unter Linux nur Prozesse seines
eigenen Kontos; hat sich einer davon unlesbar gemacht (`PR_SET_DUMPABLE`, etwa ein Hilfsprozess von
Chrome beim Beenden oder `ssh-agent`), trägt er keinen erkennbaren Marker und zählt zu keinem Run,
statt Anzeige und Stopp scheitern zu lassen. Als root bleibt eine gesperrte Umgebung ein Fehler mit
dem Hinweis auf CAP_SYS_PTRACE. Unter macOS zeigt `ps -E` die Umgebung von Programmen aus dem
Systemvolume (`/bin`, `/usr/bin`, etwa `sleep`, `bash`, `sh`, `zsh`, `perl`, `ruby`) nicht; ein
solcher Prozess, der einen Werkzeugaufruf überlebt, ist für die Tabelle keinem Run zuzuordnen
(Offene Grenzen). `ragents.processes` fragt es über den Executor des Runs, bei einem Arbeitsplatz
also dort, und zeigt in der Kopfzeile eine volle Leistenfläche je Prozess
mit Art, Label und Port-Links: Hintergrundprozesse immer, Kinder eines laufenden Werkzeugaufrufs
(direkte Kinder des Executor-Prozesses) nur mit offenem Port. Hintergrund ist an der gestrichelten
rechten Trennlinie und im Tooltip erkennbar, nie an einer Farbe. Das ist eine Laufzeitressource,
kein Journal-Zustand: das Plugin fragt alle zwei Sekunden den Stand jedes Runs ab, dessen Kanal
`processes:<runId>` ein Browser abonniert hat, jeden bei seinem Executor, und meldet nur
Änderungen; fehlt Berechtigung, Werkzeug oder der Arbeitsplatz, ist das ein benannter Fehler in der
Kopfzeile. Jeder Run wird für sich abgefragt, mit einer Zeitgrenze von fünf Takten, die auch den
Executor abbricht; ein hängender Arbeitsplatz friert so nur die Anzeige seiner Runs ein, und wer den
letzten Beobachter eines Runs abmeldet, bricht dessen laufende Abfrage ab. macOS prüft die Befehlszeile vor und
nach dem Lesen der Umgebung. Nur inzwischen geänderte PIDs werden erneut abgefragt, mit
höchstens drei Versuchen; danach bleibt ein instabiler Prozess ein Fehler und wird nicht als
markerlos gespeichert. Verschwundene Prozesse und explizite `<defunct>`-Einträge werden als
beendet ausgelassen. Negative System-UIDs in macOS-Prozesstabellen bleiben als solche erhalten
und blockieren weder Beobachtung noch Bereinigung. Zugriffs-, Werkzeug- und Formatfehler lösen keine Wiederholung aus.

Jeder sichtbare Prozess besitzt eine kompakte Beenden-Schaltfläche mit Symbol und Tooltip.
Prozessüberwachung, ihre Methoden und ihr Kanal verlangen `runs.read` und `ragents.processes.read`.
Mit reinem Lesezugriff bleiben Port-Links nutzbar; Beenden verlangt zusätzlich `runs.write`
und `runs.inspect` und ist sonst deaktiviert. Eine laufende
Beenden-Anfrage sperrt nur den betroffenen Prozess in allen offenen Ansichten; Fehler erscheinen
am Eintrag und erlauben einen neuen Versuch. Erst der nächste beobachtete Prozessstand entfernt
den Eintrag. Das Web verwendet die opaque Prozessreferenz des Snapshots, nicht nur die PID.
Die Kopfzeile zeigt höchstens vier Einträge. Der Restzähler öffnet einen gemeinsamen Run-Dialog
mit allen Prozessen und denselben Aktionen; dort bleiben die Einträge kompakte Pills mit
gestricheltem Rahmen für Hintergrundprozesse. Unter 700 Pixeln bleibt die erste Prozessfläche
mit "Alle N" erreichbar. Der Dialog lässt die globale Kopfzeile bedienbar. Verschwindet der gerade
fokussierte Prozess, wechselt der Fokus zum nächsten Prozess-Steuerelement, im leeren Dialog
zu dessen Leerzustand und nach dem Schließen zur Kopfzeilennavigation. Sind keine Prozesse
mehr vorhanden, entfällt die Anzeige. Escape und Hintergrundklick schließen den Dialog.

Das Prozessplugin beendet einzelne Instanzen über ihre Snapshotreferenz aus PID und Startkennung.
Der Executor des Runs prüft Run-Zuordnung, Startkennung und UID vor jedem Signal erneut; die
Methode prüft Lese- und Schreibrechte und den Run vor dem Aufruf, und der Abbruch der Anfrage
erreicht den Executor zwischen seinen Schritten. Der Prozess des Executors (Server oder
Arbeitsplatz), dessen Vorfahren und PID 1 sind geschützt. Signale gehen ausschließlich an einzelne
positive PIDs, nie an eine möglicherweise mit fremden Prozessen geteilte Prozessgruppe.
Nach SIGTERM folgen zwei Sekunden Wartezeit, nötigenfalls SIGKILL und eine weitere Sekunde zur
Prüfung. Ein Durchlauf ist auf acht Sekunden begrenzt; fehlende Rechte, unlesbare Prozesstabellen
und verbleibende Prozesse sind explizite Fehler.

Beim Run-Stopp beendet das Prozessmodul im `stopRun` seines Executors alle markierten Prozesse des
Runs, auch ohne Port und unabhängig von ihrer Anzeige in der Kopfzeile. Bei einem Run mit
Arbeitsplatz stoppt der Sandbox-Host dessen Executor und den des Servers, weil die
TypeScript-Plattform dort mit demselben Marker läuft. `ragents.processes` ruft dasselbe Aufräumen
(`processes.stopAll`) zusätzlich in seinem Lebenszyklus: beim Stopp, in einem abschließenden
Durchlauf nach dem Ende der Actors und übrigen Stopp-Beiträge, der spät gestartete Kinder vor der
Run-Freigabe erfasst, und vor dem Löschen; ein nicht erreichbarer Arbeitsplatz lässt diese Aufrufe
mit `whenReachable` leer durchgehen, das Beenden holt der vorgemerkte Stopp des Runs nach (oben). Neue Kinder während der Bereinigung werden bei jedem Scan
aufgenommen. Diese Bereinigung benötigt keinen offenen Browser. macOS liest den Marker nur aus dem
Umgebungsanteil von `ps -E`, nicht aus gleichlautenden Kommandoargumenten. Die POSIX-Abfrage der
Startkennung und das Signal sind getrennte Betriebssystemaufrufe; sie bilden keine atomare
Prozessreferenz.

`ragents.workspace` trägt außerdem den rein lesenden Reiter `Dateien` bei: Arbeitsverzeichnis und
Dateiablage eines Runs als Baum mit Textvorschau, ohne Schreiben und Löschen; die Methoden
`ragents.workspace.browse.list` und `ragents.workspace.browse.preview` liefern Baum und Vorschau.
Den Arbeitsbereich liest der Reiter über das Dateimodul des Executors des Runs, bei einem Arbeitsplatz
also dort, und die Ortsangabe nennt dann dessen Label und Pfad
(`Arbeitsplatz <label>: <pfad>`). Die Dateiablage von `ragents.documents` liegt auf dem Server und
gehört nicht zum Arbeitsbereich; der Server liest sie mit denselben Funktionen des Pakets direkt.
Pfade sind relativ zur Wurzel, ohne `..` und nicht absolut; geprüft wird dort, wo gelesen wird, und
kein Symlink führt aus der Wurzel (`workspace-path-invalid`, 400; ein fehlender Pfad
`workspace-path-not-found`, 404). Eine Liste endet nach 500 Einträgen mit `truncated`; eine Datei
über 256 KB oder eine binäre Datei nennt statt des Inhalts den Grund. Der Kanal
`ragents.workspace.browse` (`runId`, `root`) meldet jede Änderung, beim Executor entprellt; er
steht, sobald die Beobachtung steht, und endet eine laufende Beobachtung, meldet er eine Änderung,
damit die Ansicht neu lädt und die Ursache zeigt, und beginnt alle fünf Sekunden eine neue; steht
sie wieder, meldet er noch eine Änderung. Das Dateimodul beendet offene Beobachtungen auch selbst,
beim Stopp des Runs und beim `shutdown` des Executors. Ein 30-Sekunden-Poll bleibt nur als Fallback.

### Prozess-Sandbox des Servers

Jeder Prozess, den der Executor des Servers für einen Run startet (`bash`, `commands.run`, die
Sprachserver samt ihrer `git`-Aufrufe), und die Node-Prozesse, die die TypeScript-Plattform im
Serverkontext startet (Snippets von `typescript_eval`, Backends und Tests der Actor-Programme),
laufen in einer Prozess-Sandbox des Betriebssystems: unter macOS Seatbelt (`sandbox-exec`), unter
Linux bubblewrap mit eigenem Netz- und PID-Namensraum, beides über die Bibliothek
`@anthropic-ai/sandbox-runtime` (Apache-2.0, feste Fassung in `apps/server/package.json`). Das gilt
auch für die Arbeit eines Runs, dessen Arbeitsbereich auf einem Arbeitsplatz liegt, soweit sie auf
dem Server läuft, also auch für eine Bash mit einem Alias als `cwd` und für Sprachserver auf einer
Wurzel des Servers; der Executor des Arbeitsplatzes selbst bekommt keine Sandbox, dort bleibt es die
Bash des Entwicklers. Der Kern kennt die Sandbox nicht: der Sandbox-Host des Servers
(`WorkspaceSandboxHost`) gibt sie dem Prozesskontext eines Runs mit (`WorkspaceProcessContext.sandbox`),
und jede Stelle, die einen Prozess startet, packt ihn mit `sandboxedLaunch` ein; ohne Sandbox im
Kontext startet er unverändert. Der Browser der Browserprüfung startet ohne Sandbox (Offene Grenzen).

Die Regeln entstehen je Run aus seinen Ordnern (`apps/server/src/plugin-support/process-sandbox.ts`).
Gesperrt zum Lesen sind das Home des Serverkontos, die übrigen Homes (`/Users`, unter Linux `/home`
und `/root`), `os.tmpdir()`, `/tmp` und der Datenordner des Profils, unter Linux dazu ein vorhandener
Docker-Socket. Innerhalb davon wieder lesbar sind der Host-Ordner, die Toolchains aus `PATH`,
`DOTNET_ROOT` und `PNPM_HOME` samt ihrem Präfix (nie ein Vorfahr des Datenordners), die Ablage des
eigenen Runs (`sessions/<run-id>`) und seine nur lesbaren Wurzeln (Skills; beim globalen Koordinator
ohne Benutzer der Journalordner). Lesen und schreiben darf ein Run die Wurzel seines
Arbeitsbereichs beziehungsweise seinen Serverordner, die registrierten Wurzeln (`@actors`), sein
Home, den gemeinsamen NuGet-Cache und seinen eigenen Temp-Ordner `sessions/<run-id>/tmp`, der in
`TMPDIR`, `TMP` und `TEMP` steht. Dazu kommen die Ordner, die sein Arbeitsbereich ausdrücklich
freigibt (`SessionWorkspace.sandboxFolders`, unten). Das übrige System (`/usr`, `/opt`, Toolchains)
bleibt lesbar und
ist nicht beschreibbar; die Bibliothek sperrt zusätzlich das Schreiben von `.git/hooks`, `.vscode`,
`.idea` und Shell-Startdateien, `.git/config` bleibt beschreibbar. Andere Runs, fremde Journale und
Geheimnisse im Home sehen die Prozesse also nicht; unter macOS scheitert ein solcher Zugriff mit
`Operation not permitted`, unter Linux ist der gesperrte Ordner leer. Weil `PATH`-Einträge oft
Symlinks in gesperrte Ordner sind (etwa fnm), nennt `PATH` in der Sandbox ihre Ziele. Ein freigegebener
Ordner, der einen gesperrten oder einen beschreibbaren enthält, wird beim Start jedes Prozesses in
seine übrigen Einträge zerlegt, damit weder die Sperre noch der Schreibzugriff darin verloren geht;
was danach neben ihm entsteht, sieht erst der nächste Prozess.

Was sich die Runs teilen müssen, weil Werkzeuge es fest vorgeben: unter macOS legt .NET seine
benannten Mutexe unter `/tmp/.dotnet` an und MSBuild die Sockets seiner Build-Knoten unter
`/tmp/MSBuild*`; beides ist beschreibbar, Unix-Sockets sind unter `/tmp` und im Datenordner
erlaubt, und der Zertifikatsdienst `trustd` ist erreichbar, ohne den .NET und Go kein TLS prüfen.
Unter Linux ist `/tmp` je Befehl ein eigener leerer Ordner, und Unix-Sockets sind ganz erlaubt,
weil seccomp sie nicht nach Pfad unterscheidet. Damit kein Build-Prozess den Befehl überlebt und
Builds anderer Runs in seiner Sandbox annimmt, laufen MSBuild ohne Knoten-Wiederverwendung
(`MSBUILDDISABLENODEREUSE`), ohne Build-Server und ohne gemeinsamen Compiler (`UseSharedCompilation`).

Ins Netz geht jeder Prozess nur über den Proxy der Bibliothek, der ausschließlich die Ziele der
Allowlist durchlässt; alles andere beantwortet er mit 403 ("Connection blocked by network
allowlist"). Die Allowlist ist `PROCESS_SANDBOX_NETWORK` in der Sektion `ragents.workspace`, eine
Liste von Domains wie `*.example.com` oder `host:port`; ohne Angabe gilt
`PROCESS_SANDBOX_DEFAULT_NETWORK`: `registry.npmjs.org` für npm und pnpm, `api.nuget.org` und
`globalcdn.nuget.org` für NuGet, `github.com`, `*.github.com` und `*.githubusercontent.com` für Git
über HTTPS und Releases. Die eigene Adresse des Servers (`127.0.0.1:<port>`) kommt immer dazu, weil
der globale Koordinator seinen Server über `RAGENTS_API_BASE_URL` erreicht. In der Sandbox ist
`NO_PROXY` leer, damit auch dieser Aufruf über den Proxy geht, `NODE_USE_ENV_PROXY=1` lässt `fetch`
in Snippets den Proxy nehmen, und `DOTNET_SYSTEM_NET_DISABLEIPV6=1` hält .NET auf IPv4, weil die
Sandbox von macOS eine IPv4-gemappte Adresse nicht als localhost erkennt.

Ein Arbeitsbereich kann Ordner außerhalb seines Ordners brauchen, die sonst gesperrt blieben, etwa
ein Git-Worktree, dessen gemeinsames Repository (`git rev-parse --git-common-dir`) woanders liegt:
ohne Freigabe scheitert Git in der Sandbox mit `not a git repository`. Dafür nennt
`SessionWorkspace.sandboxFolders` (für einen Beitrag in seiner `WorkspaceResolution`) je Ordner
`directory`, absolut, und `access`, `read` oder `write`; der Sandbox-Host übernimmt sie in die
lesbaren beziehungsweise beschreibbaren Ordner des Runs, ein relativer Pfad ist ein Fehler. Der
Kern kennt dabei kein Git, und die Freigabe gilt nur für Prozesse: die Dateiwerkzeuge erreichen
solche Ordner nicht.

`PROCESS_SANDBOX` in derselben Sektion ist ohne Angabe `"on"`; `"off"` schaltet die Sandbox für den
ganzen Server ab, und der Start meldet das im Protokoll. Den lokalen Host der VS-Code-Erweiterung
startet die Erweiterung mit `"off"`, weil er der Arbeitsplatz des Entwicklers ist. Beim Start prüft der Server die
Voraussetzungen, startet den Proxy und einmal einen Prozess in der Sandbox; jedes Scheitern ist ein
Startfehler mit Ursache und Anweisung: Windows (die Ordnerregeln je Run lassen sich dort nicht
setzen), eine andere Plattform, unter Linux fehlendes bubblewrap, socat oder ripgrep und ein
Kernel oder Container ohne Benutzer-Namensräume. Die Bibliothek hat einen Zustand je Prozess;
mehrere Server in einem Prozess (Tests) teilen ihn, ihre Netzfreigaben werden vereinigt.

## Provisionierung je Plugin

Ein Plugin, das Werkzeuge auf der Maschine braucht, bringt neben `server/` eine `provision.ts` im
Plugin-Ordner mit; im Bundle reicht `server/index.js` ihren Export weiter. Sie exportiert
`provision` mit zwei Funktionen (Vertrag in `apps/server/src/plugin-support/provision.ts`):

- `check(target)` liefert `{ kind: "ready" }` oder eine benannte Lücke
  `{ kind: "gap", name, instruction, installable }`.
- `apply(target, log)` schließt eine Lücke mit `installable`; bei `ready` tut es nichts, bei einer
  Lücke ohne `installable` bricht es mit deren Anweisung ab.

`target` ist der Werkzeugordner des Plugins, `<Datenordner>/tools/<plugin-id>/`, also ein Ordner
außerhalb des Repositories und je Host einer. Idempotent heißt: nach `apply` liefert `check`
`ready`, und ein zweites `apply` lädt nichts nach und ändert nichts. Dafür legt die
Provisionierung neben den Dateien eine `provisioned.json` mit der gepinnten Fassung ab; eine
andere Fassung ist wieder eine Lücke. Provisionierung ist reiner Node-Code, kein Shellskript:
Downloads lädt Node (`downloadArchive`), Archive packt der kleine ZIP-Leser des Hosts aus
(`plugin-support/zip.ts`; nur Store und Deflate, Zip64 ist ein Fehler).

Was sich nicht installieren lässt, meldet `check` als Lücke ohne `installable` samt Anweisung:
fehlendes `dotnet` bei Roslyn und FSAC, ein `BROWSER_EXECUTABLE_PATH`, der ins Leere zeigt. Beim
Start eines Servers ist eine offene Lücke ein harter Fehler, kein Hinweis.

`pnpm provision [<profil>|<pfad>]` (`scripts/provision/run-provision.ts`) lädt die Profildatei wie
der Server, importiert die Bundles des Profils, provisioniert jedes, das `provision` exportiert, und berichtet je Plugin
`bereit`, `installiert` oder `fehlt: <Grund>`; eine verbliebene Lücke ist ein Exit-Code ungleich
null. `pnpm connect` ruft dasselbe zwischen Holen und Start, die VS-Code-Erweiterung vor dem Start
des lokalen Hosts.

Ein Arbeitsplatz hat kein Profil. `pnpm provision --workspace` provisioniert dort die Plugins, deren
Werkzeuge die Module seines Executors auf dieser Maschine brauchen: die Sprachserver
(`ragents.lsp-roslyn`, `ragents.lsp-fsharp`) in den Werkzeugordner unter
`~/.local/share/ragents/workspace/` und den Browser (`ragents.browser`), dessen Chromium im
Browsercache von Playwright landet, sofern `BROWSER_EXECUTABLE_PATH` in der Umgebung keinen
eigenen Chrome nennt. Mitgeladen werden die Bundles, deren Exporte diese drei importieren (etwa
`ragents.documents` für den Browser), weil ein Bundle ohne sie nicht lädt; provisioniert wird
nur, was `provision` exportiert. `pnpm workspace-client` und die VS-Code-Erweiterung rufen das bei ihrem
eigenen Start; eine Lücke hält den Arbeitsplatz nicht auf, sie scheitert erst beim Aufruf des
betroffenen Sprachservers oder Browsers.

Ein Profil nennt eine provisionierte Datei mit `provisioned("<plugin-id>", "<pfad>")` statt eines
absoluten Pfades; beim Laden der Profildatei wird daraus `<Datenordner>/tools/<plugin-id>/<pfad>`.
Der Datenordner ist derselbe wie beim Start (`DATA_DIR`, sonst `host.DATA_DIR`, sonst
`~/.local/share/ragents/<profil>`). Ein absoluter Pfad bleibt zulässig, etwa für einen selbst
installierten Server.

## Language-Server-Plugins

Diagnostik ohne Build: `ragents.lsp-roslyn` (C#), `ragents.lsp-fsharp` (F#, fsautocomplete) und
`ragents.lsp-typescript` sind drei produktneutrale Plugins über EINEM gemeinsamen Client im
Executor (`packages/workspace-executor/src/language-server/`: JSON-RPC über stdio, Dokument-Sync
mit vollem Text, Diagnostik per Pull oder Push, Prozess über `startManagedService`). Die drei
Adapter (Start, Wurzeltyp, Laden, Endungen) gehören zum Executor, damit jeder Executor dieselbe
Menge Sprachserver anbietet; das Plugin ist nur noch Beschreibung, Konfigurationsschlüssel,
Reiter und Weiterreichung über die gemeinsame Fabrik `createLanguageServerPlugin`. Welcher
Rechner den Sprachserver startet, entscheidet die Wurzel, die der Aufruf nennt (Abschnitt
Arbeitsbereich, Sandbox-Werkzeuge und Prozesse): `<id>_open` mit `root: "@actors/app"` startet ihn
auf dem Server, auch in einem Run auf einem Arbeitsplatz, ein Pfad ohne Alias beim Executor der
Bindung; fehlt er dort, scheitert der Aufruf mit Ursache. Nennt ein Aufruf keine Wurzel,
`<id>_diagnostics` ohne `root` und `paths`, `<id>_close` ohne `root` und der Stand für den
Diagnosereiter, fragt er die Instanzen beim Executor der Bindung; eine Instanz auf einer Wurzel des
Servers erreicht ein Run auf einem Arbeitsplatz über `root` oder `paths` mit Alias. Den Pfad zum
Server nimmt der Adapter aus dem Werkzeugordner dieser Maschine
(`<Datenordner>/tools/<plugin-id>/`, siehe Provisionierung je Plugin); im Server setzt ihn die
Profilsektion des Plugins mit `provisioned(...)` auf denselben Ort. Die Umgebungsvariablen
`ROSLYN_LANGUAGE_SERVER` und `FSHARP_LANGUAGE_SERVER` übersteuern ihn, etwa für einen selbst
installierten Server; fehlt beides, nennt der Fehler den erwarteten Pfad und den Befehl.
TypeScript wird nicht provisioniert, sondern liegt in den `node_modules` des Hosts; der Adapter
löst `typescript-language-server` und `typescript` deshalb aus dem Ordner auf, den der Kontext des
Runs als `hostRoot` nennt (`createRequire(<hostRoot>/package.json)`). Den Wert setzt jeder
Aufrufer des Executors: der Server seine eigene Wurzel (`hostRoot()`), der kopflose Arbeitsplatz
dieselbe, die VS-Code-Erweiterung `ragents.hostPath` oder den Host, den sie zuletzt gestartet hat
(`ragents.lastHostPath`, das geholte Paket unter `<globalStorage>/hosts/<fassung>/`). Kennt ein
Arbeitsplatz noch keinen Host, scheitert `typescript_open` mit genau dieser Ursache; alles andere
an ihm arbeitet weiter. Kein Adapter und kein Modul des Executors löst beim Import etwas auf,
lädt etwas herunter oder prüft etwas auf der Platte: jede Auflösung passiert erst im Aufruf und
scheitert dort mit Ursache. Ein Adapter, der es beim Laden täte, würde jeden Prozess mitreißen,
der den Executor nur importiert - etwa die gepackte VS-Code-Erweiterung, die keine `node_modules`
neben sich hat.
Die stdio-Verbindung verwendet `vscode-jsonrpc` für Framing, Request-Zuordnung und Antworten.
Der Host verbindet `AbortSignal` mit JSON-RPC-Cancellation und beendet die lokale Anfrage sofort;
späte Antworten ändern ihr Ergebnis nicht. Transportfehler schließen offene Anfragen mit Ursache
und beenden den zugehörigen verwalteten Prozess. Prozessstart, Dokumentabgleich und fachliche
Diagnostik bleiben beim gemeinsamen Language-Server-Client.

- Je Plugin drei native Werkzeuge: `<id>_open(root)`, `<id>_diagnostics(paths?, root?, warnings?)`
  und `<id>_close(root?)`. Der Server startet durch einen ausdrücklichen Funktionsaufruf eines
  Agenten oder vorbereiteten Actor-Programms. Produktspezifische Wurzeln gehören zum aufrufenden
  Plugin, nicht zum Host.
- Der Schlüssel einer Instanz ist Run PLUS Wurzel, nicht der Run allein: `<id>_open` startet eine
  Instanz für genau diese Wurzel, wenn es sie noch nicht gibt, und lässt die übrigen Instanzen
  desselben Runs stehen. Für dieselbe Wurzel ist der Aufruf idempotent. Die Rückgabe nennt die
  Wurzel und die Zahl der offenen Instanzen dieser Sprache im Run. Ein Run kann also zwei
  Solutions gleichzeitig geladen haben.
  Ohne `paths` fragt `<id>_diagnostics` je offener Instanz `git status` gegen die Wurzel des Repos
  und grenzt mit `-- .` auf die Wurzel dieser Instanz ein; ein Arbeitsbereich darf also ein
  Unterordner eines Repos sein. Mit `paths` beantwortet jede Datei die Instanz, deren Wurzel sie
  enthält - bei mehreren die mit dem längsten Präfix. Eine Datei außerhalb jeder offenen Wurzel
  ist ein benannter Fehler, der die offenen Wurzeln nennt. `root` fragt gezielt eine Instanz.
  `<id>_close` beendet eine Instanz, ohne `root` alle des Runs.
- Während des Ladens steht die Instanz sofort auf `opening`; `ready` folgt erst nach
  abgeschlossenem Adapter-Laden. Bei Roslyn schließt das die Bestätigung der Projektinitialisierung
  ein. `failed` erhält Wurzel und konkrete Ursache bis zum erneuten Öffnen oder Stoppen; die
  Wurzel steht dabei aufgelöst gegen den Arbeitsbereich, auch wenn schon die Pfadprüfung scheiterte,
  und `<id>_close(root)` findet sie unter dem genannten Pfad. `<id>_diagnostics` ohne `root` und
  ohne `paths` übergeht eine gescheiterte Instanz und hängt ihre Ursache an das Ergebnis der
  übrigen an; es scheitert nur, wenn alle Instanzen gescheitert sind. Mit `root` oder mit einer
  Datei in ihrer Wurzel bleibt die gescheiterte Instanz ein Fehler mit ihrer Ursache, ein neuer
  Start geschieht nur über `<id>_open`. Die Operationen prüfen ihre Eingabe selbst (`root`,
  `paths`, `warnings`) und lehnen falsche Typen mit `language-server-input-invalid` ab.
  Der Diagnosereiter listet alle Instanzen des Runs mit Wurzel, Zustand und Zusammenfassung und
  zeigt Ladezustand und Fehler, ohne daraus Fehlerfreiheit abzuleiten. Der Schnappschuss ist
  deshalb eine Liste, kein einzelner Zustand. Paralleles Öffnen derselben Wurzel teilt den Start.
  Stoppen, Schließen und Shutdown verhindern verspätete Erfolgsmeldungen und beenden die
  verwalteten Prozesse; eine andere Wurzel lässt die laufenden Instanzen unberührt.
- Nach jedem erfolgreichen `edit`/`write` hängt der Executor die Fehler der geschriebenen Datei
  als weiteren Textteil ans Werkzeugergebnis an, für jeden Sprachserver, der die Endung kennt und
  im Run eine Instanz hat, deren Wurzel die Datei enthält; die Wahl läuft über dasselbe längste
  Wurzel-Präfix wie bei `paths`. Passt keine Instanz, bleibt die Anmerkung aus. Der Sandbox-Host
  des Servers bietet dafür den Slot `sandboxServicesToken` (`execute`, `serverProcessContextFor`,
  `registerWorkspaceRoot`, `shutdown`).
- Eine Instanz je Plugin, Run und Wurzel, geteilt von allen Actors des Runs, gestartet mit der
  Umgebung und UID des Run-bash; Leerlauf beendet jede Instanz einzeln nach 20 Minuten, der
  nächste Zugriff lädt ihre gemerkte Wurzel neu. `<id>_close`, Run-Stopp und Server-Shutdown
  beenden sie; Run-Stopp und Shutdown beenden alle Instanzen des Runs. Kein Journal-Zustand: nach
  einem Host-Neustart ist nichts geöffnet, `<id>_diagnostics` scheitert hart, die Annotation
  bleibt still.
- Fehler immer, Warnungen nur gezählt (auf Anfrage gelistet), gedeckelt bei 30 Zeilen.
- Der TypeScript-Adapter setzt `publishesOnlyChangedDiagnostics`: weil
  typescript-language-server bei unverändert leerer Diagnostik nach `didChange` nichts
  publiziert, schließt die Session eine fehlerfreie, geänderte Datei und öffnet sie neu, statt auf
  eine Antwort zu warten. Roslyn nutzt Pull-Diagnostik und ist nicht betroffen.
- Grenzen: Roslyn sieht F#-Projekte nur als gebaute DLL, FSAC C#-Projekte ebenso; ein neu
  angelegtes File kennt Roslyn erst, wenn sein Dateiwächter es gemeldet hat.

<!-- guide:plugins -->
## Skills and starting tasks

Skills belong to their plugin under `skills/<name>/SKILL.md`, with supporting files in the same
folder. `SKILLS_DIR` adds local skills outside the repository. Every skill has a `name`,
`description`, and non-empty instructional body. Without `start`, it is available only while
working. `start: true` also makes it selectable and requires a `title` and one non-empty
`category`; `order`, `tags`, and `guide` are optional. `prompt` can provide a short starting task,
otherwise the body is used. Explicit contributions use `action: "skill"`, `skill`, `category`,
and `prompt`, and the skill name must be registered.

A skill's name is its folder name and unique in a profile, across audiences; two folders with one
name stop the server at startup. The model reaches every skill folder read-only as
`@skills/<name>/`, whichever machine the run works on: the skill overview and preloading name
`@skills/<name>/SKILL.md`, never the path on the server, and relative paths in a skill resolve in
that folder. File tools read there, and `bash` runs there with `cwd: "@skills/<name>"`, on the
server.

Optional `disable-model-invocation: true` removes a skill from the model's automatic overview
while keeping explicit loading available. Simple example tasks use it but remain selectable
through `start: true`. Reusable instructions can also provide a short starting task so both stay
in one skill. Clicking shows only the preview; adopting it opens the preparation chat. Parser
tests verify files, starting tasks, tags, and publication, while `reference-run-scripts.test.ts`
checks, tests, and installs every reference package against core.
<!-- /guide:plugins -->

### Beispiel einer Skill-Vorlage

```markdown
---
name: two-perspectives
description: Zwei Perspektiven auf eine Aufgabe vergleichen.
start: true
title: Zwei Perspektiven
disable-model-invocation: true
category: Zusammenarbeit
order: 10
tags: Anwendungsfall, Konzeptdemo, Agententeams
---
Ich hätte gern zwei unterschiedliche Perspektiven auf meine Aufgabe und eine gemeinsame Empfehlung.
```

Die Datei liegt unter `skills/two-perspectives/SKILL.md`; Ordnername und `name` stimmen überein.
Ohne eigenes `prompt`-Feld ist der Body zugleich der bearbeitbare Startauftrag. `tags` ist
optional für allgemeine Plugins und Pflicht im Referenzkatalog; eine leere oder doppelte Angabe
scheitert beim Einlesen.

## Referenzfälle aus ragents.reference

`ragents.reference` bündelt neutrale Skills, Run-Scripts und Web-Leitfäden als mitgelieferte
Demos und mögliche High-Level-Testfälle für RAgents. Kundenspezifische Abläufe und
Integrationen gehören nicht zu diesem Katalog. Das Plugin gehört zum Profil `showcase`;
`core` bleibt als Vorlage für echte Profile ohne dieses Lehrmaterial, führt es aber wie jedes
andere Profil bei Bedarf in seiner Pluginliste auf.
Die Beispiele haben zwei überlappende Blickrichtungen: Anwendungsfälle beginnen mit einer
konkreten Aufgabe, Konzeptdemos machen eine Plattformfähigkeit gezielt beobachtbar.
Jede Skill-Vorlage beschreibt ein Ziel in einem kurzen, frei formulierten Prompt und zählt als
ein Beispiel. Ihre einzelne Kategorie steht in `category`, unabhängig von Konzept-Tags.
Die `description` jeder Demo-Vorlage nennt in kurzem Fließtext ihren Demonstrationszweck:
welche Konzepte zusammenspielen und was dabei beobachtbar werden soll. Das gilt für Skills und
Run-Scripts; bei ähnlichen Fällen benennt sie den Unterschied. Der Text steht direkt im
vorhandenen Beschreibungsfeld und erscheint in Startauswahl und Referenz.
Der Host besitzt keine feste Liste zulässiger Kategorien. Die Referenzvorlagen verwenden unter
anderem Mini-Apps, TypeScript ohne Oberfläche, Zusammenarbeit und Code und Diagnose. Die
Mini-App-Gruppe enthält reine Views, gemeinsame Funktionen, LLM-Views, mehrere Ansichten
eines Zustands und automatisch gesammelte Agentenantworten.
Die Skill-Vorlage Balkon-Wizard fordert eine eigenständige App auf der Fläche an, die ein begrenztes
Gespräch mit einem KI-Berater im Hintergrund vermittelt. Nach jeder Antwort bestimmt das LLM
die nächste Frage anhand des bisherigen Gesprächs; eine feste Fragenliste erfüllt den Auftrag
nicht. Antworten werden ausschließlich in der App eingegeben; nach fünf Antworten steht eine
Gestaltungsempfehlung. Die App ist nicht in eine LLM-Chatkarte integriert.
Die Vorlage verlangt gemeinsame Layout- und Formularbausteine sowie
Fortschritt, Lade- und Fehlerzustände. Sie ist ein Auftrag zum Aufbau, kein vorinstallierter Wizard.

Daneben bietet das Run-Script `balcony-wizard` ein vorbereitetes Demo derselben Aufgabe.
Es erstellt ohne Koordinator einen Berater mit Rolle `standard` und leerer Werkzeugliste,
bindet die eigene View an ihn und wählt ihn als Primary-Actor. Der Startknopf in der App
beginnt das Interview; das Setup ruft noch kein Modell auf. Das Formular zählt fünf Antworten,
der Berater bestimmt die Fragen und die abschließende Empfehlung. Fortschritt und fertige
Ausgaben stammen aus dem Actor-Gespräch und bleiben beim Neuladen erhalten. Fehlgeschlagene
Modellantworten lassen sich erneut anfordern, ohne eine weitere Benutzerantwort zu zählen.
Das Demo verwendet AppLayout, Stack und Form und besitzt kein Chat-Widget. Es ist ein konkretes
Referenzpaket, keine fachliche Vorgabe an den allgemeinen Run-Builder.

Die Konzeptzuordnung steht in `tags` der Vorlagen: bei Skills und Run-Scripts im kommagetrennten
Frontmatter, bei expliziten Beiträgen als Stringliste. Der Host behandelt alle Schlagworte gleich;
er kennt keinen Referenzkatalog. Namen müssen nicht leer, eindeutig und ohne äußere Leerzeichen
sein. Die UI zeigt die Schlagworte und verwendet sie für Suche und Auswahlfilter.
Der Konzeptkatalog liegt ausschließlich in `plugins/ragents.reference/examples.ts`.
Bedienbeispiele in `plugins/ragents.reference/walkthroughs.ts` ergänzen Konzepte außerhalb einer
Vorlage, etwa den globalen Koordinator und die Wiederherstellung. Sie beschreiben konkrete
Benutzerschritte und erwartetes Verhalten, registrieren aber keine zusätzlichen Vorlagen.
Die erzeugte Referenz bildet daraus und aus den tatsächlichen Vorlagen die beiden
Blickrichtungen und die Konzeptübersicht. `pnpm check:homepage` verlangt mindestens zwei
Beispiele je Produktkonzept sowie gültige Zuordnungen. Für gewöhnliche Konzepte zählen Skill-Vorlagen;
Startleitfäden, Run-Scripts, Bedienbeispiele und der Primary-Actor haben die im Katalog ausdrücklich
angegebene Zählart. Ein gleiches Szenario als Skill und Script verdoppelt die Fachabdeckung nicht.
Die Zuordnung ist eine redaktionelle Abdeckung, kein Nachweis erfolgreicher Modellläufe.
UI-Controls sind keine eigenen Konzepte in diesem Katalog. Die Demos kombinieren Controls
nach ihrem Anwendungsfall; weder eine Mindestzahl pro Control noch vollständige
Control-Abdeckung ist vorgeschrieben. Die technische UI-Referenz entsteht unabhängig davon
weiterhin aus den exportierten Verträgen.

Zwei Web-Leitfäden bieten vor dem Run eine eigene Oberfläche: `Gesprächsrunde einrichten`
sammelt Thema und Rundenzahl, `Sammelboard einrichten` Titel und ersten Eintrag samt Vorschau.
Erst `onComplete` übergibt die Werte an das jeweilige Run-Script; Abbrechen und Escape starten
nichts. Die Scripts validieren Eingaben vor den ersten Capability-Aufrufen und verwenden sie
für den Run-Titel und die Agentenaufträge. Bei ausdrücklich übergebenem `null` gelten die im
Paket beschriebenen Standardwerte. Der weitere Ablauf bleibt vom Modell gesteuert.
`Moderierte Runde ohne Koordinator` demonstriert zusätzlich `coordinator: false` und einen
anderen Primary-Actor. Zwei neutrale Skill-Vorlagen führen eine Entscheidung beziehungsweise
Lerneinheit als wiederverwendbare Arbeitsanweisungen im Chat, ohne einen programmierten Aufbau.

## Browserprüfungen

`ragents.browser` ergänzt einen echten, über Playwright gesteuerten Browser und benötigt
`ragents.documents`. Jeder Run besitzt einen eigenen Browserprozess mit einer Seite, isolierten
Cookies und ohne übernommene Anmeldung. Öffnen, semantisches Lesen, Klicken, Ausfüllen,
Auswählen, Tastatureingaben, Prüfungen und Screenshots sind typisierte Run-Funktionen.
Die verbindlichen Schemas stehen in `plugins/ragents.browser/server/tools.ts`.
Der ARIA-Snapshot enthält zugängliche Rollen, Namen und Elementreferenzen; Aktionen lösen
Rolle/Name, Beschriftung, Text, Test-ID oder CSS im Browser des Runs auf. Modelle müssen weder
Snapshot-IDs noch Ergebnisdateipfade abschreiben. Ein optionales Ziel-Iframe wird per CSS gewählt.

Der Browser läuft dort, wo der Arbeitsbereich des Runs liegt. Browser, Seite und alles, was die
Seite anfasst, sind das Browsermodul des Executors (`packages/workspace-executor/src/browser/`)
mit den Operationen `browser.open`, `browser.snapshot`, `browser.viewport`, `browser.click`,
`browser.fill`, `browser.select`, `browser.press`, `browser.check`, `browser.screenshot`,
`browser.state` und `browser.close`; `stopRun` und `shutdown` des Moduls schließen den Browser,
und nach `shutdown` startet das Modul keinen mehr, sondern lehnt jede Operation an der Seite mit
Ursache ab.
Auf dem Server startet ihn also der Executor des Servers, auf einem Arbeitsplatz dessen, und `localhost` meint die Maschine, auf der auch die geprüfte Anwendung läuft.
Die Server-Hälfte des Plugins behält Werkzeugbeschreibungen, Schemata, Skill, die Ablage der
Aufnahmen, die Evidenz, den gewählten Viewport und den Lebenszyklus und ruft alles andere über
`SandboxServices.execute`, bei einem Werkzeugaufruf mit dessen Kennung.

Das Modul lädt playwright-core erst im Aufruf aus der Host-Wurzel dieser Maschine (`hostRoot`),
wie der TypeScript-Adapter seinen Sprachserver; weder das Executor-Paket noch das Bundle der
VS-Code-Erweiterung enthalten es. Kennt ein Arbeitsplatz noch keinen Host oder fehlt
playwright-core darin, scheitert `browser_open` mit genau dieser Ursache. Chrome ist der Browser
aus `BROWSER_EXECUTABLE_PATH` in der Umgebung dieser Maschine, sonst das Chromium, das die
Provisionierung für die gepinnte playwright-core-Fassung in den Browsercache von Playwright legt;
fehlt beides, nennt der Fehler den erwarteten Pfad und den Befehl. Auf dem Server setzt die
Profilsektion `ragents.browser` den Wert in dessen Umgebung. Auf einen Arbeitsplatz wandert er
nicht: dort gilt dessen eigene Umgebung oder das Chromium aus `pnpm provision --workspace`.
Chrome startet mit der sicheren Umgebung dieser Maschine, ihrem `HOME` und dem Marker des Runs,
die Prozessanzeige ordnet ihn deshalb dem Run zu.

Was im Run dauerhaft sichtbar ist, hält der Server. Jede Operation an der Seite liefert neben
ihrem Ergebnis den Stand der Seite: Adresse, erfasste Fehler, ob seit der letzten Aktion oder
Navigation eine Prüfung bestanden hat, und die Kennungen der Aufnahmen seit dann. Daraus führt
der Server die Evidenz des Runs. Die Zeit einer bestandenen Prüfung setzt er mit seiner eigenen
Uhr, damit sie sich mit seinen übrigen Zeiten vergleichen lässt, auch wenn der Browser auf einem
Arbeitsplatz mit anderer Uhr läuft. Scheitert ein Aufruf, fragt der Server den Stand mit
`browser.state` nach; ist der Executor nicht erreichbar, gilt die Seite als geschlossen. Ein
Bildschirmfoto kommt als PNG in Base64 vom Executor zurück, und der Server legt es in die
Dateiablage des Runs.

Die Aktionen eines Runs laufen geordnet und verwenden Playwright-Wartebedingungen.
Mehrdeutige oder nicht bedienbare Ziele, fehlende Browser und fehlgeschlagene Navigationen
melden Fehler; bei Mehrdeutigkeit nennt der Fehler die Kandidaten und den Ausweg. Ein Ziel
wählt mit `nth` (0-basiert) oder `first: true` einen von mehreren Treffern; `browser_check`
prüft mit `count` die Anzahl sichtbarer Treffer eines Ziels statt seiner Eindeutigkeit
(`0` belegt Abwesenheit). Reine Sichtbarkeits- und Adressprüfungen in `browser_check` warten
höchstens 5 Sekunden, Aktionen die volle Zeitgrenze von 15 Sekunden.
Konsole, JavaScript-Ausnahmen und fehlgeschlagene Netzwerkantworten fließen in
die Prüfung ein. Erfolgreiche explizite Assertions erzeugen einen Zeitstempel; Aktionen,
Navigation verwerfen ihn; neue Fehler bleiben in der Fehlerliste des Runs sichtbar, ohne die
Prüfung zu verwerfen. Ein Screenshot allein ist kein erfolgreicher Test.

Die Seite läuft standardmäßig in einem Viewport von 1920 x 1080 Pixeln (16:9, Skalierung 1),
sodass Screenshots ohne Vergrößerung als Full-HD-Bilder vorliegen und breite Oberflächen wie
ein Ribbon vollständig sichtbar sind. `browser_viewport` stellt die Größe je Run um, etwa für
schmale Layouts; der gewählte Wert gilt bis zur nächsten Änderung, auch nach einem Neustart
des Browsers im selben Run, weil der Server ihn hält und jedem neuen Browser mitgibt; ein
Serverneustart vergisst ihn. Screenshots liegen als PNG unter `browser/` in der
Run-Dateiablage und sind über deren bestehende Bildanzeige erreichbar. Eine atomar geschriebene, verborgene Aufnahmeliste erhält
Namen und Dateireferenzen über Browserstopp und Serverneustart. Die Vorbereitung eines Runs
lädt sie wieder; dabei wird kein Browser gestartet. Der Dienst `browserRuntimeToken` liefert
die historische Aufnahmeliste getrennt von aktuellen Aufnahmen und gültiger Prüfungszeit.
Beschädigte Aufnahmemetadaten melden einen Fehler für den betroffenen Run.
Das native Agentenwerkzeug `browser_view_screenshot` liefert das letzte Bild direkt als
Bildinhalt, ohne Pfadangabe. Ein Modell ohne Bildunterstützung erhält einen ausdrücklichen Fehler.

Browserstopp und Abbruch schließen die Prozesse beim Executor, der sie gestartet hat;
gespeicherte Aufnahmen bleiben erhalten. Ein Abbruch, bevor die Aktion an der Reihe war, lässt
den Browser offen.
Run-Löschung und Shutdown geben die Ressourcen frei. Nach dem Schließen gibt es keine aktuelle
URL oder gültige Prüfungszeit mehr. Neue Fenster werden gemeldet und geschlossen; mehrere
bedienbare Tabs und die Übernahme persönlicher Browserprofile sind nicht Teil dieses Plugins.

## Wächter mit Weckbedingung

`ragents.watch` beobachtet je Run Actors und weckt andere Actors, sobald eine als TypeScript
formulierte Bedingung im geänderten Stand einen Grund liefert. Es gibt kein Modell im Wächter.
`watch_create` nennt den beobachteten Actor (`source`), die Bedingung (`condition`) als Rumpf
einer Funktion `(now: WatchState, before: WatchState) => string | undefined`, den zu weckenden
Actor (`target`, ohne Angabe der Aufrufer), optional eine benannte Operation ohne Eingabe
(`observe`), deren Ergebnis den beobachteten Stand ergänzt, einen Text, der jeder Weckung
angehängt wird (`instruction`), und `stallAfterSeconds`. Die Bedingung wird beim Anlegen mit dem
gemeinsamen TypeScript-Compiler gegen die Typen von `WatchState` geprüft; ein Fehler lehnt das
Anlegen ab. Zur Laufzeit läuft sie in einem `vm`-Kontext ohne Zugriff auf Node oder den Server
mit 200 ms Grenze je Auswertung; sie liefert den Weckgrund als Text oder nichts, alles andere ist
ein Fehler. Ein Wächter mit gleicher Quelle, gleichem Ziel und gleicher Bedingung wird nicht
doppelt angelegt; `watch_list` und `watch_remove` verwalten den Bestand. Die Definitionen stehen
mit Grundlinie, Zähler und den letzten zehn Urteilen (Zeitpunkt, geweckt oder nicht, Grund,
vorgelegte Änderungen) als Plugin-Zustand am Run im Journal und werden beim Vorbereiten eines
Runs neu kompiliert und wiederhergestellt.

Der beobachtete Stand ist deterministisch: Lebenszyklus des Quell-Actors, Zahl der beendeten
Turns, Zustand und Grund des letzten Turns, wartende Eingaben, offene Fragen, der letzte
Ausgabetext gekürzt, dazu das Ergebnis der Operation aus `observe` und, sobald seit dem letzten
Ereignis des Quell-Actors `stallAfterSeconds` vergangen sind, `stalledForSeconds` in ganzen
Vielfachen dieser Spanne; jede weitere Periode ändert den Stand erneut, ein Herzschlag also
weckt, solange die Bedingung ihn nennt. Zeitbasis ist die Uhr der Laufzeit. Der Dienst hört auf
die Journal-Events des Runs und bewertet gedrosselt (Standard eine Sekunde nach dem ersten
Ereignis), ein Zeittakt prüft den Stillstand. Bewertet wird nur, wenn sich der Stand seit der
letzten Bewertung geändert hat, das Ziel frei ist (kein laufender Turn, keine wartende Eingabe,
keine offene Frage des Ziels) und die Quelle zur Ruhe gekommen ist: Solange der beobachtete Actor
einen Turn ausführt oder Eingaben auf ihn warten, wird nicht bewertet, die Änderungen sammeln
sich bis zum Ende der Kette in einer Bewertung; nur ein erkannter Stillstand wird auch bei
laufendem Turn bewertet. Eine leere oder gegenüber der letzten Bewertung unveränderte
Änderungsliste wird nicht erneut bewertet. Beim Anlegen wird der erste Stand still als
Grundlinie gespeichert; `before` in der Bedingung ist immer der Stand bei der letzten Weckung.

Liefert die Bedingung einen Grund, erhält das Ziel einen ActorInput mit
`presentation: "background"` im Namen des Owners: Grund, Änderungen seit der letzten Weckung
als flache Zeilen (`pfad: alt -> neu`, `(neu)`, `entfernt`) und der Text aus `instruction`. Der
geweckte Stand wird zur neuen Grundlinie. Ein Stillstandstakt, der nicht weckt, ändert nur den
Speicherstand, nicht das Journal. Eine werfende Bedingung weckt nicht, wird protokolliert
und lässt den Wächter bestehen; die nächste Änderung wird erneut bewertet. Stop, Löschung und
Shutdown beenden die Beobachtung.

Der Wächter startet keine Arbeit selbst und kennt keine Fachlogik.

## Modell-Relay

`ragents.model-relay` macht die Modelle dieses Servers für andere RAgents-Server nutzbar, ohne
Anbieter, echten Modellnamen oder Schlüssel preiszugeben. `RELAY_MODELS` ist eine Liste
`alias=anbieter/modell`; jeder Alias muss auf einen Anbieter zeigen, den ein Produkt-Plugin über
den Dienst `modelUpstreamsToken` (`plugin-support/model-upstreams.ts`, Adresse, Schlüssel,
Katalog) bereitstellt, und auf ein Modell aus dessen Katalog, sonst bricht der Start ab.
`ragents.product` liefert `openrouter`, sobald `OPENROUTER_API_KEY` gesetzt ist; der Schlüssel
wird nicht ein zweites Mal deklariert.

Zwei Auslieferungsrouten unter `/relay/v1`, beide mit dem Recht `models.use`:
`GET /models` liefert die Aliasse im OpenAI-Listenformat mit einem `catalog`-Block je Eintrag
(Reasoning, Denkstufen, Eingabearten, Kontextgröße, Ausgabegrenze, `compat` für den Draht),
ohne Namen, Anbieter oder Kosten. `POST /chat/completions` liest den Anfragekörper, ersetzt
den Alias durch das echte Modell, setzt den Serverschlüssel und reicht Anfrage samt
Antwortstrom durch; andere Kopfzeilen des Clients (etwa Session-Affinität) gehen mit,
`Authorization`, `Cookie` und `Host` nicht. Ein unbekannter Alias ist 404, ein toter Anbieter
502, ein Abbruch des Clients bricht den Aufruf beim Anbieter ab. Auf dem Rückweg ersetzt das
Relay in jedem SSE-Block und in der nicht gestreamten Antwort das Feld `model` durch den Alias
und entfernt das Feld `provider`, weil beide das Geheimnis des Servers nennen; jede andere
Zeile und jedes andere Feld geht unverändert weiter, und aus demselben Durchlauf stammt der
letzte `usage`-Block fürs Protokoll. Eine eigene Streaming-Logik baut das Relay nicht. Je
Aufruf steht Benutzer, Alias, echtes Ziel, Status und Tokenzahl in
`plugins/ragents.model-relay/relay.log` der Datenablage. Kontingente und Abrechnung gibt es
nicht; wer den Token hat, hat den Modellzugang des Relays.

Beim Verbraucher ist das Relay schlicht der Anbieter `relay` (siehe [profiles.md](profiles.md),
`AGENT_PROVIDER: "relay"`); zwischen zwei RAgents-Servern läuft nichts als der
OpenAI-kompatible Draht. Das Relay trägt keine Run-Zugehörigkeit und hängt nicht an der Engine.

## Profilverteilung

`ragents.profile-distribution` bietet ein Client-Profil dieses Servers zum Herunterladen an.
`CLIENT_PROFILE_FILE` nennt die Client-Profildatei, relativ zur Server-Profildatei (je
Variante eine Datei: `ragents.config.customer-client.ts` neben `ragents.config.customer.ts`); ohne
den Schlüssel ist das Plugin inaktiv und sagt das im Log, ein gesetzter Schlüssel ohne Datei
bricht den Start. Beim Start prüft das Plugin die Datei ohne ihre Umgebung: Name
`ragents.config.<profil>.ts`, `host.PRODUCT_PROFILE` gleich dem Namen, `host.PLUGINS` nicht
leer, jede Sektion gehört zu einem Plugin der Liste, Host-Schlüssel bekannt, Secrets nur als
`env(...)`, `users` und `anonymousUser` wohlgeformt; die Schlüssel je Plugin prüft erst der
Client beim Start gegen die Deklarationen. Plugins per Kennung kommen beim Client als
eingebaute Bundles aus dessen Host (Checkout oder Paket `@schlenkr/ragents`) und werden nicht
mitgeliefert. Plugins per Pfad sind Bundles, die der Verteiler mit demselben Leser wie der
Server prüft (Manifest, Kennung, `format`, `api` gleich seiner Host-API); sie kommen unverändert
ins Archiv, ihre Provisionierung als Export von `server/index.js`. Ein Quellordner statt eines
Bundles und symbolische Links in einem Bundle sind Startfehler des Verteilers, keine stille
Auslassung, ebenso ein Bundle, das die Client-Profildatei absolut oder mit `~/` nennt: der Client
löst die Datei auf seinem eigenen Rechner auf und fände unter diesem Pfad nicht das gelieferte
Bundle, sondern nichts oder ein fremdes. Mitgelieferte Bundles nennt sie deshalb mit `./` oder
`../` relativ zu sich. `connect` prüft nach dem Entpacken den `stand` jedes Bundles im Archiv.

Das Archiv enthält genau die Profildatei und die Dateien dieser Bundles, relativ zu ihrem
gemeinsamen Ordner, als deterministisches `tar.gz` (Paket `tar`, reines JavaScript, ohne
Zeitstempel); der Stand ist sein SHA-256 und wird je Start neu bestimmt. Ein Web ist nicht darin:
das Web des Hosts ist für jedes Profil dasselbe und liegt in jeder Host-Installation, die
Web-Hälften kommen zur Laufzeit aus den Bundles. Werte von `env(...)`, Daten unter `DATA_DIR`
und `node_modules` sind nie im Archiv.

Die Methode `ragents.profile.describe` (Recht `profile.fetch`) nennt Profilname, Stand, die
Nummer der Host-API (`hostApi`, aus `host-api.json` des laufenden Hosts, gegen die die Bundles im
Archiv gebaut sind), den Commit des laufenden Hosts (aus `.git` oder aus `ragents.hostVersion`
des Pakets, ersatzweise der Schlüssel `HOST_VERSION` für Container ohne beides), die
Paketfassung, die dieser Server selbst trägt (`packageVersion`, aus seiner eigenen
`package.json`: im Paket dessen `version`, im Checkout die der Wurzel), den Pfad der
Profildatei im Archiv, die Größe, den Archivpfad und die Plugins mit Herkunft `host` oder
`archive`. Verbindlich für den Client ist nur `hostApi`; Commit und Paketfassung nennen den Weg
zu einem passenden Host, wenn sie abweicht. Die Route `GET /profile/<stand>.tar.gz` (gleiches
Recht) liefert das Archiv; ein anderer Stand ist 404. Die Gegenseite ist `ragents connect`
([profiles.md](profiles.md), servergelieferte Profile).

## Offene Grenzen

- Plugins werden nicht installiert. Der Server lädt zur Laufzeit nur die Bundles, die das Profil
  nennt: eingebaute unter `bundles/` oder Bundle-Ordner an einer festen Stelle auf der Platte.
  Ein Plugin zur Laufzeit aus einer fremden Quelle nachzuladen ist NICHT vorgesehen - keine
  Registry, keine Signaturprüfung. Heruntergeladen werden Bundles nur vor dem Start, als Teil
  eines Client-Profils, das `connect` von einem RAgents-Server holt (Abschnitt Profilverteilung).
- Ob ein Bundle von außerhalb des Hosts zu seinen Quellen passt, prüft der Host nicht, weil das
  Bundle seinen Quellordner nicht nennt; ein externes Repo baut vor Start und Tests selbst. Der
  offene Rückfall des Auflösungshakens gilt weiter für Code außerhalb von Bundles.
- Eine neue Plugin-Oberfläche greift erst nach Neuladen der Seite; HMR gibt es für Web-Bundles
  nicht, für Klassen im Host-Code nur mit Neuladen, weil das Stylesheet vom Server kommt.
  Bibliotheken, die mehrere Plugins bündeln, liegen mehrfach im Browser. Baut jemand ein Bundle neu,
  während ein Server daraus läuft, liefert dieser die neue Web-Hälfte und neue Assets zu seinem
  alten Server-Code, bis er neu startet; einen Stand je laufendem Server hält der Host nicht fest.
- Reine Typimporte sieht das Bauwerkzeug nicht, weil sie im Bundle verschwinden: ein fremdes
  Plugin kann Typen aus einem Modul außerhalb der Host-API nennen, etwa aus der Agentenlaufzeit,
  und baut trotzdem. Für die eingebauten Plugins prüft `apps/server/tests/host-api.test.ts` auch
  Typimporte. Ändert sich ein solcher Typ, bricht beim fremden Autor nur die Typprüfung.
- `requiresWorkspace` ist eine Erklärung des Beitrags, keine Prüfung: ein Metadaten-Beitrag, der den
  Executor fragt, ohne das zu erklären, erreicht auch fremde `ownerOnly`-Arbeitsbereiche. Bis die
  Run-Liste einen Run gemeldet hat, zeigen Web und VS Code seine Arbeitsbereichs-Reiter; der Server
  lehnt deren Zugriffe dann mit `run-workspace-owner-only` ab.
- Die Fläche ordnet nur an, was ihr Baum nennt. Neue Teilnehmer erscheinen nicht von
  selbst, sondern bleiben in der Kopfzeile, bis ein Programm oder der Benutzer sie andockt. Ein
  Programmzustand mit den Altschlüsseln `nodes`, `shapes`, `lines` oder `mode` wird nicht
  umgerechnet: der Run meldet ihn und braucht einen Aufruf von `canvas_layout_replace` mit
  `root`.
- Das Run-Panel kennt genau einen Flächenbeitrag mit `RunPanel`; sein Zustand liegt je
  Browser-Speicher, in VS Code also je Fenster. In der Ansicht "Nur Chat" wird die Mini-App
  abgebaut; ihr flüchtiger Zustand überlebt den Wechsel nicht. Der Tab-Bereich liegt immer unter
  Chat und Bühne über die volle Breite; einen Bereich neben dem Chat oder zwei offene Reiter gibt
  es nicht. Run-Panel und Web merken sich ihre Reiter getrennt: derselbe Run kann im Web
  aufgeklappt und im Run-Panel geschlossen sein.
  Das Run-Panel in einem eigenen Bundle ohne iframe (Stufe 2 des Entwurfs) ist nicht gebaut und
  seit der Zwischenablage-Brücke auch nicht mehr nötig.
  Ein lokales Profil der Erweiterung nennt seine Vorlagen erst, wenn sein Host läuft; vor dem
  Start kennt niemand die Vorlagen, weil sie erst mit den registrierten Plugins entstehen.
  Geholte Host-Fassungen räumt die Erweiterung nicht auf: jede bleibt unter
  `<globalStorage>/hosts/<fassung>/` liegen, rund 250 MB je Fassung, bis jemand den Ordner
  löscht.
  Ob nach einem Run-Panel ohne Run noch ein `newRun` kommt, sagt der Vertrag nicht; das Panel
  wartet deshalb fünf Sekunden. Baut die Erweiterung das iframe während eines Starts neu (etwa
  beim Wechsel von Theme oder Zugangstoken), geht die Startanforderung verloren: das Panel zeigt
  "Kein Run gewählt", ein schon angelegter Run steht dann nur auf der Start-Seite. Die Run-Ansicht
  lädt unabhängig vom Chat; bis sie da ist, kann ein Run, dessen einziger Inhalt eine Mini-App
  ist, nach dem Verbinden kurz einen leeren Chat zeigen. Einen Ladezustand im Run zeigt nur ein
  Flächenbeitrag mit `RunPanel`; ohne ihn steht der leere Chat.
- Die Nachrichtenschicht kennt keine Batch-Anfragen und keinen WebSocket; über HTTP ist jede
  JSON-RPC-Antwort ein HTTP 200 mit `result` oder `error`, nur Transportfehler (kein JSON, zu
  groß, fremde Verbindung) tragen einen anderen Status. Stdio hat keine Anmeldung: wer den
  Prozess startet, hat alle Rechte.
- Die Evidenz der Browserprüfung ist der Stand des letzten Aufrufs: was die Seite zwischen zwei
  Aufrufen tut, etwa eine späte Konsolenmeldung oder eine Navigation von selbst, sieht der Server
  erst mit dem nächsten. Ein Bildschirmfoto reist als Base64 in der Antwort des Executors; bei
  einem Arbeitsplatz begrenzt die Nachrichtengröße von 32 MiB, wie lang eine ganze Seite werden
  darf.
- Zwei Runs auf demselben Ordner kollidieren; das ist die Entscheidung des Benutzers.
- Ein vorgemerkter Stopp für einen Arbeitsplatz lebt im Speicher des Servers: startet der Server
  neu, bevor sich der Arbeitsplatz wieder anmeldet, bleibt auf dem Arbeitsplatz liegen, was der Run
  dort gestartet hat, bis er erneut gestoppt wird oder der Arbeitsplatz sich abmeldet. Beim Abmelden
  endet der Executor, losgelöste Hintergrundprozesse eines Runs aber nicht; sie beendet erst ein
  Stopp dieses Runs.
- Den neuen Ordner eines gelöschten Runs räumt der Server auf dem Arbeitsplatz nur weg, wenn der
  dabei erreichbar ist; sonst bleibt er unter dem Ordner für Runs des Arbeitsplatzes liegen, ein
  späteres Aufräumen gibt es nicht. Schritte eines Beitrags sind Operationen, die jeder Executor
  kennt; eigenen Code bringt ein Beitrag nicht auf den Arbeitsplatz.
- Auf einem Mac erkennt die Prozesstabelle den Run-Marker von Programmen aus dem Systemvolume
  nicht: `ps -E` zeigt ihre Umgebung nicht (SIP), gemessen für `/bin/sleep`, `/bin/bash`, `/bin/sh`,
  `/bin/zsh`, `/usr/bin/perl`, `/usr/bin/ruby` und `/usr/bin/tail`; Node, Homebrew-Programme und das
  Python von Xcode zeigen sie. Ein solcher Prozess, der sich von der Prozessgruppe seines
  Werkzeugaufrufs gelöst hat (etwa ein mit `detached` gestartetes Shell-Skript), erscheint weder in
  der Prozessleiste, noch räumt der Stopp ihn ab. Eine zweite Erkennung ohne Umgebung gibt es nicht:
  beim Lösen wechseln Prozessgruppe und Sitzung, und Elternprozess wird launchd. Was in der
  Prozessgruppe eines Bash-Aufrufs bleibt, beendet der Aufruf selbst mit ihr.
- Die Provisionierung kennt kein Deinstallieren und keine zweite Fassung nebeneinander: ein
  Werkzeugordner trägt genau die gepinnte Fassung, und ein Fassungswechsel ersetzt sie. Zwei
  Profile auf einem Rechner haben zwei Werkzeugordner und laden dieselben Dateien zweimal.
- Das Relay prüft die Antwort des Anbieters nicht auf weitere Spuren: `id` und
  `system_fingerprint` gehen unverändert mit, weil sie weder Modell noch Anbieter nennen und der
  Client die Kennung zum Zuordnen braucht; ihr Muster lässt dennoch Rückschlüsse zu. Auch der
  Fehlertext eines Anbieters wird durchgereicht, samt allem, was er nennt. Wer den Token hat,
  hat Modellzugang in Höhe dessen, was das Relay erlaubt; Kontingente und Abrechnung gibt es
  nicht. Zwei Entwickler auf einem Rechner sind zwei Datenordner und zwei Token; ein gemeinsamer
  lokaler Server für mehrere Benutzer ist nicht vorgesehen. Ein Verbindungsverlust mitten in
  einer Bash auf dem Arbeitsplatz liefert Teilresultate: der Aufruf scheitert mit einer Ursache,
  die den Arbeitsplatz nennt, und der Arbeitsplatz bricht den Befehl ab, sobald er den Verlust
  bemerkt; bis dahin kann er weitergelaufen sein.
- Die Prozess-Sandbox des Servers (Abschnitt Prozess-Sandbox des Servers) hat Lücken, die ihre
  Werkzeuge vorgeben: der Browser der Browserprüfung läuft ohne sie; der NuGet-Cache ist allen Runs
  gemeinsam und beschreibbar; unter macOS erreicht ein Run Unix-Sockets unter `/tmp` und damit auch
  Build-Server anderer Prozesse desselben Kontos (ein laufendes `VBCSCompiler` oder
  MSBuild-Knoten einer IDE), und `trustd` holt Sperrlisten außerhalb der Sandbox, was ein
  Seitenkanal ins Netz ist; unter Linux sind alle Unix-Sockets erreichbar, die im Dateisystem der
  Sandbox sichtbar sind. Werkzeuge, die bis zur Wurzel nach einer Datei suchen und `EPERM` nicht
  wie ein Fehlen behandeln, scheitern unter macOS an einem gesperrten Vorfahren des Arbeitsbereichs,
  etwa corepack ohne `packageManager` in der `package.json`. Node 22 meldet bei jedem Start
  `EnvHttpProxyAgent is experimental` auf stderr. Die Bibliothek ist eine Forschungsvorschau
  (Fassung 0.0.x). Unter Linux in einem Container braucht bubblewrap Benutzer-Namensräume, also
  gelockerte Container-Profile (`docs/operations.md`).
- Unter Windows brauchen `scripts/start.sh` und die übrigen Shellskripte des Repositorys Git
  Bash. Geprüft ist die Plattform nur in Unit-Tests, die sie simulieren (Shell-Auflösung,
  Datenordner, Umgebung, Promptbeitrag, Ablehnung der Prozesstabelle); der echte Durchlauf steht in
  `TODO.md`.
