import { mkdir } from "node:fs/promises";
import {
  DirectoryArtifactContents,
  Journal,
  LiveBus,
  Orchestration,
  AgentSessionDriver,
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
  type StartOptionContributionRegistry,
  type Workspaces,
} from "@aicontainer/ragents";
import { config } from "../config.js";
import { accessibleRunView } from "../access-projection.js";
import { assertRunRights } from "../api/rights.js";
import { layout, ROOT_ONLY_MODE } from "../layout.js";
import { renderSystemPromptOption, systemPromptSelectionPromptIds } from "../plugin-support/prompt.js";
import { actorProgramsToken } from "../plugin-support/actor-programs/service.js";
import { checkedThinkingLevel } from "../plugin-support/thinking-level.js";
import { selectedSystemPrompts } from "../plugin-support/system-prompts.js";
import { productRuntimeToken, type ActorRole, type ProductActor } from "./product-runtime.js";
import { storedSystemPrompt } from "./start-option-state.js";
import { isRunCoordinator } from "./coordinator.js";
import { runtimeBridgeToken } from "./runtime-bridge.js";
import { workspaceRuntimeToken } from "./workspace-runtime.js";
import { globalChatToken } from "./global-chat.js";
import { NodeTypeScriptExecutor } from "../plugin-support/native-typescript-executor.js";
import { sandboxServicesToken } from "../plugin-support/workspace-sandbox-host.js";
import { registerTypeScriptFunctions } from "./typescript-tools.js";

const FINAL_RUN_STOP_TIMEOUT_MS = 15_000;

export class SessionWorkspaces implements Workspaces {
  readonly #roots = new Map<string, string>();

  remember(runId: string, cwd: string): void {
    this.#roots.set(runId, cwd);
  }

  forget(runId: string): void {
    this.#roots.delete(runId);
  }

  ensure(runId: string): string {
    const root = this.#roots.get(runId);
    if (!root) throw new Error(`Für die Unterhaltung ${runId} ist kein Arbeitsverzeichnis bekannt`);
    return root;
  }
}

class ProductCatalog implements ModelCatalog {
  readonly #profiles: () => readonly AgentProfile[];
  readonly modelList: readonly CatalogModel[];

  constructor(models: readonly CatalogModel[], profiles: () => readonly AgentProfile[]) {
    this.#profiles = profiles;
    this.modelList = models;
  }

  async models() {
    return this.modelList;
  }

  profiles() {
    return this.#profiles();
  }
}

export interface EngineOptions {
  plugins: PluginHost;
  workspaces: SessionWorkspaces;
  assertAvailable: () => void;
  assertRunUsable: (runId: string) => void;
  onChatSessionPersisted: (runId: string, agentId: string, file: string) => void;
}

export interface Engine {
  runtime: Orchestration;
  journal: Journal;
  scheduler: TurnScheduler;
  live: LiveBus;
  catalog: ModelCatalog;
  catalogModels: readonly CatalogModel[];
  registry: ToolRegistry;
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
  ? "Dein Modelltext wird im Chat mit dem Benutzer angezeigt. Antworte natürlich als Text."
  : "Antworte natürlich im Modelltext.";

const coreContractFor = (actor: ExecutableActor): string => {
  if (actor.toolNames?.length === 0) return "";

  const lines = [
    "Alles, was du im Modelltext schreibst, wird automatisch als Ereignis erfasst.",
    "Dein Turn endet, sobald du kein Werkzeug mehr aufrufst. Danach ruhst du bis zum nächsten ActorInput.",
  ];
  if (hasTool(actor, "actor_input", "actor.input")) {
    lines.push("Mit context.functions.actor_input gibst du einem anderen Actor einen Auftrag oder eine Rückfrage.");
  }
  if (hasTool(actor, "event_subscribe", "event.subscribe")) {
    lines.push("Mit context.functions.event_subscribe abonnierst du die Ereignisse der Actors, deren Arbeit du verfolgen willst.");
  }
  if (hasTool(actor, "event_subscription_list", "event.subscribe")) {
    lines.push("context.functions.event_subscription_list zeigt deine aktiven Ereignisabonnements.");
  }
  if (hasTool(actor, "event_unsubscribe", "event.subscribe")) {
    lines.push("Nicht mehr benötigte Abonnements beendest du mit context.functions.event_unsubscribe.");
  }
  if (hasTool(actor, "agent_spawn", "agent.spawn") && hasTool(actor, "actor_input", "actor.input")) {
    lines.push("context.functions.agent_spawn erzeugt nur den Actor. Gib ihm seinen ersten Auftrag anschließend mit context.functions.actor_input.");
  }
  return lines.join("\n");
};

export const createEngine = async (options: EngineOptions): Promise<Engine> => {
  await mkdir(layout.runsDir, { recursive: true });
  await mkdir(layout.artifactsDir, { recursive: true });

  const nativeTypeScriptExecutor = new NodeTypeScriptExecutor({
    directoryFor: (runId) => layout.sessionDir(runId) + "/native-programs",
    processContextFor: (runId) => options.plugins.service(sandboxServicesToken).processContextFor(runId),
  });
  const actorPrograms = options.plugins.optionalService(actorProgramsToken);
  const services = { ...runtimeServices, nativeTypeScriptExecutor, ...(actorPrograms ? {actorPrograms} : {}) };
  const journal = new Journal(layout.runsDir, services);
  const runtime = new Orchestration(journal, services, new DirectoryArtifactContents(layout.artifactsDir));
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
  const agentRuntime = new AgentSessionDriver({
    agentDir: config.agentHomeDir,
    resolveSkillPaths: (context) => context.runId === globalChat?.runId ? [] : options.plugins.skills.resolve(contributionContextFor(context)),
    resolveExtensionFactories: (context) => context.runId === globalChat?.runId ? [] : options.plugins.agentRuntime.resolve(contributionContextFor(context)),
    sessions: {
      directory: (runId, agentId) => layout.agentChatDir(runId, agentId),
      directoryMode: ROOT_ONLY_MODE,
      persisted: options.onChatSessionPersisted,
    },
  });
  const configuredModels = await Promise.all(options.plugins.profiles.models().map(async (model) => {
    if (model.driver !== "agent") return model;
    const supported = await agentRuntime.thinkingCapabilities(model.provider, model.model);
    const invalid = model.thinking.filter((level) => !supported.includes(level));
    if (invalid.length) throw new Error(`Die Denktiefen ${invalid.join(", ")} gibt es für ${model.provider}/${model.model} nicht; gültig: ${supported.join(", ")}.`);
    return model;
  }));
  const catalog = new ProductCatalog(configuredModels, () => options.plugins.profiles.profiles());
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
      if (!journal.stateOf(globalChat.runId)) return [];
      const view = runtime.view(globalChat.runId);
      const attachments = new Set(view.inputs.flatMap((input) => input.artifactIds));
      return [...new Set(view.artifacts.filter((artifact) => attachments.has(artifact.id)).map((artifact) => attachmentInputKind(artifact.mediaType)))]
        .filter((kind) => kind === "image" || kind === "video" || kind === "file");
    });
  }
  registerTypeScriptFunctions(options.plugins);
  const registry = new ToolRegistry();
  for (const contributor of options.plugins.tools.entries()) registry.register(contributor);
  const live = new LiveBus({
    onListenerError: (error, context) => {
      const detail = error instanceof Error ? error.stack ?? error.message : String(error);
      console.error(`Live-Listener für ${context.runId}/${context.agentId}/${context.event.kind} fehlgeschlagen: ${detail}`);
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
        throw new Error(`Der Systemprompt ${option.id} der Unterhaltung ${runId} ist nicht mehr konfiguriert`);
      }
      return text;
    });
  const boundToTools = (entry: PublicPromptContribution, toolNames: readonly string[]): boolean =>
    entry.requiresTools.some((name) => toolNames.includes(name));
  const composeWith = (texts: readonly string[], toolNames: readonly string[] | null): string => baseSnapshot
    .contributions
    .filter((entry) => entry.delivery === "initial")
    .filter((entry) => toolNames === null || entry.requiresTools.length === 0 || boundToTools(entry, toolNames))
    .map((entry) => systemPromptSelectionPromptIds.has(entry.id) ? texts.join("\n\n") : entry.content)
    .filter(Boolean)
    .join("\n\n");
  const chaptersFor = async (toolNames: readonly string[]): Promise<string> => {
    const chapters = await options.plugins.prompts.describe({
    }, { delivery: "on-demand", toolNames });
    return chapters.map((entry) => entry.content).filter(Boolean).join("\n\n");
  };
  const systemPromptFor = (runId: string): string => runId === globalChat?.runId
    ? globalChat.prompt : composeWith(textsFor(runId), null);
  const coordinatorPromptFor = (runId: string, toolNames: readonly string[]): string =>
    composeWith(textsFor(runId), toolNames);
  const agentPromptFor = (runId: string): string =>
    storedSystemPrompt(journal.stateOf(runId)).shareWithAgents ? textsFor(runId).join("\n\n") : "";
  const systemPrompt = composeWith(
    selectedSystemPrompts(promptCatalog, promptCatalog.defaultIds).map((option) => optionTexts.get(option.id) ?? ""),
    null);
  const basePromptFor = (runId: string, actor: ExecutableActor, toolNames: readonly string[]): string => {
    if (runId === globalChat?.runId) return [globalChat.prompt, outputContractFor("primary"), globalChat.contextPrompt?.(runtime, actor)].filter(Boolean).join("\n\n");
    const role = roleFor(runId, actor);
    const prompt = isRunCoordinator(runtime, runId, actor.id)
      ? coordinatorPromptFor(runId, toolNames)
      : [agentPromptFor(runId), actor.kind === "agent" ? actor.prompt : "",
          ...baseSnapshot.contributions
            .filter((entry) => entry.delivery === "initial" && boundToTools(entry, toolNames))
            .map((entry) => entry.content),
        ].filter(Boolean).join("\n\n");
    return [prompt, productRuntime.contract(role), outputContractFor(role)]
      .filter(Boolean)
      .join("\n\n");
  };
  const scheduler = new TurnScheduler(runtime, journal, {
    drivers: { agent: agentRuntime, ...(script ? { script: script.driver } : {}) },
    catalog,
    workspaces: options.workspaces,
    registry,
    live,
    modelSelection: (turn, actor) => {
      if (actor.execution.driver.kind !== "agent") throw new Error("Modellwahl benötigt einen Modell-Actor");
      return turn.runId === globalChat?.runId && globalChat.model
        ? globalChat.model.forTurn(runtime, actor.id, turn.turnId) : actor.execution.driver.config;
    },
    ...(workspaceToolNaming ? { workspaceToolNaming } : {}),
    basePrompt: basePromptFor,
    contract: (actor) => coreContractFor(actor),
    toolChapters: (_runId, _actor, toolNames) => chaptersFor(toolNames),
    onError: (error) => console.error(`Turn fehlgeschlagen: ${error instanceof Error ? error.stack ?? error.message : String(error)}`),
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
    void finalBounded.catch((error: unknown) => console.error("Abschließender Plugin-Stopp fehlgeschlagen", error));
    const quarantine = (async () => {
      await Promise.allSettled([runtimeSettled, pluginStop.settled, journalStopped]);
      const afterStop = options.plugins.lifecycle.beginAfterStopSession(runId);
      followFinalStop(afterStop.bounded);
      const finalCleanup = await Promise.allSettled([afterStop.settled]);
      const finalJournal = await Promise.allSettled([stopJournal(Promise.resolve())]);
      afterStop.release();
      pluginStop.release();

      throwRejected([...finalCleanup, ...finalJournal], `Plugin-Nachlauf für Run ${runId} konnte nicht sicher bereinigt werden`);
    })();
    scheduler.quarantineRun(runId, quarantine);
    await boundedStop;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all([quarantine, finalBounded]),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error(
            `Der abschließende Stopp von Run ${runId} hat die Zeitgrenze von ${FINAL_RUN_STOP_TIMEOUT_MS} ms überschritten; der Run bleibt bis zur Bereinigung gesperrt.`,
          )), FINAL_RUN_STOP_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  });
  const settleRunStop = async (runId: string, operations: readonly Promise<void>[]): Promise<void> => {
    const results = await Promise.allSettled(operations);
    throwRejected(results, `Run ${runId} konnte nicht vollständig gestoppt werden`);
  };
  const runStopper = new RunStopper({
    runtime,
    primaryActorId: (view) => view.primaryActorId,
    stopExternal,
  });
  const globalPolicy = globalChat?.access ? { runId: globalChat.runId, ...globalChat.access } : undefined;
  const runtimeOptions = {
    runtime,
    assertAvailable: options.assertAvailable,
    assertRunUsable: options.assertRunUsable,
    assertRunRights: (access: AccessContext, runId: string, kind: RunRightsKind) => assertRunRights(access, runId, kind, globalPolicy),
    projectView: accessibleRunView,
    hasRun: (runId: string) => journal.stateOf(runId) !== null,
  };
  const methods = runtimeMethods({ ...runtimeOptions, stopRun: runStopper.stop });
  const artifactRoute = artifactContentRoute(runtimeOptions);
  options.plugins.optionalService(runtimeBridgeToken)?.bind(runtime);

  return {
    runtime,
    journal,
    scheduler,
    live,
    catalog,
    catalogModels: catalog.modelList,
    registry,
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
      throwRejected(results, "RAgents-Shutdown fehlgeschlagen");
    },
  };
};
