import { Type } from "typebox";
import { defineRunFunction, type RunFunction } from "@aicontainer/ragents";
import { facesOperator } from "@aicontainer/server/plugin-support/tool-availability.js";
import type { AskService } from "./contract.js";

export const askToolMetadata = {
  name: "ask_user",
  label: "Rückfrage",
  description: "Holt eine nötige Benutzerentscheidung mit Antwortoptionen ein und wartet auf die Antwort.",
  longDescription: "Nutze dieses Werkzeug immer, wenn du eine Entscheidung des Benutzers brauchst "
    + "(z.B. Auswahl eines Branches oder eines Zeitraums), statt die Frage nur als Text zu stellen. "
    + "Mit multi=true darf der Benutzer mehrere Optionen wählen; die Antwort ist dann mit '; ' verbunden. "
    + "Der Benutzer kann statt einer Option auch immer frei antworten - rechne also damit, "
    + "dass die Antwort beliebiger Text sein kann.",
} as const;

export const createAskTool = (service: AskService): RunFunction =>
  defineRunFunction({
    ...askToolMetadata,
    schema: Type.Object({
      question: Type.String({ description: "Die Frage an den Benutzer, kurz und konkret" }),
      options: Type.Array(Type.String(), { description: "Antwortoptionen (2 bis 6 Stück)" }),
      multi: Type.Optional(Type.Boolean({ description: "true = Mehrfachauswahl erlaubt" })),
    }),
    resultSchema: Type.String(),
    available: facesOperator,
    executionMode: "sequential",
    run: (scope, toolCallId, input) =>
      service.ask(
        {
          runId: scope.caller.runId,
          agentId: scope.caller.actorId,
          turnId: scope.caller.turnId,
          commandId: scope.context(toolCallId).commandId,
        },
        { question: input.question, options: input.options, multi: input.multi === true },
        scope.signal,
      ),
  });
