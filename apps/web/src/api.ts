import { hasExactKeys, isRecord } from "./lib/guards";
import { errorFrom } from "./lib/http";
import type { Message } from "./chat/types";
import { startOptionStateFrom, type StartOptionState } from "../../server/src/plugin-support/start-options-contract";

export type { StartOptionState };

export const stopChatActor = async (runId: string, actorId: string): Promise<void> => {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/actors/${encodeURIComponent(actorId)}/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commandId: crypto.randomUUID(), reason: "Arbeit durch den Bediener gestoppt" }),
  });
  if (!response.ok) {
    const detail: unknown = await response.json().catch(() => undefined);
    throw new Error(isRecord(detail) && typeof detail.message === "string"
      ? detail.message : `Stoppen fehlgeschlagen (${response.status})`);
  }
};

export interface SessionInfo {
  id: string;
  title: string;
  createdAt?: number;
  updatedAt: number;
  revision?: number;
  running?: boolean;
  metadata?: Readonly<Record<string, unknown>>;
}

export const listSessions = async (): Promise<SessionInfo[]> => {
  const response = await fetch("/chat/sessions");
  if (!response.ok) throw new Error("Sessions konnten nicht geladen werden");
  return response.json();
};

export const deleteSession = async (id: string): Promise<void> => {
  const response = await fetch(`/chat/${id}`, { method: "DELETE" });
  if (!response.ok) throw new Error("Session konnte nicht gelöscht werden");
};

export const getRunView = async (sessionId: string): Promise<unknown | undefined> => {
  const response = await fetch(`/chat/${encodeURIComponent(sessionId)}/run`, { cache: "no-store" });
  if (response.status === 404) return undefined;
  if (!response.ok) throw await errorFrom(response, "Der Ablauf konnte nicht geladen werden");
  return (await response.json()) ?? undefined;
};

export const getActorConversations = async (sessionId: string): Promise<Record<string, Message[]>> => {
  const response = await fetch(`/chat/${encodeURIComponent(sessionId)}/actors/history`, { cache: "no-store" });
  if (!response.ok) throw await errorFrom(response, "Die Actor-Gespräche konnten nicht geladen werden");
  const body: unknown = await response.json();
  if (!isRecord(body) || !isRecord(body.actors) || !Object.values(body.actors).every(Array.isArray)) {
    throw new Error("Die Actor-Gespräche entsprechen nicht dem erwarteten Format");
  }
  return body.actors as Record<string, Message[]>;
};

export const getStartOptions = async (sessionId: string, signal?: AbortSignal): Promise<readonly StartOptionState[]> => {
  const response = await fetch(`/chat/${encodeURIComponent(sessionId)}/options`, { cache: "no-store", signal });
  if (!response.ok) throw await errorFrom(response, "Die Startoptionen konnten nicht geladen werden");
  const body = await response.json() as unknown;
  if (!isRecord(body) || !Array.isArray(body.options)) {
    throw new Error("Die Startoptionen entsprechen nicht dem erwarteten Format");
  }
  return body.options.map(startOptionStateFrom);
};

export const setStartOption = async (sessionId: string, optionId: string, value: unknown): Promise<StartOptionState> => {
  const response = await fetch(`/chat/${encodeURIComponent(sessionId)}/options/${encodeURIComponent(optionId)}`, {
    body: JSON.stringify({ value }),
    headers: { "Content-Type": "application/json" },
    method: "PUT",
  });
  if (!response.ok) throw await errorFrom(response, "Die Startoption konnte nicht gesetzt werden");
  return startOptionStateFrom(await response.json() as unknown);
};

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
  name: string | null;
  scope: "global" | "per-agent";
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

export type SettingsToolKind = "agent-builtin" | "agent-extension" | "ragents" | "plugin";
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
    && (factory.name === null || typeof factory.name === "string")
    && (factory.scope === "global" || factory.scope === "per-agent"));

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
  && (value.kind === "agent-builtin" || value.kind === "agent-extension" || value.kind === "ragents" || value.kind === "plugin")
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

export const getSettings = async (signal?: AbortSignal): Promise<SettingsResponse> => {
  const response = await fetch("/api/settings", { cache: "no-store", signal });
  if (!response.ok) throw await errorFrom(response, "Die Einstellungen konnten nicht geladen werden");
  return settingsResponseFrom(await response.json() as unknown);
};

const settingsSkillDetailFrom = (value: unknown): SettingsSkillDetail => {
  if (!isRecord(value)
    || !isSettingsSkill(value)
    || !Array.isArray(value.files)
    || !value.files.every(isSettingsSkillFile)) {
    throw new Error("Der Skill entspricht nicht dem erwarteten Format");
  }
  return value as unknown as SettingsSkillDetail;
};

export const getSettingsSkill = async (id: string, signal?: AbortSignal): Promise<SettingsSkillDetail> => {
  const response = await fetch(`/api/settings/skills/${encodeURIComponent(id)}`, { cache: "no-store", signal });
  if (!response.ok) throw await errorFrom(response, "Der Skill konnte nicht geladen werden");
  return settingsSkillDetailFrom(await response.json() as unknown);
};
