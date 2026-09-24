# RAgents: Überblick

Die Spec beschreibt, was ist, gültig für den aktuellen Stand des Codes. Sie besteht aus sechs
Kapiteln unter `docs/spec/`:

- `overview.md`: Leitsatz, Begriffe, Schichten, Kurs und verbindliche Regeln.
- `core.md`: Run, Actor, ActorInput, Turn, Event, Subscription, Journal, Scheduler, Stopp-Pfade.
- `typescript-platform.md`: die gemeinsame TypeScript-Ausführungsplattform, TypeScript-Actors und
  Run-Scripts.
- `actor-programs.md`: Actor-Programme mit Funktionen, intrinsischem Zustand und React-Views.
- `plugins.md`: Plugin-Vertrag, Plugin-Ordner, Web als Plugin-Host, Startseite und Vorlagen,
  Language-Server-Plugins, Skill-Vorlagen.
- `profiles.md`: Profile und Konfiguration.

Jedes Kapitel endet mit seinen offenen Grenzen. Was noch nicht ist, steht in `docs/concepts/`.
Das Warum jeder Änderung steht als datierter Eintrag in `docs/decisions.md`, die Bedienung in
`docs/usage.md`, der Betrieb in `docs/operations.md`. Die verbindliche Event-Liste steht nur im Code
(`packages/ragents/src/domain/events.ts`), ebenso Plugin-Vertrag und Actor-Programm-Schemata
(`packages/ragents/src/plugin-types.ts`, `apps/server/src/plugin-support/actor-programs/app-project.ts`).

<!-- guide:ideas -->
## AI and TypeScript work together

RAgents is a workspace where AI agents, TypeScript programs, and small interfaces work on a
task together. You can describe a task in the chat or start a prepared sample. The AI can set
up the required participants and programs itself; a sample comes with that setup already in
place.

TypeScript is the AI's primary way of working. It writes small programs that call available
functions and combine their results. A function can read a file, create an agent, or deliver a
message. The workspace provides these functions, so the model does not have to reinvent their
implementation.

## Code controls the workflow, models provide the contributions

In the word game, four models provide words one after another. The TypeScript program decides
whose turn is next, passes along the latest result, and ends the round after twelve
contributions. The models choose the words. The workflow therefore remains deterministic even
though its content only emerges while it runs.

For an open-ended task, the AI can also perform several related steps in a short TypeScript
snippet. When the snippet returns its results, the model decides what to do next. Persistent
actor programs are available for workflows that need to react to later responses. The
[TypeScript guide](../homepage/guide-functions.html) explains both forms.

## Actors are the participants in a run

A run brings together a task, its participants, working files, and events. Its participants are
called actors. An LLM actor processes messages with a model; a TypeScript actor uses its
program. A coordinator is itself an LLM actor that can assign work to other participants. A
prepared sample can also operate without a coordinator.

The word game has four LLM actors for the words and one TypeScript actor for the workflow. In
the learning-afternoon sample, two LLM actors work in parallel while the program collects their
ideas. Actors retain their own state between tasks. An LLM actor's conversation history, its
programmed data, and the shared journal each serve a different purpose.

## Messages and events connect the work

A message assigns a task to an actor. The actor processes it in a turn and produces events,
such as a completed response. Other actors can subscribe to matching events. They then receive
a new message and can continue working. In the word game, every completed response invokes the
program again so it can assign the next actor.

The journal records what happens. This makes tasks, responses, and errors traceable. Restoring
the journal does not execute the recorded work again. The
[runtime guide](../homepage/guide-runtime.html) explains how the pieces fit together.

## Mini-apps make the work interactive

An actor can have a small interface: a mini-app on the surface. It displays the actor's data
and calls its functions. In the word game, this interface contains the start button, progress,
and word list. On the collection board, both an AI assistant and a person can add entries to
the same list.

Chat and interface are therefore two ways to access the same work. A mini-app can belong to an
LLM actor or a TypeScript actor. [Build mini-apps](../homepage/guide-programs.html) shows how
functions, state, and interface connect.

## Plugins provide capabilities and reusable setups

A plugin can add file functions, questions, or interface components, for example. A profile
selects the workspace's plugins and settings. A skill tells a model how to approach a
task. A run script, by contrast, provides the programs for a prepared setup.

Run scripts can provide a reusable setup and its interface while model responses remain
variable. Skills and prepared workflows appear as selectable templates when the active profile
provides them.
<!-- /guide:ideas -->

## Produkt

RAgents ist ein programmierbarer AI-Harness mit einer Weboberfläche: Chat, Agenten und kleine
Bedienoberflächen auf einer gemeinsamen Fläche. Agenten können mit unterschiedlichen Modellen arbeiten;
die ausgelieferte Modellanbindung läuft über OpenRouter. TypeScript-Actors steuern feste
Abläufe; TypeScript- und LLM-Actors können eigene Funktionen, Zustand und React-Views besitzen. Plugins erweitern die
Arbeitsumgebung um typisierte Funktionen, Prompts, Dienste und UI; ein Profil stellt sie zusammen.
Die Oberflächen eines Actors heißen in der Benutzeroberfläche, auf der Homepage und in den
erzeugten Referenzen Mini-Apps. Technisch sind sie React-Views eines Actors.
Skill-Vorlagen werden nach einer verpflichtenden, frei benannten Kategorie gruppiert. Die
neutrale Referenz stellt Mini-Apps an den Anfang; Schlagworte ergänzen Suche und Filter.

Kleine TypeScript-Snippets führen einmalige Aufgaben und Aufbauaufrufe aus, ohne einen eigenen
Actor zu benötigen. Snippets und dauerhafte Actor-Programme verwenden dieselben typisierten
Funktionen der Plugins über `context.functions`. Ausgerüstete Modelle erhalten automatisch
die verfügbaren Funktionsnamen mit Kurzbeschreibungen, laden die Details über `typescript_api`
und führen Snippets mit `typescript_eval` aus. Diese beiden Werkzeuge gehören
zur Server-Grundausstattung, unabhängig vom optionalen Plugin für Actor-Programme. Fachliche Aufträge beschreiben
das gewünschte Ergebnis; die technische Umsetzung erschließt das Modell aus der Umgebung.
Ein vorbereitetes Setup kann durch ein Run-Script aufgebaut werden. Skills verbinden
Arbeitsanweisungen für Agenten mit optionalen bearbeitbaren Startaufträgen und ergänzenden
Dateien; TypeScript kann Aufbau und spätere Übergaben festlegen, während Modellantworten
variabel bleiben. Die Produkt-Homepage unter `docs/homepage/index.html` erklärt diese Verbindung
anhand des Profils `showcase` und seiner Referenzvorlagen. Der Einstieg stellt programmierbare
Setups in den Vordergrund. Jede Kernfunktion hat auf der Homepage drei Stufen: einen
farbigen, leicht gedrehten Sticker im Einstieg mit höchstens zwei Zeilen Text als Themenlink,
einen Abschnitt auf der Hauptseite mit Konzept, Nutzen, einem Funktionsschema und dem Link
"Mehr über ..." in ein Guide-Kapitel, und dieses Guide-Kapitel aus markierten Abschnitten der
Spec, der Bedienung oder des Betriebs. Die Abschnitte tragen `data-core-feature`; die
Homepage-Prüfung verlangt je Kernfunktion genau einen Sticker, einen Abschnitt und einen
Guide-Link, und einen Sticker ohne Abschnitt oder einen Abschnitt ohne Guide-Kapitel gibt es
nicht. Sieben Sticker erschließen Setups, Mini-Apps, Agenten, die miteinander reden, KI mit
festen Abläufen, das Journal, verteiltes Arbeiten und die drei Zugänge Web, VS Code und Konsole. Auf
kleinen Ansichten stehen sie unter dem Einstiegstext. Der Einstieg hat unter den Stickern
zusätzlichen Abstand; seine Hintergrundfarben und Kreise laufen weich ins Weiß der folgenden
Abschnitte aus. Die Funktionsabschnitte nennen unter ihrer Konzeptüberschrift in einem kurzen
Schlagsatz den Nutzen; nummerierte Oberzeilen entfallen. Danach folgt eine eigenständig
verständliche Einführung: was das Konzept ist, welche Rolle es im Run hat und wie
es mit den anderen Beteiligten zusammenarbeitet. Die Hauptseite sagt je Fähigkeit einen Satz,
nicht mehr: Technische Regeln und Bedienungsdetails (Knöpfe, Abstände, Pixelmaße,
Tastaturwege, Speicherorte je Browser) stehen in `docs/usage.md` und damit im Guide, nicht
auf der Hauptseite; wer eine Bedienung ändert, ergänzt dort und nicht hier. Die Hauptseite
erklärt zuerst die Konzepte unabhängig von einzelnen Anwendungsfällen. Überschriften benennen
die Konzepte, nicht die Samples. Die Vorschauen sind ausdrücklich als Beispiele für das
jeweilige Konzept beschriftet. Die Hauptseite enthält keine Startanleitungen oder technischen
Exkurse zu Layout, Modellkonfiguration und Werkzeugverträgen.

Eine zusammenhängende Funktionsstrecke beginnt mit Setups als programmierbaren
Arbeitsumgebungen. Es folgen Agenten, die miteinander reden, TypeScript als Arbeitsweg der KI
sowie Werkzeuge und Mini-Apps. Die Texte stehen links im normalen Dokumentfluss. Ab 960 Pixeln
Breite hält CSS rechts einen gemeinsamen Rahmen unter der Kopfzeile fest. GSAP ScrollTrigger
wechselt dessen Inhalt beim Erreichen des nächsten Textabschnitts; Position und Größe des
Rahmens bleiben während der Schritte stabil. Die eingebetteten Vorschauen melden ihre
Inhaltshöhe; Frames und Vorschau wachsen mit, auch nach eigener Bedienung. Es gibt keinen
zusätzlichen Scrollbereich innerhalb der Vorschauen. Passt die Vorschau nicht vollständig unter die Kopfzeile,
stehen Texte und Vorschauen paarweise im normalen Seitenlauf. Das gilt auch bei reduzierter Bewegung.
Die Fixierung benötigt keine DOM-Umsortierung: Alle Darstellungen und die Mini-App bleiben
permanent in derselben Vorschau. Mobil und ohne JavaScript ordnet CSS die Texte und Bilder paarweise
an. Vier Sprunglinks unter der festen Vorschau führen zu den Textabschnitten. Erst am Ende der
vierten Funktion scrollt die Vorschau mit der Seite weiter.

Die Scrollposition steuert konkrete, schematisch dargestellte Referenzabläufe. Das Setup zeigt
die drei Aufbauaufrufe des Run-Scripts `shared-actor-list`: Listenhelfer anlegen, Listenprogramm
anbinden und den ersten Eintrag beauftragen. Daraus entstehen ein Helfer und seine bedienbare
Liste mit dem tatsächlichen Standardtext des Scripts. Das Agentenbild zeigt zwei parallel
entstehende Ideen für einen Lernnachmittag und ihre automatisch ergänzte gemeinsame Ergebnisliste.
Beim Wortspiel bestimmen feste Regeln die Reihenfolge Rot, Gelb, Blau, Grün und den Stopp nach
zwölf Beiträgen; die Wörter wählen die Modelle. Zähler, Übergaben und wachsendes Dokument machen
den Unterschied zwischen programmierten Regeln und variablen KI-Beiträgen sichtbar.
Lernnachmittag und Wortspiel verwenden die View-Komponenten ihrer vorbereiteten Run-Scripts.
Der Konzepttext erklärt die allgemeine Arbeitsweise, die Bildunterschrift ordnet das konkrete
Beispiel zu. Der Lernnachmittag veranschaulicht parallele Agenten, das Wortspiel programmierte
Abläufe und das Sammelboard gemeinsame Daten von Mensch und Agent. Die Konzepte bleiben
ohne Kenntnis dieser Samples verständlich.
Die lokalen Vorschauen zeigen gekennzeichnete Beispieldaten und rufen keine Modelle auf.
Die Vorschauen ändern ihren Inhalt nur durch eigene Bedienung; Scrollen ändert weder
Sample-Zustand noch Framehöhe. Die Größenanpassung beginnt nach dem Laden aller Vorschauen.
Während einer Größenmeldung entsteht kein innerer Scrollbalken.
Die verlinkten Samples bringen denselben Aufbau und dieselbe Oberfläche für einen echten Run mit.
Der Mini-App-Abschnitt zeigt die tatsächlich bedienbare gemeinsame Liste aus dem
Referenzvorlage `shared-actor-list` in einem Iframe. Oberfläche, Listenfunktion, Controls und
Styles stammen aus dessen Originalquellen. Ein lokaler Browseradapter ersetzt den Run-Zugriff;
die Demo startet keinen Run und sendet keine Eingaben an einen Server. Sie beginnt mit einer
gekennzeichneten Beispielnotiz. Weitere Einträge entstehen nur durch die Bedienung der Liste;
Scrollen verändert weder Einträge noch ungesendeten Text. Die Demo ist als lokal beschriftet und benötigt JavaScript. Eine Content Security Policy
mit `connect-src 'none'` sperrt Netzwerkverbindungen aus der Demo im Browser.
`scripts/homepage/homepage-mini-app.ts` erzeugt und prüft ihre drei lokalen Assets `mini-app.html`,
`mini-app.js` und `mini-app.css`; sie gehören zum statischen Export und zur eingebetteten Hilfe.

Die Konzepttexte bleiben zugänglich; nur inaktive Darstellungen sind
für Tastatur und Screenreader ausgeblendet. Die Seite verändert weder Mausrad- noch
Touch-Ereignisse und rastet nicht ein. Auf kleineren Ansichten steht jede Darstellung bei ihrem
Text. Die Funktionsschemata für Setup, Ereignisse und Fläche animieren während ihres Wegs
durch den Viewport. Diese Animationen sind direkt
an den Scrollfortschritt gebunden, stehen bei unveränderter Scrollposition still und laufen
beim Zurückscrollen rückwärts. Ohne JavaScript und beim Drucken bleiben Erklärung und Links
auf die Samples lesbar; die lokalen React-Vorschauen benötigen JavaScript. Bei reduzierter Bewegung bleibt die Mini-App
bedienbar. Im normalen Seitenlauf trennt ein Abstand die aufeinanderfolgenden Beispiele;
Konzepttext und Vorschau beginnen jeweils oben in ihrer Zeile. Änderungen der Fensterbreite wechseln zwischen fester Vorschau und
paarweiser Darstellung; die Bewegungseinstellung steuert nur Animationen. Geöffnete Details
aktualisieren die Scrollgrenzen. Maßgeblich ist der Viewport der Homepage, in der eingebetteten Hilfe also
das kleinere Iframe. Die Vorschau richtet ihre Höhe nach den Inhalten aus und bleibt nur bei
ausreichendem Platz fixiert. Die Mini-App-Controls bleiben bedienbar.

Danach erklärt ein beschriftetes Schema die gemeinsame Fläche und den
Run. Ereignisse und Abonnements sowie das Journal ergänzen die Kernfunktionen
in einem eigenen Abschnitt. Die Seite bleibt eine Folge von Abschnitten in einer Spalte;
Text und Grafik stehen auf breiten Ansichten nebeneinander, mobil untereinander. Jeder
Funktionsabschnitt nennt Nutzen, ein vorhandenes Referenzbeispiel und einen passenden Link zur
Vertiefung. Rückfragen und Dateien ergänzen die Funktionsübersicht. Ein farblich abgesetzter
Entwicklungsbereich erschließt Plugins, Profile und die Referenzen für Menschen und Modelle.
Vorhandene Vorlagen und Installation folgen anschließend; Grenzen und Anwendungsideen stehen
im letzten Abschnitt.
Ein Funktionsschema zeigt, wie ein abgeschlossenes Agentenergebnis über passende Abonnements
als Nachricht an Agenten und TypeScript-Actors gelangt: Erst erreicht es den Filter, dann beide
Empfänger. Im Schema der Fläche folgen auf die Auftragsannahme die Bearbeitung und eine nutzbare
Mini-App; das Journal hebt die zugehörigen Arbeitsschritte hervor. Das Journal besitzt ein
interaktives Replay-Lesebeispiel ohne Server; ohne JavaScript bleiben alle Einträge und der
Endzustand lesbar. Icons und Funktionsschemata sind direkt als HTML und SVG eingebettet und
zeigen keine echten Runs. Das Schema der Fläche übernimmt den matten, warm graulila Hintergrund
und die geraden Tiefenkörper des Schichtwerk-Stils. Lavendel, Ton, Senfgelb und Kalkweiß
unterscheiden Koordinator, weitere KI-Actors, TypeScript-Actors und Mini-Apps. Abgerundete Kanten,
Konturen und nach rechts oben gestufte Seitenflächen machen die Tiefe sichtbar. Aktuell sind keine
Screenshots eingebunden; neue Aufnahmen müssen echte Runs des Profils core im aktuellen
Oberflächenstil zeigen.

Die Kopfzeile mit Wortmarke und Hauptnavigation bleibt beim Scrollen sichtbar. Hauptseite,
Baustein- und Entwicklerreferenz verwenden dieselbe Kopfzeile: Der Generator übernimmt ihr
Markup aus der Hauptseite; `site.css` und `site.js` teilen Layout, mobile Darstellung und
Höhenmessung. Menüeinträge und Reihenfolge bleiben auf allen Seiten gleich, Themenlinks der
Unterseiten führen zum jeweiligen Homepage-Abschnitt. Die aktuelle Referenzseite wird im Menü
markiert. Sprungziele berücksichtigen die Kopfzeilenhöhe. Eine zweite seitenweite feste
Navigationsleiste gibt es nicht. Weitere Funktionsabschnitte erscheinen beim ersten Erreichen
mit einer kurzen Einblendung. Eine schmale Linie an der Kopfzeile zeigt den Lesefortschritt.
Diese zusätzlichen Effekte laufen auf Geräten mit Hover und werden bei reduzierter Bewegung
deaktiviert. `site.js` verwendet GSAP, ScrollTrigger und MotionPathPlugin aus dem lokal erzeugten
`scroll-vendor.js`; `scripts/homepage/homepage-motion.ts` bündelt die festgelegte Paketversion
einschließlich Lizenzhinweisen. Der Homepage-Build erzeugt und prüft dieses Asset und übernimmt
es in den statischen Export. Nur die Hauptseite lädt es. Es gibt keine externen
Laufzeitressourcen; Texte und Schemata bleiben ohne JavaScript lesbar. Refactoring- und
Unternehmensabläufe sind im letzten Abschnitt als Anwendungsideen gekennzeichnet.
Die intern erzeugten Textfassungen `reference.md` und `developer.md` bilden die Baustein- und
Entwicklerreferenz; sie gehören nicht zum öffentlichen Export und werden von der Produktseite
nicht verlinkt. Ihre Seiten- und Themeneinstiege erklären den jeweiligen
Baustein vor den technischen Verträgen und Codebeispielen. Der Generator unter `scripts/homepage/` liest neutrale Werkzeuge,
Schemas, UI-Verträge, Mini-App-Vorlagen und die Vorlagen der Startseite aus dem Code. Kleine Entwicklungsbeispiele
erklären die Erweiterungspunkte; Vertragsabdeckung und generierte Dateien werden geprüft.
Die Referenzgenerierung komponiert die Plugins isoliert mit vorhandenen öffentlichen
Katalogmodellen; Netzaufrufe und Modellaufrufe sind dabei gesperrt.
Private Profile, Konfigurationswerte und Laufzeitdaten gehören nicht zu diesen Seiten.

`guide.html` erschließt neun zusammenhängende Kapitel: Grundideen, Laufzeit, Einstieg, die drei
Zugänge Web, VS Code und Konsole, verteiltes Arbeiten, TypeScript-Funktionen, Actor-Programme
und Mini-Apps, Plugins und Skills sowie Zugriff. Die Kapitel liegen als
`guide-<id>.html` und als Markdown vor. Ihre Texte stammen direkt aus ausdrücklich mit
`<!-- guide:<id> -->` und `<!-- /guide:<id> -->` markierten Abschnitten der Spec, von
`docs/usage.md` und `docs/operations.md`; mehrere Blöcke eines Kapitels werden in
Dokumentreihenfolge zusammengefügt, bei mehreren Quelldateien in deren festgelegter Reihenfolge.
Es gibt keine zweite redaktionelle Kopie. `scripts/homepage/homepage-guide.ts` hält Kapitelreihenfolge,
Seiteneinstiege und Verweise und rendert das Markdown mit Marked beim Build. Der Browser braucht
dafür weder eine Markdown-Laufzeit noch einen Dokumentationsserver. Kapitelübersicht,
Inhaltsverzeichnis und Weiter-/Zurücklinks verbinden Guide und technische Referenzen. Die
Seitennavigation gruppiert Verstehen, Ausprobieren, Selbst bauen und Nachschlagen. Auf kleinen
Ansichten ist sie aufklappbar; kompakte Titel lassen den Inhalt sofort beginnen. Die
gemeinsame Hauptnavigation markiert auf jeder Kapitelseite den Guide. Die Produktseite führt
für Installation, Laufzeit und Entwicklung in diese Vertiefung.

Nur markierte öffentliche Abschnitte werden exportiert. Fehlende, leere, verschachtelte oder
nicht geschlossene Markierungen sind Buildfehler, ebenso private Inhalte und ungültige lokale
Seiten- oder Sprungziele im Export. Interne Betriebsangaben, Entscheidungen und offene Konzepte
werden nicht pauschal veröffentlicht. Die Markdown-Kapitel stehen im LLM-Index; alle
Guide-Dateien gehören zum statischen Export und zur eingebetteten Hilfe.

Die mitgelieferten neutralen Referenzvorlagen sind Demos für RAgents-Konzepte und mögliche
High-Level-Testfälle. Sie sind als Anwendungsfälle und Konzeptdemos verschlagwortet. Die
Beispielübersicht wird aus diesen Tags und dem Konzeptkatalog des Referenz-Plugins erzeugt;
die Prüfung verlangt mindestens zwei Beispiele pro erfasstem Produktkonzept. Kundenspezifische
Abläufe gehören nicht zu diesem Katalog. Jede Skill-Vorlage enthält einen Prompt und zählt
als ein Beispiel. UI-Controls sind keine eigenen Demo-Konzepte und haben keine Beispielquote.
Die Demos kombinieren die für ihren Anwendungsfall passenden Controls; eine vollständige
Control-Abdeckung ist kein Ziel. Die Beschreibung jeder Demo-Vorlage erklärt, was sie zeigen
soll und wodurch sie sich von ähnlichen Fällen unterscheidet. Neue Produktkonzepte erhalten
mindestens zwei unterschiedliche neutrale Beispiele. Anwendungsfälle und Konzeptdemos sind zwei überlappende Perspektiven;
reine Bedienabläufe werden als solche in der Referenz beschrieben und nicht als ausführbare
Vorlagen ausgegeben.
Der UI-Katalog, seine Typabhängigkeiten und Props entstehen aus den exportierten Verträgen des
Mini-App-Plugins; die Prop-Tabellen decken die eigenen Bausteine ab, die shadcn-Komponenten
sind bei shadcn und Base UI dokumentiert. Die interaktiven UI-Demos zeigen dieselben Komponenten
wie die Mini-Apps. Compiler, Laufzeit-Nachschlagewerkzeug und Referenz verwenden denselben
Dateisammler; eine Prüfung gleicht die Verträge mit den tatsächlichen Komponentenexporten ab.
`llms.txt` erschließt diese Referenz für externe Modelle. Der gleiche Build erzeugt die
Textfassungen `reference.md` und `developer.md`, die Run-Setup-Anleitung `run-setup.md`,
`run-api.d.ts` unter `docs/homepage/`. Werkzeug- und
Ergebnisschemata, Kontextdeklarationen und vollständige Beispielpakete stammen aus dem Code.
Die veröffentlichte API beschreibt den statischen Bestand von showcase; ein konkreter Run-Build
verwendet weiterhin nur die für seine Identität freigegebenen und deklarierten Fähigkeiten.

## Entwicklungswerkzeuge

`scripts/maintenance/concept-audit.fsx` vergleicht den öffentlichen Guide mit neutralem Code und Tests.
Das externe F#-Entwicklerwerkzeug verwendet Microsoft Agent Framework über OpenRouter.
Mit `--duplicates` untersucht es stattdessen Doppelimplementierungen in Oberfläche/CSS,
Laufzeit und Plugin-Grenzen. Dieser Modus liest auch produktspezifische Plugin-Quellen;
Guide und Dokumentation gehören nicht zu seinem Korpus. Befunde nennen mindestens zwei
gelesene Quellenstellen, eine konkrete Folge und einen gemeinsamen Ersatz.
`--reasoning-high` fordert beim Modell ausdrücklich hohe Reasoning-Intensität an.
Die letzte erlaubte Modellrunde ist für den Bericht reserviert und erhält keine weiteren
Werkzeugaufrufe.
Drei getrennte Leserrollen untersuchen Guide, Implementierung und Grenzen; eine Synthese
prüft die Befunde mit Lese- und Suchzugriffen. Nur die letzte Modellantwort gilt als Ergebnis.
Die Synthese verwendet ein JSON-Schema mit begründeter Bewertung auch bei leeren Befunden
und liest selbst Vergleichsquellen; Pflichtfelder und Belege gegen tatsächlich gelesene
Quellen werden geprüft. Bis zu zwei Korrekturen laufen in derselben Session und innerhalb
derselben Aufruf- und Zeitgrenzen. Bericht, Antworten je Versuch und tatsächliche
Leseabdeckung liegen in einem neuen Ausgabeordner außerhalb des Repositorys. Belege dürfen
mehrere lückenlos gelesene Ausschnitte umfassen. `--resume` setzt nur
die Synthese mit gespeicherten Prüferberichten fort, wenn Quellenstand, Fokus und Modus
unverändert sind; der neue Durchlauf erhält ein eigenes Budget und einen neuen Ausgabeordner.
Die Prüfung verändert keine Quellen und beansprucht keine vollständige Abdeckung. Ein Dry-Run prüft
Parameter und Korpus ohne Modellaufruf. Die Konsole macht Rollen, Phasen, Quellzugriffe,
Modellaufrufe und Wartezeiten mit Zeitstempeln sichtbar; der Abschluss nennt Dauer und
Ergebnisordner. Das Werkzeug ist kein Plugin und führt keine
Run-Snippets oder Actor-Programme aus. Aufruf und Grenzen stehen in `docs/development.md`.

Alle UI-Entwürfe liegen unter `docs/ui-drafts/`. Die bestehende Seite
`docs/ui-drafts/index.html` sammelt die Entwurfsseiten als eigene Tabs, einschließlich älterer
Entwürfe. Jede Variante hat eine eigene Vorschaukarte im Raster; nur die obere Tab-Leiste
fasst Varianten zu Sammlungen zusammen. Vorschaukarten und bestehende Direktlinks öffnen
die gewählte Variante direkt in der zugehörigen Sammlung.
Fehlende ältere Seiten werden nachgetragen.
Tabs und Übersichtskarten stehen nach ursprünglichem Entwurfsdatum absteigend, neue Entwürfe
zuerst. Varianten übernehmen das Datum ihrer Sammlung; Nachtragen ändert es nicht. Bei gleichem
Datum gilt die Reihenfolge der Einträge in der HTML-Datei.
Das Kartenraster füllt die verfügbare Breite ohne horizontales Scrollen und ordnet die
Sammlungen zeilenweise von oben links an. Beim Öffnen der Übersicht beginnt das Raster oben
und die Tab-Leiste links; der Browser stellt keine alte Scrollposition wieder her.
Jeder HTML-Entwurf hat ein bis zwei PNG-Vorschauen neben der Datei und benötigt keinen Build.
Der Schichtwerk-Tiefenkörper-Entwurf kombiniert gestufte Boxen mit zuschaltbaren weichen
Kontaktschatten aus WebGL. Die Controls bleiben bedienbare HTML-Elemente; Schattenstärke,
Auflage und Vertiefung lassen sich lokal vergleichen. Fehlendes WebGL wird sichtbar gemeldet.
Ausdehnung, Versatz und Deckkraft der Kontaktschatten folgen der kürzeren Controlkante:
kleine Checkboxen und schmale Fortschrittsleisten erhalten engere, schwächere Schatten,
größere Felder behalten die volle Wirkung. Der globale Stärkeregler multipliziert diese
Größenabstufung; eine Skalierung der gesamten Szene verändert ihre Proportionen nicht.
Die Boxenfronten verwenden feste matte Farben; eine mausabhängige Beleuchtung gibt es nicht.
Die produktive Gestaltung der Fläche übernimmt die matten Farben und geraden Konturen
dieser Materialrichtung, aber keine Tiefe; die Einzelheiten beschreibt `plugins.md`. Der
Offline-Entwurf bleibt als eigener
Vergleich in der bestehenden Übersicht erhalten und ist keine Aufnahme eines echten Runs.


Unter `build/` liegen drei ausführbare Skripte: `build.sh` baut Agentenlaufzeit, eingebaute
Plugins, Web und Homepage, `check.sh` führt die vollständige Projektprüfung aus, `homepage.sh` erzeugt Homepage,
Guide und die internen Referenzen. Mit `--open` öffnet es die Hauptseite nach erfolgreichem Build auf
macOS im Standardbrowser; `--check` prüft Referenztypen, Beispiele, Aktualität und Export.
Der Homepage-Build erzeugt unter `docs/homepage/dist/` eine eigenständig statisch hostbare
Website mit relativen Seiten- und Assetlinks. Links auf Repository-Dateien verweisen im Export
auf GitHub. Nur öffentliche Seitendateien und tatsächlich verwendete Screenshots werden
übernommen. Jeder Web-Build erzeugt diesen Export neu und liefert ihn unter `apps/web/dist/help/`
mit aus. Die Homepage-Prüfung läuft im Gesamtprüflauf vor dem Web-Build, damit dessen
Neugenerierung veraltete Referenzen nicht verdeckt; die Prüfungen des Pakets laufen danach, weil
das Paket das gebaute Web trägt. Die Referenz komponiert das Profil `showcase` aus den eingebauten
Bundles und verlangt, dass sie zu ihren Quellen passen.
Alle Skripte wechseln in die Repository-Wurzel und brechen beim ersten Fehler ab.
`.vscode/tasks.json` bietet dafür drei Tasks: `build` (Standard), `check` und `open: homepage`.
Die Tasks enthalten nur Skriptaufrufe. Bestehende pnpm-Befehle für Teilbuilds und Einzelprüfungen
bleiben ohne zusätzliche Wrapper-Skripte verfügbar. Die Bedienung steht in `docs/development.md`.

## Leitsatz

> RAgents ist eine ereignisbasierte Mehragenten-Laufzeit aus Runs, Actors, ActorInputs, Turns und Subscriptions. Modelllaufzeit und Produktumgebung bleiben austauschbare Beiträge.

Die Agentenlaufzeit ist die vollständige Standardlaufzeit des aktuellen Produkts. RAgents baut die Agentenschleife der Agentenlaufzeit,
Sessions, Provideranbindung, Skills, Compaction oder Extension-System nicht nach. Der Core bindet
Modelllaufzeiten trotzdem nur über einen Driver-Vertrag: der Agent-Driver erhält ActorInput und
Ereignisgrenzen über diesen Vertrag; ein TypeScript-Actor verwendet stattdessen den TypeScript-Driver.
Weitere Modelllaufzeiten wären neue Driver gegen denselben Vertrag.

RAgents besitzt die gemeinsame Welt aus Actors, Inputs, Turns, Events, Subscriptions, Artefakten
und Journal. Ein Modell muss diese Welt nicht kennen. Mit leerer Werkzeugauswahl sieht es nur
seinen normalen Systemprompt und den Text seines aktuellen Inputs.

Fachlichkeit und externe Integrationen sind keine Bestandteile des neutralen Cores. Sie werden
durch ein Profil und dessen Plugins ergänzt. Ein anderes Produkt soll denselben Core
ohne diese Plugins und deren Tabs verwenden können.

## Begriffe

| Begriff              | Bedeutung                                                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Agentenlaufzeit      | Laufzeit eines einzelnen Agenten: Modell, privater Kontext, Agentenschleife, Tool-Aufrufe, Skills, Compaction, Provider und Hooks.                                                         |
| RAgents Core         | Produktneutraler Mehragenten-Kern: Runs, Actors, ActorInputs, Turns, Events, Subscriptions, Journal, Scheduler, Artefakte und Plugin-Host.                                                 |
| Plugin               | Eine vertikale Produktfähigkeit. Es kann gemeinsam Serverdienste, Hooks, Tools, Skills, Promptteile, Methoden, UI-Beiträge, Daten und Lebenszyklus liefern.                     |
| Hook                 | Ein Eingriff in Modell- und Werkzeugaufrufe EINER AgentSession über das Extension-System der Agentenlaufzeit. Ein Hook kann Tools oder Ressourcen registrieren und auf Ereignisse der Agentenlaufzeit reagieren. |
| Skill                | Eine Arbeitsanleitung für das Modell mit optionalem Startauftrag und ergänzenden Dateien. Ein Skill ist weder Plugin noch ausführbarer Actor.                                                                                                  |
| Actor                | Ein Teilnehmer des Runs: der menschliche Owner, ein Agent mit Modell oder ein TypeScript-Actor aus TypeScript. Nur ausführbare Actors besitzen Inputs, Turns und einen Lebenszyklus.       |
| ActorInput           | Ein Auftrag aus Text, optionalen Artefakten und optionaler Event-Herkunft für genau einen Actor. Ein Input wird höchstens von einem Turn beansprucht.                                      |
| Turn                 | Eine Ausführung eines Actors, begonnen mit genau einem ActorInput. Inputs an einen Agenten mit laufendem Turn speist dieser vor seiner nächsten Modellanfrage ein (Steering).              |
| Event                | Unveränderlicher Fakt im Journal v4, zum Beispiel Modelltext, Reasoning, Tool-Aufruf, Turn-Abschluss, Action oder Artefakt.                                                                |
| Subscription         | Strukturierter Filter eines Actors auf neue beobachtbare Events. Jeder Treffer erzeugt einen neuen ActorInput für den Subscriber.                                                          |
| Primary-Actor        | Der ausdrücklich gewählte Actor, dessen Modelltext das Produkt als sichtbaren Chat behandelt. Diese Rolle ist unabhängig von der Erzeugerlinie.                                            |
| TypeScript-Actor     | Ein Actor, dessen Turn deterministisches TypeScript statt eines Modells ausführt. Er besitzt keine Agent-Session, verwendet aber dieselben registrierten Dienste und Werkzeuge.            |
| Actor-Programm | Ein privates TypeScript-Paket, das einem Actor Funktionen, Input-Verarbeitung und optionale React-Views bereitstellt; ein typgeprüfter TypeScript-Build mit nativer Node-Ausführung auf der gemeinsamen RAgents-Ausführungsplattform. |
| Actor-Zustand | Intrinsische journalisierte Daten eines Actors, gemeinsam für seine Funktionen, Input-Verarbeitung und Views. |
| Mini-App | Eine React-Oberfläche ihres Actors. Sie zeigt dessen Zustand und ruft Funktionen ohne zusätzlichen Modell-Turn auf. |
| Werkzeugkarte        | Eine vom Host aus dem typisierten Werkzeugvertrag erzeugte Eingabe direkt am Zielagenten, ohne zusätzliche Fensterhülle. Sie enthält keinen eigenen App-Code.                                               |
| App-Host             | Eine Kachel der Fläche mit lokaler Vollansicht für den Benutzer. Beide laden dieselbe vollständige Mini-App.                                                                  |
| Komponente           | Ein wiederverwendbarer Baustein ohne Installations- und Produktlebenszyklus, zum Beispiel die Chat-Bausteine in apps/web/src/chat.                                                         |
| Profil               | Die ausdrückliche, geordnete Zusammenstellung von Core und Plugins zu einem Produkt, zum Beispiel `core`.                                                                                  |

PLUGIN bedeutet also nicht Tool und auch nicht Hook. Beides sind mögliche Facetten eines
Plugins. Ein Integrationsplugin bündelt beispielsweise Client, Projektion, Methoden,
Agenten- und Logik-Werkzeuge, Promptregeln, Web-Tab und Lösch-Lebenszyklus.

## Glossar

Ein Begriff je Sache, in Doku, Oberfläche, Guide und Code. Die rechte Spalte nennt, was dafür
nicht mehr verwendet wird. Begriffe des Codes stehen in Namen, Methoden und Verträgen.

| Sache | Doku und Oberfläche | Guide (en) | Code | nicht mehr |
| --- | --- | --- | --- | --- |
| eine Arbeit mit genau einem Journal | Run | run | `runId`, `ragents.runs.*` | Lauf, Unterhaltung, Session (für den Run) |
| frei angeordnete Kacheln der Actors und Mini-Apps eines Runs | Fläche | surface | `surface` | Canvas, Arbeitsfläche, Kachelfläche |
| ein Element der Fläche | Kachel | tile | `tile` | Kachel für Einträge der Startseite |
| die eine Mini-App groß im Run-Panel | Bühne | stage | `stage` | Fläche für diese Mini-App |
| Eintrag der Startseite, Art Skill oder Script | Vorlage | template | `StartEntry` | Einstieg, Startvorlage, Skill-Einstieg, Startkarte, Kachel |
| Kopie eines Runs bis zu einem Zeitpunkt (Konzept) | Run-Fork | run fork | `forkRun` | Run-Vorlage |
| Dateien und Executor eines Runs | Arbeitsbereich | workspace | `workspace` | Arbeitsordner, Arbeitsbereich für Panels |
| angemeldeter Rechner oder VS-Code-Fenster | Arbeitsplatz | workstation | `WorkspaceClient` | Arbeitsbereich für den Rechner |
| Reiterleiste neben Chat und Bühne | Leiste | tab bar | `workspaceTabs` | rechter Arbeitsbereich, rechtes Panel |
| Eintrag der VS-Code-Erweiterung für einen RAgents-Server | Server | server | `Connection` | Umgebung, Ziel, Target |
| Chat eines Benutzers über allen seinen Runs | globaler Koordinator | global coordinator | Plugin `ragents.overseer` | übergeordneter Koordinator, Overseer |
| Datei `ragents.config.<name>.ts` | Profil | profile | `PRODUCT_PROFILE` | Anwendungsprofil, Produktprofil |
| Modellvorgabe `coordinator`, `standard`, `relay` | Rolle | role | `profile` in `model_list` und Journal | Agentprofil, Koordinatorprofil, Rollenprofil |
| Erweiterungseinheit von RAgents | Plugin | plugin | `plugin` | Extension, Erweiterung |
| Zusatz zu VS Code | Erweiterung | extension | `apps/vscode` | Plugin |
| Eingriff in Modell- und Werkzeugaufrufe eines Agenten | Hook | hook | `agentRuntime` | Agent-Extension |
| privates TypeScript-Paket eines Actors | Actor-Programm | actor program | `actorProgram` | Run-Programm, Run-Modul, Programmpaket |

Zwei Namen bleiben im Code, obwohl die Doku anders spricht: Die Rolle heißt in Journal, Katalog
und `model_list` weiter `profile`, weil Journale sie so tragen und es keine Migrationen gibt; der
Plugin-Vertrag nennt einen Run in Typnamen noch `Session` (`SessionContext`, `sessionMetadata`,
`storage.session`), die Nachrichtenschicht nicht mehr.

## Architektur

```text
Profil, zum Beispiel core
  |
  +-- geordnete Liste der Plugins (in core 18)
  |
  +-- RAgents Core
  |     +-- Run, Journal, Actors, Inputs, Turns, Events, Subscriptions und Artefakte
  |     +-- Scheduler und Logik-Laufzeit
  |     +-- PluginHost und Nachrichtenschicht (JSON-RPC)
  |
  +-- AgentRuntimeManager
  |     +-- eine langlebige AgentSession je RAgents-Agent
  |     +-- ragents-turn-dispatcher
  |     +-- ragents-skill-preload über before_agent_start
  |     +-- Hooks und Skills der Plugins
  |
  +-- Produkt- und Arbeitsbereichsverträge
  |     +-- ProductRuntime: Koordinator, Anzeige, Profil und Rollenvertrag
  |     +-- WorkspaceRuntime: statischer oder run-gebundener Arbeitsbereich
  |
  +-- Web-Plugin-Host
  |     +-- generische Schale aus Chat und Leiste
  |     +-- Slots für Tabs, Presenter, Run-Metadaten, Provider und Fläche
  |
  +-- installierte Plugins
        +-- Orchestrierung        +-- Arbeitsbereich
        +-- Produktkern           +-- Dokumente
        +-- Globaler Koordinator  +-- Browser
        +-- Aktivität             +-- Prozesse
        +-- Rückfragen            +-- To-do
        +-- Wächter               +-- Transkript
        +-- Modell-Relay          +-- Actor-Programme und Views
        +-- Profilverteilung
        +-- Language Server: Roslyn, FSAC, TypeScript
```

Die Verantwortungen sind klar getrennt:

- Die Agentenlaufzeit besitzt den privaten Modellkontext, Providerdialog, die innere Agentenschleife,
  Tool-Calling, Skills, Compaction und providernahe Retries.
- RAgents besitzt den Mehragentenzustand, ActorInputs, Ereigniszustellung, Orchestrierung,
  langlebige TypeScript-Actors und das gemeinsame Journal.
- Plugins besitzen Fachlichkeit und Integrationen. Der Core kennt keine Fachdomäne.
- Die Chat-Bausteine liefern UI. Sie entscheiden nicht, welche Plugins installiert sind.

Die Agent-Session und das RAgents-Journal sind keine konkurrierenden Kopien. Die Agent-Session ist das
kanonische Gespräch des Modells. Das Journal ist die kanonische gemeinsame Welt des Runs.
RAgents speichert dort die semantische Projektion von Modell-, Tool- und Laufzeitereignissen.

## Kurs

Drei Grundsätze gelten überall; ihre datierten Begründungen stehen in `docs/decisions.md`
(27.08. und 01.09.2026):

- Einschmelzen statt ausbauen. Rückbauten werden immer fertig gezogen, keine stehengebliebenen
  Altpfade. Keine Redundanzen: gleiche Logik existiert genau einmal. Generalisierungen erst, wenn
  es mindestens zwei echte Nutzer gibt. Die Mini-App- und TypeScript-Plattform steht; sie wird
  nicht weiter ausgebaut, bis der erste echte Fachfall darauf läuft.
- Sicherheit ist derzeit nachrangig. Sandbox-Härtung und konzeptionelle Rechte (Capabilities,
  Grants, Delegation) sind kein Investitionsziel, solange das Produkt nicht danach verlangt. Die
  harten Grenzen bleiben Dateirechte und die Betriebssystem-UID je Run.
- Keine Migrationen, keine Altpfad-Kompatibilität. Es gibt keinen Migrations-Erweiterungspunkt;
  die Profildaten unter `~/.local/share/ragents/<profil>` gelten als wegwerfbare
  Entwicklungsdaten. Alte oder beschädigte Journale werden mit ihrer Ursache isoliert; der Server
  und andere Runs bleiben nutzbar. Originaldateien bleiben erhalten, und die betroffene Run-ID
  wird nicht als neuer Run wiederverwendet.

## Verbindliche Regeln

1. ENTFERNUNGSTEST: Ohne Plugin verschwinden seine Routen, Tools, Skills, Promptteile, Tabs,
   Konfiguration und Hintergrunddienste gemeinsam.
2. ERWEITERUNGSTEST: Ein neues Plugin erfordert keinen neuen Fachzweig in Chat, Panel, Engine oder
   Serverstart. Nur Implementierung und Profil werden ergänzt.
3. EINE WAHRHEIT: Eine Fachoperation hat genau eine Implementierung. Verschiedene Facetten rufen
   denselben Dienst oder Command-Handler auf.
4. LEBENSZYKLUS: Jeder Hintergrundprozess gehört einem Plugin und hat Start-, Run-, Stop- und
   Shutdown-Grenzen.
5. NAMENSRAUM: Konfiguration, persistierte Daten, Routen und Beiträge tragen die Plugin-Kennung.
6. EINE KOMPOSITION: Prompt, Skills, Profile, Hooks, Logik-Werkzeuge, Server und Web
   folgen derselben Pluginliste.
7. KEINE VERSTECKTE AKTIVITÄT: Nicht installierte Plugins starten nichts. Inaktive Ansichten
   pollen nicht ohne ausdrücklich erklärte Hintergrundfunktion.
8. EINE AUSFÜHRUNGSPLATTFORM: Jede run-lokale Logik verwendet denselben TypeScript-Compiler,
   `RunContext`, Funktionsvertrag, Typprüfung und verwaltete native Ausführung. Einmalige
   Snippets benötigen kein dauerhaftes Actor-Programm. Fachtests stehen als
   normale TypeScript-Testdateien im Actor-Paket.

Sechs Regeln gelten für Verträge und Typen, quer durch alle Kapitel:

- EINGABESCHEMATA FÜR MODELLE SIND FLACH: ein modellzugewandtes Eingabeschema ist EIN flaches
  `Type.Object`, der Diskriminator ein String-Enum, korrelierte Felder sind optional, und die
  Korrelation prüft der Server direkt nach der Validierung mit einem benannten Fehler, der beide
  gültigen Formen nennt; die Regel steht auch in der Beschreibung des korrelierten Feldes.
  `profile-composition.test.ts` prüft alle Werkzeuge aller Profile auf `type: "object"` ohne
  `anyOf` oder `oneOf` an der Wurzel.
- ILLEGALE ZUSTÄNDE SIND UNREPRÄSENTIERBAR: was zusammengehört, steht intern in einer
  diskriminierten Union, nicht in unabhängigen nullbaren Feldern mit Laufzeit-Wächtern.
  Validatoren sind exakt so streng wie die Domänentypen; ungültige Journale sperren beim Laden
  nur ihren eigenen Run und melden die Ursache. Sie dürfen den Server nicht beenden.
- MODELLE TIPPEN NICHTS AB: kein Werkzeugvertrag verlangt, dass ein Modell Quelltext, Hashes,
  Tokens, IDs, Pfade oder Nachweise aus früheren Ausgaben reproduziert. Referenzen verwenden
  Programmnamen, View-Kennungen und Actor-Handles; Hashes führt der Server. Ergebnisse
  wiederholen keine Eingaben.
- ABLEHNUNGEN NENNEN GÜLTIGE NAMEN: eine Fehlermeldung an ein Modell nennt die erlaubten Werte
  oder Namen, statt nur zu scheitern.
- SCHEMAVERLETZUNGEN NENNEN PFAD UND GRUND: jede Prüfung gegen ein TypeBox-Schema meldet jeden
  verletzten Pfad mit seinem Grund (fehlendes Pflichtfeld, unbekanntes Feld, erlaubte Werte, sonst
  die verletzte Regel samt empfangenem Wert), nie nur die erste Meldung oder einen pauschalen Text.
  Engine, Host, Plugins und das Test-SDK der Actor-Programme nutzen dafür `schemaComplaints`
  (`packages/ragents/src/domain/schema-errors.ts`); das Präfix nennt, was geprüft wurde, etwa
  `package.json.ragents ist ungültig: views.0 has unknown field width`. Nur die Argumentprüfung der
  Agentenlaufzeit formatiert dieselben Angaben selbst (`core.md`).
- VERTRÄGE ÄNDERN SICH IN EINE RICHTUNG: ein aktiviertes Actor-Paket ist an die Schemata seiner
  Capabilities gebunden. Verträglich ist, was den alten Aufrufer nicht bricht: eine Eingabe
  darf mehr annehmen (neue Felder nur optional, kein Feld entfernt oder verpflichtend gemacht,
  kein engerer Typ), ein Ergebnis darf nicht weniger zusichern (kein Feld entfernt oder
  optional gemacht, kein weiterer Typ, keine neue Enum-Variante; neue Felder sind unkritisch).
  Maßstab ist die Wertemenge, nicht die Feldanzahl: mehr Felder sind beim Ergebnis der engere,
  bei der Eingabe der weitere Typ. Bei geschlossenen Eingabeobjekten ist auch ein entferntes
  Feld ein Bruch, und ein Paket, das ein Capability-Ergebnis als eigenes Ergebnis durchreicht,
  bricht an jedem neuen Feld, wenn es sein Ergebnisschema schließt. Ein Bruch ist erlaubt: der
  Host aktiviert gebundene Pakete beim nächsten Aufruf neu und nur Code, der den neuen Vertrag
  nicht erfüllt, scheitert (typescript-platform.md). Zu vermeiden ist er in Capabilities, die
  von Agenten geschriebene Pakete nutzen, weil dort niemand die Quellen nachzieht.

Bei jeder Erweiterung gilt die Kontrollfrage:

> Ist das eine allgemeine Verantwortung der Agentenlaufzeit oder von RAgents, eine
> wiederverwendbare Komponente, ein run-lokales Actor-Programm oder eine installierbare
> Plugin-Fähigkeit?

Ohne klare Antwort gehört die Änderung nicht in den Core.

## Offene Grenzen

Die offenen Grenzen stehen je Thema am Ende des jeweiligen Kapitels.
