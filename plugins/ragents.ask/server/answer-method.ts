import { DomainError, implement, type MethodContribution } from "@ragents/engine";
import { askContracts } from "../contract.js";
import type { RuntimeAskService } from "./ask-service.js";

export const createAnswerMethod = (
  service: RuntimeAskService,
  ensureSession: (runId: string) => void,
): MethodContribution => implement(askContracts.answer, ({ runId, actionId, answer, dismiss }) => {
  if (dismiss !== true && (typeof answer !== "string" || answer.trim() === "")) {
    throw new DomainError("answer-missing", "answer ist erforderlich, wenn nicht verworfen wird", 400);
  }
  ensureSession(runId);
  service.answer(runId, actionId, { ...(answer !== undefined ? { answer } : {}), ...(dismiss !== undefined ? { dismiss } : {}) });
  return null;
});
