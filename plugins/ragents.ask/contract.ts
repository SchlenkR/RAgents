import { Type } from "typebox";
import { defineOperation } from "@ragents/engine/src/rpc/contract";

const answerSchema = Type.Union([
  Type.Object({
    selected: Type.Array(Type.String(), { minItems: 1, description: "Labels of the chosen options; exactly one unless the question has multiSelect" }),
  }, { additionalProperties: false }),
  Type.Object({
    text: Type.String({ minLength: 1, description: "A free answer instead of an option" }),
  }, { additionalProperties: false }),
], { description: "The answer to one question: the chosen options or a free answer" });

export const askContracts = {
  answer: defineOperation({
    id: "ragents.ask.answer",
    description: "Answer or dismiss the questions of one ask_user call. Rights: runs.read and runs.write.",
    rights: ["runs.read", "runs.write"],
    input: Type.Object({
      runId: Type.String({ minLength: 1, maxLength: 64, description: "Run id" }),
      actionId: Type.String({ minLength: 1, maxLength: 80, description: "Id of the question action" }),
      answers: Type.Optional(Type.Array(answerSchema, { description: "One answer per question, in the order of the questions; required unless dismiss is true" })),
      dismiss: Type.Optional(Type.Boolean({ description: "true dismisses all questions of the call without answers; not together with answers" })),
    }, { additionalProperties: false }),
    result: Type.Null(),
  }),
};
