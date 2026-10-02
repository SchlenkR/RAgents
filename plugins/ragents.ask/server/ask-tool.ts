import { Type } from "typebox";
import { defineRunFunction, type RunFunction } from "@ragents/engine";
import { facesOperator } from "@ragents/host/plugin-support/tool-availability.js";
import { HEADER_MAX_LENGTH, SUPERSEDED_ANSWER } from "../ask-payload.js";
import type { AskService } from "./contract.js";

/** What ask_user returns at once; the turn ends with it, and the answers follow as one new input. */
export const QUESTION_POSED = "Questions shown to the user; the answers arrive together as a new message.";

export const askToolMetadata = {
  name: "ask_user",
  label: "Question",
  description: "Asks the user 1 to 4 multiple-choice questions and ends your turn; the answers arrive later together as a new message.",
  longDescription: "Always use this tool when you need a decision or missing information from the user "
    + "(e.g. choosing a branch or a time range), instead of only asking in your text. "
    + "Call it as the only tool of your response: your turn ends with the questions, and the answers arrive as one new message "
    + "with one line per question. Ask related questions together in one call. "
    + "The user can always answer any question freely instead of choosing an option, so do not add an \"Other\" option "
    + "and expect arbitrary text. With multiSelect the user may choose several options of that question. "
    + "If the user writes a message instead, the questions are closed and that message arrives.",
} as const;

const optionSchema = Type.Object({
  label: Type.String({ description: "The text of the choice the user sees and selects; concise, 1 to 5 words" }),
  description: Type.String({ description: "What this option means or what happens if it is chosen, e.g. its trade-offs" }),
});

const questionSchema = Type.Object({
  question: Type.String({
    description: "The complete question, clear and specific, ending with a question mark, e.g. \"Which library should we use for date formatting?\"",
  }),
  header: Type.String({
    maxLength: HEADER_MAX_LENGTH,
    description: `Very short label shown as a chip, at most ${HEADER_MAX_LENGTH} characters, e.g. "Library" or "Approach"`,
  }),
  options: Type.Array(optionSchema, {
    minItems: 2,
    maxItems: 4,
    description: "2 to 4 distinct choices with different labels, mutually exclusive unless multiSelect is true; no \"Other\" option, free text is always possible",
  }),
  multiSelect: Type.Boolean({ description: "true lets the user choose several options of this question; false for exactly one" }),
});

export const createAskTool = (service: AskService): RunFunction =>
  defineRunFunction({
    ...askToolMetadata,
    schema: Type.Object({
      questions: Type.Array(questionSchema, {
        minItems: 1,
        maxItems: 4,
        description: "1 to 4 different questions, shown together; the user answers all of them at once",
      }),
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
        { questions: input.questions },
      );
      return posed === undefined ? SUPERSEDED_ANSWER : QUESTION_POSED;
    },
  });
