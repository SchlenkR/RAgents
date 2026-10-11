import {
  defineRunFunction,
  defineToolAvailability,
  holdsUsable,
  type AccessContext,
  type RunFunction,
  type ToolContributor,
  type ToolScope,
} from "@ragents/engine";
import { toolDescriptorFrom } from "@ragents/host/plugin-support/agent-tool.js";
import {
  appCreatedSchema,
  appCreateSchema,
  appListSchema,
  appNameSchema,
  globalAppsListResultSchema,
  removedSchema,
} from "../contract.js";
import type { GlobalAppsService } from "./service.js";

export const appManagementToolNames = ["global_app_create", "global_app_list", "global_app_remove"] as const;

export const globalAppsFunctions = (service: GlobalAppsService, accessFor: (runId: string) => AccessContext): ToolContributor => {
  const read = defineToolAvailability({
    availability: "conditional",
    availabilityDetail: "With the run owner's global apps read permission.",
  }, (_actor, view) => accessFor(view.id).can("ragents.global-apps.read"));
  const write = defineToolAvailability({
    availability: "conditional",
    availabilityDetail: "For agents with agent.spawn, plugin.state.write and the run owner's global apps write permission.",
  }, (actor, view) => actor.kind !== "human" && actor.kind !== "script"
    && holdsUsable(actor, "agent.spawn")
    && holdsUsable(actor, "plugin.state.write")
    && accessFor(view.id).can("ragents.global-apps.write")
    && accessFor(view.id).can("runs.write"));
  const access = (scope: ToolScope) => accessFor(scope.caller.runId);
  const functions: RunFunction[] = [
    defineRunFunction({
      name: "global_app_create",
      label: "Create global app",
      description: "Copy a package of your run into its own room of the global space, then typecheck, build, test and activate it there with the triggers and permissions of its package.json.",
      longDescription: "The same name replaces the app's package and keeps its state. Verify it with actor_program_trigger and actor_program_status under the returned program name when the global space is your run.",
      schema: appCreateSchema,
      resultSchema: appCreatedSchema,
      available: write,
      executionMode: "sequential",
      run: (scope, _id, input) => service.create(access(scope), scope.caller, input, scope.signal),
    }),
    defineRunFunction({
      name: "global_app_list",
      label: "List global apps",
      description: "List your global apps with their trigger progress and last results.",
      schema: appListSchema,
      resultSchema: globalAppsListResultSchema,
      available: read,
      run: (scope, _id, input) => service.list(access(scope), input.limit),
    }),
    defineRunFunction({
      name: "global_app_remove",
      label: "Remove global app",
      description: "Abort current work and remove the app's program, retaining journal history.",
      schema: appNameSchema,
      resultSchema: removedSchema,
      available: write,
      executionMode: "sequential",
      run: (scope, _id, input) => service.remove(access(scope), input.name),
    }),
  ];
  return {
    name: "ragents.global-apps",
    descriptors: functions.map((fn) => toolDescriptorFrom(fn, fn.available)),
    tools: () => functions,
  };
};
