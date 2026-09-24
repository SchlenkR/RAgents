# Selbsttest-Katalog

Testfälle für die autonome Selbstverbesserungs-Schleife. Jeder Fall hat eine Idee, zwei
Prompts in dieselbe Richtung (A = detailliert, aber nicht-technisch, wie ein Benutzer
schreibt; B = sehr einfach), eine Erwartungshaltung und die Begründung, warum die Idee gut
ist. Die beiden Varianten prüfen nebenbei die Hypothese: kleine, spezifische Prompts
funktionieren besser als große.

Rahmen: Profil core, Koordinator-Modell aus der Profilkonfiguration, isolierter Workspace je
Unterhaltung mit Zugriff auf die hineingelegten Unterlagen. Ein Testagent fährt beide Prompts als
GETRENNTE Unterhaltungen.

## T01 Zwei-Agenten-Interview

Idee: Der Koordinator soll zwei Agenten erzeugen, die einander zuarbeiten (Interviewer und
Experte), und das Ergebnis zusammenfassen.

Prompt A: "Ich möchte ein kurzes Interview lesen. Bitte richte zwei Gesprächspartner ein:
einen neugierigen Interviewer und einen Experten für Zeitreihen in der Gebäudetechnik. Der
Interviewer stellt nacheinander drei Fragen, der Experte antwortet jeweils kurz. Am Ende
fasst du mir das Gespräch in fünf Sätzen zusammen."

Prompt B: "Lass zwei Agenten ein kurzes Interview über Zeitreihen führen und fasse es
zusammen."

Erwartung: Zwei Agenten werden erzeugt (agent_spawn), Inputs laufen über actor_input, es
gibt mindestens drei Frage-Antwort-Paare, am Ende eine Zusammenfassung im Chat. Kein
Endlos-Pingpong, Abschluss in unter 8 Minuten.

Warum gut: Der Kern des Produkts (Mehragenten-Orchestrierung) im kleinsten sinnvollen
Zuschnitt; prüft spawn, Input-Routing, Turn-Wechsel und Abschlussdisziplin.

## T02 Stern mit Vermittler light

Idee: Zwei reine LLMs ohne Runtime-Wissen, ein Vermittler-Actor reicht Text weiter.

Prompt A: "Bitte baue folgendes Experiment: Anna und Ben sind zwei einfache Gesprächspartner,
die nichts von ihrer Umgebung wissen. Ein Postbote leitet Annas erste Nachricht an Ben
weiter und bringt mir Bens Antwort. Anna soll Ben nach seinem Lieblingsbuch fragen. Zeig
mir am Ende Bens Antwort."

Prompt B: "Anna fragt Ben über einen Postboten nach seinem Lieblingsbuch. Zeig mir die
Antwort."

Erwartung: Anna und Ben werden mit leerer Werkzeugliste erzeugt, der Vermittler abonniert
Modell-Ausgaben (event_subscribe) und routet per actor_input; Bens Antwort erscheint im
Chat. Keine Werkzeuge bei Anna/Ben.

Warum gut: Prüft das Subscription-Modell und Plain-LLM-Isolation, den Referenzfall der
Plattform, mit einem alltagstauglichen Prompt statt Fachsprache.

## T03 To-do-Führung bei mehrschrittiger Arbeit

Idee: Bei einer mehrteiligen Aufgabe soll der Koordinator die To-do-Liste des Laufs führen
und abarbeiten.

Prompt A: "Ich brauche drei Dinge nacheinander: erstens eine Liste von fünf typischen
Datenqualitätsproblemen bei Messwerten, zweitens zu jedem Problem einen kurzen
Prüfvorschlag, drittens eine Empfehlung, womit man anfangen sollte. Bitte lege dir dafür
eine Aufgabenliste an und arbeite sie sichtbar ab."

Prompt B: "Erledige der Reihe nach: 5 Datenqualitätsprobleme nennen, je einen Prüftipp,
eine Startempfehlung. Führe dabei eine Aufgabenliste."

Erwartung: todo_replace wird benutzt, die Liste hat 3 Einträge, Häkchen wandern während
der Arbeit (mehrere plugin.state-replaced für ragents.todo), alle drei Inhalte kommen.

Warum gut: Prüft, ob das Modell Werkzeuge zur Selbstorganisation wirklich benutzt statt
nur zu antworten; direkt relevant für den geplanten Feature-Workflow.

## T04 Rückfrage statt Raten

Idee: Bei einem mehrdeutigen Auftrag soll der Koordinator eine echte Rückfrage stellen
(Frage-Karte), nicht einfach losraten.

Prompt A: "Bitte bereite die Auswertung für das Gebäude vor, so wie beim letzten Mal, aber
diesmal mit den neuen Zahlen. Du weißt schon, welche ich meine."

Prompt B: "Mach die Auswertung wie letztes Mal, nur mit den neuen Zahlen."

Erwartung: ask_user wird aufgerufen (action.proposed im Journal), der Lauf wartet auf die
Antwort statt Inhalte zu erfinden. Keine ausgedachten Zahlen oder Gebäude.

Warum gut: Keine-stillen-Fallbacks als Verhaltensregel; prüft, ob das Frage-Werkzeug im
richtigen Moment gezogen wird - eine der teuersten Fehlerklassen im Alltag.

## T05 Dokument in der Ablage

Idee: Ein Arbeitsergebnis soll als Dokument in der Dateiablage des Laufs landen und im
Chat gezeigt werden.

Prompt A: "Schreibe mir eine einseitige, verständliche Erklärung, was ein Ringpuffer ist
und wofür man ihn benutzt. Lege sie als Dokument ab, damit ich sie später wiederfinde,
und zeig sie mir."

Prompt B: "Erkläre Ringpuffer auf einer Seite und lege das als Dokument ab."

Erwartung: Eine Datei entsteht in der Run-Dateiablage (Dokumente-Tab), show_document oder
Artefakt-Anzeige wird benutzt, der Inhalt ist fachlich brauchbar.

Warum gut: Prüft den Dokumente-Pfad Ende-zu-Ende (Dateiablage, Anzeige) mit einem
realistischen Wissensarbeits-Auftrag.

## T06 Actor-Funktion mit React-View

Idee: TypeScript-Funktionen, Zustand und eine React-View als ein Actor-Programm erstellen.

Prompt A: "Bau einen kleinen Textanalysten mit Eingabefeld. Er soll Wörter und Zeilen selbst
zählen und den letzten Text behalten. Dafür braucht er keine KI-Antwort. Prüfe zwei Zeilen
mit insgesamt sechs Wörtern und lass mich danach selbst einen Text eingeben."

Prompt B: "Bau mit der Vorlage text-analysis einen Textanalysten mit bedienbarer Oberfläche."

Erwartung: actor_program_create, normale Dateiwerkzeuge und TypeScript-Diagnostik führen zu
einem mit actor_program_activate aktivierten Paket. Die Fachtests prüfen Zählung und Zustand;
der Browser zeigt das Ergebnis echter Bedienung. Derselbe Actor besitzt Funktion und View.
Keine separaten Build-Referenzen oder Testargumente als JSON im Modellkontext.

Warum gut: Prüft normale TypeScript-Dateien, Diagnosen, Fachtests, Actor-Zustand und die
sichtbare Bedienung ohne zusätzlichen Modell-Turn pro Funktionsaufruf.

## T07 Funktion eines LLM-Actors als Werkzeug

Idee: Ein kleines TypeScript-Werkzeug bauen, einem erzeugten Agenten geben, und der Agent
benutzt es wirklich.

Prompt A: "Erzeuge einen Assistenten namens Rechner. Gib ihm ein selbstgebautes Werkzeug,
das eine Liste von Zahlen entgegennimmt und Summe und Mittelwert zurückgibt. Lass den
Rechner damit die Zahlen 4, 8, 15, 16, 23, 42 auswerten und mir das Ergebnis melden."

Prompt B: "Bau ein Summen-Werkzeug, gib es einem neuen Agenten und lass ihn 4 8 15 16 23
42 auswerten."

Erwartung: actor_program_activate bindet das Paket an @rechner. Der LLM-Actor ruft seine
eigene TypeScript-Funktion als Werkzeug auf (tool.call.started mit dem neuen Namen) und meldet Summe 108,
Mittelwert 18.

Warum gut: Prüft Funktionen eines echten LLM-Actors und deren Veröffentlichung als Werkzeug - inklusive der Frage, ob der Zielagent das Werkzeug überhaupt findet.

## T08 TypeScript-Actor mit Gedächtnis

Idee: Ein deterministischer TypeScript-Actor, der über mehrere Inputs Zustand hält.

Prompt A: "Ich möchte einen Zähler haben, der sich nichts ausdenkt: Jedes Mal, wenn man
ihm etwas schickt, erhöht er seinen Stand um eins und antwortet mit dem neuen Stand.
Schicke ihm danach dreimal etwas und sag mir den Endstand."

Prompt B: "Bau einen Zähler-Actor und schick ihm drei Nachrichten. Endstand?"

Erwartung: actor_program_activate aktiviert ein Paket mit onInput. Der TypeScript-Actor verarbeitet drei
Inputs als drei Turns, der Zustand steigt auf 3, der Koordinator meldet 3.

Warum gut: Prüft TypeScript-Actors samt Zustandsvertrag (context.state.replace) und die
FIFO-Verarbeitung mehrerer Inputs.

## T09 Stoppen und Aufräumen

Idee: Erzeugte Agenten sauber stoppen; danach ist der Lauf weiter benutzbar.

Prompt A: "Richte kurz zwei Helfer ein, lass jeden einen Satz sagen, und beende beide
danach wieder vollständig. Bestätige mir, dass nur noch du übrig bist, und antworte danach
noch auf die Frage: Wie viele Helfer laufen jetzt noch?"

Prompt B: "Erzeuge zwei Agenten, lass sie je einen Satz sagen, stoppe beide und sag mir,
wie viele noch laufen."

Erwartung: actor_stop für beide Helfer (actor.stopped im Journal), die Antwort lautet
null/keine, der Koordinator antwortet danach normal weiter.

Warum gut: Lebenszyklus-Disziplin; hängende Agenten sind ein reales Ressourcen- und
Verwirrungsproblem.

## T10 Wissensbasis nutzen statt halluzinieren

Idee: Eine fachliche Frage, deren Antwort in den Unterlagen im Arbeitsverzeichnis
steht - der Koordinator soll nachschauen statt zu raten.

Prompt A: "Schau bitte in den Unterlagen in deinem Arbeitsverzeichnis nach: Was ist dort
über die Grundregel zur Aggregation von Zeitreihen festgehalten? Zitiere die Stelle
sinngemäß und nenne die Datei, in der du fündig geworden bist."

Prompt B: "Was sagen deine Unterlagen zur Aggregation von Zeitreihen? Mit Fundstelle."

Erwartung: Lese-Werkzeuge werden benutzt (read/grep im Workspace), die Antwort nennt eine
real existierende Datei und gibt deren Inhalt sinngemäß wieder; keine erfundenen Fakten
oder Dateinamen.

Warum gut: Grounding-Test für den statischen Workspace; trennt Nachschlagen von
Halluzination.

## T11 Ausgabedisziplin bei knappem Auftrag

Idee: Hält das Koordinator-Modell den Ausgabevertrag (kein Meta-Gerede, klare Endantwort),
auch wenn der Auftrag trivial ist?

Prompt A: "Bitte nenne mir genau drei Vorteile von Pufferspeichern in Heizungsanlagen als
nummerierte Liste. Keine Einleitung, kein Schluss, nur die Liste."

Prompt B: "3 Vorteile von Pufferspeichern, nur als Liste."

Erwartung: Antwort ist exakt eine nummerierte Liste mit drei Punkten; keine
Werkzeugaufrufe, keine Vor- oder Nachrede, kein Nachdenken im Klartext.

Warum gut: Misst Formattreue und Overhead des Modells bei Kleinaufträgen - wichtig, weil
DeepSeek-Flash der Alltagsmotor sein soll.

## T12 Drei Nachrichten in schneller Folge

Idee: Inputs, die während eines laufenden Turns eintreffen, werden der Reihe nach als
eigene Turns verarbeitet - nichts geht verloren, nichts wird vermischt.

Prompt A (als DREI schnell hintereinander gesendete Nachrichten in derselben Unterhaltung):
1. "Merke dir die Zahl 7."
2. "Merke dir zusätzlich die Farbe Blau."
3. "Was habe ich dir gerade alles genannt?"

Prompt B (zwei Nachrichten schnell hintereinander):
1. "Zähle langsam von 1 bis 5, einzeln begründet."
2. "Stopp, sag mir stattdessen nur deine Lieblingszahl."

Erwartung: Alle Nachrichten werden verarbeitet, in Reihenfolge, als getrennte Turns
(FIFO, kein Steering); die letzte Antwort bei A nennt 7 und Blau; bei B wird erst der
laufende Turn beendet oder sauber unterbrochen, dann die zweite Nachricht beantwortet;
kein Input geht verloren.

Warum gut: Prüft die zentrale Warteschlangen-Semantik (ein Input = ein Turn, keine
Zustellung in laufende Turns) unter realistischem Benutzerverhalten.

## T13 Hallo Welt auf der Arbeitsfläche

Idee: Ein winziger Wunsch nach einer App in der Werkstatt endet als kleine statische
Actor-View als Kachel auf der Arbeitsfläche mit einem kurzen Erstellen-Aktivieren-Ablauf.

Prompt A: "Ich möchte auf der Arbeitsfläche eine kleine App haben, die nur den Text
Hallo Welt zeigt. Bau das bitte so, dass ich sie direkt auf der Fläche sehe."

Prompt B: "Ich hätte gern eine kleine App auf der Arbeitsfläche, die einfach nur
Hallo Welt sagt. Sie soll sonst nichts tun."

Erwartung: actor_program_create mit der Vorlage blank und actor_program_activate;
danach steht die App als Kachel auf der Fläche und actor_program_list bestätigt die Installation.
Die View gehört zum aufrufenden Actor und erzeugt keinen zusätzlichen Actor.
Das Paket enthält keine eigenen Funktionen, Input-Handler oder Werkzeuge und braucht daher keinen
erfundenen Backend-Test. Kein Abtippen von Hashes, kein Unteragent nur zum Testen.
Die View deklariert keine Größe; die Kachel und die lokale Vollansicht gehören dem Host.
Abschluss in unter 5 Minuten.

Warum gut: Prüft den kleinsten Actor-View-Pfad Ende-zu-Ende. Ein statischer Inhalt soll
keine zusätzlichen Serveraktionen oder künstlichen Tests erzeugen. Die Bedienung gehört
dem Host und wird nicht im App-Code nachgebaut.

## T14 Die Fläche vor dem Gespräch aufteilen

Idee: Der Koordinator soll die Kachelfläche selbst aufteilen, bevor die Arbeit läuft, statt
die Vorgabeaufteilung stehen zu lassen.

Prompt A: "Bitte richte drei Gesprächspartner mit eigenen Namen ein, die sich zwei Runden
lang reihum zu einem Thema Deiner Wahl unterhalten, jeder mit einem kurzen Satz. Bevor es
losgeht, möchte ich die Fläche so aufgeteilt sehen: der Wortführer oben über die ganze
Breite, die beiden anderen darunter nebeneinander. Am Ende eine kurze Zusammenfassung."

Prompt B: "Drei KIs unterhalten sich reihum über ein Thema. Teil die Fläche vorher auf:
einer oben, zwei unten. Dann lass sie reden."

Erwartung: agent_spawn für drei Agenten mit tools: [], danach genau ein
canvas_layout_replace mit einem root aus einer vertikalen Teilung, deren unteres Kind eine
horizontale Teilung mit den beiden übrigen @handles ist. Kein Layout-Fehler im Journal, kein
zweiter Aufruf während des Gesprächs, kein Versuch, den Menschen zu platzieren. Das Gespräch
läuft danach wie in T01.

Warum gut: Ende-zu-Ende-Fall für das Layout-Werkzeug: prüft, ob das Modell Entitäten als
@handle schreibt, Teilungen richtig schachtelt, Gewichte setzt und die Fläche vor der Arbeit
einrichtet statt danach.
