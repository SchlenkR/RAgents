import { isRecord } from "@ragents/web/lib/guards";
import { rpc } from "@ragents/web/rpc";
import { withAccessToken } from "@ragents/web/access-token";
import { actorProgramContracts } from "@ragents/host/plugin-support/actor-programs/contract";
import {
  actorFunctionParameterTypes,
  type ActorFunctionParameterType,
} from "../parameter-types";
import { isJsonValue, type JsonValue } from "./bridge";

export type RunAppInvocationStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface RunAppAction {
  id: string;
  label: string;
  description?: string;
  confirmation: string | null;
}

export type RunAppPlacement = { kind: "canvas"; anchorActorId: string };

export type RunAppInvocation = {
  id: string;
  actorId: string;
  actorHandle: string;
  appId: string;
  actionId: string;
  revision: string;
  output: string[];
  createdAt: string;
  requestId: string;
} & (
  | { status: "queued" }
  | { status: "running"; startedAt: string }
  | { status: "succeeded"; startedAt: string; finishedAt: string; result: JsonValue }
  | { status: "failed" | "cancelled"; startedAt?: string; finishedAt: string; error: string }
);

export interface RunApp {
  id: string;
  actorId: string;
  actorHandle: string;
  visible?: boolean;
  title: string;
  description?: string;
  revision: string;
  actions: RunAppAction[];
  placements: RunAppPlacement[];
  state: { version: 1; revision: number; values: JsonValue };
  invocations: RunAppInvocation[];
}

export interface RunToolParameter {
  name: string;
  description: string;
  type: ActorFunctionParameterType;
  required: boolean;
}

export interface RunToolTarget {
  actorId: string;
  handle: string | null;
}

export interface RunScriptTool {
  actorId: string;
  actorHandle: string;
  functionId: string;
  revision: string;
  moduleId: string;
  name: string;
  description: string;
  parameters: RunToolParameter[];
  card: boolean;
  sourceHash: string;
  targets: RunToolTarget[];
  installedBy: string;
}

export interface ActorProgramSourceFile {
  path: string;
  content: string;
}

export interface ActorProgramsListing {
  apps: RunApp[];
  tools: RunScriptTool[];
}

export interface ActorProgramsApi {
  list: (runId: string, signal?: AbortSignal) => Promise<ActorProgramsListing>;
  source: (runId: string, moduleId: string, signal?: AbortSignal) => Promise<ActorProgramSourceFile[]>;
  frameUrl: (runId: string, appId: string, revision: string) => string;
  invoke: (
    runId: string,
    appId: string,
    revision: string,
    actionId: string,
    requestId: string,
    input: JsonValue,
    signal?: AbortSignal,
  ) => Promise<RunAppInvocation>;
  invocation: (runId: string, appId: string, invocationId: string, signal?: AbortSignal) => Promise<RunAppInvocation>;
  invokeFunction: (runId: string, actorHandle: string, revision: string, functionId: string, requestId: string, input: JsonValue, signal?: AbortSignal) => Promise<RunAppInvocation>;
  functionInvocation: (runId: string, actorHandle: string, invocationId: string, signal?: AbortSignal) => Promise<RunAppInvocation>;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const VIEW_ID_PATTERN = /^[A-Za-z0-9_-]{1,130}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const PARAMETER_TYPES = new Set<RunToolParameter["type"]>(actorFunctionParameterTypes);

const requiredString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is missing or empty`);
  return value;
};

const optionalString = (value: unknown, field: string): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${field} is not text`);
  return value;
};

const idFrom = (value: unknown, field: string): string => {
  const id = requiredString(value, field);
  if (!ID_PATTERN.test(id)) throw new Error(`${field} is not a valid identifier`);
  return id;
};

const unique = <T,>(values: T[], keyOf: (value: T) => string, label: string): T[] => {
  const ids = values.map(keyOf);
  if (new Set(ids).size !== ids.length) throw new Error(`${label} contains duplicate identifiers`);
  return values;
};

export const runAppActionFrom = (value: unknown): RunAppAction => {
  if (!isRecord(value)) throw new Error("An app action is not an object");
  if (value.confirmation !== null && typeof value.confirmation !== "string") {
    throw new Error("confirmation of an app action must be text or null");
  }
  if (typeof value.confirmation === "string" && !value.confirmation.trim()) {
    throw new Error("confirmation of an app action must not be empty");
  }
  return {
    id: idFrom(value.id, "action.id"),
    label: requiredString(value.label, "action.label"),
    ...(value.description !== undefined
      ? { description: optionalString(value.description, "action.description") as string }
      : {}),
    confirmation: value.confirmation,
  };
};

export const runAppInvocationFrom = (value: unknown): RunAppInvocation => {
  if (!isRecord(value)) throw new Error("An app execution is not an object");
  if (!Array.isArray(value.output) || value.output.some((line) => typeof line !== "string")) {
    throw new Error("output of an app execution is not a text list");
  }
  const base = {
    id: idFrom(value.id, "invocation.id"),
    actorId: requiredString(value.actorId, "invocation.actorId"),
    actorHandle: requiredString(value.actorHandle, "invocation.actorHandle"),
    appId: requiredString(value.appId, "invocation.appId"),
    actionId: idFrom(value.actionId, "invocation.actionId"),
    revision: requiredString(value.revision, "invocation.revision"),
    output: value.output as string[],
    createdAt: requiredString(value.createdAt, "invocation.createdAt"),
    requestId: idFrom(value.requestId, "invocation.requestId"),
  };
  switch (value.status) {
    case "queued":
      return { ...base, status: "queued" };
    case "running":
      return { ...base, status: "running", startedAt: requiredString(value.startedAt, "invocation.startedAt") };
    case "succeeded": {
      if (!isJsonValue(value.result)) throw new Error("result of an app execution is not a JSON value");
      return {
        ...base,
        status: "succeeded",
        startedAt: requiredString(value.startedAt, "invocation.startedAt"),
        finishedAt: requiredString(value.finishedAt, "invocation.finishedAt"),
        result: value.result,
      };
    }
    case "failed":
    case "cancelled":
      return {
        ...base,
        status: value.status,
        ...(value.startedAt !== undefined
          ? { startedAt: requiredString(value.startedAt, "invocation.startedAt") }
          : {}),
        finishedAt: requiredString(value.finishedAt, "invocation.finishedAt"),
        error: requiredString(value.error, "invocation.error"),
      };
    default:
      throw new Error("status of an app execution is invalid");
  }
};

const runAppPlacementFrom = (value: unknown): RunAppPlacement => {
  if (!isRecord(value)) throw new Error("An app placement is not an object");
  if (value.kind === "canvas") {
    return {
      kind: "canvas",
      anchorActorId: requiredString(value.anchorActorId, "placement.anchorActorId"),
    };
  }
  throw new Error("kind of an app placement must be canvas");
};

export const runAppFrom = (value: unknown): RunApp => {
  if (!isRecord(value)) throw new Error("An app is not an object");
  if (!Array.isArray(value.actions)) throw new Error("actions of an app is not a list");
  if (!Array.isArray(value.invocations)) throw new Error("invocations of an app is not a list");
  const rawPlacements = value.placements ?? [];
  if (!Array.isArray(rawPlacements)) throw new Error("placements of an app is not a list");
  if (!isRecord(value.state) || value.state.version !== 1 || !Number.isSafeInteger(value.state.revision) || !isJsonValue(value.state.values)) throw new Error("state of a view does not match the state contract");
  const actions = unique(value.actions.map(runAppActionFrom), (action) => action.id, "actions");
  const invocations = unique(
    value.invocations.map(runAppInvocationFrom),
    (invocation) => invocation.id,
    "invocations",
  );
  const actionIds = new Set(actions.map((action) => action.id));
  if (invocations.some((invocation) => !actionIds.has(invocation.actionId))) {
    throw new Error("An app execution refers to an unknown action");
  }
  if (value.visible !== undefined && typeof value.visible !== "boolean") throw new Error("visible of an app is not a boolean");
  if (rawPlacements.length > 1) throw new Error("placements of an app contains more than one placement");
  const placements = rawPlacements.map(runAppPlacementFrom);
  const id = requiredString(value.id, "view.id");
  if (!VIEW_ID_PATTERN.test(id)) throw new Error("view.id is not a valid identifier");
  const actorId = requiredString(value.actorId, "view.actorId");
  if (placements.some((placement) => placement.anchorActorId !== actorId)) throw new Error("The view must be placed at its own actor");
  return {
    id,
    actorId,
    actorHandle: requiredString(value.actorHandle, "view.actorHandle"),
    visible: value.visible !== false,
    title: requiredString(value.title, "app.title"),
    ...(value.description !== undefined
      ? { description: optionalString(value.description, "app.description") as string }
      : {}),
    revision: requiredString(value.revision, "app.revision"),
    actions,
    placements,
    state: { version: 1, revision: value.state.revision as number, values: value.state.values },
    invocations,
  };
};

const runToolParameterFrom = (value: unknown): RunToolParameter => {
  if (!isRecord(value)) throw new Error("A tool parameter is not an object");
  if (typeof value.type !== "string" || !PARAMETER_TYPES.has(value.type as RunToolParameter["type"])) {
    throw new Error("type of a tool parameter is invalid");
  }
  if (typeof value.required !== "boolean") throw new Error("required of a tool parameter is not a boolean");
  return {
    name: idFrom(value.name, "parameter.name"),
    description: requiredString(value.description, "parameter.description"),
    type: value.type as RunToolParameter["type"],
    required: value.required,
  };
};

const runToolTargetFrom = (value: unknown): RunToolTarget => {
  if (!isRecord(value)) throw new Error("A tool target is not an object");
  if (value.handle !== null && typeof value.handle !== "string") {
    throw new Error("handle of a tool target must be text or null");
  }
  return {
    actorId: requiredString(value.actorId, "target.actorId"),
    handle: value.handle,
  };
};

export const runScriptToolFrom = (value: unknown): RunScriptTool => {
  if (!isRecord(value)) throw new Error("A script tool is not an object");
  if (!Array.isArray(value.parameters)) throw new Error("parameters of a script tool is not a list");
  if (!Array.isArray(value.targets)) throw new Error("targets of a script tool is not a list");
  const sourceHash = requiredString(value.sourceHash, "tool.sourceHash");
  if (!HASH_PATTERN.test(sourceHash)) throw new Error("sourceHash of a script tool is invalid");
  return {
    actorId: requiredString(value.actorId, "tool.actorId"),
    actorHandle: requiredString(value.actorHandle, "tool.actorHandle"),
    functionId: idFrom(value.functionId, "tool.functionId"),
    revision: requiredString(value.revision, "tool.revision"),
    moduleId: idFrom(value.moduleId, "tool.moduleId"),
    name: idFrom(value.name, "tool.name"),
    description: requiredString(value.description, "tool.description"),
    parameters: unique(value.parameters.map(runToolParameterFrom), (parameter) => parameter.name, "parameters"),
    card: value.card === true,
    sourceHash,
    targets: unique(value.targets.map(runToolTargetFrom), (target) => target.actorId, "targets"),
    installedBy: requiredString(value.installedBy, "tool.installedBy"),
  };
};

const actorProgramSourceFileFrom = (value: unknown): ActorProgramSourceFile => {
  if (!isRecord(value)) throw new Error("A source file is not an object");
  if (typeof value.content !== "string") throw new Error("content of a source file is not text");
  return {
    path: requiredString(value.path, "source.path"),
    content: value.content,
  };
};

export const actorProgramSourceFrom = (value: unknown): ActorProgramSourceFile[] => {
  if (!isRecord(value) || !Array.isArray(value.files)) throw new Error("The source list does not match the contract");
  return unique(value.files.map(actorProgramSourceFileFrom), (file) => file.path, "files");
};

export const actorProgramsListingFrom = (value: unknown): ActorProgramsListing => {
  if (!isRecord(value) || !Array.isArray(value.apps) || !Array.isArray(value.tools)) {
    throw new Error("The list of actor programs does not match the contract");
  }
  return {
    apps: unique(value.apps.map(runAppFrom), (app) => app.id, "apps"),
    tools: unique(value.tools.map(runScriptToolFrom), (tool) => tool.name, "tools"),
  };
};

const segment = (value: string): string => encodeURIComponent(value);

const frameBase = (routePrefix: string, runId: string): string =>
  `${routePrefix}/runs/${segment(runId)}/apps`;

export const createActorProgramsApi = (routePrefix: string): ActorProgramsApi => ({
  list: async (runId, signal) =>
    actorProgramsListingFrom(await rpc.call(actorProgramContracts.apps, { runId }, { signal })),
  source: async (runId, moduleId, signal) =>
    actorProgramSourceFrom(await rpc.call(actorProgramContracts.source, { runId, moduleId }, { signal })),
  frameUrl: (runId, appId, revision) =>
    withAccessToken(`${frameBase(routePrefix, runId)}/${segment(appId)}/frame?revision=${segment(revision)}`),
  invoke: async (runId, appId, revision, actionId, requestId, input, signal) =>
    runAppInvocationFrom(await rpc.call(actorProgramContracts.action, { runId, appId, revision, actionId, requestId, input }, { signal })),
  invocation: async (runId, appId, invocationId, signal) =>
    runAppInvocationFrom(await rpc.call(actorProgramContracts.invocation, { runId, appId, invocationId }, { signal })),
  invokeFunction: async (runId, actorHandle, revision, functionId, requestId, input, signal) =>
    runAppInvocationFrom(await rpc.call(actorProgramContracts.function, { runId, actorHandle, revision, functionId, requestId, input }, { signal })),
  functionInvocation: async (runId, actorHandle, invocationId, signal) =>
    runAppInvocationFrom(await rpc.call(actorProgramContracts.functionInvocation, { runId, actorHandle, invocationId }, { signal })),
});
