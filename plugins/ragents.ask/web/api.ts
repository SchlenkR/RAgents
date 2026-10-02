import { rpc } from "@ragents/web/rpc";
import type { QuestionAnswer } from "../ask-payload";
import { askContracts } from "../contract";

export const answerQuestions = async (runId: string, actionId: string, answers: readonly QuestionAnswer[]): Promise<void> => {
  await rpc.call(askContracts.answer, { runId, actionId, answers: answers.map((answer) => "text" in answer ? { text: answer.text } : { selected: [...answer.selected] }) });
};
