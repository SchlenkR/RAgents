import { Agent, convertToLlm, type AgentTool, type ModelRuntime } from "@ragents/agent";
import { Type } from "typebox";
import { clampThinkingLevel, type Message } from "@ragents/ai";
import { DomainError, type ModelSelection } from "@ragents/engine";
import { prepareInputAttachments } from "../../../packages/ragents/src/drivers/attachments.ts";
import { MAX_CHAT_REQUEST_BYTES, parseChatAttachments } from "quassel/events";
import {
  MAX_RUN_PREPARATION_MESSAGES, MAX_RUN_PREPARATION_TEXT_CHARS, MAX_RUN_PREPARATION_TOTAL_TEXT_CHARS,
  type RunPreparationMessage, type RunPreparationRequest, type RunPreparationResponse,
} from "./run-preparation-contract.js";

import { preparedRunInput } from "./run-preparation-input.js";

const PREPARATION_TIMEOUT_MS = 120_000;
const invalid = (message: string): never => { throw new DomainError("invalid-preparation", message, 400); };

export const parseRunPreparationRequest = (value: unknown): RunPreparationRequest => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid("Preparation requires a message history.");
  const { messages: input, skillName } = value as Record<string, unknown>;
  if (skillName !== undefined && (typeof skillName !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(skillName))) {
    return invalid("The selected skill name is invalid.");
  }
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_RUN_PREPARATION_MESSAGES || input.length % 2 === 0) {
    return invalid(`The history needs at most ${MAX_RUN_PREPARATION_MESSAGES} alternating messages and must start and end with a user message.`);
  }
  let totalText = 0;
  const messages = input.map((value, index): RunPreparationMessage => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return invalid(`Message ${index + 1} is invalid.`);
    const { role, text, attachments: supplied } = value as Record<string, unknown>;
    if ((role !== "user" && role !== "assistant") || role !== (index % 2 === 0 ? "user" : "assistant")) return invalid("User and model messages must alternate.");
    if (typeof text !== "string" || text.length > MAX_RUN_PREPARATION_TEXT_CHARS) return invalid(`A message may contain at most ${MAX_RUN_PREPARATION_TEXT_CHARS} characters.`);
    totalText += text.length;
    if (totalText > MAX_RUN_PREPARATION_TOTAL_TEXT_CHARS) return invalid(`The history may contain at most ${MAX_RUN_PREPARATION_TOTAL_TEXT_CHARS} text characters in total.`);
    if (role === "assistant" && supplied !== undefined) return invalid("Only user messages may contain attachments.");
    try {
      const attachments = parseChatAttachments(supplied);
      if (!text.trim() && attachments.length === 0) return invalid("A message requires text or attachments.");
      return { role, text, ...(attachments.length ? { attachments } : {}) };
    } catch (error) {
      if (error instanceof DomainError) throw error;
      return invalid(error instanceof Error ? error.message : String(error));
    }
  });
  try { parseChatAttachments(messages.flatMap((message) => message.attachments ?? [])); }
  catch (error) { return invalid(error instanceof Error ? error.message : String(error)); }
  if (Buffer.byteLength(JSON.stringify({ messages }), "utf8") > MAX_CHAT_REQUEST_BYTES) return invalid("The message history is too large.");
  return { messages, ...(typeof skillName === "string" ? { skillName } : {}) };
};

export const prepareRunMessage = async (options: {
  runtime: ModelRuntime;
  prompt: string;
  selection: ModelSelection;
  request: RunPreparationRequest;
  signal: AbortSignal;
}): Promise<RunPreparationResponse> => {
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(PREPARATION_TIMEOUT_MS)]);
  try {
    signal.throwIfAborted();
    const { runtime, selection } = options;
    const model = runtime.getModel(selection.provider, selection.model);
    if (!model) throw new DomainError("preparation-model-unavailable", `The model ${selection.provider}/${selection.model} is not configured.`, 400);
    const messages: Message[] = [];
    for (const message of options.request.messages) {
      signal.throwIfAborted();
      if (message.role === "assistant") {
        messages.push({ role: "assistant", content: [{ type: "text", text: message.text }],
          api: model.api, provider: model.provider, model: model.id, stopReason: "stop", timestamp: Date.now(),
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        });
        continue;
      }
      try {
        const prepared = await prepareInputAttachments({ prompt: message.text, tools: [],
          storeAttachment: () => Promise.reject(new Error("The preparation chat has no workspace.")),
          attachments: message.attachments?.map((attachment) => ({ name: attachment.name, mediaType: attachment.mediaType,
            content: Buffer.from(attachment.data, "base64") })),
        }, model.input);
        messages.push({ role: "user", timestamp: Date.now(), content: prepared.attachments.length
          ? [...(prepared.prompt ? [{ type: "text" as const, text: prepared.prompt }] : []), ...prepared.attachments]
          : prepared.prompt });
      } catch (error) {
        throw new DomainError("preparation-attachment-unsupported", `The attachment cannot be used in the preparation chat: ${error instanceof Error ? error.message : String(error)}`, 400);
      }
    }
    signal.throwIfAborted();
    const systemPrompt = [options.prompt, options.request.skillName ? `Selected skill: ${options.request.skillName}` : ""].filter(Boolean).join("\n\n");
    let startRequested = false;
    const startRun: AgentTool = {
      name: "start_run", label: "Start run",
      description: "Start the discussed run, exclusively after the user's explicit go-ahead to execute, in whatever words. No fixed wording is needed. A confirmation of a detail, a quotation, or a question about capabilities is not enough. The host takes the task, skill, and attachments from the conversation as well as the start options.",
      parameters: Type.Object({}),
      execute: async () => {
        signal.throwIfAborted();
        startRequested = true;
        return { content: [{ type: "text", text: "Start marked for handover. Once this response is complete, the UI takes over the task." }], details: {} };
      },
    };
    if (!(await runtime.checkAuth(model.provider))) throw new Error(`No key is configured for the provider ${model.provider}.`);
    const agent = new Agent({
      initialState: { systemPrompt, model, thinkingLevel: clampThinkingLevel(model, selection.thinking ?? "off"), tools: [startRun], messages: messages.slice(0, -1) },
      convertToLlm,
      streamFn: (streamModel, context, streamOptions) => runtime.streamSimple(streamModel, context, { ...streamOptions, maxRetries: 0, timeoutMs: PREPARATION_TIMEOUT_MS }),
    });
    const abort = () => { agent.abort(); };
    signal.addEventListener("abort", abort, { once: true });
    try {
      signal.throwIfAborted();
      const latest = messages.at(-1)!;
      if (latest.role !== "user") throw new Error("The last message must come from the user.");
      const content = latest.content;
      await agent.prompt({ role: "user", timestamp: Date.now(), content: typeof content === "string"
        ? [{ type: "text", text: content }]
        : [{ type: "text", text: content.filter((part) => part.type === "text").map((part) => part.text).join("\n") }, ...content.filter((part) => part.type !== "text")] });
      signal.throwIfAborted();
      const completed = agent.state.messages.at(-1);
      if (!completed || completed.role !== "assistant" || completed.stopReason !== "stop") {
        throw new DomainError("preparation-model-failed", completed?.role === "assistant"
          ? completed.errorMessage ?? `The preparation was not answered completely (${completed.stopReason}).`
          : "The preparation was not answered completely.", 502);
      }
      if (startRequested) return { kind: "start", input: preparedRunInput(options.request.messages, "", undefined, options.request.skillName) };
      const text = completed.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n").trim();
      if (text.length > MAX_RUN_PREPARATION_TEXT_CHARS) throw new DomainError("preparation-response-too-large", "The model response is too long for the preparation. Please narrow down the task.", 502);
      return { kind: "reply", text };
    } finally {
      signal.removeEventListener("abort", abort);
    }
  } catch (error) {
    if (options.signal.aborted) throw new DomainError("preparation-aborted", "The preparation was cancelled.", 499);
    if (signal.aborted) throw new DomainError("preparation-timeout", "The preparation took too long. Please try again.", 504);
    if (error instanceof DomainError) throw error;
    throw new DomainError("preparation-model-failed", `The preparation failed: ${error instanceof Error ? error.message : String(error)}`, 502);
  }
};
