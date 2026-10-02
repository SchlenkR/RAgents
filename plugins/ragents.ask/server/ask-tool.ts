import { Type } from "typebox";
import { defineRunFunction, type RunFunction } from "@ragents/engine";
import { facesOperator } from "@ragents/host/plugin-support/tool-availability.js";
import { SUPERSEDED_ANSWER } from "../ask-payload.js";
import type { AskService } from "./contract.js";

/** What ask_user returns at once; the turn ends with it, and the answer follows as a new input. */
export const QUESTION_POSED = "Question shown to the user; the answer arrives as a new message.";

export const askToolMetadata = {
  name: "ask_user",
  label: "Question",
  nativeTool: true,
  description: "Shows the user a question with answer options and ends your turn; the answer arrives later as a new message.",
  longDescription: "Always use this tool when you need a decision from the user "
    + "(e.g. choosing a branch or a time range), instead of only asking the question as text. "
    + "Call it as the only tool of your response: your turn ends with the question, and the answer arrives as a new message. "
    + "With multi=true the user may choose several options; the answer is then joined with '; '. "
    + "Instead of choosing an option, the user can always answer freely - so expect "
    + "the answer to be arbitrary text. If the user writes a message instead, the question is closed and that message arrives.",
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
    endsTurn: (output) => output === QUESTION_POSED,
    run: (scope, toolCallId, input) => {
      const posed = service.pose(
        {
          runId: scope.caller.runId,
          agentId: scope.caller.actorId,
          turnId: scope.caller.turnId,
          commandId: scope.context(toolCallId).commandId,
        },
        { question: input.question, options: input.options, multi: input.multi === true },
      );
      return posed === undefined ? SUPERSEDED_ANSWER : QUESTION_POSED;
    },
  });
