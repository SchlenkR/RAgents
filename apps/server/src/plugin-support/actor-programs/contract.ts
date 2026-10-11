import { Type, type Static } from "typebox";
import { defineOperation } from "@ragents/engine/src/rpc/contract";
import { actorAddressPattern, openJson } from "@ragents/engine/src/http/contracts";
import type { JsonValue } from "@ragents/engine/src/domain/json";

export const ACTOR_PROGRAMS_STATE_ID = "ragents.actor-programs";
export const ACTOR_INVOCATIONS_STATE_ID = "ragents.actor-programs.invocations";
export const ACTOR_SCRIPT_STATE_ID = "ragents.actor-programs.script";
export const ACTOR_TRIGGERS_STATE_ID = "ragents.actor-programs.triggers";
export const ACTOR_STATE_ID = "ragents.actor-state";

const clockTime = Type.String({ pattern: "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$" });
const timeZone = Type.Optional(Type.String({ minLength: 1, maxLength: 128 }));
const serverFolders = Type.Array(Type.String({ minLength: 1, maxLength: 512 }), { maxItems: 16, uniqueItems: true });
export const appTriggersSchema = Type.Object({
  interval: Type.Optional(Type.Object({ everySeconds: Type.Integer({ minimum: 60, maximum: 604800 }) }, { additionalProperties: false })),
  daily: Type.Optional(Type.Object({ at: clockTime, timeZone }, { additionalProperties: false })),
  weekly: Type.Optional(Type.Object({
    at: clockTime,
    days: Type.Array(Type.Union([Type.Literal("mon"), Type.Literal("tue"), Type.Literal("wed"), Type.Literal("thu"), Type.Literal("fri"), Type.Literal("sat"), Type.Literal("sun")]), { minItems: 1, maxItems: 7, uniqueItems: true }),
    timeZone,
  }, { additionalProperties: false })),
  fileChange: Type.Optional(Type.Object({ folders: serverFolders }, { additionalProperties: false })),
  timeoutSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 300 })),
}, { additionalProperties: false });
export type AppTriggers = Static<typeof appTriggersSchema>;
export const appPermissionsSchema = Type.Object({
  files: Type.Optional(Type.Object({ read: Type.Optional(serverFolders), write: Type.Optional(serverFolders) }, { additionalProperties: false })),
  http: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 512 }), { maxItems: 16, uniqueItems: true })),
}, { additionalProperties: false });
export type AppPermissions = Static<typeof appPermissionsSchema>;

/** A view ID is room.package--view, three names of at most 64 characters each. */
export const ACTOR_VIEW_ID_MAX_LENGTH = 195;

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
/** name is the package key and actorHandle the actor's address, both as the main room writes them: room.name in a room. */
export interface ActorProgramDefinition {
  name: string;
  title: string;
  description: string;
  actorId: string;
  actorHandle: string;
  revision: string;
  installedBy: string;
  /** The room the declared tool targets resolve from, the activating caller's; an activation before it was recorded reads from the package's room. */
  targetRoom?: string | null;
  directory: string;
  sourceDirectory: string;
  backendFile?: string;
  readonly isolated?: boolean;
  readonly capabilitiesAsActor?: boolean;
  /** Canonical, with explicit time zones and real folder paths, as activation granted them. */
  readonly triggers?: AppTriggers;
  readonly permissions?: AppPermissions;
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

/** A package key or an actor address as an actor in `room` writes it: its own room's without the room. */
export const relativeName = (name: string, room: string | null): string =>
  room !== null && name.startsWith(`${room}.`) ? name.slice(room.length + 1) : name;

/** Resolves a view as an actor in `room` names it: package/view relative to the package's room, @actor/view relative to the actor's room, either absolute, the view ID, or a unique title. */
export const resolveActorView = (programs: readonly ActorProgramDefinition[], reference: string, room: string | null = null) => {
  const normalized = reference.trim().toLowerCase();
  const views = programs.flatMap((program) => program.views.map((view) => ({ program, view })));
  const inRoom = (name: string) => room !== null && name.startsWith(`${room}.`);
  const nameOf = (program: ActorProgramDefinition) => relativeName(program.name, room);
  const actorOf = (program: ActorProgramDefinition) => relativeName(program.actorHandle, room);
  const named = (forms: (program: ActorProgramDefinition, view: ActorViewDefinition) => string[]) =>
    views.filter(({ program, view }) => forms(program, view).some((name) => name.toLowerCase() === normalized));
  const relative = named((program, view) => [
    ...inRoom(program.name) ? [`${nameOf(program)}/${view.key}`] : [],
    ...inRoom(program.actorHandle) ? [`@${actorOf(program)}/${view.key}`] : [],
  ]);
  const matched = relative.length > 0 ? relative : named((program, view) => [view.id, `${program.name}/${view.key}`, `@${program.actorHandle}/${view.key}`]);
  const matches = matched.length > 0 ? matched : views.filter(({ view }) => view.title.toLowerCase() === normalized);
  const names = (entries: typeof views) => entries.map(({ program, view }) => `${nameOf(program)}/${view.key} (@${actorOf(program)}/${view.key})`).join(", ") || "none";
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

export type ActorTriggerReason = "manual" | "interval" | "daily" | "weekly" | "file-change";
export type ActorTriggerResult = { readonly outcome: "completed" | "failed" | "interrupted" | "timeout"; readonly at: string; readonly summary: string };
/** Where a program's triggers stand; blocked names its problem. */
export type ActorTriggerProgress = {
  readonly paused: boolean;
  readonly status: "ready" | "queued" | "running" | "paused" | "blocked";
  readonly lastRunAt: string | null;
  readonly nextRunAt: string | null;
  readonly lastResult: ActorTriggerResult | null;
  readonly problem: string | null;
};
export type ActorProgramLogLine = { readonly at: string; readonly level: "info" | "error"; readonly text: string };
/** sandbox is null for a program without package isolation. */
export type ActorProgramStatus = ActorTriggerProgress & {
  readonly triggers: AppTriggers;
  readonly permissions: AppPermissions;
  readonly sandbox: "process" | "disabled" | null;
  readonly state: JsonValue;
  readonly log: ActorProgramLogLine[];
  readonly droppedLogLines: number;
};

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
const viewId = Type.String({ pattern: `^[a-z][a-z0-9_.-]{0,${ACTOR_VIEW_ID_MAX_LENGTH - 1}}$`, description: "Identifier of the actor view or the program" });
const actorHandle = Type.String({ pattern: actorAddressPattern.source, description: "Address of the actor without @: room.handle in a room, the handle in the main room or a dotted handle of an older journal" });
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
    input: Type.Object({ runId, actorId: Type.Optional(Type.String({ minLength: 1 })) }, { additionalProperties: false }),
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
  trigger: defineOperation({
    id: "ragents.actor-programs.trigger",
    description: "Queue one manual trigger input for an actor's program, also while its triggers are paused.",
    rights: ["runs.read", "runs.write"],
    input: Type.Object({ runId, actorId: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
    result: Type.Object({ accepted: Type.Literal(true) }, { additionalProperties: false }),
  }),
  pause: defineOperation({
    id: "ragents.actor-programs.pause",
    description: "Pause or resume a program's automatic triggers; resuming also clears a problem that blocks them.",
    rights: ["runs.read", "runs.write"],
    input: Type.Object({ runId, actorId: Type.String({ minLength: 1 }), paused: Type.Boolean() }, { additionalProperties: false }),
    result: Type.Object({ nextRunAt: Type.Union([Type.String(), Type.Null()]) }, { additionalProperties: false }),
  }),
  status: defineOperation({
    id: "ragents.actor-programs.status",
    description: "A program's triggers, permissions, trigger progress, state and recent input log.",
    rights: ["runs.read"],
    input: Type.Object({ runId, actorId: Type.String({ minLength: 1 }), logLimit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) }, { additionalProperties: false }),
    result: openJson<ActorProgramStatus>("ActorProgramStatus"),
  }),
} as const;
