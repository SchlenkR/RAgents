import type { IncomingMessage, ServerResponse } from "node:http";
import type { ModelRuntime } from "@ragents/agent";
import type { TSchema } from "typebox";
import type { AgentProfile, CatalogModel, ModelCatalog } from "./agents/catalog.ts";
import type { ToolContributor, ToolRegistry } from "./agents/plugins.ts";
import type { RunFunction, ToolDescriptor } from "./agents/tools.ts";
import type { WorkspaceToolNaming } from "./agents/workspace-tools.ts";
import type { Orchestration } from "./runtime/orchestration.ts";
import type { AgentDriver } from "./drivers/types.ts";
import type { JsonValue } from "./domain/json.ts";
import type { AccessContext } from "./access.ts";
import type { ChannelContribution, MethodContribution } from "./rpc/contribution.ts";

export const runtimeOwner = "ragents.runtime";

export type AgentAudience = "coordinator" | "agent";

export interface ProductDescriptor {
  id: string;
  title: string;
  accessCookieName?: string;
}

/** Where the browser loads a plugin's web half from; the host serves its bundle under these addresses. */
export interface PluginWebAddresses {
  readonly entry: string;
  readonly css?: string;
}

export interface PluginManifest {
  id: string;
  requires?: readonly string[];
  web?: PluginWebAddresses;
  client?: {
    config?: Readonly<Record<string, unknown>>;
  };
}

export interface PublicPluginDescriptor {
  id: string;
  web?: PluginWebAddresses;
  config?: Readonly<Record<string, unknown>>;
}

export interface PublicPluginProfile {
  product: ProductDescriptor;
  plugins: readonly PublicPluginDescriptor[];
  startEntries: readonly PublicStartEntry[];
  /** The profile's default template for a new run; present only when it is among the caller's templates. */
  defaultStartEntry?: string;
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

export interface PublicAgentHookFactory {
  name: string;
  scope: "per-agent";
}

/** A plugin contribution as the settings show it: the host turns it into one extension per agent, named after its id. */
export interface PublicAgentHookContribution {
  id: string;
  owner: string;
  kind: "plugin";
  factories: readonly PublicAgentHookFactory[];
  resolvesPerAgent: true;
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
  kind: "agent-builtin" | "ragents" | "plugin";
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

/** What a hook sees of the model call it runs in. */
export interface AgentHookContext {
  readonly signal: AbortSignal | undefined;
  readonly modelReadsImages: boolean;
}

export interface ModelCallContext extends AgentHookContext {
  /** What this contribution kept last in the agent's conversation, also after a restart of the host. */
  readonly kept: JsonValue | undefined;
  /** Keeps a value in the agent's conversation for later calls; the model never sees it. */
  readonly keep: (value: JsonValue) => void;
}

export interface ToolCallOutcome {
  readonly toolName: string;
  readonly isError: boolean;
}

export type ToolResultPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly data: string; readonly mimeType: string };

export interface ToolResultReplacement {
  readonly content: readonly ToolResultPart[];
  readonly isError?: boolean;
}

/** Hooks into the model calls of every agent; the host resolves them per agent and knows nothing of the agent runtime behind them. */
export interface AgentContribution {
  readonly id: string;
  /** Before each model call of a turn; a returned text reaches the model as a hidden note after the conversation. */
  readonly beforeModelCall?: (
    agent: AgentContributionContext,
    call: ModelCallContext,
  ) => string | undefined | Promise<string | undefined>;
  /** After each tool call; a returned result replaces what the model sees of it. */
  readonly afterToolCall?: (
    agent: AgentContributionContext,
    outcome: ToolCallOutcome,
    call: AgentHookContext,
  ) => ToolResultReplacement | undefined | Promise<ToolResultReplacement | undefined>;
}

/** What every template of the start page shares, whichever action it triggers. */
export interface StartEntryBase {
  id: string;
  title: string;
  description: string;
  order?: number;
  guide?: string;
  /** Searchable labels supplied by the plugin, independent of the entry action. */
  tags?: readonly string[];
  /** Start options this entry fixes, option id to value; a run started through it takes exactly these values. */
  fixedStartOptions?: Readonly<Record<string, JsonValue>>;
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
  /** A run script may name a category of its own; without one the start pages group it as a run script. */
  | { action: "script"; script: RunScriptPackage; category?: string }
);

export type StartEntryAction = StartEntryContribution["action"];

/** The template as the web sees it: a script template shows its kind and coordinator flag, never its source. */
export type PublicStartEntry = StartEntryBase & { owner: string } & (
  | { action: "skill"; skill: string; category: string; prompt: string }
  | { action: "script"; coordinator: boolean; category?: string }
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
  /** Hängt der Beitrag am einzelnen Run, ersetzt dieser Text den von `render` - synchron, damit der Turn ihn ohne Warten hat. */
  renderForRun?: (runId: string) => string;
}

export type ModelProviderConfig = Parameters<ModelRuntime["registerProvider"]>[1];

export interface ModelProviderRegistration {
  id: string;
  config: ModelProviderConfig;
}

export interface ProfileContribution {
  id: string;
  models: () => readonly CatalogModel[];
  profiles: () => readonly AgentProfile[];
  /** Zusätzliche Modellanbieter, vor dem ersten Modellzugriff in der Modelllaufzeit registriert. */
  providers?: () => readonly ModelProviderRegistration[] | Promise<readonly ModelProviderRegistration[]>;
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

export interface SessionStartedContext extends SessionLifecycleContext {
  /** The template the run was started from; null for a start without one. */
  startEntry: { id: string; action: StartEntryAction } | null;
}

export interface SessionLifecycleContribution {
  id: string;
  initialize?: () => void | Promise<void>;
  prepareSession?: (context: SessionLifecycleContext) => void | Promise<void>;
  /** After a start has prepared the workspace and set up the run's first actor, before any actor got input; never after a restart of the host. */
  sessionStarted?: (context: SessionStartedContext) => void | Promise<void>;
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
  /** Der Benutzer, der gerade handelt: aus dem Zugang der Anfrage, null ohne Anmeldung. */
  userId: string | null;
}

export interface StartOptionContribution {
  id: string;
  schema: TSchema;
  selectable: () => boolean;
  defaultValue: (context: StartOptionContext) => JsonValue;
  accept: (value: JsonValue, context: StartOptionContext) => JsonValue;
  describe: (value: JsonValue, context: StartOptionContext) => JsonValue;
  /** Zusätzliche Rechte, ohne die Liste und Wahl die Option nicht anbieten, etwa runs.inspect für technische Einsicht. */
  rights?: readonly string[];
  /** Nach dem Start weiter wählbar: der Host schreibt jeden neuen Wert ins Journal, wer die Option liest, folgt dem jeweils gespeicherten. */
  changeable?: boolean;
  /** Ob nur der Eigentümer einen Run mit diesem Wert bedient; lesen und stoppen dürfen ihn alle, die ihn sehen. */
  ownerOnly?: (value: JsonValue) => boolean;
}

export interface RegisteredStartOption {
  owner: string;
  option: StartOptionContribution;
}

export interface SessionMetadataContribution {
  id: string;
  /** Ob `describe` den Arbeitsbereich des Runs erreicht; dann ruft der Host es nur für Aufrufer, die ihn erreichen dürfen. */
  requiresWorkspace?: boolean;
  describe: (context: SessionMetadataContext) => unknown | Promise<unknown>;
}

/** Die Angaben eines Runs je Beitrag; ein Beitrag ohne Wert steht mit seinem Grund in `unavailable`. */
export interface SessionMetadata {
  readonly values: Readonly<Record<string, unknown>>;
  readonly unavailable: Readonly<Record<string, string>>;
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
  channels: (...contributions: readonly ChannelContribution[]) => void;
  methods: (...contributions: readonly MethodContribution[]) => void;
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
