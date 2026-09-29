import { Type } from "typebox";
import { defineOperation } from "@ragents/engine/src/rpc/contract";

export const askContracts = {
  answer: defineOperation({
    id: "ragents.ask.answer",
    description: "Answer or dismiss a question of the run. Rights: runs.read and runs.write.",
    rights: ["runs.read", "runs.write"],
    input: Type.Object({
      runId: Type.String({ minLength: 1, maxLength: 64, description: "Run id" }),
      actionId: Type.String({ minLength: 1, maxLength: 80, description: "Question id" }),
      answer: Type.Optional(Type.String({ description: "The user's answer" })),
      dismiss: Type.Optional(Type.Boolean({ description: "true dismisses the question without an answer" })),
    }, { additionalProperties: false }),
    result: Type.Null(),
  }),
};
