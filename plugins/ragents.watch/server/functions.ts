import { Type } from "typebox";
import { defineRunFunction, defineToolAvailability, type ToolContributor } from "@aicontainer/ragents";
import { toolDescriptorFrom } from "@aicontainer/server/plugin-support/agent-tool.js";
import type { WatchServiceApi } from "../contract.js";

const available = defineToolAvailability({ availability: "always", availabilityDetail: "In jedem Run verfügbar." }, () => true);

const verdictSchema = Type.Object({
  at: Type.String({ description: "Zeitpunkt der Bewertung" }),
  wake: Type.Boolean({ description: "Ob der Wächter geweckt hat" }),
  reason: Type.String({ description: "Grund, den die Bedingung geliefert hat, oder 'Bedingung nicht erfüllt'" }),
  changes: Type.Array(Type.String(), { description: "Änderungen seit der letzten Weckung, die der Bewertung vorlagen" }),
}, { additionalProperties: false });

const summarySchema = Type.Object({
  id: Type.String({ description: "Kennung des Wächters für watch_remove" }),
  source: Type.String({ description: "Beobachteter Actor als @handle" }),
  target: Type.String({ description: "Geweckter Actor als @handle" }),
  condition: Type.String({ description: "Weckbedingung als TypeScript-Funktionsrumpf" }),
  observe: Type.Optional(Type.String({ description: "Benannte Operation, deren Ergebnis zum beobachteten Stand gehört" })),
  stallAfterSeconds: Type.Optional(Type.Integer({ description: "Sekunden ohne Ereignis des beobachteten Actors, ab denen der Stand einen Stillstand nennt" })),
  wakes: Type.Integer({ description: "Anzahl der bisherigen Weckungen" }),
  lastEvaluatedAt: Type.Optional(Type.String({ description: "Zeitpunkt der letzten Bewertung" })),
  lastVerdict: Type.Optional(verdictSchema),
}, { additionalProperties: false });

const createSchema = Type.Object({
  source: Type.String({ minLength: 1, description: "Beobachteter Actor als @handle oder Kennung" }),
  condition: Type.String({ minLength: 1, maxLength: 4_000, description: "Weckbedingung als TypeScript-Funktionsrumpf von (now: WatchState, before: WatchState) => string | undefined; liefert den Weckgrund als Text oder undefined. WatchState: source { lifecycle idle|running|stopped, completedTurns, lastTurn { status, reason? }, pendingInputs, openQuestions, lastOutput? }, observed (Ergebnis der observe-Operation als Record<string, unknown>), stalledForSeconds (nur bei Stillstand). before ist der Stand bei der letzten Weckung. Beispiel: return now.source.completedTurns > before.source.completedTurns && now.observed?.phase !== \"ready\" ? \"Turn beendet, Auftrag nicht fertig\" : undefined;" }),
  target: Type.Optional(Type.String({ minLength: 1, description: "Zu weckender Actor als @handle oder Kennung; ohne Angabe der Aufrufer" })),
  observe: Type.Optional(Type.String({ minLength: 1, description: "Benannte Operation ohne Eingabe, deren Ergebnis den beobachteten Stand ergänzt und per Differenz verglichen wird" })),
  instruction: Type.Optional(Type.String({ minLength: 1, maxLength: 2_000, description: "Text, der jeder Weckung angehängt wird, etwa wie der Geweckte reagieren soll" })),
  stallAfterSeconds: Type.Optional(Type.Integer({ minimum: 1, description: "Sekunden ohne Ereignis des beobachteten Actors, ab denen der Stand stalledForSeconds nennt" })),
}, { additionalProperties: false });

export const watchFunctions = (service: WatchServiceApi): ToolContributor => {
  const functions = [
    defineRunFunction({
      name: "watch_create", label: "Wächter anlegen",
      description: "Beobachtet einen Actor dieses Runs und weckt einen anderen mit einer Hintergrundnachricht, sobald die als TypeScript-Funktionsrumpf formulierte Bedingung im geänderten Stand einen Grund liefert. Kein Modell: Die Bedingung wird beim Anlegen typgeprüft und danach deterministisch bei jeder Änderung des beobachteten Stands ausgeführt, sobald der beobachtete Actor zur Ruhe gekommen ist; stalledForSeconds erscheint nach stallAfterSeconds ohne Aktivität und danach je weitere Periode erneut. Ein gleicher Wächter wird nicht doppelt angelegt.",
      schema: createSchema, resultSchema: summarySchema, available,
      run: (scope, _toolCallId, input) => service.create(scope.caller.runId, scope.caller.actorId, input),
    }),
    defineRunFunction({
      name: "watch_list", label: "Wächter auflisten",
      description: "Listet die Wächter dieses Runs mit Bedingung, Anzahl der Weckungen und letztem Urteil.",
      schema: Type.Object({}, { additionalProperties: false }), resultSchema: Type.Array(summarySchema), available,
      run: (scope) => service.list(scope.caller.runId),
    }),
    defineRunFunction({
      name: "watch_remove", label: "Wächter entfernen",
      description: "Entfernt einen Wächter dieses Runs; danach weckt er nicht mehr.",
      schema: Type.Object({
        id: Type.String({ minLength: 1, description: "Kennung aus watch_create oder watch_list" }),
        reason: Type.String({ minLength: 1, description: "Grund der Entfernung" }),
      }, { additionalProperties: false }),
      resultSchema: Type.Object({ removed: Type.Literal(true) }, { additionalProperties: false }), available,
      run: (scope, _toolCallId, input) => { service.remove(scope.caller.runId, input.id, input.reason); return { removed: true as const }; },
    }),
  ];
  return { name: "ragents.watch", descriptors: functions.map((fn) => toolDescriptorFrom(fn, available)), tools: () => functions };
};
