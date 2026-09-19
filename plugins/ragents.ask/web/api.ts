import { rpc } from "@aicontainer/web/rpc";
import { askContracts } from "../contract";

export const answerQuestion = async (runId: string, actionId: string, answer: string): Promise<void> => {
  await rpc.call(askContracts.answer, { runId, actionId, answer });
};
