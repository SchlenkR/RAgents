import { Type } from "typebox";
import { defineOperation } from "@aicontainer/ragents/src/rpc/contract";
import { openJson } from "@aicontainer/ragents/src/http/contracts";

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

export interface ActorLocalToolParameter {
  name: string;
  type: string;
  description: string;
  required: boolean;
}

export interface ActorLocalTool {
  moduleId: string;
  name: string;
  description: string;
  card: boolean;
  actorId: string;
  actorHandle: string;
  functionId: string;
  revision: string;
  sourceHash: string;
  installedBy: string;
  parameters: ActorLocalToolParameter[];
  targets: { actorId: string; handle: string | null }[];
}

const runId = Type.String({ pattern: "^[A-Za-z0-9_-]{1,64}$", description: "Kennung des Runs" });
const viewId = Type.String({ pattern: "^[a-z][a-z0-9_-]{0,129}$", description: "Kennung der Actor-Ansicht oder des Programms" });
const actorHandle = Type.String({ pattern: "^[a-z][a-z0-9-]{0,63}$", description: "Handle des Actors ohne @" });
const functionId = Type.String({ pattern: "^[a-zA-Z][a-zA-Z0-9_-]{0,63}$", description: "Kennung der Funktion" });
const invocationId = Type.String({ pattern: "^[A-Za-z0-9_-]{1,100}$", description: "Kennung des Funktionsaufrufs" });
const revision = Type.String({ pattern: "^[a-f0-9]{64}$", description: "Revision des aktiven Actor-Pakets" });
const requestId = Type.String({ minLength: 1, maxLength: 200, description: "Eigene Kennung des Aufrufers; wiederholte Aufrufe liefern denselben Aufruf" });
const functionInput = Type.Unknown({ description: "Eingabe der Funktion nach ihrem eigenen Schema" });

const invocationSchema = openJson<ActorFunctionInvocation>("ActorFunctionInvocation");

export const actorProgramContracts = {
  apps: defineOperation({
    id: "ragents.actor-programs.apps",
    description: "Die Actor-Ansichten eines Runs mit Zustand und Aufrufen; die Werkzeugliste bleibt ohne runs.inspect leer.",
    rights: ["runs.read"],
    input: Type.Object({ runId }, { additionalProperties: false }),
    result: Type.Object({
      apps: Type.Array(openJson<ActorViewListing>("ActorViewListing")),
      tools: Type.Array(openJson<ActorLocalTool>("ActorLocalTool")),
    }, { additionalProperties: false }),
  }),
  source: defineOperation({
    id: "ragents.actor-programs.source",
    description: "Den Quellcode eines Actor-Programms lesen.",
    rights: ["runs.read", "runs.inspect"],
    input: Type.Object({ runId, moduleId: viewId }, { additionalProperties: false }),
    result: Type.Object({
      files: Type.Array(Type.Object({ path: Type.String({ minLength: 1 }), content: Type.String() }, { additionalProperties: false })),
    }, { additionalProperties: false }),
  }),
  action: defineOperation({
    id: "ragents.actor-programs.action",
    description: "Eine Funktion einer Actor-Ansicht starten; die Antwort ist der eingereihte Aufruf.",
    rights: ["runs.read", "runs.write"],
    input: Type.Object({ runId, appId: viewId, revision, actionId: functionId, requestId, input: functionInput }, { additionalProperties: false }),
    result: invocationSchema,
  }),
  invocation: defineOperation({
    id: "ragents.actor-programs.invocation",
    description: "Den Stand eines Aufrufs einer Actor-Ansicht lesen.",
    rights: ["runs.read"],
    input: Type.Object({ runId, appId: viewId, invocationId }, { additionalProperties: false }),
    result: invocationSchema,
  }),
  function: defineOperation({
    id: "ragents.actor-programs.function",
    description: "Eine Funktion eines Actors unabhängig von seinen Ansichten starten.",
    rights: ["runs.read", "runs.write", "runs.inspect"],
    input: Type.Object({ runId, actorHandle, revision, functionId, requestId, input: functionInput }, { additionalProperties: false }),
    result: invocationSchema,
  }),
  functionInvocation: defineOperation({
    id: "ragents.actor-programs.function-invocation",
    description: "Den Stand eines Aufrufs einer Actor-Funktion lesen.",
    rights: ["runs.read", "runs.inspect"],
    input: Type.Object({ runId, actorHandle, invocationId }, { additionalProperties: false }),
    result: invocationSchema,
  }),
} as const;
