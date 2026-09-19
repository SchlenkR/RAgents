import { Type, type TSchema, type TUnsafe } from "typebox";
import type { JournalEvent } from "../domain/events.ts";
import type { RunView } from "../domain/model.ts";
import { defineOperation } from "../rpc/contract.ts";

/** Ein Domänenwert mit eigenem TypeScript-Typ; das Schema bleibt bewusst offen. */
export const openJson = <T>(name: string): TUnsafe<T> =>
  Type.Unsafe<T>({ type: "object", additionalProperties: true, "x-typescript-type": name });

export const runViewSchema = openJson<RunView>("RunView");

export const journalEventSchema = openJson<JournalEvent>("JournalEvent");

const runId = Type.String({ minLength: 1, maxLength: 64, description: "Kennung des Runs" });

const commandFields = {
  runId,
  commandId: Type.String({ minLength: 1 }),
  correlationId: Type.Optional(Type.String({ minLength: 1 })),
  causationId: Type.Optional(Type.String({ minLength: 1 })),
};

const command = <P extends Record<string, TSchema>>(properties: P) =>
  Type.Object({ ...commandFields, ...properties }, { additionalProperties: false });

export const ARTIFACT_CONTENT_PATH = /^\/files\/runs\/([A-Za-z0-9_-]{1,64})\/artifacts\/([A-Za-z0-9_-]{1,128})$/;

/** Artefaktinhalte sind Auslieferung: die Adresse, unter der ein GET den Inhalt liefert. */
export const artifactContentPath = (runId: string, artifactId: string): string =>
  `/files/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}`;

/** Rechte je Run entscheidet der Host dynamisch (globaler Chat, Laufbesitz); die Verträge nennen deshalb keine. */
export const runContracts = {
  view: defineOperation({
    id: "ragents.runs.view",
    description: "Die Laufansicht eines Runs lesen, optional den Stand nach einer Journalsequenz; null für einen noch nicht gestarteten Run.",
    input: Type.Object({ runId, at: Type.Optional(Type.Integer({ minimum: 0 })) }, { additionalProperties: false }),
    result: Type.Union([runViewSchema, Type.Null()]),
  }),
  events: defineOperation({
    id: "ragents.runs.events",
    description: "Alle Journalereignisse eines Runs in Sequenzreihenfolge lesen.",
    input: Type.Object({ runId }, { additionalProperties: false }),
    result: Type.Array(journalEventSchema),
  }),
  enqueueInput: defineOperation({
    id: "ragents.runs.enqueueInput",
    description: "Eine Nachricht in die Warteschlange eines Actors legen.",
    input: command({ actorId: Type.String({ minLength: 1 }), content: Type.String({ minLength: 1 }), artifactIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))) }),
    result: runViewSchema,
  }),
  restartActor: defineOperation({
    id: "ragents.runs.restartActor",
    description: "Einen gestoppten Actor neu starten.",
    input: command({ actorId: Type.String({ minLength: 1 }), reason: Type.Optional(Type.String({ minLength: 1 })) }),
    result: runViewSchema,
  }),
  stopActor: defineOperation({
    id: "ragents.runs.stopActor",
    description: "Einen Actor samt seinen beauftragten Kindern stoppen.",
    input: command({ actorId: Type.String({ minLength: 1 }), reason: Type.String({ minLength: 1 }) }),
    result: runViewSchema,
  }),
  resolveAction: defineOperation({
    id: "ragents.runs.resolveAction",
    description: "Eine offene Rückfrage oder Aktion beantworten.",
    input: command({
      actionId: Type.String({ minLength: 1 }),
      decision: Type.Union([Type.Literal("approved"), Type.Literal("dismissed")]),
      response: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    }),
    result: runViewSchema,
  }),
  stopAll: defineOperation({
    id: "ragents.runs.stopAll",
    description: "Den ganzen Run mit allen Agenten und Abläufen stoppen.",
    input: command({ reason: Type.String({ minLength: 1 }) }),
    result: runViewSchema,
  }),
} as const;
