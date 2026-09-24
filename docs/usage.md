# Bedienung

Was ein Benutzer in der Weboberfläche, im Run-Panel, in der VS-Code-Erweiterung und von der
Kommandozeile aus sieht und tut. Installation, Start, Zugang, Paket, verteiltes Arbeiten und
Datenablage stehen in `docs/operations.md`, Build, Prüfläufe und Veröffentlichung in
`docs/development.md`. Wie Agenten TypeScript-Funktionen, Snippets, Actor-Programme und
Run-Scripts verwenden, steht in `docs/spec/typescript-platform.md` und `docs/spec/actor-programs.md`;
der Aufbau des Systems in `docs/spec/`, das Warum in `docs/decisions.md`.

<!-- guide:getting-started -->
## Create your first run

The top-left corner opens the run overview. Choose "Neuer Run" to open the start selection. It
shows the same tiles as the start page in VS Code: "Neuer Chat" (new chat) or the server's default
template first, then skill templates with a prepared task and script templates with programmed
setups. "Neuer Chat" opens an empty run whose task you write in its chat; a template starts with one
click. Some templates collect values in a setup dialog first ("Einrichten"); a skill template then
continues in the preparation chat. There you can discuss the task, give a clear go-ahead such as
"Start", or choose "Run erstellen" (create run). Merely confirming a detail does not start
anything. In the browser a new run always works on the server; only VS Code and `ragents run`
bind a run to a workstation.

Inside the run, the coordinator processes the task. Additional agents and mini-apps appear on
the surface when the workflow creates them. The global coordinator in the header has its own
conversation and can oversee several runs. The journal and "Executions" tab make events and
TypeScript calls traceable.

## Use the surface

A run's surface consists of tiles. Each tile shows an actor or mini-app, and together they
fill the available space. There is no panning or zooming. Tiles use flat surfaces, outlines,
and rounded corners without depth. Mini-app content appears at its original size both in the
tile and in full view.

Drag an actor or mini-app from the header onto one of a tile's docking targets. Left and right
create a side-by-side split; top and bottom create a vertical split. Targets at the outer edge
split the entire surface. Before you release, a preview shows the resulting area. Drag an
existing tile by its title bar; the X removes it from the layout. Its content remains available
through the header. Without access to the actors view, removal and reordering are disabled: the
X and drag handle are hidden. Dividers for adjusting size ratios remain available.

Drag a divider to the desired ratio; releasing it saves the value. Escape cancels the active
resize. With keyboard focus on a divider, arrow keys change its size while Home and End set the
allowed limits. When space is tight, the "Sichtbare Kachel" (visible tile) selector displays one item at a time
without discarding the layout. You can also ask the coordinator: "App on the left, chat on the
right, 50:50" or "One tile on top, two below at a 2:1 ratio." Until a layout is specified, the
surface arranges visible participants itself. Your changes remain saved until the program
changes its layout. A new program layout is applied automatically so added tiles appear at
once. "Programmvorgabe übernehmen" (apply program layout) in the status bar can reset your own layout earlier.
<!-- /guide:getting-started -->

## Runs wechseln

Die quadratische Ecke links oben in der Kopfzeile (oder `Cmd+I` auf macOS beziehungsweise
`Ctrl+I`) öffnet die Run-Übersicht als modalen Dialog unter der Kopfzeile einschließlich der
unteren Statusleiste. Die Kopfzeile bleibt bedienbar. Die Run-Karten zeigen
Titel, Bearbeitungsstatus, Erstellungsdatum mit Uhrzeit, letzte Aktualisierung und ergänzende Plugin-Angaben. Die Karten sind nach
letzter Aktivität in Heute, Gestern und weitere Tage gruppiert; Blau kennzeichnet laufende
Arbeit, ein violetter Hinweis neue Aktivität seit dem letzten Ansehen, und dieser persönliche
Lesestand gilt je Benutzer in diesem Browser. Die Auswahl
öffnet den Run und schließt die Übersicht. Ein erneuter Klick auf die Ecke, Escape oder ein
Klick auf den abgedunkelten Hintergrund schließen sie mit Rückgabe des Fokus zur Ecke.
"Neuer Run" in der Run-Leiste wechselt zum Startdialog. Erstellen sowie Einzel- und
Mehrfachlöschen erscheinen abhängig von deinen Rechten; die Mehrfachauswahl bietet Alle, Keine
und eine Löschbestätigung. Gelöschte Runs verschwinden sofort aus der Liste; das Aufräumen
(Prozesse, Arbeitsverzeichnis, Archiv) erledigt der Server danach im Hintergrund. Fehler bleiben
sichtbar. Lange Listen lassen sich scrollen.
Solange kein fertiger automatischer Titel vorliegt, zeigt die Run-Liste den ursprünglichen
Auftrag. Nach erfolgreicher Erzeugung und Speicherung erscheint die kurze Überschrift, ohne
auf den nächsten regelmäßigen Listenabruf zu warten. Bei deaktivierter oder fehlgeschlagener
Erzeugung bleibt der Auftrag sichtbar. Bewusst im Run oder Setup gesetzte Titel haben Vorrang;
eine andere Modellauswahl benennt vorhandene Titel nicht neu.

Der globale Koordinator steht unabhängig davon direkt in der Kopfzeile. Das Öffnen der
Run-Übersicht schließt seinen Verlauf, erhält aber Gespräch, Entwurf und Anhänge.

## Run-Chat und Fläche

Die schmale Statusleiste am unteren Fensterrand reicht über die ganze Anwendungsbreite. Sie
trägt `Journal` und, sobald Du selbst etwas umgeordnet hast, "Programmvorgabe übernehmen".
Gespräche stehen in den Kacheln und in den
Actor-Pop-outs. Der Run-Koordinator ist standardmäßig nur in der Actor-Leiste über der Fläche
erreichbar. Ein Klick auf seinen Eintrag öffnet den Chat als Pop-out darunter. Diese
Chatansichten sind bis zu 784 Pixel breit und passen sich bei schmalen Fenstern an. Andere
LLM-Einträge öffnen ihren Chat, TypeScript-Einträge ihre Actor-Ansicht. Ein erneuter Klick,
Escape, Außenklick oder das X im Pop-out-Kopf schließt das Pop-out; ungesendete Texte bleiben
beim Schließen und Actor-Wechsel erhalten. Über die Actorliste kannst Du ihm zusätzlich eine
eigene Kachel geben. In der Ansichtsleiste wählt die Sprechblase den Verlauf, die anderen
Symbole jeweils eine Detailansicht. Der Code-Reiter zeigt bei Actors mit installiertem Programm
die TypeScript-Quellen und übrigen Dateien dieses Stands, mit Dateiauswahl und Syntaxhervorhebung.
Das gilt auch für TypeScript-Actors ohne Mini-App oder veröffentlichte Funktionen. Dafür
werden die technischen Leserechte benötigt.
Links in der Actor-Leiste über der Fläche schaltet `Anzeige` zwischen `Alle`, `Aktive`, `Sichtbare`,
`LLM-Agenten` und `TypeScript`, ohne seine Breite zu ändern. Standard ist `Aktive`;
`Alle` zeigt zusätzlich gestoppte Actors. Solange kein Actor gestoppt ist, sehen beide gleich aus.
`Sichtbare` zeigt nur Actors, die gerade eine Kachel haben, und immer den
primären Actor. Die beiden Typfilter zeigen auch gestoppte Actors
des jeweiligen Typs. Actorliste und Chats öffnen mit demselben Abstand direkt unter dem Knopf.
Das ändert nur die direkten Actor-Zugänge und verändert die Aufteilung nicht.
Die Auswahl bleibt je Run im Browser gespeichert. Unter `Actors` findest Du immer die
vollständige Liste. Knöpfe geöffneter Pop-outs bleiben sichtbar gedrückt.
Der Nachrichtenentwurf bleibt beim Wechsel erhalten. Im Chat des primären Actors bleibt
`Run stoppen` mit Bestätigung erreichbar.

`Journal` in der Statusleiste öffnet darüber die tatsächlichen Ereignisse des Runs.
Die neuesten stehen zuerst; die Suche findet Ereignisinhalte und Actor-Handles. Ein Eintrag
lässt sich zum vollständigen JSON aufklappen. Zunächst sind 100 Treffer sichtbar, weitere
lassen sich nachladen. Die offene Ansicht folgt Änderungen des Runs und bietet Aktualisieren.
Außenklick oder Tab aus der Ansicht schließen sie; Escape und X geben den Fokus an Journal zurück.

`Actors` in der Actor-Leiste über der Fläche listet alle Beteiligten auf, auch dich und gestoppte
Actors. Klicke auf einen Namen eines KI- oder TypeScript-Actors, um rechts dessen Chat und
Details zu öffnen; eine Kachel entsteht dadurch nicht.

Rechts an jedem Eintrag steht die Checkbox `Fläche`. Ohne eigene Wahl stehen der Hauptactor und
Actors mit eigener Mini-App nicht auf der Fläche; so braucht die App keinen zusätzlichen Platz
für ihren Besitzer. Alle übrigen Actors stehen darauf. Die Checkbox wirkt auf die anfängliche
Aufteilung eines Runs ohne Vorgabe und auf die Actor-Auswahl des Run-Panels; eine bereits
gespeicherte Aufteilung ändert sie nicht. Die Auswahl bleibt in diesem Browser je Serveradresse
und Run erhalten; Leserechte genügen. Sie ändert weder den Run noch sein Journal.

Die Reitersymbole oben neben Einstellungen und Hilfe wählen die Ansicht der Leiste.
Der Panelknopf in derselben Titelleiste klappt sie vollständig ein. Danach ist nur noch der Knopf
zum Öffnen sichtbar; er stellt die zuletzt verwendete Breite wieder her. Eine Auswahl über
einen Namen in der Actorliste öffnet die Leiste ebenfalls. Besuchte Ansichten behalten ihren Zustand.
Die Symbolnamen erscheinen nach 50 Millisekunden Hover oder sofort bei Tastaturfokus direkt
unter der Kopfzeile. Beim Wechsel zum nächsten Symbol bleibt der Hinweis sichtbar und wechselt
sofort; kleine Lücken zwischen den Knöpfen unterbrechen ihn nicht.
Der Panelknopf ist so groß wie Einstellungen und Hilfe; Escape entfernt einen sichtbaren
Hinweis, ohne den Fokus zu verschieben.

Die Eingabe direkt in einer Agenten-Kachel sendet an den
jeweiligen Actor. Wie im Actor-Chat der Leiste stehen Dateien anhängen und die Darstellung der
Schritte von ausgeblendet bis vollständig zur Verfügung, ohne Modell- oder Denktiefenauswahl.
Der Modus "aktuell" zeigt den laufenden Schritt als Quassel-Chip. Bei Zugängen ohne technische
Leserechte steht dort "Denken" oder "Werkzeug läuft", ohne Werkzeugnamen, Inhalte oder
aufklappbare Details. Nach Ende des Schritts verschwindet der Chip; eine Nachricht, die Du
währenddessen nachschiebst, lässt ihn stehen. Die animierten
Arbeitsszenen bleiben sichtbar, solange der Agent arbeitet, auch bei längeren Denkpausen.
Im Run-Chat laufen sie, solange irgendein Agent oder Programm des Runs arbeitet, also auch
während der Koordinator auf beauftragte Actors wartet; Kacheln und Pop-outs zeigen nur den
jeweiligen Actor.
Senden braucht Schreibrechte am Run und einen nicht gestoppten Actor; fehlgeschlagene Eingaben
bleiben über die gemeinsame Chat-Eingabe verfügbar. Jede Kachel scrollt ihren eigenen Inhalt;
am Ende des Verlaufs folgt er neuen Nachrichten wieder automatisch. Den Chat mit allen Details
öffnest Du über die Actorliste oder die direkten Zugänge in der Actor-Leiste über der Fläche.

Verlauf und Eingabe nutzen dieselbe verfügbare Breite. In jedem Chat, auch bei einem anderen
Adressaten, in Kacheln, im Vorbereitungschat und beim globalen Koordinator, schaltet der Uhrknopf
unten neben der Schrittdarstellung die Zeitstempel ein und aus. Die Wahl bleibt im Browser je Run
und Actor gespeichert und gilt überall, wo dieser Chat erscheint. Der Pfeil zum Ende erscheint
erst bei mehr als 120 Pixeln Abstand; kleines Zurückscrollen hält neue Antworten trotzdem an der
gewählten Leseposition.

Kleinigkeiten der Chats und Kacheln: Antworten erscheinen schon während der Ausgabe als
Markdown mit Überschriften, Listen, Tabellen und Codeblöcken; noch offene Formatierungen werden
vorläufig dargestellt. An Deinen eigenen Nachrichten erscheint beim Darüberfahren oder per
Tastaturfokus oben rechts ein Kopiersymbol; es kopiert den ursprünglichen Text mit seinen
Zeilenumbrüchen und bestätigt mit einem Haken.
Sendest Du während einer laufenden Antwort eine weitere Nachricht, wartet sie nicht auf das Ende
des Turns: Ein Agent speist sie vor seiner nächsten Modellanfrage in den laufenden Turn ein
(Steering). Der Senden-Knopf heißt in dieser Zeit "In den laufenden Turn einspeisen", und im
Verlauf steht unter der Nachricht "In den laufenden Turn eingespeist". Ein TypeScript-Actor und
ein Text über 30000 Zeichen bekommen dagegen einen eigenen Turn. Die Antwort bleibt
zusammenhängend vor Deiner neuen Nachricht stehen. Unter dem letzten Beitrag bleiben etwa zwei
Zeilen freier Scrollraum. Hat der Actor des Chats gerade einen Turn und ist die Eingabe leer,
unterbricht "Arbeit stoppen" nur diesen Turn; der Actor nimmt danach die nächste Nachricht an.
Ist er gestoppt, steht an der Stelle der Eingabe der Grund samt "Neu starten". Die Darstellung der Werkzeugaufrufe
(Symbole, kompakte Zeilen, vollständig) gilt je Chat; andere Chats und Runs behalten ihre
Einstellung, ebenso Breite und Aufklappzustand der Leiste je Run. Bei vielen Einträgen
in der Actor-Leiste über der Fläche erscheinen links und rechts Pfeilknöpfe zum Blättern; auch
Mausrad und Trackpad bewegen die Einträge horizontal. Mini-Apps bekommen in der Kachel einen
gemeinsamen Innenabstand; ihr Scrollbalken liegt am rechten Kachelrand, und der Platz für
Statusmeldungen unter dem App-Inhalt bleibt reserviert, damit Start, Abschluss und Fehler einer
Aktion die App nicht verschieben. Jede Teilfläche lässt sich erneut teilen, etwa in eine obere
Kachel und zwei untere im Verhältnis zwei Drittel zu einem Drittel; Koordinatoren können solche
Aufteilungen auf Wunsch ebenfalls setzen.

## Anhänge im Chat

Die Chat-Eingabe leert Text und Anhänge sofort beim Absenden. Bis zum Ende der Anfrage sind
weitere Sendeaktionen und neue Anhänge gesperrt. Du kannst einen neuen Text beginnen, sofern
die jeweilige Ansicht die Eingabe freigibt. Bei einem Fehler kehrt die ursprüngliche Eingabe
automatisch zurück, wenn du inzwischen nichts geändert hast. Sonst bleibt dein neuer Text
unverändert; der fehlgeschlagene Auftrag steht getrennt mit Vorschau bereit. Mit
"Nicht gesendete Eingabe einfügen" hängst du ihn samt Anhängen an den aktuellen Entwurf an.

Bilder, Videos und Dateien lassen sich in die Chat-Eingabe ziehen oder über den Anhangknopf
auswählen. Bilder und Dateien aus der Zwischenablage fügst du mit Cmd+V beziehungsweise Ctrl+V
ein. Vor dem Senden erscheinen Vorschauen mit Dateinamen und einem Entfernen-Knopf. Auch ohne
zusätzlichen Text kannst du senden. Das gilt für neue Runs, den globalen Koordinator,
die Actor-Ansicht und Chat-Controls in Actor-Views.

Eine Nachricht nimmt bis zu acht Dateien mit zusammen 20 MiB auf. Bilder, Videos und native PDFs
brauchen ein passendes Modell; die Eingabe meldet fehlende Fähigkeiten und erhält die Auswahl.
Textdateien werden als UTF-8 gelesen. Andere Dateien stehen dem Agenten über seine Dateiwerkzeuge
zur Verfügung: sie liegen unter `attachments/` im Arbeitsbereich des Runs, bei einem Arbeitsplatz
also auf dessen Rechner; ihre weitere Verarbeitung hängt von diesen Werkzeugen ab. Bei Fehlern bleiben
Nachricht und Dateien im Composer. Gesendete Anhänge kannst du im Verlauf wieder herunterladen.

## Wählbares Modell

Gibt das Produkt es frei (`MODEL_SELECTABLE`, in `core` voreingestellt an) und erlauben
die Benutzerrechte freie Starts (`runs.create`), Schreiben (`runs.write`) und technische Ansichten
(`runs.inspect`), wählt man das Modell des Koordinators in der Chat-Eingabe des Runs, im Browser
wie im Run-Panel von VS Code, über ein tastaturbedienbares Auswahlmenü rechts neben den
Schaltern der Eingabe. Die Denktiefe steht als zweites Auswahlmenü kompakt daneben und bietet nur
die Stufen des gewählten Modells an, einschließlich erweiterter Stufen wie `max`, sofern
unterstützt. `AGENT_MODEL_REASONING` ist nur für eine bewusste Einschränkung dieser
Modellfähigkeiten nötig; ungültige Stufen brechen die Konfiguration ab.

Die Wahl steht schon im leeren Run nach "Neuer Chat" bereit und gilt dann für den ersten Turn;
ohne Wahl beginnt der Run mit der Vorgabe aus den Einstellungen. Danach bleibt sie in derselben
Eingabe und gilt ab dem nächsten Turn des Koordinators; ein laufender Turn behält sein Modell, der
Verlauf bleibt erhalten. Enthält das Gespräch schon Bilder, Videos oder Dateien, die das neue
Modell nicht verarbeiten kann, lehnt der Server den Wechsel mit Begründung ab. Ohne eines der
Rechte fehlt die Auswahl ganz, und der Server lehnt eine Wahl ab. Im Vorbereitungschat einer
Skill-Vorlage mit Leitfaden steht dieselbe Auswahl in der Auftragseingabe; die Eingabe beginnt
dort mit drei Zeilen und wächst bis acht Zeilen, weitere Startoptionen stehen darunter.
Angeboten werden nur wählbare, nicht gesperrte Startoptionen.
Zur Wahl steht `AGENT_MODELS` - eine ECHTE Liste in der Konfigurationsdatei, kein Wert
mit Trennzeichen:

```ts
AGENT_COORDINATOR_MODEL: "deepseek/deepseek-v4-flash-0731",
AGENT_COORDINATOR_THINKING: "off",
AGENT_MODELS: ["qwen/qwen3.8-max", "deepseek/deepseek-v4-flash-0731", "z-ai/glm-5.3"],
```

Ohne `AGENT_MODELS` stehen die ohnehin konfigurierten Modelle des Produkts zur Wahl, jedes einmal,
auch wenn Agent und Koordinator dasselbe Modell nennen; doppelt darf ein Modell nur in einem
ausdrücklichen `AGENT_MODELS` nicht stehen. Modelle anderer Profile oder freie Namen nimmt der
Server nicht an. Die Wahl gilt für den Koordinator; anders als der Systemprompt wird sie mit der
ersten Nachricht nicht eingefroren.
`AGENT_COORDINATOR_MODEL` ist dabei der explizite Standard und nicht einfach der erste Listeneintrag.
Er muss in `AGENT_MODELS` stehen; eine widersprüchliche Konfiguration bricht den Start hart ab. Das
Profil `relay` beginnt mit demselben Modell und derselben Koordinator-Denktiefe. Unter
Einstellungen, Modelle kann es eine eigene Vorgabe für neue Vermittlungs-Actors erhalten.

## Auswählbare Systemprompts

Der Kern bringt selbst KEINEN inhaltlichen Systemprompt mehr mit. `ragents.product/preamble.hbs`
sagt nur noch, dass man als Koordinator in RAgents läuft; die Mechanik steht bei dem Plugin, das
sie erklärt (Profile und Neustart-Regel in `ragents.orchestration`, `ask_user` in `ragents.ask`),
und Ton wie Verhalten kommen aus den Prompt-Dateien.

Jede `.md` oder `.hbs` im Ordner `prompts/` eines Plugins oder in `SYSTEM_PROMPTS_DIR` ist ein
Eintrag der Liste: Kennung = Dateiname ohne
Endung, Beschriftung = erste `# `-Überschrift. Im Vorbereitungschat schaltet man sie einzeln an und aus -
MEHRERE gleichzeitig sind erlaubt, die Reihenfolge im Prompt folgt dem Katalog, nicht der
Klickfolge. Der Text kommt ZUSÄTZLICH zur Präambel in den Prompt und wird mit der ersten Nachricht
eingefroren. `SYSTEM_PROMPT_DEFAULT` nimmt entsprechend eine Liste von Kennungen.

Das Häkchen "Auch an die Agenten weiterreichen" im Vorbereitungschat entscheidet über die Reichweite:
ohne Häkchen gilt der Prompt nur für den Koordinator, mit Häkchen steht er zusätzlich im
Systemprompt jedes Agenten, den der Koordinator erzeugt. Plain-LLMs mit `tools: []` sind bewusst
ausgenommen und erhalten ausschließlich ihren eigenen Prompt. `SYSTEM_PROMPT_SHARE_DEFAULT=1`
belegt das Häkchen vor; die Reichweite wird zusammen mit der Auswahl in das Journal des Runs eingefroren.

Die Dateiablage bleibt je Run isoliert
(`sessions/<id>/plugins/ragents.documents/documents`, Dienst `documentStoreToken` von
`ragents.documents`); `DOCUMENTS_DIR` legt sie mit einem Unterordner je Run unter einen
externen Pfad, bleibt aber bewusst ungesetzt, damit Test-Runs nie in eine fremde
Ablage schreiben. Ein Systemprompt gleichen Namens im Plugin-Ordner und in
`SYSTEM_PROMPTS_DIR` ist ein harter Fehler.

## Skill-Vorlagen in der Startauswahl

Die Startauswahl zeigt jede Vorlage als Kachel mit Kategorie, Titel und Beschreibung, in derselben
Form wie Start in VS Code; Kategorien sind frei wählbar und keine Liste aus dem Code. Jede
Skill-Vorlage enthält einen kurzen, frei formulierten Startauftrag, der das gewünschte Ergebnis
ohne Plattformwissen beschreibt; seine `description` erklärt, was die Demo zeigen soll. Die
Einstellungen zeigen denselben Prompt mit einer Kopieraktion. Format und Regeln der Vorlagen stehen
in [plugins.md](spec/plugins.md) unter "Skills and starting tasks" und "Referenzfälle aus
ragents.reference", die Vorlagen und Bausteine der Actor-Programme in
[actor-programs.md](spec/actor-programs.md).

"Starten" startet den Run sofort mit dem Auftrag des Skills. "Einrichten" öffnet zuerst den
Leitfaden; danach führt er in den Vorbereitungs-Chat im nächsten Dialogschritt. Dort lässt sich der
Auftrag mit einer eigenen Koordinator-Instanz besprechen, dort stehen auch Modell, Denktiefe,
Systemprompts und Arbeitsbereich zur Wahl. Nach Deinem ausdrücklichen, sinngemäßen Go startet sie
den Run; es ist kein festgelegter Satz nötig. "Run erstellen" startet direkt. Beide Wege übernehmen
Gespräch, Skill und Anhänge; der Knopf nimmt auch die letzte ungesendete Ergänzung mit. Zurück
verwirft den lokalen Vorbereitungsverlauf und führt auf die Startauswahl. Beim Start wird der
Skill mit dem Auftrag übernommen; der bearbeitete Auftrag hat Vorrang vor Beispieltext im Skill.
Als Rechner bietet der Arbeitsbereich im Browser nur den Server an, im Run-Panel von VS Code auch
die verbundenen Arbeitsplätze.

## Run-Scripts starten

Die Homepage-Samples sind in der Startauswahl als Run-Scripts verfügbar: Sammelboard,
Balkon-Wizard, Lernnachmittag und Wortspiel. In der eingebauten Hilfe wählt "Sample starten"
die passende Vorlage direkt aus. Ein vorhandener Einrichtungsdialog bleibt vorgeschaltet.
Wortspiel und Lernnachmittag bauen ihre Teilnehmer und Mini-App zunächst ohne Modellaufruf
auf; die Arbeit beginnt mit dem Startknopf in der App. Ihre Homepage-Vorschauen verwenden
dieselben Oberflächen mit gekennzeichneten Beispieldaten und rufen keine Modelle auf.

Wie ein Run-Script aufgebaut ist, welchen Startwert es bekommt und wie `fixed-start-options` eine
Startoption festlegt, steht in [typescript-platform.md](spec/typescript-platform.md) unter
"Run-Scripts als vorbereitete Actor-Programme" und in [plugins.md](spec/plugins.md) unter
"Registrierungen des PluginHost"; die Einrichtungsdialoge der Referenzfälle unter
"Referenzfälle aus ragents.reference".

## Einstellungen

Die Fläche im Stil Schichtwerk zeigt matte Kacheln mit gerundeten Kanten, ohne Tiefe.
Lavendel kennzeichnet den Hauptactor, Tonfarbe weitere KI-Actors, Senfgelb
TypeScript-Actors und Blaugrau die Mini-Apps. Die Fronten bleiben gerade und gleichmäßig.
Runde Knöpfe mit X schließen Dialoge; ein runder Pfeil führt zur vorherigen Ansicht zurück.
Die Hinweise am Knopf benennen die jeweilige Aktion.
Auswahlmenüs öffnen je nach Platz über oder unter ihrem Knopf und bleiben auch in engen
Eingabe- und Dialogflächen vollständig erreichbar. Escape schließt zunächst das offene Menü.

Unter "Darstellung", "Schichtwerk" wählst du Hell, Dunkel oder System. Die Vorgabe ist Dunkel;
System folgt der Farbschema-Einstellung des Betriebssystems auch bei späteren Änderungen.
Die Auswahl wirkt sofort auf Oberfläche, Kacheln und gemeinsame Actor-View-Controls, ohne Chats
oder Apps neu zu laden. Sie wird im Browser für dieselbe Serveradresse gespeichert und mit
anderen geöffneten Tabs abgeglichen. Zum Ändern brauchst du Settings-Schreibrechte.
Eigene feste Actor-View-Farben bleiben bestehen. Farben, Schriften, Radien, Schatten und
Animationen werden für die Entwicklung zentral in `apps/web/src/ui/theme.css` gepflegt.
Actor-Views verwenden dieselben shadcn/ui-Controls wie der Host, mit den Farben aus den Tokens.
Sie folgen derselben Hell-/Dunkel-Wahl; eine gesonderte Auswahl dafür gibt es nicht.

Das Zahnrad öffnet zuerst "Modelle". "Globaler Koordinator" ändert dessen eigene Auswahl
ab dem nächsten Arbeitsschritt. Die erste globale Auswahl wird unabhängig gespeichert und
bleibt auch nach einem Neustart von den Produktvorgaben getrennt. "Neue Runs und Agenten" bietet für jede Rolle des
Produkts Modell und Denktiefe; in core sind das coordinator, relay und standard. Speichere den
vollständigen Entwurf. Neue Actors und Vorgaben noch nicht gestarteter Runs verwenden ihn
sofort; bestehende Actors sowie eine ausdrücklich getroffene Startauswahl bleiben erhalten.

Die Auswahl enthält nur konfigurierte Modelle und deren unterstützte Denktiefen; ungültige
Entwürfe werden vor dem Speichern abgewiesen. Die verfügbare Modellliste wird weiterhin in der
Profildatei gepflegt. Ablage, Vorrang und Startfehler der gespeicherten Vorgaben stehen in
[profiles.md](spec/profiles.md) unter "Bearbeitbare Modellvorgaben".

Die Rolle des Koordinators heißt `coordinator`, die der Agenten `standard`. Unter
"Neue Runs und Agenten" kannst Du ihre Denktiefen getrennt wählen. Die Vorgaben stehen in der
Profildatei, in core unter `ragents.product`:

```typescript
AGENT_COORDINATOR_MODEL: "z-ai/glm-5.3-flash",
AGENT_COORDINATOR_THINKING: "high",
AGENT_MODEL: "z-ai/glm-5.3-flash",
```

Ein Produkt-Plugin kann weitere Rollen mit eigenen Schlüsseln anmelden; gespeicherte Rollen
lassen sich separat bearbeiten. Der aktuelle Modellkatalog bietet für GLM 5.3 und GLM 5.3 Flash
`low`, `high` und `max`.
Gespeicherte Modelleinstellungen haben Vorrang vor der Profildatei. Änderungen
in der Oberfläche gelten für neu angelegte Actors ohne Neustart; Config- und Run-Prompt-Änderungen
benötigen einen Neustart und für den neuen Koordinatorprompt einen neuen Implementierungs-Run.

Unter "Überschriften" wählst du unabhängig davon das Modell für kurze automatische
Listentitel. Bei einer großen Modellliste hilft die Suche. "Speichern" übernimmt die Auswahl,
"Änderungen verwerfen" verwirft nur den Entwurf. "Keine automatischen Überschriften" mit
anschließendem Speichern deaktiviert neue Erzeugungen; vorhandene Titel bleiben erhalten.
Die Auswahl wirkt ab der nächsten Erzeugung und verändert keine Agentenmodelle.

Angeboten werden Textmodelle des konfigurierten `COMPACTION_PROVIDER`, die ohne Reasoning
arbeiten können; Vorgabe, Ablage und Fehlerfälle stehen in [profiles.md](spec/profiles.md) unter
"Modell für automatische Überschriften".

"Darstellung" enthält die Oberflächenwahl und die Einstellungen des Run-Panels. "Plugins" enthält
"Nach Plugin" und "Nach Fähigkeit" als technische Kataloge mit Suche. Ein Klick auf den
Eigentümer öffnet die vollständige Plugin-Seite. "Laufzeit" zeigt technische Fakten,
Modelle, Profile und Systemprompt. Modelle und Darstellung funktionieren unabhängig vom
Laden dieser Kataloge. Plugin-Formulare sind zusätzlich bei ihrem Plugin erreichbar.

Unter "Run-Panel" bestimmst du, ab welcher Panelbreite der Chat rechts neben der Mini-App
liegt (Vorgabe 900 Pixel) und wie träge das Sheet auf die Maus reagiert (Vorgabe 160
Millisekunden bis zum Hochschieben, 150 Millisekunden bis zum Zurückgleiten). Zum Ändern
brauchst du Settings-Schreibrechte. Die Einstellung bleibt lokal für dieselbe Serveradresse im
Browser gespeichert und wird nicht als Profilwert auf dem Server abgelegt. Zurücksetzen stellt
die Vorgaben wieder her.

## Globaler Koordinator

Mit `ragents.overseer` in `host.PLUGINS` steht die Eingabe "Globaler Koordinator" rechts
neben den Übersichtsknöpfen. Fokus in die Eingabe klappt den Verlauf
unterhalb auf. Enter sendet, Shift+Enter fügt eine Zeile ein. Die Eingabe bleibt oben; Anhänge
lassen sich wie in anderen Chats auswählen, hineinziehen oder einfügen. Im Dropdown stehen
Verlauf, Modellwahl, Reasoning, Details und Reset. Senden und Stopp bleiben an der Eingabe.

`Gespräch zurücksetzen` steht neben Modell und Reasoning im Dropdown des globalen Chats und öffnet
einen Dialog über dem gesamten globalen Chat. Sein Hintergrund wird unscharf und ist
währenddessen nicht bedienbar; der Fokus beginnt auf Abbrechen. Die bestätigte Aktion löscht
Verlauf, Eingabeentwurf, Anhänge und Modellkontext und stoppt vorher eine laufende Antwort. Normale Runs,
ihre Journale sowie Modell- und Reasoningwahl bleiben erhalten. Nach Abschluss beginnt die
nächste Nachricht ein frisches Gespräch. Bei einem Fehler bleibt eine Meldung sichtbar;
ein begonnener Reset lässt sich wiederholen und wird nach einem Serverneustart fertiggestellt.
Es gibt keinen automatischen Reset.

Modell und Reasoning-Tiefe wählst du im Dropdown oberhalb des Verlaufs. Dieselbe Auswahl findest du
in den Einstellungen unter Modelle und bei `ragents.overseer`. Sie wird pro Profil
gespeichert und gilt ab dem nächsten Arbeitsschritt; eine laufende Antwort wird nicht
umgestellt. Andere Runs behalten ihre Modelle. Ein inkompatibles Modell, etwa ohne
Unterstützung für schon gesendete Bilder, wird abgewiesen und die bisherige Auswahl bleibt.

Beim Absenden erfährt der globale Koordinator, ob du auf der Startansicht, in der Run-Übersicht
oder in einem Run bist, welchen Bereich du geöffnet und welches Element du ausgewählt hast.
Öffne zum Beispiel den Reiter Dateien und frage oben "Was liegt in diesem Run?".
Run-Titel, kurze Run-Referenz und Actor-Name werden auf dem Server ergänzt; du musst sie nicht
abschreiben. Dein sichtbarer Fragetext bleibt dabei unverändert.

Diese Orientierung hält den Stand beim Absenden fest. Wechselst du danach den Run, bezieht
sich die schon gesendete Frage weiterhin auf ihre ursprüngliche Auswahl, auch wenn sie noch
in der Warteschlange steht. Ohne mitgesendete UI-Angabe gibt es keinen aktuellen Standort.
Der Koordinator erhält durch diesen Kontext weder Bildschirmbilder noch Formulartexte oder
vollständige Run-Inhalte. Die Angabe hilft beim Zuordnen deiner Frage und erteilt keinen
zusätzlichen Auftrag; ein Ansichtswechsel allein löst keine Modellanfrage aus.

Escape schließt zuerst ein offenes Auswahlmenü und danach den Verlauf. Ein Klick außerhalb
oder Tab aus dem gesamten Bereich schließt ihn ebenfalls. Das beendet keine Arbeit und
verwirft keinen Entwurf. Übersicht, Einstellungen und Hilfe schließen den Verlauf; bei einem
Run-Wechsel bleiben Gespräch und Eingabe erhalten. Die Übersichtsecke und `Cmd+I` beziehungsweise
`Ctrl+I` öffnen ausschließlich die Run-Übersicht.

Erst das erste Öffnen verbindet den Stream. Schon während der Sendeanfrage und danach bei
laufender Arbeit pulsiert der Rahmen um die Eingabe, wie bei arbeitenden Agenten in ihrer Kachel.
Bei reduzierter Bewegung
bleibt der Rahmen hervorgehoben. Ein Verbindungsabbruch sperrt Senden, erhält aber den Entwurf.
Nach Wiederverbindung werden zwischenzeitliche Kurzantworten berücksichtigt, ohne alte Toasts
beim ersten Verbinden oder erneuter Wiedergabe nochmals anzuzeigen.

Jeder angemeldete Benutzer hat seinen eigenen globalen Koordinator, ohne Anmeldung gibt es genau
einen. Er überblickt die Runs, die sein Benutzer sieht, liest ihre Journale und kann neue Runs
mit einem Auftrag oder einem installierten Run-Script beginnen; er handelt dabei mit dem Zugang und
den Rechten seines Benutzers, und neue Runs gehören diesem. Erstellte Runs lassen sich
über die Run-Liste öffnen. Der Stopp-Knopf an seiner Eingabe erscheint nur, solange der globale
Koordinator selbst einen Turn hat, und unterbricht nur diesen; einen anderen Run stoppt er auf
Auftrag über die Verwaltungsmethoden. Ohne Schreibrecht
bleibt die schreibgeschützte Eingabe fokussierbar und öffnet den lesbaren Verlauf; Senden ist
gesperrt. Einen zusätzlichen Dropdown-Pfeil gibt es nicht.

Für eine knappe Antwort kann der Koordinator `quick_answer` verwenden. Die aktuelle Nutzerfrage
und ihre Antwort erscheinen kurz zusammengefasst, jeweils mit höchstens 240 Zeichen,
automatisch direkt unter der Kopfzeile als Toast, auch bei
offenem Verlauf. Er verwendet denselben Hintergrund und denselben Abstand wie die Hinweise der
Kopfzeilenknöpfe.
Der gesamte Toast öffnet beim Anklicken das Gespräch und fokussiert seine Eingabe, bei
Lesezugriff den Verlauf. Das X schließt nur den Toast; die Antwort
öffnet nichts von selbst und unterbricht nicht die aktuelle Eingabe.

Der Chat verwendet je Benutzer eine eigene Run-ID (`overseer-...`, ohne Anmeldung
`overseer-single`) und die normale Journal- und Run-Ablage. Das Gespräch des früheren
gemeinsamen Koordinators (`overseer`) wird nicht übernommen und bleibt unverändert liegen.
Die kurzen Run-Referenzen liegen dauerhaft unter `plugins/ragents.overseer/run-references.json`
im Datenverzeichnis. Der Koordinator erscheint nicht in der normalen Run-Liste und kann
nicht gelöscht werden. Die mitgelieferten Profile enthalten das Plugin; eine zusätzliche
Profildatei muss es ebenfalls in ihrer Pluginliste aufführen.

Ändert sich die feste Werkzeugauswahl des globalen Koordinators, meldet ein vorhandenes Gespräch
beim nächsten Sendeversuch `global-tools-changed`. Nach dem Serverneustart einmal `Gespräch
zurücksetzen` ausdrücklich bestätigen, damit die nächste Nachricht mit den aktuellen Werkzeugen und
der neuen Promptanweisung beginnt; ein bestehendes Gespräch wird nicht automatisch angepasst.

Werkzeuge, Verwaltungsmethoden, Journalzugriff und Zugang des globalen Koordinators
stehen in [core.md](spec/core.md) unter "Globaler Koordinator".

## Dienste und Hintergrundprozesse beenden

Die Prozessleiste zeigt Hintergrundprozesse des Runs und Dienste mit offenen Ports, und zwar auf
dem Rechner, auf dem der Run arbeitet: bei einem Arbeitsplatz dessen Prozesse, sonst die des
Servers. Mit Schreibrecht beendet das kleine Stopp-Symbol genau die ausgewählte Prozessinstanz.
Während der Anfrage ist dessen Knopf gesperrt; Fehler bleiben am Eintrag sichtbar. Der nächste
Prozessstand entfernt beendete Einträge. Beim Stoppen und vor dem Löschen eines Runs räumt der
Executor des Runs auch markierte Prozesse ohne offenen Port auf, auf dem Arbeitsplatz wie auf dem
Server. Ein offenes Browserfenster ist dafür nicht nötig. Ist der Arbeitsplatz gerade nicht
verbunden oder antwortet er nicht innerhalb von zehn Sekunden, merkt sich der Server den Stopp und
holt ihn nach, sobald sich der Arbeitsplatz wieder anmeldet, noch vor jedem neuen Auftrag dieses
Runs; das Serverprotokoll nennt ihn bis dahin als ausstehend. Ein Serverneustart vergisst ihn.

Wie der Executor Prozesse beendet (SIGTERM, SIGKILL, Zeitgrenzen) und welche Prozesse er einem
Run zuordnen kann, steht in [plugins.md](spec/plugins.md) unter "Arbeitsbereich,
Sandbox-Werkzeuge und Prozesse".

Ein bewusst abgesetzter Node-Dienst kann mit `child_process.spawn` und den Optionen
`detached: true`, `stdio: "ignore"`, `env: process.env` sowie anschließendem `child.unref()`
weiterlaufen. Das verwendet auf macOS und Linux die Node-Prozessschnittstelle und benötigt
kein externes `setsid`-Programm. Der geerbte `RAGENTS_RUN_ID`-Marker muss erhalten bleiben,
damit der Dienst beim Run-Stopp wiedergefunden wird. Derselbe Mechanismus gilt unabhängig
vom verwendeten Interpreter; ohne Marker gibt es keine Zuordnung zum Run. Welche Prozesse die
Prozesstabelle je Plattform trotz Marker nicht zuordnen kann, etwa Programme aus `/bin` unter
macOS, nennt derselbe Abschnitt der Spec.

<!-- guide:clients -->
## Run panel and VS Code extension

The run panel is also available in the browser. `http://localhost:4710/run-panel.html?run=<id>`
shows a run in a narrow layout with mini-app chips, the selected app, actor chips, chat, and the
tab bar on the right. Without `run`, it shows the run list with "Neuer Run" as the first
card. `run-panel.html?layout=app&run=<id>&element=<app-id>` shows one mini-app without the tab bar.
Run-panel state, including the selected app and actor, view mode, chat width, collapsed chat
height, open tab, and tab-area height, is stored per run in the browser.

The narrow tab bar on the right contains the same tabs as the full web view: files, documents,
functions, executions, and language-server diagnostics, depending on the run and the user's
permissions. The tab name appears in a tooltip. A small counter sits at the top right of its
button, while a dot at the bottom right indicates new activity since the last view. Clicking a
button opens that tab below the chat with its name and an X in the header. Clicking the same
button or the X closes it; another button switches tabs. Drag the top handle or use the up and
down arrow keys to change the area's height. At least 160 pixels remain for the chat. The open
tab and height are stored per run in the browser, per VS Code window, and independently from the
full web view.

Once a mini-app is selected, three header buttons control the run-panel view: "Nur Chat" (chat
only, speech bubble), "Chat unten" (chat below, a sheet over the app), and "Chat rechts" (chat
right, beside the app). "Chat rechts" is the default. While the panel is narrower than the
configured width, that option is disabled and the chat stays below. "Nur Chat" gives the chat the
entire panel: the mini-app
recedes, nothing slides in or out, and an open sheet closes cleanly. Switching back rebuilds the
mini-app, so unsaved input in it is lost. The choice is stored per run and survives a restart.
The extension can also open a mini-app as an editor tab in the center, which works well with
"Nur Chat" in the run panel.

In "Chat unten", the handle controls the expanded chat height. Dragging up makes it taller;
dragging down makes it shorter. The chosen height is stored per run. The collapsed chat always
shows only the handle, status, and complete input, including multiple input lines. Hovering or
writing opens the chat to the chosen height (90 percent of the panel by default). Dragging leaves
the chat open at its new height. Clicking the handle opens or closes it. With
keyboard focus on the handle, up and down change the height, Home and End select its limits, and
Escape cancels an active drag.

The collapsed chat keeps its rounded border, background, and shadow. The compact handle row
shows keyboard focus on the small grip itself.

The chip at the left of the chat input names the addressee, the actor your messages go to.
Clicking it opens the addressee list as a tree of who created whom, like the agent tree of a
coding assistant: the coordinator at the top, below it the agents and TypeScript actors it
started, below those their own subagents. Each entry shows the handle, a very short description
of its job, and its state: "arbeitet" (working), "wartet auf Eingabe" (waiting for your answer),
"wartet" (idle), or "gestoppt" (stopped). The description is the one given when the actor was
created, otherwise the first line of its first assignment, otherwise its display name. Four or
more similar siblings, such as 37 rule reviewers named `review-...`, collapse into one group row
with their shared handle prefix, their number, and a count per state; click it to open or close
it. A group that contains the current addressee opens by itself. With more than twelve actors a
search field appears above the tree; it matches every word against handle, display name, and
description and keeps the creators of each hit visible. Clicking an entry makes it the addressee
and closes the list. Hidden actors, as chosen with "Anzeige" in the footer, sit in their own tree
behind "ausgeblendete Actors"; picking one of them also shows it again. In runs recorded before
actors had descriptions, the description falls back to the first assignment or the display name.

The extension lives under `apps/vscode`. It works with all configured **servers at the same
time**; there is no single active connection. A server in the `ragents.connections` setting is
either a server (`name` and `url`; it connects automatically when activated and its card asks
for sign-in in the panel) or a local profile (`name` and `profileFile`, the path to a
`ragents.config.<profile>.ts`). When activated, the extension starts a local profile silently in
the background with `--port 0`. The page shows "startet" (starting) and then "bereit" (ready), so its card and
templates are immediately available; a stopped local profile can be started again from its chip. The
host runs until the VS Code session ends and terminates with it, even if the window reloads, VS
Code crashes, or it is forcibly closed. Before starting, the extension provisions the profile's
tools; the web interface comes finished with the host. With a checkout as host, the host refuses
to start while its built-in bundles or its web interface are outdated and names the build
command. If a server distributes a client profile, the extension
fetches it after sign-in like `pnpm connect`, starts its host locally, and supplies the token as
`RAGENTS_TOKEN`. If `ragents.hostPath` is empty and the extension is not running from a checkout,
as with an installed `.vsix`, it downloads the host itself:
`npm install --prefix <globalStorage>/hosts/<paketfassung> @schlenkr/ragents@<paketfassung>`,
using the `npm` available on `PATH`. For a distributing server, that server specifies the version
through `ragents.profile.describe`; for a local profile, the extension supplies its own
`ragents.packageVersion` from `package.json`, keeping extension and host compatible. npm progress
and output appear in the `RAgents` output channel. Downloaded versions remain installed, and a
failure appears as the reason in the server row. A local profile therefore no longer needs
a checkout. `ragents.hostPath` remains an override pointing to a checkout or installed package.
The status bar shows the number of connected servers and opens the start page when clicked. See
the root `README.md` for details.

Install the extension from the Marketplace as `purestate.ragents-vscode` using "Extensions:
Install Extension" or `code --install-extension purestate.ragents-vscode`. To install a locally
packaged file, run `pnpm package:vscode` (task `vscode: package`), which builds
`dist/ragents-vscode-<version>.vsix`, then use "Extensions: Install from VSIX" or
`code --install-extension dist/ragents-vscode-<version>.vsix --force`. The `vscode: install`
task (`scripts/vscode/install-local.sh`) performs both steps, rebuilds the built-in plugins, and
rebuilds the web interface if it no longer matches its sources, so that hosts from this checkout
start again. The script then restarts manually launched
servers (`scripts/start.sh`, identified by `RAGENTS_LAUNCH=start.sh` in their environment, with logs under
`<data-directory>/logs/server-<time>.log`) and waits for `/health`. Hosts started by the extension
are left alone and restart with the reload. Afterward, reload VS Code with "Developer: Reload
Window" and reopen the run panel. If `code` is not on `PATH`, it is available at
`/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code`. An installed extension
needs no checkout; it fetches the host from `@schlenkr/ragents` when first required by a
distributing server.

The extension is an app with four pages: Start, Runs, the run panel, and "Server". All appear in
the RAgents panel of VS Code's secondary sidebar. Navigation and commands live in the view title
bar, following VS Code conventions: Start (home), Runs (list), Server (gear), "Neuer Run" (new run), and "Aktualisieren" (refresh). They remain available
while the panel shows a run. Start has no separate page header; Runs and Server show their
title next to a back arrow to Start, and the run panel's back
arrow also returns there. There is no Explorer tree in the activity bar. The view badge counts
pending inputs across all servers.

**Start** begins with **Server**. Equal-width chips appear two per row at 420 pixels and in
a single row from 560 pixels. Each chip is a split button. Its left side shows a status icon,
name, and when needed an action label: none for a connected or ready server (clicking opens
Runs filtered to it), "Anmelden" (sign in) when authentication is required or access was denied,
"Erneut versuchen" (try again) when unreachable or failed, "Starten" for a stopped local profile,
and "Verbinden" (connect) for a stopped server. "startet ..." (starting) is not a button. A monospace line below identifies the server:
`local / <profile>` for a local profile, the server host and non-default port, or `<host> / local`
when a server distributes a client profile whose host runs here.

The right side contains a plus button for a new run. If the server's profile defines
`defaultStartEntry` (see [profiles.md](spec/profiles.md)), it starts that template; otherwise it
starts an empty chat. Without permission to start, an equally wide empty space remains. For a
failed, unreachable, or rejected server, its status icon is also a button. It opens a
popover with the status, full selectable message, "Ausgabe öffnen" (open output), and either
"Erneut versuchen" or "Anmelden". A lock opens the same sign-in dialog.

Below that, **Weiter** (continue) shows the five most recent runs from all servers in a fixed-column
grid with status, title, right-aligned time, and, when more than one exists, server. "Alle N
Runs" opens the Runs page. **Neu** (new) appears when at least one server is reachable and permits
new runs. Entries are grouped by server when needed. The first entry is its default template,
marked "Standard" (default), or "Neuer Chat" (new chat) in the "Ohne Vorlage" (without template)
category. Remaining templates follow,
without duplicating the default. Clicking an entry creates and starts the run on its server
and opens the run panel.

The new run uses your open folder as its workspace, asking you to choose when several are open.
If the template defines its own workspace, such as one server folder per run, VS Code does not
ask. Until content appears, the panel shows a progress bar and the current step: starting,
loading, preparing, or setting up. A startup or setup error appears in the same place while the
chat input remains usable. The loading state disappears with the first mini-app or chat item; an
empty chat without a template does not show it. VS Code never displays the run panel's run-list
view. If a run cannot be started, for example because the user may not create runs, the panel
explains why and offers "Zur Start-Seite" (back to Start). For a new run, the visible chat input receives focus as
soon as it becomes writable. Opening an existing run does not move focus there automatically.

**Runs** shows the complete list in the same grid, with search, "Beendete ausblenden" (hide finished), a server
filter carried over from Start, and a selection mode that deletes several runs after a dialog
confirmation. Checkboxes occupy an additional first column without shifting the others.

**Server** is the configuration page. You can add, edit, sign in, sign out, connect,
disconnect, and remove servers with confirmation, then open `settings.json` from the link
at the bottom.

Every status uses a colored icon and a tooltip with the same vocabulary everywhere. A run is
"läuft" (running), "wartet auf Eingabe" (waiting for input, with the number of open inputs),
"ruht" (idle), "beendet" (ended), "fehlgeschlagen" (failed), or "abgebrochen" (cancelled). A
server is "verbunden" (connected), "bereit" (ready), "startet" (starting), "Anmeldung nötig"
(sign-in required), "nicht erreichbar" (unreachable), "gestoppt" (stopped), "gescheitert"
(failed), or "kein Zugriff" (no access). Time is compact and omits "vor" (ago): `jetzt`, `5 min`,
`3 h`, `2 d`, then a date after seven days. A function or mini-app name never appears as a status.
Status icons never resemble a stop button: cancelled is a slashed circle, ended a check mark, and
idle or stopped an empty circle. Actual stop buttons consistently use a filled red square: "Run
stoppen" (stop run) in the run-panel header and run menu, "Arbeit stoppen" (stop work) beside the
chat input, and the stop controls for run processes.

Stopping work in a chat and stopping the run are different things. "Arbeit stoppen" appears in a
chat input only while that chat's own actor has a turn running, and it interrupts just that turn:
the text already written stays, running function calls are cancelled, and the actor stays active
and answers the next message. Actors it has started keep working, and when only another actor is
busy, the input pulses but offers no stop. To end everything, use "Run stoppen" (stop run) with its
confirmation; to stop a single actor for good, use "Stop" on its actor card. If a chat's actor has
been stopped, the input is replaced by `@handle gestoppt: <reason>` and, with permission to operate
and inspect the run, "Neu starten" (restart). Restarting the former primary actor makes it the
primary actor again, and the run chat continues.

The arrow on a mini-app in the run-panel stage opens it as a central editor tab; "Zurück ins Panel"
(back to the panel) closes the tab. Text artifacts and the journal open as read-only documents, while other artifacts
open in the browser. `RAgents: Neuer Run` uses a Quick Pick grouped by server and template.
The first entry for each server is its default, marked "Standard", or the free task without
a template. The commands `RAgents: Trennen` (disconnect), `RAgents: Verbinden` (connect), and
`RAgents: Abmelden` (sign out) apply to the selected run's server or ask when several match.

When the run chat has focus, VS Code shortcuts such as Cmd/Ctrl+P and Cmd/Ctrl+Shift+P still
work using your keybindings. Text entry, selection, undo, and clipboard actions remain in the
input field. Keys already handled by chat, such as Enter to send, are not also executed as VS
Code commands.

If a server profile requires users, both the lock on Start and the Server row open the
same sign-in dialog. For a profile with `ACCESS_TOKEN`, the dialog requests that token. User name
and password are stored per server address in VS Code SecretStorage and reused silently next
session. The session token is stored there as well and sent as a bearer token; iframes receive it
in their URL (the server accepts a bearer token or the `access` query parameter for GET requests).
After expiry or a server restart, that server asks for sign-in again without affecting others.
`RAgents: Abmelden` revokes the session.
<!-- /guide:clients -->

## Einstellungen und Verhalten der VS-Code-Erweiterung

- `ragents.theme` (`auto`, `light`, `dark`) wirkt sofort.
- `ragents.hostEnvironment` führt die Namen der Umgebungsvariablen, die ein lokal gestarteter
   Host zusätzlich zur geerbten Umgebung bekommt. In der Einstellung stehen nur Namen; die Werte
   legt der Befehl "RAgents: Secret setzen" in die SecretStorage von VS Code, "RAgents: Secret
   löschen" nimmt sie wieder heraus. Beim Start eines Hosts liegen die gespeicherten Werte über
   der geerbten Umgebung; fehlt einer, nennt der Kanal `RAgents` nur seinen Namen, nie einen Wert.
   Damit startet ein Profil, das Werte über `env("NAME")` auflöst, auch in einem VS Code, das
   ohne die Variablen der Shell aus dem Dock kommt.

Ist ein Server nicht erreichbar, zeigt seine Zeile auf der Seite Server die Ursache und "Erneut versuchen", auf Start
steht dieselbe Meldung hinter dem Zustandssymbol des Chips, und die
Sitzung versucht es alle fünf Sekunden von selbst; die Liste wird verbunden ohnehin alle fünf
Sekunden neu geladen, der Ereignisstrom verbindet nach fünf Sekunden neu und meldet die
Unterbrechung als Zeile unter seinem Server. Die Erweiterung wird erst beim Öffnen einer ihrer
Ansichten aktiv und verbindet sich nicht im Hintergrund.

Grenzen: keine Codeaktionen, keine Dateisynchronisation, kein Betrieb ohne Server. Ein lokales
Profil zeigt seine Vorlagen erst nach dem Start.

<!-- guide:clients -->
## Control RAgents as an agent

An AI agent working on the same machine controls RAgents through four `ragents` subcommands. In
a checkout, use `pnpm ragents <command>`. These commands are the agent-facing contract: each one
waits for the turn to end and returns an exit code.

```sh
ragents provision developer                                  # once per machine
ragents run selftest/workspace-project "Fix the type error in src/broken.ts"
ragents send <runId> "Read README.md and report the passphrase"
ragents journal <runId> --tools
ragents stop <runId>                                         # interrupt the primary actor's active turn
ragents stop <runId> --run                                   # emergency stop: halt the whole run
ragents stop --host                                          # stop the remembered host
ragents --help                                               # same as ragents help
```

`run` checks `GET <address>/health` to see whether the profile host is already running. If not,
it starts a detached process with its log at `<data-directory>/host.log`, then records the
address and PID in `<data-directory>/host.json`. It creates a run bound to the absolute folder as
an existing folder on the server (binding `{ machine: "server", folder: { path } }` through
`ragents.startOptions.select`), sends the task (`ragents.chat.send`), and follows
the turn triggered by its message until it ends. Like the web interface and VS Code, it subscribes
to the `ragents.run` channel and reads `ragents.runs.view` after every change, so it needs only
`runs.read` and also works against a server with a different data directory or on another machine.
If the profile does not provide `ragents.workspace.binding` because it creates its own workspace,
the folder remains unbound and the command reports this on stderr.

The folder is optional: `ragents run "<task>" [--entry <template>]` selects no binding, so the
profile's default or the template's fixed start options apply. A single value is always the task,
even if it looks like a path; with two values the first is the folder. If the template fixes
`ragents.workspace.binding` (`fixed-start-options`) and a folder is given anyway, the command fails
with that cause before it creates anything on the server. `--workstation` requires a folder.

`--workstation <id>` binds the folder on the workstation registered at the host under that ID
instead of the server (binding `{ machine: { client, label }, folder: { path } }`, the label taken
from the registered workstations); `<folder>` is then the path on that workstation. The
counterpart is `pnpm workspace-client <server-url> <folder> --id <id>`. Without a registered
workstation of that ID the command fails and names the registered ones.

`--entry <template>` additionally starts the run through a skill or script template. If that program
chooses its chat partner during setup, the task waits instead of failing. `send` performs the
same operation in an existing run. `journal` reads the history from the profile's data directory
without a server, using the same code as `pnpm driver journal`; with `RAGENTS_URL` set, it reads it
from the server through `ragents.runs.events`, which requires `runs.inspect`. `stop <runId>`
interrupts only the active turn of the run's primary actor through `ragents.runs.interruptTurn`,
exactly like the stop button in the chat input: the run and all actors stay active and accept the
next task, and without an active turn nothing happens. `stop <runId> --run` is the emergency stop (`ragents.chat.stop`): it aborts every turn
and stops all actors of the run. `stop --host` terminates exactly the PID in `host.json`, never a
process pattern, and only if the host at the recorded address reports that same PID from
`/health`; otherwise it fails, leaves the process alone and removes the stale record. `ragents --help` and `ragents help` show usage and exit with 0; invoking the
command without arguments is an error with exit code 1.

`--profile <profile|path>` selects something other than `developer`: a profile name beside the
host or the path to a custom `ragents.config.<profile>.ts` anywhere on disk. Resolution matches
`ragents start` and is relative to the caller. `RAGENTS_PROFILE` selects the same profile for all
commands in a shell. The file name determines the profile name, while the profile file supplies
the port and data directory as it does for the server. `stop --host` can therefore find the host
for that exact profile:

```sh
export RAGENTS_TOKEN="$MY_RAGENTS_TOKEN"
ragents run ~/projects/example "Implement work item 1234" \
  --profile ~/profiles/ragents.config.custom.ts \
  --entry custom.tickets.implement-task
ragents stop --host --profile ~/profiles/ragents.config.custom.ts
```

If the profile requires sign-in through `users`, `RAGENTS_TOKEN` must contain the personal token
declared for that user as `token: env("...")` (see `docs/spec/profiles.md`). A password alone is
not enough because the command has no sign-in dialog. If the token is missing, the command says
that the profile requires authentication and asks you to set `RAGENTS_TOKEN` to the user's
personal token.

stdout contains function calls (`> <name>`, then `< <name> <duration>s ok`, `Fehler`, or
`abgebrochen`) as far as the server shows them to the user (`runs.inspect`), the model response,
and finally the fixed line `run: <id>`. Messages from the command itself go to stderr. With
`--json`, the same steps are emitted as newline-delimited JSON instead (`tool`, `tool-end`,
`output`, and finally `turn`, carrying the objects of the run view). Exit code 0 means the turn
completed; 2 means it was interrupted; 1 means a failed turn or connection problem. If the event
stream or a request breaks while the command waits, it fails with the cause instead of hanging;
the turn may continue on the server.

The address comes from the profile's `host.json`, then `RAGENTS_URL`, then `host.PORT` in the
profile file. When authentication is required, `RAGENTS_TOKEN` is sent as a bearer token. The
data directory is the server's `DATA_DIR`, then `host.DATA_DIR`, then
`~/.local/share/ragents/<profile>`; only `journal` without `RAGENTS_URL` reads from it directly
(`<data-directory>/runs/<runId>/journal.jsonl`). A host started this way also serves the web interface, which comes finished with the host;
`ragents start developer` (or `scripts/start.sh developer` in a checkout) starts it in the
foreground instead. `ragents start` writes the same `host.json` and removes it on shutdown,
so `stop --host --profile <profile|path>` handles either startup path. Only `--port 0` cannot be
remembered because it chooses its own port. The short guide for agents is in
`skills-for-agents/ragents/SKILL.md`.

## Drive runs from external clients

`pnpm driver` (`scripts/driver/run-driver.ts`) creates and controls runs without an interface and
analyzes their journals. It is a testing tool for custom runs and later analysis. An agent should
use `ragents run` instead because it waits and returns meaningful exit codes:

```sh
PRODUCT_PROFILE=showcase pnpm driver new-run                 # creates a run and prints its ID
PRODUCT_PROFILE=showcase pnpm driver send <id> @coordinator "Task ..."
PRODUCT_PROFILE=showcase pnpm driver journal <id> --since 120 --tools
PRODUCT_PROFILE=showcase pnpm driver usage <id>              # model calls and tokens per actor
PRODUCT_PROFILE=showcase pnpm driver stop <id>              # interrupts the primary actor's turn
PRODUCT_PROFILE=showcase pnpm driver stop <id> --run        # emergency stop for the whole run
```

`new-run` starts a run script; without an argument it uses `ragents.reference.shared-actor-list`,
which only `showcase` contains, and `new-run <template>` selects another one.

The address comes from `host.PORT` in the profile file, with `RAGENTS_DRIVER_URL` as an override;
the data directory comes from `DATA_DIR` or the profile default. If the profile defines users,
`RAGENTS_DRIVER_USER` is required. The driver reads that user's password from the same profile
file and signs in through `POST /api/access/login`. If `ACCESS_TOKEN` is set, it sends that as a
bearer token instead. The driver uses `ragents.chat.start`, `ragents.chat.sendToActor`,
`ragents.runs.view` with `ragents.runs.interruptTurn` for `stop`, `ragents.chat.stop` for
`stop --run`, and `ragents.runs.list`, while reading the journal directly from
`${DATA_DIR}/runs/<uuid>/journal.jsonl`.

The same methods are available to any client. The API uses JSON-RPC 2.0. Over HTTP, `POST /rpc`
accepts one message per request, while `GET /rpc/stream` delivers server notifications and
requests as Server-Sent Events:

```sh
curl -s http://localhost:4710/rpc -H 'content-type: application/json' \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"ragents.runs.list","params":{}}'
```

The response contains either `result` or `error`; `error.data` provides `code` and `status`.

Without HTTP, use stdio: `pnpm start -- --stdio` exchanges one JSON message per line through
stdin and stdout and opens no port. The startup modes are:

- `--stdio` without `--port`: stdio only, no HTTP server.
- `--port 0`: a private port; the server reports it on stdout as
  `{"ragents":{"url":"...","token":"...","pid":1234}}`.
- `--port N`: fixed port N instead of `host.PORT` from the profile file.
<!-- /guide:clients -->
