# Actors und Nachrichten

Runs, Actors, Nachrichten, Turns und Journal bilden die gemeinsame Laufzeit.

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

Nach dem Ende der laufenden Actor-Arbeit und der ersten Plugin-Bereinigung räumt der Host
verbleibende Ressourcen auf. Der Run bleibt bis zum erfolgreichen Abschluss dieser Bereinigung
gesperrt; Fehler werden gemeldet und geben ihn nicht vorzeitig frei.

Während dieser Sperre angenommene Inputs des weiterhin aktiven Primary-Actors werden nach
erfolgreicher Freigabe automatisch verarbeitet. Der Scheduler prüft dazu erneut die noch
offenen Inputs; bereits beanspruchte oder verworfene Inputs werden nicht wiederholt.

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

## ID, Handle und erneutes Anlegen

Ein Actor besitzt eine technische ID und einen lesbaren Handle wie `@worker`. Ein bereits
vergebener Handle bleibt im Run auch nach dem Stopp erhalten. Wird ein weiterer LLM-Agent mit
demselben Wunschnamen angelegt, erhält er einen freien Suffix, etwa `worker-1`.
`agent_spawn` liefert `{ id, handle }` des tatsächlich erzeugten Actors; Folgeaufrufe verwenden
diese Referenz. Ein gleicher Wunschname verwendet keinen bestehenden Actor automatisch weiter.

Das Wiederstarten setzt denselben gestoppten Actor fort. Für TypeScript-Actors wird ein bereits
belegter Handle bei der Erstellung abgewiesen. Die Erzeugung selbst bleibt als Event im Journal.

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

## Journal und Projektion

Das Journal ist die gemeinsame Historie eines Runs. Der sichtbare Zustand entsteht durch
Wiedergabe seiner Ereignisse; dabei werden weder Modelle noch Werkzeuge erneut aufgerufen.
Aufgezeichnete Antworten, Funktionsaufrufe, Zustandsänderungen und Abbrüche bleiben dadurch
auch nach einem Neustart nachvollziehbar. Arbeitsdateien und der private Modellkontext liegen
zusätzlich außerhalb des Journals.
