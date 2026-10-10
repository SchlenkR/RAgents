import { Type } from "typebox";
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
  acceptedSchema,
  changedSchema,
  emptySchema,
  appDetailsSchema,
  appFileReadSchema,
  appFileWriteSchema,
  appHttpResultSchema,
  appHttpSchema,
  appListSchema,
  appNameSchema,
  appPauseSchema,
  appReadSchema,
  appRegisterSchema,
  globalAppsListResultSchema,
  appTriggerSchema,
  registeredSchema,
  removedSchema,
} from "../contract.js";
import type { GlobalAppsService } from "./service.js";

export const appManagementToolNames = ["global_app_register", "global_app_list", "global_app_read", "global_app_run", "global_app_pause", "global_app_remove"] as const;

export const globalAppsFunctions = (service: GlobalAppsService, accessFor: (runId: string) => AccessContext): ToolContributor => {
  const read = defineToolAvailability({
    availability: "conditional",
    availabilityDetail: "With the run owner's global apps read permission.",
  }, (_actor, view) => accessFor(view.id).can("ragents.global-apps.read"));
  const write = defineToolAvailability({
    availability: "conditional",
    availabilityDetail: "With agent.spawn, plugin.state.write and the run owner's global apps write permission.",
  }, (actor, view) => holdsUsable(actor, "agent.spawn")
    && holdsUsable(actor, "plugin.state.write")
    && accessFor(view.id).can("ragents.global-apps.write")
    && accessFor(view.id).can("runs.write"));
  const tick = defineToolAvailability({
    availability: "conditional",
    availabilityDetail: "Snippet-only contracts for authoring; calls require an accepted app input.",
  }, (actor) => actor.kind !== "human");
  const access = (scope: ToolScope) => accessFor(scope.caller.runId);
  const functions: RunFunction[] = [
    defineRunFunction({
      name: "global_app_register",
      label: "Register app",
      description: "Copy, typecheck, build and test a private actor package as a paused global app.",
      schema: appRegisterSchema,
      resultSchema: registeredSchema,
      available: write,
      executionMode: "sequential",
      run: (scope, _id, input) => service.register(access(scope), scope.caller, input, scope.signal),
    }),
    defineRunFunction({
      name: "global_app_list",
      label: "List global apps",
      description: "List your global apps and their last results.",
      schema: appListSchema,
      resultSchema: globalAppsListResultSchema,
      available: read,
      run: (scope, _id, input) => service.list(access(scope), input.limit),
    }),
    defineRunFunction({
      name: "global_app_read",
      label: "Read app",
      description: "Read an app's permissions, state and recent bounded log to verify or fix it.",
      schema: appReadSchema,
      resultSchema: appDetailsSchema,
      available: read,
      run: (scope, _id, input) => service.read(access(scope), input.name, input.logLimit),
    }),
    defineRunFunction({
      name: "global_app_run",
      label: "Run app now",
      description: "Queue one immediate check, including while paused. Read its result with global_app_read.",
      schema: appNameSchema,
      resultSchema: acceptedSchema,
      available: write,
      executionMode: "sequential",
      run: (scope, _id, input) => service.run(access(scope), input.name),
    }),
    defineRunFunction({
      name: "global_app_pause",
      label: "Pause or resume app",
      description: "Pause new checks or resume with the next interval starting now.",
      schema: appPauseSchema,
      resultSchema: changedSchema,
      available: write,
      executionMode: "sequential",
      run: (scope, _id, input) => service.pause(access(scope), input.name, input.paused),
    }),
    defineRunFunction({
      name: "global_app_remove",
      label: "Remove app",
      description: "Abort current work and remove the app's package binding, retaining journal history.",
      schema: appNameSchema,
      resultSchema: removedSchema,
      available: write,
      executionMode: "sequential",
      run: (scope, _id, input) => service.remove(access(scope), input.name),
    }),
    defineRunFunction({
      name: "global_app_trigger",
      label: "App trigger",
      description: "Read the accepted occurrence key, planned time and trigger reason. Required in every app's input capabilities.",
      schema: emptySchema,
      resultSchema: appTriggerSchema,
      available: tick,
      nativeTool: false,
      run: (scope) => service.trigger(scope.caller),
    }),
    defineRunFunction({
      name: "global_app_file_read",
      label: "Read app file",
      description: "Read a bounded UTF-8 file within this app's explicitly permitted server folders.",
      schema: appFileReadSchema,
      resultSchema: Type.String(),
      available: tick,
      nativeTool: false,
      run: (scope, _id, input) => service.fileRead(scope.caller, input.path),
    }),
    defineRunFunction({
      name: "global_app_file_write",
      label: "Write app file",
      description: "Write a UTF-8 file within this app's explicitly permitted server folders. The parent must exist.",
      schema: appFileWriteSchema,
      resultSchema: Type.Object({ written: Type.Literal(true) }, { additionalProperties: false }),
      available: tick,
      nativeTool: false,
      run: (scope, _id, input) => service.fileWrite(scope.caller, input.path, input.content),
    }),
    defineRunFunction({
      name: "global_app_http_request",
      label: "Global app HTTP request",
      description: "Make a bounded HTTP(S) request to an explicitly permitted host, without following redirects.",
      schema: appHttpSchema,
      resultSchema: appHttpResultSchema,
      available: tick,
      nativeTool: false,
      run: (scope, _id, input) => service.httpRequest(scope.caller, input, scope.signal),
    }),
  ];
  return {
    name: "ragents.global-apps",
    descriptors: functions.map((fn) => toolDescriptorFrom(fn, fn.available)),
    tools: () => functions,
  };
};
