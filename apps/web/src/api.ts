import { runContracts } from "@ragents/engine/src/http/contracts";
import { coreContracts } from "@ragents/host/api/contracts";
import { hasExactKeys, isRecord } from "./lib/guards";
import { rpc } from "./rpc";
import type { RpcClient } from "./rpc/client";
import type { ChatAttachmentInput, Message } from "./chat/types";
import { startOptionStateFrom, type StartOptionState } from "../../server/src/plugin-support/start-options-contract";

export type { StartOptionState };

export const stopChatActor = async (runId: string, actorId: string, client: RpcClient = rpc): Promise<void> => {
  await client.call(runContracts.stopActor, {
    runId,
    commandId: crypto.randomUUID(),
    actorId,
    reason: "Arbeit durch den Bediener gestoppt",
  });
};

/** Unterbricht nur den laufenden Turn dieses Actors; der Actor bleibt aktiv, ohne laufenden Turn geschieht nichts. */
export const interruptActorTurn = async (runId: string, actorId: string, client: RpcClient = rpc): Promise<void> => {
  await client.call(runContracts.interruptTurn, { runId, commandId: crypto.randomUUID(), actorId });
};

export const restartChatActor = async (runId: string, actorId: string, client: RpcClient = rpc): Promise<void> => {
  await client.call(runContracts.restartActor, { runId, commandId: crypto.randomUUID(), actorId });
};

export const sendActorMessage = async (runId: string, actorId: string, text: string, attachments?: ChatAttachmentInput[], client: RpcClient = rpc): Promise<void> => {
  await client.call(coreContracts.chat.sendToActor, { runId, actorId, text, attachments });
};

export const stopRun = async (runId: string, reason: string, client: RpcClient = rpc): Promise<void> => {
  await client.call(runContracts.stopAll, { runId, commandId: crypto.randomUUID(), reason });
};

export const dismissAction = async (runId: string, actionId: string, client: RpcClient = rpc): Promise<void> => {
  await client.call(runContracts.resolveAction, {
    runId,
    commandId: crypto.randomUUID(),
    actionId,
    decision: "dismissed",
  });
};

export interface SessionInfo {
  id: string;
  title: string;
  createdAt?: number;
  updatedAt: number;
  revision?: number;
  running?: boolean;
  /** Ob der Betrachter den Arbeitsbereich des Runs erreicht; fehlt, solange der Server den Run noch nicht gelistet hat. */
  workspaceAccessible?: boolean;
  metadata?: Readonly<Record<string, unknown>>;
  /** Warum ein Metadaten-Beitrag keinen Wert hat: gescheitert oder nicht rechtzeitig geantwortet. */
  metadataUnavailable?: Readonly<Record<string, string>>;
}

export const listSessions = (client: RpcClient = rpc): Promise<SessionInfo[]> =>
  client.call(coreContracts.sessions.list, {});

export const deleteSession = async (id: string, client: RpcClient = rpc): Promise<void> => {
  await client.call(coreContracts.sessions.delete, { runId: id });
};

export const getRunView = async (sessionId: string, client: RpcClient = rpc): Promise<unknown | undefined> =>
  (await client.call(runContracts.view, { runId: sessionId })) ?? undefined;

export const getActorConversations = async (sessionId: string, client: RpcClient = rpc): Promise<Record<string, Message[]>> =>
  (await client.call(coreContracts.chat.actorHistory, { runId: sessionId })).actors;

export const getStartOptions = async (sessionId: string, signal?: AbortSignal, client: RpcClient = rpc): Promise<readonly StartOptionState[]> =>
  (await client.call(coreContracts.startOptions.list, { runId: sessionId }, { signal })).map(startOptionStateFrom);

export const setStartOption = async (sessionId: string, optionId: string, value: unknown, client: RpcClient = rpc): Promise<StartOptionState> =>
  startOptionStateFrom(await client.call(coreContracts.startOptions.select, { runId: sessionId, optionId, value }));

export interface SettingsProduct {
  id: string;
  title: string;
}

export interface SettingsRuntime {
  profile: string;
  configFile: string | null;
  workspaceMode: string;
  host: {
    mode: "native" | "container";
    platform: string;
    workingDirectory: string;
  };
  dataDirectory: string;
  workspace: { directoryPattern: string };
  documents: { directoryPattern: string } | null;
}

export type SettingsDriver = "manual" | "agent" | "claude-code" | "codex";
export type SettingsThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface SettingsModel {
  driver: SettingsDriver;
  provider: string;
  model: string;
  label: string;
}

export type SettingsProfile = {
  name: string;
  description: string;
  turnTimeoutMs: number | null;
  isolateWorkspace: boolean;
} & (
  | { driver: Exclude<SettingsDriver, "agent"> }
  | { driver: "agent"; provider: string; model: string; thinking?: SettingsThinkingLevel }
);

export interface SettingsPromptContribution {
  id: string;
  owner: string;
  order: number;
  content: string;
}

export interface SettingsConfigurationDescriptor {
  key: string;
  source: string;
  secret: boolean;
}

export interface SettingsPlugin {
  id: string;
  requires: readonly string[];
  clientConfig?: Readonly<Record<string, unknown>>;
  configuration: readonly SettingsConfigurationDescriptor[];
}

export interface SettingsAgentExtensionFactory {
  name: string;
  scope: "per-agent";
}

export interface SettingsAgentExtension {
  id: string;
  owner: string;
  kind: "plugin" | "internal";
  factories: readonly SettingsAgentExtensionFactory[];
  resolvesPerAgent: boolean;
}

export interface SettingsSkill {
  id: string;
  owner: string;
  audiences: readonly SettingsSkillAudience[];
  paths: readonly string[];
}

export type SettingsSkillAudience = "coordinator" | "agent";

export interface SettingsSkillFile {
  root: string;
  path: string;
  bytes: number;
  frontMatter: string | null;
  content: string | null;
}

export interface SettingsSkillDetail {
  id: string;
  owner: string;
  paths: readonly string[];
  files: readonly SettingsSkillFile[];
}

export type SettingsToolKind = "ragents" | "plugin";
export type SettingsToolScope = "global" | "per-agent" | "per-turn";
export type SettingsToolAvailability = "always" | "conditional";

export interface SettingsTool {
  id: string;
  name: string;
  description: string;
  owner: string;
  source: string;
  kind: SettingsToolKind;
  scope: SettingsToolScope;
  availability: SettingsToolAvailability;
  availabilityDetail: string;
  requiredCapabilities?: readonly string[];
  nativeTool?: boolean;
}

export interface SettingsRuntimeContract {
  audience: "coordinator" | "agent";
  content: string;
}

export interface SettingsSystemPrompt {
  scope: "product";
  content: string;
  finalPromptIsRunSpecific: true;
  composition: string;
  runtimeContracts: readonly SettingsRuntimeContract[];
}

export interface SettingsResponse {
  version: 2;
  product: SettingsProduct;
  runtime: SettingsRuntime;
  models: readonly SettingsModel[];
  profiles: readonly SettingsProfile[];
  systemPrompt: SettingsSystemPrompt;
  promptContributions: readonly SettingsPromptContribution[];
  plugins: readonly SettingsPlugin[];
  agentExtensions: readonly SettingsAgentExtension[];
  skills: readonly SettingsSkill[];
  tools: readonly SettingsTool[];
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const isSettingsDriver = (value: unknown): value is SettingsDriver =>
  value === "manual" || value === "agent" || value === "claude-code" || value === "codex";

const isSettingsThinkingLevel = (value: unknown): value is SettingsThinkingLevel =>
  value === "off" || value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max";

const isSettingsModel = (value: unknown): value is SettingsModel =>
  isRecord(value)
  && isSettingsDriver(value.driver)
  && typeof value.provider === "string"
  && typeof value.model === "string"
  && typeof value.label === "string";

const isSettingsProfile = (value: unknown): value is SettingsProfile =>
  isRecord(value)
  && typeof value.name === "string"
  && typeof value.description === "string"
  && isSettingsDriver(value.driver)
  && (value.turnTimeoutMs === null || typeof value.turnTimeoutMs === "number")
  && typeof value.isolateWorkspace === "boolean"
  && (value.driver !== "agent"
    || (typeof value.provider === "string"
      && typeof value.model === "string"
      && (value.thinking === undefined || isSettingsThinkingLevel(value.thinking))));

const isPromptContribution = (value: unknown): value is SettingsPromptContribution =>
  isRecord(value)
  && typeof value.id === "string"
  && typeof value.owner === "string"
  && typeof value.order === "number"
  && typeof value.content === "string";

const isSettingsPlugin = (value: unknown): value is SettingsPlugin =>
  isRecord(value)
  && typeof value.id === "string"
  && isStringArray(value.requires)
  && (value.clientConfig === undefined || isRecord(value.clientConfig))
  && Array.isArray(value.configuration)
  && value.configuration.every((entry) =>
    isRecord(entry)
    && typeof entry.key === "string"
    && typeof entry.source === "string"
    && typeof entry.secret === "boolean");

const isAgentExtension = (value: unknown): value is SettingsAgentExtension =>
  isRecord(value)
  && typeof value.id === "string"
  && typeof value.owner === "string"
  && (value.kind === "plugin" || value.kind === "internal")
  && typeof value.resolvesPerAgent === "boolean"
  && Array.isArray(value.factories)
  && value.factories.every((factory) =>
    isRecord(factory)
    && typeof factory.name === "string"
    && factory.scope === "per-agent");

const isSettingsSkill = (value: unknown): value is SettingsSkill =>
  isRecord(value)
  && typeof value.id === "string"
  && typeof value.owner === "string"
  && Array.isArray(value.audiences)
  && value.audiences.every((audience) => audience === "coordinator" || audience === "agent")
  && isStringArray(value.paths);

const isSettingsSkillFile = (value: unknown): value is SettingsSkillFile =>
  isRecord(value)
  && typeof value.root === "string"
  && typeof value.path === "string"
  && typeof value.bytes === "number"
  && (value.frontMatter === null || typeof value.frontMatter === "string")
  && (value.content === null || typeof value.content === "string");

const isSettingsTool = (value: unknown): value is SettingsTool =>
  isRecord(value)
  && hasExactKeys(value, [
    "id",
    "name",
    "description",
    "owner",
    "source",
    "kind",
    "scope",
    "availability",
    "availabilityDetail",
    ...("requiredCapabilities" in value ? ["requiredCapabilities"] : []),
    ...("nativeTool" in value ? ["nativeTool"] : []),
  ])
  && typeof value.id === "string"
  && typeof value.name === "string"
  && typeof value.description === "string"
  && typeof value.owner === "string"
  && typeof value.source === "string"
  && (value.kind === "ragents" || value.kind === "plugin")
  && (value.scope === "global" || value.scope === "per-agent" || value.scope === "per-turn")
  && (value.availability === "always" || value.availability === "conditional")
  && typeof value.availabilityDetail === "string"
  && (value.requiredCapabilities === undefined || isStringArray(value.requiredCapabilities))
  && (value.nativeTool === undefined || typeof value.nativeTool === "boolean");

const isRuntimeContract = (value: unknown): value is SettingsRuntimeContract =>
  isRecord(value)
  && (value.audience === "coordinator" || value.audience === "agent")
  && typeof value.content === "string";

const isSettingsSystemPrompt = (value: unknown): value is SettingsSystemPrompt =>
  isRecord(value)
  && value.scope === "product"
  && typeof value.content === "string"
  && value.finalPromptIsRunSpecific === true
  && typeof value.composition === "string"
  && Array.isArray(value.runtimeContracts)
  && value.runtimeContracts.every(isRuntimeContract);

const isSettingsRuntime = (value: unknown): value is SettingsRuntime => {
  if (!isRecord(value)
    || typeof value.profile !== "string"
    || value.profile.length === 0
    || (value.configFile !== null && typeof value.configFile !== "string")
    || typeof value.workspaceMode !== "string"
    || value.workspaceMode.length === 0
    || !isRecord(value.host)
    || (value.host.mode !== "native" && value.host.mode !== "container")
    || typeof value.host.platform !== "string"
    || typeof value.host.workingDirectory !== "string"
    || typeof value.dataDirectory !== "string"
    || !isRecord(value.workspace)
    || typeof value.workspace.directoryPattern !== "string") return false;
  return value.documents === null
    || (isRecord(value.documents) && typeof value.documents.directoryPattern === "string");
};

const settingsResponseFrom = (value: unknown): SettingsResponse => {
  if (!isRecord(value)
    || value.version !== 2
    || !isRecord(value.product)
    || typeof value.product.id !== "string"
    || typeof value.product.title !== "string"
    || !isSettingsRuntime(value.runtime)
    || !Array.isArray(value.models)
    || !value.models.every(isSettingsModel)
    || !Array.isArray(value.profiles)
    || !value.profiles.every(isSettingsProfile)
    || !isSettingsSystemPrompt(value.systemPrompt)
    || !Array.isArray(value.promptContributions)
    || !value.promptContributions.every(isPromptContribution)
    || !Array.isArray(value.plugins)
    || !value.plugins.every(isSettingsPlugin)
    || !Array.isArray(value.agentExtensions)
    || !value.agentExtensions.every(isAgentExtension)
    || !Array.isArray(value.skills)
    || !value.skills.every(isSettingsSkill)
    || !Array.isArray(value.tools)
    || !value.tools.every(isSettingsTool)) {
    throw new Error("Die Einstellungen entsprechen nicht dem erwarteten Format");
  }
  return value as unknown as SettingsResponse;
};

export const getSettings = async (signal?: AbortSignal, client: RpcClient = rpc): Promise<SettingsResponse> =>
  settingsResponseFrom(await client.call(coreContracts.settings.read, {}, { signal }));

const settingsSkillDetailFrom = (value: unknown): SettingsSkillDetail => {
  if (!isRecord(value)
    || !isSettingsSkill(value)
    || !Array.isArray(value.files)
    || !value.files.every(isSettingsSkillFile)) {
    throw new Error("Der Skill entspricht nicht dem erwarteten Format");
  }
  return value as unknown as SettingsSkillDetail;
};

export const getSettingsSkill = async (id: string, signal?: AbortSignal, client: RpcClient = rpc): Promise<SettingsSkillDetail> => {
  const detail = await client.call(coreContracts.settings.skill, { id }, { signal });
  if (detail === null) throw new Error("Der Skill konnte nicht geladen werden");
  return settingsSkillDetailFrom(detail);
};
