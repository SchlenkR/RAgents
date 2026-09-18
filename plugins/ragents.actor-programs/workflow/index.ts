export type WorkflowStatus = "pending" | "active" | "done" | "blocked";
export interface WorkflowItem {
  label: string;
  status?: WorkflowStatus | "skipped";
  detail?: string;
}
export interface WorkflowDefinition {
  id: string;
  title: string;
  roles: Readonly<Record<string, { title: string; prompt?: string }>>;
  steps: readonly {
    id: string;
    title: string;
    role: string;
    goal: string;
    prompt?: string;
    completion: { source: "agent" | "service" | "operator"; description: string };
    freedom: { mode: "fixed" | "extend"; description: string; allowSkip?: boolean; maxItems?: number };
    expansion?: { source: string; role: string; mode: "parallel"; maxConcurrent: number };
  }[];
  transitions: readonly { from: string; to: string; condition?: string; kind?: "return" }[];
}
export interface WorkflowStepState {
  status: WorkflowStatus;
  detail?: string;
  items?: readonly WorkflowItem[];
}
export interface WorkflowState {
  steps: Readonly<Record<string, WorkflowStepState>>;
  expansions?: Readonly<Record<string, readonly {
    id: string;
    title: string;
    status?: WorkflowStatus;
    detail?: string;
    items: readonly WorkflowItem[];
  }[]>>;
}
export interface WorkflowGraph {
  nodes: { id: string; label: string; detail?: string; status: WorkflowStatus; kind: "actor" | "agent" | "service"; items?: readonly WorkflowItem[] }[];
  edges: { id: string; source: string; target: string; label?: string; kind?: "return" }[];
}

function text(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} muss ein nicht leerer Text sein.`);
}
function object(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} muss ein Objekt sein.`);
}
function positiveInteger(value: unknown, name: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new Error(`${name} muss eine positive ganze Zahl sein.`);
}
function optionalText(value: unknown, name: string) {
  if (value !== undefined && typeof value !== "string") throw new Error(`${name} muss Text sein.`);
}
export function validatePromptReference(value: unknown) {
  text(value, "Promptreferenz");
  if (!/^[^\\/:]+(?:\/[^\\/:]+)*\.(?:md|hbs)$/.test(value) || value.split("/").some(part => part === "." || part === "..") || /[\x00-\x1f?#]/.test(value)) {
    throw new Error(`Promptreferenz muss eine relative .md- oder .hbs-Datei innerhalb des Pakets sein: ${value}`);
  }
}
function has(object: object, key: string) { return Object.prototype.hasOwnProperty.call(object, key); }

export function defineWorkflow<const Definition extends WorkflowDefinition>(definition: Definition): Definition {
  object(definition, "Workflow");
  text(definition.id, "Workflow-ID");
  text(definition.title, "Workflowtitel");
  object(definition.roles, "Rollen");
  if (Object.keys(definition.roles).length === 0) throw new Error("Ein Workflow benötigt Rollen.");
  for (const [id, role] of Object.entries(definition.roles)) {
    text(id, "Rollen-ID"); object(role, "Rolle"); text(role.title, "Rollentitel"); if (role.prompt !== undefined) validatePromptReference(role.prompt);
  }
  if (!Array.isArray(definition.steps) || definition.steps.length === 0) throw new Error("Ein Workflow benötigt Schritte.");
  const ids = new Set<string>();
  for (const step of definition.steps) {
    object(step, "Schritt"); text(step.id, "Schritt-ID"); text(step.title, "Schritttitel"); text(step.goal, "Schrittziel"); text(step.role, "Schrittrolle");
    if (ids.has(step.id)) throw new Error(`Doppelte Schritt-ID: ${step.id}`);
    ids.add(step.id);
    if (!has(definition.roles, step.role)) throw new Error(`Unbekannte Rolle: ${step.role}`);
    if (step.prompt !== undefined) validatePromptReference(step.prompt);
    object(step.completion, "Abschluss"); text(step.completion.source, "Abschlussquelle"); text(step.completion.description, "Abschlussbeschreibung");
    if (!["agent", "service", "operator"].includes(step.completion.source)) throw new Error(`Unbekannte Abschlussquelle: ${step.id}`);
    object(step.freedom, "Freiheitsgrad"); text(step.freedom.mode, "Freiheitsgradmodus"); text(step.freedom.description, "Freiheitsgradbeschreibung");
    if (!["fixed", "extend"].includes(step.freedom.mode)) throw new Error(`Unbekannter Freiheitsgrad: ${step.id}`);
    if (step.freedom.allowSkip !== undefined && typeof step.freedom.allowSkip !== "boolean") throw new Error("allowSkip muss ein Wahrheitswert sein.");
    if (step.freedom.maxItems !== undefined) positiveInteger(step.freedom.maxItems, "maxItems");
    if (step.expansion !== undefined) {
      object(step.expansion, "Erweiterung"); text(step.expansion.source, "Erweiterungsquelle"); text(step.expansion.role, "Erweiterungsrolle");
      if (!has(definition.roles, step.expansion.role)) throw new Error(`Unbekannte Erweiterungsrolle: ${step.expansion.role}`);
      if (step.expansion.mode !== "parallel") throw new Error("Erweiterungen müssen den Modus parallel verwenden.");
      positiveInteger(step.expansion.maxConcurrent, "maxConcurrent");
    }
  }
  if (!Array.isArray(definition.transitions)) throw new Error("Übergänge müssen eine Liste sein.");
  const outgoing = new Map([...ids].map(id => [id, [] as string[]]));
  const transitions = new Set<string>();
  for (const transition of definition.transitions) {
    object(transition, "Übergang"); text(transition.from, "Übergangsquelle"); text(transition.to, "Übergangsziel");
    if (!ids.has(transition.from) || !ids.has(transition.to)) throw new Error("Ein Übergang verweist auf einen unbekannten Schritt.");
    optionalText(transition.condition, "Übergangsbedingung");
    if (transition.kind !== undefined && transition.kind !== "return") throw new Error("Unbekannte Übergangsart.");
    const key = JSON.stringify([transition.from, transition.to, transition.kind, transition.condition]);
    if (transitions.has(key)) throw new Error("Doppelter Übergang.");
    transitions.add(key);
    if (transition.kind !== "return") outgoing.get(transition.from)!.push(transition.to);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error("Normale Übergänge müssen azyklisch sein; Rückwege benötigen kind: return.");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const next of outgoing.get(id)!) visit(next);
    visiting.delete(id); visited.add(id);
  };
  for (const id of ids) visit(id);
  return definition;
}

export async function workflowInstructions(definition: WorkflowDefinition, role: string, readPrompt: (reference: string) => Promise<string>): Promise<string> {
  defineWorkflow(definition);
  if (!has(definition.roles, role)) throw new Error(`Unbekannte Rolle: ${role}`);
  const owned = definition.steps.filter(step => step.role === role);
  const selectedRole = definition.roles[role]!;
  const load = async (reference: string) => {
    const content = await readPrompt(reference);
    text(content, `Prompt ${reference}`);
    return content;
  };
  const lines = [`# ${definition.title}`, `Rolle: ${selectedRole.title} (${role})`];
  if (selectedRole.prompt !== undefined) lines.push(await load(selectedRole.prompt));
  lines.push("## Ablauf", ...definition.steps.map(step => `- ${step.id}: ${step.title}; zuständig: ${definition.roles[step.role]!.title}`));
  for (const step of owned) {
    lines.push(`## ${step.title} (${step.id})`, `Ziel: ${step.goal}`, `Abschluss durch ${step.completion.source}: ${step.completion.description}`,
      `Freiheitsgrad ${step.freedom.mode}: ${step.freedom.description}`, `Überspringen: ${step.freedom.allowSkip === true ? "nur für eigene optionale Punkte erlaubt, begründen; Pflichtschritte bleiben verbindlich" : "nicht erlaubt"}`);
    if (step.freedom.maxItems !== undefined) lines.push(`Höchstens ${step.freedom.maxItems} eigene Punkte.`);
    if (step.expansion) lines.push(`Parallele Erweiterung aus ${step.expansion.source}: Rolle ${step.expansion.role}, höchstens ${step.expansion.maxConcurrent} gleichzeitig.`);
    if (step.prompt !== undefined) lines.push(await load(step.prompt));
  }
  lines.push("## Übergänge", ...definition.transitions.map(transition => `${transition.from} -> ${transition.to}${transition.kind === "return" ? " (Rückweg)" : ""}${transition.condition ? `: ${transition.condition}` : ""}`));
  return lines.join("\n\n");
}

function status(value: unknown) {
  if (!["pending", "active", "done", "blocked"].includes(value as string)) throw new Error(`Unbekannter Schrittstatus: ${String(value)}`);
}
function items(value: unknown) {
  if (!Array.isArray(value)) throw new Error("Punkte müssen eine Liste sein.");
  for (const item of value) {
    object(item, "Punkt"); text(item.label, "Punktlabel"); optionalText(item.detail, "Punktdetail");
    if (item.status !== undefined && !["pending", "active", "done", "blocked", "skipped"].includes(item.status as string)) throw new Error("Unbekannter Punktstatus.");
  }
}

export function workflowGraph(definition: WorkflowDefinition, state: WorkflowState): WorkflowGraph {
  defineWorkflow(definition);
  object(state, "Workflowzustand"); object(state.steps, "Schrittzustände");
  const steps = new Map(definition.steps.map(step => [step.id, step]));
  for (const [id, step] of Object.entries(state.steps)) {
    if (!steps.has(id)) throw new Error(`Unbekannter Schrittzustand: ${id}`);
    object(step, "Schrittzustand"); status(step.status); optionalText(step.detail, "Schrittdetail");
    if (step.items !== undefined) items(step.items);
  }
  const sources = new Set(definition.steps.flatMap(step => step.expansion ? [step.expansion.source] : []));
  if (state.expansions !== undefined) object(state.expansions, "Erweiterungszustände");
  for (const source of Object.keys(state.expansions ?? {})) if (!sources.has(source)) throw new Error(`Unbekannte Erweiterungsquelle: ${source}`);
  for (const source of sources) {
    if (!state.expansions || !has(state.expansions, source)) throw new Error(`Erweiterungsquelle fehlt im Zustand: ${source}`);
    const groups = state.expansions[source]!;
    if (!Array.isArray(groups)) throw new Error(`Erweiterungsquelle ${source} muss eine Liste sein.`);
    const ids = new Set<string>();
    for (const group of groups) {
      object(group, "Erweiterungsgruppe"); text(group.id, "Gruppen-ID"); text(group.title, "Gruppentitel");
      if (ids.has(group.id)) throw new Error(`Doppelte Gruppen-ID: ${group.id}`);
      ids.add(group.id);
      if (group.status !== undefined) status(group.status);
      optionalText(group.detail, "Gruppendetail"); items(group.items);
    }
  }
  const graph: WorkflowGraph = { nodes: [], edges: [] };
  const groups = new Map<string, string[]>();
  const nodeIds = new Set(steps.keys());
  for (const step of definition.steps) {
    const snapshot = state.steps[step.id];
    graph.nodes.push({ id: step.id, label: step.title, status: snapshot?.status ?? "pending", kind: step.completion.source === "service" ? "service" : step.completion.source === "agent" ? "agent" : "actor", ...(snapshot?.detail === undefined ? {} : { detail: snapshot.detail }), ...(snapshot?.items === undefined ? {} : { items: snapshot.items }) });
    if (step.expansion) {
      const ids: string[] = [];
      for (const group of state.expansions![step.expansion.source]!) {
        const id = `expansion:${JSON.stringify([step.id, group.id])}`;
        if (nodeIds.has(id)) throw new Error(`Erweiterungs-ID kollidiert mit einem Knoten: ${id}`);
        nodeIds.add(id); ids.push(id);
        graph.nodes.push({ id, label: group.title, status: group.status ?? "pending", kind: "agent", items: group.items, ...(group.detail === undefined ? {} : { detail: group.detail }) });
        graph.edges.push({ id: `expansion:${JSON.stringify([step.id, group.id])}`, source: step.id, target: id });
      }
      groups.set(step.id, ids);
    }
  }
  definition.transitions.forEach((transition, index) => {
    const sourceIds = transition.kind === "return" || !groups.get(transition.from)?.length ? [transition.from] : groups.get(transition.from)!;
    for (const source of sourceIds) graph.edges.push({ id: `transition:${JSON.stringify([index, source])}`, source, target: transition.to, ...(transition.condition === undefined ? {} : { label: transition.condition }), ...(transition.kind === undefined ? {} : { kind: transition.kind }) });
  });
  return graph;
}
