import { Type } from "typebox";
import { defineOperation } from "@aicontainer/ragents/src/rpc/contract";

export const askContracts = {
  answer: defineOperation({
    id: "ragents.ask.answer",
    description: "Eine Rückfrage des Laufs beantworten oder verwerfen. Rechte: runs.read und runs.write.",
    rights: ["runs.read", "runs.write"],
    input: Type.Object({
      runId: Type.String({ minLength: 1, maxLength: 64, description: "Kennung des Runs" }),
      actionId: Type.String({ minLength: 1, maxLength: 80, description: "Kennung der Frage" }),
      answer: Type.Optional(Type.String({ description: "Die Antwort des Benutzers" })),
      dismiss: Type.Optional(Type.Boolean({ description: "true verwirft die Frage ohne Antwort" })),
    }, { additionalProperties: false }),
    result: Type.Null(),
  }),
};
