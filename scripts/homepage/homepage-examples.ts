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

const axes = ["Anwendungsfall", "Konzeptdemo"] as const;

export function exampleCoverage(starts: readonly ExampleEntry[], concepts: readonly ExampleConcept[] = referenceConcepts,
  walkthroughs: readonly ExampleWalkthrough[] = concepts === referenceConcepts ? referenceWalkthroughs : []) {
  const repeated = concepts.filter((concept, index) => concepts.slice(0, index).some((previous) => previous.id === concept.id || previous.label === concept.label));
  if (repeated.length) throw new Error(`Doppelte Kennung oder Beschriftung im Referenz-Konzeptkatalog: ${repeated.map((concept) => concept.label).join(", ")}`);
  for (const walkthrough of walkthroughs) {
    if (!/^[a-z][a-z0-9.-]*$/.test(walkthrough.id) || !walkthrough.title.trim() || !walkthrough.description.trim()
      || walkthrough.steps.length < 2 || walkthrough.steps.some((step) => !step.trim())) {
      throw new Error(`Unvollständiges Bedienbeispiel: ${walkthrough.id}`);
    }
  }
  const examples: CoveredExample[] = [...starts.filter((start) => start.owner === "ragents.reference"),
    ...walkthroughs.map((walkthrough) => ({ ...walkthrough, action: "walkthrough" as const, owner: "ragents.reference" as const }))];
  const knownTags = new Set<string>([...axes, ...concepts.map((concept) => concept.label)]);
  const ids = new Set<string>();
  for (const example of examples) {
    if (ids.has(example.id)) throw new Error(`Doppeltes Referenzbeispiel: ${example.id}`);
    ids.add(example.id);
    if (!axes.some((axis) => example.tags?.includes(axis))) throw new Error(`Referenzbeispiel ${example.id} braucht Anwendungsfall oder Konzeptdemo.`);
    if (new Set(example.tags).size !== example.tags?.length) throw new Error(`Doppelte Tags bei Referenzbeispiel ${example.id}`);
    const unknown = example.tags?.filter((tag) => !knownTags.has(tag)) ?? [];
    if (unknown.length) throw new Error(`Unbekannte Konzept-Tags bei ${example.id}: ${unknown.join(", ")}`);
    if (!concepts.some((concept) => example.tags?.includes(concept.label))) throw new Error(`Referenzbeispiel ${example.id} braucht mindestens ein Konzept.`);
  }
  const coverage = concepts.map((concept) => ({
    ...concept,
    examples: examples.filter((example) => example.tags?.includes(concept.label)
      && (concept.entryKind === "any" || example.action === (concept.entryKind ?? "skill"))),
  }));
  const missing = coverage.filter((concept) => concept.examples.length < 2);
  if (missing.length) throw new Error(`Mindestens zwei unterschiedliche Referenzbeispiele pro Konzept erforderlich: ${missing.map((concept) => `${concept.label} (${concept.examples.length}/2)`).join(", ")}`);
  return { axes: axes.map((label) => ({ label, examples: examples.filter((example) => example.tags?.includes(label)) })), concepts: coverage };
}

const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));
const explanation = "Die mitgelieferten Beispiele sind Demos für das Zusammenspiel der RAgents-Konzepte und Ausgangspunkte für durchgängige Testfälle. Anwendungsfälle zeigen konkrete Aufgaben, Konzeptdemos machen einzelne Fähigkeiten beobachtbar. Die Links führen zu vorbereiteten Aufträgen oder Schrittfolgen zur Bedienung. Die Übersicht ist kein Nachweis ausgeführter Modellläufe.";

export function exampleOverviewHtml(starts: readonly ExampleEntry[]): string {
  const coverage = exampleCoverage(starts);
  const links = (examples: CoveredExample[]) => examples.map((example) => `<a href="#${escape(exampleAnchor(example))}">${escape(example.title)}</a>`).join(", ");
  return `<section id="examples"><h2>Beispiele nach Aufgabe und Konzept</h2><p>${explanation}</p>${coverage.axes.map((axis) => `<h3>${axis.label}</h3><p>${links(axis.examples)}</p>`).join("")}<div class="table-wrap"><table><thead><tr><th>Konzept</th><th>Beispiele</th></tr></thead><tbody>${coverage.concepts.map((concept) => `<tr><th scope="row">${escape(concept.label)}</th><td>${links(concept.examples)}</td></tr>`).join("")}</tbody></table></div></section>`;
}

export function exampleOverviewMarkdown(starts: readonly ExampleEntry[]): string {
  const coverage = exampleCoverage(starts);
  const label = (value: string) => value.replace(/[\\[\]|]/g, "\\$&").replace(/[\r\n]+/g, " ");
  const links = (examples: CoveredExample[]) => examples.map((example) => `[${label(example.title)}](#${encodeURIComponent(exampleAnchor(example))})`).join(", ");
  return ["## Beispiele nach Aufgabe und Konzept", explanation,
    ...coverage.axes.flatMap((axis) => [`### ${axis.label}`, links(axis.examples)]),
    ["| Konzept | Beispiele |", "| --- | --- |", ...coverage.concepts.map((concept) => `| ${label(concept.label)} | ${links(concept.examples)} |`)].join("\n"),
  ].join("\n\n");
}


const walkthroughExplanation = "Bedienbeispiele erklären Schritt für Schritt, wie vorhandene Funktionen in der Oberfläche verwendet werden. Sie sind Dokumentation, keine zusätzlichen Startkarten und kein Nachweis ausgeführter Modellläufe. Die Schritte lassen sich in der Anwendung nachvollziehen.";

export function exampleWalkthroughsHtml(walkthroughs: readonly ExampleWalkthrough[] = referenceWalkthroughs): string {
  return `<section id="walkthroughs"><h2>Bedienbeispiele</h2><p>${walkthroughExplanation}</p>${walkthroughs.map((walkthrough) => `<article id="example-${escape(walkthrough.id)}"><h3>${escape(walkthrough.title)}</h3><p>${escape(walkthrough.description)}</p><p class="meta">Benutzerablauf / ${escape(walkthrough.tags.join(" / "))}</p><ol>${walkthrough.steps.map((step) => `<li>${escape(step)}</li>`).join("")}</ol></article>`).join("")}</section>`;
}

export function exampleWalkthroughsMarkdown(walkthroughs: readonly ExampleWalkthrough[] = referenceWalkthroughs): string {
  return ["## Bedienbeispiele", walkthroughExplanation,
    ...walkthroughs.map((walkthrough) => [`<a id="example-${walkthrough.id}"></a>`, `### ${walkthrough.title}`, walkthrough.description,
      `Benutzerablauf. Tags: ${walkthrough.tags.join(", ")}.`, walkthrough.steps.map((step, index) => `${index + 1}. ${step}`).join("\n"),
    ].join("\n\n")),
  ].join("\n\n");
}

export function groupStartEntries<T extends ExampleEntry & { category?: string; order?: number }>(entries: readonly T[]): { label: string; entries: T[] }[] {
  const sorted = [...entries].sort((left, right) => (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER)
    || left.title.localeCompare(right.title, "de-DE"));
  const groups = new Map<string, T[]>();
  for (const entry of sorted.filter((entry) => entry.action === "skill")) {
    if (!entry.category?.trim()) throw new Error(`Skill-Einstieg ${entry.id} braucht category.`);
    const cards = groups.get(entry.category) ?? [];
    cards.push(entry);
    groups.set(entry.category, cards);
  }
  const result = [...groups].map(([label, entries]) => ({ label, entries }));
  const launches = sorted.filter((entry) => entry.action !== "skill");
  if (launches.length) result.push({ label: "Vorbereitete Abläufe", entries: launches });
  return result;
}
