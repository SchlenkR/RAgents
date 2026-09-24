# Verbleibende Orientierung und Promptgrenzen

Status: Idee

## Ziel und Grenze

Actors sollen neben ihren Werkzeugen die für ihren Auftrag tatsächlich vorhandenen Bausteine
kennen. Offen sind der knappe Bestand nicht als Werkzeug dargestellter Möglichkeiten, die
Prüfung des endgültigen Driver-Werkzeugbestands und einige widersprüchliche Profil- und
Skillanweisungen. Die geltende Auslieferung von Werkzeugübersicht, Detailverträgen und
generierten Anleitungen steht in `docs/spec/plugins.md`, `run-modules.md` und
`typescript-platform.md`; sie wird hier nicht nochmals entworfen.

Es entsteht keine zweite Registry, Dokumentationsplattform oder Rechteverwaltung. Vorhandene
Metadaten, Exporte, Run-Projektionen und Skillmechanismen bleiben die Quellen. Ein zusätzlicher
Hinweis darf weder eine Aufgabe erfinden noch eine nicht freigegebene Fähigkeit versprechen.

## Vorhandene Bausteine sichtbar machen

Der Initialkontext soll knapp über relevante Möglichkeiten informieren, die nicht bereits
als konkrete Werkzeuge beschrieben sind. Für Actor-Programme kommen Vorlagen- und Controlnamen
mit ihrem Zweck aus den vorhandenen Metadaten beziehungsweise dokumentierten Exporten.
Installierte Programme und Views erhalten Titel und vorhandene Beschreibung aus ihrem Manifest. Fehlende
nützliche Beschreibungen werden an der Quelle ergänzt, nicht in einem zweiten Promptkatalog.

Ein neu erzeugter Actor soll die für ihn relevanten bestehenden Oberflächen erkennen können.
Ein Werkzeug zum Auflisten von Actor-Programmen beschreibt nur den Zugriff, nicht den tatsächlichen Bestand.
Die Übersicht darf keine fremden Prompts, vollständigen Zustände oder Quelltexte einblenden.
Welche Views beziehungsweise Handlungen für den Actor zugänglich sind, muss aus derselben
Identitäts- und Rechteprüfung wie ihr tatsächlicher Zugriff folgen.

Der Bestand wird am Turn-Beginn aus dem Run gewonnen. Für Änderungen während eines Turns
bleiben die vorhandenen Listenwerkzeuge zuständig; ein zusätzlicher Push-Kanal für Prompttexte
ist nicht vorgesehen. Der globale Koordinator muss reguläre Run-Bausteine weiterhin von seinen
eigenen unmittelbar nutzbaren Aktionen unterscheiden.

## Endgültigen Werkzeugbestand prüfen

Zu prüfen ist die durchgängige Übereinstimmung zwischen der vom Scheduler erzeugten Übersicht
und den schließlich vom Driver registrierten Werkzeugen. Der Scheduler verwendet das
aufgelöste Toolset; Driver, Workspace-Anbindung und Agent-Extensions besitzen weitere
Registrierungspunkte. Ein statischer Profilkatalog allein belegt deren Übereinstimmung nicht.

Die Prüfung soll normale Actors, exakte Teilmengen, Worker, dynamische Run-Werkzeuge,
Workspace-Werkzeuge und Plugin-Extensions umfassen. Nicht erlaubte Funktionen dürfen weder als
verfügbar erscheinen noch über einen Dokumentationszugang nutzbar werden. `tools: []` behält
seine Isolation. Falls eine Abweichung besteht, ist sie an der vorhandenen Auflösung zu beheben,
ohne einen zweiten Bestand einzuführen.

## Profilregeln und Skills bereinigen

- `ragents.orchestration/orchestration.hbs` soll nur zu tatsächlich vorhandenen Werkzeugen
  auffordern. Die Aussage, jeder neue Agent erbe `actor_input`, muss exakte Werkzeugauswahl und
  `tools: []` berücksichtigen. IDs und Pfade sollen über vorhandene Handles, kurze Referenzen
  und serverseitige Auflösung zugänglich sein; reine Promptprosa ersetzt fehlende technische
  Referenzformen nicht.
- Die Beschreibung mechanischen Weiterreichens muss die Grenze der Routingbibliothek beachten:
  Sie übernimmt die letzte nichtleere Zeile einer Antwort. Das ist keine allgemeine Weitergabe
  beliebiger mehrzeiliger Ergebnisse. Die Grenze gehört zur Bibliotheksbeschreibung und in
  passende Beispiele.
- Explizite Skillauswahl darf einen bereits im Input enthaltenen vollständigen Skill-Body
  nicht zusätzlich vorladen. Expansion, Preloader und bestehender Katalog sind gemeinsam am
  effektiven Request zu prüfen; es entsteht kein zweiter Auswahlmechanismus.

## Prüfung

Die bestehenden Tests für Scheduler, Driver, Profilkomposition und Skill-Preload sollen den
Übergang zur Modellanfrage erfassen. Entscheidend sind tatsächlich gesendete Systemteile,
aktive Schemas und ausgewählte Skills. Produktive Journale benötigen dafür keine zweite
vollständige Kontextdatenbank.

Abnahme der verbleibenden Arbeit:

- Relevante installierte Programme und Views und nicht als Werkzeuge dargestellte Bausteine sind knapp und
  aus ihren tatsächlichen Quellen sichtbar; nicht zugängliche Inhalte bleiben ausgeschlossen.
- Schedulerübersicht und endgültiger Driverbestand stimmen auch für exakte Teilmengen,
  zusätzliche Workspace-/Extension-Werkzeuge und dynamische Run-Werkzeuge überein.
- Profilanweisungen widersprechen weder einander noch der verfügbaren Werkzeugauswahl.
- Skill-Bodies werden bei expliziter Auswahl und Vorladen nicht doppelt in dieselbe Anfrage
  eingebunden.

Erst danach sind überschaubare echte Aufträge sinnvoll vergleichbar. Ein Modellfehler oder eine
Promptlänge allein beweist keine Ursache; die strukturellen Prüfungen ersetzen keinen Nachweis,
dass ein konkreter Modelllauf den fachlichen Auftrag tatsächlich ausgeführt hat.
