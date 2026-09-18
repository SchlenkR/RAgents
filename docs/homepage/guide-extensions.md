# Plugins und Skills

Erweiterungen entwickeln: passende Ausführungsform wählen, Verträge und Prompts verbinden, Lebenszyklus und Bedienung prüfen.

## Kern-Grenze

Ein Plugin bündelt eine Fähigkeit der Arbeitsumgebung, etwa Dateizugriff, Rückfragen oder
Actor-Programme. Es kann Funktionen, Prompts, Skills, Dienste und eine Oberfläche beisteuern.
Ein Profil legt fest, welche Plugins gemeinsam geladen werden. Der Core stellt den
`PluginHost` und typisierte Registries bereit und kennt keine produktspezifischen Integrationen.

Eine Funktion ist eine einzelne aufrufbare Aktion eines Plugins. Ein Skill ist eine
Arbeitsanleitung für ein Modell, mit optionalem Startauftrag und ergänzenden Dateien.
Ein Run-Script ist ausführbarer TypeScript-Code, der einen vorbereiteten Run aufbaut.
Diese Beiträge können im selben Plugin liegen, haben aber unterschiedliche Aufgaben.

Snippets und Actor-Programme verwenden denselben registrierten Bestand typisierter Run-Funktionen.
Der Host leitet daraus die TypeScript-API und ausdrücklich native Agentenwerkzeuge ab. Agent-Extension-Factories werden
für den jeweiligen Run und Actor aufgelöst und über der Agentenlaufzeit offizielle Extension-API gebunden.
HTTP-Routen, UI-Beiträge und hostweite Dienste bleiben Plugin-Facetten außerhalb einer einzelnen
Agent-Session.

## Leitfaden für Erweiterungen

Beginne mit dem fachlichen Ergebnis und dem Zustand, den Mensch und Modell gemeinsam brauchen.
Wähle danach die kleinste vorhandene Erweiterungsform, die diesen Auftrag vollständig trägt.
Die folgenden Strategien beruhen auf den vorhandenen Funktionen, Actor-Programmen,
Sprachservern und Oberflächen. Sie führen keinen zusätzlichen Erweiterungsmechanismus ein.

| Bedarf | Passende Form | Grenze |
| --- | --- | --- |
| Wiederverwendbare Fachaktion oder externer Datenzugriff | Typisierte Run-Funktion im zuständigen Plugin | Eine Implementierung für Snippets und Programme; Darstellung getrennt halten |
| Einmalige Verbindung vorhandener Funktionen | TypeScript-Snippet | Kein eigener Actor nötig |
| Fester Ablauf mit späteren Eingaben und eigenem Zustand | TypeScript-Actor | Zustand und Lebenszyklus ausdrücklich festlegen |
| Gemeinsamer Ablauf für Anleitung und Diagramm | `WorkflowDefinition` mit Promptdateien im Actor-Paket | Beschreibt Rollen, Übergänge und Freiheiten; das Steuerprogramm führt aus und prüft |
| Untersuchung, Gespräch oder mehrstufige Umsetzung | LLM-Actor mit passenden Funktionen | Eigener Kontext und Werkzeuge müssen zur Aufgabe passen |
| Bedienung oder Status eines vorhandenen Actors | View an diesem Actor | Eine Oberfläche allein rechtfertigt keinen weiteren Actor |
| Wiederholbar vorbereiteter Run | Run-Script im besitzenden Plugin | Aufbau in Code, fachliche Entscheidungen beim zuständigen Modell |
| Wiederverwendbare Arbeitsanweisung | Skill im besitzenden Plugin | Beschreibt das Vorgehen, führt erforderliche Initialisierung nicht selbst aus |

### 1. Fähigkeit und Ablauf getrennt halten

Das Plugin besitzt Datenzugriff, fachliche Regeln, Konfiguration und die dazugehörige Anleitung.
Ein darauf aufbauender Ablauf entscheidet, wann die Fähigkeit gebraucht wird und wie ihr
Ergebnis im Run weitergeht. Er verwendet den registrierten Funktionsvertrag oder einen
typisierten Diensttoken. Allgemeine Abfragefunktionen dürfen keine bestimmte Mini-App öffnen
oder deren Workflow voraussetzen. Ein Entfernen des Plugins soll seine Beiträge entfernen;
abhängige Plugins benennen ihre Voraussetzung über `requires`.

Der neutrale Host bekommt nur Verhalten, das mehrere echte Nutzer teilen. Produktpfade,
Kontonamen und fachliche Auswahlregeln bleiben beim aufrufenden Plugin. Ein gemeinsamer
Hostbaustein ist sinnvoll, wenn mehrere Adapter dieselben Prozesse, Zustände und Bereinigung
brauchen. Eine einzelne Integration rechtfertigt noch kein zusätzliches Framework.

### 2. Einen Vertrag für Modell und Oberfläche verwenden

Eine Mini-App ruft deklarierte Actor-Funktionen über `context.capabilities.call` auf.
Das Backend verbindet sie mit den vorhandenen Run-Funktionen oder Fachoperationen. Ein Modell
kann dieselbe Fachaktion ausführen. Der gemeinsame Zustand bleibt serverseitig; beide Zugänge
erhalten daraus eine Darstellung. Zugangsdaten und externe Abfragelogik gehören ins Backend.

Definiere Eingabe, Ergebnis und Fehler vor der Darstellung. Teile Schemata und Grenzen, wo
dieselben Daten mehrere Schichten durchlaufen; prüfe andernfalls ihre Übereinstimmung an der
Integrationsgrenze. Speichere größere Ergebnisse und technische Cursor beim Besitzer. Das
Modell übergibt eine verständliche Referenz auf dieses Ergebnis statt IDs, Cursor oder
Dateiinhalte aus früheren Ausgaben abzuschreiben. Kontextfelder, die für die nächste
Entscheidung gebraucht werden, müssen im Ergebnisvertrag enthalten sein.

### 3. Feste Arbeit in Code, Urteile im Modell ausführen

Initialisieren, Abfragen, validieren, speichern und den aktuellen Zustand anzeigen sind
deterministische Schritte. Run-Scripts und Funktionen führen sie unmittelbar aus. Eine
Anweisung wie "öffne zuerst den Dienst" garantiert nicht, dass er beim Anzeigen der App
schon geladen wird. Erforderliche Vorbereitung gehört in einen tatsächlichen Aufbauaufruf.
Unabhängige Schritte können parallel laufen; Abhängigkeiten bleiben ausdrücklich geordnet.

Eine eng begrenzte Umwandlung kann eine Plugin-Funktion mit einem einzelnen Modellaufruf
erledigen. Dafür reichen ein vorbereiteter Auftrag und die konkrete Eingabe, wenn weder
Verlauf noch Werkzeugschleife gebraucht werden. Ausgabe, Zeitlimit und Abbruch brauchen
einen überprüfbaren Vertrag. Das Modell liefert etwa strukturierte Kriterien; Code validiert
und führt sie aus. Der Vertrag legt den Umgang mit Unsicherheit fest; bei der Item-Suche
sucht das Modell ohne Rückfragen und nennt notwendige Annahmen in der Suchbeschreibung.
Beschreibe auch zulässige Leerfälle und Gesamtergebnisse; ein Schema allein erklärt dem
Modell noch nicht, wann ein Ergebnis ohne Einschränkungen gewollt ist.
Das ist eine Implementierungsentscheidung des Plugins, kein allgemeiner Ersatz für Actors.

Eine feste Filterliste ist nur passend, wenn die Fachaufgabe selbst so begrenzt ist. Soll ein
Modell freie Abfragen formulieren und das Zielsystem besitzt bereits eine Abfragesprache,
verwende deren lesenden Vertrag mit gemeinsamer Validierung. Sonst begrenzt die eigene
Parameterliste fachlich mögliche Kombinationen, obwohl Modell und Datenquelle sie verstehen.

Ein eigener Worker lohnt sich bei einem getrennten Arbeitsauftrag oder Kontext. Der
Koordinator hält dann Gespräch, Entscheidungen und Abnahme zusammen. Zustandsanzeigen
benötigen keine regelmäßigen Modellaufrufe. Modell und Denktiefe werden nach Aufgabe
konfiguriert und gegen den Laufzeitkatalog geprüft; feste Modellnamen oder pauschal hohe
Denktiefe gehören nicht in einen wiederverwendbaren Ablauf. Eine kurze Eingabe allein ist
noch kein Nachweis für geringe Latenz oder ausreichende Ergebnisqualität.

### 4. Prompts nach Verantwortung zusammensetzen

Der Rollenprompt beschreibt Ziel, Zuständigkeit, Übergaben und Fertigkriterien. Regeln einer
Fähigkeit gehören zum liefernden Plugin und werden an ihre tatsächlichen Funktionen gebunden.
Kurze Einstiegshinweise können initial kommen; umfangreiche Verträge und Detailkapitel lädt
das Modell bei Bedarf über `typescript_api`. Kopierte Fachkapitel in mehreren Rollenprompts
driften auseinander und vergrößern jeden Turn.

Prüfe die zusammengesetzte Anleitung für jede Rolle, auch für per Script erzeugte
Koordinatoren und Workers. Gleiche benötigte Wissenseinstiege müssen für beide erreichbar
sein. Eine Pfadangabe im Prompt ersetzt weder Leserechte noch tatsächlich verfügbare
Werkzeuge. Kürze Wiederholungen, aber erhalte Zuständigkeiten, Grenzen und notwendige Quellen.

### 5. Lebenszyklus als Teil der Funktion bauen

Starten, laden, bereit, fehlgeschlagen und beendet sind verschiedene Zustände. Ein sichtbarer
Reiter oder ein lebender Prozess belegt keine fachliche Bereitschaft. Melde Erfolg erst nach
der Bestätigung des zuständigen Systems. Statusabfragen müssen während langer Starts
antworten können und dürfen nicht dasselbe Start-Promise abwarten.

Gleichzeitige Starts derselben Ressource sollen dieselbe laufende Initialisierung verwenden.
Stoppen oder ein Wechsel des Auftrags müssen verspätete Ergebnisse ungültig machen.
Leite Abbruch an abhängige Aufrufe weiter und begrenze auch das lokale Warten. Run-Stopp,
Löschen und Host-Shutdown räumen beim jeweiligen Besitzer auf. Lege ausdrücklich fest,
welcher Zustand nach einem Neustart erhalten bleibt und was neu geöffnet werden muss.
Startfehler brauchen Ursache und einen bewussten Wiederholungsweg; eine Diagnoseabfrage
soll sie nicht unbemerkt durch einen neuen Start verdecken.

### 6. Aktivität und Ergebnis unterschiedlich anzeigen

Die Laufzeit weiß, ob ein Actor arbeitet; ein fachlicher Bericht sagt, woran er zuletzt
gearbeitet hat. Kombiniere beides, ohne einen alten Bericht als aktuelle Aktivität auszugeben.
Auch "wartet", "gestoppt" und "fehlgeschlagen" brauchen eine verständliche Darstellung.
Eine fertige Antwort oder ein Screenshot allein belegt noch keine erfolgreiche Prüfung.

Ein knapper Statusvertrag kann Zustand und Arbeitsschritt liefern, ohne rohe Denktexte oder
Werkzeugargumente zu transportieren. Leserechte für Diagnosen oder Änderungen sind unabhängig
von technischer Vollansicht zu vergeben und serverseitig zu prüfen. Rollen gehören in die
Konfiguration; neutrale Komponenten prüfen Rechte und keine Benutzernamen.

### 7. Mini-Apps im tatsächlichen Host entwickeln

Der Iframe begrenzt Bedienung, Layout und Kommunikation. Verwende gemeinsame Controls und
die deklarierte Funktionsbrücke. Für einen Dialog über mehrere Hostflächen signalisiert
die App ihre Absicht über eine Funktion; der besitzende Web-Plugin-Beitrag öffnet den Dialog
im richtigen Bereich. Ein lokaler Dialog innerhalb des Frames bleibt lokale UI.

Trenne den angewandten Serverstand von ungesendeten Eingaben. Unveränderte Pollantworten
dürfen Entwürfe nicht überschreiben, ältere Antworten keinen neueren Stand verdrängen.
Während einer Aktion bleiben Ladezustand und Fehler sichtbar; ein fehlgeschlagener neuer
Auftrag löscht nicht das bisher gültige Ergebnis. Regelmäßige Abfragen dürfen weder
überlappen noch endlos auf unsichtbaren Flächen laufen. Die Sichtbarkeit des Dokuments
allein erkennt einen eingeklappten Iframe nicht.

Prüfe Enter, Schaltflächen, Fokus, schmale Kacheln und Dialoge im tatsächlichen Host-Iframe.
Native Formularübermittlung ist dort nicht freigegeben; ein funktionierender Render-Test
belegt deshalb noch keinen funktionierenden Suchknopf. Endliche Schutzlisten der Bridge
müssen alte Einträge freigeben, wenn regelmäßige Abfragen dauerhaft laufen sollen.

### 8. Nachweise nach ihrer Aussagekraft wählen

Vertragstests prüfen Eingaben, Zustandswechsel und Fehler. Integrationstests prüfen echte
Registrierung, Promptkomposition, Rechte und die Verbindung zwischen UI-Funktion und Dienst.
Prozesstests prüfen Start, konkurrierende Zugriffe und Bereinigung. Browsertests prüfen die
bedienbare Mini-App innerhalb ihrer Sandbox. Wähle die Schichten, deren Verhalten sich ändert;
zusätzliche Tests sollen ein Fehlerrisiko prüfen und keine Implementierung abschreiben.

Simulierte Modellantworten belegen Validierung und Fehlerbehandlung, nicht die Qualität
natürlicher Interpretation. Dafür sind gesonderte Modellläufe mit repräsentativen und
mehrdeutigen Anfragen erforderlich. Externe Verbindungen und reale Projekte brauchen eine
eigene Live-Abnahme. Halte Testdaten in isolierten temporären Verzeichnissen; fehlende
Produktverbindungen führen zu einem sichtbaren Fehler statt zu unbemerkten Beispieldaten.
Baue die betroffenen Pakete und nenne, ob Neustart oder ein neuer vorbereiteter Run nötig ist.

## Vorgehen beim Implementieren

1. Besitzer, fachlichen Zustand und benötigte Entscheidungen bestimmen; vorhandene Funktionen
   und Referenzprogramme prüfen.
2. Den kleinsten vollständigen Vertrag festlegen, einschließlich Fehlern, Abbruch und Rechten.
3. Fachfunktion und Ablauf verbinden; nur benötigte Modellrollen und Promptkapitel ausstatten.
4. Bedienung und beobachtbaren Lebenszyklus ergänzen; Start und Erfolg ausdrücklich belegen.
5. Die betroffenen Grenzen gezielt prüfen, bauen und verbleibende Live-Abnahmen benennen.
6. Dieses Spec-Kapitel beziehungsweise das betroffene Nachbarkapitel aktualisieren, das Warum
   in der Entscheidungschronik festhalten und öffentliche Änderungen in den Guide übernehmen.

Vertragsbeispiele stehen in der [Entwicklerreferenz](developer.html), vollständige
Actor-Programme in der [Bausteinreferenz](reference.html#samples). Die Anleitung
zum [Bauen von Mini-Apps](guide-programs.html) beschreibt Paket, Zustand und View.

## Plugin-Vertrag

Ein Plugin ist ein Ordner unter `plugins/<id>/`. Er hält beide Hälften und die Assets zusammen:

```
plugins/ragents.actor-programs/
  server/index.ts    der Server-Anteil, Einstiegspunkt der Laufzeit-Suche
  web/index.tsx      der Web-Anteil, eigener Chunk (nur wenn es einen gibt)
  contract.ts        was beide Hälften teilen, importfrei (nur wenn es das gibt)
  prompt.hbs         Assets auf Plugin-Wurzelebene, ebenso prompts/, skills/,
                     run-scripts/, install.sh
```

`server/index.ts` exportiert genau einen Einstiegspunkt:

```ts
export const plugin: PluginModule = {
  requires: ["ragents.ask"],           // optional, geprüft vor dem Bauen
  create: (host) => ({ manifest: { id: "ragents.actor-programs" }, register: (registration) => { ... } }),
};
```

`create` erzeugt die Plugin-Instanz mit Manifest und Registrierungsfunktion und erhält dafür
den `PluginHost`. Danach trägt `register` die Beiträge über die pluginbezogene
`PluginRegistration` ein, etwa Funktionen, Prompts, Dienste und HTTP-Routen.

Der Name des PLUGIN-Ordners (der Elternordner von `server/`) ist die Kennung; ein abweichendes
`manifest.id` bricht den Start hart ab.
`requires` gehört in den Modulvertrag und NICHT ins Manifest - eine Wahrheit je Angabe. Was ein
Plugin über den eigenen Ordner hinaus braucht, holt es sich selbst aus dem `PluginHost`
(Services über Tokens); es gibt keine Sonderverdrahtung von außen mehr. Fehlt ein verlangter
Dienst, bricht der Start hart ab.

## Funktionen bereitstellen

Eine Erweiterung registriert mit `defineRunFunction` und `host.functions` ihre Funktionen,
eine knappe Zweckbeschreibung (`description`), optional ausführliche Hinweise (`longDescription`),
Ein- und Ergebnisschemata sowie ihre Implementierung. `label` ist die lesbare Bezeichnung.
Der Host erzeugt daraus die Signaturen von `context.functions.<name>(input)`. Snippets und Actor-Programme verwenden
denselben Bestand und dieselbe Ausführung. Verfügbarkeit und die gebundene Identität gelten
in beiden Formen; die Programmauswahl unter `capabilities` begrenzt den installierten Build.

Jede Fachfunktion ist über `context.functions` in `typescript_eval` erreichbar; ob sie
zusätzlich ein natives Modellwerkzeug ist, entscheidet `nativeTool: true` derselben
Registrierung nach einer Regel (seit dem 16.09.2026): Nativ ist eine Funktion, deren Ergebnis
das Modell vor dem nächsten Schritt lesen muss und die deshalb fast immer allein aufgerufen
wird: Bedienung (`browser_open`, `browser_snapshot`, `browser_click`, `browser_fill`,
`browser_select`, `browser_press`, `browser_check`, `browser_screenshot`, `browser_close`),
Berichte und Statusabfragen eines Fachablaufs, Diagnostik
(`<sprache>_diagnostics`), die allgemeinen Dateiwerkzeuge `read`, `edit`, `write` und `bash`
sowie `browser_view_screenshot`, das Bildpixel nur nativ liefern kann. Snippet bleibt, was
sich kombiniert, filtert oder Ergebnisse weiterreicht: Datenabfragen (Suche, Journal),
Verwaltungsfunktionen, alles mit Listenergebnis, und jeder Aufruf, der einen Wert aus einer
vorherigen Antwort ohne Abtippen übernimmt (etwa eine Vorschau-URL aus einer Statusfunktion
in `browser_open`). Ein natives Werkzeug bleibt in Snippets verwendbar. Die Bausteinreferenz
kennzeichnet native Werkzeuge im Funktionskatalog; die Systemübersicht nennt sie als "direktes
Werkzeug".
Der Server registriert `typescript_api` und `typescript_eval` unabhängig von Plugins als
native Grundausstattung. Modelle entdecken damit Funktionen und führen kleine TypeScript-Snippets
aus. Das optionale Actor-Programm-Plugin ergänzt dauerhafte Programme und Views; sein Fehlen
entfernt weder die Snippet-Ausführung noch die Funktionen anderer Plugins. Eine Namensauswahl in `typescript_api` liefert
die exakten TypeScript-Deklarationen, vorhandene Langbeschreibungen und passende gebundene
Anleitungen. Liste und Suche liefern nur die Kurzbeschreibung. Der generierte Katalog
und die Signaturen stammen aus der aktuellen Registry; es gibt keine manuell gepflegte zweite
Fähigkeitenliste und keinen Öffnungsschritt durch `tool_open`.

Funktionen, die Modelle aufrufen, liefern kompakte Ergebnisse. Listen und große Teilstrukturen
kommen nur auf ausdrückliche Anfrage und in reduzierter Form; Mini-Apps beziehen den vollen
Zustand über eigene Operationen.

Beobachter erzeugen einen ActorInput an ein Modell nur bei einer Änderung und nennen die
Änderung im Input; Zwischenstände ohne Änderung erzeugen keinen Modell-Turn. Das neutrale
Plugin `ragents.watch` liefert dafür Wächter mit einer Weckbedingung als Satz.

Ein natives Werkzeug erhält in `run` nie unbekannte Felder der obersten Ebene: bei einem
geschlossenen Eingabeobjekt (`additionalProperties: false`) entfernt die Engine sie vor der
Ausführung, vermerkt sie als `ignoredFields` in `tool.call.started` und weist das Modell im
Ergebnis darauf hin; ein offenes Schema reicht alles durch. Fehlende Pflichtfelder, falsche
Typen und unbekannte Felder in verschachtelten Objekten lehnt die Engine weiterhin ab
(`docs/spec/core.md`, Werkzeug-Validierung).

Feldsemantik gehört ins Schema: jede erklärungsbedürftige Eigenschaft trägt ihre TypeBox
`description`, die in den TypeScript-Deklarationen als Kommentar erscheint. Funktionsbeschreibungen
nennen keine Feldnamen. `apps/server/tests/run-function-description-drift.test.ts` prüft alle
registrierten Verträge: Nennt eine Beschreibung ein Wort, das anderswo Eigenschaft ist, aber im
eigenen Ein- oder Ergebnisschema fehlt, ist das ein Drift; eine kleine Ausnahmeliste deckt
reine Prosa ab.

Aktivierte, ersetzte und entfernte dynamische Actor-Funktionen ändern die API bereits im
laufenden Turn. Jeder ausgerüstete LLM-Actor erhält automatisch eine Übersicht aller für ihn
verfügbaren TypeScript-Funktionen als Name und Kurzbeschreibung. Die Übersicht folgt dem
aufgelösten Funktionsbestand, auch bei Subagenten und beim globalen Koordinator; sie wird nach
API-Änderungen im laufenden Turn aktualisiert. Schemata und Langbeschreibungen bleiben auf Anfrage.
Funktionsauflösung, Übersicht, Katalog, Typprüfung und Ausführung verwenden denselben
aktuellen Bestand. Eine leere Auswahl `tools: []` hält ein LLM ohne Run- und Workspace-Zugriff
und ohne Funktionsübersicht.
Benannte Auswahl und Grants begrenzen die verfügbaren Funktionen; die Wahl zwischen Snippet
und Actor-Programm erzeugt keine getrennte Implementierung oder zusätzliche Rechte.

## Skills und Startaufträge

Skills gehören ihrem Plugin und liegen unter `skills/<name>/SKILL.md`; ergänzende Dateien
bleiben im selben Ordner. `SKILLS_DIR` ergänzt lokale Skills außerhalb des Repos. Jeder Skill
enthält `name`, `description` und einen nicht leeren Body als Arbeitsanleitung. Ohne `start`
steht er nur während der Arbeit zur Verfügung. `start: true` macht ihn zusätzlich auswählbar
und verlangt `title` und eine einzelne nicht leere `category`. `order`, `tags` und `guide`
sind optional. `prompt` kann einen eigenen kurzen Startauftrag enthalten; sonst ist der Body
der Startauftrag. Explizite Beiträge verwenden `action: "skill"`, `skill`, `category` und
`prompt`. Der Skillname muss registriert sein.

Das optionale Metadatum `disable-model-invocation: true` nimmt einen Skill aus der automatischen
Skill-Übersicht des Modells heraus; ausdrücklich laden lässt er sich weiterhin. Einfache
Beispielaufträge setzen dieses Feld und bleiben über `start: true` als Einstieg auswählbar.
Wiederverwendbare Arbeitsanleitungen können zusätzlich
einen kurzen Startauftrag haben; so bleiben Auftrag und Anleitung im selben Skill.
Ein Klick zeigt nur die Vorschau. Die Übernahme öffnet den Vorbereitungschat. Parser-Tests
prüfen Dateien, Startaufträge, Schlagworte und Veröffentlichung;
`reference-run-scripts.test.ts` prüft, testet und installiert alle Referenzpakete gegen core.
