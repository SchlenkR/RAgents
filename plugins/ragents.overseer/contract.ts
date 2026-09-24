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
  { id: "ragents.overseer.read", description: "Den globalen Koordinator und seine Modellauswahl ansehen." },
  { id: "ragents.overseer.write", description: "Dem globalen Koordinator Aufträge geben und sein Gespräch zurücksetzen." },
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
const run = Type.String({ minLength: 1, maxLength: 512, description: "Run-ID, eindeutiger Titel oder stabile Referenz wie Run 1." });
const identityFields = { runId: Type.String(), title: Type.String(), reference: Type.String() };
const runSummary = object({ ...identityFields, createdAt: Type.Optional(Type.Number()), updatedAt: Type.Number(), running: Type.Optional(Type.Boolean()), metadata: Type.Optional(jsonObject) });
const accepted = object({ ...identityFields, accepted: Type.Literal(true) });
const commonStart = { title: text(), options: Type.Optional(jsonObject) };
const createInput = Type.Union([
  object({ ...commonStart, message: text() }),
  object({ ...commonStart, script: text(), input: Type.Optional(Type.Any()) }),
  object({ ...commonStart, packageDirectory: Type.String({ minLength: 1, description: "Absoluter Pfad eines RUN.md/setup.ts/tests.json-Pakets auf dem Server. Ein lokaler Shellclient setzt seinen tatsächlich vorhandenen Paketpfad ein; dies ist kein Upload." }), input: Type.Optional(Type.Any()) }),
]);
const domainObject = (name: string, source = "packages/ragents/src/domain/model.ts") => Type.Object({}, {
  additionalProperties: true, "x-typescript-type": name, "x-source": source,
  description: `Ungekürzter Domänenwert ${name}; verschachtelte Felder sind hier bewusst ein offenes JSON-Schema.`,
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

/** Die Verwaltung der Runs, die Modellauswahl und der Gesprächsreset des globalen Koordinators. */
export const overseerContracts = {
  listRuns: defineOperation({
    id: "ragents.overseer.listRuns",
    description: "Die Runs, die der Aufrufer sieht, mit stabilen Referenzen auflisten; die globalen Koordinatoren gehören nicht zu dieser Liste.",
    rights: ["runs.read"],
    input: empty,
    result: Type.Array(runSummary),
  }),
  createRun: defineOperation({
    id: "ragents.overseer.createRun",
    description: "Einen Run mit serverseitiger ID und Titel anlegen. Genau eine Startform: message, installiertes script (Kennung oder eindeutiger Titel), oder packageDirectory (vorhandenes lokales Run-Script-Paket). input ist nur bei script/packageDirectory erlaubt. options wählt Startoptionen wie ragents.startOptions.select, jede nur mit ihren eigenen Rechten. Das Ergebnis wartet auf Vorbereitung, Check, Test und Installation; accepted bestätigt noch kein fertiges Modellergebnis.",
    rights: ["runs.read", "runs.write", "runs.create"],
    input: createInput,
    result: accepted,
  }),
  readRun: defineOperation({
    id: "ragents.overseer.readRun",
    description: "Die aktuelle ungekürzte RunView lesen; verschachtelte Domänenwerte sind als offene JSON-Objekte dokumentiert.",
    rights: ["runs.read", "runs.inspect"],
    input: object({ run }),
    result: viewSchema,
  }),
  readEvents: defineOperation({
    id: "ragents.overseer.readEvents",
    description: "Das vollständige Journal seitenweise in Sequenzreihenfolge lesen. Solange hasMore wahr ist, nextAfter als after der nächsten Anfrage verwenden. type filtert einen exakten Ereignistyp.",
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
    description: "Eine Chatnachricht an den primären LLM-Actor einreihen; TypeScript als Primary wird mit actor-chat-unsupported abgewiesen. Das Ergebnis bestätigt nur das Einreihen, weder Verarbeitung noch Abschluss. Ein laufender Turn wird dadurch nicht ersetzt.",
    rights: ["runs.read", "runs.write"],
    input: object({ run, message: text() }),
    result: accepted,
  }),
  stopRun: defineOperation({
    id: "ragents.overseer.stopRun",
    description: "Den Run über seine normale Stoppgrenze stoppen und die Bereinigung abwarten; das Gespräch bleibt erhalten.",
    rights: ["runs.read", "runs.write"],
    input: object({ run }),
    result: object({ ...identityFields, stopped: Type.Literal(true) }),
  }),
  readCatalog: defineOperation({
    id: "ragents.overseer.readCatalog",
    description: "Installierte Vorlagen und Startoptionen mit Eingabeschemata, Standardwerten und Wählbarkeit lesen. createRun startet Nachrichten, installierte Scripts oder lokale Pakete via packageDirectory. Skills liefern bearbeitbare Aufträge für message; dabei den Skillnamen als Arbeitsanleitung nennen.",
    rights: ["runs.read", "runs.inspect"],
    input: empty,
    result: object({
      entries: Type.Array(Type.Object({ id: Type.String(), title: Type.String(), description: Type.String(), action: Type.Union([Type.Literal("skill"), Type.Literal("script")]) }, { additionalProperties: true, "x-typescript-type": "PublicStartEntry" })),
      options: Type.Array(object({ id: Type.String(), schema: jsonObject, value: Type.Any(), selectable: Type.Boolean(), presentation: Type.Any() })),
    }),
  }),
  readReference: defineOperation({
    id: "ragents.overseer.readReference",
    description: "Lesbare Referenz aller registrierten Methoden und Kanäle direkt aus ihren Verträgen lesen.",
    rights: ["runs.read", "runs.inspect"],
    input: empty,
    result: Type.String(),
  }),
  readOpenRpc: defineOperation({
    id: "ragents.overseer.readOpenRpc",
    description: "OpenRPC 1.3 direkt aus denselben Verträgen lesen.",
    rights: ["runs.read", "runs.inspect"],
    input: empty,
    result: jsonObject,
  }),
  settings: {
    read: defineOperation({
      id: "ragents.overseer.settings.read",
      description: "Die Modellauswahl des globalen Koordinators mit dem verfügbaren Modellkatalog lesen.",
      rights: ["ragents.overseer.read"],
      input: empty,
      result: settingsResult,
    }),
    save: defineOperation({
      id: "ragents.overseer.settings.save",
      description: "Die Modellauswahl des globalen Koordinators setzen; sie gilt ab der nächsten Antwort.",
      rights: ["ragents.overseer.read", "ragents.overseer.write", "settings.write"],
      input: modelSelection,
      result: settingsResult,
    }),
  },
  coordinator: defineOperation({
    id: "ragents.overseer.coordinator",
    description: "Die Run-ID des eigenen globalen Koordinators lesen: je angemeldetem Benutzer einer, ohne Anmeldung genau einer.",
    rights: ["ragents.overseer.read"],
    input: empty,
    result: object({ runId: Type.String() }),
  }),
  reset: defineOperation({
    id: "ragents.overseer.reset",
    description: "Das Gespräch des eigenen globalen Koordinators samt Modellkontext zurücksetzen; die Modellauswahl, die Koordinatoren anderer Benutzer und alle Runs bleiben erhalten.",
    rights: ["ragents.overseer.read", "ragents.overseer.write"],
    input: object({ confirm: Type.Literal(true, { description: "Der Gesprächsreset muss ausdrücklich bestätigt werden." }) }),
    result: Type.Null(),
  }),
} as const;
