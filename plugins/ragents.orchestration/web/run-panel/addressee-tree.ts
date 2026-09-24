import { chatPrimaryId, type RunActor, type RunView } from "@ragents/web/run-view";

export interface AddresseeActorNode {
  kind: "actor";
  actor: RunActor;
  children: AddresseeNode[];
}

export interface AddresseeGroupNode {
  kind: "group";
  key: string;
  label: string;
  members: AddresseeActorNode[];
}

export type AddresseeNode = AddresseeActorNode | AddresseeGroupNode;

export type AddresseeStatus = "running" | "input" | "waiting" | "stopped";

/** Ab so vielen gleichartigen Geschwistern fasst der Baum sie zu einer Gruppe zusammen. */
export const ADDRESSEE_GROUP_MIN = 4;
/** Erst bei mehr Einträgen erscheint die Suche. */
export const ADDRESSEE_SEARCH_ABOVE = 12;
const SUMMARY_LENGTH = 90;

const STATUS_WORDS: Readonly<Record<AddresseeStatus, readonly [one: string, many: string]>> = {
  running: ["arbeitet", "arbeiten"],
  input: ["wartet auf Eingabe", "warten auf Eingabe"],
  waiting: ["wartet", "warten"],
  stopped: ["gestoppt", "gestoppt"],
};
const STATUS_ORDER: readonly AddresseeStatus[] = ["running", "input", "waiting", "stopped"];

const lower = (text: string) => text.toLocaleLowerCase("de-DE");

const shortened = (text: string): string => {
  const line = text.split("\n").map((entry) => entry.replace(/\s+/g, " ").trim()).find((entry) => entry !== "") ?? "";
  if (line.length <= SUMMARY_LENGTH) return line;
  const cut = line.slice(0, SUMMARY_LENGTH - 3);
  const space = cut.lastIndexOf(" ");
  return `${(space > SUMMARY_LENGTH / 2 ? cut.slice(0, space) : cut).trimEnd()}...`;
};

export const addresseeStatus = (view: RunView, actor: RunActor): AddresseeStatus =>
  actor.lifecycle?.kind === "stopped" ? "stopped"
    : view.actions.some((action) => action.status === "pending" && action.askedBy === actor.id) ? "input"
      : actor.lifecycle?.kind === "running" ? "running" : "waiting";

export const addresseeStatusWord = (status: AddresseeStatus, count = 1): string => STATUS_WORDS[status][count === 1 ? 0 : 1];

/** Zählt die Zustände einer Gruppe in fester Reihenfolge, etwa "3 arbeiten, 34 warten". */
export const addresseeStatusCounts = (view: RunView, actors: readonly RunActor[]): string => {
  const counts = new Map<AddresseeStatus, number>();
  for (const status of actors.map((actor) => addresseeStatus(view, actor))) counts.set(status, (counts.get(status) ?? 0) + 1);
  return STATUS_ORDER.flatMap((status) => {
    const count = counts.get(status) ?? 0;
    return count > 0 ? [`${count} ${addresseeStatusWord(status, count)}`] : [];
  }).join(", ");
};

/** Die Kurzbeschreibung je Actor: die beim Erzeugen gesetzte, sonst der gekürzte erste Auftrag, sonst ein abweichender Anzeigename. */
export const addresseeSummaries = (view: RunView): ((actor: RunActor) => string | undefined) => {
  const firstInputs = new Map<string, { sequence: number; content: string }>();
  for (const input of view.inputs) {
    if (input.subscriptionId !== null || input.presentation === "background" || input.content.trim() === "") continue;
    const known = firstInputs.get(input.actorId);
    if (!known || input.sequence < known.sequence) firstInputs.set(input.actorId, { sequence: input.sequence, content: input.content });
  }
  return (actor) => {
    const described = actor.description?.trim();
    if (described) return described;
    const first = firstInputs.get(actor.id);
    if (first) return shortened(first.content);
    const name = actor.displayName.trim();
    return name !== "" && lower(name) !== lower(actor.handle) ? name : undefined;
  };
};

/** Der nächste Erzeuger nach `createdBy`, der selbst im Baum steht; ein Mensch oder ein unbekannter Erzeuger macht den Actor zur Wurzel. */
export const addresseeParentId = (byId: ReadonlyMap<string, RunActor>, included: ReadonlySet<string>, actor: RunActor): string | null => {
  const visited = new Set([actor.id]);
  let current = actor.createdBy;
  while (current !== undefined && !visited.has(current)) {
    if (included.has(current)) return current;
    const creator = byId.get(current);
    if (!creator || creator.kind === "human") return null;
    visited.add(current);
    current = creator.createdBy;
  }
  return null;
};

const handleStem = (handle: string) => lower(handle).replace(/-\d+$/, "").split(/[-_.]/)[0] ?? "";

const groupLabel = (handles: readonly string[]): string => {
  const first = handles[0] ?? "";
  const length = handles.reduce((common, handle) => {
    let index = 0;
    while (index < common && handle[index] === first[index]) index += 1;
    return index;
  }, first.length);
  const prefix = first.slice(0, length);
  const cut = prefix.search(/[-_.][^-_.]*$/);
  const stem = /[-_.]$/.test(prefix) || handles.includes(prefix) || cut < 0 ? prefix : prefix.slice(0, cut + 1);
  return `@${stem}*`;
};

/** Wer hat wen erzeugt: Koordinator oben, Unteragenten darunter, gleichartige Geschwister (Art und Handle-Stamm) als Gruppe. */
export const addresseeTree = (view: RunView, actors: readonly RunActor[]): AddresseeNode[] => {
  const byId = new Map(view.actors.map((actor) => [actor.id, actor]));
  const included = new Set(actors.map((actor) => actor.id));
  const primaryId = chatPrimaryId(view);
  const siblings = new Map<string | null, RunActor[]>();
  for (const actor of actors) {
    const parent = addresseeParentId(byId, included, actor);
    siblings.set(parent, [...siblings.get(parent) ?? [], actor]);
  }
  const branch = (actor: RunActor): AddresseeActorNode => ({ kind: "actor", actor, children: level(actor.id) });
  const level = (parentId: string | null): AddresseeNode[] => {
    const entries = siblings.get(parentId) ?? [];
    const ordered = parentId === null ? [...entries.filter((actor) => actor.id === primaryId), ...entries.filter((actor) => actor.id !== primaryId)] : entries;
    const keyOf = (actor: RunActor) => actor.id === primaryId ? null : `${parentId ?? ""}/${actor.kind}/${handleStem(actor.handle)}`;
    const members = new Map<string, RunActor[]>();
    for (const actor of ordered) {
      const key = keyOf(actor);
      if (key !== null) members.set(key, [...members.get(key) ?? [], actor]);
    }
    const emitted = new Set<string>();
    return ordered.flatMap((actor): AddresseeNode[] => {
      const key = keyOf(actor);
      const group = key === null ? undefined : members.get(key);
      if (key === null || !group || group.length < ADDRESSEE_GROUP_MIN) return [branch(actor)];
      if (emitted.has(key)) return [];
      emitted.add(key);
      return [{ kind: "group", key, label: groupLabel(group.map((member) => member.handle)), members: group.map(branch) }];
    });
  };
  return level(null);
};

/** Die Actors, die zur Suche passen, samt ihren Erzeugern im Baum, damit jeder Treffer an seinem Platz steht. */
export const addresseeMatches = (view: RunView, actors: readonly RunActor[], query: string, summary: (actor: RunActor) => string | undefined): RunActor[] => {
  const words = lower(query).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...actors];
  const byId = new Map(view.actors.map((actor) => [actor.id, actor]));
  const included = new Set(actors.map((actor) => actor.id));
  const kept = new Set<string>();
  for (const actor of actors) {
    const text = lower(`@${actor.handle} ${actor.displayName} ${summary(actor) ?? ""}`);
    if (!words.every((word) => text.includes(word))) continue;
    let current: RunActor | undefined = actor;
    while (current && !kept.has(current.id)) {
      kept.add(current.id);
      const parentId = addresseeParentId(byId, included, current);
      current = parentId === null ? undefined : byId.get(parentId);
    }
  }
  return actors.filter((actor) => kept.has(actor.id));
};

/** Ob ein Actor in einem Zweig steckt, etwa damit eine Gruppe mit dem gewählten Actor offen startet. */
export const addresseeNodeContains = (node: AddresseeNode, actorId: string): boolean =>
  node.kind === "actor"
    ? node.actor.id === actorId || node.children.some((child) => addresseeNodeContains(child, actorId))
    : node.members.some((member) => addresseeNodeContains(member, actorId));
