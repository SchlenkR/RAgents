export const ACTOR_PROGRAMS_STATE_ID = "ragents.actor-programs";
export const ACTOR_INVOCATIONS_STATE_ID = "ragents.actor-programs.invocations";
export const ACTOR_SCRIPT_STATE_ID = "ragents.actor-programs.script";
export const ACTOR_STATE_ID = "ragents.actor-state";

export interface ActorViewPlacement { kind: "canvas"; anchorActorId: string; width: number; height: number; }
export interface ActorViewDefinition {
  id: string;
  key: string;
  title: string;
  visible: boolean;
  placements: ActorViewPlacement[];
  html: string;
  styles: string;
  clientFile: string;
}
export interface ActorFunctionDefinition {
  id: string;
  label: string;
  description: string;
  inputSchema: object;
  resultSchema: object;
  capabilityIds: string[];
  capabilityContractHash: string;
  confirmation: string | null;
  tool?: { name: string; targets: string[] | null; card: boolean };
}
export interface ActorProgramDefinition {
  name: string;
  title: string;
  description: string;
  actorId: string;
  actorHandle: string;
  revision: string;
  installedBy: string;
  directory: string;
  sourceDirectory: string;
  backendFile?: string;
  stateSchema: object;
  stylesFile: string;
  functions: ActorFunctionDefinition[];
  input?: { capabilityIds: string[]; capabilityContractHash: string };
  views: ActorViewDefinition[];
}
export interface ActorProgramState { version: 1; program: ActorProgramDefinition | null; }
export interface ActorScriptState { version: 1; entryId: string; }

export const resolveActorView = (programs: readonly ActorProgramDefinition[], reference: string) => {
  const normalized = reference.trim().toLowerCase();
  const views = programs.flatMap((program) => program.views.map((view) => ({ program, view })));
  const named = views.filter(({ program, view }) => [view.id, `${program.name}/${view.key}`, `@${program.actorHandle}/${view.key}`]
    .some((name) => name.toLowerCase() === normalized));
  const matches = named.length > 0 ? named : views.filter(({ view }) => view.title.toLowerCase() === normalized);
  const names = (entries: typeof views) => entries.map(({ program, view }) => `${program.name}/${view.key} (@${program.actorHandle}/${view.key})`).join(", ") || "keine";
  if (matches.length === 0) {
    throw new Error(`${reference} ist keine aktive Actor-Ansicht dieses Laufs. Zuerst das Programm aktivieren. Vorhanden: ${names(views)}`);
  }
  if (matches.length > 1) throw new Error(`${reference} ist mehrdeutig. Verwende einen eindeutigen Namen: ${names(matches)}`);
  return matches[0]!;
};

export interface ActorDataState { version: 1; revision: number; values: Record<string, unknown>; }
interface InvocationBase {
  id: string;
  requestId: string;
  actorId: string;
  actorHandle: string;
  appId: string;
  revision: string;
  actionId: string;
  input: unknown;
  output: string[];
  createdAt: string;
}
export type ActorFunctionInvocation = InvocationBase & (
  | { status: "queued" }
  | { status: "running"; startedAt: string }
  | { status: "succeeded"; startedAt: string; finishedAt: string; result: unknown }
  | { status: "failed" | "cancelled"; startedAt?: string; finishedAt: string; error: string }
);
export interface ActorViewListing {
  id: string;
  actorId: string;
  actorHandle: string;
  title: string;
  description: string;
  revision: string;
  actions: { id: string; label: string; description: string; confirmation: string | null }[];
  placements: ActorViewPlacement[];
  visible: boolean;
  state: ActorDataState;
  invocations: ActorFunctionInvocation[];
}
