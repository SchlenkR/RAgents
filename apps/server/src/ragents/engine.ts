import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { ModelRuntime } from "@ragents/agent";
import { FILE_OPERATIONS } from "@ragents/workspace-executor";
import {
  DirectoryArtifactContents,
  DomainError,
  Journal,
  LiveBus,
  Orchestration,
  AgentLoopDriver,
  attachmentInputKind,
  RunStopper,
  type PluginHost,
  ToolRegistry,
  TurnScheduler,
  runtimeMethods,
  artifactContentRoute,
  type AccessContext,
  type RunRightsKind,
  type MethodContribution,
  type HttpRouteContribution,
  runtimeServices,
  resolveExecution,
  throwRejected,
  type AgentProfile,
  type CatalogModel,
  type ExecutableActor,
  type ModelCatalog,
  type AgentContributionContext,
  type AgentRuntimeContext,
  type PublicPromptContribution,
  type PublicPromptSnapshot,
  type RunStopBoundary,
  type RunStopOperation,
  type RunView,
  type StartOptionContributionRegistry,
  type Workspaces,
} from "@ragents/engine";
import { config } from "../config.js";
import { accessibleRunView } from "../access-projection.js";
import { assertRunRights } from "../api/rights.js";
import { runOwnerOf, runOwnerOnly, runSharingOf } from "./run-owner.js";
import { layout } from "../layout.js";
import { renderSystemPromptOption, systemPromptSelectionPromptIds } from "../plugin-support/prompt.js";
import { assertCurrentLayoutContract } from "../plugin-support/removed-layout.js";
import { assertCurrentQuestionShape } from "../plugin-support/removed-question-shape.js";
import { actorProgramsToken } from "../plugin-support/actor-programs/service.js";
import { checkedThinkingLevel } from "../plugin-support/thinking-level.js";
import { skillOfDirectory } from "../plugin-support/skills.js";
import { selectedSystemPrompts } from "../plugin-support/system-prompts.js";
import { productRuntimeToken, type ActorRole, type ProductActor } from "./product-runtime.js";
import { storedSystemPrompt } from "./start-option-state.js";
import { coordinatorSelection, isRunCoordinator, storedModelChoice } from "./coordinator.js";
import { runtimeBridgeToken } from "./runtime-bridge.js";
import { workspaceRuntimeToken } from "./workspace-runtime.js";
import { globalChatToken, globalRunPolicyOf } from "./global-chat.js";
import { NodeTypeScriptExecutor } from "../plugin-support/native-typescript-executor.js";
import { sandboxServicesToken, type SandboxServices } from "../plugin-support/workspace-sandbox-host.js";

const FINAL_RUN_STOP_TIMEOUT_MS = 15_000;

type RememberedWorkspace = {
  readonly cwd: string;
  readonly description?: string;
};

export class SessionWorkspaces implements Workspaces {
  readonly #roots = new Map<string, RememberedWorkspace>();
  readonly #sandbox: () => Pick<SandboxServices, "execute" | "serverProcessContextFor">;

  /** The access to the runs' workspace; through it, attachments lie where the tools work, and the runtime gets its server folder. */
  constructor(sandbox: () => Pick<SandboxServices, "execute" | "serverProcessContextFor">) {
    this.#sandbox = sandbox;
  }

  remember(runId: string, cwd: string, description?: string): void {
    this.#roots.set(runId, { cwd, ...(description ? { description } : {}) });
  }

  forget(runId: string): void {
    this.#roots.delete(runId);
  }

  ensure(runId: string): string {
    const root = this.#roots.get(runId);
    if (!root) throw new Error(`No working directory is known for run ${runId}`);
    return root.cwd;
  }

  description(runId: string): string | undefined {
    return this.#roots.get(runId)?.description;
  }

  async storeAttachment(runId: string, name: string, content: Uint8Array): Promise<string> {
    const stored = await this.#sandbox().execute(runId, FILE_OPERATIONS.attach, { name, content: Buffer.from(content).toString("base64") });
    const storedName = (stored as { name?: unknown } | null)?.name;
    if (typeof storedName !== "string") throw new Error(`The executor reports no name for the attachment ${name}`);
    return storedName;
  }
}

class ProductCatalog implements ModelCatalog {
  readonly #profiles: () => readonly AgentProfile[];
  readonly modelList: readonly CatalogModel[];
  readonly #runtimes: () => readonly { id: string; title: string }[];

  constructor(models: readonly CatalogModel[], profiles: () => readonly AgentProfile[], runtimes: () => readonly { id: string; title: string }[]) {
    this.#profiles = profiles;
    this.modelList = models;
    this.#runtimes = runtimes;
  }

  async models() {
    return this.modelList;
  }

  profiles() {
    return this.#profiles();
  }

  runtimes() { return this.#runtimes(); }
}

export interface EngineOptions {
  plugins: PluginHost;
  workspaces: SessionWorkspaces;
  modelRuntime?: Promise<ModelRuntime>;
  assertAvailable: () => void;
  assertRunUsable: (runId: string) => void;
}

export interface Engine {
  runtime: Orchestration;
  journal: Journal;
  scheduler: TurnScheduler;
  live: LiveBus;
  catalog: ModelCatalog & { readonly modelList: readonly CatalogModel[] };
  systemPrompt: string;
  startOptions: StartOptionContributionRegistry;
  systemPromptFor: (runId: string) => string;
  inputCapabilities: (provider: string, model: string) => Promise<readonly string[]>;
  promptContributions: readonly PublicPromptContribution[];
  runtimeContracts: readonly RuntimeContract[];
  start: () => void;
  methods: readonly MethodContribution[];
  artifactRoute: HttpRouteContribution;
  stopRun: RunStopOperation;
  shutdown: () => Promise<void>;
}

export interface RuntimeContract {
  audience: "coordinator" | "agent";
  content: string;
}

const hasTool = (actor: ExecutableActor, name: string, capability: string): boolean =>
  (actor.toolNames === null || actor.toolNames.includes(name))
  && actor.grants.some((grant) => grant.capability === capability && grant.usable !== false);

const outputContractFor = (role: ActorRole): string => role === "primary"
  ? "Your model text is shown in the chat with the user. Respond naturally as text."
  : "Respond naturally in the model text.";

const coreContractFor = (actor: ExecutableActor): string => {
  if (actor.toolNames?.length === 0) return "";

  const lines = [
    "Everything you write in the model text is automatically recorded as an event.",
    "Your turn ends as soon as you no longer call a tool. After that you are idle until the next ActorInput.",
  ];
  if (hasTool(actor, "actor_input", "actor.input")) {
    lines.push("With actor_input you give another actor a task or a question.");
  }
  if (hasTool(actor, "event_subscribe", "event.subscribe")) {
    lines.push("With context.functions.event_subscribe in a snippet you subscribe to the events of the actors whose work you want to follow.");
  }
  if (hasTool(actor, "event_subscription_list", "event.subscribe")) {
    lines.push("context.functions.event_subscription_list shows your active event subscriptions.");
  }
  if (hasTool(actor, "event_unsubscribe", "event.subscribe")) {
    lines.push("You end subscriptions you no longer need with context.functions.event_unsubscribe.");
  }
  if (hasTool(actor, "agent_spawn", "agent.spawn") && hasTool(actor, "actor_input", "actor.input")) {
    lines.push("agent_spawn creates the actor and, given a task, enqueues it as its first input at once; further tasks go to the actor with actor_input.");
  }
  return lines.join("\n");
};

export const createEngine = async (options: EngineOptions): Promise<Engine> => {
  await mkdir(layout.runsDir, { recursive: true });
  await mkdir(layout.artifactsDir, { recursive: true });

  const nativeTypeScriptExecutor = new NodeTypeScriptExecutor({
    directoryFor: (runId) => path.join(layout.sessionDir(runId), "native-programs"),
    serverProcessContextFor: (runId) => options.plugins.service(sandboxServicesToken).serverProcessContextFor(runId),
  });
  const actorPrograms = options.plugins.optionalService(actorProgramsToken);
  const services = { ...runtimeServices, nativeTypeScriptExecutor, ...(actorPrograms ? {actorPrograms} : {}) };
  const journal = new Journal(layout.runsDir, services, {
    validateRecord: (record) => {
      assertCurrentLayoutContract(record);
      assertCurrentQuestionShape(record);
    },
  });
  const runtime = new Orchestration(journal, services, new DirectoryArtifactContents(layout.artifactsDir), (event) => options.plugins.accessProjections.eventVisible(event));
  const productRuntime = options.plugins.service(productRuntimeToken);
  const globalChat = options.plugins.optionalService(globalChatToken);
  const roleFor = (runId: string, actor: ProductActor): ActorRole =>
    productRuntime.roleFor(runtime.view(runId), actor);
  const contributionContextFor = (context: AgentRuntimeContext): AgentContributionContext => ({
    runId: context.runId,
    agentId: context.agentId,
    workspace: context.workspace,
    audience: isRunCoordinator(runtime, context.runId, context.agentId) ? "coordinator" : "agent",
  });
  const agentRuntime = new AgentLoopDriver({
    modelRuntime: options.modelRuntime,
    resolveSkills: async (context) => globalChat?.isCoordinator(context.runId) ? []
      : (await options.plugins.skills.resolve(contributionContextFor(context))).map(skillOfDirectory),
    resolveHooks: (context) => options.plugins.agentRuntime.resolve(contributionContextFor(context)),
  });
  const configuredModels = await Promise.all(options.plugins.profiles.models().map(async (model) => {
    if (model.driver !== "agent") return model;
    const supported = await agentRuntime.thinkingCapabilities(model.provider, model.model);
    const invalid = model.thinking.filter((level) => !supported.includes(level));
    if (invalid.length) throw new Error(`The thinking levels ${invalid.join(", ")} do not exist for ${model.provider}/${model.model}; valid: ${supported.join(", ")}.`);
    return model;
  }));
  const catalog = new ProductCatalog(configuredModels, () => options.plugins.profiles.profiles(), () => options.plugins.actorRuntimes.describe());
  for (const profile of catalog.profiles()) {
    resolveExecution(catalog, { profile: profile.name }, "profile-validation", configuredModels);
  }
  const globalProfile = catalog.profiles().find((profile) => profile.name === productRuntime.coordinator.profile);
  if (globalChat?.model && globalProfile?.driver === "agent") {
    const models = await Promise.all(catalog.modelList.filter((model) => model.driver === "agent").map(async (model) => {
      return { ...model, input: await agentRuntime.inputCapabilities(model.provider, model.model) };
    }));
    await globalChat.model.initialize(models, {
      provider: globalProfile.provider, model: globalProfile.model,
      thinking: globalProfile.thinking ?? checkedThinkingLevel(config.agentThinking, "AGENT_THINKING"),
    }, () => {
      const kinds = journal.runIds().filter((runId) => globalChat.isCoordinator(runId) && journal.stateOf(runId)).flatMap((runId) => {
        const view = runtime.view(runId);
        const attachments = new Set(view.inputs.flatMap((input) => input.artifactIds));
        return view.artifacts.filter((artifact) => attachments.has(artifact.id)).map((artifact) => attachmentInputKind(artifact.mediaType));
      });
      return [...new Set(kinds)].filter((kind) => kind === "image" || kind === "video" || kind === "file");
    });
  }
  const registry = new ToolRegistry(() => options.plugins.actorRuntimes.describe());
  for (const contributor of options.plugins.tools.entries()) registry.register(contributor);
  const live = new LiveBus({
    onListenerError: (error, context) => {
      const detail = error instanceof Error ? error.stack ?? error.message : String(error);
      console.error(`Live listener for ${context.runId}/${context.agentId}/${context.event.kind} failed: ${detail}`);
    },
  });
  const workspaceToolNaming = options.plugins.service(workspaceRuntimeToken).toolNaming;
  const script = options.plugins.scriptRuntime({
    runtime,
    catalog,
    registry,
    ...(workspaceToolNaming ? { workspaceTools: workspaceToolNaming } : {}),
  });
  const promptCatalog = productRuntime.systemPrompts();
  const baseSnapshot: PublicPromptSnapshot = await options.plugins.prompts.snapshot({});
  const optionTexts = new Map<string, string>();
  for (const option of promptCatalog.options) {
    const context = { systemPromptIds: [option.id] };
    optionTexts.set(option.id, (await renderSystemPromptOption(promptCatalog, context)).trim());
  }
  const promptIdsFor = (runId: string): readonly string[] => promptCatalog.mode === "fixed"
    ? promptCatalog.defaultIds
    : storedSystemPrompt(journal.stateOf(runId)).promptIds ?? promptCatalog.defaultIds;
  const textsFor = (runId: string): string[] =>
    selectedSystemPrompts(promptCatalog, promptIdsFor(runId)).map((option) => {
      const text = optionTexts.get(option.id);
      if (text === undefined) {
        throw new Error(`The system prompt ${option.id} of run ${runId} is no longer configured`);
      }
      return text;
    });
  const boundToTools = (entry: PublicPromptContribution, toolNames: readonly string[]): boolean =>
    entry.requiresTools.some((name) => toolNames.includes(name));
  /** A contribution may read differently per run or be missing, e.g. the executor's shell platform or a plugin whose run condition does not apply; this also holds for the chosen system prompts. */
  const contentFor = (runId: string | null, texts: () => readonly string[]): ((entry: PublicPromptContribution) => string) => {
    const overrides = runId === null ? undefined : options.plugins.prompts.runOverrides(runId);
    return (entry) => overrides?.get(entry.id)
      ?? (systemPromptSelectionPromptIds.has(entry.id) ? texts().join("\n\n") : entry.content);
  };
  const composeWith = (runId: string | null, texts: readonly string[], toolNames: readonly string[] | null): string => {
    const content = contentFor(runId, () => texts);
    return baseSnapshot
      .contributions
      .filter((entry) => entry.delivery === "initial")
      .filter((entry) => toolNames === null || entry.requiresTools.length === 0 || boundToTools(entry, toolNames))
      .map(content)
      .filter(Boolean)
      .join("\n\n");
  };
  const chaptersFor = async (runId: string, toolNames: readonly string[]): Promise<string> => {
    const chapters = await options.plugins.prompts.describe({
    }, { delivery: "on-demand", toolNames });
    const content = contentFor(runId, () => []);
    return chapters.map(content).filter(Boolean).join("\n\n");
  };
  const systemPromptFor = (runId: string): string => globalChat?.isCoordinator(runId)
    ? globalChat.prompt : composeWith(runId, textsFor(runId), null);
  const coordinatorPromptFor = (runId: string, toolNames: readonly string[]): string =>
    composeWith(runId, textsFor(runId), toolNames);
  const selectionPrompts = baseSnapshot.contributions.filter((entry) => systemPromptSelectionPromptIds.has(entry.id));
  const agentPromptFor = (runId: string): string => {
    if (!storedSystemPrompt(journal.stateOf(runId)).shareWithAgents) return "";
    if (selectionPrompts.length === 0) return textsFor(runId).join("\n\n");
    const content = contentFor(runId, () => textsFor(runId));
    return selectionPrompts.map(content).filter(Boolean).join("\n\n");
  };
  const systemPrompt = composeWith(
    null,
    selectedSystemPrompts(promptCatalog, promptCatalog.defaultIds).map((option) => optionTexts.get(option.id) ?? ""),
    null);
  const basePromptFor = (runId: string, actor: ExecutableActor, toolNames: readonly string[]): string => {
    if (globalChat?.isCoordinator(runId)) return [globalChat.prompt, outputContractFor("primary")].filter(Boolean).join("\n\n");
    const role = roleFor(runId, actor);
    const prompt = isRunCoordinator(runtime, runId, actor.id)
      ? coordinatorPromptFor(runId, toolNames)
      : [agentPromptFor(runId), actor.kind === "agent" ? actor.prompt : "",
          ...baseSnapshot.contributions
            .filter((entry) => entry.delivery === "initial" && boundToTools(entry, toolNames))
            .map(contentFor(runId, () => textsFor(runId))),
        ].filter(Boolean).join("\n\n");
    return [prompt, productRuntime.contract(role), outputContractFor(role)]
      .filter(Boolean)
      .join("\n\n");
  };
  const scheduler = new TurnScheduler(runtime, journal, {
    drivers: { agent: agentRuntime, ...(script ? { script: script.driver } : {}) },
    actorRuntimes: options.plugins.actorRuntimes.all(),
    catalog,
    workspaces: options.workspaces,
    registry,
    live,
    runAvailable: (runId) => {
      try { options.assertRunUsable(runId); return true; }
      catch (error) {
        if (error instanceof DomainError) return false;
        throw error;
      }
    },
    modelSelection: (turn, actor) => {
      if (actor.execution.driver.kind !== "agent") throw new Error("Model choice requires a model actor");
      if (globalChat?.isCoordinator(turn.runId) && globalChat.model) return globalChat.model.forTurn(runtime, turn.runId, actor.id, turn.turnId);
      return isRunCoordinator(runtime, turn.runId, actor.id)
        ? coordinatorSelection(catalog, productRuntime.coordinator, storedModelChoice(journal.stateOf(turn.runId)), actor.execution.driver.config)
        : actor.execution.driver.config;
    },
    ...(workspaceToolNaming ? { workspaceToolNaming } : {}),
    basePrompt: basePromptFor,
    contract: (actor) => coreContractFor(actor),
    toolChapters: (runId, _actor, toolNames) => chaptersFor(runId, toolNames),
    inputOrientation: (runId, input) => globalChat?.inputOrientation && globalChat.isCoordinator(runId)
      ? globalChat.inputOrientation(runtime, runId, input) : "",
    onError: (error) => console.error(`Turn failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`),
  });
  const stopExternal: RunStopBoundary = (runId, stopJournal) => scheduler.haltRun(runId, async (
    runtimeStopped,
    runtimeSettled,
  ) => {
    const pluginStop = options.plugins.lifecycle.beginStopSession(runId);
    const cleanupSettled = Promise.allSettled([runtimeStopped, pluginStop.bounded]).then(() => undefined);
    const journalStopped = stopJournal(cleanupSettled);
    const boundedStop = settleRunStop(runId, [journalStopped, pluginStop.bounded]);
    let followFinalStop!: (bounded: Promise<void>) => void;
    const finalBounded = new Promise<void>((resolve) => { followFinalStop = resolve; });
    void finalBounded.catch((error: unknown) => console.error("Final plugin stop failed", error));
    const quarantine = (async () => {
      await Promise.allSettled([runtimeSettled, pluginStop.settled, journalStopped]);
      const afterStop = options.plugins.lifecycle.beginAfterStopSession(runId);
      followFinalStop(afterStop.bounded);
      const finalCleanup = await Promise.allSettled([afterStop.settled]);
      const finalJournal = await Promise.allSettled([stopJournal(Promise.resolve())]);
      afterStop.release();
      pluginStop.release();

      throwRejected([...finalCleanup, ...finalJournal], `Plugin follow-up for run ${runId} could not be cleaned up safely`);
    })();
    scheduler.quarantineRun(runId, quarantine);
    await boundedStop;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all([quarantine, finalBounded]),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error(
            `The final stop of run ${runId} exceeded the time limit of ${FINAL_RUN_STOP_TIMEOUT_MS} ms; the run stays locked until cleanup.`,
          )), FINAL_RUN_STOP_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  });
  const settleRunStop = async (runId: string, operations: readonly Promise<void>[]): Promise<void> => {
    const results = await Promise.allSettled(operations);
    throwRejected(results, `Run ${runId} could not be stopped completely`);
  };
  const runStopper = new RunStopper({
    runtime,
    primaryActorId: (view) => view.primaryActorId,
    stopExternal,
  });
  const runAccess = {
    global: globalRunPolicyOf(globalChat),
    ownerOf: (runId: string) => runOwnerOf(journal, runId),
    ownerOnly: (runId: string) => runOwnerOnly(journal, options.plugins.startOptions, runId),
    sharing: (runId: string) => runSharingOf(journal, runId),
  };
  const runtimeOptions = {
    runtime,
    assertAvailable: options.assertAvailable,
    assertRunUsable: options.assertRunUsable,
    assertRunRights: (access: AccessContext, runId: string, kind: RunRightsKind) => assertRunRights(access, runId, kind, runAccess),
    projectView: (view: RunView, access: AccessContext) => accessibleRunView(view, access, options.plugins.accessProjections),
    hasRun: (runId: string) => journal.stateOf(runId) !== null,
  };
  const methods = runtimeMethods({
    ...runtimeOptions,
    stopRun: runStopper.stop,
    interruptTurn: (runId, actorId, interruption) => scheduler.interruptTurn(runId, actorId, interruption),
    pauseRun: (runId, pause) => scheduler.pauseRun(runId, pause),
  });
  const artifactRoute = artifactContentRoute(runtimeOptions);
  options.plugins.optionalService(runtimeBridgeToken)?.bind(runtime);

  return {
    runtime,
    journal,
    scheduler,
    live,
    catalog,
    systemPrompt,
    startOptions: options.plugins.startOptions,
    systemPromptFor,
    inputCapabilities: (provider, model) => agentRuntime.inputCapabilities(provider, model),
    promptContributions: baseSnapshot.contributions,
    runtimeContracts: [
      {
        audience: "coordinator",
        content: [productRuntime.contract("primary"), outputContractFor("primary")].join("\n\n"),
      },
      {
        audience: "agent",
        content: [productRuntime.contract("worker"), outputContractFor("worker")].join("\n\n"),
      },
    ],
    methods,
    artifactRoute,
    stopRun: runStopper.stop,
    start: () => {
      scheduler.start();
    },
    shutdown: async () => {
      const results = await Promise.allSettled([
        scheduler.stop(),
        options.plugins.lifecycle.shutdown(),
        nativeTypeScriptExecutor.shutdown(),
      ]);
      journal.close();
      throwRejected(results, "RAgents shutdown failed");
    },
  };
};
