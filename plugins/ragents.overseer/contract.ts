import { Type, type TSchema } from "typebox";
import { defineOperation } from "@ragents/engine/src/rpc/contract";
import { eventTypeMap, type EventType } from "@ragents/engine/src/domain/events";

export const OVERSEER_PLUGIN_ID = "ragents.overseer";
export const QUICK_ANSWER_MAX_LENGTH = 240;

export interface QuickAnswerState {
  kind: "quick-answer";
  question: string;
  text: string;
}

export const overseerPermissions = [
  { id: "ragents.overseer.read", description: "View the global coordinator and its model selection." },
  { id: "ragents.overseer.write", description: "Give tasks to the global coordinator and reset its conversation." },
] as const;

export interface OverseerModelSelection {
  provider: string;
  model: string;
  thinking: string;
}

export interface OverseerSettings extends OverseerModelSelection {
  models: Array<{ id: string; provider: string; label: string; thinking: string[] }>;
}

const object = <P extends Record<string, TSchema>>(properties: P) => Type.Object(properties, { additionalProperties: false });
const text = () => Type.String({ minLength: 1, pattern: "\\S" });
const empty = object({});
const jsonObject = Type.Record(Type.String(), Type.Any());
const eventType = Type.Unsafe<EventType>(Type.Union(Object.keys(eventTypeMap).map((name) => Type.Literal(name))));
const run = Type.String({ minLength: 1, maxLength: 512, description: "Run ID, unique title or stable reference such as Run 1." });
const identityFields = { runId: Type.String(), title: Type.String(), reference: Type.String() };
const runSummary = object({ ...identityFields, createdAt: Type.Optional(Type.Number()), updatedAt: Type.Number(), running: Type.Optional(Type.Boolean()), metadata: Type.Optional(jsonObject) });
const accepted = object({ ...identityFields, accepted: Type.Literal(true) });
const commonStart = { title: text(), options: Type.Optional(jsonObject) };
const createInput = Type.Union([
  object({ ...commonStart, message: text() }),
  object({ ...commonStart, script: text(), input: Type.Optional(Type.Any()) }),
  object({ ...commonStart, packageDirectory: Type.String({ minLength: 1, description: "Absolute path of a RUN.md/setup.ts/tests.json package on the server. A local shell client inserts its actually existing package path; this is not an upload." }), input: Type.Optional(Type.Any()) }),
]);
const domainObject = (name: string, source = "packages/ragents/src/domain/model.ts") => Type.Object({}, {
  additionalProperties: true, "x-typescript-type": name, "x-source": source,
  description: `Unabridged domain value ${name}; nested fields are deliberately an open JSON schema here.`,
});
const eventSchema = object({
  eventId: Type.String(), runId: Type.String(), sequence: Type.Integer({ minimum: 1 }), schemaVersion: Type.Literal(3),
  occurredAt: Type.String(), actorId: Type.String(), commandId: Type.String(),
  correlationId: Type.Union([Type.String(), Type.Null()]), causationId: Type.Union([Type.String(), Type.Null()]),
  type: eventType, payload: domainObject("EventPayloads[EventType]", "packages/ragents/src/domain/events.ts"),
});
const viewSchema = object({
  id: Type.String(), revision: Type.Integer(), title: Type.String(), ownerId: Type.String(),
  primaryActorId: Type.Union([Type.String(), Type.Null()]), createdAt: Type.String(),
  forkedFrom: Type.Union([object({ runId: Type.String(), sequence: Type.Integer() }), Type.Null()]),
  actors: Type.Array(domainObject("Actor")), inputs: Type.Array(domainObject("ActorInput")), turns: Type.Array(domainObject("Turn")),
  subscriptions: Type.Array(domainObject("EventSubscription")), pluginStates: Type.Array(domainObject("PluginState")),
  actions: Type.Array(domainObject("Action")), artifacts: Type.Array(domainObject("Artifact")),
});
const modelSelection = object({ provider: text(), model: text(), thinking: text() });
const settingsResult = object({
  provider: Type.String(), model: Type.String(), thinking: Type.String(),
  models: Type.Array(object({ id: Type.String(), provider: Type.String(), label: Type.String(), thinking: Type.Array(Type.String()) })),
});

/** Run management, model selection and conversation reset of the global coordinator. */
export const overseerContracts = {
  listRuns: defineOperation({
    id: "ragents.overseer.listRuns",
    description: "List the runs the caller sees, with stable references; the global coordinators are not part of this list.",
    rights: ["runs.read"],
    input: empty,
    result: Type.Array(runSummary),
  }),
  createRun: defineOperation({
    id: "ragents.overseer.createRun",
    description: "Create a run with a server-side ID and title. Exactly one start form: message, installed script (id or unique title), or packageDirectory (existing local run script package). input is only allowed with script/packageDirectory. options selects start options such as ragents.startOptions.select, each only with its own rights. The result waits for preparation, check, test and installation; accepted does not yet confirm a finished model result.",
    rights: ["runs.read", "runs.write", "runs.create"],
    input: createInput,
    result: accepted,
  }),
  readRun: defineOperation({
    id: "ragents.overseer.readRun",
    description: "Read the current unabridged RunView; nested domain values are documented as open JSON objects.",
    rights: ["runs.read", "runs.inspect"],
    input: object({ run }),
    result: viewSchema,
  }),
  readEvents: defineOperation({
    id: "ragents.overseer.readEvents",
    description: "Read the complete journal page by page in sequence order. As long as hasMore is true, use nextAfter as after of the next request. type filters an exact event type.",
    rights: ["runs.read", "runs.inspect"],
    input: object({
      run,
      after: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
      type: Type.Optional(eventType),
    }),
    result: object({ ...identityFields, events: Type.Array(eventSchema), nextAfter: Type.Integer({ minimum: 0 }), hasMore: Type.Boolean() }),
  }),
  sendMessage: defineOperation({
    id: "ragents.overseer.sendMessage",
    description: "Enqueue a chat message for the primary LLM actor; TypeScript as primary is rejected with actor-chat-unsupported. The result only confirms the enqueueing, neither processing nor completion. A running turn is not replaced by it.",
    rights: ["runs.read", "runs.write"],
    input: object({ run, message: text() }),
    result: accepted,
  }),
  stopRun: defineOperation({
    id: "ragents.overseer.stopRun",
    description: "Stop the run through its normal stop boundary and wait for the cleanup; the conversation is kept.",
    rights: ["runs.read", "runs.write"],
    input: object({ run }),
    result: object({ ...identityFields, stopped: Type.Literal(true) }),
  }),
  readCatalog: defineOperation({
    id: "ragents.overseer.readCatalog",
    description: "Read installed templates and start options with input schemas, default values and selectability. createRun starts messages, installed scripts or local packages via packageDirectory. Skills provide editable tasks for message; name the skill as the work instruction.",
    rights: ["runs.read", "runs.inspect"],
    input: empty,
    result: object({
      entries: Type.Array(Type.Object({ id: Type.String(), title: Type.String(), description: Type.String(), action: Type.Union([Type.Literal("skill"), Type.Literal("script")]) }, { additionalProperties: true, "x-typescript-type": "PublicStartEntry" })),
      options: Type.Array(object({ id: Type.String(), schema: jsonObject, value: Type.Any(), selectable: Type.Boolean(), presentation: Type.Any() })),
    }),
  }),
  readReference: defineOperation({
    id: "ragents.overseer.readReference",
    description: "Read a readable reference of all registered methods and channels directly from their contracts.",
    rights: ["runs.read", "runs.inspect"],
    input: empty,
    result: Type.String(),
  }),
  readOpenRpc: defineOperation({
    id: "ragents.overseer.readOpenRpc",
    description: "Read OpenRPC 1.3 directly from the same contracts.",
    rights: ["runs.read", "runs.inspect"],
    input: empty,
    result: jsonObject,
  }),
  settings: {
    read: defineOperation({
      id: "ragents.overseer.settings.read",
      description: "Read the global coordinator's model selection with the available model catalog.",
      rights: ["ragents.overseer.read"],
      input: empty,
      result: settingsResult,
    }),
    save: defineOperation({
      id: "ragents.overseer.settings.save",
      description: "Set the global coordinator's model selection; it applies from the next answer on.",
      rights: ["ragents.overseer.read", "ragents.overseer.write", "settings.write"],
      input: modelSelection,
      result: settingsResult,
    }),
  },
  coordinator: defineOperation({
    id: "ragents.overseer.coordinator",
    description: "Read the run ID of your own global coordinator: one per signed-in user, exactly one without sign-in.",
    rights: ["ragents.overseer.read"],
    input: empty,
    result: object({ runId: Type.String() }),
  }),
  reset: defineOperation({
    id: "ragents.overseer.reset",
    description: "Reset the conversation of your own global coordinator including its model context; the model selection, other users' coordinators and all runs are kept.",
    rights: ["ragents.overseer.read", "ragents.overseer.write"],
    input: object({ confirm: Type.Literal(true, { description: "The conversation reset must be confirmed explicitly." }) }),
    result: Type.Null(),
  }),
} as const;
