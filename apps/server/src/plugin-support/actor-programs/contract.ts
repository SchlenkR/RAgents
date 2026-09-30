import { Type } from "typebox";
import { defineOperation } from "@ragents/engine/src/rpc/contract";
import { openJson } from "@ragents/engine/src/http/contracts";

export const ACTOR_PROGRAMS_STATE_ID = "ragents.actor-programs";
export const ACTOR_INVOCATIONS_STATE_ID = "ragents.actor-programs.invocations";
export const ACTOR_SCRIPT_STATE_ID = "ragents.actor-programs.script";
export const ACTOR_STATE_ID = "ragents.actor-state";

export interface ActorViewDefinition {
  id: string;
  key: string;
  title: string;
  visible: boolean;
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
/** A start that its program received and has not finished yet. */
export interface ActorScriptOpenStart { readonly count: number; readonly startedBy: string; }
/** Where the host took a package from: a run script's template or a plugin's shared packages. */
export type ActorPackageOrigin = { readonly kind: "script"; readonly entryId: string } | { readonly kind: "shared"; readonly pluginId: string };
/** identity is the packageIdentity of the sources the host installed; a program whose sources differ is no longer this origin's. */
export interface ActorScriptPackage { readonly origin: ActorPackageOrigin; readonly identity: string; readonly count: number; readonly open: readonly ActorScriptOpenStart[]; }
/** An input the host queues for a program to recognize, keyed by the command that queues it: a start, or the result of a start for its starter. */
export type ActorScriptDelivery = { readonly commandId: string; readonly actorId: string } & (
  | { readonly kind: "start"; readonly name: string; readonly count: number; readonly embedded: boolean; readonly startedBy: string }
  | { readonly kind: "result" });
/** Who an active program is, for plugins that authorize by it: a shared package, a run script's package, or a package created in the run. */
export type ActorProgramOrigin = ActorPackageOrigin | { readonly kind: "run"; readonly installedBy: string };
export interface ActorProgramIdentity { readonly name: string; readonly actorId: string; readonly revision: string; readonly origin: ActorProgramOrigin; }
export interface ActorScriptState {
  readonly version: 2;
  readonly packages: Readonly<Record<string, ActorScriptPackage>>;
  readonly deliveries: readonly ActorScriptDelivery[];
}

export const resolveActorView = (programs: readonly ActorProgramDefinition[], reference: string) => {
  const normalized = reference.trim().toLowerCase();
  const views = programs.flatMap((program) => program.views.map((view) => ({ program, view })));
  const named = views.filter(({ program, view }) => [view.id, `${program.name}/${view.key}`, `@${program.actorHandle}/${view.key}`]
    .some((name) => name.toLowerCase() === normalized));
  const matches = named.length > 0 ? named : views.filter(({ view }) => view.title.toLowerCase() === normalized);
  const names = (entries: typeof views) => entries.map(({ program, view }) => `${program.name}/${view.key} (@${program.actorHandle}/${view.key})`).join(", ") || "none";
  if (matches.length === 0) {
    throw new Error(`${reference} is not an active actor view of this run. Activate the program first. Available: ${names(views)}`);
  }
  if (matches.length > 1) throw new Error(`${reference} is ambiguous. Use a unique name: ${names(matches)}`);
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

const runId = Type.String({ pattern: "^[A-Za-z0-9_-]{1,64}$", description: "Identifier of the run" });
const viewId = Type.String({ pattern: "^[a-z][a-z0-9_-]{0,129}$", description: "Identifier of the actor view or the program" });
const actorHandle = Type.String({ pattern: "^[a-z][a-z0-9-]{0,63}$", description: "Handle of the actor without @" });
const functionId = Type.String({ pattern: "^[a-zA-Z][a-zA-Z0-9_-]{0,63}$", description: "Identifier of the function" });
const invocationId = Type.String({ pattern: "^[A-Za-z0-9_-]{1,100}$", description: "Identifier of the function call" });
const revision = Type.String({ pattern: "^[a-f0-9]{64}$", description: "Revision of the active actor package" });
const requestId = Type.String({ minLength: 1, maxLength: 200, description: "The caller's own identifier; repeated calls return the same call" });
const functionInput = Type.Unknown({ description: "Input of the function according to its own schema" });

const invocationSchema = openJson<ActorFunctionInvocation>("ActorFunctionInvocation");

export const actorProgramContracts = {
  apps: defineOperation({
    id: "ragents.actor-programs.apps",
    description: "The actor views of a run with state and calls; the tool list stays empty without runs.inspect.",
    rights: ["runs.read"],
    input: Type.Object({ runId }, { additionalProperties: false }),
    result: Type.Object({
      apps: Type.Array(openJson<ActorViewListing>("ActorViewListing")),
      tools: Type.Array(openJson<ActorLocalTool>("ActorLocalTool")),
    }, { additionalProperties: false }),
  }),
  source: defineOperation({
    id: "ragents.actor-programs.source",
    description: "Read the source code of an actor program.",
    rights: ["runs.read", "runs.inspect"],
    input: Type.Object({ runId, moduleId: viewId }, { additionalProperties: false }),
    result: Type.Object({
      files: Type.Array(Type.Object({ path: Type.String({ minLength: 1 }), content: Type.String() }, { additionalProperties: false })),
    }, { additionalProperties: false }),
  }),
  action: defineOperation({
    id: "ragents.actor-programs.action",
    description: "Start a function of an actor view; the response is the queued call.",
    rights: ["runs.read", "runs.write"],
    input: Type.Object({ runId, appId: viewId, revision, actionId: functionId, requestId, input: functionInput }, { additionalProperties: false }),
    result: invocationSchema,
  }),
  invocation: defineOperation({
    id: "ragents.actor-programs.invocation",
    description: "Read the state of a call of an actor view.",
    rights: ["runs.read"],
    input: Type.Object({ runId, appId: viewId, invocationId }, { additionalProperties: false }),
    result: invocationSchema,
  }),
  function: defineOperation({
    id: "ragents.actor-programs.function",
    description: "Start a function of an actor independently of its views.",
    rights: ["runs.read", "runs.write", "runs.inspect"],
    input: Type.Object({ runId, actorHandle, revision, functionId, requestId, input: functionInput }, { additionalProperties: false }),
    result: invocationSchema,
  }),
  functionInvocation: defineOperation({
    id: "ragents.actor-programs.function-invocation",
    description: "Read the state of a call of an actor function.",
    rights: ["runs.read", "runs.inspect"],
    input: Type.Object({ runId, actorHandle, invocationId }, { additionalProperties: false }),
    result: invocationSchema,
  }),
} as const;
