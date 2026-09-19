import type { HomepageCatalog } from "./homepage-catalog.js";
import { exampleOverviewMarkdown, exampleWalkthroughsMarkdown, groupStartEntries } from "./homepage-examples.js";
import type { HomepageExtensionsResult } from "./homepage-extensions.js";
import { guideMarkdownOutputs, type HomepageGuide } from "./homepage-guide.js";

export function markdownCode(value: string, language = ""): string {
  const longest = Math.max(0, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${value}${value.endsWith("\n") ? "" : "\n"}${fence}`;
}

const json = (value: unknown) => markdownCode(JSON.stringify(value, null, 2), "json");
const heading = (value: string) => value.replace(/[\r\n]+/g, " ");
const document = (parts: string[]) => parts.join("\n\n") + "\n";
const fileLanguage = (file: string) => file.endsWith(".tsx") ? "tsx" : file.endsWith(".ts") ? "typescript"
  : file.endsWith(".json") ? "json" : file.endsWith(".md") ? "markdown" : file.endsWith(".css") ? "css" : "";
const files = (entries: Record<string, string>) => Object.entries(entries)
  .sort(([left], [right]) => left.localeCompare(right, "en"))
  .map(([file, content]) => `#### ${heading(file)}\n\n${markdownCode(content, fileLanguage(file))}`);

function reference(catalog: HomepageCatalog): string {
  const startGroups = groupStartEntries(catalog.starts);
  const groupLabels = new Map(startGroups.map((group) => [group.entries[0].id, group.label]));
  return document([
    "# RAgents: Bausteinreferenz",
    "> Öffentliche Werkzeuge, Operationen, Actor-Programm-Vorlagen und Einstiege des Profils core, aus den tatsächlichen Verträgen erzeugt.",
    "[Run-Setup-Anleitung und vollständige Pakete](run-setup.md) | [Entwicklerreferenz](developer.md) | [JSON-RPC-API](rpc-api.md) | [LLM-Index](llms.txt)",
    "## Funktionen und native Werkzeuge",
    "Fachfunktionen werden in Snippets und Actor-Programmen über context.functions aufgerufen. Ausgerüstete LLM-Actors erhalten automatisch die für sie verfügbaren Funktionsnamen mit Kurzbeschreibungen. typescript_api liefert auf Namensanfrage ihre Typen und optionalen Langbeschreibungen, typescript_eval führt Snippets aus. Dies ist der statische Bestand. Verfügbarkeit und Auswahl hängen von Actor, Grants und Run ab. Eigene Actor-Funktionen ergänzen diesen Bestand während einer Unterhaltung.",
    ...catalog.tools.map((tool) => document([
      `### ${heading(tool.name)}`, tool.label, tool.description,
      ...(tool.longDescription ? [tool.longDescription] : []),
      `Eigentümer: ${tool.owner}. Scope: ${tool.scope}. Natives Modellwerkzeug: ${tool.nativeTool ? "ja" : "nein"}. Verfügbarkeit: ${tool.availability}.`,
      tool.availabilityDetail,
      "#### Eingabe", json(tool.schema), "#### Ergebnis", json(tool.resultSchema),
    ]).trimEnd()),
    "## Operationen",
    ...catalog.operations.map((operation) => document([
      `### ${heading(operation.id)}`, operation.description, `Eigentümer: ${operation.owner}.`,
      "#### Bediener-Policy", json(operation.operator),
      "#### Eingabe", json(operation.schema), "#### Ergebnis", json(operation.resultSchema),
    ]).trimEnd()),
    "## Actor-Programm-Vorlagen",
    ...catalog.templates.map((template) => document([
      `### ${heading(template.id)}: ${heading(template.title)}`, template.description,
      ...files(template.files),
    ]).trimEnd()),
    "## Actor-Programmpaket",
    "actor_program_create erzeugt ein Paket unter @actors/<name>/ mit festen lokalen Abhängigkeiten. Dateiwerkzeuge und Language Server verwenden diesen Alias; Bash nutzt RAGENTS_ACTORS_DIR. Vor Modellanfragen erscheinen kurze Diagnostik-Deltas geänderter Projekte. actor_program_diagnostics liefert den letzten vollständigen Stand, actor_program_activate prüft, baut, testet und aktiviert das Paket.",
    json(catalog.actorProgramAuthoring.package),
    "## Actor-Backendvertrag", json(catalog.actorProgramAuthoring.backend),
    "## Mini-App-Client",
    "Die Client-API wird aus dem Actor-Vertrag in @ragents/client erzeugt. Die allgemeine Referenz zeigt die Struktur ohne konkrete Funktionen. Im Paket liegen die spezialisierten Typdateien für den TypeScript-Compiler und den Language Server.",
    "### Client", markdownCode(catalog.actorProgramAuthoring.client, "typescript"),
    "## Typvertrag der Mini-App-UI",
    "Einstieg: plugins/ragents.actor-programs/client-ui/contracts.d.ts. Alle lokal referenzierten Typdateien folgen automatisch; Deklarationen aus Implementierungsdateien erzeugt TypeScript. Externe Standardtypen wie React und DOM gehören zu ihren Bibliotheken. Im App-Paket stehen diese Bausteine als @ragents/client/ui zum regulären Import bereit; context und useAppState werden aus @ragents/client importiert.",
    ...files(catalog.clientUiFiles),
    exampleOverviewMarkdown(catalog.starts),
    exampleWalkthroughsMarkdown(),
    "## Einstiege",
    ...startGroups.flatMap((group) => group.entries).map((start) => document([
      ...(groupLabels.has(start.id) ? [`### Kategorie: ${heading(groupLabels.get(start.id)!)}`] : []),
      `<a id="start-${start.id}"></a>`,
      `### ${heading(start.id)}: ${heading(start.title)}`, start.description,
      ...(start.tags?.length ? [`Tags: ${start.tags.join(", ")}.`] : []),
      json(start),
      ...(start.action === "script" ? ["Vollständige Paketquellen stehen in [run-setup.md](run-setup.md)."] : []),
      ...(start.action === "skill" ? [
        `[Arbeitsanleitung des Skills](../../plugins/${start.owner}/skills/${start.skill}/SKILL.md)`,
        "Start über POST /runs: Den Auftrag in message nach Bedarf bearbeiten und den Skillnamen erhalten. Der aktuelle Auftrag hat Vorrang vor Beispieltext im Skill.",
        json({ title: start.title, message: `Nutze den Skill ${start.skill} für diesen Auftrag.\n\n${start.prompt}` }),
      ] : []),
    ]).trimEnd()),
    "## Plugins", json(catalog.plugins),
    "## Dynamische Werkzeugbeiträge", json(catalog.dynamic),
  ]);
}

function developer(extensions: HomepageExtensionsResult): string {
  const categories = [...new Set(extensions.extensions.map((extension) => extension.category))];
  return document([
    "# RAgents: Entwicklerreferenz",
    "> Erweiterungspunkte, Beispiele und aktuelle Vertragsflächen aus dem Code.",
    "[Werkzeugverträge](reference.md) | [Run-Script-Pakete und API](run-setup.md) | [JSON-RPC-API](rpc-api.md) | [LLM-Index](llms.txt)",
    "Die Beispiele sind Ausschnitte für den jeweils benannten Einsatzort. Run-lokale Scripts sind native TypeScript-Module mit explizitem Kontext; Plugin-Servercode und Web-Module werden mit der Anwendung gebaut.",
    ...categories.flatMap((category) => [
      `## ${heading(category)}`,
      ...extensions.extensions.filter((extension) => extension.category === category).map((extension) => document([
        `### ${heading(extension.title)}`, extension.description,
        `Einsatzort: ${extension.environment}`, markdownCode(extension.example, extension.language),
        ...extension.notes,
        ...(extension.sources?.map((source) => `[${source.title}](../../${source.file})`) ?? []),
        `Vertragsfelder: ${extension.covers.join(", ")}.`,
      ]).trimEnd()),
    ]),
    "## Eingebaute Rechte",
    "Die Liste stammt aus den Rechteverträgen des Hosts und des Koordinator-Plugins; Extensions können zusätzliche exakte Namen verwenden.",
    ...extensions.permissions.map((permission) => `- ${permission.id}: ${permission.description}`),
    "", "### Kernmethoden", "",
    "Automatisch aus den registrierten Verträgen; Methoden ohne feste Rechte prüft der Host je Run. Der globale Koordinator ergänzt seine eigene Laufregel.", "",
    "| Methode | Rechte |", "| --- | --- |",
    ...extensions.methodRights.map((method) => `| ${method.id} | ${method.rights.join(", ") || "je Run"} |`),
    "## Aktuelle Vertragsflächen",
    ...extensions.contracts.map((contract) => document([
      `### ${heading(contract.name)}`, `Quelle im Repository: ${contract.file}`,
      markdownCode(contract.text, "typescript"),
    ]).trimEnd()),
  ]);
}

function runSetup(catalog: HomepageCatalog): string {
  return document([
    "# RAgents: ein Run-Setup schreiben",
    "> Ein Run-Script ist ein natives Actor-Programmpaket. Die Beispiele und SDK-Typen unten stammen aus den tatsächlichen öffentlichen Quellen.",
    "[Werkzeugverträge](reference.md) | [Entwicklerbeispiele](developer.md) | [Server-SDK](run-api.d.ts) | [JSON-RPC-API](rpc-api.md) | [LLM-Index](llms.txt)",
    "## Snippet oder dauerhaftes Programm",
    "Für einmalige Arbeit braucht es kein Actor-Paket: typescript_api liefert Katalog oder genaue Funktionstypen. typescript_eval erhält code oder path; der Quelltext ist ein async-Funktionsrumpf mit context und optionalem return. Beispiel: return await context.functions.actor_list({});. Derselbe Compiler und dieselben registrierten Funktionen dienen Actor-Programmen mit späteren Inputs, Zustand oder Views.",
    "Snippets handeln als Aufrufer. onInput handelt als sein Actor. Eine aufgerufene Actor-Funktion besitzt dessen Zustand, führt weitere Run-Aufrufe aber unter der Identität des Aufrufers aus. Bereits abgeschlossene Funktionsaufrufe bleiben bei einem späteren Fehler erhalten; Wiederholungen prüfen den bestehenden Aufbau.",
    "Fachliche Benutzeraufträge und Skill-Einstiege beschreiben das gewünschte Ergebnis. Technische Verträge stehen in der Umgebung; das LLM wählt den Weg selbst. Ein Run-Script ist eine zusätzliche Möglichkeit für vorbereitete Einstiege.",
    "## Freier Canvas oder Kacheln",
    "Der freie, verschiebbare und zoombare Canvas ist die Vorgabe. Auf Wunsch setzt context.functions.canvas_layout_replace einen festen Kachelmodus. Lade zuvor den genauen Vertrag über typescript_api. Ein Blatt nennt einen Actor mit @handle oder eine aktivierte Mini-App mit app:@handle/view-key; eine Teilung hat direction horizontal (links/rechts) oder vertical (oben/unten), zwei positive weights und genau zwei children. Kinder dürfen weitere Teilungen sein.",
    'Für eine Mini-App links und einen Chat rechts im Verhältnis 50:50: await context.functions.canvas_layout_replace({ mode: "tiled", root: { direction: "horizontal", weights: [1, 1], children: [{ entity: "app:@workspace/main" }, { entity: "@helper" }] } });. Die Beispielnamen durch die tatsächlich angelegten Teilnehmer ersetzen. [2, 1] teilt in zwei Drittel und ein Drittel. Für eine Kachel oben und zwei unten die horizontale Teilung als unteres Kind einer vertikalen Teilung einsetzen.',
    'Ein Aufruf nur mit mode und root erhält die freie Anordnung; { mode: "free" } wechselt zurück. Eigene Benutzeranordnungen haben Vorrang, bis der Benutzer "Programmvorgabe übernehmen" auswählt. Neue Teilnehmer verändern vorhandene Kacheln nicht automatisch. Das Setup deklariert canvas_layout_replace in seinen benötigten capabilities.',
    "## Paket und Ausführung",
    "Ein wiederverwendbarer Einstieg liegt unter plugins/<plugin-id>/run-scripts/<name>/. RUN.md nennt title, description sowie optional order, guide, tags und coordinator. Der Ordner bestimmt den Actor-Handle; coordinator ist standardmäßig true. Das Plugin muss im Profil aktiv sein.",
    "package.json enthält private: true, type: module und ragents.backend mit dem Einstieg src/server.ts. Dieser exportiert defineActor aus @ragents/server mit state, functions und input sowie der Implementierung onInput. Capabilities stehen ausschließlich im TypeScript-Vertrag, nicht noch einmal in RUN.md.",
    "Fachtests stehen als normale node:test-Dateien unter tests/**/*.test.ts. createTestContext aus @ragents/server/testing liefert Zustand und typisierte Funktionen als Mocks unter functions. Tests rufen program.onInput oder program.functions auf und prüfen Ergebnis, gespeicherten Zustand und tatsächliche Aufrufe getrennt. Eine Rückgabe wird niemals als Zustand gespeichert; dazu dient context.state.replace.",
    "Weitere Programmpakete liegen unter actors/<name>/. Der Host übernimmt sie vor dem Setup in die private Sammlung @actors. Das Setup aktiviert sie mit actor_program_activate anhand des Namens; actor: self oder @handle bindet an einen bestehenden Actor. Ein reines View-Paket braucht keinen neuen Actor.",
    "## Startwert und Ansprechpartner",
    "POST /chat/<id>/start übergibt { entry, input }. Der Setup-Actor erhält im content seines ActorInputs das JSON { input: <Leitfaden-Ergebnis oder null>, options: { <option-id>: <Wert> } }. Die Form des Leitfaden-Ergebnisses gehört zum Paket und wird vor der Verwendung geprüft.",
    "Mit coordinator: true erstellt der Host den Koordinator. Mit coordinator: false muss das Setup über run_configure einen Primary-Actor wählen und ihm einen konkreten Auftrag als ActorInput geben. Das Setup merkt abgeschlossenen Aufbau in seinem Zustand und verarbeitet spätere Inputs ohne doppelte Einrichtung.",
    "Der Host verwendet denselben Import- und Aktivierungspfad wie actor_program_activate: TypeScript prüfen, bauen, Fachtests ausführen und den erfolgreichen Stand aktivieren. Der Start benötigt keinen Modellaufruf, keinen getrennten Check/Test/Install-Vertrag und keine Build-ID im Paket.",
    "Vorbereitete lokale Pakete lassen sich auch über die HTTP-Verwaltung mit packageDirectory starten. Der Pfad verweist auf ein Verzeichnis auf dem Server; die Anfrage lädt keine Dateien hoch und registriert keine dauerhafte Startkarte.",
    "## Fähigkeiten und Zustand",
    "context.functions.actor_input(input) ruft eine registrierte Funktion typisiert auf. Gepunktete Grants wie actor.input sind Berechtigungen. Der SDK-Katalog erteilt keine Rechte; der deklarierte Programmvertrag und der gebundene Actor begrenzen die Verwendung.",
    "context.actor identifiziert den Besitzer von Funktionen und Zustand. context.std stellt die vorhandenen Standardfunktionen bereit. Subscription-Ereignisse stehen unter input.event und liefern normale ActorInputs; ein laufender Turn wartet nicht auf zukünftige Inputs.",
    "## Vollständige öffentliche Run-Script-Pakete",
    ...catalog.scripts.map((script) => document([
      `### ${heading(script.id)}`,
      ...files(script.files),
    ]).trimEnd()),
    "## Generiertes Server-SDK",
    "Dies sind die echten @ragents/server-Deklarationen mit dem statischen Capability-Bestand von core, zusätzlich als [run-api.d.ts](run-api.d.ts). Die Datei ist ein normales Modul mit Exports. Installierte Programme verwenden denselben Generator mit ihren aktuellen Verträgen; zusätzliche Globals oder Rechte entstehen dadurch nicht.",
    markdownCode(catalog.serverApiDeclarations, "typescript"),
  ]);
}

export function buildHomepageLlms(catalog: HomepageCatalog, extensions: HomepageExtensionsResult, guide: HomepageGuide): Record<string, string> {
  const referenceText = reference(catalog);
  const developerText = developer(extensions);
  const setupText = runSetup(catalog);
  const apiText = catalog.rpcReference;
  const index = document([
    "# RAgents",
    "> Programmierbarer AI-Harness mit Chat, mehreren Agenten, TypeScript-Actors und kleinen Bedienoberflächen auf einem Canvas.",
    "Diese Referenz beschreibt die vorhandenen öffentlichen Bausteine des Profils core. Verträge, API und Paketquellen werden aus dem Code erzeugt. Für ein neues Run-Setup zuerst die Anleitung und die typisierte API lesen, dann die benötigten Werkzeugverträge nachschlagen.",
    "## Verstehen und einsteigen",
    "- [Guide](guide.md): Einstieg, Laufzeit, TypeScript-Funktionen, Mini-Apps, Erweiterungen und Rechte aus der aktuellen Dokumentation.",
    guide.chapters.map((chapter) => `- [${chapter.title}](guide-${chapter.id}.md)`).join("\n"),
    "## Run-Setups",
    "- [Run-Setup-Anleitung](run-setup.md): Paketstruktur, Startinput, Tests, vollständige Beispiele und generierte API.\n- [Run-API](run-api.d.ts): Originale TypeScript-Deklarationen des Compilers.",
    "## Referenzen",
    "- [Bausteine](reference.md): Alle statischen Werkzeuge und Operationen mit Ein- und Ergebnisschemata, Actor-Programm-Vorlagen und Einstiege.\n- [Entwickeln](developer.md): Erweiterungspunkte, Beispiele und aktuelle Vertragsflächen.",
    "## Externe Clients",
    "- [JSON-RPC-API](rpc-api.md): Methoden und Kanäle mit Eingaben, Ergebnissen und Fehlern aus den ausführbaren Verträgen.\n- [OpenRPC](openrpc.json): Maschinenlesbarer Vertrag aus denselben Quellen.",
    "## Optional",
    "- [Gesamte Textreferenz](llms-full.txt): Guide, Run-Anleitung, Baustein- und Entwicklerreferenz sowie JSON-RPC-API zusammen in einer Datei.",
  ]);
  return {
    ...guideMarkdownOutputs(guide),
    "llms.txt": index,
    "llms-full.txt": document(["# RAgents: vollständige Textreferenz", ...guide.chapters.map((chapter) => chapter.markdown.trimEnd()), setupText.trimEnd(), referenceText.trimEnd(), developerText.trimEnd(), apiText.trimEnd()]),
    "reference.md": referenceText,
    "developer.md": developerText,
    "run-setup.md": setupText,
    "run-api.d.ts": catalog.serverApiDeclarations,
    "rpc-api.md": apiText,
    "openrpc.json": JSON.stringify(catalog.openRpc, null, 2) + "\n",
  };
}
