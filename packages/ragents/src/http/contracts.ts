import { Type, type TSchema, type TUnsafe } from "typebox";
import type { JournalEvent } from "../domain/events.ts";
import type { JsonValue } from "../domain/json.ts";
import type { RunView } from "../domain/model.ts";
import { defineOperation } from "../rpc/contract.ts";

/** Wherever a contract takes an actor field with ID or handle, this one rule resolves it. */
export { actorByHandle, actorByReference, handleKey, type ReferencedActor } from "../domain/actor-reference.ts";

/** A domain value with its own TypeScript type; the schema deliberately stays open. */
export const openJson = <T>(name: string): TUnsafe<T> =>
  Type.Unsafe<T>({ type: "object", additionalProperties: true, "x-typescript-type": name });

export const runViewSchema = openJson<RunView>("RunView");

export const journalEventSchema = openJson<JournalEvent>("JournalEvent");

/** The result of a pending action; its shape belongs to the owner of the action. */
const actionResultSchema = Type.Unsafe<JsonValue>({ "x-typescript-type": "JsonValue" });

const runId = Type.String({ minLength: 1, maxLength: 64, description: "ID of the run" });

const commandFields = {
  runId,
  commandId: Type.String({ minLength: 1 }),
  correlationId: Type.Optional(Type.String({ minLength: 1 })),
  causationId: Type.Optional(Type.String({ minLength: 1 })),
};

const command = <P extends Record<string, TSchema>>(properties: P) =>
  Type.Object({ ...commandFields, ...properties }, { additionalProperties: false });

export const ARTIFACT_CONTENT_PATH = /^\/files\/runs\/([A-Za-z0-9_-]{1,64})\/artifacts\/([A-Za-z0-9_-]{1,128})$/;

/** Artifact contents are delivery: the address under which a GET returns the content. */
export const artifactContentPath = (runId: string, artifactId: string): string =>
  `/files/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}`;

/** The host decides rights per run dynamically (global chat, run ownership); the contracts therefore name none. */
export const runContracts = {
  view: defineOperation({
    id: "ragents.runs.view",
    description: "Read the run view, optionally the state after a journal sequence; null for a run that has not started yet.",
    input: Type.Object({ runId, at: Type.Optional(Type.Integer({ minimum: 0 })) }, { additionalProperties: false }),
    result: Type.Union([runViewSchema, Type.Null()]),
  }),
  events: defineOperation({
    id: "ragents.runs.events",
    description: "Read all journal events of a run in sequence order.",
    input: Type.Object({ runId }, { additionalProperties: false }),
    result: Type.Array(journalEventSchema),
  }),
  enqueueInput: defineOperation({
    id: "ragents.runs.enqueueInput",
    description: "Put a message into the queue of an actor.",
    input: command({ actorId: Type.String({ minLength: 1 }), content: Type.String({ minLength: 1 }), artifactIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))) }),
    result: runViewSchema,
  }),
  restartActor: defineOperation({
    id: "ragents.runs.restartActor",
    description: "Restart a stopped actor.",
    input: command({ actorId: Type.String({ minLength: 1 }), reason: Type.Optional(Type.String({ minLength: 1 })) }),
    result: runViewSchema,
  }),
  stopActor: defineOperation({
    id: "ragents.runs.stopActor",
    description: "Stop an actor together with its delegated children.",
    input: command({ actorId: Type.String({ minLength: 1 }), reason: Type.String({ minLength: 1 }) }),
    result: runViewSchema,
  }),
  interruptTurn: defineOperation({
    id: "ragents.runs.interruptTurn",
    description: "Interrupt the running turn of an actor; the actor stays active and accepts the next input. Without a running turn nothing happens.",
    input: command({ actorId: Type.String({ minLength: 1 }), reason: Type.Optional(Type.String({ minLength: 1 })) }),
    result: runViewSchema,
  }),
  pause: defineOperation({
    id: "ragents.runs.pause",
    description: "Pause the whole run: no turn of any actor starts any more, the running turns of all actors are interrupted, and later inputs wait in the journal. A human input or ragents.runs.resume continues it; a paused run stays paused without an error.",
    input: command({ reason: Type.Optional(Type.String({ minLength: 1 })) }),
    result: runViewSchema,
  }),
  resume: defineOperation({
    id: "ragents.runs.resume",
    description: "Continue a paused run without a message: the primary actor gets everything that waited in one turn, every other actor only once it is addressed directly. A run that is not paused stays as it is.",
    input: command({}),
    result: runViewSchema,
  }),
  resolveAction: defineOperation({
    id: "ragents.runs.resolveAction",
    description: "Answer or dismiss a pending action.",
    input: command({
      actionId: Type.String({ minLength: 1 }),
      decision: Type.Union([Type.Literal("approved"), Type.Literal("dismissed")]),
      result: Type.Optional(actionResultSchema),
    }),
    result: runViewSchema,
  }),
  stopAll: defineOperation({
    id: "ragents.runs.stopAll",
    description: "Stop the whole run with all agents and flows.",
    input: command({ reason: Type.String({ minLength: 1 }) }),
    result: runViewSchema,
  }),
} as const;
