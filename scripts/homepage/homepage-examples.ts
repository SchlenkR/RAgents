import { referenceConcepts } from "../../plugins/ragents.reference/examples.js";
import { referenceWalkthroughs } from "../../plugins/ragents.reference/walkthroughs.js";

export interface ExampleConcept {
  id: string;
  label: string;
  entryKind?: "script" | "skill" | "walkthrough" | "any";
}

export interface ExampleEntry {
  id: string;
  owner: string;
  title: string;
  action: "script" | "skill";
  tags?: readonly string[];
}

export interface ExampleWalkthrough {
  id: string;
  title: string;
  description: string;
  tags: readonly string[];
  steps: readonly string[];
}

type CoveredExample = ExampleEntry | ExampleWalkthrough & { action: "walkthrough"; owner: "ragents.reference" };

export const exampleAnchor = (example: Pick<CoveredExample, "id" | "action">) => `${example.action === "walkthrough" ? "example" : "start"}-${example.id}`;

const axes = [
  { source: "Anwendungsfall", label: "Use case" },
  { source: "Konzeptdemo", label: "Concept demo" },
] as const;

const conceptLabels = new Map([
  ["agents", "Agent teams"], ["script-actors", "TypeScript actors"], ["subscriptions", "Subscriptions"],
  ["fifo", "Input queue"], ["stop", "Stopping actors"], ["artifacts", "Artifacts and access"],
  ["tiles", "Workspace layout"], ["actor-views", "Mini-apps"], ["actor-state", "Actor state"],
  ["llm-actor-view", "LLM actor with view"], ["actor-chat", "Actor chat"], ["controlled-chat", "Controlled chat"],
  ["language-servers", "Language diagnostics"], ["primary-actor", "Primary actor"], ["start-guide", "Start guide"],
  ["questions", "Questions"], ["todos", "To-dos"], ["journal", "Journal inspection"],
  ["run-scripts", "Run scripts"], ["skills", "Skills"], ["actor-functions", "Actor functions"],
  ["view-placement", "Automatic view placement"], ["view-visibility", "View visibility"],
  ["global-coordinator", "Global coordinator"], ["conversation-reset", "Conversation reset"],
  ["settings", "Settings and model selection"], ["processes", "Process display"],
  ["workspace-files", "Files and workspace"], ["restart-recovery", "Recovery after restart"],
  ["multimodal-input", "Multimodal input"],
]);

const publicTag = (tag: string) => axes.find((axis) => axis.source === tag)?.label
  ?? conceptLabels.get(referenceConcepts.find((concept) => concept.label === tag)?.id ?? "") ?? tag;

export function exampleCoverage(starts: readonly ExampleEntry[], concepts: readonly ExampleConcept[] = referenceConcepts,
  walkthroughs: readonly ExampleWalkthrough[] = concepts === referenceConcepts ? referenceWalkthroughs : []) {
  const repeated = concepts.filter((concept, index) => concepts.slice(0, index).some((previous) => previous.id === concept.id || previous.label === concept.label));
  if (repeated.length) throw new Error(`Duplicate identifier or label in the reference concept catalog: ${repeated.map((concept) => concept.label).join(", ")}`);
  for (const walkthrough of walkthroughs) {
    if (!/^[a-z][a-z0-9.-]*$/.test(walkthrough.id) || !walkthrough.title.trim() || !walkthrough.description.trim()
      || walkthrough.steps.length < 2 || walkthrough.steps.some((step) => !step.trim())) {
      throw new Error(`Incomplete walkthrough: ${walkthrough.id}`);
    }
  }
  const examples: CoveredExample[] = [...starts.filter((start) => start.owner === "ragents.reference"),
    ...walkthroughs.map((walkthrough) => ({ ...walkthrough, action: "walkthrough" as const, owner: "ragents.reference" as const }))];
  const knownTags = new Set<string>([...axes.map((axis) => axis.source), ...concepts.map((concept) => concept.label)]);
  const ids = new Set<string>();
  for (const example of examples) {
    if (ids.has(example.id)) throw new Error(`Duplicate reference example: ${example.id}`);
    ids.add(example.id);
    if (!axes.some((axis) => example.tags?.includes(axis.source))) throw new Error(`Reference example ${example.id} needs the Use case or Concept demo tag.`);
    if (new Set(example.tags).size !== example.tags?.length) throw new Error(`Duplicate tags on reference example ${example.id}`);
    const unknown = example.tags?.filter((tag) => !knownTags.has(tag)) ?? [];
    if (unknown.length) throw new Error(`Unknown concept tags on ${example.id}: ${unknown.join(", ")}`);
    if (!concepts.some((concept) => example.tags?.includes(concept.label))) throw new Error(`Reference example ${example.id} needs at least one concept.`);
  }
  const coverage = concepts.map((concept) => ({
    ...concept, label: conceptLabels.get(concept.id) ?? concept.label,
    examples: examples.filter((example) => example.tags?.includes(concept.label)
      && (concept.entryKind === "any" || example.action === (concept.entryKind ?? "skill"))),
  }));
  const missing = coverage.filter((concept) => concept.examples.length < 2);
  if (missing.length) throw new Error(`At least two distinct reference examples are required per concept: ${missing.map((concept) => `${concept.label} (${concept.examples.length}/2)`).join(", ")}`);
  return { axes: axes.map(({ source, label }) => ({ label, examples: examples.filter((example) => example.tags?.includes(source)) })), concepts: coverage };
}

const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));
const explanation = "The bundled examples demonstrate how RAgents concepts work together and provide starting points for end-to-end tests. Use cases show concrete tasks; concept demos make individual capabilities observable. Links lead to prepared tasks or step-by-step walkthroughs. This overview is not evidence of completed model runs.";

export function exampleOverviewHtml(starts: readonly ExampleEntry[]): string {
  const coverage = exampleCoverage(starts);
  const links = (examples: CoveredExample[]) => examples.map((example) => `<a href="#${escape(exampleAnchor(example))}">${escape(example.title)}</a>`).join(", ");
  return `<section id="examples"><h2>Examples by task and concept</h2><p>${explanation}</p>${coverage.axes.map((axis) => `<h3>${axis.label}</h3><p>${links(axis.examples)}</p>`).join("")}<div class="table-wrap"><table><thead><tr><th>Concept</th><th>Examples</th></tr></thead><tbody>${coverage.concepts.map((concept) => `<tr><th scope="row">${escape(concept.label)}</th><td>${links(concept.examples)}</td></tr>`).join("")}</tbody></table></div></section>`;
}

export function exampleOverviewMarkdown(starts: readonly ExampleEntry[]): string {
  const coverage = exampleCoverage(starts);
  const label = (value: string) => value.replace(/[\\[\]|]/g, "\\$&").replace(/[\r\n]+/g, " ");
  const links = (examples: CoveredExample[]) => examples.map((example) => `[${label(example.title)}](#${encodeURIComponent(exampleAnchor(example))})`).join(", ");
  return ["## Examples by task and concept", explanation,
    ...coverage.axes.flatMap((axis) => [`### ${axis.label}`, links(axis.examples)]),
    ["| Concept | Examples |", "| --- | --- |", ...coverage.concepts.map((concept) => `| ${label(concept.label)} | ${links(concept.examples)} |`)].join("\n"),
  ].join("\n\n");
}


const walkthroughExplanation = "Walkthroughs explain step by step how to use existing functions in the interface. They are documentation, not additional start cards or evidence of completed model runs. You can follow the steps in the application.";

export function exampleWalkthroughsHtml(walkthroughs: readonly ExampleWalkthrough[] = referenceWalkthroughs): string {
  return `<section id="walkthroughs"><h2>Walkthroughs</h2><p>${walkthroughExplanation}</p>${walkthroughs.map((walkthrough) => `<article id="example-${escape(walkthrough.id)}"><h3>${escape(walkthrough.title)}</h3><p>${escape(walkthrough.description)}</p><p class="meta">User workflow / ${escape(walkthrough.tags.map(publicTag).join(" / "))}</p><ol>${walkthrough.steps.map((step) => `<li>${escape(step)}</li>`).join("")}</ol></article>`).join("")}</section>`;
}

export function exampleWalkthroughsMarkdown(walkthroughs: readonly ExampleWalkthrough[] = referenceWalkthroughs): string {
  return ["## Walkthroughs", walkthroughExplanation,
    ...walkthroughs.map((walkthrough) => [`<a id="example-${walkthrough.id}"></a>`, `### ${walkthrough.title}`, walkthrough.description,
      `User workflow. Tags: ${walkthrough.tags.map(publicTag).join(", ")}.`, walkthrough.steps.map((step, index) => `${index + 1}. ${step}`).join("\n"),
    ].join("\n\n")),
  ].join("\n\n");
}

export function groupStartEntries<T extends ExampleEntry & { category?: string; order?: number }>(entries: readonly T[]): { label: string; entries: T[] }[] {
  const sorted = [...entries].sort((left, right) => (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER)
    || left.title.localeCompare(right.title, "de-DE"));
  const groups = new Map<string, T[]>();
  for (const entry of sorted.filter((entry) => entry.action === "skill")) {
    if (!entry.category?.trim()) throw new Error(`Skill start entry ${entry.id} needs a category.`);
    const cards = groups.get(entry.category) ?? [];
    cards.push(entry);
    groups.set(entry.category, cards);
  }
  const result = [...groups].map(([label, entries]) => ({ label, entries }));
  const launches = sorted.filter((entry) => entry.action !== "skill");
  if (launches.length) result.push({ label: "Prepared workflows", entries: launches });
  return result;
}
