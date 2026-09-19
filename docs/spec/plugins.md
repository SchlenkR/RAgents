# Plugins: Vertrag, Ordner und Web-Host

<!-- guide:extensions -->
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
<!-- /guide:extensions -->

<!-- guide:extensions -->
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

Vertragsbeispiele stehen in der [Entwicklerreferenz](../homepage/developer.html), vollständige
Actor-Programme in der [Bausteinreferenz](../homepage/reference.html#samples). Die Anleitung
zum [Bauen von Mini-Apps](../homepage/guide-programs.html) beschreibt Paket, Zustand und View.
<!-- /guide:extensions -->

## Befundgrundlage des Erweiterungsleitfadens

Die Regeln oben übertragen beobachtete Grenzen auf Erweiterungen. Die folgende Zuordnung
nennt ihre konkreten Belege; sie ist keine weitere Vertragsliste.

| Beobachtung | Belege im Repository | Reichweite |
| --- | --- | --- |
| Enter und Knopf scheiterten im Sandbox-Frame; lange Statusabfragen erschöpften die Bridge | `apps/web/tests/actor-view-frame.test.ts`, `plugins/ragents.actor-programs/web/ActorViewFrame.tsx` | Host-Interaktion und längere Nutzung prüfen; Einschränkung gilt für Mini-App-Iframes |

Diese Befunde begründen keine neue generische Such-, Modell- oder Polling-Plattform. Gemeinsame
Codeabstraktionen entstehen weiterhin erst bei mindestens zwei echten Nutzern.

<!-- guide:extensions -->
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
`PluginRegistration` ein, etwa Funktionen, Prompts, Dienste, Methoden und Kanäle.

Der Name des PLUGIN-Ordners (der Elternordner von `server/`) ist die Kennung; ein abweichendes
`manifest.id` bricht den Start hart ab.
`requires` gehört in den Modulvertrag und NICHT ins Manifest - eine Wahrheit je Angabe. Was ein
Plugin über den eigenen Ordner hinaus braucht, holt es sich selbst aus dem `PluginHost`
(Services über Tokens); es gibt keine Sonderverdrahtung von außen mehr. Fehlt ein verlangter
Dienst, bricht der Start hart ab.
<!-- /guide:extensions -->

Der serverseitige `PluginHost` hat Registries für:

- Agent-Extensions, Skill-Pfade und Zielgruppen
- Einstiege (`host.startEntries`): alles, was ein Plugin auf die Startfläche legt, in EINEM
  Vertrag mit `id`, `title`, `description`, `order`, optional `guide` (Kennung eines Web-Leitfadens),
  optional `tags` (eindeutige Suchschlagworte) und dem Diskriminator `action`: `skill` trägt den
  registrierten Skillnamen, eine frei benannte `category` und den bearbeitbaren Startauftrag
  `prompt`; `script` trägt ein Run-Script-Paket (`handle`, `coordinator`, `files`, `programs`),
  das nur der Server sieht. Der Host prüft beim Start hart, dass jeder Skill registriert und
  jedes Paket vollständig ist; das Web prüft, dass ein aktives Plugin den Leitfaden liefert.
  Ein Produkt-Plugin liest zusätzlich `SKILLS_DIR` ein, sodass lokale Skills samt Einstieg
  ohne Code und ohne Frontend-Build entstehen
- typisierte Run-Funktionen (`host.functions`) mit optionaler nativer Werkzeugdarstellung
- benannte Fachoperationen mit Eingabeschema, Operator-Policy und gemeinsamer Ausführung für
  mehrere Oberflächen
- Modellprofile und Promptteile
- Methoden und Kanäle der Nachrichtenschicht (`host.methods`, `host.channels`, Abschnitt
  Nachrichtenschicht) sowie Auslieferungsrouten (`host.http`) für Dateien und Frames
- öffentliche Client-Konfiguration; darüber publizieren die Produkt-Plugins auch
  die globale Chat-Display-Policy (`chatSteps` aus `CHAT_STEPS_MODE_COORDINATOR/_AGENTS`,
  `_VISIBLE`, `_EXPANDABLE`, `_SELECTABLE`), die das Web als at-most-one-Beitrag
  `chatDisplayPolicy` an alle Schritt-Render-Stellen durchreicht; gibt das Produkt sie frei,
  schaltet der Benutzer den Detailgrad je Chat selbst um. Die Browserpräferenz ist nach Run,
  Actor und Anzeigefläche getrennt: Canvas-Karte, Seiteninspector und Popout desselben Chats
  merken sich je einen eigenen Detailgrad. Andere Actors und Runs bleiben unverändert. Die Rollenwerte der Policy sind nur Vorgaben; ohne Produktvorgabe gilt für Koordinator,
  Agenten und den globalen Koordinator `grouped`
- typisierte Dienste und namespaced Storage
- namespaced Session-Metadaten
- Startoptionen (`host.startOptions`): Werte, die der Benutzer auf der Startfläche wählt und die beim
  Start eines Runs als Plugin-Zustand ins Journal eingefroren werden. Eine Option nennt Schema,
  Standardwert, `selectable`, `accept` (prüft und normalisiert einen Wert oder wirft) und `describe`
  (Darstellung für das Web). Der Host hält den Wert je noch nicht gestarteter Unterhaltung über
  `ragents.startOptions.list` und `ragents.startOptions.select`, schreibt beim Start jeden Wert als initialen
  Plugin-Zustand unter der Option-Id und sperrt danach. Modell- und Systemprompt-Wahl sind die
  Startoptionen `ragents.model` und `ragents.system-prompt` des Produkt-Plugins
  (`plugin-support/product-start-options.ts`), der Arbeitsbereich ist die Startoption
  `ragents.workspace.binding` des Workspace-Plugins; der Engine-Kern liest nur den
  Systemprompt-Zustand für die Promptkomposition
- Initialisierung, Session-Vorbereitung, Stopp, Löschen und Shutdown

Ein Plugin implementiert nur die Facetten, die es braucht:

```typescript
const documentsPlugin: RAgentsPlugin = {
  manifest: {
    id: "ragents.documents",
  },
  register: (host) => {
    host.provide(documentStoreToken, store)
    host.functions(...documentFunctions)
    host.prompts(documentPrompt)
    host.http(documentRoutes)
    host.lifecycle(documentLifecycle)
  },
}
```

Eine Agent-Extension allein wäre als System-Plugin zu klein. TypeScript-Actors besitzen keine Agent-Session,
und Tabs, HTTP-Routen oder Projektionen sind hostweit. Das Plugin bündelt diese Facetten, während
seine optionale Agent-Extension genau die langlebigen Sessions erweitert.

<!-- guide:extensions -->
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
<!-- /guide:extensions -->

Bereits gespeicherte
`actor.tools.opened`-Ereignisse bleiben als historische Journalinformationen lesbar; sie
steuern keine Funktionsverfügbarkeit mehr. Neue Öffnungsbefehle gibt es nicht.

<!-- guide:extensions -->
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
<!-- /guide:extensions -->

Promptbeiträge unterscheiden über `delivery` zwischen `initial` und `on-demand`. Ohne Angabe
gilt `initial`; der Helfer `boundToTools` setzt werkzeuggebundene Beiträge standardmäßig auf
`on-demand`. Kurze Hinweise können ausdrücklich initial bleiben, etwa die Mini-App-Einführung
und der Dokumenthinweis. Die Bindung prüft die tatsächlich verfügbaren Funktionen. Worker erhalten ebenfalls passende gebundene Initialhinweise.
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
ausdrücklich neben Routing als Einsatz für Script-Actors genannt.

Die erste Ausbaustufe ist bewusst BUILD-TIME komponiert. Unbekannte Web-Bundles werden nicht zur
Laufzeit nachgeladen. Server und Web verwenden dieselbe geordnete Produktliste. Zusätzlich liefert
die Methode `ragents.plugins.bootstrap` IDs, öffentliche Konfiguration und die Einstiege (`startEntries`) aller Plugins;
ein Script-Einstieg trägt dort nur `action`, `coordinator` und die Kartentexte, nie seine Quelle. Der Web-Host prüft
Produkt und Pluginliste hart und startet bei einem Mismatch nicht. Plugin-Versionen gibt es nicht
mehr: Server und Web werden immer zusammen gebaut, die Pluginliste selbst ist der Vertrag.

Öffentliche Plugin-Konfiguration steuert auch die tatsächlich aktiven Web-Beiträge. Ein
installiertes, aber für die aktuelle Umgebung deaktiviertes Plugin bleibt für den Listenabgleich
im Profil, liefert jedoch weder Provider noch Tabs oder Presenter, und seine Einstiege fallen weg. So verschwindet
ein Fachplugin in einer Umgebung ohne seine Voraussetzungen gemeinsam mit seinen serverseitigen Beiträgen.

`ragents.transcript` ist ein reines Funktionsplugin ohne Web-Hälfte: `actor_transcript` liefert
den Verlauf eines Actors dieses Runs als kompaktes Transkript aus dem Journal, für Agenten und
Script-Actors mit `event.subscribe`. Eingaben, Antworttexte und Werkzeugaufrufe stehen je auf
einer Zeile, Werkzeugeingaben und -ergebnisse werden auf 200 und 300 Zeichen gekürzt, Reasoning
entfällt; bei Überschreitung der Zeichengrenze (Vorgabe 20000) entfallen die ältesten Zeilen
zuerst mit einer sichtbaren Auslassungsmarke. Gedacht für Übergaben, Statusberichte des
Koordinators und Zusammenfassungen; es ersetzt keinen Fork und keine Kompaktierung und wird
nicht in den Reviewstand des Regelreviews aufgenommen, damit Reviewer den Code prüfen und nicht
die Erzählung des Implementierers.

## Self-contained Plugin-Ordner und Ownership

Jede Plugin-ID besitzt einen Ordner unter `plugins/` mit der Hälfte `server/` und, bei einem
Web-Beitrag, zusätzlich `web/`. Ein rein serverseitiges Plugin braucht keinen leeren Web-Ordner.
Jeder Ordner besitzt die zu seiner Fähigkeit gehörenden Assets und Beiträge. Nicht jedes Plugin
braucht jede Facette, aber eine vorhandene Facette bleibt bei ihrem Besitzer:

| Facette                   | Ownership                                                                 |
| ------------------------- | ------------------------------------------------------------------------- |
| Prompt                    | `.hbs` beim Server-Plugin, das die Regel oder Fähigkeit liefert           |
| Skill                     | `skills/<name>/SKILL.md` beim besitzenden Plugin, inklusive Zielgruppe und optionalem Startauftrag |
| Run-Script                | `run-scripts/<name>/` beim Plugin, dessen Fähigkeit der Run vorführt      |
| Auswählbarer Systemprompt | `prompts/<name>.md` oder `.hbs` beim Produkt-Plugin                       |
| API                       | Verträge im `contract.ts`, Methoden im Server-Plugin, `rpc.call` im Web-Plugin |
| UI und CSS                | Komponenten und Styles im passenden Web-Plugin                            |
| Konfiguration             | Deklaration und Auswertung im passenden Server-Plugin                     |
| Storage                   | `host.storage`, immer unter `plugins/<plugin-id>`                         |
| Lebenszyklus              | Start, Session-Vorbereitung, Löschen und Shutdown beim Besitzer           |

Die drei Asset-Ordner `skills/`, `run-scripts/` und `prompts/` liest der Host per KONVENTION aus
dem Ordner jedes komponierten Plugins (`plugin-support/plugin-folder.ts`, angewandt in
`profile/compose.ts`). Ein fehlender Asset-Ordner ist kein Fehler; ein vorhandener mit kaputtem
Inhalt bleibt ein harter Fehler. Meldet ein Plugin denselben Einstieg oder denselben Skill-Pfad
zusätzlich ausdrücklich an - etwa weil es dabei eine Zielgruppe setzt -, gewinnt die
ausdrückliche Anmeldung und der Konventionsbeitrag entfällt.
Die Konvention lädt Assets, das Probing lädt den Code - beides aus demselben Ordner, sodass ein
Plugin vollständig in seinem Verzeichnis lebt.

Es gibt deshalb keine zentrale Sammlung für Produktprompts, Skills oder Plugin-Konfiguration.
Das Entfernen eines Fachplugins entfernt Prompt, Werkzeuge, Projektion, Methoden, Kanäle, Auslieferung,
Konfiguration, Web-Tab, CSS und Session-Datenzugriff als eine Fähigkeit. Bereits
persistierte Daten werden dadurch nicht stillschweigend gelöscht. Generische Hilfen für das Laden
eines Assets oder das Registrieren eines Prompts bleiben wiederverwendbare Host-Komponenten und
besitzen keine Produktfachlichkeit.

`ProductRuntime` und `WorkspaceRuntime` verhindern umgekehrt, dass der neutrale Host Produktwissen
benötigt. Das Produkt-Plugin liefert Koordinator-Descriptor, Standardprofil, Anzeige und den
Rollenvertrag. Das Workspace-Plugin löst den Arbeitsbereich je Lauf auf und beschreibt seinen
Modus. `ragents.workspace` liest die Bindung des Runs aus der Startoption
`ragents.workspace.binding` (Abschnitt Arbeitsbereich, Sandbox-Werkzeuge und Prozesse). Bei der
Art `fresh` legt es je Unterhaltung ein leeres Verzeichnis unter der Session-Ablage an; den Inhalt
oder ein anderes `cwd` liefert dafür optional ein Plugin über `workspaceResolverToken`
(`resolve({ runId, directory, choice, emitSystem })`). Meldet der Resolver eine `optionId`, liest
`ragents.workspace` die Wahl des Benutzers aus dem Journal und reicht sie als `choice` durch. Vor
dem Start des Runs gibt es kein Arbeitsverzeichnis (HTTP 409 `run-not-started`), und die Auflösung
muss für dieselbe Bindung deterministisch sein, weil die Agentenlaufzeit nach einem Neustart
dasselbe `cwd` erwartet. Der Host ruft die Auflösung erst nach dem Anlegen des Runs auf, damit die
Startoptionen im Journal stehen; die Agentenlaufzeit bekommt das `cwd` je Run über den
Provider-Cache.

Die Dateiablage ist ein eigener Dienst: `ragents.documents` stellt `documentStoreToken`
(`directoryFor(runId)`) bereit, standardmäßig unter `host.storage.session(runId, "documents")`,
mit `DOCUMENTS_DIR` als Unterordner je Run unter einem externen Pfad. Die Sandbox holt sich das
Verzeichnis optional beim Dienst und macht es als `RAGENTS_FILES_DIR` les- und schreibbar; je Thema
entsteht darin ein Unterverzeichnis, `ragents.documents` zeigt es im Dokumente-Tab an.
Actor-Programme verwenden einen eigenen privaten pnpm-Workspace unter ihrer Session-Ablage.
Seine `actors/`-Sammlung wird als zusätzlicher Arbeitsbereich bereitgestellt: Dateitools und
Language Server lösen `@actors` auf, Bash erhält `RAGENTS_ACTORS_DIR`. Die Autorisierung und
Auflösung dieser Plugin-Arbeitsbereiche erfolgt über den gemeinsamen Workspace-Vertrag;
das Modell muss keine privaten Speicherpfade aus Antworten übertragen.
Weitere Plugins konsumieren die Workspace-Dienste über typisierte Tokens.

`show_document` öffnet eine Dokumentanzeige aus den protokollierten Werkzeugargumenten oder
einer Datei der Ablage. Es veröffentlicht kein Core-Artefakt: `RunView.artifacts` bleibt dabei
unverändert. Unveränderliche, versionierbare Run-Ergebnisse entstehen über `artifact_publish`;
die Dokumente-Ansicht führt diese Ergebnisse zusätzlich zu Dateien und Anzeigen auf.
Die Dokumentknöpfe im primären Chat und in den Actor-Gesprächen auf dem Canvas sowie im
Inspector verwenden denselben registrierten Tool-Presenter und öffnen die Dokumente-Ansicht.
Deren Chat-Sammlung berücksichtigt alle geladenen Actor-Verläufe und führt denselben
Werkzeugaufruf aus Hauptverlauf und Actor-Verlauf nur einmal auf.

`ProductRuntime` und `WorkspaceRuntime` sind Pflichtverträge jedes Profils: fehlt einer der beiden
Dienste, bricht der Server beim Start mit einer klaren Fehlermeldung ab, statt in einem halben
Zustand zu laufen. Das ist eine dokumentierte Ausnahme vom ENTFERNUNGSTEST - das jeweilige Plugin
ist nicht optional, sondern Teil des Vertrags zwischen Profil und Engine. Der Logik-Beitrag ist
dagegen optional: ohne `ragents.orchestration` startet der Server, und ein TypeScript-Actor findet
zur Laufzeit keinen Treiber.

Session-Metadaten sind ebenfalls Beiträge. Der Server sammelt sie je Run unter der Plugin-ID, das
Web rendert die passende Darstellung aus seiner Registry. Ein Workspace-Plugin liefert so
zum Beispiel den Branch für Unterhaltungsliste und Chat, ohne dass der Session-Core
Git-Fachlogik kennt.

Speicherpfade sind reine Konvention und nicht deklarierbar: `host.storage.root(...)` liegt unter
`${DATA_DIR}/plugins/<plugin-id>/`, `host.storage.session(runId, ...)` unter
`${DATA_DIR}/sessions/<runId>/plugins/<plugin-id>/`. Ein Plugin bekommt diese Pfade nur über
`host.storage` und kennt kein rohes `DATA_DIR`. Ein Workspace-Plugin legt darunter zum Beispiel
UID-Zuordnung und Git-Infrastruktur ab, ein Build-Plugin seine Caches und Zugangskonfiguration -
jedes unter seinem eigenen Wurzelverzeichnis, ohne gemeinsamen Ordner und ohne Querverweis.

## Plugin-Ordner an beliebiger Stelle

Wo ein Plugin-Ordner liegt, ist gleichgültig. Das Profil nennt ein Plugin per Kennung (Ordner unter
`plugins/` im Repo) oder per Pfad: absolut, mit `./` relativ zur Profildatei oder mit `~/`. Der
Ordnername ist die Kennung; eine Kennung, die zweimal vorkommt, ist ein harter Fehler, ebenso ein
Pfad ohne Ordner oder ohne `server/index.ts`. `loadPlugins` in
`apps/server/src/profile/plugin-discovery.ts` löst die Einträge auf und trägt jeden Ordner mit
`registerPluginFolder` ein; `pluginFolder(id)` liefert danach den Ordner für Skills, Prompts,
Run-Scripts und Assets. Für eine Kennung ohne Registrierung gilt weiter `plugins/<id>`.

Host-Code importieren Plugins über Paketnamen, nie über relative Pfade nach `apps/`:
`@aicontainer/server/<pfad>` für `apps/server/src`, `@aicontainer/web/<pfad>` und
`@aicontainer/web/ui` für `apps/web/src`, `@aicontainer/ragents` für die Engine und
`@aicontainer/plugins/<id>/<pfad>` für andere Plugins im Repo. Testhelfer stehen unter
`@aicontainer/server/tests/<datei>` und `@aicontainer/web/tests/<datei>`. Die `exports`-Karten in
`apps/server/package.json`, `apps/web/package.json` und `plugins/package.json` sind der Vertrag;
die `paths` der tsconfigs und die Vite-Aliase bilden ihn für Typprüfung, esbuild und Bundle ab.
Plugins außerhalb des Repos erreichen ihre Geschwister relativ.

Auflösung außerhalb des Repos: `apps/server/src/host-resolution.ts` registriert den Loader-Hook
aus `host-resolution-hooks.ts`. Schlägt die normale Auflösung eines nackten Bezeichners fehl, wird
er so aufgelöst, als käme der Import aus `apps/server/src/main.ts`, danach aus
`apps/web/src/main.tsx`. Externe Plugins finden damit die Host-Pakete und alle Abhängigkeiten des
Hosts ohne eigene `node_modules`; eigene `node_modules` eines Plugins gewinnen weiterhin. Der
Server-Einstieg `main.ts` registriert den Hook selbst; Skripte und Tests, die externe Dateien
laden, importieren `host-resolution.ts` per `--import`.

Web-Bundle: `apps/web/vite.config.ts` bündelt die Repo-Plugins und, wenn `PRODUCT_PROFILE`
gesetzt ist, zusätzlich die externen Plugins des Profils; `apps/server/src/profile/plugin-list.ts`
liefert dafür die aufgelöste Liste. Das virtuelle Modul `virtual:ragents-plugins` trägt die
Web-Einstiege je Kennung, ein statisches Glob gibt es nicht mehr. Für externe Dateien leitet ein
Resolver nackte Importe zum Host um und ergänzt deren `web/` und `client-ui/` als
Tailwind-`@source`. Das Bundle ist damit profilspezifisch; `scripts/start.sh` baut es vor jedem
Start mit dem gewählten Profil. Der Composer setzt `manifest.web`, wenn der Ordner eine Web-Hälfte
hat; die Oberfläche bricht ab, wenn das Bundle eine erwartete Web-Hälfte nicht enthält. Ein Plugin,
das `web` selbst deklariert, wird wie eines mit `requires` im Manifest abgewiesen.

Ausnahme: `plugins/ragents.actor-programs/client-ui` importiert Host-Code weiter relativ, weil das
Client-SDK der Actor-Programme diese Dateien samt Importpfaden in Actor-Projekte kopiert.

Ein Plugin-Projekt außerhalb des Repos prüft sich selbst: Es erweitert `apps/server/tsconfig.json`
beziehungsweise `apps/web/tsconfig.json` des Hosts per `extends`, nennt eigene `include`-Listen
und ergänzt `paths` und `typeRoots` auf die `node_modules` des Hosts. `pnpm check` im Repo prüft
nur die Repo-Plugins. `scripts/install-plugin-dependencies.sh` kennt nur die Repo-Plugins.

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

Im Browser liefert `useAccess` den gleichen Zugriffskontext und `logout`.
`accessMode` unterscheidet verborgen, nur lesbar und bearbeitbar. Workspace-Tabs, Session-Kopf- und Statusbeiträge können über `readRight` ein eigenes
Leserecht verlangen. Technische Beiträge verwenden `runs.inspect`. Settings-Beiträge können
ebenfalls ein eigenes Leserecht verlangen; ohne Angabe gilt das Settings-Leserecht.
Die Komponente prüft ihre Schreibaktionen ebenfalls. Ausblenden ersetzt keine serverseitige
Prüfung: Eigene Routen deklarieren ihre erforderlichen Rechte unabhängig von der UI.

Der übergeordnete Koordinator besitzt eigene Rechte im Vertrag von `ragents.overseer`.
Lesen erlaubt Verlauf und Modellanzeige; Aufträge und Reset brauchen zusätzlich Schreiben.
Modelländerungen verlangen außerdem Settings-Schreibzugriff. Seine globalen Run-Routen
werden über die vom Plugin beigetragene `GlobalChatPolicy.access` zugeordnet. Die allgemeine
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
Fehler und wird protokolliert. Fehler kommen als JSON-RPC-Fehler: `-32601` unbekannte Methode,
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

Kernverträge: `ragents.sessions.*`, `ragents.chat.*`, `ragents.runs.*` (Laufansicht, Journal,
Warteschlangen, Stopp und Rückfragen aus der Engine), `ragents.startOptions.*`,
`ragents.runs.prepare`, `ragents.settings.*`, `ragents.plugins.bootstrap`, `ragents.external.set`
und die Kanäle `ragents.sessions`, `ragents.run` und `ragents.chat`
(`apps/server/src/api/contracts.ts`, `packages/ragents/src/http/contracts.ts`). Was keine
JSON-Nachricht ist, bleibt Auslieferung über `host.http`: statische Oberfläche, Mini-App-Frames,
Artefakt- und Anhanginhalte unter `/files/runs/<run>/artifacts/<id>` und
`/files/runs/<run>/attachments/<id>`, Dokumentinhalte, Hilfe und `/health`. Der Erweiterungspunkt
`http` ist nur noch dafür da; jede JSON-Antwort ist eine Methode.

Die Referenz entsteht aus den Registrierungen: `host.methods.describe()` und
`host.channels.describe()` liefern Owner, Id, Beschreibung, Rechte und Schemata für die lesbare
Referenz und das OpenRPC-Dokument. Der Web-Client (`apps/web/src/rpc/client.ts`) läuft auch
unter Node; Erweiterung und `pnpm driver` verwenden ihn mit eigenem `fetch`.

## Web als Plugin-Host

Jede Seite hält genau EINE Live-Verbindung zum Server: der Client `rpc` (`apps/web/src/rpc.ts`)
öffnet `GET /rpc/stream` mit dem ersten Abonnement oder dem ersten Rückruf-Handler und schließt
ihn, wenn nichts mehr offen ist. Anfragen gehen als `POST /rpc`. Abonnements sind Kanalverträge:
`rpc.subscribe(contract, params, onMessage, onError)`; bei Verbindungsverlust verbindet der Client
neu, abonniert alle Kanäle erneut und ruft `onConnected`-Hörer, weshalb Anbieter beim Abonnieren
ihren Anfangsstand wiederholen. Kern-Kanäle: `ragents.sessions` (Listenänderungen, sofort eine
Meldung), `ragents.run` (`ready` beim Abonnieren, danach `run` je Journaländerung) und
`ragents.chat` (die Chat-Ereignisse mit Replay). Plugins registrieren eigene Kanäle über
`host.channels`: `ragents.processes` je Run, `ragents.workspace.browse` je Run und Wurzel.
Hintergrund: Browser erlauben je Host nur sechs gleichzeitige HTTP/1.1-Verbindungen;
vier eigene Streams je Seite plus ein zweiter Tab hatten den Vorrat aufgebraucht, sodass keine
weitere Anfrage mehr abging.

Der Canvas verwendet Schichtwerk: matte, gerade Karten mit 17 Pixeln Eckradius und nach rechts
oben extrudierten Körpern. Der Primary-Actor trägt Lavendel, weitere LLM-Actors Tonfarbe,
TypeScript-Actors Senfgelb und Mini-App-Hosts Blaugrau. Im freien Canvas bleiben zwischen den sichtbaren
Tiefenkörpern mindestens 32 CSS-Pixel Abstand; die Materialtiefe kommt beim Layout dazu.
Größere explizite Layoutabstände und der Platz für beschriftete Verbindungen bleiben erhalten.
Der Hintergrund kombiniert weiche Farbverläufe in Lavendel, Mint und Blau mit einer
hellen Mitte, einem warmen Randbereich und dezenter Materialstruktur. Die dunkle Darstellung
verwendet gedämpfte Varianten derselben Farben; ein Punktraster gibt es nicht. Die Tiefe ist vorne dunkler und wird in der eingestellten Anzahl
flächigen Stufen nach hinten heller. Eine breite, ebenfalls gestufte Schattierung fasst die
runde obere rechte Kante; sie dunkelt die Materialfarbe ausschließlich ab. Front und äußere
Silhouette besitzen eine Kontur, zwischen den Tiefenstufen gibt es keine zusätzlichen Linien.
Die Front besitzt keine zweite innere Zierkontur.
Die Frontflächen bleiben matt und gleichmäßig; die Maus verändert ihre Beleuchtung nicht.
Die Karten verwenden keinen Filter-Schlagschatten und keinen WebGL-Schattenrenderer.
Farben, Schriften, Radien und Schatten stehen zentral in `apps/web/src/ui/theme.css`; Host, Chat,
Orchestration-Karten und gemeinsame Mini-App-Controls verwenden dieselben semantischen Tokens.
Kopfzeile, rechtes Panel und Statusleiste verwenden ein gemeinsames, deckendes Schieferblau;
Dialoge und Einstellungen verwenden hellere blaugraue Flächen und lavendelfarbene Auswahlflächen. Text, Konturen und Schatten sind violettgrau abgestimmt. Datei- und
Statusfarben folgen ebenfalls den zentralen, für Hell und Dunkel definierten Farbtokens.
Die Auswahl eines Actors hebt Rand und Umfeld seiner Karte hervor. Eigene Benutzernachrichten
stehen auf einer neutralen Fläche mit Kontur; ausdrücklich eingefärbte Mehrparteienbeiträge
behalten ihre eigenen Farben.

Unter Einstellungen, Darstellung, Schichtwerk wählt `Tiefenstufen` eine ganze Anzahl von 0 bis 5;
die Vorgabe ist 1. Jede Stufe besitzt fest 12 Tiefeneinheiten und ragt sichtbar sechs CSS-Pixel
nach rechts und 8,4 CSS-Pixel nach oben. Bei 0 bleibt die Karte flach.
Die Anzahl wird im Browser unter derselben Serveradresse gespeichert und wirkt unmittelbar auf
die Karten aller Runs im freien Canvas. Kacheln verwenden fest null Tiefenstufen. Alte Pixelwerte werden nicht migriert. Eine ungültige gespeicherte
Einstellung zeigt einen Fehler mit der Möglichkeit zum Zurücksetzen auf die Vorgabe.

Unter Einstellungen, Darstellung lässt sich die Oberfläche hell, dunkel oder gemäß Systemeinstellung
anzeigen. Ohne gespeicherte Wahl startet die Oberfläche dunkel. Die Auswahl gilt sofort für
alle Runs und offenen Tabs derselben Serveradresse in diesem Browser; sie ist kein Profilwert
und wird nicht auf dem Server gespeichert. Ändern verlangt Settings-Schreibrechte.
Die Oberfläche übernimmt die gespeicherte Darstellung vor dem ersten React-Render. Nur bei
Systemauswahl folgt sie späteren Änderungen der Systemeinstellung. Theme-Wechsel verändern
weder die Kamera noch gemountete Ansichten oder Eingabeentwürfe. Ungültige gespeicherte Werte
und Speicherfehler werden ausdrücklich angezeigt. Die Darstellung ist ein fester Host-Bereich
und bleibt unabhängig von Beitragsfiltern und dem Laden der Plugin-Einstellungen erreichbar.
Mini-App-Frames erhalten die aufgelöste Darstellung über ihre vorhandene Bridge (siehe run-modules).

Menüs, Kopfzeilenhinweise, Actor-Pop-outs, Chat-Schrittdetails, Journal und globaler
Koordinator sind `Popover`, `Tooltip` und `Select` aus der UI-Bibliothek; Base UI positioniert
sie am Anker (auch an einer virtuellen Position oder unter der Headerkante), begrenzt sie auf
den verfügbaren Platz und folgt Scrollen und Layoutänderungen. Abstände, Öffnungsrichtung,
Fokusziel und Schließverhalten bleiben Eigenschaften des jeweiligen Aufrufers.

Die lokalen Header-, Canvas-, Karten- und Zoom-Einstellungen teilen Speicherung, Validierung
vor dem Schreiben und Benachrichtigung im selben sowie in anderen Browser-Tabs. Theme und
Material verwenden denselben Storage-Listener; ihre eigenen Parser, Schlüssel und
Fehleranzeigen bleiben fachlich getrennt. Dialog und DialogContent bieten einen gemeinsamen
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

- Startoptionen der Startfläche (`startOptions`: Bedienkomponente und Abzeichen je Option-Id;
  ohne Komponente ein Auswahlmenü aus einer Darstellung `{ kind: "choice", label, options }`).
  `placement` wählt die Startfläche (`surface`, Vorgabe) oder die Eingabeleiste (`composer`);
  der Modellbeitrag verwendet die Eingabeleiste.
- Übersichtsbeiträge (`overviewPanels`): unabhängige Flächen mit `placement` in der Übersicht
  (Vorgabe `overview`) oder der Kopfzeile (`toolbar`); `readRight` begrenzt die Sichtbarkeit.
  Ihr Kontext enthält Registry, Öffnungszustand, `onOpen`, `onClose` und `onBusy`. Der Host
  koordiniert Übersicht und Toolbar-Verlauf. Toolbar-Beiträge sind ab Anwendungsstart gemountet,
  aktivieren eigene Verbindungen aber erst bei Nutzung und erhalten sie danach bei Run-Wechseln.
- Workspace-Tabs und Badges
- Tool- und Entity-Presenter; die Session-Provider binden Tool-Darstellungen gemeinsam an
  Session und Navigation. Standardchat und Actor-Chat konsumieren denselben Renderer.
- Session-Metadaten
- Run-Kopfbeiträge (`sessionHeaders`): `placement: "canvas"` setzt den Beitrag in die Leiste
  oben am Canvas; ohne Angabe beziehungsweise mit `"header"` bleibt er in der Titelleiste.
  `ActorProgramsHeader` verwendet die Canvas-Leiste.
- Session-Provider und Canvas-Steuerung; `toolbarContainer` nimmt den Canvas-Knopf in der
  Kopfzeile zwischen Übersichtsecke und Toolbar-Beiträgen auf
- Run-Statusbeiträge (`sessionStatus`): nach `order` sortierte Gruppen in der gemeinsamen
  unteren Statusleiste; `Status` erhält denselben Session- und Navigationskontext wie ein
  Kopfzeilenbeitrag. Der Canvas erhält über `statusContainer` das Ziel für seine Steuergruppe.
- Kartenabschnitte auf Actor-Karten (`cardSections`)
- Leitfäden (`guides`): je Kennung eine React-Komponente, die der Host beim Klick auf einen
  Einstieg mit `guide` in einem Dialog zeigt; `onComplete` liefert bei einem Skill den Text der
  ersten Nachricht, bei einem Run-Script den Startwert als JSON (etwa die Gesprächsrunde
  von `ragents.reference`)

Die gemeinsame Titelleiste ist 45 Pixel hoch. Direkt darunter liegt oben am Canvas eine eigene
mindestens 52 Pixel hohe Leiste für Apps und Actor-Zugänge. Sie hat eine feine untere
Trennlinie und keinen eigenen
Schatten; der Schatten der Titelleiste liegt über ihr. Die Canvas-Leiste liegt außerhalb des
Dialogbereichs `canvas`, sodass sie auch bei geöffneter App-Vollansicht bedienbar bleibt.
Bei Platzmangel erscheinen links und rechts neben den direkten App- und Actor-Zugängen
Pfeilknöpfe, die um den Großteil der sichtbaren Breite blättern. Am jeweiligen Ende ist der
Knopf deaktiviert. Mausrad, horizontales Trackpad-Scrollen und Tastaturnavigation bewegen
denselben Bereich ohne sichtbaren Scrollbalken; Anzeige und Actorliste bleiben links stehen.
Mausradereignisse innerhalb eines geöffneten Pop-outs gehören dessen Inhalt und werden nicht
in horizontales Scrollen der Leiste umgewandelt, auch nicht an den Scrollrändern des Inhalts.
Die Pfeile passen sich an Fenstergröße, neue Einträge und Typfilter an. Bei reduzierter
Bewegung blättern sie ohne Animation. LLM-Actors tragen ein Personen-Symbol auf Tonfarbe,
TypeScript-Actors ein Code-Symbol auf Senfgelb und Mini-Apps ein Raster-Symbol auf Blaugrau.
Tooltips und zugängliche Beschriftungen nennen den Typ auch bei eigenen Anzeigenamen.

Die direkten Actor-Einträge in dieser Canvas-Headerzeile öffnen ein Pop-out unter ihrem
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
Beide verwenden dieselbe Ansicht wie der rechte Inspector. Es ist jeweils ein Actor-Pop-out
offen. Erneuter Klick, Außenklick, Fokus außerhalb, Escape oder X schließen es; Escape und X
geben den Fokus an den Eintrag zurück. Besuchte Ansichten bleiben verborgen gemountet,
damit Eingabeentwürfe beim Schließen oder Actor-Wechsel erhalten bleiben. Ein Run-Wechsel
verwirft diese Ansichten. Das Pop-out ist ein `Popover` mit `keepMounted`, das am Knopf
hängt und auf den verfügbaren Platz begrenzt bleibt. Der Einstieg öffnet kein rechtes Panel;
weiterführende Verweise auf einzelne Inputs, Turns und andere Entitäten verwenden dessen
bestehende Navigation. Übergeordnete Dialoge blenden das Pop-out aus.

Links vor `Actors` schaltet der gleichbleibend 120 Pixel breite Knopf `Anzeige` zyklisch
zwischen `Alle`, `Aktive`, `Sichtbare`, `LLM-Agenten` und `TypeScript` um. `Aktive` ist die Vorgabe und zeigt direkte Zugänge für alle
nicht gestoppten LLM- und TypeScript-Actors. `Alle` ergänzt gestoppte Actors;
`Sichtbare` zeigt nur Actors, deren Karte oder Kachel gerade auf dem Canvas steht, dazu immer
den primären Actor; die Grundlage sind dieselben Bühneneinträge, die auch die ausgegrauten Zugänge bestimmen.
`LLM-Agenten` und `TypeScript` zeigen nur den jeweiligen Typ, einschließlich gestoppter Actors. Menschliche Beteiligte stehen
nur in der vollständigen Actorliste. Die Auswahl betrifft die direkten Actor-Zugänge,
nicht Mini-App-Einträge oder Canvas-Karten, und bleibt im Browser je Run gespeichert.
Die vollständige Liste unter `Actors` ist in jedem Modus erreichbar, einschließlich
ausgeblendeter Karten und gestoppter Actors. Die Liste liegt über dem Canvas und dem
rechten Panel. Durch einen Moduswechsel verborgene Chats behalten ihre Entwürfe.
Actorliste, Actor-Chats und Canvas-Ansicht verwenden dasselbe Pop-out-Control mit
gemeinsamer Positionierung, Kopfzeile und Fläche. Es schließt ohne Abstand am Knopf an;
Actorliste und Chats öffnen nach unten, die Canvas-Ansicht nach oben.
Toolbar-Knöpfe zeigen während des Drückens und bei geöffneter Fläche eine vertiefte
Akzentfläche mit innerem Schatten und unterer Markierung; Hover allein vertieft sie nicht.

Die Reiterleiste des Arbeitsbereichs steht in der gemeinsamen Titelleiste neben Einstellungen
und Hilfe. Ihre kompakten Symbole wählen den Inhalt des rechten Panels. Der vollständige
Name bleibt als Tooltip und zugängliche Beschriftung erhalten; Hinweise auf neue Inhalte und
Badges teilen sich je Reiter maximal einen Punkt; der Hinweis auf neue Inhalte hat Vorrang.
Sprachplugins liefern ihre kurzen Kennzeichen selbst als Symbol,
etwa `C#`, `TS` oder `F#`; der Host unterscheidet dafür keine Plugin-IDs. Bei Platzmangel lässt
sich die Leiste horizontal scrollen.
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

Im Actor-Inspector wählt eine einzeilige Symbolleiste genau eine Ansicht. Das X links zeigt
Chat und Eingabe; die übrigen Knöpfe zeigen jeweils einen Detailbereich an derselben Stelle
mit der gesamten verfügbaren Höhe. Tooltips und zugängliche Beschriftungen enthalten Namen
und gegebenenfalls Anzahlen. Der Infochip zeigt Status, Actor-Art, Driver, Modell, Denktiefe,
offene Inputs, Turnzahl und gegebenenfalls Laufkosten. Chat und Eingabe bleiben beim Wechsel
verborgen gemountet, damit der Entwurf erhalten bleibt. Pfeiltasten, Home und End wählen die
Ansicht ebenfalls; bei Platzmangel scrollt die Symbolleiste horizontal.

Das rechte Arbeitsbereichspanel schließt ohne Außenabstände und abgerundete Außenecken an
die Titelleiste und den rechten Fensterrand an und endet oberhalb der Statusleiste. Ein
Schlagschatten an seiner linken Kante hebt es vom Canvas ab. Kopfzeile und Statusleiste
werfen ebenfalls einen dezenten Schatten zur Arbeitsfläche hin; alle drei Schatten besitzen
eigene, für helle und dunkle Darstellung abgestimmte Tokens. Der Größenanfasser an dieser Kante verändert weiterhin
seine Breite. Reiter und Ein-/Ausklappknopf bilden zusammen mit Einstellungen und Hilfe den
rechten Bereich der gemeinsamen Titelleiste; das Panel hat keine eigene Reiterleiste.
Einstellungen und Hilfe öffnen ihre Dialoge.
Der Panelknopf verwendet wie Einstellungen und Hilfe `Button variant="ghost" size="icon-lg"`
mit einem 22-Pixel-Symbol.

Breite und Aufklappzustand des Panels werden im Browser je Run gehalten. Automatisches
Öffnen eines Reiters in einem Run verändert andere Runs nicht. Der Dateibrowser hält Root,
versteckte Dateien und Baumzustand ausschließlich in seiner Komponenteninstanz; beim
Unmount wird dieser Zustand verworfen. Es gibt dafür keinen modulglobalen Speicher.
Das Panel lässt sich vollständig einklappen. Dann bleibt von ihm nur der Öffnungsknopf in der
Titelleiste sichtbar; Reiter, Inhalt und Größenanfasser sind verborgen. Erneutes Öffnen
stellt die zuletzt gewählte Breite innerhalb des verfügbaren Platzes wieder her. Breite und
Öffnungszustand werden im Browser gespeichert. Besuchte Reiter mit `keepMounted` behalten beim
Reiterwechsel ihren Zustand; Einklappen erhält die gemounteten Inhalte mit `active: false`.
Eine ausdrückliche Navigation zu einem Reiter,
zum Beispiel über einen Actor-Kartenkopf oder einen Namen in der Actorliste, öffnet das Panel wieder.

Der Chat des Inspectors setzt den ausgewählten Actor als Darstellungs-Owner: Seine eigenen
Nachrichten erscheinen ohne Sprechblase, Beiträge anderer Beteiligter behalten ihre bisherige
Darstellung. Die Actor-Projektion liefert dafür Absenderkennungen unabhängig von Anzeigenamen.

Der Beitrag `cardSections` (`id`, `order`, `Section`) rendert Abschnitte in jede Actor-Karte des
Netzes; ein Beitrag ohne Inhalt liefert `null`, mehrere Beiträge auf derselben Karte sind der
Normalfall. Das Kern-Web kennt das Actor-Domänenmodell an dieser Grenze NICHT: der Kontext
reicht `actor` untypisiert durch, und das beitragende Plugin parst ihn über den Vertrag des
Orchestration-Plugins. Aktuell tragen `ragents.ask` (offene Fragen mit `askedBy === actor.id`),
`ragents.orchestration` (Artefakte mit `createdBy === actor.id`) und `ragents.todo` (Actor-Scope
aus `RunView.pluginStates`) bei. Die Höhe der Abschnitte fließt in die Kartenmessung und damit
in das Layout ein. Kartenbeiträge ändern niemals Identität, Capabilities oder Werkzeugauswahl
eines Actors.

Die Arbeitsfläche hat zwei sich ausschließende Modi: den freien Canvas als Vorgabe und eine
feste Kachelfläche. Die Statusleiste schaltet mit "Frei" und "Kacheln" um. Im Kachelmodus füllt
die Aufteilung den verfügbaren zentralen Bereich, einschließlich Anpassung an das rechte Panel.
Pan, Kamera-Zoom, Doppelklick-Zentrierung und Kamera-Navigation mit Pfeiltasten sind dort aus;
Canvas-Übersicht und Zoomknöpfe sind deaktiviert. Jede Kachel scrollt ihren eigenen Inhalt.
Kacheln verwenden dieselben Schichtwerk-Flächen, Konturen und Radien wie der freie Canvas,
mit fest null Tiefenstufen unabhängig von der Materialeinstellung.
Mini-Apps füllen die Kachel ohne einen zweiten App-Kopf. Ihr Inhalt wird wie im freien Canvas
mit Faktor 0,9 dargestellt; derselbe Faktor gilt in der Vollansicht. Der entsprechend größere
innere Frame füllt die Fläche vollständig. LLM-Kacheln zeigen ihren Chat, standardmäßig mit Eingabe, und die vorhandenen Kartenbeiträge,
einschließlich bedienbarer Rückfragen. TypeScript-Kacheln zeigen ihren Verlauf und ihre Details.
Der Wechsel zurück stellt die freie Kamera und Anordnung wieder her.

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

Die Programmanordnung ist Run-Zustand. Änderungen über die Oberfläche speichern Modus und
Kachelbaum samt zugrunde liegender Programmanordnung als persönliche Vorgabe je Run im Browser.
Eigene Größen und Anordnungen bleiben bei unverändertem Programm erhalten. Ändert das Programm
Modus oder Kachelbaum, folgt die Fläche sofort der neuen Vorgabe und entfernt die überholte
persönliche Anordnung. Das gilt auch nach erneutem Öffnen des Runs. Ältere persönliche Vorgaben
ohne gespeicherte Grundlage dürfen zusätzliche Programmkacheln nicht verdecken.
"Programmvorgabe übernehmen" setzt eine eigene Anordnung auch vorher zurück. Beim ersten manuellen Wechsel
in den Kachelmodus ohne vorhandenen Kachelbaum werden die aktuell sichtbaren Inhalte aufgeteilt.

`ragents.orchestration` stellt "Lauf stoppen" in der Run-Titelleiste für Benutzer mit
Schreibrecht bereit, unabhängig vom Agenteninspektor. Sein Werkzeug `run_stop` erlaubt dem
Primary-Actor mit `execution.stopOwned`, den eigenen Run über dieselbe Sitzungsverwaltung
vollständig zu stoppen. Die Run-Identität stammt aus dem Aufrufkontext. Der Aufruf wartet
nicht auf sein eigenes Turnende; Bereinigungsfehler meldet der Host im Serverprotokoll.

Für die Programmanordnung trägt `ragents.orchestration` das Werkzeug
`canvas_layout_replace` bei. Koordinatoren und Run-Scripts wählen damit ebenfalls den Modus.
`mode: "tiled"` und `root` beschreiben einen binären Baum aus Actor-/App-Blättern und horizontalen
oder vertikalen Teilungen mit zwei positiven Gewichten. Gleiche Gewichte ergeben 50:50, `[2, 1]`
zwei Drittel und ein Drittel. Der gemeinsame Vertrag prüft Tiefe, Größe, eindeutige Teilnehmer
und Gewichte; die TypeScript-API liefert rekursive Typen bis in die verschachtelten Kinder.
Aufrufe ohne freie `nodes` erhalten die freie Anordnung; ein ausgelassenes `root` erhält die
Kacheln. Ein angegebenes `root` ohne Modus wählt Kacheln, freie `nodes` ohne Modus wählen den
freien Canvas. Der globale Koordinator gibt Layoutwünsche im Run-Auftrag weiter; Run-Koordinator,
Werkzeuganleitung und Setup-Referenz erklären beide Modi und Beispielaufteilungen.

Im freien Canvas speichert das Werkzeug geschachtelte Layoutgruppen (`h`, `v`, `wrap-h`, `wrap-v`,
`grid`, `circle`, `tree`), Formen (`circle`, `diamond` mit Text) und Linien zwischen
Entitäten als Run-Zustand des Plugins ablegt. Entitäten sind Actors (`@handle`), Formen
(`shape:<id>`) und Canvas-Elemente (`app:<id>`). Das Werkzeug löst `app:@handle/view-key`
und `app:program-name/view-key` anhand aktivierter Actor-Programme zu den internen View-IDs auf,
auch für Linienendpunkte. Unbekannte oder mehrdeutige Ansichten sowie Ansichten gestoppter
Actors werden vor dem Speichern abgewiesen. Nach der Auflösung werden doppelte Platzierungen
und Selbstverbindungen erneut geprüft. Sichtbarkeit und Canvas verwenden dieselbe
Namensauflösung für Paket/View-Key und @handle/View-Key, im Canvas mit app:-Präfix.
Strukturierte Referenzen werden vor eindeutigen Titeln geprüft; Namen werden auf beiden
Wegen gleich normalisiert. Fehler nennen gültige Paket- und Actor-Bezüge. Der geteilte Vertrag
`plugins/ragents.orchestration/contract.ts` parst und prüft das Layout auf beiden Seiten; das Web
baut daraus eine Szene und legt sie mit einer deterministischen measure/arrange-Engine aus.
Eine Gruppe zeigt ihr `label` als Überschrift; einen gestrichelten Rahmen zeichnet sie nur mit
`frame: true`. Automatische Kanten gibt es nicht mehr; nicht platzierte, persönlich sichtbar
geschaltete Actors erscheinen unter der Überschrift "Nicht platziert" als Abstammungsbäume
unter dem Layout. Die persönliche Ansicht filtert die freie Darstellung, ohne das Layout zu ändern.
Bekannte Ansichten gestoppter Actors werden samt ihren Linien und leeren Gruppen aus der
Szene entfernt. Gespeicherte Layoutverweise erzeugen dann keine Fehlplatzhalter. Echte unbekannte
Referenzen und unerwartet fehlende Ansichten aktiver Actors bleiben Fehler; eine aktive Ansicht
mit derselben ID hat Vorrang.

Sichtbare beschriftete Verbindungen reservieren zusätzlichen Platz in der kleinsten gemeinsamen Gruppe
ihrer Endpunkte. Die tatsächliche SVG-Textgröße wird in Weltkoordinaten gemessen. Horizontale
Stapel berücksichtigen die Textbreite, vertikale die Texthöhe, jeweils zuzüglich 64 Pixel
Freiraum. Bäume berücksichtigen beide Achsen; Raster, Umbruch und Kreis verwenden konservativ
die größere Textabmessung. Die Gruppenabstände sind Mindestwerte und werden nicht verkleinert.
Andere Gruppen bleiben unverändert. Kürzere oder entfernte Labels geben den Zusatzplatz wieder
frei. Diese Abstandsregel ist kein Routing für kreuzende Linien oder überdeckte Drittelemente.

Automatisch ergänzte App-Gruppen bilden ein Raster mit höchstens drei Spalten und 44 Pixeln
Abstand; die Spaltenzahl ist die aufgerundete Quadratwurzel der sichtbaren App-Anzahl, begrenzt
auf drei. Verankerte Apps stehen als Gruppe 20 Pixel unter ihrem sichtbaren Actor, auch wenn ein
explizites Layout nur den Actor nennt. Ist die Actor-Karte persönlich ausgeblendet, bleibt die
App sichtbar und wird ohne diese Karte angeordnet. Explizit platzierte Apps behalten ihre Layoutgruppe und werden nicht
zusätzlich am Actor eingeordnet. Übrige sichtbare Apps werden automatisch ergänzt, auch wenn
noch keine Actors existieren. `visible: false` blendet ein bekanntes Canvas-Element aus; seine
expliziten Layoutreferenzen und Verbindungen werden dabei ohne Fehlhinweis ausgelassen. Beim
Wiederanzeigen erscheinen sie wieder. Dasselbe gilt für persönlich ausgeblendete Actor-Karten
und ihre Verbindungen. Tatsächlich unbekannte Referenzen bleiben Fehlhinweise.

Actor-Karten samt ihren Beiträgen, Canvas-Elemente und Linienlabels verwenden eine gemeinsame Größenmessung.
Ein `ResizeObserver` beobachtet ihre Größen; Änderungen werden pro Animationsframe
gesammelt und in unskalierten Weltkoordinaten vermessen. Erst geänderte Maße lösen eine neue
Anordnung aus. Dadurch folgen Nachbarn, Gruppenrahmen, Linien und Szenengrenzen auch asynchron
geladenen Inhalten, aufgeklappten Werkzeugkarten und nachgeladenen Schrift- oder Bildgrößen.
Für diese Änderungen brauchen die einzelnen Plugins keine eigenen Layout-Meldungen.
Ausgeblendete Elemente behalten ihre letzte gültige Messung; beim Entfernen oder Wechseln des
Runs werden Messungen und Beobachtungen freigegeben.

Canvas-Elemente erhalten die vom Beitrag beziehungsweise Größenanfasser angeforderte
Breite und Höhe. Mini-Apps und LLM-Karten verwenden dieselbe anfängliche Größe von 720 mal
520 CSS-Pixeln, unabhängig vom Profil. Mini-Apps übernehmen dafür auch bei abweichenden
Größenangaben in ihrer Platzierung die gemeinsame Vorgabe. Beide lassen sich im freien Canvas
bis auf 2880 mal 2700 CSS-Pixel vergrößern; die Obergrenzen stammen aus derselben Vorgabe.
Die Vollansicht steht weiterhin zur Verfügung. Das Layout verwendet ihre tatsächlich gemessene äußere Größe. Beim Ziehen
werden Nachbarn bereits während der Bewegung neu angeordnet; Bildschirmbewegungen werden mit
dem aktuellen Zoom in Weltmaße umgerechnet. Abbruch oder Captureverlust verwirft die gezogene
Größe. Ein Beitrag kann eine `collapsedHeight` festlegen und über `collapsed` und
`onCollapsedChange` im Element-Kontext zwischen normaler und eingeklappter Höhe wechseln.
Das Layout berücksichtigt die eingeklappte Höhe, die vorherige Größe bleibt gespeichert.
Der Größenanfasser entfällt im eingeklappten Zustand. Mini-App- und Actor-Köpfe teilen
Schriftgröße, Titelgewicht, Icon-Rahmen und Abstände; Mini-Apps tragen das Raster-Symbol
aus der Kopfzeile. Auch Kachelköpfe verwenden diese Darstellung mit ihrem jeweiligen Typsymbol.
Die Kopfzeilen sind gegenüber ihrer jeweiligen Kartenfarbe um vier Prozent Schwarz
abgedunkelt. Das gilt für Mini-Apps, LLM- und Script-Karten im freien Canvas und in Kacheln.
Im Mini-App-Kopf bleiben rechts
22 Pixel reserviert, damit Handle und Kopfknöpfe beim Auf- und Zuklappen ihre Position
behalten. Der App-Inhalt nutzt die volle innere Kartenbreite; sein Scrollbalken liegt direkt
am rechten Innenrand. Unter dem Inhalt bleiben 22 Pixel für den Größenanfasser frei.
Entfernte Elemente behalten keine lokale
Größenanpassung oder Einklappwahl für eine spätere Neuanlage.

Kameraausschnitt (Verschiebung und Zoom), manuelle Actor- und Canvas-Elementgrößen sowie
Kompakt- und Einklappwahl werden je Run im Local Storage des Browsers gespeichert und beim
erneuten Öffnen wiederhergestellt. Eine gespeicherte Kamera überspringt den initialen Fit.
Kamerabewegungen werden nach 150 Millisekunden Ruhe gespeichert; beim Verlassen der Seite
oder Wechseln des Runs wird eine ausstehende Speicherung sofort abgeschlossen. Der temporäre
Übersichts-Fit überschreibt den gespeicherten Ausschnitt nicht. Größen werden erst nach einem
erfolgreich abgeschlossenen Ziehen gespeichert. Diese persönlichen Einstellungen ändern das
journalisierte Layout nicht und werden nicht zwischen Browsern synchronisiert.

Die Ablaufansicht ist eine native React-Ansicht im Host-Dokument ohne Iframe: Kamera, Karten,
Linien und Eingaben liegen in EINEM Dokument. Unten liegt eine Statusleiste über die volle
Anwendungsbreite, 28 Pixel hoch und mit transparentem, verschwommenem
Hintergrund. Eine feine obere Trennlinie verwendet die Farbe `border`. Der obere Schatten läuft über
den unteren Rand des Arbeitsinhalts aus; Statusgruppen und geöffnetes Journal liegen darüber.
Die erste Gruppe enthält Zoomknöpfe, Zoomstufe und `Einpassen`; daneben öffnen `Journal`
und `Ansicht` ihre Flächen. `Actors` steht als Symbol in der Canvas-Leiste bei den Apps.
Der Listenknopf bleibt links stehen, während App-Einträge und direkte Actor-Knöpfe gemeinsam
horizontal scrollen. Die durchsuchbare Liste öffnet sich nach unten. Die Gruppen nutzen die
gesamte Leistenhöhe. Links beginnen die Bedienelemente mit 12 Pixel Abstand zum Fensterrand;
kurze senkrechte Trenner mit je 6 Pixel Abstand oben und unten grenzen die Gruppen ab. Gespräche
stehen in den Agentenkarten, den Actor-Pop-outs und im rechten Actor-Inspector. `Einpassen` zentriert die aktuellen
Szenengrenzen in der sichtbaren Fläche und setzt den Zoom immer auf 100 Prozent. Dasselbe gilt
für einen Doppelklick auf freie Canvas-Fläche; große Szenen müssen danach nicht vollständig
ins Fenster passen. Das Layout beginnt im Weltursprung. Es gibt genau eine Host-Kamera;
die Kamera beginnt mit 32 CSS-Pixeln Abstand links und oben. Der erste automatische Fit
passiert einmal, richtet die Szenengrenzen mit diesem Abstand links oben aus und wählt einen
zur Szene und sichtbaren Fläche passenden Zoom. Außerhalb der ausdrücklich aktivierten Canvas-Übersicht bewegt die
Oberfläche die Kamera danach nie von selbst. Dieser Fit
wartet auf die erste vollständige Messung und eine sichtbare Fläche. Manuelles Zoomen oder
Verschieben beendet die automatische Initialisierung ebenfalls. Eine ausdrückliche App-Auswahl
fokussiert das zugehörige sichtbare Element. Ohne Actors und sichtbare Apps zeigt die Fläche
ihren Leerzustand. Die Karten zeigen den `@handle` und keinen `displayName`.
Der Lauf-Stopp bleibt in der Werkzeugleiste des rechten Primary-Actor-Inspectors erreichbar,
mit Bestätigung und den bestehenden Schreibrechten.

Pfeiltasten zentrieren das räumlich nächste sichtbare Canvas-Element in Pfeilrichtung:
Actor, Mini-App oder Form. Der Zoom und die Auswahl im Inspector bleiben erhalten; das Ziel
führt keine Aktion aus. Die Bewegung dauert 300 Millisekunden und beschleunigt und bremst
weich. Gedrückthalten setzt die Navigation schrittweise fort, ohne Tastaturwiederholungen als
Warteschlange zu sammeln. Bei reduzierter Bewegung erfolgt der Wechsel sofort. Andere
Kameragesten übernehmen unmittelbar. Ein Klick auf freie Canvas-Fläche gibt ihr Tastaturfokus;
die Pfeiltasten funktionieren auch bei neutralem Seitenfokus. Eingabefelder, Controls,
Mini-Apps, scrollbare Karten und Dialoge behalten ihre eigene Tastaturbedienung. In der
Canvas-Übersicht werden Pfeiltasten für diese Kamerabewegung nicht abgefangen;
die Zielnavigation bleibt erhalten.

Bei aktivem Canvas steht zwischen der Übersichtsecke und dem globalen Koordinator ein gleich
breiter quadratischer Knopf für die Canvas-Übersicht. Er passt alle sichtbaren Actors, Formen
und Mini-Apps gemeinsam in die verfügbare Canvas-Fläche ein, auch bei sehr großen Szenen.
Der Knopf schließt die Run-Übersicht und den globalen Koordinator-Verlauf. Während der
Zielwahl folgt die Gesamtansicht geänderten Elementgrößen und der verfügbaren Fläche.
Ohne sichtbare Inhalte ist der Knopf deaktiviert.
Dieser Modus hebt das Ziel unter dem Mauszeiger oder mit Tastaturfokus hervor. Aktivieren
zentriert das Ziel bei genau 100 Prozent und beendet den Modus, ohne die Auswahl zu verändern
oder eine Karten- beziehungsweise App-Aktion auszuführen. Die sonstige Bedienung der
Canvas-Inhalte ist währenddessen gesperrt. Escape oder ein erneuter Klick auf den
Übersichtsknopf beendet den Modus und stellt den vorherigen Bildausschnitt samt Zoom wieder her.
Eine Zoom-Bedienung beendet den Modus ebenfalls und führt die angeforderte Kamerabewegung aus.
`Einpassen` in der Statusleiste behält seine oben beschriebene Zentrierung bei 100 Prozent.

Der Journalbeitrag der Orchestrierungs-Extension öffnet nach oben eine nichtmodale Fläche,
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
Die native Snippet-Ausführung bleibt auch ohne die optionale Orchestrierungs-Extension
Server-Grundausstattung; nur dieser Reiter entfällt ohne das Plugin.

Direkte Knöpfe in der Canvas-Leiste zeigen alle nichtmenschlichen, nicht gestoppten Actors
mit `@handle` sowie Anzeigename oder Actor-Art. Ein Klick öffnet den zugehörigen Actor-Inspector.
Der primäre Actor des Runs, normalerweise sein Koordinator, erscheint standardmäßig nur in
dieser Leiste. Sein Chat bleibt im Inspector erreichbar; eine eigene Canvas-Karte lässt sich
über die Actorliste ausdrücklich einblenden.

`Actors` öffnet in der Canvas-Leiste die Liste aller Actors des Runs, einschließlich des
menschlichen Owners und gestoppter Actors. Der Name eines nichtmenschlichen Actors öffnet den
bestehenden Actor-Inspector rechts; dadurch wird keine Canvas-Karte eingeblendet. Jeder nichtmenschliche Actor hat eine
individuelle Canvas-Sichtbarkeit. Der menschliche Owner bleibt über die Liste erreichbar und
benötigt keine eigene Canvas-Karte.
Jeder Listeneintrag ordnet Handle und Anzeigename nebeneinander an, darunter kompakt Typ,
Status und gegebenenfalls `Mini-App`. Die Canvas-Checkbox steht rechts. Lange Namen und
Metadaten umbrechen innerhalb des Eintrags, auch bei schmaler Liste.

`Ansicht` enthält `Actors mit Mini-App anzeigen`, `Verbindungen anzeigen` und
`Ansicht zurücksetzen`. Anfänglich sind Verbindungen sichtbar; der primäre Actor und Actors
mit eigener View sind ausgeblendet. Übrige Actors folgen der bisherigen Darstellung. Als eigene View zählt ein vom generischen
`canvasElements`-Beitrag geliefertes Element mit `anchorActorId`, auch wenn dieses Element
selbst ausgeblendet ist. Die Actor-Art spielt dabei keine Rolle. Eine ausdrücklich gesetzte
Sichtbarkeit gilt für den einzelnen Actor. Umschalten der Mini-App-Gruppenwahl ersetzt deren
Einzelentscheidungen. `Ansicht zurücksetzen` entfernt alle Einzelentscheidungen und stellt
beide Vorgaben wieder her.

Diese persönliche Ansicht liegt im `localStorage` je Serveradresse und Run. Sie braucht nur
Leserechte, verändert weder Actors noch Layout oder Journal und stoppt keine Arbeit. Die
journalisierte Sichtbarkeit einer Mini-App bleibt davon unabhängig. Ausgeblendete Actor-Karten
bleiben über Liste und Inspector erreichbar; ihre Verbindungen werden aus der Szene ausgelassen.

Mausrad und Trackpad bedienen entweder ein Control oder die Canvas-Kamera. Innerhalb von
Canvas-Elementen, Actor-Karten und interaktiven Controls übernimmt die Kamera keine Wheel-Events,
auch nicht bei kurzen Inhalten oder am Scrollrand. Dasselbe gilt für explizit mit
`data-canvas-scroll` markierte und horizontal oder vertikal scrollbar angelegte Bereiche.
Bereits per `preventDefault` behandelte Wheel-Events bleiben beim zuständigen Control.
Auf freier Fläche zoomt das Mausrad weiterhin die Canvas-Kamera.
Dieselbe Grenze gilt für Verschieben mit der mittleren Maustaste und Einpassen per Doppelklick:
Controls behalten ihre eigene Bedienung, die Kamera reagiert auf die freie Fläche.
Neue Nachrichten und andere Run-Aktualisierungen unterbrechen einen laufenden Ziehvorgang
nicht. Die Mausbindung bleibt bestehen und verwendet beim Loslassen die aktuelle Auswahlsteuerung.

Unter `Canvas-Zoom` in den Einstellungen lässt sich die Empfindlichkeit der Pinch-Geste
als Faktor von 0,1 bis 10 festlegen. Der Standard und das Ziel von `Zurücksetzen` sind 2;
Faktor 1 entspricht dem bisherigen Verhalten. Der Faktor gilt ausschließlich für Wheel-Events
mit gedrückter Strg-Taste, wie sie Trackpad-Pinch und Strg+Mausrad erzeugen. Normales Mausrad
und die Plus-/Minus-Knöpfe verwenden weiterhin ihre bisherige Empfindlichkeit. Die Einstellung
wird lokal im Browser gespeichert und wirkt sofort in allen Runs und geöffneten Tabs desselben
Ursprungs. Speichern und Zurücksetzen benötigen `settings.write`.

Agentenkarten verwenden unabhängig von der Handle-Länge eine Standardgröße von 720 mal
520 CSS-Pixeln. Die Mindesthöhe beträgt 260 Pixel, damit Verlauf und dauerhaft
sichtbare Eingabe Platz haben. Kleinere gespeicherte Höhen werden beim Anzeigen auf diese
Mindesthöhe begrenzt. Angehefteter Kartenchat und rechter Actor-Inspector verwenden denselben
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
Der Kartenkopf zeigt nur Rollensymbol, Actor-Name und rechts den Größenknopf.
Er besitzt acht Pixel Innenabstand oben und unten, zwölf Pixel seitlich und ein 32 Pixel großes
Symbolfeld. Symbolfeld und Größenknopf besitzen keine zusätzlichen seitlichen Margins;
sie fluchten mit den Inhaltsrändern des Verlaufs. Der Kartenchat verwendet einmal zwölf Pixel seitlichen Innenabstand; Verlauf,
Beiträge und Eingabe stapeln keine zusätzlichen Einrückungen.
Der Kartenchat zeigt keine Zeitstempel. Karte und Inspector verwenden den gewählten
Detailgrad für Agenten, von ausgeblendeten Schritten bis zu vollständig sichtbaren Details;
die Aufklappfreigabe bleibt wirksam. Standard ist `current` ("aktuell"), auch im Run-Chat
und bei direkter Verwendung von `ChatMessages`. Während eines laufenden Chats erscheint
höchstens der letzte Schritt als gemeinsamer Quassel-Chip: "Denken" oder der laufende
Werkzeugname, mit aufklappbaren Details bei entsprechender Freigabe. Eigene Werkzeugrenderer
werden in diesem Modus nicht verwendet. Ohne Aufklappfreigabe erscheinen nur "Denken" oder
"Werkzeug läuft", ohne Werkzeugnamen und ohne anklickbare Fläche.
Frühere Schritte bleiben ausgeblendet.
Eine folgende Nachricht, das Werkzeugergebnis oder das Laufende entfernt die Anzeige; normale
Nachrichten und Rückfragen bleiben sichtbar. Nachgeschobene eigene Eingaben hinter dem
laufenden Schritt entfernen den Chip nicht. Die gemeinsame Arbeitsanimation bleibt zusätzlich
sichtbar, solange der Agent läuft. Der Run-Chat des Hosts zeigt sie, solange irgendein Agent
oder Programm des Runs einen Turn ausführt und die Verbindung steht; Stoppknopf und
Platzhalter seiner Eingabe folgen demselben Signal. Karten und Inspector zeigen den Laufzustand
des jeweiligen Actors. Die bisherigen Detailgrade bleiben wählbar; gespeicherte Auswahlen und
explizite Produktvorgaben haben Vorrang. Der Detailgrad `grouped` ("gruppiert") fasst alle
aufeinanderfolgenden Denk- und Werkzeugschritte zwischen zwei anderen Nachrichten zu einer
zugeklappten Zeile "N Schritte" zusammen; solange der letzte Schritt läuft, nennt sie ihn und
pulsiert. Aufgeklappt stehen die Schritte darunter als einzeilige Zeilen wie in `compact`, jede
bei Aufklappfreigabe einzeln per Popover zu öffnen. Der Klappzustand lebt nur in der Ansicht. Der rechte Inspector zeigt weiterhin Zeitstempel.
Zugänge ohne `runs.inspect` erhalten bei freigegebener Schrittanzeige ausschließlich diesen
aktuellen, nicht aufklappbaren Status. Deaktivierte Schritte bleiben ausgeblendet.
Die Vorgabe aller Chats ist `grouped`; ein Produkt kann sie ohne Aufklappen oder Umschaltung verwenden.
Beide Ansichten verwenden dieselbe Linknavigation.
Der primäre Actor verwendet den vorhandenen Chatstream. Weitere Actors erhalten ihre eigene
Gesprächsprojektion aus dem Journal, mit zugestellten Eingaben, veröffentlichten Antworten,
Denkschritten und Werkzeugaufrufen samt Argumenten, Ergebnissen und Fehlern. Der Host lädt sie
über `/chat/:id/actors/history` bei Änderungen des Runs nach; die kompakte Run-Ansicht bleibt
ohne Werkzeug-Payloads. Ein Wechsel des primären Actors entfernt keine Schritte aus dem
Gespräch des bisherigen Actors. Ladefehler werden im Chat angezeigt. Die Karte schneidet die Nachrichtenliste nicht
auf eine feste Anzahl ab. LLM-Karten und Actor-Inspector teilen dieselbe Quassel-Eingabe
mit Anhängen und Detailgradwahl. Auf dem Canvas stehen Textfeld und Aktionen in einer Zeile;
`ChatInputToolbar` verwendet dafür `layout="inline"`. Die Textfläche bleibt eine Zeile hoch,
auch bei längerem Text oder Zeilenumbrüchen. Anhänge und Fehler bleiben separat sichtbar.
Im Inspector wächst die Eingabe weiterhin bis zu vier Zeilen. Sie sendet mit `runs.write` direkt an den jeweiligen Actor;
bei Lesezugriff oder gestopptem Actor ist sie deaktiviert. Modell- und Denktiefenauswahl
gehören nicht zu dieser Eingabe. Die Canvas-Karte verwendet `ChatPanel` für Verlauf und
überlagerte Eingabe; Fehlerbehandlung und Entwurfswiederherstellung stammen aus der gemeinsamen
`ChatInputToolbar`. Menschen und TypeScript-Actors erhalten keinen zusätzlichen Kartenchat.

Ein Actor-Eintrag in `canvas_layout_replace.nodes` kann mit `chatInput: false` seine
Chat-Eingabe auf dem Canvas ausblenden. Das gilt in freier und gekachelter Ansicht, auch
bei persönlicher Umordnung. Ohne Eingabe entsteht kein Composer-Bereich. Die Einstellung
ändert keine Berechtigungen und gilt nicht für den separaten Inspector. Mini-Apps, Formen
und Gruppen nehmen diese Eigenschaft nicht an.

Actor-Chats verwenden in beiden Canvas-Modi den gemeinsamen Composer-Abstand von `ChatPanel`:
24 Pixel seitlich und 14 Pixel unten. Material- und Kachelstyles setzen keine eigenen
Composer-Abstände. Die gemeinsame Breitenbegrenzung zentriert die Eingabe in breiten Chats;
der gemessene Composer reserviert im Verlauf auch seinen Außenabstand.

Der Verlauf ist direkt scrollbar und verwendet das Scrollverhalten von `ChatMessages`:
Am Ende folgt er neuen Nachrichten, beim Zurücklesen bleibt die gewählte Position erhalten.
Größenänderungen des Ausschnitts und seines Inhalts werden dabei berücksichtigt. Die Markierung
`data-canvas-scroll` schützt auch leere oder kurze Verläufe sowie deren Scrollränder vor
unbeabsichtigtem Canvas-Zoom. Der Leerzustand ist derselbe wie im Actor-Inspector.
Der innere Scrollbereich ist per Tastatur fokussierbar; PageUp und PageDown bewegen den
Verlauf innerhalb der Karte.
Der Verlauf ist keine Klickfläche; der Kartenkopf öffnet den Actor-Inspector mit Chat und
Details. TypeScript- und Benutzerkarten erhalten keine zusätzliche Chatvorschau.
Bei laufenden Agenten zeigt das Symbolfeld eine kompakte Arbeitsszene mit höchstens zwei
sichtbaren Zeichen. Im Verlauf erscheint die normale Arbeitsanzeige von `ChatMessages`, ohne
eigene Größen- oder Schriftvorgaben der Karte. Beide verwenden `WorkingScenes` und den
bestehenden Laufzustand, ohne weitere Datenkanäle. Auch ohne neue Stream-Ereignisse bleibt die
Arbeitsanzeige während eines laufenden Turns sichtbar. Sobald der Agent nicht mehr läuft, verschwinden beide
Anzeigen und sein Rollensymbol kehrt zurück; das gilt auch nach Fehler oder Stopp.
Bei aktivierter Systemeinstellung für reduzierte
Bewegung bleiben die Szenen statisch: sowohl Bildtakt als auch Szenenwechsel pausieren.

Agentenkarten und Mini-App-Elemente besitzen innerhalb der rechten unteren Ecke einen
Größenanfasser mit einem einzelnen Bogen in Schwarz mit 70 Prozent Deckkraft und einer
20 mal 20 Pixel großen Trefferfläche. Die Trefferfläche sitzt zwei Pixel vom rechten und
unteren Rand entfernt. Er liegt über der Eingabeleiste und bleibt dadurch mit der Maus greifbar.
Ein eigenes Symbol
im Kopf wechselt zwischen kompakter Darstellung und freier Größe direkt auf dem Canvas.
Die erste vergrößerte Ansicht verwendet je Achse das 1,5-Fache der eingestellten Standardgröße,
mindestens 400 mal 340 und höchstens 2880 mal 2700 CSS-Pixel. Bei der Vorgabe ergibt das
1080 mal 780 Pixel. Der Verlauf nutzt die zusätzliche Höhe; Karten mit zusätzlichen Slots
sind mindestens 260 Pixel hoch und halten diese Beiträge scrollbar.
Ziehen verwendet dieselbe Logik wie Canvas-Apps und rechnet den Zoom in Weltmaße um.
Eine selbst gewählte Größe bleibt beim Kompaktstellen und erneuten Vergrößern erhalten.
Beim Entfernen der Karte werden Größe und Darstellungswahl verworfen. Es entsteht kein
zusätzlicher modaler Dialog.

TypeScript-Actors erscheinen als 300 Pixel breite, gerade Schichtwerk-Karten mit 17 Pixeln
Eckradius. Die senfgelbe matte Fläche, der gestufte Tiefenkörper und die Kontur folgen den
Materialeinstellungen des Canvas; eine
kleine TS-Kennung unterscheidet sie von den LLM-Karten. Der Kopf enthält Handle und
Skript-Knopf, die Statuszeile den Laufzustand und die Anzahl zugestellter Eingaben. Bei laufenden Scripts animiert ein schmaler
Statusbalken; reduzierte Bewegung hält ihn statisch. Ausgewählte Karten erhalten einen
Umriss in der Akzentfarbe. Der Handle öffnet die Actor-Details.

Der Skript-Knopf öffnet den vorhandenen Actor-Quelltext im gemeinsamen, auf den Run begrenzten
Dialog. `SourceCode` hebt die TypeScript-Syntax hervor; der Inhalt ist schreibgeschützt und
scrollbar. Escape, Schließen und Hintergrundklick schließen die Ansicht und geben den Fokus
an den Skript-Knopf zurück; die globale Kopfzeile bleibt frei. Fehlt Quelltext in der Laufansicht, ist der Knopf mit erklärendem Hinweis deaktiviert.

Die Orchestration-Extension trägt die Einstellung "LLM-Karten" über
`ragents.orchestration.card-size` bei. Sie erlaubt eine Standardbreite von 240 bis 2880 und eine
Standardhöhe von 260 bis 2700 ganzen CSS-Pixeln sowie das Zurücksetzen auf die Vorgabe.
Bearbeiten verlangt `settings.write`. Die Speicherung erfolgt im lokalen Browser für denselben
Origin und gilt dort für alle Runs; sie ist keine serverweite Profilkonfiguration.
Standardkarten übernehmen Änderungen unmittelbar, auch in anderen Tabs desselben Origins.
Individuell gezogene Größen bleiben erhalten. Ungültige Werte werden ausdrücklich abgewiesen.

`ragents.actor-programs` trägt den Werkzeuge-Reiter, typisierte Werkzeugkarten und den App-Host
auf dem Canvas zu diesen Slots bei. Jede installierte App ist dort standardmäßig sichtbar;
fehlende Canvas-Platzierungen ergänzt der Server. Sichtbar geschaltete
Canvas-Apps erscheinen als volle Flächen in der Leiste oben am Canvas mit Artbeschriftung und bis zu
zweizeiligem Titel. Die Hauptfläche schließt eine offene Vollansicht und fokussiert das
gewählte Canvas-Element; der separate Vergrößern-Knopf schaltet die Vollansicht um. Die
vergrößerte App bleibt in der Canvas-Leiste sichtbar hervorgehoben. Der Titel verwendet dort immer
dasselbe Schriftgewicht 700; beim Umschalten der Vollansicht ändern sich Fläche und Unterkante,
aber nicht die Titelbreite oder die Position benachbarter Einträge. Es gibt keine rechten Mini-App-Reiter. Installierte Werkzeuge haben keine eigenen Einträge in der Canvas-Leiste;
sie bleiben über den Werkzeuge-Reiter erreichbar. Die Laufzeitsichtbarkeit lässt sich über
`actor_view_set_visibility` ändern; ausgeblendete Apps behalten Installation und Zustand.
Canvas-Mini-Apps besitzen eine helle Glasfläche, einen schmalen Rahmen mit Lichtkante,
gestufte Schatten und eine flache Titelzeile ohne Agenten-Icon. Ihr Eckradius beträgt 8 Pixel.
Sie sind skalierbar, auf die Titelzeile einklappbar und im Dialogbereich `canvas` über der
Arbeitsfläche vergrößerbar. Genau eine lokale Vollansicht ist offen; ihr Dialog zeigt den
Mini-App-Titel und Schließen-Knopf sowie Rand und Schatten über dem weichgezeichneten Canvas.
Titelleiste, Canvas-Leiste, Statusleiste und rechtes Panel bleiben bedienbar. In der Vollansicht entfällt eine normale Laufzeitstatuszeile.
Im Canvas stehen notwendige Host-Statusmeldungen unter dem App-Inhalt mit 18 Pixeln
seitlichem Innenabstand. Die einzeilige Statusfläche reserviert immer 28 Pixel Höhe,
in der Vollansicht 31 Pixel für Fehlermeldungen. Start, Abschluss und Fehler einer Aktion
ändern dadurch weder die Framegröße noch das Layout der Mini-App. Lange Details werden
gekürzt und bleiben als Hinweis am Text vollständig lesbar. Notwendige Fehler und
Bestätigungen bleiben sichtbar. Die Vollansicht wird nur im Host vom Benutzer bedient;
Mini-Apps haben keine eigene Dialogfähigkeit. Werkzeugformulare stehen weiterhin ohne eigene Fensterhülle direkt in den
Actor-Karten; deren äußere Karte bleibt erhalten.
Feldbeschriftungen, Eingaben, Aktionen und nötige Laufzeitmeldungen bleiben sichtbar.
Mini-App-Pakete liefern dafür ihren gebündelten Client, Aktionsverträge und Canvas-Metadaten. Sie registrieren
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
  eigener Komponente (`DialogContent`, `PopoverContent`) und die Materialkarten des Canvas
  bleiben, was sie sind; leichtere Innenflächen in einer Karte bleiben lokale Klassen.
- `SectionLabel` ist die kleine Gruppenbeschriftung in Versalien über einem Abschnitt;
  eine Anzahl daneben rutscht an das andere Ende. Beschriftungen, die eine Überschrift oder
  ein `dt` sind, bleiben ihr Element.
- Native `<select>`, eigene Schaltflächen und Klassen-Verträge gibt es nicht mehr; Plugins
  bringen kein eigenes CSS mit.

Tailwind gilt für die gesamte Oberfläche. Host, Plugins, Mini-App-Bausteine und die
mitgelieferten Mini-Apps schreiben ihre Gestaltung als Utility-Klassen direkt an die Elemente;
Stylesheets mit eigenen Klassenverträgen gibt es nicht mehr. `apps/web/src/ui/theme.css` ist
die einzige Token-Quelle: die shadcn-Variablen (`--background`, `--card`, `--primary`,
`--border`, `--radius` usw.) und die zusätzlichen Hostfarben `shell`, `app`, `canvas`,
`border-soft`, `border-strong`, `success`, `warning`, `info`, `teal`, `destructive-soft` und
die Materialfarben `glass-*` stehen dort einmal je Modus, hell und dunkel folgen `data-theme`;
dazu Schrift, die kompakte Abstandsskala mit `header`, `statusbar` und `workspace-inset`,
der Kartenradius `rounded-panel`, die Schatten `shadow-bar`, `shadow-status`, `shadow-pop`,
`shadow-card`, `shadow-workspace`, `shadow-glass-icon` und die Animationen `animate-fade-pulse`,
`animate-working-pulse`, `animate-ring-pulse`, `animate-edge-flow`, `animate-progress-sweep`.
`tailwind.css` ist der Host-Einstieg mit Preflight über `apps/web/src`, `plugins/*/web` und
`plugins/*/client-ui`; `frame.css` der Einstieg der Mini-App-Frames. Vite bindet Tailwind über
`@tailwindcss/vite` ein, der Mini-App-Compiler und die Homepage-Builds über `@tailwindcss/node`
(`server/tailwind.ts`), das die Host-Quellen, die Bausteine und die jeweiligen Mini-App-Quellen
scannt. Wiederkehrende Muster sind Komponenten, keine Klassen: Kopfzeilenzellen sind
`ToolbarItem`, `ToolbarCopy`, `ToolbarLabel` und `ToolbarText` aus `apps/web/src/Toolbar.tsx`,
Zähler `Badge`, Leerzustände `Empty`, Meldungen `Alert`, Flächen `Card`, Wartezeichen
`Spinner`. Kontextabhängige Darstellung läuft über `data-*`-Attribute am Rahmen und
`in-data-[...]`-Varianten in der Komponente, etwa `data-surface="material"` an den
Canvas-Karten für Chat und App-Kopf darin. Eigenes CSS bleibt nur für fremd erzeugtes Markup
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
die Zurück-Aktionen in mobilen `ListDetail`-Ansichten und im Flow-Inspector; der gemeinsame
`DialogContent` zeigt sonst das X von shadcn oben rechts. Zugängliche Namen und Tooltips
benennen weiterhin die jeweilige Aktion.

Mini-Apps verwenden dieselben Komponenten mit demselben Look; die Mini-App-Laufzeit setzt
`data-ui-surface="mini-app"` am Frame-Wurzelelement nur noch als Marker für Schrift und
Grundmaße. Details zu Formularen, Tabellen, Theme-Bridge und eigenem App-CSS stehen in run-modules.

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
- `canvas` umfasst nur die zentrale Arbeitsfläche; Kopfzeile, Statusleiste und rechtes Panel bleiben frei.

Der Host liefert Run-, Workspace- und Canvas-Fläche über `RunModalContext`,
`WorkspaceModalContext` beziehungsweise `CanvasModalContext` aus `apps/web/src/ui/dialog.tsx`;
das Portal des Dialogs landet in dieser Fläche. Nur der jeweilige Hintergrundbereich wird
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

`ragents.orchestration` mountet seinen Canvas serverseitig unter
`/plugin-assets/ragents.orchestration/canvas/` und trägt die Canvas-Komponente im Web-Slot bei.
Die Engine selbst stellt nur die generischen Laufzeitmethoden `ragents.runs.*` bereit. Der
Plugin-Mount bindet diese API ein, ohne dass der Server einen Orchestrierungs-Canvas kennen
muss.

Git-Änderungen fragen ihre Daten nur bei aktivem Tab ab. Der Ablauf besitzt im
eingebetteten Modus genau einen `RunStore` und ein Kanal-Abonnement. React verteilt dieselbe
`RunView` über einen versionierten Same-Origin-Bridge-Vertrag an Canvas und Inspector. Der Canvas
öffnet eingebettet keinen zweiten Stream mehr.

Die Chat-Bausteine bleiben unabhängig: RAgents und Plugins dürfen sie verwenden, sie selbst kennen
nur den Wire-Vertrag der ChatEvents und kein Produkt.
`ChatMessages` kann über `owner` einen Absender bestimmen, dessen Benutzer- und
Assistentennachrichten ohne Sprechblase erscheinen. Der Vergleich verwendet `sender`,
unabhängig von Rolle, Farbe und Beschriftung. Ohne Owner oder mit `null` bleiben die
Nachrichtenvorgaben wirksam. Dieser Darstellungs-Owner vergibt keine Rechte und ist unabhängig
vom menschlichen Owner eines Runs.
Mini-Apps erhalten daraus gebündelte, typisierte Controls unter `UI`. Die Mini-App-Extension
ergänzt Formulare, Tabellen, Dateiauswahl, Fortschritt sowie Dokument- und Diff-Ansichten und
besitzt auch das automatisch aus den Typverträgen gespeiste Nachschlagewerkzeug. Der Host
enthält dafür keine neuen Fachzweige. Der Chat kann einem Actor desselben Runs folgen oder
Verlauf und Sendeaktion von der Mini-App erhalten (siehe run-modules). Die Actor-Ansicht teilt die
Verlaufsprojektion des Inspectors und verwendet die vorhandene Run-Verbindung. Der Eingabebaustein
wartet auf die Sendeaktion und erhält den Entwurf bei Fehlern. Rückfragen ohne Antwort-Callback
werden als Text mit Optionen dargestellt.

Ein technischer Abbruch beendet das Warten auf `ask_user` und schließt die offene Frage im
Journal als `dismissed`. Die Ask-Extension liefert daraus keine Benutzerantwort und keinen
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

Bei laufender Arbeit und leerer Eingabe zeigt der Chat-Composer "Arbeit stoppen". Er stoppt
den angesprochenen Actor samt seiner beauftragten Kinder über die Actor-Stoproute; andere
Actors und Runs bleiben unberührt. Mit Text oder Anhängen bleibt die Sendeaktion verfügbar.
Fehler beim Stoppen erscheinen im betreffenden Chat und erlauben einen erneuten Versuch.

Alle Chat-Eingaben nehmen Anhänge über Dateiauswahl, Drag-and-drop und die Zwischenablage an:
Startfläche, laufender Chat, globaler Koordinator, Actor-Inspector und Mini-App-Controls.
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

Der Composer-Slot `toolbarLeft` ist nur für den Canvas-Eigentümer erreichbar; einen allgemeinen
Composer-Toolbar-Slot bietet der Host bewusst nicht an.

Ein Run ist im Web zuerst ein ENTWURF: "Neuer Run" in der Übersicht öffnet einen großen
seitenweiten Dialog mit dem zugänglichen Namen "Neue Unterhaltung". Der vorherige Run bleibt
darunter erhalten. Der Inhalt beginnt direkt mit der STARTFLÄCHE, ohne sichtbare Titelzeile
oder Untertitel. Ein überlagerter Schließen-Knopf sitzt rechts oben; die Startfläche hält dafür
Platz frei. Auf der Startfläche schließen Escape und Hintergrundklick ebenfalls. Der gemeinsame `Modal` übernimmt
Fokusführung und Fokusrückgabe. Die Startfläche (`apps/web/src/StartSurface.tsx`) besitzt keine
eigene Run-Statusleiste, keinen Canvas und keinen rechten Arbeitsbereich.
Ihr Modal liegt innerhalb der Session-, Startoptionen- und Plugin-Provider des Chat-Arbeitsbereichs,
damit auch Folgeschritte dieselben Kontexte erhalten.
Der Entwurf ersetzt den aktiven Run in der gemeinsamen Kopfzeile nicht; der seitenweite Dialog
überlagert diese mit dem übrigen Hintergrund.
Schließen verwirft den lokalen Entwurf, ohne einen Run anzulegen. Das Journal entsteht erst
beim ersten Einstieg.

Die freie Auftragseingabe steht zentriert über der Auswahl. Sie verwendet den originalen
Quassel-`ChatInputToolbar` mit drei sichtbaren Zeilen, wachsend bis acht Zeilen. Derselbe
Breitentoken wie im laufenden Chat begrenzt sie auf 880 Pixel. Die Auftragseingabe hat keine
zusätzliche Überschrift; die Bereiche behalten ihre zugänglichen Namen. Absenden startet den Run.
Modell und Denktiefe stehen als tastaturbedienbare `Select` in der Eingabeleiste neben
Anhängen und Detailgrad. Weitere Startoptionen der Plugins stehen darunter. Der Host zeigt
weiterhin nur wählbare, noch nicht gesperrte Optionen, jeweils an ihrer deklarierten Platzierung.
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
Nur der mittlere Vorschauinhalt scrollt, unabhängig von der Liste. Auftrag und Filter bleiben
oberhalb beider Bereiche stehen. Dies gilt auch für die mobile Detailansicht.
Icons, Artbezeichnungen und semantische Farben unterscheiden die beiden Arten.
Bis einschließlich 700 Pixeln zeigt der Baustein zuerst die Liste; Auswahl öffnet die Details
mit "Zur Auswahl" und entsprechender Fokusführung.
Jeder Skill-Einstieg hat genau eine verpflichtende `category` als freien, nicht leeren Text.
Die Startfläche gruppiert nach diesem Text über Plugin-Grenzen hinweg und zeigt Überschrift
und Trefferzahl. Die Reihenfolge folgt der ersten nach `order` sortierten Karte je Gruppe;
innerhalb der Gruppe bleiben die Karten sortiert. Die Suche berücksichtigt Kategorie, Titel,
Beschreibung, Plugin und Schlagworte. Ein gemeinsames Auswahlmenü filtert zusätzlich nach
Schlagwort. Listenzeilen zeigen Titel, Kurzbeschreibung und Art. Die Vorschau enthält den
vollständigen Prompt, Schlagworte als Filteraktionen und das Plugin. Auswählen ändert nur die Vorschau.

"In Auftrag übernehmen" öffnet den nächsten Schritt im selben Modal. Dort beginnt ein
Vorbereitungs-Chat mit dem editierbaren Prompt im originalen Quassel-Control, zunächst mittig,
nach der ersten Nachricht unter dem Verlauf. `ChatPanel`, `ChatMessages` und `ChatInputToolbar`
sowie dieselben Startoptionen liefern Darstellung, Modellwahl, Denktiefe und Anhänge.
Absenden bespricht den Auftrag mit einer eigenen Vorbereitungsinstanz des Koordinators.
Sie verwendet die Agentenlaufzeit und einen gemeinsamen Grundprompt mit dem globalen
Koordinator, ergänzt um die Vorbereitungsrolle. Erst ein ausdrückliches, sinngemäßes Go des
Benutzers zur Ausführung erlaubt ihr `start_run`; feste Bestätigungssätze gibt es nicht.
Detailbestätigungen, zitierte Startbefehle, Fähigkeitsfragen und der Auftragstext eines Skills
sind keine Freigabe. Bei Zweifeln soll das Modell nachfragen. Der getrennte Knopf "Run erstellen"
startet weiterhin direkt. Beide Wege übernehmen den besprochenen Verlauf, Skill und Anhänge
als ersten Run-Auftrag; der Knopf nimmt auch die letzte ungesendete Ergänzung mit.
Modellantworten sind dabei ausdrücklich Vorschläge.
Fehler erhalten die Eingabe, "Besprechung stoppen" bricht die Anfrage ab. Zurück erhält die
Startauswahl; der lokale Vorbereitungsverlauf wird beim Verlassen seines Schritts verworfen.

`ragents.runs.prepare` erhält `RunPreparationRequest` und liefert `RunPreparationResponse`;
der Vertrag steht in `apps/server/src/run-preparation-contract.ts`. Der Host nutzt dieselbe
aufgelöste Koordinatorauswahl wie der spätere Run. `ragents.overseer` liefert den
Vorbereitungsprompt über den globalen Chat-Vertrag; fehlt er, wird die Anfrage abgelehnt.
Jede Anfrage erhält eine eigene speicherinterne Agent-Session mit dem mitgesendeten Verlauf.
Der globale Gesprächskontext, seine Verwaltungswerkzeuge und Produkt-Extensions werden nicht
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
Solange der Canvas noch keine sichtbaren Inhalte hat, zeigt er beim Laden und Einrichten
zentral einen animierten Ladebalken mit dem aktuellen Vorbereitungsschritt. Das gilt für
freie Fläche und Kacheln, auch bei ausgeblendeten Steueractors. Die Anzeige bleibt außerhalb
der Zoom- und Verschiebefläche und berücksichtigt ein geöffnetes rechtes Panel. Nach der
Vorbereitung folgen wartende Inputs und aktive Turns dem tatsächlichen Run-Zustand;
Rückfragen, Fehler und gestoppte Runs ersetzen den Balken durch einen passenden Hinweis.
Sichtbare Inhalte lösen die zentrale Anzeige ab. Die Anzeige erfindet keine Prozentwerte.
Häufige Live-Ereignisse verwerfen keine noch laufende Run-Abfrage: die erste Antwort wird
übernommen, weitere Aktualisierungen werden zu einer anschließenden Abfrage zusammengefasst.
Dadurch bleibt der Startdialog auch bei langsamen Antworten nicht hängen. Bereits geschlossene
Startdialoge ignorieren verspätete Sendeantworten, sodass diese keinen neu geöffneten Entwurf
schließen können.

Die gemeinsame Kopfzeile enthält links die Übersichtsecke, bei aktivem Canvas den Knopf für
die Canvas-Übersicht und den globalen Koordinator, danach
Titel und Metadaten des aktiven Runs, seine Startoptionen, Laufstatus, Fehler und Aufmerksamkeitshinweise. Die Pluginbeiträge
ergänzen sichtbare Canvas-Apps, Aktivität und Prozesse. Jeder Haupteintrag nutzt die gemeinsame
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
Session-Provider sowie den `RunModalContext`. Eine zusätzliche Titel- oder Platzhalterleiste
über der Run-Fläche gibt es nicht.

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
verborgen gemountet. Ihr Öffnungszustand wird nicht gespeichert; sie verändert das Canvas-Layout
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

Nach dem Speichern eines fertigen Titels meldet der Kanal `sessions` die Änderung an den
Browser. Die Liste wird dadurch ohne Warten auf den periodischen Abruf aktualisiert. Der
Fünf-Sekunden-Abruf bleibt für weitere Metadaten erhalten. Die eigentliche Modellantwort hat
keine garantierte Sofortlaufzeit. Titel aus `run_configure` oder einem vorbereiteten Setup
haben weiterhin Vorrang; gespeicherte automatische Titel bleiben bei Modellwechsel erhalten.

"Neuer Run" ist die einzige Hauptaktion der Run-Leiste: die erste Karte der Liste (bei null
Runs die einzige), wie in der Arbeitsspalte, und wechselt in den Startdialog. Einzel- und Mehrfachlöschen mit Alle/Keine, Bestätigung und
sichtbaren Fehlern bleiben erhalten; die Profilrechte bestimmen, ob Öffnen, Erstellen oder
Löschen angeboten werden. Ohne Run-Leserecht und ohne sichtbaren Beitrag gibt es keine Ecke.
Die globale Kopfzeile bleibt in einer Leiste. Bei Platzmangel scrollt ihr mittlerer Run-Bereich horizontal; er ist für die
Tastatur fokussierbar. Lange Namen bleiben auf zwei Zeilen begrenzt. Übersichtsecke sowie
Einstellungen und Hilfe bleiben außerhalb dieses Scrollbereichs erreichbar.

Links stehen die Übersichtsecke, bei aktivem Canvas dessen Übersichtsknopf und die unabhängigen
Toolbar-Beiträge. Der flexible Bereich
daneben zeigt die Angaben zum aktuellen Run; rechts stehen die Arbeitsbereichsreiter und ihr
Ein-/Ausklappknopf sowie das Zahnrad-Symbol für Einstellungen und daneben ein Fragezeichen
für die Hilfe. Beide Dialogknöpfe haben zugängliche Beschriftungen. Die Hilfe öffnet die mitgelieferte
Homepage unter `/help/index.html` in einem großen seitenweiten modalen Dialog per Iframe.
Die Seite füllt den Dialog ohne zusätzliche Titelzeile und Innenabstand. Ein überlagerter
Schließen-Button bleibt oben rechts sichtbar; der Dialogname ist für Screenreader hinterlegt.
Die eingebetteten Seiten reservieren in ihrer Kopfzeile rechts Platz für diesen Button,
ohne den eigenständigen Export zu verändern.
Die Unterhaltung bleibt im Hintergrund erhalten und ist währenddessen nicht bedienbar.
Schließen, Escape (auch innerhalb der Hilfe) oder ein Klick auf den Hintergrund schließen den
Dialog und stellen den Fokus am Hilfeknopf wieder her. Interne Seitenlinks bleiben im Dialog;
externe Quelllinks öffnen einen neuen Tab. Der Tastaturfokus bleibt im Dialog.
Die Hilfe und die statisch geöffnete Dokumentation verwenden kontrastreiche native Scrollbalken.
Der Iframe passt seine Höhe an den verfügbaren Dialogplatz an; die Seite scrollt innerhalb des Frames.

"Sample starten" erscheint in der eingebauten Hilfe nur für Run-Scripts des geladenen Profils
und mit Lese- und Schreibrecht für Runs. Der Host prüft Ursprung, sendenden Hilfeframe und
Einstiegkennung. Auch die Sample-Links unter den Homepage-Vorschauen starten in der Hilfe
den zugehörigen Run statt zur Referenz zu navigieren. Außerhalb der Anwendung bleiben sie
Links zur Sample-Beschreibung. Ein Klick öffnet die vorhandene Run-Erstellung mit dem gewählten Sample:
ein benötigter Leitfaden erscheint direkt, ein Sample ohne Leitfaden wird sofort aufgebaut.
Fehler bleiben in der Run-Erstellung sichtbar. Auf der eigenständigen Homepage bleiben
Vorschau, Quellen und Startanleitung verfügbar; sie legt keinen Run an.
Der Server liefert unter `/help/` ausschließlich die statische Hilfe aus. Fehlende Hilfedateien
liefern 404, Textreferenzen einen lesbaren Textinhalt. `/help` leitet auf `/help/` um, damit
relative Seitenlinks korrekt auflösen.

`ragents.overseer` liefert den globalen Koordinator als dauerhaften Toolbar-Beitrag rechts
neben den Übersichtsknöpfen. Die Eingabe zeigt "Globaler Koordinator" als Platzhalter; eine
separate Überschrift und ein eigener Dropdown-Pfeil entfallen. Eingabe und Status stehen in
einer Zeile; die Eingabe bleibt einzeilig und scrollt bei mehr Text, die Kopfzeile behält
ihre feste Höhe von 45 Pixeln. Der Beitrag ist bis zu 570 Pixel breit. Fokus in das Textfeld
öffnet den Verlauf als nichtmodales Dropdown unter der Kopfzeile. Die Eingabe bleibt oben; im
Verlauf gibt es keinen zweiten Composer. Anhang, Detailgrad, Modell, Reasoning und Zurücksetzen
stehen in einer gemeinsamen Bedienzeile. Bei schmaler Ansicht werden Detailgrad und Reasoning
kompakt dargestellt; der Modellname wird bei Bedarf gekürzt. Der Beitrag besitzt eine Unterhaltung, einen Entwurf
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
Canvas-Agenten. Der Zustand beginnt bereits während der Sendeanfrage und folgt danach dem
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
ergänzt Run-Titel, kurze Laufreferenz und Actor-Namen. So kann eine Frage wie "Was macht dieser
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
aber die Unterhaltung. Die Dropdownhöhe berücksichtigt den sichtbaren Viewport; schmal nutzt
es die Arbeitsflächenbreite. Die Eingabe bleibt oben erreichbar, ebenso Übersicht, Einstellungen
und Hilfe.

Der globale Chat zeigt standardmäßig nur den aktuellen Denk- oder Werkzeugschritt (`current`). Sein
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

Modell und Reasoning-Tiefe des übergeordneten Koordinators lassen sich im Dropdown oberhalb des
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
Darstellung enthält Theme, LLM-Karten, Canvas-Zoom und Arbeitsspalte.
Diese beiden Bereiche laden unabhängig vom technischen Beitragskatalog. Ein Fehler des
Katalogabrufs blockiert deshalb nicht die vorhandenen Einstellungsformulare.

Erweiterungen enthält das technische Beitragsinventar. "Nach Extension" zeigt links die
Plugin-Kennungen und rechts deren Details. "Nach Fähigkeit" zeigt Werkzeuge, Prompts,
Einstiege, Skills, Erweiterungen, Konfiguration und Web über ihre Eigentümer hinweg. Beide
Ansichten verwenden dieselben Detailkomponenten einschließlich Skill-Dateien. Laufzeit zeigt
technische Übersichtsfakten, konfigurierte Modelle, Profile und Systemprompt. Diese Kataloge
sind Leseansichten; neue Modellvorgaben werden im Bereich Modelle bearbeitet.
Skill-Einstiege zeigen ihren einzelnen Prompt mit einer Kopieraktion.

Die Einstellungsantwort enthält bei Werkzeugen optional die benötigten Ausführungsrechte
als `requiredCapabilities`. Die Browserprüfung akzeptiert dieses Feld als Liste von Namen;
Werkzeuge ohne diese Angabe bleiben gültig. Unbekannte Werkzeugfelder, fehlende Pflichtfelder
und ungültige Feldtypen werden weiterhin abgelehnt.

Die Suche wirkt in beiden Ansichten auf die Beiträge und ihre Zähler; Fähigkeiten ohne Treffer
zeigen einen Leerzustand. Die Extension-Ansicht behält zusätzlich den Filter nach Beitragsart.
Beim Achsenwechsel bleiben Suchtext und die letzte Auswahl je Achse erhalten. Der direkte Link
zu einer Extension öffnet deren vollständiges Inventar ohne Such- oder Beitragsfilter. Bei
schmalen Fenstern stehen die Navigationspunkte in einer Zeile, die seitlich gescrollt werden kann.

Die Arbeitsspalte ist der zweite Einstieg der Web-App: `column.html` (`apps/web/src/column.tsx`)
lädt denselben Plugin-Host wie `index.html` und zeigt einen Run als schmale Spalte, die in einem
Browserfenster ab 400 Pixeln Breite und im iframe eines fremden Hosts vollständig bedienbar ist.
`?run=<id>` wählt den Run; ohne `run` zeigt die Spalte die Run-Liste, in der "Neuer Run" die
erste Karte ist und dieselbe Startauswahl öffnet; mit Run klappt der Chevron links in der
Kopfzeile dieselbe Liste als Überlagerung über den Run auf (Escape, der Chevron oder eine Wahl
schließen sie); `?layout=app&run=<id>&element=<id>` zeigt genau ein Canvas-Element in
voller Größe. `PluginChat` erhält dafür ein `layout`: `workspace` (Canvas und Werkstatt),
`column` und `{ element }`. In der Spalte bleiben die Sitzungs-Provider, die Kopfzeilenbeiträge
(als Portal in die Titelleiste der Spalte) und der Chat; Canvas-Leiste und Werkstatt-Reiter
entfallen. Der Canvas-Beitrag (`WebPlugin.canvas`) kann neben `Center` ein `Column` liefern, das
denselben `CanvasCenterContext` erhält; ohne `Column` zeigt die Spalte nur den Chat.
Die Kopfzeile der Spalte ist eine Zeile (`ColumnRunHeader`): Titel, ein pulsierender Punkt
während der Bearbeitung, das Aufmerksamkeitsabzeichen und ein Chevron; ein Klick auf den Titel
öffnet die Kopfzeilenbeiträge der Plugins, die Sitzungs-Metadaten und die Startoptionen als
Popover. Die Pop-outs der Spalte (Run-Details, Menü, Adressat) dunkeln wie das Sheet den Rest ab
(`dim` am Popover-Baustein), damit sie sich absetzen. Rechts außen steht ein Menü (`ColumnMenu`) mit Einstellungen (derselbe Dialog wie in
der Web-App), im Host `vscode` "Im Browser öffnen" und bei angemeldetem Benutzer "Abmelden"; auch
die Run-Liste ohne Run trägt es. `ragents.orchestration` liefert die Spalte (`web/column/`): Mini-Apps sind die
Canvas-Elemente mit `visible !== false`; genau eine bekommt die Bühne ohne Chipzeile und ohne
Überschrift, erst ab zwei erscheint eine Chip-Reihe darüber (ein `!` bei offener Host-Bestätigung
oder Rückfrage des besitzenden Actors). Die Bühne zeigt die gewählte App mit
`presentation: "tiled"`; ihr Knopf für die Mitte oder die Vollansicht erscheint erst beim Zeigen
oder Fokus rechts oben. Der Chat des gewählten Actors liegt in einem von vier Layouts: ohne
Mini-App füllt er die Spalte; unterhalb der eingestellten Breite (Vorgabe 900 Pixel) liegt er
immer unten als Sheet; darüber schaltet der Knopf in der Kopfzeile links neben dem Menü zwischen rechts
neben der Bühne (Vorgabe, ein senkrechter Griff bestimmt die Chatbreite) und unten um. Das Sheet
liegt am unteren Rand (seitlich frei, oben abgerundet, ein Griff
darüber), das zugeschoben ohne Rahmen nur Griff, eine Statuszeile und die Eingabe zeigt (die
Statuszeile nennt eine offene Rückfrage, sonst was der Adressat gerade tut, sonst die letzte
gesprochene Zeile mit Absender) und bei Maus darüber (nach der eingestellten
Verzögerung, Vorgabe 160 Millisekunden), Fokus in der Eingabe oder Klick auf den Griff auf 90
Prozent der Fläche über die abgedunkelte Bühne gleitet; verlässt die Maus das Sheet, gleitet es
nach der zweiten Verzögerung (Vorgabe 450 Millisekunden) zurück, Escape, ein Klick auf die Bühne
oder den Griff sofort, ein offenes Pop-out oder der Fokus in der Eingabe halten es oben. Breite
und beide Verzögerungen stehen unter Einstellungen, Darstellung, Arbeitsspalte und liegen im
Browser-Speicher (`ragents.orchestration.column-settings`). Der Koordinator
zeigt den Hauptchat (`renderChat`), ein anderer Actor seinen Verlauf mit den Kartenabschnitten der
Plugins und eigenem Composer. Der Adressat steht als Chip in der Eingabeleiste; sein Pop-out listet
die Actors nach der Actor-Anzeige des Canvas (`actorVisibleInHeader`, Vorgabe `Sichtbare`, also
auf dem Canvas sichtbar; Koordinator und gewählter Actor bleiben immer dabei), die ausgeblendeten
hinter ihrer Zahl mit Suche und die Anzeigewahl im Fuß. Daneben nennt die Leiste den ersten
arbeitenden anderen Actor mit Spinner und wartenden Eingaben. Gewählte App, Bühnenhöhe, gewählter
Actor, Chat-Lage (`side` oder `bottom`) und Chatbreite liegen je Run im Browser-Speicher
(`ragents.orchestration.column:<runId>`); ein gespeicherter Zustand ohne Chat-Lage gilt als
`side`, ohne Chatbreite als 380 Pixel, die früheren Werte `auto`, `floating`, `docked` und eine
Bühnenhöhe werden abgebildet beziehungsweise übergangen.

Die Spalte spricht über `apps/web/src/column/host.ts` mit ihrem Host. Der Host `browser`
(Standard) öffnet Links selbst und kennt keine Mitte; der Host `vscode` (`?host=vscode`, nur
eingebettet) sendet `ready`, `runChanged`, `openInCenter`, `returnToColumn`, `login`, `logout`,
`openExternal` und `openPage` per `postMessage` an das umgebende Fenster und nimmt von dort `selectRun`, `newRun`,
`placements` (welche Elemente eines Runs in der Mitte liegen) und `theme` entgegen; der
importfreie Vertrag steht in `column/host-contract.ts`. `?theme=light|dark` setzt die Darstellung
beim Laden. Läuft die Seite ohne Anmeldecookie, trägt sie den Zugangstoken aus `?access=`:
`apps/web/src/access-token.ts` hängt ihn als `Authorization: Bearer` an jeden Abruf an den
eigenen Server und als Abfrageparameter an Adressen ohne Header (Mini-App-Frames).
Ein Host, der Webseiten zeigen kann, stellt sich der Oberfläche als `PageOpener`
(`apps/web/src/page-opener.tsx`) bereit: Fachplugins mit einer Anwendungsvorschau fragen ihn
zuerst und öffnen eine laufende Anwendung dann dort statt im eigenen Dialog mit iframe; in VS Code ist das ein Reiter des Simple Browser
(`openPage`), im Browser gibt es keinen Host und der Dialog bleibt. Verlangt der Server dann eine Anmeldung, zeigt die Spalte im Host `vscode` statt des Formulars
die Bitte an den Host (`AccessGate` mit eigenem `Login`). Die Mini-App-Frames erlauben als
Vorfahren neben der eigenen Herkunft die Webviews von VS Code (`https://*.vscode-cdn.net`,
`vscode-file:`, `vscode-webview:`).

Die VS-Code-Erweiterung unter `apps/vscode` ist ein solcher Host: ein nativer Explorer der Runs
(Zustand, Rückfragen, Actors, Mini-Apps, Artefakte und Journal aus derselben Laufansicht, gelesen
mit `runViewFrom` und `actorProgramViews` aus den Plugin-Webhälften), die Spalte als Webview (ohne erreichbaren Server ein Hinweis mit Adresse und Fehler statt des iframes) mit
iframe in der zweiten Seitenleiste und je Mini-App ein Editor-Reiter mit `layout=app`. Sie
spricht dieselbe Nachrichtenschicht mit demselben Client (`RpcClient` mit eigenem `fetch` und
Bearer), hält einen Ereignisstrom je Fenster und meldet sich mit `POST /api/access/login` selbst
an; Betrieb und Grenzen stehen in `docs/operations.md`.

## Arbeitsbereich, Sandbox-Werkzeuge und Prozesse

Die Workspace-Plugins geben Agenten genau vier
Sandbox-Werkzeuge aus `plugin-support`: `read` (Zeilennummern, Kürzung, SHA-256 des Inhalts),
`edit` (eindeutiger Treffer; bei mehrdeutigem `oldText` nennt es die Fundstellen mit
Zeilennummern, optionale Anker `occurrence`, `nearLine` und `replaceAll`; `expectedHash` aus dem
letzten `read` verhindert, dass etwas überschrieben wird, was seit dem Lesen entstanden ist),
`write` und `bash`. `ls`, `grep`, `find` oder ein eigener Typecheck sind keine Werkzeuge, weil
`bash` sie kann und die Sandbox keine Berechtigungsstufe unterhalb von Bash kennt. `git` läuft
ohne Einschränkung im Session-Arbeitsverzeichnis; Zugangsdaten liefert ein Plugin über die
Git-Umgebung der Sandbox (`SessionWorkspace.gitConfig`), zusätzliche Umgebungsvariablen über
`contributeSandboxEnv`.

Dieser Vertrag ist die einzige Naht zum Arbeitsverzeichnis: `WorkspaceRuntime` löst je Run den
Ordner auf, `SandboxServices` führt darin aus. Die vier Werkzeuge, die Language Server und die
Prozessanzeige gehen über `processContextFor` und die registrierten Wurzeln, `git` läuft in
`bash`. Ein Plugin startet keine eigenen Prozesse gegen den Ordner und rechnet keine Pfade
daran vorbei aus. Wer den Vertrag erfüllt, entscheidet damit für alle Plugins zugleich, wo der
Ordner liegt und wer darin ausführt. `ragents.workspace` ist die Erfüllung in core; der
optionale `WorkspaceResolver` (Abschnitt Self-contained Plugin-Ordner und Ownership) ist der
Haken, über den ein weiteres Plugin den Inhalt eines frischen Ordners liefert. In core nutzt ihn
kein Plugin.

Wo der Ordner liegt, entscheidet die Bindung je Run: die Startoption `ragents.workspace.binding`
von `ragents.workspace` mit dem Wert `{ kind: "fresh" }`, `{ kind: "path", path }` oder
`{ kind: "client", client, label, path }` (`plugins/ragents.workspace/contract.ts`). Die Vorgabe
ist `fresh`, der leere Ordner unter der Session-Ablage. `path` ist ein absoluter, beim Wählen
vorhandener Ordner auf dem Serverrechner; der Run arbeitet direkt darin, und weder Stopp noch
Löschen des Runs fassen ihn an. `client` ist der Ordner eines verbundenen Arbeitsplatzes; `accept`
verlangt, dass der Client verbunden ist und den Ordner anbietet, und schreibt sein Label in den
Wert, damit der Run ihn auch ohne Registry benennen kann. Die Auflösung scheitert nie an einem
fehlenden Client oder Ordner, weil der Server beim Start alle Arbeitsbereiche auflöst; erst der
einzelne Werkzeugaufruf meldet `workspace-client-disconnected` (409) beziehungsweise
`workspace-path-missing`. Der Prompt des Plugins sagt dem Agenten, dass ein Projektordner das
echte Projekt des Benutzers ist; welche Bindung gilt, steht als Systemnotiz zu Beginn des Runs.
Dieselbe Bindung liefert das Plugin als Session-Metadatum `ragents.workspace` (`binding`,
`summary`) für Run-Liste, Kopfzeile und den Explorer der VS-Code-Erweiterung.

Ein Arbeitsplatz ist ein Client, der dem Server sein Dateisystem anbietet. Er meldet sich mit
einer stabilen Kennung über `ragents.workspace.clients.register` an (Label, Hostname,
Plattform, angebotene Ordner); die Verbindung dieser Anfrage wird sein Rückweg und braucht
deshalb einen Ereignisstrom. `ragents.workspace.clients.unregister` meldet ab,
`ragents.workspace.clients.list` zeigt den Stand. Die Registry lebt im Speicher des Servers; nach
einem Neustart meldet sich jeder Client neu an, gebundene Runs bleiben gültig. Ein Client gehört
dem Benutzer, der ihn angemeldet hat; Anmeldung und Abmeldung verlangen dieselbe
Identität. `sameMachine` sagt dem Client, dass der Server auf demselben Rechner läuft und seine
Ordner sieht; die VS-Code-Erweiterung wählt dann `path` statt `client`, damit Language Server
und Prozessanzeige weiter funktionieren. Bei `client` erhält `SessionWorkspace.remote` die
Operationen des Clients: `read`, `write` und `edit` schicken `readFile`, `writeFile`, `access`
und `mkdir` für Pfade im gebundenen Ordner an den Client, Pfade in Serverwurzeln (Dateiablage,
`@actors`) bleiben auf dem Server; `bash` läuft immer auf dem Arbeitsplatz mit dessen eigener
Umgebung plus Run-Marker, `CI`, Git-Regeln und `extraEnv`. Die Operationen sind die Verträge
`ragents.workspace.client.readFile`, `writeFile`, `access`, `mkdir` und `exec` mit
`implementedBy: "client"`; der Server ruft sie über die Verbindung der Anmeldung, Bash-Ausgabe
kommt als Fortschritt `{ base64 }`. Der Server wartet je Aufruf begrenzt (120 Sekunden, bei
`bash` Zeitgrenze plus 30 Sekunden), ein Abbruch schickt `rpc.cancel`, ein Verbindungsverlust
lässt offene Aufrufe mit Ursache scheitern.
`processContextFor` trägt bei einem entfernten Arbeitsbereich `remote` mit dem Label; die
Language-Server-Plugins lehnen den Start damit ab, statt einen Prozess gegen einen fremden Pfad
zu starten.

Ein Bash-Ergebnis ist die Ausgabe des Befehls; ein Exit-Code ungleich null steht als letzte
Zeile im Ergebnis (`Command exited with code N`) und ist kein Werkzeugfehler, etwa `grep` ohne
Treffer. Werkzeugfehler sind nur Start-, Zeitgrenzen- und Abbruchprobleme. Beide Workspace-Plugins
liefern dazu einen an `bash` gebundenen Promptbeitrag, der die Plattform der Shell aus
`process.platform` ableitet (`plugin-support/shell-platform.ts`): macOS mit BSD-Werkzeugen
(`grep` ohne `-P`, `sed -i ''`), Linux mit GNU-Werkzeugen; eine unbekannte Plattform ist ein
Startfehler, kein Ratetext. Die Sandbox leitet `HOME` je Run um, damit Werkzeuge nur dort
schreiben; die Toolchain des Servers bleibt trotzdem erreichbar: `PATH` kommt aus der
Serverumgebung, und ein Plugin für die Build-Umgebung reicht seine Pfade über
`contributeSandboxEnv` an jede Bash weiter, sodass Werkzeugketten dieselben Installationen
finden wie die übrigen Dienste. Fehlt eine vorausgesetzte Werkzeugkette, scheitert bereits die
Anlage der Sitzung mit dieser Ursache.

Nach einem Bash-Aufruf wartet der Host auf das Ende seiner Prozessgruppe. Unter macOS kann
eine bereits beendete Gruppe mit verbliebenen Zombie-Einträgen bei der Signalprüfung `EPERM`
melden. In diesem Fall prüft der Host ausschließlich Prozessgruppen-ID und Prozessstatus;
nur eine nachweislich leere oder vollständig beendete Gruppe gilt als aufgeräumt. Lebende
Prozesse, eine fehlgeschlagene Statusabfrage und unlesbare Ergebnisse bleiben Fehler. Ein
solcher beendeter Rest verwirft damit weder Ausgabe noch Exitstatus des eigentlichen Befehls.

Jeder Sandbox-Prozess (Bash-Kinder, Sprachserver, alles über `processContextFor`) trägt den
Marker `RAGENTS_RUN_ID=<runId>` in seiner Umgebung. Von einem Plugin gestartete Dienste tragen
denselben Marker und erscheinen automatisch. `ragents.processes` liest darüber die
Prozesstabelle je Plattform (macOS `ps -E` und `lsof`, Linux `/proc`; als root braucht das Lesen
fremder `environ` CAP_SYS_PTRACE) und zeigt in der Kopfzeile eine volle Leistenfläche je Prozess mit Art, Label
und Port-Links: Hintergrundprozesse immer, Kinder eines laufenden Werkzeugaufrufs nur mit offenem
Port. Hintergrund ist an der gestrichelten rechten Trennlinie und im Tooltip erkennbar, nie an einer Farbe. Das
ist eine Laufzeitressource, kein Journal-Zustand: ein Beobachter je Server scannt alle zwei
Sekunden, solange ein Browser den Kanal `processes:<runId>` abonniert hat; fehlt Berechtigung oder
Werkzeug, ist das ein benannter Fehler in der Kopfzeile. macOS prüft die Befehlszeile vor und
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
Der Server prüft Laufzuordnung, Startkennung und UID vor jedem Signal erneut; die Methode
prüft zusätzlich die laufende Anfrage und ihre Lese- und Schreibrechte nach asynchronen Abfragen.
Server, dessen Vorfahren und PID 1 sind geschützt. Signale gehen ausschließlich an einzelne
positive PIDs, nie an eine möglicherweise mit fremden Prozessen geteilte Prozessgruppe.
Nach SIGTERM folgen zwei Sekunden Wartezeit, nötigenfalls SIGKILL und eine weitere Sekunde zur
Prüfung. Ein Durchlauf ist auf acht Sekunden begrenzt; fehlende Rechte, unlesbare Prozesstabellen
und verbleibende Prozesse sind explizite Fehler.

Beim Run-Stopp sammelt derselbe Plugin-Beitrag alle markierten Prozesse, auch ohne Port und
unabhängig von ihrer Anzeige in der Kopfzeile. Ein abschließender Lifecycle-Durchlauf nach dem
Ende der Actors und übrigen Stopp-Beiträge erfasst spät gestartete Kinder vor der Run-Freigabe;
vor dem Löschen folgt ein weiterer Durchlauf. Neue Kinder während der Bereinigung werden bei
jedem Scan aufgenommen. Diese Bereinigung benötigt keinen offenen Browser und bleibt vollständig
in der Extension. macOS liest den Marker nur aus dem Umgebungsanteil von `ps -E`, nicht aus
gleichlautenden Kommandoargumenten. Die POSIX-Abfrage der Startkennung und das Signal sind
getrennte Betriebssystemaufrufe; sie bilden keine atomare Prozessreferenz.

`ragents.workspace` trägt außerdem den rein lesenden Reiter `Dateien` bei: Arbeitsverzeichnis und
Dateiablage eines Runs als Baum mit Textvorschau, ohne Schreiben und Löschen; die Methoden
`ragents.workspace.browse.list` und `ragents.workspace.browse.preview` liefern Baum und Vorschau,
live über einen fs-Watcher je Abonnement des Kanals `ragents.workspace.browse` (`runId`, `root`),
ein 30-Sekunden-Poll bleibt nur als Fallback.

## Language-Server-Plugins

Diagnostik ohne Build: `ragents.lsp-roslyn` (C#), `ragents.lsp-fsharp` (F#, fsautocomplete) und
`ragents.lsp-typescript` sind drei produktneutrale Plugins über EINEM gemeinsamen Client in
`apps/server/src/plugin-support/language-server/` (JSON-RPC über stdio, Dokument-Sync mit
vollem Text, Diagnostik per Pull oder Push, Prozess über `startManagedService`). Ein Plugin ist
nur ein Adapter (Start, Wurzeltyp, Laden, Endungen) plus die gemeinsame Fabrik
`createLanguageServerPlugin`.
Die stdio-Verbindung verwendet `vscode-jsonrpc` für Framing, Request-Zuordnung und Antworten.
Der Host verbindet `AbortSignal` mit JSON-RPC-Cancellation und beendet die lokale Anfrage sofort;
späte Antworten ändern ihr Ergebnis nicht. Transportfehler schließen offene Anfragen mit Ursache
und beenden den zugehörigen verwalteten Prozess. Prozessstart, Dokumentabgleich und fachliche
Diagnostik bleiben beim gemeinsamen Language-Server-Client.

- Je Plugin zwei Werkzeuge: `<id>_open(root)` und `<id>_diagnostics(paths?, warnings?)`.
  Der Server startet durch einen ausdrücklichen Funktionsaufruf eines Agenten oder vorbereiteten
  Actor-Programms. Produktspezifische Wurzeln gehören zum aufrufenden Plugin, nicht zum Host.
- Während des Ladens liefert die Statusabfrage sofort `opening`; `ready` folgt erst nach
  abgeschlossenem Adapter-Laden. Bei Roslyn schließt das die Bestätigung der Projektinitialisierung
  ein. `failed` erhält Wurzel und konkrete Ursache bis zum erneuten Öffnen oder Stoppen.
  Die Diagnoseansicht zeigt Ladezustand und Fehler, ohne daraus Fehlerfreiheit abzuleiten.
  Paralleles Öffnen derselben Wurzel teilt den Start. Stoppen, Wurzelwechsel und Shutdown
  verhindern verspätete Erfolgsmeldungen und beenden die verwalteten Prozesse.
- Nach jedem erfolgreichen `edit`/`write` hängt die Sandbox die Fehler der geschriebenen Datei
  als weiteren Textteil ans Werkzeugergebnis. Dafür bietet der Sandbox-Host den Slot
  `sandboxServicesToken` (`registerEditAnnotator`, `processContextFor`), den beide
  Workspace-Plugins bereitstellen; die Sandbox kennt keinen Language Server.
- Ein Server je Plugin und Run, geteilt von allen Actors des Runs, gestartet mit der Umgebung
  und UID des Run-bash; Leerlauf beendet ihn nach 20 Minuten, der nächste Zugriff lädt die
  gemerkte Wurzel neu. Run-Stopp und Server-Shutdown beenden ihn. Kein Journal-Zustand: nach
  einem Host-Neustart ist nichts geöffnet, `<id>_diagnostics` scheitert hart, die Annotation
  bleibt still.
- Fehler immer, Warnungen nur gezählt (auf Anfrage gelistet), gedeckelt bei 30 Zeilen.
- Der TypeScript-Adapter setzt `publishesOnlyChangedDiagnostics`: weil
  typescript-language-server bei unverändert leerer Diagnostik nach `didChange` nichts
  publiziert, schließt die Session eine fehlerfreie, geänderte Datei und öffnet sie neu, statt auf
  eine Antwort zu warten. Roslyn nutzt Pull-Diagnostik und ist nicht betroffen.
- Grenzen: Roslyn sieht F#-Projekte nur als gebaute DLL, FSAC C#-Projekte ebenso; ein neu
  angelegtes File kennt Roslyn erst, wenn sein Dateiwächter es gemeldet hat.

## Skill-Einstiege und Referenzfälle

`ragents.reference` bündelt neutrale Skills, Run-Scripts und Web-Leitfäden als mitgelieferte
Demos und mögliche High-Level-Testfälle für RAgents. Kundenspezifische Abläufe und
Integrationen gehören nicht zu diesem Katalog.
Die Beispiele haben zwei überlappende Blickrichtungen: Anwendungsfälle beginnen mit einer
konkreten Aufgabe, Konzeptdemos machen eine Plattformfähigkeit gezielt beobachtbar.
Jeder Skill-Einstieg beschreibt ein Ziel in einem kurzen, frei formulierten Prompt und zählt als
ein Beispiel. Seine einzelne Kategorie steht in `category`, unabhängig von Konzept-Tags.
Die `description` jedes Demo-Einstiegs nennt in kurzem Fließtext seinen Demonstrationszweck:
welche Konzepte zusammenspielen und was dabei beobachtbar werden soll. Das gilt für Skills und
Run-Scripts; bei ähnlichen Fällen benennt sie den Unterschied. Der Text steht direkt im
vorhandenen Beschreibungsfeld und erscheint in Startauswahl und Referenz.
Der Host besitzt keine feste Liste zulässiger Kategorien. Die Referenzkarten verwenden unter
anderem Mini-Apps, TypeScript ohne Oberfläche, Zusammenarbeit und Code und Diagnose. Die
Mini-App-Gruppe enthält reine Views, gemeinsame Funktionen, LLM-Views, mehrere Ansichten
eines Zustands und automatisch gesammelte Agentenantworten.
Der Skill-Einstieg Balkon-Wizard fordert eine eigenständige App auf dem Canvas an, die ein begrenztes
Gespräch mit einem KI-Berater im Hintergrund vermittelt. Nach jeder Antwort bestimmt das LLM
die nächste Frage anhand des bisherigen Gesprächs; eine feste Fragenliste erfüllt den Auftrag
nicht. Antworten werden ausschließlich in der App eingegeben; nach fünf Antworten steht eine
Gestaltungsempfehlung. Die App ist nicht in eine LLM-Chatkarte integriert.
Die Karte verlangt gemeinsame Layout- und Formularbausteine sowie
Fortschritt, Lade- und Fehlerzustände. Sie ist ein Auftrag zum Aufbau, kein vorinstallierter Wizard.

Daneben bietet das Run-Script `balcony-wizard` ein vorbereitetes Demo derselben Aufgabe.
Es erstellt ohne Koordinator einen Berater mit Modellprofil `standard` und leerer Werkzeugliste,
bindet die eigene Canvas-View an ihn und wählt ihn als Primary-Actor. Der Startknopf in der App
beginnt das Interview; das Setup ruft noch kein Modell auf. Das Formular zählt fünf Antworten,
der Berater bestimmt die Fragen und die abschließende Empfehlung. Fortschritt und fertige
Ausgaben stammen aus dem Actor-Gespräch und bleiben beim Neuladen erhalten. Fehlgeschlagene
Modellantworten lassen sich erneut anfordern, ohne eine weitere Benutzerantwort zu zählen.
Das Demo verwendet AppLayout, Stack und Form und besitzt kein Chat-Widget. Es ist ein konkretes
Referenzpaket, keine fachliche Vorgabe an den allgemeinen Run-Builder.

Die Konzeptzuordnung steht in `tags` der Einstiege: bei Skills und Run-Scripts im kommagetrennten
Frontmatter, bei expliziten Beiträgen als Stringliste. Der Host behandelt alle Schlagworte gleich;
er kennt keinen Referenzkatalog. Namen müssen nicht leer, eindeutig und ohne äußere Leerzeichen
sein. Die UI zeigt die Schlagworte und verwendet sie für Suche und Auswahlfilter.
Der Konzeptkatalog liegt ausschließlich in `plugins/ragents.reference/examples.ts`.
Bedienbeispiele in `plugins/ragents.reference/walkthroughs.ts` ergänzen Konzepte außerhalb eines
Run-Einstiegs, etwa den globalen Koordinator und die Wiederherstellung. Sie beschreiben konkrete
Benutzerschritte und erwartetes Verhalten, registrieren aber keine zusätzlichen Run-Einstiege.
Die öffentliche Referenz erzeugt daraus und aus den tatsächlichen Einstiegen die beiden
Blickrichtungen und die Konzeptübersicht. `pnpm check:homepage` verlangt mindestens zwei
Beispiele je Produktkonzept sowie gültige Zuordnungen. Für gewöhnliche Konzepte zählen Skill-Einstiege;
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
anderen Primary-Actor. Zwei neutrale Skill-Einstiege führen eine Entscheidung beziehungsweise
Lerneinheit als wiederverwendbare Arbeitsanweisungen im Chat, ohne einen programmierten Aufbau.

<!-- guide:extensions -->
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
<!-- /guide:extensions -->

## Browserprüfungen

`ragents.browser` ergänzt einen echten, über Playwright gesteuerten Browser und benötigt
`ragents.documents`. Jeder Run besitzt einen eigenen Browserprozess mit einer Seite, isolierten
Cookies und ohne übernommene Anmeldung. Öffnen, semantisches Lesen, Klicken, Ausfüllen,
Auswählen, Tastatureingaben, Prüfungen und Screenshots sind typisierte Run-Funktionen.
Die verbindlichen Schemas stehen in `plugins/ragents.browser/server/tools.ts`.
Der ARIA-Snapshot enthält zugängliche Rollen, Namen und Elementreferenzen; Aktionen lösen
Rolle/Name, Beschriftung, Text, Test-ID oder CSS serverseitig auf. Modelle müssen weder
Snapshot-IDs noch Ergebnisdateipfade abschreiben. Ein optionales Ziel-Iframe wird per CSS gewählt.

Die Aktionen eines Runs laufen geordnet und verwenden Playwright-Wartebedingungen.
Mehrdeutige oder nicht bedienbare Ziele, fehlende Browser und fehlgeschlagene Navigationen
melden Fehler; bei Mehrdeutigkeit nennt der Fehler die Kandidaten und den Ausweg. Ein Ziel
wählt mit `nth` (0-basiert) oder `first: true` einen von mehreren Treffern; `browser_check`
prüft mit `count` die Anzahl sichtbarer Treffer eines Ziels statt seiner Eindeutigkeit
(`0` belegt Abwesenheit). Reine Sichtbarkeits- und Adressprüfungen in `browser_check` warten
höchstens 5 Sekunden, Aktionen die volle Zeitgrenze von 15 Sekunden (seit dem 16.09.2026,
nach sechs Strict-Mode-Fehlversuchen je eine Viertelminute im Lauf zu Item 14760).
Konsole, JavaScript-Ausnahmen und fehlgeschlagene Netzwerkantworten fließen in
die Prüfung ein. Erfolgreiche explizite Assertions erzeugen einen Zeitstempel; Aktionen,
Navigation verwerfen ihn; neue Fehler bleiben in der Fehlerliste des Runs sichtbar, ohne die
Prüfung zu verwerfen. Ein Screenshot allein ist kein erfolgreicher Test.

Die Seite läuft standardmäßig in einem Viewport von 1920 x 1080 Pixeln (16:9, Skalierung 1),
sodass Screenshots ohne Vergrößerung als Full-HD-Bilder vorliegen und breite Oberflächen wie
ein Ribbon vollständig sichtbar sind. `browser_viewport` stellt die Größe je Run um, etwa für
schmale Layouts; der gewählte Wert gilt bis zur nächsten Änderung, auch nach einem Neustart
des Browsers im selben Run. Screenshots liegen als PNG unter `browser/` in der
Run-Dateiablage und sind über deren bestehende Bildanzeige erreichbar. Eine atomar geschriebene, verborgene Aufnahmeliste erhält
Namen und Dateireferenzen über Browserstopp und Serverneustart. Die Vorbereitung eines Runs
lädt sie wieder; dabei wird kein Browser gestartet. Der Dienst `browserRuntimeToken` liefert
die historische Aufnahmeliste getrennt von aktuellen Aufnahmen und gültiger Prüfungszeit.
Beschädigte Aufnahmemetadaten melden einen Fehler für den betroffenen Run.
Das native Agentenwerkzeug `browser_view_screenshot` liefert das letzte Bild direkt als
Bildinhalt, ohne Pfadangabe. Ein Modell ohne Bildunterstützung erhält einen ausdrücklichen Fehler.

Browserstopp und Abbruch schließen die Prozesse; gespeicherte Aufnahmen bleiben erhalten.
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
vorgelegte Änderungen) als Plugin-Zustand am Run im Journal und werden beim Vorbereiten einer
Session neu kompiliert und wiederhergestellt.

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

## Offene Grenzen

- Plugins werden geprobt, aber nicht installiert. Server und Web laden zur Laufzeit nur, was das
  Profil nennt: Plugin-Ordner im Repository oder an einer festen Stelle auf der Platte, jeweils mit
  `server/` und optional `web/`. Ein Plugin aus einer fremden Quelle nachzuladen ist NICHT
  vorgesehen - kein Download, keine Registry, keine Signaturprüfung.
- Web-Plugins werden build-time gebündelt, je Profil; Laufzeit-Bundleloading ist nicht Teil des
  Vertrags. Ein Bundle, das mit einem anderen Profil gebaut wurde, bricht beim Laden ab, sobald
  eine erwartete Web-Hälfte fehlt.
- Die Arbeitsspalte kennt genau einen Canvas-Beitrag mit `Column`; ihr Zustand liegt je
  Browser-Speicher, in VS Code also je Fenster. Der Explorer der Erweiterung kann die persönliche
  Actor-Anzeige des Webviews nicht lesen und zeigt Actors deshalb nur mit ihrem Serverzustand.
  Die Spalte in einem eigenen Bundle ohne iframe (Stufe 2 des Entwurfs) ist nicht gebaut.
- Die Nachrichtenschicht kennt keine Batch-Anfragen und keinen WebSocket; über HTTP ist jede
  JSON-RPC-Antwort ein HTTP 200 mit `result` oder `error`, nur Transportfehler (kein JSON, zu
  groß, fremde Verbindung) tragen einen anderen Status. Stdio hat keine Anmeldung: wer den
  Prozess startet, hat alle Rechte.
- Bei einem Arbeitsbereich auf einem Arbeitsplatz laufen Language Server, Prozessanzeige und
  Browserprüfung nicht: sie brauchen die Dateien und Prozesse auf dem Serverrechner. Bash auf dem
  Arbeitsplatz erreicht die Dateiablage des Runs (`RAGENTS_FILES_DIR`) nicht, nur `read` und
  `write` tun das. Der Reiter `Dateien` zeigt dann nur die Dateiablage und meldet für den
  Arbeitsbereich, wo er liegt. Der Arbeitsplatz startet `/bin/bash`; Windows ist nicht
  vorgesehen. Zwei Runs auf demselben Ordner kollidieren; das ist die Entscheidung des Benutzers.
