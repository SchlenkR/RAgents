import { createAgentSession, DefaultResourceLoader, defineTool, SessionManager, SettingsManager, type ModelRuntime } from "@aicontainer/agent";
import { Type } from "typebox";
import type { Message } from "@aicontainer/ai";
import { DomainError, type ModelSelection } from "@aicontainer/ragents";
import { prepareInputAttachments } from "../../../packages/ragents/src/drivers/attachments.ts";
import { MAX_CHAT_REQUEST_BYTES, parseChatAttachments } from "./chat-attachments.js";
import {
  MAX_RUN_PREPARATION_MESSAGES, MAX_RUN_PREPARATION_TEXT_CHARS, MAX_RUN_PREPARATION_TOTAL_TEXT_CHARS,
  type RunPreparationMessage, type RunPreparationRequest, type RunPreparationResponse,
} from "./run-preparation-contract.js";

import { preparedRunInput } from "./run-preparation-input.js";

const PREPARATION_TIMEOUT_MS = 120_000;
const invalid = (message: string): never => { throw new DomainError("invalid-preparation", message, 400); };

export const parseRunPreparationRequest = (value: unknown): RunPreparationRequest => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid("Die Vorbereitung benötigt einen Nachrichtenverlauf.");
  const { messages: input, skillName } = value as Record<string, unknown>;
  if (skillName !== undefined && (typeof skillName !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(skillName))) {
    return invalid("Der ausgewählte Skillname ist ungültig.");
  }
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_RUN_PREPARATION_MESSAGES || input.length % 2 === 0) {
    return invalid(`Der Verlauf benötigt höchstens ${MAX_RUN_PREPARATION_MESSAGES} abwechselnde Nachrichten und muss mit einer Benutzernachricht beginnen und enden.`);
  }
  let totalText = 0;
  const messages = input.map((value, index): RunPreparationMessage => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return invalid(`Nachricht ${index + 1} ist ungültig.`);
    const { role, text, attachments: supplied } = value as Record<string, unknown>;
    if ((role !== "user" && role !== "assistant") || role !== (index % 2 === 0 ? "user" : "assistant")) return invalid("Benutzer- und Modellnachrichten müssen sich abwechseln.");
    if (typeof text !== "string" || text.length > MAX_RUN_PREPARATION_TEXT_CHARS) return invalid(`Eine Nachricht darf höchstens ${MAX_RUN_PREPARATION_TEXT_CHARS} Zeichen enthalten.`);
    totalText += text.length;
    if (totalText > MAX_RUN_PREPARATION_TOTAL_TEXT_CHARS) return invalid(`Der Verlauf darf zusammen höchstens ${MAX_RUN_PREPARATION_TOTAL_TEXT_CHARS} Textzeichen enthalten.`);
    if (role === "assistant" && supplied !== undefined) return invalid("Nur Benutzernachrichten dürfen Anhänge enthalten.");
    try {
      const attachments = parseChatAttachments(supplied);
      if (!text.trim() && attachments.length === 0) return invalid("Eine Nachricht benötigt Text oder Anhänge.");
      return { role, text, ...(attachments.length ? { attachments } : {}) };
    } catch (error) {
      if (error instanceof DomainError) throw error;
      return invalid(error instanceof Error ? error.message : String(error));
    }
  });
  try { parseChatAttachments(messages.flatMap((message) => message.attachments ?? [])); }
  catch (error) { return invalid(error instanceof Error ? error.message : String(error)); }
  if (Buffer.byteLength(JSON.stringify({ messages }), "utf8") > MAX_CHAT_REQUEST_BYTES) return invalid("Der Nachrichtenverlauf ist zu groß.");
  return { messages, ...(typeof skillName === "string" ? { skillName } : {}) };
};

export const prepareRunMessage = async (options: {
  runtime: ModelRuntime;
  prompt: string;
  agentDir: string;
  selection: ModelSelection;
  request: RunPreparationRequest;
  signal: AbortSignal;
}): Promise<RunPreparationResponse> => {
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(PREPARATION_TIMEOUT_MS)]);
  try {
    signal.throwIfAborted();
    const { runtime, selection } = options;
    const model = runtime.getModel(selection.provider, selection.model);
    if (!model) throw new DomainError("preparation-model-unavailable", `Das Modell ${selection.provider}/${selection.model} ist nicht konfiguriert.`, 400);
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
        const prepared = await prepareInputAttachments({ prompt: message.text, workspace: "", tools: [], workspaceTools: [],
          attachments: message.attachments?.map((attachment) => ({ name: attachment.name, mediaType: attachment.mediaType,
            content: Buffer.from(attachment.data, "base64") })),
        }, model.input);
        messages.push({ role: "user", timestamp: Date.now(), content: prepared.attachments.length
          ? [...(prepared.prompt ? [{ type: "text" as const, text: prepared.prompt }] : []), ...prepared.attachments]
          : prepared.prompt });
      } catch (error) {
        throw new DomainError("preparation-attachment-unsupported", `Der Anhang kann im Vorbereitungs-Chat nicht verwendet werden: ${error instanceof Error ? error.message : String(error)}`, 400);
      }
    }
    signal.throwIfAborted();
    const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: {
      enabled: false, provider: { maxRetries: 0, timeoutMs: PREPARATION_TIMEOUT_MS },
    } });
    const systemPrompt = [options.prompt, options.request.skillName ? `Ausgewählter Skill: ${options.request.skillName}` : ""].filter(Boolean).join("\n\n");
    const resourceLoader = new DefaultResourceLoader({ cwd: options.agentDir, agentDir: options.agentDir, settingsManager,
      noExtensions: true, noSkills: true, noPromptTemplates: true, noContextFiles: true,
      systemPrompt, systemPromptOverride: () => systemPrompt, appendSystemPrompt: [],
    });
    await resourceLoader.reload({ signal });
    signal.throwIfAborted();
    const sessionManager = SessionManager.inMemory(options.agentDir);
    for (const message of messages.slice(0, -1)) sessionManager.appendMessage(message);
    let startRequested = false;
    const startRun = defineTool({
      name: "start_run", label: "Run starten",
      description: "Den besprochenen Run starten, ausschließlich nach dem ausdrücklichen sinngemäßen Go des Benutzers zur Ausführung. Keine feste Formulierung nötig. Eine Detailbestätigung, ein Zitat oder eine Fähigkeitsfrage genügt nicht. Der Host übernimmt Auftrag, Skill und Anhänge aus dem Gespräch sowie die Startoptionen.",
      parameters: Type.Object({}),
      execute: async () => {
        signal.throwIfAborted();
        startRequested = true;
        return { content: [{ type: "text", text: "Start zur Übergabe vorgemerkt. Nach Abschluss dieser Antwort übernimmt die Oberfläche den Auftrag." }], details: {} };
      },
    });
    const { session } = await createAgentSession({ cwd: options.agentDir, agentDir: options.agentDir, modelRuntime: runtime,
      model, thinkingLevel: selection.thinking ?? "off", settingsManager, resourceLoader, sessionManager,
      tools: [startRun.name], customTools: [startRun],
    });
    const abort = () => { void session.abort(); };
    signal.addEventListener("abort", abort, { once: true });
    try {
      signal.throwIfAborted();
      const latest = messages.at(-1)!;
      if (latest.role !== "user") throw new Error("Die letzte Nachricht muss vom Benutzer kommen.");
      const content = latest.content;
      await session.prompt(typeof content === "string" ? content : content.filter((part) => part.type === "text").map((part) => part.text).join("\n"), {
        expandPromptTemplates: false,
        ...(typeof content === "string" ? {} : { attachments: content.filter((part) => part.type !== "text") }),
      });
      signal.throwIfAborted();
      const completed = session.messages.at(-1);
      if (!completed || completed.role !== "assistant" || completed.stopReason !== "stop") {
        throw new DomainError("preparation-model-failed", completed?.role === "assistant"
          ? completed.errorMessage ?? `Die Vorbereitung wurde nicht vollständig beantwortet (${completed.stopReason}).`
          : "Die Vorbereitung wurde nicht vollständig beantwortet.", 502);
      }
      if (startRequested) return { kind: "start", input: preparedRunInput(options.request.messages, "", undefined, options.request.skillName) };
      const text = completed.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n").trim();
      if (text.length > MAX_RUN_PREPARATION_TEXT_CHARS) throw new DomainError("preparation-response-too-large", "Die Modellantwort ist für die Vorbereitung zu lang. Bitte grenze den Auftrag ein.", 502);
      return { kind: "reply", text };
    } finally {
      signal.removeEventListener("abort", abort);
      session.dispose();
    }
  } catch (error) {
    if (options.signal.aborted) throw new DomainError("preparation-aborted", "Die Vorbereitung wurde abgebrochen.", 499);
    if (signal.aborted) throw new DomainError("preparation-timeout", "Die Vorbereitung hat zu lange gedauert. Bitte versuche es erneut.", 504);
    if (error instanceof DomainError) throw error;
    throw new DomainError("preparation-model-failed", `Die Vorbereitung ist fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`, 502);
  }
};
