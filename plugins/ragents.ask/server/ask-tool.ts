import { Type } from "typebox";
import { defineRunFunction, type RunFunction } from "@ragents/engine";
import { facesOperator } from "@ragents/host/plugin-support/tool-availability.js";
import type { AskService } from "./contract.js";

export const askToolMetadata = {
  name: "ask_user",
  label: "Question",
  description: "Asks the user for a required decision with answer options and waits for the answer.",
  longDescription: "Always use this tool when you need a decision from the user "
    + "(e.g. choosing a branch or a time range), instead of only asking the question as text. "
    + "With multi=true the user may choose several options; the answer is then joined with '; '. "
    + "Instead of choosing an option, the user can always answer freely - so expect "
    + "the answer to be arbitrary text.",
} as const;

export const createAskTool = (service: AskService): RunFunction =>
  defineRunFunction({
    ...askToolMetadata,
    schema: Type.Object({
      question: Type.String({ description: "The question to the user, short and concrete" }),
      options: Type.Array(Type.String(), { description: "Answer options (2 to 6)" }),
      multi: Type.Optional(Type.Boolean({ description: "true = multiple choice allowed" })),
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
