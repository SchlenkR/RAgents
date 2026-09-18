import type { IncomingMessage, ServerResponse } from "node:http";
import type { InlineExtension } from "@aicontainer/agent";
import type { TSchema } from "typebox";
import type { AgentProfile, CatalogModel, ModelCatalog } from "./agents/catalog.ts";
import type { ToolContributor, ToolRegistry } from "./agents/plugins.ts";
import type { RunFunction, ToolDescriptor } from "./agents/tools.ts";
import type { WorkspaceToolNaming } from "./agents/workspace-tools.ts";
import type { Orchestration } from "./runtime/orchestration.ts";
import type { AgentDriver } from "./drivers/types.ts";
import type { JsonValue } from "./domain/json.ts";
import type { AccessContext } from "./access.ts";

export const runtimeOwner = "ragents.runtime";

export type AgentAudience = "coordinator" | "agent";

export interface ProductDescriptor {
  id: string;
  title: string;
  accessCookieName?: string;
}

export interface PluginManifest {
  id: string;
  requires?: readonly string[];
  web?: boolean;
  client?: {
    config?: Readonly<Record<string, unknown>>;
  };
}

export interface PublicPluginDescriptor {
  id: string;
  web: boolean;
  config?: Readonly<Record<string, unknown>>;
}

export interface PublicPluginProfile {
  product: ProductDescriptor;
  plugins: readonly PublicPluginDescriptor[];
  startEntries: readonly PublicStartEntry[];
}

export interface PublicPluginConfigDescriptor {
  key: string;
  source: string;
  secret: boolean;
}

export interface PublicPluginManifest {
  id: string;
  requires: readonly string[];
  clientConfig?: Readonly<Record<string, unknown>>;
  configuration: readonly PublicPluginConfigDescriptor[];
}

export interface PublicPromptContribution {
  id: string;
  owner: string;
  order: number;
  delivery: "initial" | "on-demand";
  content: string;
  requiresTools: readonly string[];
}

export interface PublicPromptSnapshot {
  content: string;
  contributions: readonly PublicPromptContribution[];
}

export interface PublicAgentExtensionFactory {
  name: string | null;
  scope: "global" | "per-agent";
}

export interface PublicAgentExtensionContribution {
  id: string;
  owner: string;
  kind: "plugin";
  factories: readonly PublicAgentExtensionFactory[];
  resolvesPerAgent: boolean;
}

export interface PublicSkillContribution {
  id: string;
  owner: string;
  audiences: readonly AgentAudience[];
  paths: readonly string[];
}

export interface PublicToolDescriptor extends ToolDescriptor {
  id: string;
  owner: string;
  source: string;
  kind: "agent-builtin" | "agent-extension" | "ragents" | "plugin";
}

export interface HttpRouteContext {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  access: AccessContext;
}

export interface HttpRouteContribution {
  id: string;
  isApiPath: (pathname: string) => boolean;
  matches: (request: IncomingMessage, url: URL) => boolean;
  /** Overrides the default runs.read/runs.write check before the handler executes. */
  requiredRights?: readonly string[] | ((request: IncomingMessage, url: URL) => readonly string[]);
  handle: (context: HttpRouteContext) => void | Promise<void>;
}

export type OperationOperatorPolicy = "direct" | "confirm" | "unavailable";

export type OperationPrincipal =
  | { kind: "agent"; actorId: string; turnId: string | null }
  | { kind: "operator"; actorId: string };

export interface OperationConfirmation {
  operationId: string;
  invocationId: string;
  inputHash: string;
}

export type OperationContext =
  | {
    runId: string;
    invocationId: string;
    signal: AbortSignal;
    principal: Extract<OperationPrincipal, { kind: "agent" }>;
  }
  | {
    runId: string;
    invocationId: string;
    signal: AbortSignal;
    principal: Extract<OperationPrincipal, { kind: "operator" }>;
    operatorConfirmation?: OperationConfirmation;
  };

export interface OperationDescriptor {
  id: string;
  label: string;
  description: string;
  schema: TSchema;
  resultSchema: TSchema;
  operator: OperationOperatorPolicy;
}

export interface OperationContribution extends OperationDescriptor {
  execute: (context: OperationContext, input: JsonValue) => JsonValue | Promise<JsonValue>;
}

export interface RegisteredOperationDescriptor extends OperationDescriptor {
  owner: string;
}

export interface AgentContributionContext {
  runId: string;
  agentId: string;
  audience: AgentAudience;
  workspace: string;
}

export interface AgentToolDescriptor extends ToolDescriptor {
  scope: "per-agent";
  availability: "always";
}

export interface AgentContribution {
  id: string;
  global?: readonly InlineExtension[];
  tools: readonly AgentToolDescriptor[];
  resolve?: (
    context: AgentContributionContext,
  ) => readonly InlineExtension[] | Promise<readonly InlineExtension[]>;
}

/** What every entry of the start surface shares, whichever action it triggers. */
export interface StartEntryBase {
  id: string;
  title: string;
  description: string;
  order?: number;
  guide?: string;
  /** Searchable labels supplied by the plugin, independent of the entry action. */
  tags?: readonly string[];
}

export interface ActorProgramFile {
  path: string;
  content: string;
}

export interface BundledActorProgram {
  name: string;
  files: readonly ActorProgramFile[];
}

export interface RunScriptPackage {
  handle: string;
  coordinator: boolean;
  files: readonly ActorProgramFile[];
  programs: readonly BundledActorProgram[];
}

export type StartEntryContribution = StartEntryBase & (
  | { action: "skill"; skill: string; category: string; prompt: string }
  | { action: "script"; script: RunScriptPackage }
);

export type StartEntryAction = StartEntryContribution["action"];

/** The entry as the web sees it: a script entry shows its kind and coordinator flag, never its source. */
export type PublicStartEntry = StartEntryBase & { owner: string } & (
  | { action: "skill"; skill: string; category: string; prompt: string }
  | { action: "script"; coordinator: boolean }
);

export interface SkillContribution {
  id: string;
  audiences?: readonly AgentAudience[];
  paths: (
    context: AgentContributionContext | undefined,
  ) => readonly string[] | Promise<readonly string[]>;
}

export interface PromptRenderContext {
  systemPromptIds?: readonly string[];
}

export interface PromptContribution {
  id: string;
  order: number;
  delivery?: "initial" | "on-demand";
  requiresTools?: readonly string[];
  render: (context: PromptRenderContext) => string | Promise<string>;
}

export interface ProfileContribution {
  id: string;
  models: () => readonly CatalogModel[];
  profiles: () => readonly AgentProfile[];
}

export interface ScriptFactoryContext {
  runtime: Orchestration;
  catalog: ModelCatalog;
  registry: ToolRegistry;
  workspaceTools?: WorkspaceToolNaming;
}

export interface ScriptRuntime {
  driver: AgentDriver<"script">;
}

export interface ScriptContribution {
  id: string;
  create: (context: ScriptFactoryContext) => ScriptRuntime;
}

export interface SessionLifecycleContext {
  runId: string;
}

export interface SessionStopContext extends SessionLifecycleContext {
  signal: AbortSignal;
}

export interface SessionLifecycleContribution {
  id: string;
  initialize?: () => void | Promise<void>;
  prepareSession?: (context: SessionLifecycleContext) => void | Promise<void>;
  stopSession?: (context: SessionStopContext) => void | Promise<void>;
  afterStopSession?: (context: SessionStopContext) => void | Promise<void>;
  deleteSession?: (context: SessionLifecycleContext) => void | Promise<void>;
  shutdown?: () => void | Promise<void>;
}

export interface SessionMetadataContext {
  runId: string;
}

export interface StartOptionContext {
  runId: string;
}

export interface StartOptionContribution {
  id: string;
  schema: TSchema;
  selectable: () => boolean;
  defaultValue: (context: StartOptionContext) => JsonValue;
  accept: (value: JsonValue, context: StartOptionContext) => JsonValue;
  describe: (value: JsonValue, context: StartOptionContext) => JsonValue;
}

export interface RegisteredStartOption {
  owner: string;
  option: StartOptionContribution;
}

export interface SessionMetadataContribution {
  id: string;
  describe: (context: SessionMetadataContext) => unknown | Promise<unknown>;
}

export interface PluginConfigDescriptor {
  key: string;
  source: string;
  secret?: boolean;
}

export interface PluginStorageModes {
  sessionsRoot: number;
  session: number;
}

export interface PluginStorage {
  readonly sessionsRoot: string;
  readonly modes: PluginStorageModes;
  root: (...segments: string[]) => string;
  session: (runId: string, ...segments: string[]) => string;
}

export interface ServiceToken<T> {
  readonly id: string;
  readonly __service?: T;
}

export const serviceToken = <T>(id: string): ServiceToken<T> => Object.freeze({ id });

export interface PluginRegistration {
  readonly manifest: PluginManifest;
  readonly storage: PluginStorage;
  clientConfig: (values: Readonly<Record<string, unknown>>) => void;
  config: (...descriptors: readonly PluginConfigDescriptor[]) => void;
  http: (...routes: readonly HttpRouteContribution[]) => void;
  lifecycle: (...contributions: readonly SessionLifecycleContribution[]) => void;
  operation: (id: string) => RegisteredOperationDescriptor | undefined;
  operations: (...contributions: readonly OperationContribution[]) => void;
  invokeOperation: (id: string, context: OperationContext, input: unknown) => Promise<JsonValue>;
  agentRuntime: (...contributions: readonly AgentContribution[]) => void;
  profiles: (...contributions: readonly ProfileContribution[]) => void;
  prompts: (...contributions: readonly PromptContribution[]) => void;
  provide: <T>(token: ServiceToken<T>, service: T) => void;
  service: <T>(token: ServiceToken<T>) => T;
  optionalService: <T>(token: ServiceToken<T>) => T | undefined;
  sessionMetadata: (...contributions: readonly SessionMetadataContribution[]) => void;
  skills: (...contributions: readonly SkillContribution[]) => void;
  startEntries: (...contributions: readonly StartEntryContribution[]) => void;
  startOptions: (...contributions: readonly StartOptionContribution[]) => void;
  functions: (...functions: readonly (RunFunction | ToolContributor)[]) => void;
  script: (...contributions: readonly ScriptContribution[]) => void;
}

export interface RAgentsPlugin {
  manifest: PluginManifest;
  register: (host: PluginRegistration) => void;
}
