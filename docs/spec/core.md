# Kern: Runs, Actors, Inputs, Turns und Events

Der Kern ist das Paket `@aicontainer/ragents`: produktneutral, kennt keine Fachdomäne. `domain/` und `runtime/` sind das Journal-Modell, `agents/` führt Agenten aus und plant
ihre Turns, `drivers/` bindet die Agentenlaufzeit an, `script/` die TypeScript-Actors,
`typescript/` ist Compiler und Laufzeitkontext der Plattform, `plugin-host.ts` und
`plugin-types.ts` sind der Vertrag, gegen den Plugins gebaut werden.

<!-- guide:runtime -->
## Runs und Teilnehmer

Ein Run ist eine Unterhaltung mit eigenen Teilnehmern, Arbeitsdateien und einem Journal.
Ein Actor ist ein Teilnehmer dieses Runs: der menschliche Owner, ein LLM-Agent oder ein
TypeScript-Actor. LLM-Agenten bearbeiten Aufträge mit einem Modell; TypeScript-Actors führen
ihren programmierten Input-Handler aus. Der als Primary ausgewählte Actor ist der direkte
Chatpartner des Benutzers. Diese Auswahl ist unabhängig davon, wer andere Actors angelegt hat.

Ein ActorInput ist ein Auftrag an genau einen ausführbaren Actor. Ein Turn ist die Bearbeitung
genau dieses Inputs. Ein Event hält einen geschehenen Vorgang fest, etwa eine Modellantwort
oder einen Funktionsaufruf. Diese Begriffe trennen Auftrag, Ausführung und aufgezeichnetes Ergebnis.

Native Hintergrundaufträge können `presentation: "background"` tragen. Sie werden normal
eingereiht, dem Actor vollständig zugestellt und im Journal erhalten. Hauptchat und
Actor-Gespräch zeigen den internen Auftrag nicht; die Antwort bleibt sichtbar. Das gilt
auch beim Wiederherstellen des Verlaufs. Ohne Kennzeichnung bleibt die Darstellung unverändert.
Für Benutzer ohne Inspektionsrecht enthält die Laufansicht keinen Text solcher Aufträge.
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
## Scheduler und Turn

Der Scheduler verarbeitet pro Actor höchstens einen Turn:

1. Er beansprucht genau einen wartenden ActorInput.
2. Er stellt Toolset, Arbeitsverzeichnis und Systemprompt zusammen.
3. Der Driver verarbeitet ausschließlich diesen Input.
4. Modell-Output, Reasoning, Runtime-Output und Tool-Aufrufe werden automatisch als Events
   journalisiert.
5. Der Turn endet als `completed`, `failed` oder `interrupted`.

Weitere Inputs warten bis zum nächsten Turn. Sie werden nicht in einen laufenden Turn gelenkt.
Ein Input, dessen Inhalt sich auf den laufenden Turn bezieht (eine Erinnerung, ein Hinweis zum
aktuellen Stand), ist deshalb beim Verarbeiten immer veraltet und darf nicht eingereiht werden.
In einen laufenden Turn führt nur der Kontextbeitrag der Agentenlaufzeit: eine Agent-Extension
(`agentRuntime`-Contribution) ergänzt im Ereignis `context` vor jedem Modellaufruf Nachrichten,
ohne den Turn zu beenden; so arbeiten die Projektdiagnostik der Actor-Programme (nur für Actors,
denen die Actor-Programm-Werkzeuge zur Verfügung stehen) und die Fortschrittserinnerung des
Feature-Pilot.
Ein fehlgeschlagener oder durch einen Serverneustart unterbrochener Turn wird nicht automatisch
neu eingereiht oder erneut ausgeführt. Bereits eingereihte, noch nicht beanspruchte ActorInputs
bleiben dagegen wartend. Nach dem Start können sie verarbeitet werden, sofern ihr Actor
weiterhin ausführbar ist. Was ein Werkzeugaufruf im Journal festgehalten hat, bleibt gültig;
ein späterer Fehlschlag desselben Turns macht es nicht ungültig. Ein Dienst, der auf ein
abgegebenes Ergebnis wartet, bindet dessen Gültigkeit deshalb nicht an den Turn-Ausgang.

Bei einem LLM kann ein Turn mehrere Modellanfragen und TypeScript-Snippets umfassen.
`return` beendet das aktuelle Snippet und liefert dem Modell die Befunde. Das Modell kann
anschließend entscheiden und das nächste Snippet ausführen, weiterhin im selben Turn.
Auf spätere Agentenantworten oder Ereignisse wartet ein Snippet nicht: Eine Subscription
erzeugt dafür einen neuen ActorInput und damit einen späteren Turn. Es braucht keinen
zusätzlichen Entscheidungspunkt in der Programmiersprache.
<!-- /guide:runtime -->

Eine Modellantwort ohne Text und ohne Werkzeugaufruf (nur Reasoning, Stopgrund `stop`) beendet
den Turn nicht: die Agentenschleife stößt genau einmal mit der Nutzer-Nachricht "Deine Antwort
enthielt weder Text noch Werkzeugaufruf. Antworte jetzt mit dem nächsten Werkzeugaufruf oder
Deiner Antwort." nach. Bleibt auch die folgende Antwort leer, endet der Turn als `failed` mit
der Ursache "Modell lieferte zweimal eine leere Antwort." als Runtime-Ausgabe und Grund in
`turn.finished`, nicht als `completed`. Eine Antwort mit Text oder Werkzeugaufruf setzt die
Zählung zurück; Zeitgrenzen sind davon unberührt.

Die Run-Ansicht projiziert Werkzeugaufrufe je Turn als kompakte `toolCalls`: Kennung, Name,
Status und Start-/Endzeit. Die bestehenden Start-, Ergebnis- und Fehlerereignisse aktualisieren
sie; eine Turn-Unterbrechung beendet noch offene Aufrufe als unterbrochen. Call-IDs gehören
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
Agent-Extensions leben dagegen mit der AgentSession und dürfen keinen alten Turnzustand capturen.

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
`run-modules.md` beschrieben.

<!-- guide:runtime -->
## Modellkontext über mehrere Turns

Jeder LLM-Actor besitzt einen eigenen Gesprächskontext, der über mehrere Turns erhalten bleibt.
Ein neuer Input ergänzt dieses Gespräch. Im Serverbetrieb wird der Kontext separat gespeichert
und nach einem Neustart wieder geladen; ein neuer Actor beginnt mit seinem eigenen Kontext oder,
mit `forkOf` beim Spawn, mit einer Kopie des Kontexts eines anderen LLM-Actors dieses Runs.
Das Aktualisieren des Systemprompts ersetzt nicht den bisherigen Gesprächsverlauf.

Der programmierte Actor-Zustand speichert ausdrücklich gesetzte Daten für Funktionen und
Mini-Apps. Ein ersetzter Zustand wird vor Diff und Journal in JSON-Form gebracht: Schlüssel
mit `undefined` gelten als abwesend, im Speicher wie auf der Platte; eine Zustandsänderung
`set` ohne Wert bleibt ungültig. Das Journal hält die gemeinsamen Ereignisse des Runs fest und
liefert daraus die Chatansicht. Diese drei Formen von Zustand erfüllen unterschiedliche Aufgaben: Der sichtbare
Chat ist keine vollständige Kopie des aktuellen Modellkontexts, und ein neuer Turn bedeutet
nicht, dass das Modell ohne Gesprächsgedächtnis beginnt.
<!-- /guide:runtime -->

Der LLM-Actor besitzt genau eine `AgentSessionRuntime`, die beim ersten Turn geöffnet wird.
`AgentRuntimeManager` verwaltet diese Laufzeiten nach `runId + agentId`.

Vor jedem Prompt bindet ein stabiler Dispatcher den aktuellen Turn mit Toolset, Turn-ID,
Callbacks und `AbortSignal`. Danach wird diese Bindung gelöst. Damit hält eine langlebige Session
keine Closure auf einen alten Turn.

Ein ActorInput startet genau einen Turn. Weitere Inputs an einen LAUFENDEN Actor bleiben nach ihrer
Journal-Sequenz in der Queue und beginnen erst nach dessen Abschluss eigene Turns. Es gibt keine
Hintergrundzustellung in laufende Werkzeuge und kein Wake-State-Modell. Steering gibt es dagegen
sehr wohl: eine Nachricht während eines laufenden Tool-Calls bricht diesen nicht ab. Der Call
liefert sofort ein Zwischenergebnis, die Schleife macht mit dem nächsten LLM-Call weiter, der die
Nachricht sieht, und das echte Ergebnis wird als getaggte Steering-Nachricht nachgereicht
(gekappt bei 30000 Zeichen). Zustellung als Steering statt Follow-up, weil ein Follow-up im
Leerlauf keinen Lauf startet.

Die Zuordnung zur JSONL ist ausdrücklich in `active-session.json` mit Agenten-, Run- und
Agent-Session-ID gespeichert. Die frühere Auswahl nach der neuesten Dateizeit gibt es nicht mehr:
fehlt der Marker, entsteht eine neue Agent-Session.

Beiträge an die Agentenlaufzeit werden aus dem aktiven Profil geladen und über die offizielle API der Agentenlaufzeit gebunden. Beliebiger
TypeScript-Code aus `.agent/extensions` im Arbeitsrepository wird nicht automatisch ausgeführt.
Compaction und Retries der Agentenlaufzeit bleiben aktiv.

Die Agentenlaufzeit liegt in drei eigenen Paketen unter `packages/`:
`@aicontainer/ai` bindet OpenRouter über Vercel AI SDK Core (`ai`) und
`@openrouter/ai-sdk-provider` an. Ein Adapter übersetzt Nachrichten, Reasoning-Metadaten und
SDK-Streams in den bestehenden Laufzeitvertrag. Das SDK übernimmt HTTP, Providerformat,
SSE-Verarbeitung und Bilderzeugung; pro Anfrage erfolgt genau ein Modellschritt ohne
Werkzeugausführung durch das SDK. Werkzeugvalidierung, Werkzeugausführung und weitere
Modellschritte gehören der Agentenlaufzeit. Anfrage- und Antwort-Hooks arbeiten am tatsächlichen
HTTP-Vertrag, Abbruch und Zeitlimit gelten für den SDK-Aufruf; Transportwiederholungen sind
standardmäßig deaktiviert. Modellkatalog, Kontextbegrenzung, Cachemarkierungen und lokale
Kostenberechnung bleiben erhalten. Die Protokollkennung `openai-completions` gilt weiterhin
für Modellbeschreibungen und gespeicherte Sitzungen.
`@aicontainer/agent` enthält Werkzeuge und Session, `@aicontainer/agent-core` die Agentenschleife.
Diese beiden Pakete bleiben gegabelter Fremdcode; ein Rebase auf das Upstream-Projekt ist
aufgegeben. Sessions, Skills, Extensions, Compaction und innere Agentenschleife bleiben bestehen.
Das eigene Verhalten ist Teil dieses Kapitels:
`AgentSession.setSystemPrompt` setzt den Systemprompt einer langlebigen Session neu und erhält die
Unterhaltung. Aktualisierte Rollenregeln und kurze Initialhinweise werden so pro Turn wirksam;
ausdrücklich abgerufene Detailkapitel bleiben Gesprächsinhalte und werden nicht zusätzlich in
den Systemprompt übernommen. Denktiefe `off` sendet an OpenRouter die explizite Abschaltung
aus dem Modellkatalog, etwa `reasoning: { effort: "none" }`, oder ohne solches Mapping
`reasoning: { enabled: false }`. Vor jedem Turn prüft RAgents die gewählte Denktiefe gegen das
tatsächliche Modell der Agentensession. Eine nicht verfügbare Auswahl beendet den Turn mit
einer Fehlermeldung samt gültigen Stufen, bevor eine Modellanfrage gesendet wird; sie wird
nicht durch eine andere Denktiefe ersetzt. Modellkatalog und Werkzeugverträge erhalten auch die
erweiterten Stufen der Modelllaufzeit. Beim Erzeugen eines Agenten wird die endgültige Auswahl
gegen den Modellkatalog geprüft, einschließlich einer aus dem Profil geerbten Denktiefe nach
einem Modellwechsel. Ohne ausdrückliche Denktiefe oder Profilvorgabe verwendet die Session ihre
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

Steering während eines laufenden Werkzeugaufrufs lässt das Werkzeug weiterarbeiten. Der
Modellkontext bekommt zunächst ein Zwischenergebnis und die neue Nachricht; das tatsächliche
Ergebnis folgt als gekennzeichnete Steering-Nachricht, auf 30000 Zeichen begrenzt. Fehler
bleiben darin als Fehler markiert. Kommt das Ergebnis im Leerlauf an, wartet es auf den
nächsten Modellaufruf.

Die Dateibearbeitung nennt bei mehrdeutigen Treffern deren Zeilennummern und unterstützt
gezielte Vorkommen, eine nahe Zeile oder alle Vorkommen. Widersprüchliche Anker und gleich
nahe Treffer werden abgelehnt. Die Prüfung des zuletzt gelesenen Dateistands erfolgt innerhalb
derselben Mutationssperre wie das Schreiben, auch bei symbolischen Dateialiasen. Ein Abbruch
gibt diese Sperre erst frei, wenn eine bereits laufende Dateioperation beendet ist.

In jeder Laufzeit sind zwei interne Agent-Extensions aktiv:

- `ragents-turn-dispatcher` bindet den aktuellen RAgents-Turn und dessen Toolset an die langlebige
  AgentSession.
- `ragents-skill-preload` hängt ausgewählte Skill-Bodies über `before_agent_start` der Agentenlaufzeit nur an den
  Systemprompt des aktuellen Turns. Explizite Skillnamen werden deterministisch aufgelöst. Sonst
  klassifiziert ein kurzer Aufruf desselben ausgewählten Agent-Modells nur Aufgabe, Zielgruppe,
  Skillnamen und Beschreibungen. Er sieht keine Skill-Bodies und darf `ABSTAIN` liefern. Fehler
  blockieren den Hauptturn nicht, sondern lassen den normalen Skill-Katalog der Agentenlaufzeit unverändert.

Die Produktrolle stammt aus genau einer Policy des aktiven `ProductRuntime`: Der in
`primaryActorId` gewählte Actor ist `primary`, alle anderen ausführbaren Actors sind `worker`.
Dieselbe Entscheidung steuert Rollenvertrag und Skill-Auswahl. Das Vorladen erzeugt weder eine
zweite Agent-Session noch einen eigenen Agentenloop. Für `tools: []` lädt die Agentenlaufzeit weder Host-Werkzeuge noch
Skills oder Preloads.

<!-- guide:runtime -->
## Actor stoppen, Run stoppen und Server beenden

Die Stopppfade folgen demselben Grundsatz: zuerst neue Arbeit sperren, dann abbrechen, laufende
Arbeit abwarten und erst danach Ressourcen freigeben. Die konkrete Grenze ist verschieden:

In der Run-Titelleiste erreicht der Benutzer mit Schreibrecht den vollständigen Stopp über
"Lauf stoppen" und eine Bestätigung. Der Primary-Actor kann ihn mit `run_stop` ebenfalls
auslösen. Beide verwenden dieselbe Host-Stoppgrenze; Unterhaltung und Dateien bleiben erhalten.
Der Werkzeugaufruf leitet den Stopp ein, wartet aber nicht auf die Bereinigung seines eigenen
Turns. Seine Annahme ist kein Abschlussbeleg. Fehler der Bereinigung werden im Serverprotokoll
gemeldet; die normale Quarantäne des Stopppfads bleibt wirksam.

- `actor_stop`: Der Actor wird gestoppt, sein laufender Turn abgebrochen und seine Modelllaufzeit
  nach dem Turn entsorgt. Seine Actor-Nachkommen werden ebenfalls gestoppt.
  Run-Daten und Plugin-Sessions bleiben bestehen.
- Run-Stopp: Der Scheduler nimmt für diesen Run vorübergehend keine neue Arbeit auf;
  gleichzeitige Stopp-Aufrufe werden zusammen abgearbeitet. Der Primary-Actor bleibt erhalten,
  seine laufende Arbeit wird abgebrochen. Alle anderen Agenten und TypeScript-Actors im
  Besitzbaum des Benutzers werden gestoppt. Agentenlaufzeiten und Plugins erhalten parallel
  ihr Abbruchsignal. Das Actor-Programm-Plugin bricht dabei auch wartende App-Aktionen ab.
  Eine offene Bestätigungsfrage wird über `ragents.ask` im Journal verworfen und die
  Fachoperation nicht mehr aufgerufen. Der Run bleibt danach wiederverwendbar.
- Run-Löschung: Der Scheduler stoppt den Run. Danach werden seine
  Agentenlaufzeiten entsorgt und Plugin-Lösch-Hooks ausgeführt. Chat, Wiederherstellungsdaten und
  Journal werden archiviert; sessiongebundene Plugin-Daten einschließlich ihrer Protokolle werden
  anschließend entfernt.
- Server-Shutdown: Der Scheduler bricht laufende Arbeit ab und wartet sie ab.
  Danach werden alle Agentenlaufzeiten und Plugin-Dienste beendet. Persistierte Run-Daten bleiben
  erhalten.
<!-- /guide:runtime -->

Innerhalb der Scheduler-Sperre ermittelt der `RunStopper` aktive Nachkommen bis zu einem Fixpunkt.
Nach dem Abschluss des externen Scheduler-, Agent- und Plugin-Cleanups folgt ein zweiter
Fixpunkt-Pass. Er erfasst auch Kinder, die ein beim Stop bereits laufender Turn noch spät erzeugt
hat. Chat und Canvas verwenden dieselbe Stop-Operation.

Jeder Plugin-Stoppbeitrag erhält ein kooperatives `AbortSignal` und standardmäßig 15 Sekunden
Zeit. Bei Ablauf wird das Signal abgebrochen und der Beitrag als Fehler gesammelt; ein Promise
oder Fremdprozess, der das Signal ignoriert, wird dadurch nicht hart beendet. Die übrigen
Stop-Beiträge und Aufräumzweige laufen trotzdem weiter.
Run-Stopp, Plugin-Nachlauf und Server-Shutdown verwenden dieselbe Fehleraggregation:
verschachtelte AggregateErrors werden aufgelöst und identische Ursachen nur einmal gemeldet.
Eine einzelne Ursache wird direkt geworfen; mehrere stehen zusammen in einem AggregateError.

<!-- guide:runtime -->
Nach dem Ende der laufenden Actor-Arbeit und der ersten Plugin-Bereinigung räumt der Host
verbleibende Ressourcen auf. Der Run bleibt bis zum erfolgreichen Abschluss dieser Bereinigung
gesperrt; Fehler werden gemeldet und geben ihn nicht vorzeitig frei.
<!-- /guide:runtime -->

Die Nachlaufbeiträge unter `afterStopSession` erhalten ein Abbruchsignal mit Zeitgrenze.
Die getrennte Nachlaufphase erlaubt beispielsweise, erst spät
erzeugte Prozesse aufzuräumen. Eine Löschung wartet auch noch ausstehende Nachlaufbeiträge ab.
Die Stop-Antwort wartet auf die abschließende Bereinigung und meldet auch deren Fehler oder
Plugin-Zeitüberschreitung. Für den gesamten Nachlauf gilt nach dem frühen Stopp eine zusätzliche
Antwortfrist von 15 Sekunden. Überschreitet etwa ein Treiber diese Frist, endet die Anfrage mit
einem Fehler; die Bereinigung und Sperre bleiben bis zum tatsächlichen Abschluss bestehen.
Ein erneuter Stopp wartet auch nach einer fehlgeschlagenen Bereinigung alle aktuellen
Treibernachläufe ab, bevor er die abschließenden Plugin-Beiträge wiederholt.
<!-- guide:runtime -->
Während dieser Sperre angenommene Inputs des weiterhin aktiven Primary-Actors werden nach
erfolgreicher Freigabe automatisch verarbeitet. Der Scheduler prüft dazu erneut die noch
offenen Inputs; bereits beanspruchte oder verworfene Inputs werden nicht wiederholt.
<!-- /guide:runtime -->

Eine Run-Löschung wird vor dem ersten irreversiblen Schritt dauerhaft markiert. Mit dieser
Markierung ist die Löschanfrage beantwortet (`202`) und der Run aus der Liste verschwunden; das
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
## Actors, Inputs, Events und Subscriptions

`actor_input` stellt Text und optionale Artefakte direkt an genau einen ausführbaren Actor. Der
Driver erhält den Inhalt ohne Routing-Umschlag. Es gibt keine Channels, Message-Domain,
Read-Receipts, Mention-Grammatik oder besondere Result-/Deliver-Nachricht. Kommunikation ist
normaler Text. Der Absender kann ein menschlicher Owner, ein anderer Actor oder die
Subscription-Zustellung sein. Normale Modellantworten benötigen kein Versandwerkzeug: jede
abgeschlossene Ausgabe ist bereits ein `model.output.completed`-Event.

Ein erfolgreiches `actor_input` bestätigt nur das Einreihen. LLM-Actors interpretieren freie
Aufträge; TypeScript-Actors verarbeiten ausschließlich ihr programmiertes Eingabeprotokoll.
Actorliste, Turn-Kontext und Funktionsbeschreibung erklären diesen Unterschied. Ein
Primary-Actor ist das Standardziel eines Runs und nicht automatisch ein Chatpartner.
Programmierte Eingaben und Subscriptions bleiben unabhängig von den engeren Chat-Routen möglich.

Modelltext, Reasoning, Runtime-Ausgabe, Tool-Starts, Tool-Ergebnisse, Turn-Abschlüsse, Actions,
Artefakte und Stopps sind eigene Journal-Events. `event_subscribe` filtert ausschließlich
strukturiert nach Quell-Actor-IDs, Quell-Actor-Arten, Eventtypen und optional dem Subscriber selbst.
Passende NEUE Events werden als neue Inputs zugestellt. Der Subscriber kann sie auswerten,
verdichten und mit `actor_input` als natürlichen Text an LLM-Actors oder als passende Programmeingabe an TypeScript-Actors weitergeben. So ist ein
Vermittler nur ein gewöhnlicher Actor mit passenden Werkzeugen; die vermittelten LLMs müssen ihn
oder RAgents nicht kennen. `event_query` liest Historie, löst aber keine Zustellung aus.

WECK-GARANTIE: Es gibt keine Warte-Werkzeuge, ein beendeter Turn wartet auf nichts. Wer einen
Actor per Prompt auffordert, seinen Turn zu beenden und auf Weckung zu warten, muss ihn
garantiert wecken. Der steuernde Actor ist dafür ein TypeScript-Actor oder ein Hostdienst, der
das Turn-Ende seines Arbeiters abonniert (`event_subscribe` auf `turn.finished` und
`turn.interrupted` oder die Journalbeobachtung des Hosts) und bei jedem Ende entscheidet, ob
der Arbeiter fertig ist, auf einen anderen wartet oder den nächsten Anstoß braucht; ein
LLM-Koordinator, der "passiv wartet", ist keine Weckung. Ein Wächter aus `ragents.watch`
(`plugins.md`) ist ein solcher Hostdienst: er weckt den steuernden Actor mit Grund und Änderungen,
sobald seine Weckbedingung greift. Eine Anleitung darf nur dort "beende
den Turn" sagen, wo ein solcher Beobachter existiert; synchrone Funktionen kehren mit dem
Ergebnis zurück, und der Aufrufer fährt im selben Turn fort.
<!-- /guide:runtime -->

Weist die Agentenschleife einen Werkzeugaufruf ab, bevor er läuft (Schemaverstoß, unbekannter
Name, blockiert), steht der Fehlversuch trotzdem im Journal: der Turn-Dispatcher merkt sich bei
`tool_execution_start` jeden verwalteten Aufruf mit Name und Eingabe, streicht ihn, sobald das
Werkzeug wirklich ausgeführt wird, und schreibt bei einem Fehlerabschluss ohne Ausführung das Paar
`tool.call.started` und `tool.call.failed` mit dem vollen Fehlertext. Der Vermerk gilt nur
innerhalb eines Turns; im Chat erscheint der Fehlversuch wie jeder andere gescheiterte Aufruf.

Ein Werkzeugergebnis wiederholt nie, was das Modell selbst geschrieben hat. Die eine
Redaktionsstelle ist `toolResultEventOf` in `packages/ragents/src/agents/actor-input.ts`: sie
streicht aus jeder Event-Payload auf dem Weg zum Modell rekursiv die Hash-Schlüssel und die
wörtlichen Eingabe-Echos (`prompt`, `source`, `execution`, `content`, `state`). Journal,
`event_query` und die RunView fürs Web bleiben vollständig.

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

Hat ein LLM-Actor tatsächlich Zugriff auf `actor_list`, ergänzt der Scheduler seinen Systemprompt
zu jedem Turn um den aktuellen Actorbestand: Handles, Anzeigenamen, Art und Lifecycle sowie die
Markierungen für ihn selbst und den primären Actor. Das schließt Beteiligte aus Run-Setups und
von anderen Erzeugern ein; fremde Systemprompts werden nicht eingeblendet. Während eines Turns
aktualisiert `actor_list` den Bestand. Ohne dieses Werkzeug, insbesondere bei `tools: []`,
entfällt die Übersicht.

Ein `artifact.published`-Event gewährt allein keinen Inhaltszugriff. Den Inhalt lesen dürfen der
Run-Owner, der Erzeuger und ein Actor, dem das Artefakt ausdrücklich mit einem ActorInput
zugewiesen wurde.

Chat-Anhänge werden als binäre Artefakte gespeichert und dem ActorInput über `artifactIds`
zugewiesen. Das Run-Journal enthält Metadaten und Referenzen, keine Base64-Dateiinhalte. Der
Agent-Treiber liest die zugewiesenen Bytes und übergibt Bilder, Videos und native PDFs als
Medieninhalte an die Modelllaufzeit. UTF-8-Textdateien ergänzen den Eingabetext, andere Dateien
werden im Arbeitsverzeichnis des Actors für seine Dateiwerkzeuge bereitgestellt. Der Treiber
prüft die nötigen Modell- und Werkzeugfähigkeiten auch bei Zustellung außerhalb der Chat-API.
Die private Agent-Session erhält die Medieninhalte für spätere Modellaufrufe; die Run-Projektion
liefert stattdessen Downloadmetadaten für den Chat-Verlauf.

Besitz folgt ausschließlich `createdBy` und wird nur für Stopprechte und rekursive Stopps benutzt.
`primaryActorId` ist eine getrennte explizite Auswahl. Der Core leitet aus dem Besitz weder Routing
noch Sichtbarkeit ab.
Der Host erkennt seinen Run-Koordinator am bestehenden journalisierten Erzeugungsbefehl, auch
nach Forks. Produkt- und Aufbauprompt sowie Koordinator-Skills bleiben bei diesem Actor.
Ein zum Primary gewählter Fachagent behält seinen Fachprompt und seine Agenten-Beiträge;
die Primary-Auswahl bestimmt weiterhin Chatprojektion und Ausgabevertrag.

<!-- guide:runtime -->
## ID, Handle und erneutes Anlegen

Ein Actor besitzt eine technische ID und einen lesbaren Handle wie `@worker`. Ein bereits
vergebener Handle bleibt im Run auch nach dem Stopp erhalten. Wird ein weiterer LLM-Agent mit
demselben Wunschnamen angelegt, erhält er einen freien Suffix, etwa `worker-1`.
`agent_spawn` liefert `{ id, handle }` des tatsächlich erzeugten Actors; Folgeaufrufe verwenden
diese Referenz. Ein gleicher Wunschname verwendet keinen bestehenden Actor automatisch weiter.

Das Wiederstarten setzt denselben gestoppten Actor fort. Für TypeScript-Actors wird ein bereits
belegter Handle bei der Erstellung abgewiesen. Die Erzeugung selbst bleibt als Event im Journal.
<!-- /guide:runtime -->

<!-- guide:runtime -->
## Subagenten ausstatten

`agent_spawn` verlangt eine ausdrückliche Funktionsauswahl unter `tools`:

| Auswahl                              | Ausstattung                                                        |
| ------------------------------------ | ------------------------------------------------------------------ |
| `[]`                                 | Reines LLM ohne Runtime-, Workspace- oder Host-Werkzeuge.            |
| `["read", "write", "edit", "bash"]`   | Genau diese Funktionen, etwa für einen Coding-Agenten.              |
| `null`                               | Vollständiges dynamisches Angebot einschließlich späterer Zugänge. |

Fehlende Auswahl und unbekannte Namen werden vor dem Spawn abgewiesen. Die Auswahl wird nicht
vererbt; delegierbare Engine-Capabilities werden weiterhin übernommen. `withoutCapabilities`
entfernt benannte technische Rechte. Auch bei `null` gelten Verfügbarkeit und Grants.
`forkOf` (Handle oder ID) macht den neuen Agenten zum Fork eines LLM-Agenten desselben Runs:
`agent.spawned` hält die Quelle fest, und beim ersten Turn des neuen Agenten kopiert der
Agent-Treiber den bis dahin gespeicherten Kontextzweig der Quelle in dessen eigene Kontextdatei.
Die Kopie endet vor dem ersten unbeantworteten Werkzeugaufruf der Quelle und enthält keine
Reasoning-Blöcke; Systemprompt, Werkzeuge und Modell kommen vom neuen Agenten. Spätere Turns
der Quelle fließen nicht nach. Quelle und Fork brauchen den Agent-Treiber; eine Quelle ohne
gespeicherten Kontext ist ein harter Fehler beim ersten Turn des Forks.
Ein reines LLM erhält keine Funktionsübersicht; sein Treiber muss diese Isolation ausdrücklich
unterstützen, sonst wird der Turn hart abgewiesen.

Ausgerüstete LLMs erhalten `typescript_api` und `typescript_eval` sowie eine automatische
Übersicht ihrer verfügbaren TypeScript-Funktionen mit Name und Kurzbeschreibung. Die Übersicht
bleibt auch im laufenden Turn aktuell. Fachfunktionen verwenden sie über `context.functions`
in Snippets. Native Zusatzwerkzeuge brauchen eine ausdrückliche Registrierung.
Rollen und Arbeitsgrenzen bleiben Anweisungen im Prompt. Neben dem Profil nimmt `agent_spawn`
`model` und `thinking` aus der Modellliste an; ein Profil liefert nur Treiber, Provider,
Denktiefe, Timeout und Workspace-Vorgabe, welche Modelle zur Wahl stehen, sagt die Modellliste
des Produkts. Fehlen beim Agent-Start sowohl Modell als auch ein modelltragendes Profil, nennt
der Fehler die vorhandenen Profile des gewählten Treibers. Ein manuelles Profil wird dabei
nicht als Modellwahl für einen Agenten vorgeschlagen.
<!-- /guide:runtime -->

Werkzeugbeschreibung, Feldbeschreibungen und Orchestrierungsprompt verlangen die ausdrückliche
Profil- oder Modellwahl für jeden LLM-Spawn und erklären, dass das Modell des Aufrufers nicht
vererbt wird. Die Felder bleiben einzeln optional, weil ein Profil das Modell liefern kann und
manuelle beziehungsweise Script-Treiber kein Modell benötigen. Fehlende Auswahl bleibt ein
harter Fehler; es gibt keine automatische Wahl eines Standardprofils.

Der Orchestrierungsprompt verlangt vor einer Neuanlage die Bestandsprüfung mit `actor_list`.
Passende vorhandene Beteiligte erhalten neue Aufgaben über `actor_input`; nur fehlende Rollen
oder bewusst getrennte Kontexte brauchen einen neuen Actor. Das ist eine Arbeitsanweisung,
keine Namens-Deduplizierung: `agent_spawn` erzeugt weiterhin einen neuen Actor und vergibt bei
belegtem Handle einen freien Suffix. Die Laufzeit leitet aus gleichen Namen keine gleiche Rolle ab.

Den Run selbst konfiguriert `run_configure` unter der Capability `run.configure`: `title`
schreibt das Ereignis `run.title-changed`, `primaryActor` wählt einen aktiven Agenten oder
Script-Actor als Primary-Actor (`run.primary-actor-selected`); beides zusammen ist erlaubt, keins
von beiden ein benannter Fehler. Der Besitzer des Runs konfiguriert von Rechts wegen, jeder andere
Actor braucht den Grant; die Journal-Semantik prüft dasselbe beim Laden. Besitzer und Koordinator
halten alle zehn Capability-Namen aus `domain/vocabulary.ts`. Wechselt der Primary-Actor, bindet
sich der Chat neu an ihn. Ein Run-Script (`typescript-platform.md`) nutzt genau das, wenn es
ohne Koordinator startet.

Automatisch verdichtete Listentitel sind dagegen Metadaten des Hosts außerhalb des Journals.
Sie ändern `RunState.title` nicht. Ein ausdrücklich über `run_configure` oder ein Setup
gewählter Titel hat in der Oberfläche Vorrang. Modellwahl und Erzeugung beschreibt
`profiles.md`, die Aktualisierung der Run-Liste `plugins.md`.

## Übergeordneter Koordinator

Seine Modellauswahl liegt dauerhaft in der profilbezogenen Plugin-Ablage. Die Settings-API
prüft Modell und Reasoning gegen den konfigurierten Katalog und die Modelllaufzeit. Ein
Modellwechsel darf die bereits zugestellten Medien nicht unlesbar machen; ein inkompatibles
Modell wird vor dem Speichern abgewiesen. Die Agent-Session und ihr Gespräch bleiben erhalten.
Nach dem Claim eines Turns übernimmt der Scheduler synchron die aktuelle Modellauswahl;
die Plugin-Policy hält sie mit Turn-Bezug als `plugin.state-replaced` fest. Ein schon
gestarteter Turn behält seine Auswahl. `Actor.execution` beschreibt weiterhin die
Startkonfiguration; die tatsächliche Auswahl des übergeordneten Koordinators steht pro Turn
in dessen Plugin-Ereignis. Gewöhnliche Actors verwenden ihre konfigurierte Ausführung.

Das Plugin `ragents.overseer` stellt eine eigene, dauerhafte Unterhaltung unter der reservierten
Run-ID `overseer` bereit. Sie verwendet dieselben Chat-Routen, Agentenlaufzeit, Journal- und
Stop-Grenzen wie andere Unterhaltungen. Erst die erste Nachricht legt den Run an; nach einem
Neustart bleiben Chat und Modellkontext erhalten. Die normale Unterhaltungsliste blendet ihn aus,
eine Löschung wird mit HTTP 409 abgewiesen. Die Ablage gehört wie alle Runs zum Datenverzeichnis
des gestarteten Profils.

Jede aus der Oberfläche gesendete globale Nachricht führt einen kompakten Standort zum
Absendezeitpunkt mit: Startansicht, Run-Übersicht oder geöffneter Run, aktiver Bereich
und Reiter sowie ein ausgewähltes Element. Der Browser sendet nur kleine Kennungen. Der Server
löst den Run-Titel, die vorhandene kurze Laufreferenz und gegebenenfalls den Actor-Namen auf.
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
Tool-Argumente entsprechen in beiden Ansichten dem journalisierten JSON, auch bei `null`.
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

Die Overseer-Extension bietet einen ausdrücklich bestätigten Gesprächsreset. Der Host sperrt
währenddessen neue globale Eingaben, beendet den globalen Lauf und wartet dessen tatsächliche
Laufzeitbereinigung ab, einschließlich einer bereits begonnenen Stopp-Bereinigung. Danach entfernt
er nur dessen Journal, private Modell-Session und Arbeitsablage. Das bestehende Chat-Sessionobjekt
meldet den Reset an seine Streams; die nächste Nachricht beginnt einen frischen Run unter der
reservierten Kennung. Modellwahl, Run-Referenzen und andere Runs bleiben erhalten. Ein vor der
Löschung dauerhaft gespeicherter Reset-Marker lässt einen begonnenen Reset nach Prozessabbruch
beim nächsten Start fertig werden. Bis zum Abschluss oder einem erfolgreichen Wiederholungsversuch
bleiben neue globale Eingaben gesperrt. Einen automatischen kontextabhängigen Reset gibt es nicht.
Ein nachlaufender Scheduler-Scan überspringt ein inzwischen entferntes Journal. Wird der Run
unter derselben Kennung neu angelegt, wird seine neue Arbeit wieder regulär geplant.

Der Produkthost bindet den vom Plugin gelieferten globalen Chat-Vertrag: eigener Prompt,
Werkzeugauswahl und ein kleines Arbeitsverzeichnis in der Plugin-Ablage. Der übergeordnete
Koordinator verwendet zunächst das Standardmodell des Produktprofils, aber keine Produktprompts,
Produkt-Skills, Agent-Extensions oder Vorbereitung eines Produktarbeitsverzeichnisses.
Seine native Oberfläche enthält `typescript_api`, `typescript_eval` und die freigegebenen
Datei-/Shellwerkzeuge `read`, `write`, `edit` und `bash`. Einzelne Arbeitsaktionen laufen direkt;
`quick_answer` für eine ergänzende Kurzantwort und zusammengesetzte Aufrufe verwenden
dieselbe `context.functions`-API wie normale Runs. Die beiden
TypeScript-Werkzeuge gehören zur Server-Grundausstattung und benötigen kein Actor-Programm-Plugin.
Nur sein Arbeitsbereich erhält zusätzlich lesenden Dateizugriff auf den Journalordner des
Profils. `write` und `edit` dürfen dort nicht schreiben. Die Host-Shell ist keine zusätzliche
Dateisystem-Sandbox; ihre Arbeitsanweisung verlangt, Laufzeitdaten ausschließlich über die
Nachrichtenschicht zu ändern. Normale Runs erhalten weder diese zusätzlichen Lesewurzeln noch den API-Zugang.

`quick_answer` steht ausschließlich dem globalen Primary-Agenten mit `plugin.state.write`
zur Verfügung. Es übernimmt die kurze Wiederholung der aktuellen Nutzerfrage als `question`
und die kurze Antwort als `text`. Beide Felder werden außen getrimmt und müssen jeweils
nichtleer, ohne Zeilenumbrüche und höchstens 240 UTF-16-Zeichen lang sein. Die Promptanweisung
verlangt zuerst die vollständige normale Chatantwort und danach Frage und Ergebniszusammenfassung;
nach erfolgreichem Aufruf wird keine weitere inhaltliche Antwort oder Bestätigung angehängt.
Das Werkzeug ersetzt den Run-Zustand der Overseer-Extension durch eine Kurzantwort mit beiden Feldern. Die
journalisierte Änderung erscheint im vorhandenen Extension-Stream als `state-replaced` mit
Gesprächsidentität, Event-ID und Journal-Sequenz. Der Zustand und der Ereignisvertrag stehen
im Code; für die Kurzantwort entsteht kein eigener Zustellkanal.

Der globale Koordinator teilt seinen Grundprompt mit der eigenständigen Vorbereitungsrolle
für neue Skill-Aufträge. Deren speicherinterne Agent-Session hat ein eigenes Gespräch und
ausschließlich die Startfunktion für den besprochenen Auftrag. Sie übernimmt weder den
globalen Verlauf noch dessen Verwaltungszugriffe. Ein sinngemäßes Go des Benutzers erlaubt
die Übergabe an den normalen Run-Start; Vertrag und Lebenszyklus stehen in `plugins.md`.

Das Plugin stellt dieselben Verwaltungsmethoden für externe Clients und den globalen Koordinator
bereit. Sie kann vorhandene Runs auflisten, ihre Zustände und Journale seitenweise lesen,
ihren primären Actor beauftragen, sie stoppen und neue Läufe erstellen. Eindeutige Titel,
Run-IDs und kurze Referenzen wie `Lauf 1` werden serverseitig aufgelöst. Ein eigener Index in
der Plugin-Ablage erhält die Referenzen auch nach Sortierung, Löschung und Neustart.
Mehrdeutige Titel werden mit den gültigen Referenzen abgewiesen. Neue Run-IDs erzeugt der
Server. Archivierte und gelöschte Läufe sind nicht Teil dieses Zugriffs.

Neue Läufe starten mit einer Nachricht, einem installierten Run-Script oder einem lokalen
Run-Script-Paket über dessen absoluten Serverdateipfad. Lokale Pakete verwenden dasselbe
Format und denselben Loader wie installierte Einstiege. Startoptionen-Validierung,
Workspace-Vorbereitung, Check, Test und Installation bleiben der normale Startpfad.
Der globale Koordinator kann vorbereitete Pakete starten. Der Run-Koordinator verwendet im
vorhandenen Run TypeScript-Snippets für einmalige Arbeit und Aufbau, oder Actor-Programme
für dauerhaften Zustand, spätere Nachrichten und Views. Fachliche Aufträge bestimmen das
Ergebnis; die technische Umsetzung wählt das Modell anhand der verfügbaren API.
Aufbaureihenfolge und Wiederholungsgrenzen stehen in `typescript-platform.md`.
Der Erstellungsaufruf wartet auf dessen Abschluss; erfolgreiche Annahme bedeutet noch nicht,
dass der erste Turn ausgeführt wurde. Ein Katalog beschreibt die installierten Einstiege
und gültigen Startoptionen des tatsächlich gestarteten Profils.

Anfrageprüfung, Dispatch, OpenRPC und Markdownreferenz verwenden dieselben ausführbaren
Verträge der Nachrichtenschicht. Die Referenz wird beim Vorbereiten des globalen
Arbeitsbereichs aus dem Code erzeugt und nach einem Gesprächsreset erneut bereitgestellt.
Der Systemprompt enthält einen kompakten, ebenfalls generierten Überblick über diese
Methoden einschließlich ihrer Benutzerrechte. Dazu kommen Namen und Kurzbeschreibungen
regulärer Run-Bausteine aus den Engine-Deskriptoren und den öffentlichen Werkzeugdeskriptoren
der tatsächlich registrierten Plugins und Agent-Extensions. Dadurch sind etwa die installierten
Canvas- und Actor-Programm-Fähigkeiten bereits vor dem ersten Referenzzugriff bekannt. Der Prompt
wird erst beim Lesen aus dem vollständigen Registrierungsstand zusammengesetzt; die Erzeugung
löst keine Werkzeugfabriken aus und liest weder Konfigurationswerte noch interne Serviceoperationen.
Dieser Katalog erweitert nicht die feste Werkzeugauswahl des globalen Chats und erteilt keine Rechte:
Run-Aufrufe bleiben an Actor, Grants, deklarierte Script-Teilmenge und Laufkontext gebunden.
Genaue Schemas und Codebeispiele lädt der Koordinator bei Bedarf aus der Referenz. Die öffentliche
Hilfe beschreibt core; der Prompt kennzeichnet den Unterschied zum aktiven Profilbestand.
Die Shell erhält Host-Ursprung, Journalordner und bei aktiviertem Zugangsschutz den Bearer-Token als
Umgebungsvariablen; der Tokenwert erscheint weder im Prompt noch in der Referenz.

Die Werkzeugauswahl gehört zur journalisierten Actor-Identität. Ein vorhandener globaler Run
mit einer vom aktuellen Plugin abweichenden Werkzeugauswahl wird beim Senden mit
`global-tools-changed` abgewiesen. Ein ausdrücklicher Gesprächsreset übernimmt mit dem nächsten
Gespräch die aktuelle Auswahl und Promptanweisung. Öffnen und Zurücksetzen bleiben möglich;
eine automatische Journalmigration findet nicht statt.

<!-- guide:runtime -->
## Journal und Projektion

Das Journal ist die gemeinsame Historie eines Runs. Der sichtbare Zustand entsteht durch
Wiedergabe seiner Ereignisse; dabei werden weder Modelle noch Werkzeuge erneut aufgerufen.
Aufgezeichnete Antworten, Funktionsaufrufe, Zustandsänderungen und Abbrüche bleiben dadurch
auch nach einem Neustart nachvollziehbar. Arbeitsdateien und der private Modellkontext liegen
zusätzlich außerhalb des Journals.
<!-- /guide:runtime -->

Jeder Run besitzt eine lesbare `journal.jsonl` im Dateiformat v4 und bei großen Inhalten einen
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

Das Journal akzeptiert ausschließlich Dateiformat 4 und internes Eventschema 3. Alte
Dateiformate werden ohne automatische Migration für den betroffenen Run abgewiesen.
Jeder Run wird zunächst vollständig geprüft und projiziert, bevor seine Events, Kennungen
und Zustände in die gemeinsame Laufzeit übernommen werden. Ein altes Format, beschädigtes JSON,
ein ungültiges Event, ein semantischer Widerspruch, ein unlesbares Journal oder eine fehlende
Inhaltsdatei isoliert nur diesen Run. Die übrigen Runs und der Server starten weiter.
Der Fehler enthält Run-ID, Dateipfad und Ursache und wird protokolliert. `loadFailures` und
`failureOf` liefern die Diagnose; lesende und schreibende Run-Zugriffe melden
`journal-unavailable` mit HTTP 409. Isolierte Runs erscheinen nicht in der Liste nutzbarer
Unterhaltungen, erhalten keine Arbeitsverzeichnisse oder Scheduler-Ausführung und können nicht
unter derselben ID versehentlich neu angelegt werden. Das gilt auch für den globalen Koordinator.
Sein ausdrücklicher Gesprächsreset kann die gesperrte ID nach Entfernen der alten Dateien freigeben.

Die Originaldateien eines abgewiesenen Runs bleiben bytegleich. Eine abgerissene letzte Zeile
wird erst nach erfolgreicher Prüfung aller vollständigen v4-Records repariert. Ein leeres oder
nicht erkennbares Journal wird nicht zu einer neuen Unterhaltung umgedeutet. Fehler an der
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
