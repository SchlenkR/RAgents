import { DomainError, implement, type MethodContribution } from "@ragents/engine";
import type { QuestionAnswer } from "../ask-payload.js";
import { askContracts } from "../contract.js";
import type { AskReply, RuntimeAskService } from "./ask-service.js";

const replyOf = (answers: readonly QuestionAnswer[] | undefined, dismiss: boolean | undefined): AskReply => {
  if (dismiss === true && answers !== undefined) {
    throw new DomainError("answer-ambiguous", "Give either answers or dismiss: true, not both", 400);
  }
  if (dismiss === true) return { dismiss: true };
  if (answers === undefined) throw new DomainError("answer-missing", "answers is required unless dismiss is true", 400);
  return { answers };
};

export const createAnswerMethod = (
  service: RuntimeAskService,
  ensureSession: (runId: string) => void,
): MethodContribution => implement(askContracts.answer, ({ runId, actionId, answers, dismiss }) => {
  const reply = replyOf(answers, dismiss);
  ensureSession(runId);
  service.answer(runId, actionId, reply);
  return null;
});
