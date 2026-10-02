import { Type } from "typebox";
import { defineRunFunction, defineToolAvailability, type ToolContributor } from "@ragents/engine";
import { toolDescriptorFrom } from "@ragents/host/plugin-support/agent-tool.js";
import type { WatchServiceApi } from "../contract.js";

const available = defineToolAvailability({ availability: "always", availabilityDetail: "Available in every run." }, () => true);

const verdictSchema = Type.Object({
  at: Type.String({ description: "Time of the evaluation" }),
  wake: Type.Boolean({ description: "Whether the watch woke" }),
  reason: Type.String({ description: "Reason the condition returned, or 'Condition not met'" }),
  changes: Type.Array(Type.String(), { description: "Changes since the last wake that the evaluation saw" }),
}, { additionalProperties: false });

const summarySchema = Type.Object({
  id: Type.String({ description: "Id of the watch for watch_remove" }),
  source: Type.String({ description: "Observed actor as @handle" }),
  target: Type.String({ description: "Woken actor as @handle" }),
  condition: Type.String({ description: "Wake condition as a TypeScript function body" }),
  observe: Type.Optional(Type.String({ description: "Named operation whose result belongs to the observed state" })),
  stallAfterSeconds: Type.Optional(Type.Integer({ description: "Seconds without an event of the observed actor after which the state reports a stall" })),
  wakes: Type.Integer({ description: "Number of wakes so far" }),
  lastEvaluatedAt: Type.Optional(Type.String({ description: "Time of the last evaluation" })),
  lastVerdict: Type.Optional(verdictSchema),
}, { additionalProperties: false });

const createSchema = Type.Object({
  source: Type.String({ minLength: 1, description: "Observed actor as @handle or id" }),
  condition: Type.String({ minLength: 1, maxLength: 4_000, description: "Wake condition as a TypeScript function body of (now: WatchState, before: WatchState) => string | undefined; returns the wake reason as text or undefined. WatchState: source { lifecycle idle|running|stopped, completedTurns, lastTurn { status, reason? }, pendingInputs, pendingActions, lastOutput? }, observed (result of the observe operation as Record<string, unknown>), stalledForSeconds (only when stalled). before is the state at the last wake. Example: return now.source.completedTurns > before.source.completedTurns && now.observed?.phase !== \"ready\" ? \"Turn ended, task not finished\" : undefined;" }),
  target: Type.Optional(Type.String({ minLength: 1, description: "Actor to wake as @handle or id; if omitted, the caller" })),
  observe: Type.Optional(Type.String({ minLength: 1, description: "Named operation without input whose result extends the observed state and is compared by difference" })),
  instruction: Type.Optional(Type.String({ minLength: 1, maxLength: 2_000, description: "Text appended to every wake, e.g. how the woken actor should react" })),
  stallAfterSeconds: Type.Optional(Type.Integer({ minimum: 1, description: "Seconds without an event of the observed actor after which the state reports stalledForSeconds" })),
}, { additionalProperties: false });

export const watchFunctions = (service: WatchServiceApi): ToolContributor => {
  const functions = [
    defineRunFunction({
      name: "watch_create", label: "Create watch",
      description: "Observes an actor of this run and wakes another with a background message as soon as the condition, written as a TypeScript function body, returns a reason for the changed state. No model: the condition is type-checked on creation and afterwards run deterministically on every change of the observed state, once the observed actor has come to rest; stalledForSeconds appears after stallAfterSeconds without activity and again after each further period. An identical watch is not created twice.",
      longDescription: "Use a watch to be woken once a derived state meets a condition; to receive every matching event without loss as its own input, use event_subscribe instead.",
      schema: createSchema, resultSchema: summarySchema, available,
      run: (scope, _toolCallId, input) => service.create(scope.caller.runId, scope.caller.actorId, input),
    }),
    defineRunFunction({
      name: "watch_list", label: "List watches",
      description: "Lists the watches of this run with condition, number of wakes and last verdict.",
      schema: Type.Object({}, { additionalProperties: false }), resultSchema: Type.Array(summarySchema), available,
      run: (scope) => service.list(scope.caller.runId),
    }),
    defineRunFunction({
      name: "watch_remove", label: "Remove watch",
      description: "Removes a watch of this run; afterwards it no longer wakes.",
      schema: Type.Object({
        id: Type.String({ minLength: 1, description: "Id from watch_create or watch_list" }),
        reason: Type.String({ minLength: 1, description: "Reason for the removal" }),
      }, { additionalProperties: false }),
      resultSchema: Type.Object({ removed: Type.Literal(true) }, { additionalProperties: false }), available,
      run: (scope, _toolCallId, input) => { service.remove(scope.caller.runId, input.id, input.reason); return { removed: true as const }; },
    }),
  ];
  return { name: "ragents.watch", descriptors: functions.map((fn) => toolDescriptorFrom(fn, available)), tools: () => functions };
};
