import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { assertPublicOutput, type HomepageCatalog } from "./homepage-catalog.js";
import { buildHomepageUi } from "./homepage-ui.js";
import { buildHomepageMotion } from "./homepage-motion.js";
import { buildHomepageMiniApp } from "./homepage-mini-app.js";
import { buildHomepageSamples } from "./homepage-samples.js";
import { buildHomepageLlms } from "./homepage-llms.js";
import { exampleOverviewHtml, exampleWalkthroughsHtml, groupStartEntries } from "./homepage-examples.js";
import { assertHomepageLinks, buildHomepageExport, writeHomepageExport } from "./homepage-export.js";
import { buildHomepageGuide, guideChapterHtml, guideCss, guideIndexHtml } from "./homepage-guide.js";
import { buildTailwind } from "../../plugins/ragents.actor-programs/server/tailwind.js";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));
const code = (value: unknown) => `<pre><code>${escape(typeof value === "string" ? value : JSON.stringify(value, null, 2))}</code></pre>`;
const sourceLink = (owner: string) => owner === "engine" ? "../../packages/ragents/src/agents/tools.ts"
  : owner === "ragents.runtime" ? "../../apps/server/src/ragents/typescript-tools.ts" : `../../plugins/${owner}/server/index.ts`;
const css = `
*{box-sizing:border-box}body{margin:0;background:var(--app);color:var(--foreground);font:16px/1.65 var(--font-sans)}a{color:#1467b0;text-underline-offset:4px}a:hover{color:var(--foreground)}:focus-visible{outline:3px solid var(--primary);outline-offset:4px}main,body>footer{padding-block:24px}nav{display:flex;gap:12px 24px;flex-wrap:wrap}h1{font-size:clamp(38px,7vw,66px);line-height:1.1;letter-spacing:-.04em;margin:16px 0 24px}h2{font-size:30px;line-height:1.2;margin:0 0 20px;letter-spacing:-.02em}h3{font-size:20px;line-height:1.4}p{max-width:76ch}.intro{padding:36px 0 44px}.eyebrow{font:12px var(--font-mono);text-transform:uppercase;letter-spacing:.1em}.lead{font-size:20px;line-height:1.6}.stats{font:13px var(--font-mono);margin:24px 0}.section-nav{border-top:1px solid var(--border);padding:20px 0}main>section{padding:44px 0;border-top:1px solid var(--border)}article{min-width:0;padding:24px 0;border-top:1px solid var(--border-soft)}article h3{margin:0 0 8px;overflow-wrap:anywhere}.meta,.example-context{font:12px/1.7 var(--font-mono);color:#536b80;overflow-wrap:anywhere}details{margin:14px 0;border:1px solid var(--border);border-radius:8px;overflow:hidden;background:var(--background)}summary{cursor:pointer;padding:12px 16px;font-weight:600}details>p,details>div,details>table{margin:16px}pre{max-width:100%;overflow:auto;padding:20px;background:var(--card);font:12px/1.7 var(--font-mono);tab-size:2;margin:0}code{font-family:var(--font-mono);font-size:.9em;overflow-wrap:anywhere}pre code{font-size:inherit;overflow-wrap:normal}label{display:block;font-weight:600;margin-bottom:6px}input[type=search],select{font:inherit;color:inherit;border:1px solid var(--border);border-radius:6px;background:var(--background);padding:10px 12px;max-width:100%}input[type=search]{width:100%}.tool-label{display:block;font-size:13px;font-weight:400;color:#536b80;margin-top:3px}[data-tool]{padding:0;border:0}[data-tool]>details{margin:8px 0}[data-tool]>details>a{display:inline-block;margin:0 16px 16px}[data-tool]>details>details{margin:16px}.filter-row{display:flex;gap:16px;flex-wrap:wrap;align-items:end}.filter-row>div:first-child{flex:1;min-width:min(280px,100%)}.note{padding:16px 20px;background:var(--card);border-left:3px solid var(--primary)}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid var(--border);padding:10px;overflow-wrap:anywhere}th{font-weight:600}.table-wrap{overflow:auto}body>footer{padding-top:30px;padding-bottom:60px;border-top:1px solid var(--border)}[hidden]{display:none!important}@media(max-width:600px){h2{font-size:26px}main>section{padding:32px 0}pre{padding:14px;font-size:11px}.lead{font-size:18px}}
`;

function page(header: string, title: string, body: string, tokens: string, script = "", extraCss = "", markdownFile?: string) {
  return `<!doctype html>\n<html lang="de" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="${escape(title)}: öffentliche Referenz und Beispiele für RAgents."><title>${escape(title)} - RAgents</title><link rel="describedby" href="llms.txt">${markdownFile ? `<link rel="alternate" type="text/markdown" href="${escape(markdownFile)}">` : ""}<style>${tokens}\n${css}</style>${extraCss}<link rel="stylesheet" href="site.css"><script src="site.js" defer></script></head><body><a class="skip" href="#main">Zum Inhalt</a>${header}<main class="shell" id="main">${body}</main><footer class="shell"><p>Aus öffentlicher Dokumentation, Verträgen und neutralen Plugins erzeugt. Neu aufbauen: <code>pnpm generate:homepage</code>. Stand prüfen: <code>pnpm check:homepage</code>.</p><nav aria-label="Weitere Seiten"><a href="llms.txt">LLM-Referenz</a><a href="http-api.md">HTTP-API</a><a href="openapi.json">OpenAPI</a><a href="index.html">Zur Homepage</a><a href="guide.html">Guide</a><a href="reference.html">Bausteine</a><a href="developer.html">Entwicklerreferenz</a></nav></footer>${script}</body></html>\n`;
}

function reference(catalog: HomepageCatalog, ui: Awaited<ReturnType<typeof buildHomepageUi>>) {
  const startGroups = groupStartEntries(catalog.starts);
  const groupLabels = new Map(startGroups.map((group) => [group.entries[0].id, group.label]));
  const starts = startGroups.flatMap((group) => group.entries);
  const groups = ["engine", "ragents.runtime", ...catalog.plugins.map((plugin) => plugin.id)].filter((owner) => catalog.tools.some((tool) => tool.owner === owner));
  return `<div class="intro"><p class="eyebrow">Referenz / vorhandene Bausteine</p><h1>Funktionen, Oberflächen und Abläufe</h1><p class="lead">RAgents verbindet KI-Agenten mit typisierten Funktionen und kleinen Bedienoberflächen. Einmalige TypeScript-Snippets und dauerhafte Actor-Programme verwenden dieselbe API. Eine Unterhaltung mit ihren Beteiligten und Ergebnissen heißt Run. Diese Referenz zeigt die verfügbaren Bausteine und vorbereiteten Abläufe der Grundausstattung core.</p><p>Den Aufbau erklärt der <a href="guide.html">Guide</a>. Eigene Erweiterungen bauen: Die <a href="developer.html">Entwicklerreferenz</a> erklärt die Erweiterungspunkte mit kleinen Beispielen. Die <a href="http-api.md">HTTP-API</a> beschreibt, wie andere Programme Unterhaltungen verwalten können; den maschinenlesbaren Vertrag gibt es als <a href="openapi.json">OpenAPI-Datei</a>.</p><p class="stats">${catalog.tools.length} Funktionen / ${ui.components.length} UI-Komponenten / ${catalog.templates.length} Actor-Programm-Vorlagen / ${catalog.starts.length} Einstiege</p><nav class="section-nav" aria-label="Auf dieser Seite"><a href="#tools">Funktionen</a><a href="#ui">UI ausprobieren</a><a href="#templates">Vorlagen</a><a href="#examples">Beispiele</a><a href="#walkthroughs">Bedienbeispiele</a><a href="#starts">Einstiege</a><a href="#operations">Operationen</a><a href="#plugins">Plugins</a></nav></div>
<section id="tools"><h2>Funktionen und native Werkzeuge</h2><p>Eine Run-Funktion liest beispielsweise eine Datei oder sendet eine Nachricht. Ausgerüstete Modelle erhalten automatisch die verfügbaren Funktionsnamen mit Kurzbeschreibungen. Sie laden genaue Typen und ausführliche Hinweise mit typescript_api und rufen die Funktionen in TypeScript über context.functions auf. typescript_eval führt dafür kleine Snippets aus. Actor-Programme verwenden dieselben Funktionen. Die Liste beschreibt deren Ein- und Ausgaben; Verfügbarkeit, Funktionsauswahl und Rechte bestimmen den Zugang. Ausdrücklich native Werkzeuge sind gekennzeichnet. Während einer Unterhaltung können weitere Actor-Funktionen hinzukommen.</p><div class="filter-row"><div><label for="tool-search">Funktion suchen</label><input id="tool-search" type="search" placeholder="Name, Beschreibung oder Plugin"></div><div><label for="tool-owner">Quelle</label><select id="tool-owner"><option value="">Alle Quellen</option>${groups.map((owner) => `<option>${escape(owner)}</option>`).join("")}</select></div></div><p id="tool-count" role="status">${catalog.tools.length} Funktionen</p><div id="tool-list">${catalog.tools.map((tool) => `<article id="tool-${tool.name}" data-tool data-search="${escape(`${tool.name} ${tool.label} ${tool.description} ${tool.owner}`)}" data-owner="${escape(tool.owner)}"><details class="tool-entry"><summary><code>${escape(tool.name)}</code><span class="tool-label">${escape(tool.label)}</span></summary><p>${escape(tool.description)}</p>${tool.longDescription ? `<details><summary>Ausführliche Beschreibung</summary><p>${escape(tool.longDescription)}</p></details>` : ""}<p class="meta">${escape(tool.owner)} / ${escape(tool.scope)} / ${tool.nativeTool ? "natives Modellwerkzeug" : "TypeScript-Funktion"}</p><p>${escape(tool.availabilityDetail)}</p><details><summary>Eingabe: JSON Schema</summary>${code(tool.schema)}</details><details><summary>Ergebnis: JSON Schema</summary>${code(tool.resultSchema)}</details><a href="${sourceLink(tool.owner)}">Implementierung ansehen</a></details></article>`).join("")}</div><p id="tool-empty" hidden>Keine Funktion passt zu dieser Suche.</p></section>
<section id="ui"><h2>UI ausprobieren</h2><p>Mini-Apps sind kleine Bedienoberflächen innerhalb einer Unterhaltung, etwa ein Formular, eine Tabelle oder ein Chat. Die folgenden Komponenten sind fertige Bausteine für diese Benutzeroberflächen, kurz UI. Die Demos lassen sich hier im Browser ausprobieren und benötigen keinen laufenden RAgents-Server.</p>${ui.html}</section>
<section id="templates"><h2>Actor-Programm-Vorlagen</h2><p>Ein Actor-Programm ergänzt einen Actor um Funktionen, Zustand und bei Bedarf eigene React-Views. Die Vorlagen liefern dafür einen Ausgangspunkt mit fertigen Quelldateien, den ein Agent über <a href="#tool-actor_program_create"><code>actor_program_create</code></a> anlegen und anpassen kann. Die Dateien unten zeigen den mitgelieferten Stand der Vorlagen.</p>${catalog.templates.map((template) => `<article id="template-${escape(template.id)}"><h3>${escape(template.title)}</h3><p>${escape(template.description)}</p><p class="meta">template: ${escape(template.id)}</p>${Object.entries(template.files).map(([file, content]) => `<details><summary>${escape(file)}</summary>${code(content)}</details>`).join("")}</article>`).join("")}</section>
${exampleOverviewHtml(catalog.starts)}
${exampleWalkthroughsHtml()}
<section id="app-api"><h2>Actor-Programm-Verträge</h2><p>Actor-Programme sind TypeScript-Pakete mit Backend, React-Views oder beidem. Funktionen und Views teilen den intrinsischen Zustand ihres Actors. Paketmetadaten und Backendvertrag stammen aus den tatsächlichen Validatoren. Der Host erzeugt die importierbaren SDK-Typen im Projekt für Compiler und Language Server. Die Dateien sind über <code>@actors</code> erreichbar. Vor Modellanfragen erscheinen kurze Diagnostik-Deltas; <code>actor_program_diagnostics</code> liefert den vollständigen letzten Stand. <code>actor_program_activate</code> prüft, baut, testet und aktiviert den Stand.</p><details><summary>package.json: ragents-Metadaten</summary>${code(catalog.actorProgramAuthoring.package)}</details><details><summary>Backend: TypeBox-Vertrag</summary>${code(catalog.actorProgramAuthoring.backend)}</details><details><summary>Client: TypeScript</summary>${code(catalog.actorProgramAuthoring.client)}</details></section>
<section id="starts"><h2>Einstiege</h2><p>Einstiege sind auswählbare Vorlagen für eine neue Unterhaltung. Ein Skill verbindet einen bearbeitbaren Startauftrag mit einer bei Bedarf ladbaren Arbeitsanleitung und ergänzenden Dateien. Der Auftrag lässt sich vor dem Start im Vorbereitungschat besprechen. Ein Run-Script führt TypeScript-Code aus, der den vorbereiteten Ablauf aufbaut. Manche Einstiege öffnen zuvor einen Einrichtungsdialog für die gewünschten Startwerte.</p>${starts.map((start) => `${groupLabels.has(start.id) ? start.action === "script" ? `<h3 id="samples">Startbare Samples</h3>` : `<h3>${escape(groupLabels.get(start.id)!)}</h3>` : ""}<article id="start-${escape(start.id)}"><h3>${escape(start.title)}</h3><p>${escape(start.description)}</p><p class="meta">${escape(start.id)} / ${start.action === "script" ? "Run-Script" : "Skill"}</p>${start.tags?.length ? `<p class="meta">${escape(start.tags.join(" / "))}</p>` : ""}${start.guide ? `<p>Einrichtungsdialog: <code>${escape(start.guide)}</code>.</p>` : ""}${start.action === "script" ? `<button type="button" data-start-sample="${escape(start.id)}" hidden>Sample starten</button><p>In RAgents: Neuer Run öffnen und den Einstieg ${escape(start.title)} auswählen. In der eingebetteten Hilfe lässt er sich direkt starten.</p><p>Koordinator: ${start.coordinator ? "ja" : "nein"}.</p>${catalog.scripts.filter((script) => script.id === start.id).map((script) => `${Object.entries(script.files).map(([file, content]) => `<details><summary>${escape(file)}</summary>${code(content)}</details>`).join("")}`).join("")}` : `<details><summary>Startauftrag</summary>${code(start.prompt)}</details><p>Skill: <a href="../../plugins/${escape(start.owner)}/skills/${escape(start.skill)}/SKILL.md"><code>${escape(start.skill)}</code></a></p>`}</article>`).join("")}</section>
<section id="operations"><h2>Operationen</h2><p>Eine Operation ist eine vom Server bereitgestellte Funktion, die Actor-Funktionen und programmierte Abläufe aufrufen können. Ihr Vertrag legt Eingabe und Ergebnis fest. Der Host bindet sie in dieselbe TypeScript-API ein; eine Bediener-Policy regelt Aufrufe aus Oberflächen.</p>${catalog.operations.map((operation) => `<article id="operation-${escape(operation.id)}"><h3><code>${escape(operation.id)}</code></h3><p>${escape(operation.description)}</p><p class="meta">${escape(operation.owner)}</p><details><summary>Eingabe und Ergebnis</summary>${code({ input: operation.schema, output: operation.resultSchema })}</details></article>`).join("")}</section>
<section id="plugins"><h2>Plugins im Profil core</h2><p>Ein Plugin ergänzt RAgents um zusammengehörige Fähigkeiten, zum Beispiel typisierte Funktionen und eine Oberfläche. Ein Profil legt fest, welche Plugins gemeinsam geladen werden. Die folgende Liste zeigt die Grundausstattung core und die Abhängigkeiten ihrer Plugins.</p><div class="table-wrap"><table><thead><tr><th>Plugin</th><th>Voraussetzungen</th></tr></thead><tbody>${catalog.plugins.map((plugin) => `<tr><td><a href="${sourceLink(plugin.id)}"><code>${escape(plugin.id)}</code></a></td><td>${escape(plugin.requires?.join(", ") || "Keine Plugin-Abhängigkeiten")}</td></tr>`).join("")}</tbody></table></div><p>Einige Plugins (${escape(catalog.dynamic.join(", "))}) stellen Funktionen erst innerhalb einer konkreten Unterhaltung zusammen. Diese sind hier nicht als feste Funktionen aufgeführt.</p></section>`;
}

const searchScript = `<script>
const search=document.getElementById('tool-search'),owner=document.getElementById('tool-owner'),rows=[...document.querySelectorAll('[data-tool]')];
function filterTools(){const query=search.value.trim().toLocaleLowerCase('de');let count=0;for(const row of rows){row.hidden=!(row.dataset.search.toLocaleLowerCase('de').includes(query)&&(!owner.value||row.dataset.owner===owner.value));if(!row.hidden)count++;}document.getElementById('tool-count').textContent=count+' von '+rows.length+' Funktionen';document.getElementById('tool-empty').hidden=count!==0;}
search.addEventListener('input',filterTools);owner.addEventListener('change',filterTools);
function revealTool(){const target=document.getElementById(location.hash.slice(1));if(target?.hasAttribute('data-tool')){search.value='';owner.value='';filterTools();target.querySelector('details').open=true;}}window.addEventListener('hashchange',revealTool);revealTool();
</script><script defer src="reference-ui.js"></script>`;

async function main() {
  const check = process.argv.includes("--check");
  if (process.argv.slice(2).some((arg) => arg !== "--check")) throw new Error("Aufruf: generate-homepage.ts [--check]");
  const scratch = await mkdtemp(path.join(tmpdir(), "ragents-reference-"));
  try {
    const require = createRequire(path.join(repoRoot, "apps/server/package.json"));
    const { stdout } = await promisify(execFile)(process.execPath, ["--import", require.resolve("tsx"), path.join(repoRoot, "scripts/homepage/homepage-catalog.ts"), "--collect"], {
      cwd: repoRoot, env: { PATH: process.env.PATH, DATA_DIR: scratch, PRODUCT_PROFILE: "core", PRODUCT_ID: "ragents", PRODUCT_TITLE: "RAgents", AGENT_MODEL: "z-ai/glm-5.3-flash", AGENT_COORDINATOR_MODEL: "z-ai/glm-5.3", OPENROUTER_API_KEY: "documentation-only" },
      maxBuffer: 16 * 1024 * 1024, timeout: 60000,
    });
    const catalog = JSON.parse(stdout) as HomepageCatalog;
    const ui = await buildHomepageUi(repoRoot);
    const motion = await buildHomepageMotion(repoRoot);
    const miniApp = await buildHomepageMiniApp(repoRoot);
    const samples = await buildHomepageSamples(repoRoot);
    const tokens = await buildTailwind([], path.join(repoRoot, "apps/web/src/ui/theme.css"));
    const { buildHomepageExtensions } = await import("./homepage-extensions.js");
    const extensions = await buildHomepageExtensions(repoRoot);
    const guide = await buildHomepageGuide(repoRoot);
    const homepage = await readFile(path.join(repoRoot, "docs/homepage/index.html"), "utf8");
    const headers = [...homepage.matchAll(/<header class="masthead shell">[\s\S]*?<\/header>/g)];
    if (headers.length !== 1) throw new Error("Die Homepage muss genau eine gemeinsame Kopfzeile enthalten.");
    const header = headers[0][0].replace(/href="#/g, 'href="index.html#');
    const pageHeader = (file: string) => header.replace(`href="${file}"`, `href="${file}" aria-current="page"`);
    const outputs: Record<string, string> = {
      ...buildHomepageLlms(catalog, extensions, guide),
      "guide.html": page(pageHeader("guide.html"), "Guide", guideIndexHtml(), tokens, "", guideCss, "guide.md"),
      ...Object.fromEntries(guide.chapters.map((chapter) => [`guide-${chapter.id}.html`, page(pageHeader("guide.html"), chapter.title, guideChapterHtml(chapter), tokens, "", guideCss, `guide-${chapter.id}.md`)])),
      "reference.html": page(pageHeader("reference.html"), "Bausteine", reference(catalog, ui), tokens, searchScript, '<link rel="stylesheet" href="reference-ui.css">', "reference.md"),
      "reference-ui.js": ui.javascript,
      "reference-ui.css": ui.css,
      "scroll-vendor.js": motion,
      ...Object.fromEntries(miniApp),
      ...Object.fromEntries(samples),
      "developer.html": page(pageHeader("developer.html"), "Entwicklerreferenz", extensions.html, tokens, "", "", "developer.md"),
    };
    for (const output of Object.values(outputs)) assertPublicOutput(output);
    for (const [name, output] of Object.entries(outputs)) {
      const destination = path.join(repoRoot, "docs/homepage", name);
      if (check) {
        if (await readFile(destination, "utf8") !== output) throw new Error(`${name} ist veraltet. pnpm generate:homepage ausführen.`);
      } else await writeFile(destination, output);
    }
    const website = await buildHomepageExport(repoRoot);
    assertHomepageLinks(website);
    if (!check) await writeHomepageExport(repoRoot, website);
    console.log(`${check ? "Geprüft" : "Erzeugt"}: ${Object.keys(outputs).join(", ")}; ${catalog.tools.length} Werkzeuge, ${ui.components.length} UI-Komponenten, ${extensions.extensions.length} Erweiterungspunkte; statische Website (${website.size} Dateien) unter docs/homepage/dist/.`);
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

await main();
