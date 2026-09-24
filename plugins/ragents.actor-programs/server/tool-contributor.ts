import { Type } from "typebox";
import { defineRunFunction, defineToolAvailability, holdsUsable, type RunFunction, type ToolContributor } from "@ragents/engine";
import { toolDescriptorFrom } from "@ragents/host/plugin-support/agent-tool.js";
import type { ActorProgramRuntime } from "./runtime.js";
import type { createProjectDiagnostics } from "./project-diagnostics.js";
const metadata = [
    { name: "actor_program_create", label: "Create Actor Program", description: "Create a private TypeScript package with fixed libraries.", longDescription: "Edit files under @actors/name using workspace tools." },
    { name: "actor_program_activate", label: "Activate Actor Program", description: "Typecheck, build and test a package, then activate its functions and optional views.", longDescription: "actor self or @handle attaches to an existing actor; omitted creates a TypeScript actor for a backend, or attaches static views to self." },
    { name: "actor_program_list", label: "List Actor Programs", description: "List active actor packages, functions and views." },
    { name: "actor_program_remove", label: "Remove Actor Program", description: "Detach functions and views and stop the backend.", longDescription: "A TypeScript actor is stopped; an LLM actor retains its agent behavior." },
    { name: "actor_view_set_visibility", label: "Show or hide Actor View", description: "Set surface visibility by package-name/view-key or @handle/view-key.", longDescription: "Use names you chose; the server resolves the view ID. A unique view title also works." },
    { name: "actor_program_diagnostics", label: "Actor Program Diagnostics", description: "Read the last project diagnostics.", longDescription: "Changed errors are automatically supplied before the next model request." },
] as const;
export const actorProgramManagementToolNames = metadata.map((entry) => entry.name);
export const actorProgramToolsAvailable = defineToolAvailability({ availability: "conditional", availabilityDetail: "Für ausführbare Actors mit agent.spawn und plugin.state.write." }, actor => actor.kind !== "human" && holdsUsable(actor, "agent.spawn") && holdsUsable(actor, "plugin.state.write"));
const name = Type.String({ pattern: "^[a-z][a-z0-9-]{0,63}$" });
type Diagnostics = Pick<ReturnType<typeof createProjectDiagnostics>, "latest">;
const managementTools = (runtime: ActorProgramRuntime, diagnostics: Diagnostics): RunFunction[] => [
    defineRunFunction({ ...metadata[0], schema: Type.Object({ name, template: Type.Union(runtime.templates().map((entry) => Type.Literal(entry.id, { description: entry.description }))) }, { additionalProperties: false }), resultSchema: Type.Object({ name: Type.String(), directory: Type.String(), files: Type.Array(Type.String()) }, { additionalProperties: false }), available: actorProgramToolsAvailable, executionMode: "sequential", run: (scope, _id, input) => runtime.scaffold(scope.caller.runId, input.name, input.template) }),
    defineRunFunction({ ...metadata[1], schema: Type.Object({ name, actor: Type.Optional(Type.String()) }, { additionalProperties: false }), resultSchema: Type.Object({ name: Type.String(), actor: Type.String(), views: Type.Number(), active: Type.Literal(true) }, { additionalProperties: false }), available: actorProgramToolsAvailable, executionMode: "sequential", run: (scope, id, input) => runtime.activate(scope.context(id), scope.caller.runId, input.name, scope.signal, input.actor) }),
    defineRunFunction({ ...metadata[2], schema: Type.Object({}, { additionalProperties: false }), resultSchema: Type.Array(Type.Object({ name: Type.String(), actor: Type.String(), functions: Type.Array(Type.String()), views: Type.Array(Type.Object({ name: Type.String(), title: Type.String(), visible: Type.Boolean() })) })), available: actorProgramToolsAvailable, executionMode: "sequential", run: (scope) => runtime.list(scope.caller.runId) }),
    defineRunFunction({ ...metadata[3], schema: Type.Object({ name }, { additionalProperties: false }), resultSchema: Type.Object({ removed: Type.String() }, { additionalProperties: false }), available: actorProgramToolsAvailable, executionMode: "sequential", run: (scope, id, input) => runtime.remove(scope.context(id), scope.caller.runId, input.name) }),
    defineRunFunction({ ...metadata[4], schema: Type.Object({ view: Type.String({ minLength: 1, description: "package-name/view-key or @handle/view-key of an activated view, without the surface entity prefix app:. No generated IDs needed." }), visible: Type.Boolean() }, { additionalProperties: false }), resultSchema: Type.Object({ view: Type.String(), visible: Type.Boolean() }, { additionalProperties: false }), available: actorProgramToolsAvailable, executionMode: "sequential", run: (scope, id, input) => runtime.setVisibility(scope.context(id), scope.caller.runId, input.view, input.visible) }),
    defineRunFunction({ ...metadata[5], schema: Type.Object({ name: Type.Optional(name) }, { additionalProperties: false }), resultSchema: Type.String(), available: actorProgramToolsAvailable, executionMode: "sequential", run: (scope, _id, input) => diagnostics.latest(scope.caller.runId, scope.caller.actorId, input.name) }),
];
export const createActorProgramToolContributors = (runtime: ActorProgramRuntime, diagnostics: Diagnostics): readonly ToolContributor[] => [
    { name: "ragents.actor-programs.management", descriptors: metadata.map((item) => toolDescriptorFrom(item, actorProgramToolsAvailable)), tools: () => managementTools(runtime, diagnostics) },
    { name: "ragents.actor-programs.functions", descriptors: [], dynamic: true, tools: (context) => runtime.installedTools(context) },
];
