import { RequestError, type AgentSideConnection, type ElicitationPropertySchema } from "@agentclientprotocol/sdk";
import type { RpcClient } from "../../apps/web/src/rpc/client.ts";
import { askContracts } from "../../plugins/ragents.ask/contract.ts";
import { askPayloadOf } from "../../plugins/ragents.ask/ask-payload.ts";

export const elicitQuestion = async (connection: AgentSideConnection, rpc: RpcClient, sessionId: string,
  actionId: string, payload: unknown, signal: AbortSignal): Promise<boolean> => {
  const { questions } = askPayloadOf(payload);
  const properties: Record<string, ElicitationPropertySchema> = Object.fromEntries(questions.flatMap((question, index) => {
    const field = `answer_${index + 1}`;
    const selection: ElicitationPropertySchema = question.multiSelect
      ? { type: "array", title: question.question, items: { type: "string", enum: question.options.map(({ label }) => label) }, minItems: 1 }
      : { type: "string", title: question.question, oneOf: question.options.map(({ label, description }) => ({ const: label, title: description ? `${label}: ${description}` : label })) };
    return [[field, selection], [`${field}_text`, { type: "string", title: `${question.header}: free answer` } as ElicitationPropertySchema]];
  }));
  const aborted = Promise.withResolvers<undefined>();
  const cancel = (): void => aborted.resolve(undefined);
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (signal.aborted) return false;
    const response = await Promise.race([connection.createElicitation({ sessionId, mode: "form", message: "Please answer the questions.",
      requestedSchema: { type: "object", properties } }), aborted.promise]);
    if (!response || signal.aborted) return false;
    if (response.action === "decline" || response.action === "cancel") {
      await rpc.call(askContracts.answer, { runId: sessionId, actionId, dismiss: true });
      return true;
    }
    if (response.action !== "accept" || !response.content) throw RequestError.invalidParams(undefined, "The question form returned no answers.");
    const content = response.content as Record<string, unknown>;
    const answers: ({ text: string } | { selected: string[] })[] = questions.map((_question, index) => {
      const field = `answer_${index + 1}`;
      const text = content[`${field}_text`];
      const selected = content[field];
      if (typeof text === "string" && text.trim()) return { text };
      if (typeof selected === "string") return { selected: [selected] };
      if (Array.isArray(selected) && selected.every((value) => typeof value === "string")) return { selected };
      throw RequestError.invalidParams(undefined, `Question ${index + 1} needs an option or a free answer.`);
    });
    await rpc.call(askContracts.answer, { runId: sessionId, actionId, answers });
    return true;
  } finally { signal.removeEventListener("abort", cancel); }
};
