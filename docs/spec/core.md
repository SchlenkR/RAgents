# Kern: Runs, Actors, Inputs, Turns und Events

Der Kern ist das Paket `@ragents/engine`: produktneutral, kennt keine Fachdomäne. `domain/` und `runtime/` sind das Journal-Modell, `agents/` führt Agenten aus und plant
ihre Turns, `drivers/` bindet die Agentenlaufzeit an, `script/` die TypeScript-Actors,
`typescript/` ist Compiler und Laufzeitkontext der Plattform, `rpc/` die Nachrichtenschicht und
`http/` deren Laufzeitverträge und -methoden. `plugin-host.ts` und `plugin-types.ts` definieren
Registrierung und Beitragsarten der Plugins; wogegen ein Plugin gebaut werden darf, legt die
Host-API-Liste `apps/server/src/host-api.json` fest (`plugins.md`).

<!-- guide:runtime -->
## Runs and participants

A run is a piece of work with its own participants, working files, and journal. An actor is a
participant in that run: the human owner, an LLM agent, or a TypeScript actor. LLM agents
process tasks with a model; TypeScript actors execute their programmed input handler. The actor
selected as primary is the user's direct chat partner. This choice does not depend on who
created the other actors.

An ActorInput is a task for exactly one executable actor. A turn processes exactly that input.
An event records something that happened, such as a model response or a function call. These
terms separate the task, its execution, and its recorded result.

Native background tasks can use `presentation: "background"`. They are queued normally,
delivered to the actor in full, and retained in the journal. The main chat and actor
conversation hide the internal task while keeping the response visible. The same applies when
the history is restored. Without this marker, presentation remains unchanged. For users
without inspection permission, the run view contains none of the task text.
<!-- /guide:runtime -->

## Laufzeitgrenze

```text
Commands -> Orchestration -> Journal v4 -> Projection -> LiveBus
                |                 |
                |                 +-> JSON-RPC (HTTP oder stdio) und Web-Projektion
                |
                +-> TurnScheduler -> AgentDriver -> AgentRuntimeManager -> AgentSession
                                  \-> ScriptDriver -> TypeScript-Plattform -> Node-Prozess
```

`Orchestration` ist deterministischer Anwendungscode und kein Modell. Jeder akzeptierte Command
erzeugt eine zusammenhängende Gruppe von Events. Das Journal persistiert sie, aktualisiert die
Projektion und veröffentlicht erst danach Live-Hinweise. Kein Driver, Plugin oder
Protokolladapter schreibt am Journal vorbei.

<!-- guide:runtime -->
## Scheduler and turns

The scheduler processes at most one turn per actor:

1. It claims exactly one waiting ActorInput.
2. It assembles the toolset, working directory, and system prompt.
3. The driver processes this input; an agent's driver also takes steering (see below).
4. Model output, reasoning, runtime output, and tool calls are automatically recorded as
   events in the journal.
5. The turn ends as `completed`, `failed`, or `interrupted`.

Inputs that arrive while an agent's turn runs join that turn as steering. Before each model
request, the turn takes all waiting inputs of its actor in journal order and hands them to the
model after the results of the tool calls that were running; a running tool call is neither
aborted nor cut short. If the model has just given its final answer, a joined input starts
another model request in the same turn. The journal records each joined input with
`turn.input-steered`, and the chat marks the message as fed into the running turn. An input that
arrives after the last model request of the turn, or after the turn was interrupted, starts the
actor's next turn instead. TypeScript actors have no model and take no steering; their inputs
always wait for the next turn. An input longer than 30,000 characters does not join; it and every
later input wait for the next turn, so the order stays intact.

A hidden note about the running turn, such as a status note or a progress reminder, does not
belong in an input: an input appears in the chat and starts a new turn once the current one has
ended. Such a note comes from an agent hook: the `beforeModelCall` hook of an `agentRuntime`
contribution adds it before each model request without ending the turn. This is how
actor-program project diagnostics work for actors equipped with actor-program tools, and how a
product plugin can provide progress reminders.

A failed turn, or one interrupted by a server restart, is not queued or executed again
automatically. ActorInputs that were already queued but not yet claimed remain waiting. After
startup they can be processed if their actor is still executable. Anything a function call has
recorded in the journal remains valid; a later failure in the same turn does not invalidate it.
A service waiting for a submitted result therefore does not tie that result's validity to the
turn outcome.

For an LLM, one turn can include several model requests and TypeScript snippets. `return` ends
the current snippet and gives its findings to the model. The model can then decide what to do
and execute another snippet within the same turn. A snippet does not wait for later agent
responses or events: a subscription creates a new ActorInput, which reaches the model at the
earliest after the snippet, as steering or in a later turn. The programming language needs no
additional decision point for this.
<!-- /guide:runtime -->

### Leere Antworten, Werkzeugaufrufe und Toolset

Eine Modellantwort ohne Text und ohne Werkzeugaufruf (nur Reasoning, Stopgrund `stop`) beendet
den Turn nicht: die Agentenschleife stößt genau einmal mit der Nutzer-Nachricht "Deine Antwort
enthielt weder Text noch Werkzeugaufruf. Antworte jetzt mit dem nächsten Werkzeugaufruf oder
Deiner Antwort." nach. Bleibt auch die folgende Antwort leer, endet der Turn als `failed` mit
der Ursache "Modell lieferte zweimal eine leere Antwort." als Runtime-Ausgabe und Grund in
`turn.finished`, nicht als `completed`. Eine Antwort mit Text oder Werkzeugaufruf setzt die
Zählung zurück; Zeitgrenzen sind davon unberührt.

Die Run-Ansicht projiziert Werkzeugaufrufe je Turn als kompakte `toolCalls`: Kennung, Name,
Status und Start-/Endzeit. Die bestehenden Start-, Ergebnis- und Fehlerereignisse aktualisieren
sie. Endet ein Turn mit noch offenen Aufrufen, beendet sein Ende sie als `interrupted`, gleich ob
`turn.interrupted` (Stopp, Abbruch, Neustart) oder ein gescheitertes `turn.finished`; ein eigenes
Fehlerereignis schreibt dafür niemand, und ein erfolgreiches `turn.finished` mit offenen Aufrufen
ist ungültig. Den Grund trägt das Turn-Ende. Diese Projektion ist die einzige Quelle für den
Zustand eines Aufrufs: Scheduler, Journalprüfung, Chat und Actor-Verlauf lesen sie. Call-IDs gehören
immer zu ihrem Turn und dürfen in einem späteren Turn erneut vorkommen. Eingaben, Ergebnisse
und Fehlertexte werden dabei nicht zusätzlich kopiert. Journal-Replay baut dieselbe Projektion
für alle Actors wieder auf, unabhängig vom primären Chat.

Zwischen Aufrufstart und Abschluss kann `tool.call.source` den tatsächlich gelesenen
TypeScript-Quelltext samt optionalem ursprünglichem Dateipfad festhalten. Die Zuordnung folgt
Turn und Aufrufkennung. Das Quellevent löst weder eine erneute Ausführung noch einen neuen
Turn aus; es ergänzt den historischen Nachweis. Auch wenn die folgende Typprüfung scheitert,
bleiben Start, Quelle und Fehler im Journal zusammen lesbar. Die kompakte `toolCalls`-Projektion
kopiert den Quelltext nicht zusätzlich; Detailansichten lesen das gespeicherte Ereignis.

Der `TurnToolset` bindet Aufrufe an genau einen Turn. Nach dessen Ende ist die Bindung ungültig.
Vor Aufrufen löst er den aktuellen Werkzeugbestand erneut über die Registry auf. Die
AgentSession erneuert zwischen Modellanfragen native Schemata und die erzeugte Systemübersicht aus demselben Bestand, ohne den laufenden Turn zu beenden.
Hooks leben dagegen mit der AgentSession und dürfen keinen alten Turnzustand capturen.

## Actor-Zustand und Funktionen

Jeder ausführbare Actor besitzt intrinsischen Zustand. TypeScript-Funktionen, Input-Verarbeitung
und zugehörige Views verwenden dieselben journalisierten Daten. Der Zustand gehört zum Actor,
nicht zu einem zweiten App- oder Werkzeug-Namensraum. Der Backend-Kontext liest einen Snapshot
und merkt Änderungen ausdrücklich über `context.state.replace` vor. Erst der erfolgreiche
Abschluss übernimmt sie; Fehler und Abbruch verwerfen die vorgemerkten Zustandsänderungen.

Ein Funktionsresultat ist kein Zustand. Ein direkter View- oder Werkzeugaufruf einer Funktion
benötigt keinen Modell-Turn. ActorInputs bleiben dagegen in der normalen Actor-Warteschlange:
Ein LLM-Actor verarbeitet sie mit seinem Modell, ein TypeScript-Actor mit dem Input-Handler
seines Programms. Beide können dieselben Arten von Funktionen und React-Views besitzen.
Der Paket- und Aktivierungslebenszyklus gehört zum Plugin `ragents.actor-programs` und ist in
`actor-programs.md` beschrieben.

<!-- guide:runtime -->
## Model context across turns

Each LLM actor has its own conversation context, which persists across turns. A new input adds
to that conversation. In server operation, the context is stored separately and reloaded after
a restart. A new actor starts with its own context or, when spawned with `forkOf`, with a copy
of another LLM actor's context from the same run. Updating the system prompt does not replace
the existing conversation history.

Programmed actor state stores explicitly assigned data for functions and mini-apps. Before a
replacement state is diffed and journaled, it is converted to JSON form: keys whose value is
`undefined` are treated as absent both in memory and on disk, while a `set` state change without
a value remains invalid. The journal records the run's shared events and derives the chat view
from them. These three forms of state serve different purposes: the visible chat is not a full
copy of the current model context, and a new turn does not mean the model starts without its
conversation memory.
<!-- /guide:runtime -->

## Agent-Session und Agentenlaufzeit

Der LLM-Actor besitzt genau eine `AgentSessionRuntime`, die beim ersten Turn geöffnet wird.
`AgentRuntimeManager` verwaltet diese Laufzeiten nach `runId + agentId`.

Vor jedem Prompt bindet ein stabiler Dispatcher den aktuellen Turn mit Toolset, Turn-ID,
Callbacks und `AbortSignal`. Danach wird diese Bindung gelöst. Damit hält eine langlebige Session
keine Closure auf einen alten Turn.

Ein ActorInput beginnt höchstens einen Turn. Weitere Inputs an einen Agenten mit laufendem Turn
kommen als Steering in diesen Turn: Die Agentenschleife fragt vor der ersten Modellanfrage und
nach jeder Antwort samt ihren Werkzeugergebnissen ihre Steering-Quelle ab
(`Agent.steeringSource`), die Laufzeit reicht das an `TurnRequest.claimSteering` weiter. Der
Scheduler nimmt dann die ältesten wartenden Inputs des Actors in Journal-Reihenfolge, bis vor den
ersten mit mehr als 30000 Zeichen Inhalt (`STEERING_MAX_CHARS`), und schreibt für jeden ein
`turn.input-steered` mit Turn und Input, alle in einem Command. Erst danach gehen die Texte als
Nutzer-Nachrichten in den Modellkontext, aufbereitet wie beim Turn-Start: dieselbe Kopfzeile für
zugestellte Events, Anhänge als Medien, Text oder abgelegte Datei. Die Entscheidung prüft, dass
der Turn läuft, sein Actor den Agententreiber hat und kein älterer wartender Input übersprungen
wird; die Journalprüfung verlangt beim Laden dasselbe außer dem Treiber. Ein so übernommener
Input ist von diesem Turn beansprucht (`lifecycle` `claimed` mit `steered: true`) und beginnt
keinen eigenen; wer Inputs ihrem Turn zuordnet, liest deshalb `turn.started` und
`turn.input-steered`. Nach dem Abbruchsignal, außerhalb des laufenden Turns und während eines
Run-Stopps übernimmt `claimSteering` nichts. Scheitert die Aufbereitung, etwa weil das Modell ein
angehängtes Bild nicht annimmt, endet die Schleife mit diesem Fehler, der Turn scheitert daran, und
der Input bleibt ihm zugeordnet. Ein Input, der nach der letzten Abfrage eintrifft, bleibt wartend
und beginnt nach dem Turn-Ende einen neuen. Es gibt keine Follow-up-Warteschlange, keine
Hintergrundzustellung in laufende Werkzeuge und kein Wake-State-Modell: ein Werkzeugaufruf läuft
bis zu seinem Ergebnis oder Abbruch, und Steering wartet darauf.

Die Zuordnung zur JSONL ist ausdrücklich in `active-session.json` mit Agenten-, Run- und
Agent-Session-ID gespeichert. Die frühere Auswahl nach der neuesten Dateizeit gibt es nicht mehr:
fehlt der Marker, entsteht eine neue Agent-Session.

Beiträge an die Agentenlaufzeit werden aus dem aktiven Profil geladen und über die offizielle API der Agentenlaufzeit gebunden. Beliebiger
TypeScript-Code aus `.agent/extensions` im Arbeitsrepository wird nicht automatisch ausgeführt.
Compaction und Retries der Agentenlaufzeit bleiben aktiv. Ob ein Turn am Modell scheitert,
entscheidet dessen letzte Antwort: einen Anbieterfehler, den die Session danach erfolgreich
wiederholt oder nach einer Kompaktierung fortsetzt, übersteht der Turn; nur wenn die letzte
Antwort ein Fehler ist, endet er als `failed` mit dessen Meldung. Abbruch und Fehler eines
Hooks bleiben, einmal eingetreten, das Ergebnis des Turns.

Die Agentenlaufzeit liegt in zwei eigenen Paketen unter `packages/`:
`@ragents/ai` bindet OpenRouter über Vercel AI SDK Core (`ai`) und
`@openrouter/ai-sdk-provider` an. Ein Adapter übersetzt Nachrichten, Reasoning-Metadaten und
SDK-Streams in den bestehenden Laufzeitvertrag. Das SDK übernimmt HTTP, Providerformat und
SSE-Verarbeitung; pro Anfrage erfolgt genau ein Modellschritt ohne
Werkzeugausführung durch das SDK. Werkzeugvalidierung, Werkzeugausführung und weitere
Modellschritte gehören der Agentenlaufzeit. Anfrage- und Antwort-Hooks arbeiten am tatsächlichen
HTTP-Vertrag, Abbruch und Zeitlimit gelten für den SDK-Aufruf; Transportwiederholungen sind
standardmäßig deaktiviert. Modellkatalog, Kontextbegrenzung, Cachemarkierungen und lokale
Kostenberechnung bleiben erhalten. Die Protokollkennung `openai-completions` gilt weiterhin
für Modellbeschreibungen und gespeicherte Sitzungen.
`@ragents/agent` enthält Agentenschleife, Session und Werkzeuge. Beide Pakete bleiben
gegabelter Fremdcode; ein Rebase auf das Upstream-Projekt ist aufgegeben. Sessions, Compaction,
Retries, Steering und innere Agentenschleife bleiben bestehen; Erweiterungen sind nur die Hooks,
die die Engine selbst anlegt, Skills liest allein der Host, und die Laufzeit liest weder
Einstellungs- noch Zugangsdateien noch sucht oder installiert sie Pakete.
Das eigene Verhalten ist Teil dieses Kapitels:
`AgentSession.setSystemPrompt` setzt den Systemprompt einer langlebigen Session neu und erhält das
Gespräch. Aktualisierte Rollenregeln und kurze Initialhinweise werden so pro Turn wirksam;
ausdrücklich abgerufene Detailkapitel bleiben Gesprächsinhalte und werden nicht zusätzlich in
den Systemprompt übernommen. Denktiefe `off` sendet an OpenRouter die explizite Abschaltung
aus dem Modellkatalog, etwa `reasoning: { effort: "none" }`, oder ohne solches Mapping
`reasoning: { enabled: false }`. Vor jedem Turn prüft RAgents die gewählte Denktiefe gegen das
tatsächliche Modell der Agentensession. Eine nicht verfügbare Auswahl beendet den Turn mit
einer Fehlermeldung samt gültigen Stufen, bevor eine Modellanfrage gesendet wird; sie wird
nicht durch eine andere Denktiefe ersetzt. Modellkatalog und Werkzeugverträge erhalten auch die
erweiterten Stufen der Modelllaufzeit. Beim Erzeugen eines Agenten wird die endgültige Auswahl
gegen den Modellkatalog geprüft, einschließlich einer aus der Rolle geerbten Denktiefe nach
einem Modellwechsel. Ohne ausdrückliche Denktiefe oder Rollenvorgabe verwendet die Session ihre
modellgültige Vorgabe; der Host setzt darüber keine globale Agenten-Denktiefe.
Die Werkzeug-Validierungsmeldung wiederholt die empfangenen
Argumente nicht, nennt nur die Feldfehler (bei Enum-Fehlern samt empfangenem Wert und erlaubten
Werten, ein Pfad nur einmal) und fordert zur Korrektur auf. Bereits gültige Werkzeugargumente
bleiben unverändert. Auch die zusätzliche JSON-Schema-Konvertierung prüft jeden Teilwert vor
einer Umwandlung: bereits zum jeweiligen Teilschema passende Unionwerte wie `null`, Zahlen
und Wahrheitswerte behalten ihren Typ,
während ungültige Nachbarfelder weiterhin konvertiert werden können. Die Prüfung arbeitet auf
einer Kopie der Argumente und verändert den ursprünglichen Werkzeugaufruf nicht.
Unbekannte Felder auf der obersten Ebene eines geschlossenen Eingabeobjekts sind seit dem
18.09.2026 kein Ablehnungsgrund: die Agentenschleife lässt sie durch, die Engine entfernt sie vor
der Ausführung (`TurnToolset.invoke` in `packages/ragents/src/agents/toolset.ts`), schreibt die
bereinigte Eingabe mit `ignoredFields` in `tool.call.started` und stellt dem Werkzeugergebnis für
das Modell eine Hinweiszeile voran, etwa "Hinweis: implementation_review_context nimmt keine
Eingabe; die Felder previous, __unused sind unbekannt und wurden ignoriert." Verschachtelte
Objekte bleiben streng; fehlende Pflichtfelder, falsche Typen und unbekannte Felder in
verschachtelten Objekten sind weiterhin harte Fehler, deren Meldung die unbekannten Feldnamen
nennt. Der Snippet-Weg über `context.functions` bleibt unverändert: dort prüft der
TypeScript-Compiler, ein überzähliges Feld ist eine Diagnose, und `invokeFunction` entfernt nichts.
Die drei `package.json` laden zur
Laufzeit die TS-Quellen, der Typecheck sieht die generierten `dist/*.d.ts`, die `pnpm build:agent`
erzeugt.

Die Dateibearbeitung nennt bei mehrdeutigen Treffern deren Zeilennummern und unterstützt
gezielte Vorkommen, eine nahe Zeile oder alle Vorkommen. Widersprüchliche Anker und gleich
nahe Treffer werden abgelehnt. Die Prüfung des zuletzt gelesenen Dateistands erfolgt innerhalb
derselben Mutationssperre wie das Schreiben, auch bei symbolischen Dateialiasen. Ein Abbruch
gibt diese Sperre erst frei, wenn eine bereits laufende Dateioperation beendet ist.

In jeder Laufzeit sind zwei interne Hooks aktiv:

- `ragents-turn-dispatcher` bindet den aktuellen RAgents-Turn und dessen Toolset an die langlebige
  AgentSession.
- `ragents-skill-preload` hängt ausgewählte Skill-Bodies über `before_agent_start` der Agentenlaufzeit nur an den
  Systemprompt des aktuellen Turns. Explizite Skillnamen werden deterministisch aufgelöst. Sonst
  klassifiziert ein kurzer Aufruf desselben ausgewählten Agent-Modells nur Aufgabe, Zielgruppe,
  Skillnamen und Beschreibungen. Er sieht keine Skill-Bodies und darf `ABSTAIN` liefern. Fehler
  blockieren den Hauptturn nicht, sondern lassen den normalen Skill-Katalog der Agentenlaufzeit unverändert.

Ein Skillname gilt im ganzen Profil genau einmal, auch über Zielgruppen hinweg, weil er den Ordner
bestimmt, unter dem das Modell den Skill erreicht. Liefern zwei Plugins einen Skill gleichen
Namens, bricht der Start mit beiden Ordnern ab (`SkillContributionRegistry.assertUniqueNames`);
bekommt eine Laufzeit trotzdem zwei, scheitert ihr Öffnen und damit der Turn mit beiden
SKILL.md-Pfaden, statt dass Katalog und Vorladen still den ersten nehmen. Katalog und Vorladen
nennen einen Skill unter `Skill.location`, `@skills/<name>/SKILL.md`: dem Ort, an dem die
Werkzeuge des Modells ihn in jeder Bindung nur lesend erreichen (`plugins.md`, Abschnitt
Arbeitsbereich, Sandbox-Werkzeuge und Prozesse), nie unter dem Pfad auf dem Server, aus dem der Host
den Body liest (`Skill.filePath`). Relative Pfade in einem Skill gelten in seinem Ordner.

Die Produktrolle stammt aus genau einer Policy des aktiven `ProductRuntime`: Der in
`primaryActorId` gewählte Actor ist `primary`, alle anderen ausführbaren Actors sind `worker`.
Dieselbe Entscheidung steuert Rollenvertrag und Skill-Auswahl. Das Vorladen erzeugt weder eine
zweite Agent-Session noch einen eigenen Agentenloop. Für `tools: []` lädt die Agentenlaufzeit weder Host-Werkzeuge noch
Skills oder Preloads.

### Sicherheits-Lockdown der Agentenlaufzeit

Alle Einschränkungen stecken in der Engine-Konfiguration beim Serverstart (weder Modell noch
Client können sie ändern): Der Systemprompt wird geordnet aus den Beiträgen der aktiven Plugins
zusammengesetzt. Skills kommen ausschließlich aus deren registrierten Pfaden. Die Werkzeuge stammen
aus dem RAgents-Core und der Plugin-Registry statt aus einer frei wählbaren Liste. Die
Agentenlaufzeit liest weder Einstellungs- noch Zugangsdateien; feste Rollen binden die Modelle.
Capabilities begrenzen die Orchestrierung und ihre Delegation.
Workspace-Werkzeuge bleiben sichtbar; Rollen werden im Prompt beschrieben und die technische
Grenze ist die Sandbox je Run. Bash ist darin erlaubt.

<!-- guide:runtime -->
## Interrupting a turn, stopping an actor, stopping a run, and shutting down the server

All stop paths follow the same principle: block new work first, then cancel, wait for running
work, and only then release resources. The exact boundary differs:

Interrupting a turn is not a stop. The stop button in a chat input ("Arbeit stoppen") ends only the
running turn of that chat's actor as `interrupted`: its running function calls are aborted, the
visible text of its unfinished answer stays, and the actor remains active and takes the next
message as a new turn. Its children and all other actors keep working, and without a running
turn of this actor the input offers no stop. Stopping an actor for good and stopping the whole
run are separate, explicitly labeled actions.

In the run title bar, a user with write permission can request a complete stop through "Run
stoppen" (stop run) and a confirmation. The primary actor can also trigger it with `run_stop`. Both use the
same host stop boundary; the chat and files remain intact. The function call initiates
the stop but does not wait for cleanup of its own turn. Acceptance is not proof of completion.
Cleanup errors are reported in the server log while the stop path's normal quarantine remains
in effect.

- Turn interruption (`ragents.runs.interruptTurn`): Ends the running turn of one actor and
  nothing else; the actor, its model runtime, its children, and the run stay as they are.
- `actor_stop`: Stops the actor, interrupts its running turn, and disposes its model runtime
  after the turn. Its active descendants are stopped in the same journal command, so a branch is
  never stopped halfway. The journal names the actor that called `actor_stop` as the one who
  stopped them. Run data and the run's plugin data remain.
- Run stop: The scheduler temporarily accepts no new work for this run; concurrent stop calls
  are handled together. The primary actor remains, but its running work is interrupted. All
  other agents and TypeScript actors in the user's ownership tree are stopped. Agent runtimes
  and plugins receive their abort signals in parallel. The actor-program plugin also cancels
  pending app actions. An open confirmation question is discarded through `ragents.ask` in the
  journal and the domain operation is no longer invoked. The run can be reused afterward.
- Run deletion: The scheduler stops the run. Its agent runtimes are then disposed and plugin
  deletion hooks run. The chat, recovery data, and journal are archived; run-bound plugin
  data, including its logs, is removed afterward.
- Server shutdown: The scheduler interrupts running work and waits for it to finish. It then
  shuts down all agent runtimes and plugin services. Persisted run data remains intact.

After active actor work ends and the first plugin cleanup completes, the host releases remaining
resources. The run stays locked until this cleanup finishes, even if the stop request has already
returned. If cleanup fails, the stop reports the error and the server log records it. The run
then accepts work again instead of remaining permanently stuck, and another stop retries cleanup.

Inputs accepted for the still-active primary actor during this lock are processed automatically
after a successful release. The scheduler checks the remaining open inputs again; inputs that
were already claimed or discarded are not repeated.
<!-- /guide:runtime -->

### Unterbrechen eines Turns

`ragents.runs.interruptTurn` (`runId`, `actorId`, optional `reason`) beendet nur den laufenden
Turn dieses Actors. Die Nachrichtenschicht prüft die Rechte wie beim Stoppen (Art `stop`, also
auch bei einem Run erlaubt, den nur sein Eigentümer bedient) und reicht die Unterbrechung an den
`TurnScheduler` weiter (`interruptTurn`). Der bricht das Abbruchsignal des Turns ab, das auch
laufende Funktionsaufrufe erhalten, und wartet begrenzt (`interruptWaitMs`, 15 Sekunden) auf den
Treiber: Die Agentenlaufzeit schreibt die sichtbare Teilantwort als `model.output.interrupted`,
dann folgt `turn.interrupted` im Namen des Owners mit dem Grund der Anfrage. Hält ein Treiber
die Frist nicht ein, endet der Turn im Journal trotzdem; die nächste Eingabe des Actors beginnt
erst, wenn der alte Treiber zurückgekehrt ist. Einen Turn, den kein Treiber dieses Schedulers
ausführt, beendet die Unterbrechung nur im Journal. Ohne laufenden Turn geschieht nichts, auch
kein Fehler. Kein `actor.stopped`, kein Eingriff in Kinder, Abonnements oder die Modell-Session:
der Actor nimmt die nächste Eingabe als neuen Turn im selben Gespräch an. Der Kern kennt dabei nur
Turn und Actor. Was der Turn bis zur Unterbrechung per Steering übernommen hat, bleibt ihm
zugeordnet und wird nicht erneut zugestellt; was danach eintrifft oder noch wartet, beginnt den
nächsten Turn.

Die Agentenschleife prüft das Abbruchsignal unmittelbar vor jeder Modellanfrage, also nach
Kontext-Hooks, Kontextumbau und Schlüsselauflösung. Ein Abbruch während eines Werkzeugaufrufs oder
während ein Hook noch läuft, erreicht das Modell deshalb nicht mehr: die Schleife endet mit einer
abgebrochenen Assistant-Nachricht ohne Inhalt und ohne Verbrauch, statt das Modell noch einmal mit
dem Werkzeugfehler anzufragen.

Wird der Primary-Actor gestoppt, verliert der Run seinen Primary-Actor (`primaryActorId` wird
`null`) und merkt sich den gestoppten als `stoppedPrimaryActorId`, bis ein Primary-Actor gewählt
wird. Startet der Owner oder ein Actor mit `run.configure` ihn neu, schreibt `restartActor` im
selben Command `actor.restarted` und `run.primary-actor-selected`; der Chat ist wieder an ihn
gebunden. Ein anderer Neustart lässt ihn einfachen Actor bleiben.

### Stoppablauf, Nachlauf und Löschung

Ein Stopp ist immer eine Entscheidung über den ganzen Zweig: `stopActor` erzeugt für den Actor und
alle seine aktiven Nachkommen `turn.interrupted` (falls ein Turn läuft), `actor.stopped` und das
Entfernen ihrer Abonnements in einem einzigen Command, im Namen dessen, der stoppt (`actor_stop`
im Turn des Aufrufers, `ragents.runs.stopActor` im Namen des Owners). Scheitert die Prüfung für
einen von ihnen, bleibt der ganze Zweig unberührt. Innerhalb der Scheduler-Sperre stoppt der
`RunStopper` alle aktiven Nachkommen des Owners außer dem Primary-Actor mit einem Command
(`stopActors`). Nach dem Abschluss des externen Scheduler-, Agent- und Plugin-Cleanups folgt ein
zweiter Command dieser Art. Er erfasst auch Kinder, die ein beim Stop bereits laufender Turn noch
spät erzeugt hat. Die Kennung eines solchen Commands setzt sich aus der Kennung des Stopps, dem
Schritt und einem Hash der gestoppten Actors zusammen: ein wiederholter Stopp mit derselben
Kennung erreicht so auch Actors, die inzwischen entstanden sind, und schreibt nichts doppelt. Chat und Fläche verwenden dieselbe Stop-Operation.

Wird ein Chat oder Run gestoppt, bleibt der bereits sichtbare Text der offenen Modellnachricht
des Primary-Actors stehen. Die Agentenlaufzeit sammelt die Live-Deltas und schreibt sie einmal als
`model.output.interrupted` vor `turn.interrupted` ins Journal, auch wenn der Abbruch kein
abschließendes `message_end` mehr liefert. Ein später eintreffender Abschluss des Anbieters
verdoppelt den Text nicht, abgeschlossene Modellnachrichten werden nicht erneut geschrieben.
Hauptchat und Actor-Verlauf zeigen den Text nach Wiedergabe und Neustart an derselben Stelle.
Diese Teilausgabe ist kein abgeschlossenes Ergebnis: Sie gehört weder zu `Turn.outputs` noch zu
den abonnierbaren Events und löst keine Zustellung aus. Ein bereits geschlossener Turn, etwa nach
`actor_stop`, nimmt keinen späteren Textnachweis mehr an.

Jeder Stoppbeitrag eines Plugins erhält ein kooperatives `AbortSignal` und standardmäßig 15
Sekunden Zeit. Nach Ablauf wird das Signal abgebrochen und der Beitrag als Fehler gesammelt; ein
Promise oder externer Prozess, der das Signal ignoriert, wird nicht zwangsweise beendet. Die
übrigen Stoppbeiträge und Aufräumzweige laufen unabhängig davon weiter. Run-Stopp,
Plugin-Nachlauf und Server-Shutdown sammeln Fehler gleich: verschachtelte AggregateErrors werden
flachgezogen, gleiche Ursachen nur einmal gemeldet. Eine einzelne Ursache wird direkt geworfen,
mehrere in einem AggregateError zusammengefasst.

Die Nachlaufbeiträge unter `afterStopSession` erhalten ein Abbruchsignal mit Zeitgrenze.
Die getrennte Nachlaufphase erlaubt beispielsweise, erst spät
erzeugte Prozesse aufzuräumen. Eine Löschung wartet auch noch ausstehende Nachlaufbeiträge ab.
Die Stop-Antwort wartet auf die abschließende Bereinigung und meldet auch deren Fehler oder
Plugin-Zeitüberschreitung. Für den gesamten Nachlauf gilt nach dem frühen Stopp eine zusätzliche
Antwortfrist von 15 Sekunden. Überschreitet etwa ein Treiber diese Frist, endet die Anfrage mit
einem Fehler; die Bereinigung und Sperre bleiben bis zum tatsächlichen Abschluss bestehen.
Ein erneuter Stopp wartet auch nach einer fehlgeschlagenen Bereinigung alle aktuellen
Treibernachläufe ab, bevor er die abschließenden Plugin-Beiträge wiederholt.

Eine Run-Löschung wird vor dem ersten irreversiblen Schritt dauerhaft markiert. Mit dieser
Markierung ist die Löschanfrage beantwortet (`ragents.runs.delete` liefert `null`) und der
Run aus der Liste verschwunden; das
Stoppen, Entfernen und Archivieren läuft als Löschjob im Hintergrund weiter, Fehler landen im
Serverlog. Scheitert er oder stürzt der Host ab, beendet der nächste Serverstart diese
Löschung, bevor der Scheduler gestartet wird. Das fertige Archiv bleibt selbst der dauerhafte
Tombstone seiner Run-ID. Eine gelöschte ID wird auch nach einem Neustart nicht erneut
angelegt und ein Archiv nie überschrieben.

Dispose-Fehler dürfen die zugehörige Ressource nicht aus der Verwaltung verlieren; der Cleanup
bleibt wiederholbar. Die Run-Löschung selbst gehört dem Produkthost, weil sie zusätzlich
Plugin-Daten, Arbeitsverzeichnis, Chat und Archiv verwaltet; der Kern stellt dafür die geordneten
Stop- und Journalgrenzen bereit.

<!-- guide:runtime -->
## Actors, inputs, events, and subscriptions

`actor_input` delivers text and optional artifacts directly to exactly one executable actor.
The driver receives the content without a routing envelope. There are no channels, message
domain, read receipts, mention syntax, or special result or delivery message. Communication is
plain text. The sender can be a human owner, another actor, or a subscription delivery. Normal
model responses need no sending function: every completed output is already a
`model.output.completed` event.

A successful `actor_input` confirms only that the input was queued. LLM actors interpret
open-ended tasks; TypeScript actors process only their programmed input protocol. The actor
list, turn context, and function description explain this distinction. A primary actor is the
default target of a run, not automatically a chat partner. Programmed inputs and subscriptions
remain available independently of the narrower chat routes.

Model text, reasoning, runtime output, function starts, function results, turn completions,
actions, artifacts, and stops are separate journal events. `event_subscribe` filters only by
structured source actor IDs, source actor kinds, event types, and optionally the subscriber
itself. Turn ends and stops belong to the actor they concern, whoever wrote them:
`turn.finished` and `turn.interrupted` count for the actor that owns the turn, `actor.stopped`
and `actor.restarted` for the actor stopped or restarted. A subscription to a worker therefore
sees its interruption and stop even when the owner or another actor stops it, and without
`includeSelf` a subscriber is not woken by the interruption of its own turn. Matching NEW
events are delivered as new inputs. The subscriber can evaluate and condense them, then use `actor_input` to pass natural text to LLM actors or suitable program
input to TypeScript actors. A mediator is therefore just a regular actor with the appropriate
functions; the mediated LLMs do not need to know the mediator or RAgents. `event_query` reads
history but does not trigger delivery.

WAKE-UP GUARANTEE: There are no waiting functions; a completed turn waits for nothing. Anyone
who prompts an actor to end its turn and wait to be woken must guarantee that wake-up. The
controlling actor must therefore be a TypeScript actor or a host service that subscribes to its
worker's turn end (`event_subscribe` for `turn.finished` and `turn.interrupted`, or host journal
observation) and decides at every end whether the worker is finished, waiting for someone else,
or needs another prompt. An LLM coordinator that "waits passively" is not a wake-up. A watcher
from `ragents.watch` (`plugins.md`) is such a host service: it wakes the controlling actor with
the reason and changes as soon as its wake condition is met. Instructions may say "end the
turn" only where such an observer exists. Synchronous functions return their result, and the
caller continues in the same turn.
<!-- /guide:runtime -->

### Automatische Meldungen und abgewiesene Aufrufe

Ohne jedes Abonnement erfährt der Ersteller eines Actors, wenn dessen Turn scheitert oder
unterbrochen wird: die Engine legt ihm eine automatische Meldung als ActorInput in die
Warteschlange ("[Automatische Meldung] Der Turn deines Actors @... ist GESCHEITERT" bzw. "wurde
unterbrochen"). Gemeint ist immer der Actor, dem der Turn gehört (`turnId` des Events), nicht der
Schreiber des Events: stoppt der Owner einen Unter-Worker, erfährt es dessen Ersteller. Keine
Meldung bekommt ein Ersteller, der die Unterbrechung selbst ausgelöst hat, ein menschlicher oder
gestoppter Ersteller und einer, dessen passendes Abonnement dasselbe Event schon zustellt.

Weist die Agentenschleife einen Werkzeugaufruf ab, bevor er läuft (Schemaverstoß, unbekannter
Name, blockiert), steht der Fehlversuch trotzdem im Journal: der Turn-Dispatcher merkt sich bei
`tool_execution_start` jeden verwalteten Aufruf mit Name und Eingabe, streicht ihn, sobald das
Werkzeug wirklich ausgeführt wird, und schreibt bei einem Fehlerabschluss ohne Ausführung das Paar
`tool.call.started` und `tool.call.failed` mit dem vollen Fehlertext. Der Vermerk gilt nur
innerhalb eines Turns; im Chat erscheint der Fehlversuch wie jeder andere gescheiterte Aufruf.
`tool.call.failed` trägt immer einen nicht leeren `error`: die Meldung des Fehlers, sonst den
Text seiner Ursache (`cause`), sonst "Fehler ohne Ursache". Ein gescheiterter Aufruf steht nie
ohne Ursache im Journal, auch wenn das Werkzeug oder das Modell keinen Text geliefert hat.

Ein Werkzeugergebnis wiederholt nie, was das Modell selbst geschrieben hat. Die eine
Redaktionsstelle ist `toolResultEventOf` in `packages/ragents/src/agents/actor-input.ts`: sie
streicht aus jeder Event-Payload auf dem Weg zum Modell rekursiv die Hash-Schlüssel und die
wörtlichen Eingabe-Echos (`prompt`, `source`, `execution`, `content`, `state`). Journal,
`event_query` und die RunView fürs Web bleiben vollständig.

### Zustellung von Abonnements

Ein Subscription-Input speichert genau die Referenz auf sein unveränderliches Quellevent,
keine zweite Kopie seines Inhalts. Die Projektion löst die Referenz aus der bereits gelesenen
Historie auf und erzeugt für die RunView weiterhin den vollständigen JSON-Inhalt. Fehlende
Quellen und zusätzliche Quellevent-Referenzen werden abgewiesen. Beim Fork werden die Referenzen
auf die geerbten Events des neuen Runs umgeschrieben; der Eingabeinhalt entsteht daraus neu.
Die ZUSTELLUNG an den Actor ist typisiert: `packages/ragents/src/agents/delivery.ts` parst das
projizierte Event einmal und übergibt es als `input.event` (Typ, Absender-ID und -Handle,
Sequenz, EventId, Zeitpunkt, payload). `input.content` trägt dabei den reinen Text der Textevents
(`model.output.completed`, `model.reasoning.completed`, `runtime.output.recorded`) und sonst
den kanonischen JSON der payload. Ein LLM-Actor bekommt denselben Sachverhalt als lesbare
Kopfzeile mit Eventtyp, Absender-Handle und Sequenz, dazu eine kompakte Zeile seiner aktiven
Subscriptions. Ein direkter `actor_input` bleibt unverändert: Text in `content`, `event` ist `null`.

### Actorbestand und Arbeitsbereich im Systemprompt

Hat ein LLM-Actor tatsächlich Zugriff auf `actor_list`, ergänzt der Scheduler seinen Systemprompt
zu jedem Turn um den aktuellen Actorbestand: Handles, Anzeigenamen, Art und Lifecycle sowie die
Markierungen für ihn selbst und den primären Actor. Das schließt Beteiligte aus Run-Setups und
von anderen Erzeugern ein; fremde Systemprompts werden nicht eingeblendet. Während eines Turns
aktualisiert `actor_list` den Bestand. Ohne dieses Werkzeug, insbesondere bei `tools: []`,
entfällt die Übersicht.

Hat ein Actor Arbeitsbereichswerkzeuge, hängt der Scheduler zu jedem Turn ein letztes Kapitel an
seinen Systemprompt: die Beschreibung des aufgelösten Arbeitsbereichs, die der Arbeitsbereich
selbst liefert (`SessionWorkspace.description`, im Kern nur ein Text ohne Werkzeugbezug). Sie
nennt, was der Ordner ist, wo er liegt und auf wessen Rechner, und fordert dazu auf, sich vor
Aussagen über das Projekt darin umzusehen; dazu die Wurzeln des Servers mit ihrem Alias, wie die
Werkzeuge sie in dieser Bindung erreichen und welche Variablen es nur in der Bash auf dem Server
gibt. Das gilt für jeden Actor, nicht nur den Koordinator,
und auch nach einem `refreshTools` im laufenden Turn, gleich ob der Host die Werkzeuge als
Funktionen stellt oder die Agentenlaufzeit sie mitbringt. Dieses Kapitel ist die einzige Stelle,
die einem Modell ein Arbeitsverzeichnis nennt: die Agentenlaufzeit hängt an den Systemprompt des
Schedulers nichts über Ordner an, auch keine Zeile `Current working directory`. Ein Actor ohne
Arbeitsbereichswerkzeuge bekommt weder das Kapitel noch einen Pfad. Sein einziger Dateizugang wäre
`typescript_eval`, und das arbeitet über `context.functions` und relative Pfade; der Ordner, in dem
es auf dem Server läuft, ist ein Detail des Hosts und bei einem Run auf einem Arbeitsplatz nicht
einmal der Ordner des Projekts.

Die Agentenlaufzeit trennt zwei Ordner. `TurnRequest.workspace` ist das Arbeitsverzeichnis der
Werkzeuge; es kann auf einem anderen Rechner liegen, und die Laufzeit bleibt nur an diesen Namen
gebunden. `TurnRequest.runtimeDirectory` liefert erst bei Bedarf den Ordner auf diesem
Rechner, in dem die Laufzeit ihre eigenen Belange erledigt: ihre Sitzungsdatei trägt ihn, ihre
Einstellungen, Ressourcen und Hooks sehen ihn, und er muss existieren. Der Host liefert ihn
über `Workspaces.runtimeDirectory`; bei einem Arbeitsbereich auf dem Server ist es derselbe Ordner,
bei einem Arbeitsplatz der eigene Ordner des Runs auf dem Server. Eine gespeicherte Sitzung
öffnet immer im aktuellen `runtimeDirectory`, auch wenn ihr Kopf einen anderen Ordner nennt, etwa
nach einem Run-Umzug oder aus der Zeit, als dort der Arbeitsbereich stand; der Kopf wird dafür
nicht geprüft.

### Artefakte, Anhänge und Besitz

Ein `artifact.published`-Event gewährt allein keinen Inhaltszugriff. Den Inhalt lesen dürfen der
Run-Owner, der Erzeuger und ein Actor, dem das Artefakt ausdrücklich mit einem ActorInput
zugewiesen wurde.

Chat-Anhänge werden als binäre Artefakte gespeichert und dem ActorInput über `artifactIds`
zugewiesen. Das Run-Journal enthält Metadaten und Referenzen, keine Base64-Dateiinhalte. Der
Agent-Treiber liest die zugewiesenen Bytes und übergibt Bilder, Videos und native PDFs als
Medieninhalte an die Modelllaufzeit. UTF-8-Textdateien ergänzen den Eingabetext, andere Dateien
legt der Host über `Workspaces.storeAttachment` unter `attachments/` im Arbeitsbereich ab, auf dem
Rechner, auf dem die Dateiwerkzeuge arbeiten (bei einem Arbeitsplatz dort, nicht auf dem Server);
der Treiber schreibt nichts selbst in das Arbeitsverzeichnis. Der Treiber
prüft die nötigen Modell- und Werkzeugfähigkeiten auch bei Zustellung außerhalb der Chat-API.
Die private Agent-Session erhält die Medieninhalte für spätere Modellaufrufe; die Run-Projektion
liefert stattdessen Downloadmetadaten für den Chat-Verlauf.

Besitz folgt ausschließlich `createdBy` und wird nur für Stopprechte und rekursive Stopps benutzt.
`createdBy` ist der Actor des Commands, der `agent.spawned` oder `script.created` geschrieben hat;
die Journal-Semantik prüft beim Schreiben und Laden, dass es ihn gibt und dass er `agent.spawn`
hält. `primaryActorId` ist eine getrennte explizite Auswahl. Der Core leitet aus dem Besitz weder
Routing noch Sichtbarkeit ab; die Oberfläche nutzt ihn nur zur Darstellung, etwa im Adressatenbaum
des Run-Panels (`plugins.md`).

Ein ausführbarer Actor trägt optional eine Kurzbeschreibung `description` für Übersichten:
höchstens 160 Zeichen (`actorDescriptionMaxLength`), Leerraum zu einem Leerzeichen
zusammengezogen, eine leere ist ein Fehler. `agent.spawned` und `script.created` halten sie im
Payload fest, die Projektion setzt sonst `null`; Journale ohne das Feld laden deshalb unverändert.
`agent_spawn` nimmt sie als Feld `description`, ein Actor-Programm gibt beim Anlegen seines
TypeScript-Actors die Beschreibung seines Pakets mit, auf die Grenze gekürzt. `actor_list` liefert
sie neben `createdBy`. Der Kern liest sie nie; sie ist kein Rollenvertrag und ändert keine Rechte.
Der Host erkennt seinen Run-Koordinator am bestehenden journalisierten Erzeugungsbefehl, auch
nach Forks. Produkt- und Aufbauprompt sowie Koordinator-Skills bleiben bei diesem Actor.
Ein zum Primary gewählter Fachagent behält seinen Fachprompt und seine Agenten-Beiträge;
die Primary-Auswahl bestimmt weiterhin Chatprojektion und Ausgabevertrag.

## Wartende Aktionen

Der Kern kennt genau eine Art von wartender Eingabe: die Aktion. Sie hält `title`, einen
Eigentümer `owner` (die Kennung des Plugins, das sie erzeugt hat, oder `null`), die
beschreibenden Felder `description`, `parameters` und `input` sowie einen für den Kern
undurchsichtigen `payload`. Der Kern prüft am Payload nur, dass er ein JSON-Objekt oder `null`
ist; er liest ihn nie. Ihr Lebenszyklus ist `action.proposed` und genau ein `action.resolved`
mit `approved` oder `dismissed` und einem ebenso undurchsichtigen `result`. Verlangt `input`
eine Angabe, muss ein `approved` ein nichtleeres Ergebnis tragen.

Der Kern kennt damit keine Werkzeugform. Ob eine Aktion eine Frage mit Optionen, eine
Mehrfachauswahl, ein Formular oder eine Bestätigung ist, steht allein im Payload ihres
Eigentümers; nur dessen Web-Beitrag stellt sie dar (`docs/spec/plugins.md`, Web als
Plugin-Host). Eine Aktion ohne Eigentümer ist der generische Genehmigungsfall des Kerns
(`action_propose`) und verlangt die Fähigkeit `action.propose`; eine Aktion mit Eigentümer
gehört dem Plugin, das sie erzeugt, und verlangt sie nicht.

Offene Eingaben werden generisch gezählt: je Actor, je Mini-App und je Run zählt die Zahl der
Aktionen mit Status `pending`. Beschriftungen sagen "wartet auf Eingabe".

Journale, die vor dieser Trennung geschrieben wurden, enthalten Aktionen mit `kind` und
`question`. Sie werden nicht migriert: die Prüfung lehnt ein solches Ereignis mit der Ursache
ab, und der betroffene Run wird wie jeder Run mit einem ungültigen Ereignis isoliert, während
Server und übrige Runs weiterlaufen. Eine Migration hätte den Kern gezwungen, die Form des
Plugins `ragents.ask` dauerhaft weiter zu kennen - genau die Kopplung, die hier entfällt.

<!-- guide:runtime -->
## IDs, handles, and creating actors again

An actor has a technical ID and a readable handle such as `@worker`. Wherever a function, method,
or plugin accepts an actor by ID or handle, the same rule resolves it: the leading `@` is
optional, and case and Unicode composition do not matter. Once assigned, a handle
remains reserved within the run even after the actor stops, so a handle always names exactly one
actor, and restarting by handle reaches the stopped actor. If another LLM agent is created with
the same requested name, it receives an available suffix such as `worker-1`. `agent_spawn`
returns the `{ id, handle }` of the actor it actually created; later calls use that reference.
Requesting the same name does not automatically reuse an existing actor.

Restarting continues the same stopped actor. If the owner restarts the actor that was the primary
actor when it was stopped, and no other primary actor has been chosen since, it becomes the
primary actor again, so its chat continues. For TypeScript actors, creation rejects a handle
that is already assigned. The creation itself remains recorded as an event in the journal.
<!-- /guide:runtime -->

<!-- guide:runtime -->
## Equipping subagents

`agent_spawn` requires an explicit function selection in `tools`:

| Selection                            | Equipment                                                          |
| ------------------------------------ | ------------------------------------------------------------------ |
| `[]`                                 | Plain LLM without runtime, workspace, or host functions.           |
| `["read", "write", "edit", "bash"]` | Exactly these functions, for example for a coding agent.           |
| `null`                               | The full dynamic set, including access added later.                |

A missing selection or unknown names are rejected before spawning. Actors created any other
way, by the host, a run script, or an actor program, are checked by the scheduler: when an actor
it runs (any driver except `manual`) is created or restarted, it resolves the requested names the way a turn would, counting functions
that are currently unavailable as known. A name that no host function provides stops the actor
before its first turn, and the stop reason names the unknown tools. The selection is not
inherited, although delegable engine capabilities still are. `withoutCapabilities` removes
named technical permissions. Availability and grants also apply when the value is `null`.
`forkOf` (a handle or ID) makes the new agent a fork of an LLM agent in the same run:
`agent.spawned` records the source, and on the new agent's first turn the agent driver copies
the source's stored context branch into its own context file. The copy ends before the source's
first unanswered function call and contains no reasoning blocks; the new agent supplies its own
system prompt, functions, and model. Later turns from the source are not copied. Both source and
fork require the agent driver; a source without stored context is a hard error on the fork's
first turn. A plain LLM receives no function overview. Its driver must explicitly support this
isolation or the turn is rejected.

Equipped LLMs receive `typescript_api` and `typescript_eval`, plus an automatically generated
overview of their available TypeScript functions with names and short descriptions. The
overview stays current during the turn. Domain functions are called through
`context.functions` in snippets. Additional native tools require explicit registration. Roles
and work boundaries remain prompt instructions. Alongside a role (field `profile`), `agent_spawn` accepts
`model` and `thinking` from the model list. A role supplies only the driver, provider,
reasoning level, timeout, and workspace default; the product model list defines which models are
available. If neither a model nor a role that supplies one is present when an agent starts,
the error lists the available roles for the selected driver. A manual role is not
suggested as an agent's model choice.
<!-- /guide:runtime -->

### Modellwahl, Bestandsprüfung und Run-Konfiguration

Werkzeugbeschreibung, Feldbeschreibungen und Orchestrierungsprompt verlangen die ausdrückliche
Rollen- oder Modellwahl für jeden LLM-Spawn und erklären, dass das Modell des Aufrufers nicht
vererbt wird. Die Felder bleiben einzeln optional, weil eine Rolle das Modell liefern kann und
manuelle beziehungsweise Script-Treiber kein Modell benötigen. Fehlende Auswahl bleibt ein
harter Fehler; es gibt keine automatische Wahl einer Standardrolle.

Der Orchestrierungsprompt verlangt vor einer Neuanlage die Bestandsprüfung mit `actor_list`.
Passende vorhandene Beteiligte erhalten neue Aufgaben über `actor_input`; nur fehlende Rollen
oder bewusst getrennte Kontexte brauchen einen neuen Actor. Das ist eine Arbeitsanweisung,
keine Namens-Deduplizierung: `agent_spawn` erzeugt weiterhin einen neuen Actor und vergibt bei
belegtem Handle einen freien Suffix. Die Laufzeit leitet aus gleichen Namen keine gleiche Rolle ab.

Den Run selbst konfiguriert `run_configure` unter der Capability `run.configure`: `title`
schreibt das Ereignis `run.title-changed`, `primaryActor` wählt einen aktiven Agenten oder
TypeScript-Actor als Primary-Actor (`run.primary-actor-selected`); beides zusammen ist erlaubt, keins
von beiden ein benannter Fehler. Der Besitzer des Runs konfiguriert von Rechts wegen, jeder andere
Actor braucht den Grant; die Journal-Semantik prüft dasselbe beim Laden. Besitzer und Koordinator
halten alle neun Capability-Namen aus `domain/vocabulary.ts`. Wechselt der Primary-Actor, bindet
sich der Chat neu an ihn. Ein Run-Script (`typescript-platform.md`) nutzt genau das, wenn es
ohne Koordinator startet.

Automatisch verdichtete Listentitel sind dagegen Metadaten des Hosts außerhalb des Journals.
Sie ändern `RunState.title` nicht. Ein ausdrücklich über `run_configure` oder ein Setup
gewählter Titel hat in der Oberfläche Vorrang. Modellwahl und Erzeugung beschreibt
`profiles.md`, die Aktualisierung der Run-Liste `plugins.md`.

## Globaler Koordinator

Seine Modellauswahl liegt dauerhaft in der profilbezogenen Plugin-Ablage. Die Settings-API
prüft Modell und Reasoning gegen den konfigurierten Katalog und die Modelllaufzeit. Ein
Modellwechsel darf die bereits zugestellten Medien nicht unlesbar machen; ein inkompatibles
Modell wird vor dem Speichern abgewiesen. Die Agent-Session und ihr Gespräch bleiben erhalten.
Nach dem Claim eines Turns übernimmt der Scheduler synchron die aktuelle Modellauswahl;
die Plugin-Policy hält sie mit Turn-Bezug als `plugin.state-replaced` fest. Ein schon
gestarteter Turn behält seine Auswahl. `Actor.execution` beschreibt weiterhin die
Startkonfiguration; die tatsächliche Auswahl des globalen Koordinators steht pro Turn
in dessen Plugin-Ereignis. Gewöhnliche Actors verwenden ihre konfigurierte Ausführung.

Das Plugin `ragents.overseer` gibt jedem angemeldeten Benutzer einen eigenen, dauerhaften
Run mit dem globalen Koordinator; ohne Anmeldung (offen, `ACCESS_TOKEN`,
`anonymousUser`) gibt es genau einen. Ihre Run-ID bildet der Server aus dem Benutzer
(`overseer-` und die ersten 24 Hexzeichen von SHA-256 der Benutzerkennung, ohne Anmeldung
`overseer-single`); Web und andere Clients fragen sie mit `ragents.overseer.coordinator` ab.
Eigentümer ist der Benutzer. Die Kennung erreicht nur er: kein anderer Benutzer, auch nicht mit
`runs.read.all`, und eine noch freie Koordinatorkennung gehört nicht dem, der sie zuerst nennt,
sondern antwortet jedem anderen mit `run-not-found`. Rechte bleiben die des Plugins
(`ragents.overseer.read` und `.write`); freie Runs (`runs.create`) braucht die erste Nachricht nicht.
Der Run verwendet dieselben Chat-Routen, Agentenlaufzeit, Journal- und Stop-Grenzen wie
andere Runs. Erst die erste Nachricht legt den Run an; nach einem Neustart bleiben Chat
und Modellkontext erhalten. Die normale Run-Liste blendet alle Koordinatoren aus, eine
Löschung oder ein Umzug wird mit `global-chat-protected` (Status 409) abgewiesen, ein Import unter
einer Koordinatorkennung mit `run-transfer-exists`. Die Ablage gehört wie alle Runs zum
Datenverzeichnis des gestarteten Profils.

Die Kennung `overseer` des früheren gemeinsamen Koordinators bleibt reserviert, gehört aber keinem
Zugang: Der Server öffnet ihn nicht, niemand erreicht ihn, und sein Journal bleibt unverändert
liegen. Dasselbe gilt für den Koordinator eines Benutzers, der aus dem Profil entfernt wurde. Ein
Turn eines solchen Koordinators scheitert an `coordinator-without-access`, weil sein Arbeitsbereich
keinen Zugang hätte, mit dem er handeln könnte.

Jede aus der Oberfläche gesendete globale Nachricht führt einen kompakten Standort zum
Absendezeitpunkt mit: Startansicht, Run-Übersicht oder geöffneter Run, aktiver Bereich
und Reiter sowie ein ausgewähltes Element. Der Browser sendet nur kleine Kennungen. Der Server
löst den Run-Titel, die vorhandene kurze Run-Referenz und gegebenenfalls den Actor-Namen auf.
Der Standort dient der Orientierung; er ist weder Auftrag noch Berechtigung für eine Aktion.

Der sichtbare Nutzertext bleibt unverändert. Die aufgelöste Orientierung liegt getrennt im
journalisierten Plugin-Zustand des Owner-Actors; die `sourceEventIds` des Inputs binden genau
dessen Stand. Der dynamische Systemprompt liest diese Bindung für den bearbeiteten Input. Eine Warteschlange,
spätere Eingaben oder ein anschließender Run-Wechsel ändern den schon übermittelten Standort
nicht. Fehlt die UI-Angabe, wird ausdrücklich kein aktueller Standort angegeben; ein früherer
Schnappschuss wird nicht weiterverwendet.

Die Orientierung enthält weder Screenshot noch DOM, Formularinhalte oder vollständige
Run-Inhalte. Das Öffnen einer Ansicht erzeugt keine zusätzliche Modellarbeit. Für den
Schnappschuss gibt es weder einen weiteren Modell-Turn noch Context-Polling oder eine
zusätzliche Modellausführung.

Primär-Chat und Actor-Verläufe verwenden dieselbe Abbildung von Journal-Ereignissen auf
Chat-Ereignisse für Text, Reasoning, Werkzeuge, Laufzeitmeldungen und Turn-Abschluss sowie
Fragen und Antworten. Routing, Absenderdarstellung, Plugin-Zustand und Input-Auswahl bleiben
getrennte Aufgaben. Actor-Verläufe unterscheiden Werkzeugaufrufe zusätzlich nach Turn,
schließen Reasoning-Blöcke direkt und ergänzen Fehlerergebnisse offener Werkzeuge bei Abbruch.
Den Grund eines Stopps nennen beide Ansichten einmal: Unterbricht derselbe Command einen Turn des
Actors, steht er an der Unterbrechung, und das `actor.stopped` dieses Commands wiederholt ihn
nicht; ein Stopp ohne laufenden Turn nennt ihn am `actor.stopped`.
Tool-Argumente entsprechen in beiden Ansichten dem journalisierten JSON, auch bei `null`.
Jede eingehende Nachricht trägt die Kennung ihres Inputs. Ein `turn.input-steered` markiert sie an
ihrer ursprünglichen Stelle als in den laufenden Turn eingespeist; die Oberfläche zeigt darunter
"In den laufenden Turn eingespeist", im Primär-Chat wie im Actor-Verlauf und nach Wiedergabe gleich.
Eingehende Nachrichten schließen einen laufenden Text- oder Reasoningblock nicht. Weitere
Textstücke ergänzen denselben Block an seiner ursprünglichen Position, auch wenn danach bereits
eine neue Eingabe steht. Das gilt ebenso für zugestellte Actor- und Hintergrundinputs.
Ausgabewechsel und Turn-Abschluss schließen den offenen Block unabhängig von seiner Position;
Text aus verschiedenen Gesprächen oder Turns wird anhand des Cursors getrennt.

Die Chatprojektion liefert jeden sichtbaren Assistant-Text mit einem verpflichtenden stabilen Cursor. Die
Gesprächsidentität ist die Event-ID von `run.created`; die Position innerhalb des Gesprächs
verwendet die Journal-Sequenz von `turn.started` und einen Offset im akkumulierten Turn-Text.
Der Offset zählt UTF-16-Einheiten ohne Leerraum, damit Live-Chunks und erneut geladene,
getrimmte Journalblöcke dieselbe Position ergeben. Werkzeug- und Reasoningereignisse erhöhen
ihn nicht. `Message.textCursor` enthält die zuletzt projizierte Textposition. Der ausführbare
Vertrag für `ChatTextCursor` und die Stream-Ereignisse bleibt im Code.
Die Cursorabdeckung verhindert doppelte Textausgabe nach Streaming, ohne spätere nur im Journal
vorliegende Textblöcke desselben Turns zu unterdrücken.

Der Chat liest den Ereignisstrom über den JSON-RPC-Client nach UTF-8-Decodierung im Stream. Beliebige
Byte-Grenzen und mehrzeilige Datenfelder werden vom Parser verarbeitet. Nur
vollständig abgeschlossene Ereignisse gelangen in die Nachrichtenprojektion; unvollständige
Reste enden mit ihrer Verbindung. Bei Abbruch wird der Reader freigegeben. Nach einer
unterbrochenen Verbindung beginnt nach drei Sekunden ein neuer Stream mit eigener Wiedergabe.

Jede anfängliche oder neu gebundene Wiedergabe endet ausdrücklich mit `replay-end` und der
Gesprächsidentität. Ohne angelegtes Journal ist die Identität `null`. Der Browser betrachtet
die Verbindung erst nach dieser Grenze als verbunden; die optionale Aktivierung von `useChat`
erlaubt einen erst bei Nutzung geöffneten Stream. Reset-Ereignisse nennen verpflichtend dieselbe Identität,
ein ausdrücklicher Gesprächsreset zusätzlich `reason: "conversation-reset"`. Eine geänderte
zuvor nichtleere Identität erkennt auch einen Reset während einer Verbindungsunterbrechung;
der erste Wechsel von `null` zum angelegten Gespräch ist kein Reset. Ein gewöhnliches Replay
leert den Eingabeentwurf nicht. Diese Angaben ermöglichen eine stabile Textprojektion im
Browser, ohne Ereignisse erneut auszuführen oder Zeitstempel und Textvergleiche als Identität
zu verwenden.

Das Plugin `ragents.overseer` bietet einen ausdrücklich bestätigten Gesprächsreset. Der Host sperrt
währenddessen neue globale Eingaben, beendet den globalen Run und wartet dessen tatsächliche
Laufzeitbereinigung ab, einschließlich einer bereits begonnenen Stopp-Bereinigung. Danach entfernt
er nur dessen Journal, private Modell-Session und Arbeitsablage. Das bestehende Chat-Sessionobjekt
meldet den Reset an seine Streams; die nächste Nachricht beginnt einen frischen Run unter
derselben Kennung. Der Reset trifft nur den Koordinator des Aufrufers; Modellwahl, Run-Referenzen,
die Koordinatoren anderer Benutzer und alle übrigen Runs bleiben erhalten. Ein vor der
Löschung dauerhaft gespeicherter Reset-Marker (je Koordinator `reset-intents/<runId>.json` in der
Plugin-Ablage) lässt einen begonnenen Reset nach Prozessabbruch
beim nächsten Start fertig werden. Bis zum Abschluss oder einem erfolgreichen Wiederholungsversuch
bleiben neue globale Eingaben gesperrt. Einen automatischen kontextabhängigen Reset gibt es nicht.
Ein nachlaufender Scheduler-Scan überspringt ein inzwischen entferntes Journal. Wird der Run
unter derselben Kennung neu angelegt, wird seine neue Arbeit wieder regulär geplant.

Der Produkthost bindet den vom Plugin gelieferten globalen Chat-Vertrag: eigener Prompt,
Werkzeugauswahl und ein kleines Arbeitsverzeichnis in der Plugin-Ablage. Der globale
Koordinator verwendet zunächst das Standardmodell des Profils, aber keine Produktprompts,
Produkt-Skills, Hooks oder Vorbereitung eines Produktarbeitsverzeichnisses.
Seine native Oberfläche enthält `typescript_api`, `typescript_eval` und die freigegebenen
Dateiwerkzeuge `read`, `write` und `edit`; ohne Anmeldung kommt die Host-Shell `bash` dazu. Mit
Benutzern hat er keine, weil sie als Serverprozess die Dateien aller Benutzer lesen könnte; seine
JSON-RPC-Aufrufe schickt er dann aus Snippets mit `fetch`. Einzelne Arbeitsaktionen laufen direkt;
`quick_answer` für eine ergänzende Kurzantwort und zusammengesetzte Aufrufe verwenden
dieselbe `context.functions`-API wie normale Runs. Die beiden
TypeScript-Werkzeuge gehören zur Server-Grundausstattung und benötigen kein Actor-Programm-Plugin.
Ohne Anmeldung erhält nur sein Arbeitsbereich zusätzlich lesenden Dateizugriff auf den
Journalordner des Profils; `write` und `edit` dürfen dort nicht schreiben. Mit Benutzern entfällt
diese Lesewurzel, weil der Ordner die Journale aller Benutzer enthält; der Koordinator liest
Journale dann über `ragents.overseer.readEvents`, die nur die Runs seines Benutzers kennt. Die Host-Shell ist keine zusätzliche
Dateisystem-Sandbox; ihre Arbeitsanweisung verlangt, Laufzeitdaten ausschließlich über die
Nachrichtenschicht zu ändern. Normale Runs erhalten weder diese zusätzlichen Lesewurzeln noch den API-Zugang.

`quick_answer` steht ausschließlich dem globalen Koordinator mit `plugin.state.write`
zur Verfügung. Es übernimmt die kurze Wiederholung der aktuellen Nutzerfrage als `question`
und die kurze Antwort als `text`. Beide Felder werden außen getrimmt und müssen jeweils
nichtleer, ohne Zeilenumbrüche und höchstens 240 UTF-16-Zeichen lang sein. Die Promptanweisung
verlangt zuerst die vollständige normale Chatantwort und danach Frage und Ergebniszusammenfassung;
nach erfolgreichem Aufruf wird keine weitere inhaltliche Antwort oder Bestätigung angehängt.
Das Werkzeug ersetzt den Run-Zustand des Plugins `ragents.overseer` durch eine Kurzantwort mit beiden Feldern. Die
journalisierte Änderung erscheint im vorhandenen Plugin-Stream als `state-replaced` mit
Gesprächsidentität, Event-ID und Journal-Sequenz. Der Zustand und der Ereignisvertrag stehen
im Code; für die Kurzantwort entsteht kein eigener Zustellkanal.

Der globale Koordinator teilt seinen Grundprompt mit der eigenständigen Vorbereitungsrolle
für neue Skill-Aufträge. Deren speicherinterne Agent-Session hat ein eigenes Gespräch und
ausschließlich die Startfunktion für den besprochenen Auftrag. Sie übernimmt weder den
globalen Verlauf noch dessen Verwaltungszugriffe. Ein sinngemäßes Go des Benutzers erlaubt
die Übergabe an den normalen Run-Start; Vertrag und Lebenszyklus stehen in `plugins.md`.

Das Plugin stellt dieselben Verwaltungsmethoden für externe Clients und den globalen Koordinator
bereit. Sie kann vorhandene Runs auflisten, ihre Zustände und Journale seitenweise lesen,
ihren primären Actor beauftragen, sie stoppen und neue Runs erstellen. Eindeutige Titel,
Run-IDs und kurze Referenzen wie `Run 1` werden serverseitig aufgelöst. Ein eigener Index in
der Plugin-Ablage erhält die Referenzen auch nach Sortierung, Löschung und Neustart.
Mehrdeutige Titel werden mit den gültigen Referenzen abgewiesen. Neue Run-IDs erzeugt der
Server. Archivierte und gelöschte Runs sind nicht Teil dieses Zugriffs.

Neue Runs starten mit einer Nachricht, einem installierten Run-Script oder einem lokalen
Run-Script-Paket über dessen absoluten Serverdateipfad. Lokale Pakete verwenden dasselbe
Format und denselben Loader wie installierte Vorlagen. Startoptionen-Validierung,
Workspace-Vorbereitung, Check, Test und Installation bleiben der normale Startpfad.
Der globale Koordinator kann vorbereitete Pakete starten. Der Run-Koordinator verwendet im
vorhandenen Run TypeScript-Snippets für einmalige Arbeit und Aufbau, oder Actor-Programme
für dauerhaften Zustand, spätere Nachrichten und Views. Fachliche Aufträge bestimmen das
Ergebnis; die technische Umsetzung wählt das Modell anhand der verfügbaren API.
Aufbaureihenfolge und Wiederholungsgrenzen stehen in `typescript-platform.md`.
Der Erstellungsaufruf wartet auf dessen Abschluss; erfolgreiche Annahme bedeutet noch nicht,
dass der erste Turn ausgeführt wurde. Ein Katalog beschreibt die installierten Vorlagen
und gültigen Startoptionen des tatsächlich gestarteten Profils.

Anfrageprüfung, Dispatch, OpenRPC und Markdownreferenz verwenden dieselben ausführbaren
Verträge der Nachrichtenschicht. Die Referenz wird beim Vorbereiten des globalen
Arbeitsbereichs aus dem Code erzeugt und nach einem Gesprächsreset erneut bereitgestellt.
Der Systemprompt enthält einen kompakten, ebenfalls generierten Überblick über diese
Methoden einschließlich ihrer Benutzerrechte. Dazu kommen Namen und Kurzbeschreibungen
regulärer Run-Bausteine aus den Engine-Deskriptoren und den öffentlichen Werkzeugdeskriptoren
der tatsächlich registrierten Plugins und Hooks. Dadurch sind etwa die installierten
Kachel- und Actor-Programm-Fähigkeiten bereits vor dem ersten Referenzzugriff bekannt. Der Prompt
wird erst beim Lesen aus dem vollständigen Registrierungsstand zusammengesetzt; die Erzeugung
löst keine Werkzeugfabriken aus und liest weder Konfigurationswerte noch interne Serviceoperationen.
Dieser Katalog erweitert nicht die feste Werkzeugauswahl des globalen Chats und erteilt keine Rechte:
Run-Aufrufe bleiben an Actor, Grants, deklarierte Script-Teilmenge und Run-Kontext gebunden.
Genaue Schemas und Codebeispiele lädt der Koordinator bei Bedarf aus der Referenz. Die öffentliche
Hilfe beschreibt showcase; der Prompt kennzeichnet den Unterschied zum aktiven Profilbestand.
Shell und Snippets erhalten Host-Ursprung, ohne Anmeldung den Journalordner und bei aktiviertem
Zugangsschutz den Bearer-Token als Umgebungsvariablen; der Tokenwert erscheint weder im Prompt noch in
der Referenz.
`RAGENTS_API_BASE_URL` nennt den lokalen Host mit dem Port, auf dem er tatsächlich lauscht, auch
nach einem Start mit `--port 0`; ein Server nur über stdio hat keine HTTP-API und setzt die Variable
nicht. `RAGENTS_JOURNAL_DIR` zeigt ohne Anmeldung auf die echten Journale des Profils, die die
Shell etwa mit `rg` durchsuchen kann; große Payload-Felder liegen im benachbarten `payloads/`-Ordner,
`payloadRefs` nennt Hash und Bytezahl, und `ragents.overseer.readEvents` löst diese Referenzen
vollständig auf. `RAGENTS_API_TOKEN` steht für den Zugang des Benutzers, dem der Koordinator
gehört: mit Benutzern ein Token je Benutzer, der nur über Loopback und nur für `/rpc`,
`/rpc/stream` und `/help/` gilt und bei jedem Aufruf den aktuellen Stand dieses Benutzers liefert
(ein entfernter Benutzer ist nicht angemeldet); mit `anonymousUser` ebenso ein Token für den
anonymen Zugang; mit `ACCESS_TOKEN` dieser Token; offen keiner. Die Werkzeuge des Koordinators
sehen und bedienen damit genau, was sein Benutzer darf, und Runs, die sie anlegen, gehören ihm.
Eine eigene Dienstidentität mit weiteren Rechten gibt es nicht. Die erzeugte Referenz liegt als `rpc-reference.md` und `openrpc.json` im eigenen
Arbeitsverzeichnis; dieselbe API steht externen Clients mit dem normalen Hostzugang zur Verfügung.

Die Werkzeugauswahl gehört zur journalisierten Actor-Identität. Ein vorhandener globaler Run
mit einer vom aktuellen Plugin abweichenden Werkzeugauswahl wird beim Senden mit
`global-tools-changed` abgewiesen. Ein ausdrücklicher Gesprächsreset übernimmt mit dem nächsten
Gespräch die aktuelle Auswahl und Promptanweisung. Öffnen und Zurücksetzen bleiben möglich;
eine automatische Journalmigration findet nicht statt.

<!-- guide:runtime -->
## Journal and projection

The journal is the shared history of a run. Visible state is produced by replaying its events;
models and functions are not called again in the process. Recorded responses, function calls,
state changes, and interruptions therefore remain traceable after a restart. Working files and
private model context are stored separately outside the journal.
<!-- /guide:runtime -->

### Dateiformat, Schreibgrenzen und Wiedergabe

Jeder Run besitzt eine lesbare `journal.jsonl` im Dateiformat v5 und bei großen Inhalten einen
benachbarten Ordner `payloads/`. Eine Zeile enthält einen Command mit allen daraus entstandenen
Events. Formatversion, Run-ID, Command und Zeitpunkt stehen einmal im gemeinsamen Umschlag;
Actor und Command-ID sowie die interne Event-Schemaversion werden beim Lesen ergänzt.
Der Command hält Kennung, Typ, handelnden Actor und kanonischen Request-Hash. Der interne
CommandRecord und die Methode `ragents.runs.events` verwenden weiterhin das vollständige Eventschema 3.
Die verbindlichen Typen und die Dateikodierung stehen in `runtime/journal.ts`,
`runtime/journal-storage.ts` und `domain/events.ts`.

Ein einzelnes oberstes Payload-Feld ab 4096 UTF-8-Bytes seiner JSON-Darstellung liegt einmalig
unter `payloads/<sha256>.json`. Die Eventzeile hält stattdessen Feldname, SHA-256 und Bytezahl
in `payloadRefs`. Identische gespeicherte Bytes innerhalb eines Runs teilen dieselbe Datei.
Kleine Felder bleiben direkt lesbar. Die Kodierung verwechselt Referenzen nicht mit
Nutzdaten; zusätzliche oder doppelt belegte Felder sind ungültig. Inhaltsdateien werden vor
der referenzierenden Journalzeile über eine temporäre Datei geschrieben, synchronisiert und
atomar veröffentlicht. Lesen und Wiederverwenden prüfen Hash und Länge; fehlende oder veränderte
Dateien sind harte Fehler. Inhaltsdateien werden nie überschrieben. Ein abgebrochener Schreibvorgang
kann eine unreferenzierte Inhaltsdatei hinterlassen; automatische Einzeldatei-Bereinigung gibt es nicht.

Die Journal-API, Event-Abfragen und Streams liefern aufgelöste Inhalte. Der Ladevorgang liest
weiterhin die gesamte Historie einschließlich referenzierter Inhalte in den Speicher.
Forks schreiben eigene Inhaltsdateien im Ziel-Run und bleiben unabhängig von der Quellablage.
Archivierung und Löschung erfassen den ganzen Run-Ordner einschließlich `payloads/`.

Actor- und Plugin-Zustände werden bei der ersten Speicherung vollständig journalisiert.
Weitere Ersetzungen verwenden ein Änderungsereignis mit typisierten Setz- und Löschoperationen,
wenn dieses kleiner ist als der vollständige Zustand. Objektfelder und Arrayeinträge werden
gezielt verändert; unveränderte Inhalte werden dabei nicht wiederholt. Die Projektion baut den
vollständigen Zustand wieder auf. APIs, Mini-Apps und Zustandsstreams liefern weiterhin den
vollständigen Stand, einschließlich historisch korrekt rekonstruierter Zustände.

Die Event-Sequenz zählt je Run lückenlos ab 1. Zusammengehörige Events eines Commands stehen
hintereinander und tragen dieselbe Command-ID und denselben Zeitpunkt. Die Sequenz bestimmt die
Reihenfolge; Korrelations- und Kausalitätsangaben verbinden Vorgänge und Auslöser, wobei ein
Auslöser auch ein Turn sein kann. Das Journal prüft eine Entscheidung vor dem Schreiben gegen
den bisherigen Zustand und synchronisiert die Datei, bevor es den neuen Zustand übernimmt und
Listener benachrichtigt.

Eine vollständig geschriebene Zeile ist die Commit-Grenze einer Command-Entscheidung.
Command-ID und kanonischer Request-Hash
machen Wiederholungen derselben Mutation idempotent. Ein abweichender Request mit derselben ID
scheitert hart. Listenerfehler verändern nicht den Ausgang eines bereits akzeptierten Commands.
Scheitert Öffnen, Schreiben, Synchronisieren oder Schließen einer bestehenden Journaldatei,
sperrt die Instanz weitere Mutationen dieses Runs bis zum erneuten Öffnen. Dadurch kann ein
Wiederholungsversuch keine möglicherweise bereits geschriebene Zeile duplizieren. Der Neustart
liest vollständige Zeilen und verwirft einen unvollständigen letzten Schreibvorgang. Andere Runs
bleiben beschreibbar. Fehler beim Vorbereiten einer Inhaltsdatei vor dem Journal-Append lassen
dagegen einen unmittelbaren Wiederholungsversuch zu.

Das Journal schreibt Dateiformat 6 und liest die Dateiformate 4, 5 und 6, alle mit internem
Eventschema 3. Format 6 bringt `turn.input-steered`, das ein älterer Stand nicht kennt. Die
Kodierung ist seit 4 unverändert; die Nummer steigt, sobald ein älterer Stand
neu geschriebene Zeilen ablehnen würde, damit er an der ersten solchen Zeile mit der
Formatversion scheitert statt an einem semantischen Widerspruch. Ältere Dateiformate werden
ohne automatische Migration für den betroffenen Run abgewiesen.
Jeder Run wird zunächst vollständig geprüft und projiziert, bevor seine Events, Kennungen
und Zustände in die gemeinsame Laufzeit übernommen werden. Ein altes Format, beschädigtes JSON,
ein ungültiges Event, ein semantischer Widerspruch, ein unlesbares Journal oder eine fehlende
Inhaltsdatei isoliert nur diesen Run. Die übrigen Runs und der Server starten weiter.
Der Fehler enthält Run-ID, Dateipfad und Ursache und wird protokolliert. `loadFailures` und
`failureOf` liefern die Diagnose; lesende und schreibende Run-Zugriffe melden
`journal-unavailable` (Status 409). Isolierte Runs erscheinen nicht in der Liste nutzbarer
Runs, erhalten keine Arbeitsverzeichnisse oder Scheduler-Ausführung und können nicht
unter derselben ID versehentlich neu angelegt werden. Das gilt auch für den globalen Koordinator.
Sein ausdrücklicher Gesprächsreset kann die gesperrte ID nach Entfernen der alten Dateien freigeben.

Die Originaldateien eines abgewiesenen Runs bleiben bytegleich. Eine abgerissene letzte Zeile
wird erst nach erfolgreicher Prüfung aller vollständigen v4-Records repariert. Ein leeres oder
nicht erkennbares Journal wird nicht zu einem neuen Run umgedeutet. Fehler an der
gemeinsamen Ablage oder ein aktiver fremder Writer bleiben echte Infrastrukturfehler.
Beim Neustart werden offene Turns als unterbrochen abgeschlossen, aber nie erneut ausgeführt.
Ein dabei auftretender Journal-Schreibfehler isoliert ebenfalls nur diesen Run und wird gemeldet. Bereits journalisierte Events werden
nicht noch einmal durch Subscriptions zugestellt. Unbeanspruchte Inputs bleiben normale offene
Arbeit in ihrer ursprünglichen Reihenfolge.

Ein exklusives Writer-Lock (`.writer.lock/owner-<token>.json` mit Prozess-ID, Hostname, Start und
Herzschlag) schützt den gesamten Journal-Ordner; der Besitzer erneuert den Herzschlag alle fünf
Sekunden. Beim Öffnen wird ein vorhandenes Lock genau dann übernommen, wenn sein Prozess auf
demselben Host nicht mehr lebt oder sein Herzschlag älter als 30 Sekunden ist; die Übernahme steht
als Warnung im Serverprotokoll. Ein lebender Writer mit frischem Herzschlag wird hart abgewiesen,
zwei Schreiber gibt es nie. Verschwindet die eigene Besitzerdatei, nimmt das Journal keine
Schreibvorgänge mehr an und meldet das. Der Server gibt das Lock bei SIGINT, SIGTERM und SIGHUP
über den geordneten Shutdown frei und bei jedem `process.exit`, also auch nach Absturz oder
Shutdown-Zeitüberschreitung, über einen `exit`-Hook.

Run- und Actor-IDs verwenden im Journal dieselbe portable Grammatik: 1 bis 64 kleingeschriebene
ASCII-Zeichen, alphanumerischer Anfang und Abschluss, dazwischen zusätzlich `_` und `-`.
Reservierte Windows-Gerätenamen sind ausgeschlossen. Dadurch können weder Pfadsegmente verlassen
noch auf case-insensitiven Dateisystemen zwei logische Identitäten auf dieselbe Ablage zeigen. Der
Server validiert beide Kennungen an der actorbezogenen Sessionablage zusätzlich.

Projektionen werden beim Start aus dem Journal rekonstruiert und danach inkrementell
fortgeschrieben. Vor dem Schreiben prüft das Journal nur die neuen Events gegen eine isolierte
Kopie des aktuellen Zustands und des semantischen Kontexts. Erst nach der Persistenz übernimmt
es diese Projektion; ein Prüf- oder früher Schreibfehler verändert den bisherigen Stand nicht.
Die bisherige Historie wird beim Append nicht erneut abgespielt. Globale Kennungsregister und
die bisherigen Record- und Eventlisten werden dabei nicht vollständig kopiert. Die Projektion
kopiert ihre Maps und darin erst die gelesenen, veränderbaren Einträge; unveränderte Nutzdaten
und historische Texte werden geteilt. Der semantische Index wird weiterhin kopiert. Die Kosten
eines Appends sind deshalb nicht konstant und wachsen mit dem gespeicherten Zustand und
Ereignisbestand. Replay liest gespeicherte Ereignisse; es wiederholt weder Modellaufrufe noch
Werkzeugwirkungen. Die Modellkontexte der Agenten, Arbeitsdateien, Dokumentinhalte, Artefaktbytes
und bestimmte Modulquellen liegen zusätzlich außerhalb des Journalordners. Das Journal allein ist
deshalb keine vollständige Datensicherung und kann externe Änderungen nicht zurückrollen.
Die Projektion enthält nur den aktuellen Run-Zustand. Zeitlich geordnete Modell-,
Tool- und Runtime-Ausgaben bleiben als Events im Journal und werden über `event_query` oder die
Event-API gelesen. Die RunView trägt je Turn `outputs` (Text, Sequenz, Zeitpunkt) aus
`model.output.completed`, ungekürzt; die Detailansicht eines Actors zeigt damit zugestellte
Eingaben und eigene Antworten als einen Strom in Journal-Reihenfolge, Reasoning gehört nicht dazu.

## Run auf einen anderen Server umziehen

Ein Run kann von einem Server auf einen anderen wechseln und dort weiterlaufen. `ragents.runs.export`
(Rechte `runs.read` und `runs.inspect`) liefert Manifest und ein `tar.gz` als Base64,
`ragents.runs.import` (Rechte `runs.read`, `runs.write` und `runs.create`) nimmt beides an.
`pnpm run-transfer <quelle-url> <ziel-url> <runId>` verbindet beide Seiten. Das Archiv enthält
`transfer/manifest.json`, den Ordner `runs/<id>` mit Journal und Payloads und den Ordner
`sessions/<id>` mit Modellkontexten, Actor-Programmen und allen Plugin-Ablagen des Runs,
darunter der Dateiablage und dem neuen Ordner je Run auf dem Server. Halbfertige Journal- und
Payload-Schreibvorgänge bleiben draußen. Das Manifest nennt Format, Kennung, Host-Commit,
Executor-Version, Profil, Titel, Revision, Ereigniszahl, einen gebundenen Projektordner und den
Zeitpunkt.

Der Export verlangt einen ruhenden Run: kein Actor in einem Turn, keine wartende Eingabe. Er
kopiert; die Quelle bleibt unverändert und wird nicht gelöscht. Das Archiv ist auf 16 MiB
begrenzt, weil es als Base64 durch die Nachrichtenschicht geht. Es läuft immer nur ein Umzug je
Server; ein zweiter meldet `run-transfer-busy`.

Der Import entpackt in einen Staging-Ordner unter `transfer/` im Datenordner und prüft, bevor er
etwas anlegt: Manifestformat, gleicher Host-Commit, gleiche Executor-Version, Übereinstimmung von
Manifest und Journal, freie Kennung (kein Journal, kein Ordner, kein Archiv, keine Löschabsicht)
und die Bindung. Dann verschiebt er die Run-Ablage an ihren Platz, übernimmt die Records mit
`Journal.adopt` - dabei entstehen die Payloads im Ziel neu aus den gelesenen Inhalten - und gibt
den Run über denselben Weg wieder, den der Serverstart geht: Arbeitsbereich auflösen, Run
öffnen. Der Run behält Kennung, Sequenzen und Ereignisse; er liegt gestoppt und läuft mit der
nächsten Nachricht weiter. Scheitert die Übernahme, wird die verschobene Run-Ablage wieder
entfernt.

Der Import schreibt kein Ereignis um. Absolute Pfade in `tool.call.*` und in den Modellkontexten
bleiben die der Quelle; sie sind Historie, denn die Wiedergabe ruft weder Modelle noch Werkzeuge
erneut auf. Neu aufgelöst wird allein der Arbeitsbereich, und zwar aus der Run-Ablage des
Ziels. Ein Run mit Bindung an einen Projektordner des Quellrechners wird abgelehnt, solange der
Aufrufer keinen Ersatzordner auf dem Ziel nennt; mit Ersatzordner hängt der Import ein neues
`plugin.state-replaced` mit der neuen Bindung ans Journal. Die Bindung an einen Arbeitsplatz
bleibt bestehen und greift wieder, sobald sich der Arbeitsplatz am Ziel anmeldet, und zwar als der
Benutzer, dem der Run gehört (ohne Eigentümer: ohne Anmeldung). Laufende
Prozesse, Sprachserver-Sitzungen und Browser ziehen nicht mit; sie entstehen beim nächsten
Werkzeugaufruf neu.

## Offene Grenzen

1. Modell-JSONL, externe Tool-Effekte und RAgents-Journal bilden keine atomare Transaktion.
   RAgents löst diese Grenze NICHT durch automatische Wiederholung: Ein beim Neustart offener Turn
   wird `interrupted`, und sein beanspruchter ActorInput bleibt diesem Turn zugeordnet. Falls der
   Auftrag erneut laufen soll, braucht es einen neuen ausdrücklichen ActorInput. Dasselbe gilt für
   externe Effekte von TypeScript-Programmen und den Journal-Fortschritt.
2. Quellevent und der daraus erzeugte Subscription-Input sind zwei Journal-Commands. Ein Absturz
   genau zwischen beiden kann die Zustellung verlieren. Beim Neustart gibt es bewusst keinen
   historischen Catch-up, weil dieser dieselbe externe Wirkung doppelt auslösen könnte.
3. Sichtbarkeits- oder Topologieregeln, die verfügbare Actors und Werkzeuge einschränken, gibt es
   nicht. Kämen sie, würden sie das Kernmodell nicht um Channels erweitern.
4. Ein umgezogener Run liegt danach auf beiden Servern unter derselben Kennung. Wer beide weiter
   bedient, bekommt zwei Journale, die auseinanderlaufen; zusammenführen kann das niemand. Das
   Modell sieht in seinem Kontext weiterhin die absoluten Pfade der Quelle; greift es sie am Ziel
   wieder auf, scheitert der Werkzeugaufruf an der Arbeitsbereichsgrenze. Beide Hosts müssen
   ihren Commit kennen, aus dem Paket `@schlenkr/ragents` oder aus dem Git-Checkout; ein Host
   ohne beides kann weder exportieren noch importieren. Eine Dateiablage außerhalb der Run-Ablage
   (`DOCUMENTS_DIR`) zieht nicht mit und bleibt auf der Quelle.
5. Steering erreicht ein Modell nur zwischen zwei Modellanfragen. Ein lange laufender
   Werkzeugaufruf verzögert es bis zu seinem Ergebnis; wer sofort umlenken will, unterbricht den
   Turn. Ein eingespeister Input ändert weder Modellwahl noch Systemprompt des Turns; beides
   gilt, wie beim Turn-Start bestimmt, bis zu dessen Ende.
