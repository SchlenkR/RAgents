import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type { ModelRuntime } from "@ragents/agent";
import type { TSchema } from "typebox";
import type { AgentProfile, CatalogModel, ModelCatalog } from "./agents/catalog.ts";
import type { ToolContributor, ToolRegistry } from "./agents/plugins.ts";
import type { RunFunction, ToolDescriptor } from "./agents/tools.ts";
import type { WorkspaceToolNaming } from "./agents/workspace-tools.ts";
import type { Orchestration } from "./runtime/orchestration.ts";
import type { AgentDriver } from "./drivers/types.ts";
import type { JsonValue } from "./domain/json.ts";
import type { PluginState } from "./domain/model.ts";
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

/** An HTTP upgrade request with the raw connection; the route answers it or takes the connection over itself. */
export interface HttpUpgradeContext {
  request: IncomingMessage;
  socket: Duplex;
  /** The first bytes after the request headers that already arrived. */
  head: Buffer;
  url: URL;
}

export interface HttpRouteContribution {
  id: string;
  isApiPath: (pathname: string) => boolean;
  matches: (request: IncomingMessage, url: URL) => boolean;
  /** Overrides the default runs.read/runs.write check before the handler executes. */
  requiredRights?: readonly string[] | ((request: IncomingMessage, url: URL) => readonly string[]);
  /** For an address that carries its own credential, such as a short-lived grant in the path: the access it stands for in place of the sign-in, undefined for every other address; an invalid credential throws its error. */
  accessFromAddress?: (request: IncomingMessage, url: URL) => AccessContext | undefined;
  handle: (context: HttpRouteContext) => void | Promise<void>;
  /** Takes the upgrade requests the route matches, such as a WebSocket; it authenticates them itself, the host checks no rights and no sign-in. */
  upgrade?: (context: HttpUpgradeContext) => void | Promise<void>;
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
  readonly toolCallId?: string;
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
  /** Whether the script may also start inside a run that is already running; without it, only a new run. */
  embeddable?: boolean;
  /** Shared actor packages of the profile that the host copies into the run before the setup, by name. */
  sharedPrograms?: readonly string[];
  files: readonly ActorProgramFile[];
  programs: readonly BundledActorProgram[];
}

/** An actor package that a plugin shares with the run scripts of the profile; its name is the package name in every run. */
export interface ActorPackageContribution {
  name: string;
  files: readonly ActorProgramFile[];
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
  /** If the contribution depends on the individual run, this text replaces the one from `render`, undefined keeps it - synchronous so the turn has it without waiting. */
  renderForRun?: (runId: string) => string | undefined;
}

/** Whether the run-related contributions of a plugin apply in a run; the host asks per run, a throw fails its turn with this cause. */
export type RunCondition = (runId: string) => boolean;

export type ModelProviderConfig = Parameters<ModelRuntime["registerProvider"]>[1];

export interface ModelProviderRegistration {
  id: string;
  config: ModelProviderConfig;
}

export interface ProfileContribution {
  id: string;
  models: () => readonly CatalogModel[];
  profiles: () => readonly AgentProfile[];
  /** Additional model providers, registered in the model runtime before the first model access. */
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

export interface ActorRuntimeContribution {
  id: string;
  title: string;
  driver: AgentDriver<"external">;
}

export interface SessionLifecycleContext {
  runId: string;
  signal?: AbortSignal;
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
  /** The user currently acting: from the access of the request, null without sign-in. */
  userId: string | null;
}

export interface StartOptionContribution {
  id: string;
  schema: TSchema;
  selectable: () => boolean;
  defaultValue: (context: StartOptionContext) => JsonValue;
  accept: (value: JsonValue, context: StartOptionContext) => JsonValue;
  describe: (value: JsonValue, context: StartOptionContext) => JsonValue;
  /** Additional rights without which list and choice do not offer the option, such as runs.inspect for technical insight. */
  rights?: readonly string[];
  /** Still selectable after the start: the host writes every new value to the journal, whoever reads the option follows the currently stored one. */
  changeable?: boolean;
  /** Whether only the owner operates a run with this value; everyone who sees it may read and stop it. */
  ownerOnly?: (value: JsonValue) => boolean;
}

export interface RegisteredStartOption {
  owner: string;
  option: StartOptionContribution;
}

/** A chat event for a plugin state, without the id that the projection already names. */
export interface PluginChatEvent {
  type: string;
  payload?: unknown;
}

/** What an access without runs.inspect sees of a plugin state and its chat events; without a projection it sees both unchanged. */
export interface AccessProjectionContribution {
  /** The id of the state as it appears in the journal (`pluginId`) and in the chat event. */
  id: string;
  /** Suppresses this internal state and its chat events even for inspection access. */
  private?: boolean;
  /** The visible state; undefined removes it from the run view. */
  state: (entry: PluginState) => JsonValue | undefined;
  /** The visible chat event; undefined suppresses it. */
  chatEvent: (event: PluginChatEvent) => PluginChatEvent | undefined;
}

/** The icons a line of the run list may carry. */
export type RunListDetailIcon = "folder" | "branch";

/** A line of the run list that a run metadata contribution derives from its value. */
export interface RunListDetail {
  readonly label: string;
  readonly text: string;
  readonly icon?: RunListDetailIcon;
}

export interface SessionMetadataContribution {
  id: string;
  /** Whether `describe` reaches the workspace of the run; then the host calls it only for callers that may reach it. */
  requiresWorkspace?: boolean;
  describe: (context: SessionMetadataContext) => unknown | Promise<unknown>;
  /** The line the run list shows for this value; undefined shows none. */
  listDetail?: (value: unknown) => RunListDetail | undefined;
}

/** The details of a run per contribution; a contribution without a value appears with its reason in `unavailable`. */
export interface SessionMetadata {
  readonly values: Readonly<Record<string, unknown>>;
  readonly unavailable: Readonly<Record<string, string>>;
  /** The list lines of the contributions in registration order. */
  readonly listDetails: readonly RunListDetail[];
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
  /** Prompts, functions, skills and agent hooks of this plugin apply only in runs for which the condition holds; at most one per plugin. */
  runCondition: (condition: RunCondition) => void;
  provide: <T>(token: ServiceToken<T>, service: T) => void;
  service: <T>(token: ServiceToken<T>) => T;
  optionalService: <T>(token: ServiceToken<T>) => T | undefined;
  sessionMetadata: (...contributions: readonly SessionMetadataContribution[]) => void;
  skills: (...contributions: readonly SkillContribution[]) => void;
  startEntries: (...contributions: readonly StartEntryContribution[]) => void;
  actorPackages: (...contributions: readonly ActorPackageContribution[]) => void;
  startOptions: (...contributions: readonly StartOptionContribution[]) => void;
  /** How accesses without runs.inspect see the states of this plugin and their chat events, per state id. */
  accessProjections: (...contributions: readonly AccessProjectionContribution[]) => void;
  functions: (...functions: readonly (RunFunction | ToolContributor)[]) => void;
  script: (...contributions: readonly ScriptContribution[]) => void;
  actorRuntimes: (...contributions: readonly ActorRuntimeContribution[]) => void;
}

export interface RAgentsPlugin {
  manifest: PluginManifest;
  register: (host: PluginRegistration) => void;
}
