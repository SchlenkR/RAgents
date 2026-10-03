import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { chmod, mkdir, open, readFile, readdir, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { ChatSessionLike, ChatSessionProvider, ListedSession, RunListScope } from "./chat-handler.js";
import { canStartEntry, createAccessContext, DomainError, isRunId, notShared, unrestrictedAccess, type AccessContext, type HttpRouteContribution, type Journal, type JournalLoadFailure, type MethodContribution, type PluginHost, type RunSharing, type ServiceToken, type SessionStartedContext } from "@ragents/engine";
import { WORKSPACE_EXECUTOR_VERSION } from "@ragents/workspace-executor";
import { assertRunOperable, assertRunRights, assertRunWorkspaceAccess, runIdInPath, runListScope, runReachable, sharingUnavailable, type GlobalRunPolicy, type RunAccessPolicy } from "./api/rights.js";
import type { RunSharingResult } from "./api/contracts.js";
import { configuredAnonymousUser, configuredUsers } from "./config-file.js";
import { accessibleRunView } from "./access-projection.js";
import { coordinatorAccessToken } from "./access-service.js";
import { config } from "./config.js";
import { layout, ROOT_ONLY_MODE, SESSION_MODE, SESSIONS_MODE } from "./layout.js";
import { readHostPackage, readHostVersion } from "./host-version.js";
import {
  assertRunIdFree,
  assertRunStopped,
  assertWorkspaceReplacement,
  contentHashesOf,
  installContents,
  installSessionDirectory,
  packRunArchive,
  runTransferStagingDirectory,
  RUN_TRANSFER_FORMAT_VERSION,
  unpackRunArchive,
  type RunTransferExport,
  type RunTransferImport,
  type RunTransferManifest,
  type RunTransferPlaces,
} from "./run-transfer.js";
import type { StartOptionState } from "./plugin-support/start-options-contract.js";
import { ALIAS_PROVIDER, validatedModelAliases } from "./plugin-support/model-aliases.js";
import { configuredModelProviders, modelProviderRegistration } from "./plugin-support/model-providers.js";
import { runScriptFromDirectory } from "./plugin-support/run-scripts.js";
import { createEngine, SessionWorkspaces, type Engine } from "./ragents/engine.js";
import type { ProductProfileFactory } from "./ragents/host-services.js";
import { actorProgramsToken } from "./plugin-support/actor-programs/service.js";
import { productRuntimeToken } from "./ragents/product-runtime.js";
import { runOwnerOf, runOwnerOnly, runSharingOf } from "./ragents/run-owner.js";
import { RunChatSession } from "./ragents/session.js";
import { globalChatToken, globalRunPolicyOf, type GlobalChatPolicy, type ManagedRunStart, type RunManagement } from "./ragents/global-chat.js";
import { workspaceRuntimeToken, type SessionWorkspace, type WorkspaceTransfer } from "./ragents/workspace-runtime.js";
import { settingsResponse, skillDetailResponse, type SettingsResponse, type SettingsSkillDetail } from "./settings.js";
import { createTitleCompactor, MAX_TITLE_CHARS } from "./title-compactor.js";
import { ModelRuntime } from "@ragents/agent";
import { TitleSettingsStore } from "./title-settings.js";
import { sandboxServicesToken } from "./plugin-support/workspace-sandbox-host.js";
import { parseRunPreparationRequest, prepareRunMessage } from "./run-preparation.js";
import type { RunPreparationResponse } from "./run-preparation-contract.js";
import { runListStateOf } from "./run-list-state.js";
import { RunReadMarkers } from "./run-read-markers.js";
import { checkedProfileSharing, sharingResultOf, type ShareableUser } from "./run-sharing.js";

/** The commit of the running host: from the built package, otherwise from the checkout. */
const hostVersionOf = (): string => readHostPackage()?.hostVersion ?? readHostVersion();

/** accepted: the delete intent is durable and the run is hidden; done: the cleanup job has finished. */
interface DeleteJob { accepted: Promise<void>; done: Promise<void> }

/** The run list is queried often; this is the longest it waits for a metadata contribution. */
export const SESSION_METADATA_TIMEOUT_MS = 1_500;

/** A viewed run reaches the user's other list listeners at most this often, because a viewed running run reports every revision. */
export const READ_MARKER_NOTICE_INTERVAL_MS = 1_000;

export class RunSessionProvider implements ChatSessionProvider {
  private readonly sessions = new Map<string, RunChatSession>();
  private readonly deleting = new Map<string, DeleteJob>();
  private readonly deleteRequested = new Set<string>();
  private readonly deleted = new Set<string>();
  private readonly workspaces = new SessionWorkspaces(() => this.plugins.service(sandboxServicesToken));
  private readonly sessionWorkspaces = new Map<string, Promise<SessionWorkspace>>();
  private modelRuntime: Promise<ModelRuntime> | undefined;
  private readonly runPreparations = new Map<string, { controller: AbortController; done: Promise<RunPreparationResponse> }>();
  private titleSettings: TitleSettingsStore | undefined;
  private readMarkers: RunReadMarkers | undefined;
  private readonly listListeners = new Set<{ readonly listener: () => void; readonly userId: string | null }>();
  /** Users whose listeners heard of a read marker within the last interval; true if another change waits for its end. */
  private readonly readMarkerNotices = new Map<string | null, boolean>();
  private readonly titleCompactor = createTitleCompactor({
    selection: () => this.requireTitleSettings().selection(),
    sessionsDir: layout.sessionsDir,
    modelRuntime: () => this.getModelRuntime(),
    onTitle: () => this.notifyList(),
    onError: (error) => console.warn("Title compaction failed:", error),
  });
  readonly plugins: PluginHost;
  private shutdownPromise: Promise<void> | undefined;
  private engine: Engine | undefined;
  private readonly globalResets = new Map<string, Promise<void>>();
  private readonly globalResetsRequested = new Set<string>();
  private transferring = false;
  /** The address at which this server offers its API; none without HTTP (stdio only). */
  private readonly apiBaseUrl: string | undefined;

  constructor(profileFactory: ProductProfileFactory, apiBaseUrl: string | undefined) {
    this.apiBaseUrl = apiBaseUrl;
    this.plugins = profileFactory({
      ensureSession: (runId) => this.ensureUsable(runId),
      ensureWorkspaceAccess: (access, runId) => {
        this.ensureUsable(runId);
        assertRunWorkspaceAccess(access, runId, this.runAccess());
      },
      runtime: () => this.requireEngine().runtime,
      sessionWorkspaceFor: (runId) => this.sessionWorkspace(runId, () => {}),
      sessions: () => this.sessionManagement(),
      modelRuntime: () => this.getModelRuntime(),
      ...(apiBaseUrl === undefined ? {} : { apiBaseUrl }),
    });
  }

  private requireContract(token: ServiceToken<unknown>): void {
    if (this.plugins.optionalService(token) !== undefined) return;
    throw new Error(
      `The profile does not provide the required contract ${token.id}. `
      + "A product plugin must register it with host.provide(...).",
    );
  }

  async init(): Promise<void> {
    this.titleSettings = await TitleSettingsStore.create(path.join(config.dataDir, "title-settings.json"), await this.getModelRuntime(),
      config.compactionModel ? { provider: config.compactionProvider, model: config.compactionModel } : null, config.compactionProvider);
    this.readMarkers = await RunReadMarkers.load(layout.readMarkersFile);
    await mkdir(layout.sessionsDir, { recursive: true, mode: SESSIONS_MODE });
    await chmod(layout.sessionsDir, SESSIONS_MODE);
    await mkdir(layout.archiveDir, { recursive: true, mode: ROOT_ONLY_MODE });
    await chmod(layout.archiveDir, ROOT_ONLY_MODE);
    await mkdir(layout.recoveryDir, { recursive: true, mode: ROOT_ONLY_MODE });
    await chmod(layout.recoveryDir, ROOT_ONLY_MODE);
    for (const id of await this.loadArchivedRunIds()) this.deleted.add(id);
    await mkdir(layout.deleteIntentsDir, { recursive: true, mode: ROOT_ONLY_MODE });
    await chmod(layout.deleteIntentsDir, ROOT_ONLY_MODE);
    const pendingDeletes = await this.loadDeleteIntents();
    for (const id of pendingDeletes) this.deleteRequested.add(id);
    await this.plugins.initialize();
    const entries = this.plugins.startEntries.describe();
    const anonymousUser = configuredAnonymousUser();
    for (const user of [...configuredUsers() ?? [], ...anonymousUser ? [anonymousUser] : []]) {
      for (const id of user.startEntries ?? []) {
        const entry = entries.find((candidate) => candidate.id === id);
        if (!entry || entry.action !== "script") throw new Error(`User ${user.id}: ${id} is not a registered run setup`);
      }
    }
    this.requireContract(productRuntimeToken);
    this.requireContract(workspaceRuntimeToken);
    const globalChat = this.plugins.optionalService(globalChatToken);
    if (globalChat?.resetIntentDirectory && existsSync(globalChat.resetIntentDirectory)) {
      for (const entry of await readdir(globalChat.resetIntentDirectory)) {
        if (!entry.endsWith(".json")) continue;
        const intentFile = path.join(globalChat.resetIntentDirectory, entry);
        const runId = entry.slice(0, -5);
        await this.validateGlobalResetIntent(intentFile, runId);
        await this.removeGlobalConversation(runId);
        await rm(intentFile);
        await this.syncDirectory(globalChat.resetIntentDirectory);
      }
    }
    this.engine = await createEngine({
      plugins: this.plugins,
      workspaces: this.workspaces,
      modelRuntime: this.getModelRuntime(),
      assertAvailable: () => this.ensureAvailable(),
      assertRunUsable: (runId) => this.ensureUsable(runId),
    });
    // A changed sharing changes whose list shows the run.
    this.engine.journal.subscribe((events) => {
      if (events.some((event) => event.type === "run.sharing-changed")) this.notifyList();
    });
    for (const id of this.deleted) {
      if (this.deleteRequested.has(id)) continue;
      if (this.engine.journal.stateOf(id) || existsSync(layout.sessionDir(id))) {
        throw new Error(`Archived run ${id} has active data again`);
      }
    }
    for (const id of pendingDeletes) await this.beginDelete(id).done;
    this.requireReadMarkers().forgetRuns(this.deleted);
    // A coordinator without a current access (the former shared one, a removed user) stays untouched.
    const runIds = this.engine.journal.runIds().filter((runId) => !globalChat?.isCoordinator(runId) || this.coordinatorUser(runId) !== undefined);
    await Promise.all(runIds.map((runId) => this.sessionWorkspace(runId, () => {})));
    for (const runId of runIds) this.openSession(runId);
    this.engine.start();
  }

  private requireEngine(): Engine {
    if (!this.engine) throw new Error("The engine has not started yet");
    return this.engine;
  }

  /** The server's one model runtime; the plugins' and the profile's providers and the profile's aliases are in place before anyone looks up a model. */
  private getModelRuntime(): Promise<ModelRuntime> {
    return this.modelRuntime ??= this.plugins.profiles.providers().then((providers) => {
      const runtime = ModelRuntime.create();
      const profileProviders = configuredModelProviders().map(modelProviderRegistration);
      const taken = profileProviders.find((provider) => providers.some((other) => other.id === provider.id));
      if (taken) throw new Error(`MODEL_PROVIDERS: the provider ${taken.id} is already registered by a plugin`);
      for (const provider of [...providers, ...profileProviders]) runtime.registerProvider(provider.id, provider.config);
      const aliases = validatedModelAliases();
      if (aliases.length > 0) runtime.registerAliases(ALIAS_PROVIDER, aliases);
      return runtime;
    });
  }

  private requireTitleSettings(): TitleSettingsStore {
    if (!this.titleSettings) throw new Error("The title model settings are not loaded yet.");
    return this.titleSettings;
  }

  private requireReadMarkers(): RunReadMarkers {
    if (!this.readMarkers) throw new Error("The read markers are not loaded yet.");
    return this.readMarkers;
  }

  titleModelSettings() { return this.requireTitleSettings().get(); }

  saveTitleModelSettings(value: unknown) { return this.requireTitleSettings().save(value); }

  subscribeList(listener: () => void, userId: string | null): () => void {
    const entry = { listener, userId };
    this.listListeners.add(entry);
    return () => { this.listListeners.delete(entry); };
  }

  /** The caller has seen the run up to this revision; only a higher revision counts, and only its user hears of it. */
  markViewed(id: string, revision: number, userId: string | null): void {
    this.ensureUsable(id);
    if (this.plugins.optionalService(globalChatToken)?.isCoordinator(id)) {
      throw new DomainError("run-not-listed", "The top-level coordinator is not part of the run list and keeps no read marker.", 409);
    }
    const state = this.requireEngine().journal.stateOf(id);
    if (!state) throw new DomainError("run-not-found", `The run ${id} does not exist`, 404);
    if (revision > state.revision) throw new DomainError("revision-ahead", `The run ${id} is at revision ${state.revision}, not ${revision}.`, 400);
    if (this.requireReadMarkers().markViewed(userId, id, revision)) this.noticeReadMarker(userId);
  }

  async get(id: string): Promise<ChatSessionLike> {
    this.ensureUsable(id);
    return this.openSession(id);
  }

  private openSession(id: string, initialTitle?: string): RunChatSession {
    this.ensureUsable(id);
    const existing = this.sessions.get(id);
    if (existing) return existing;
    const engine = this.requireEngine();
    const productRuntime = this.plugins.service(productRuntimeToken);
    const globalChat = this.plugins.optionalService(globalChatToken);
    const globalPolicy = globalChat?.isCoordinator(id) ? globalChat : undefined;
    const session = new RunChatSession({
      engine,
      id,
      coordinator: globalPolicy ? { ...productRuntime.coordinator, displayName: globalPolicy.title } : productRuntime.coordinator,
      initialTitle: globalPolicy?.title ?? initialTitle,
      ...(globalPolicy ? { toolNames: globalPolicy.toolNames } : {}),
      ...(globalPolicy?.model ? { modelSelection: () => globalPolicy.model!.selection() } : {}),
      ...(globalPolicy?.inputContext ? { inputContext: globalPolicy.inputContext } : {}),
      prompt: () => engine.systemPromptFor(id),
      assertUsable: (runId) => {
        this.ensureUsable(runId);
        if (!globalPolicy || !engine.journal.stateOf(runId)) return;
        const view = engine.runtime.view(runId);
        const primary = view.actors.find((actor) => actor.id === view.primaryActorId);
        if (primary && primary.kind !== "human" && (primary.toolNames === null
          || [...primary.toolNames].sort().join("\n") !== [...globalPolicy.toolNames].sort().join("\n"))) {
          throw new DomainError("global-tools-changed", "The tools of the top-level coordinator have changed. Reset its conversation to use the current tools.", 409);
        }
      },
      prepare: (runId) => this.prepareRun(runId),
      prepareWorkspace: (runId, emitSystem) => this.prepareWorkspace(runId, emitSystem),
      started: (runId, startEntry) => this.startedRun(runId, startEntry),
      scriptEntryFor: (entryId) => globalPolicy ? undefined : this.plugins.startEntries.scriptPackage(entryId),
      startEntryFor: (entryId) => globalPolicy ? undefined : this.plugins.startEntries.entry(entryId),
      actorPrograms: {
        installScript: (...args) => this.plugins.service(actorProgramsToken).installScript(...args),
        enqueueStart: (...args) => this.plugins.service(actorProgramsToken).enqueueStart(...args),
        isScriptActor: (runId, actorId) => this.plugins.optionalService(actorProgramsToken)?.isScriptActor(runId, actorId) ?? false,
      },
    });
    this.sessions.set(id, session);
    session.attach();
    return session;
  }

  startOptions(id: string, userId: string | null): readonly StartOptionState[] {
    return this.openSession(id).startOptions(userId);
  }

  selectStartOption(id: string, optionId: string, value: unknown, userId: string | null): Promise<StartOptionState> {
    return this.openSession(id).selectStartOption(optionId, value, userId);
  }

  async prepareRunMessage(id: string, value: unknown, signal: AbortSignal, userId: string | null): Promise<RunPreparationResponse> {
    this.ensureUsable(id);
    if (this.runPreparations.has(id)) throw new DomainError("preparation-busy", "A response for this preparation is already being created.", 409);
    const request = parseRunPreparationRequest(value);
    const session = this.openSession(id);
    const selection = session.preparationSelection(userId);
    const prompt = this.plugins.optionalService(globalChatToken)?.preparationPrompt;
    if (!prompt) throw new DomainError("preparation-unavailable", "The profile provides no preparation coordinator.", 409);
    const controller = new AbortController();
    const combined = AbortSignal.any([signal, controller.signal]);
    const done = this.getModelRuntime().then(async (runtime) => {
      this.ensureUsable(id);
      session.preparationSelection(userId);
      const result = await prepareRunMessage({ runtime, selection, request, prompt, signal: combined });
      this.ensureUsable(id);
      session.preparationSelection(userId);
      return result;
    }).finally(() => this.runPreparations.delete(id));
    this.runPreparations.set(id, { controller, done });
    return done;
  }

  /** Only visible runs get titles and metadata; without a scope all of them, without a workspace that only its owner operates, and without sharing details and read markers. */
  async list(scope?: RunListScope): Promise<ListedSession[]> {
    const visible = scope?.visible ?? (() => true);
    const workspaceAccessible = scope?.workspaceAccessible ?? ((runId: string) => !this.runOwnerOnly(runId));
    const operable = scope?.operable ?? ((runId: string) => !this.runOwnerOnly(runId));
    const engine = this.requireEngine();
    const productRuntime = this.plugins.service(productRuntimeToken);
    const isCoordinator = (runId: string) => this.plugins.optionalService(globalChatToken)?.isCoordinator(runId) ?? false;
    const listed = engine.journal.runIds().filter((runId) => !isCoordinator(runId)
      && !this.deleteRequested.has(runId) && !this.deleted.has(runId) && visible(runId));
    const anonymousUser = configuredAnonymousUser();
    const userLabels = new Map([...configuredUsers() ?? [], ...anonymousUser ? [anonymousUser] : []].map((user) => [user.id, user.label]));
    const described = await Promise.all(listed.map(async (runId): Promise<ListedSession | undefined> => {
      const state = engine.journal.stateOf(runId);
      if (!state) return undefined;
      const firstInput = [...state.inputs.values()]
        .sort((left, right) => left.sequence - right.sequence)
        .find((input) => input.enqueuedBy === state.ownerId);
      // A title set on purpose (run script, run_configure) beats the first-message heuristic.
      const chosenTitle = state.title !== productRuntime.coordinator.runTitle ? state.title : undefined;
      const workspace = workspaceAccessible(runId);
      const [compactTitle, metadata] = await Promise.all([
        chosenTitle ?? this.titleCompactor.titleFor(runId, firstInput?.content),
        this.plugins.sessionMetadata.describe(runId, workspace, SESSION_METADATA_TIMEOUT_MS),
      ]);
      const running = [...state.actors.values()].some((actor) => actor.kind !== "human" && engine.scheduler.isRunning(runId, actor.id))
        || (this.sessions.get(runId)?.running ?? false);
      const seenRevision = scope ? this.requireReadMarkers().seenRevision(scope.userId, runId) : undefined;
      return {
        id: runId,
        title: compactTitle ?? sessionTitle(firstInput?.content) ?? productRuntime.coordinator.runTitle,
        createdAt: Date.parse(state.createdAt),
        updatedAt: Date.parse(engine.journal.updatedAt(runId) ?? state.createdAt),
        revision: state.revision,
        running,
        ...runListStateOf(state, running),
        workspaceAccessible: workspace,
        operable: operable(runId),
        ...scope?.sharing(runId),
        ...(state.ownerUserId !== null ? { ownerLabel: userLabels.get(state.ownerUserId) ?? state.ownerUserId } : {}),
        ...(seenRevision !== undefined ? { seenRevision } : {}),
        metadata: metadata.values,
        ...(Object.keys(metadata.unavailable).length > 0 ? { metadataUnavailable: metadata.unavailable } : {}),
        ...(metadata.listDetails.length > 0 ? { listDetails: metadata.listDetails } : {}),
      };
    }));
    const locked = engine.journal.unavailableRuns()
      .filter(({ runId }) => !isCoordinator(runId) && !this.deleteRequested.has(runId) && !this.deleted.has(runId) && visible(runId))
      .map((failure) => lockedSession(failure, engine.journal));
    const infos = [...described.filter((info): info is ListedSession => info !== undefined), ...locked];
    for (const [id, session] of this.sessions) {
      if (isCoordinator(id) || !visible(id)) continue;
      if (this.deleteRequested.has(id) || this.deleted.has(id)) continue;
      if (!session.started || infos.some((info) => info.id === id)) continue;
      infos.push({
        id,
        title: productRuntime.coordinator.runTitle,
        updatedAt: Date.now(),
        running: session.running,
        state: session.running ? "running" : "idle",
        pendingActions: 0,
        workspaceAccessible: workspaceAccessible(id),
        operable: operable(id),
      });
    }
    return infos.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private sessionManagement(): RunManagement {
    return {
      list: (access) => this.list(access ? runListScope(access, this.runAccess()) : undefined),
      view: (runId) => {
        this.ensureUsable(runId);
        return this.requireEngine().runtime.view(runId);
      },
      events: (runId) => {
        this.ensureUsable(runId);
        return this.requireEngine().runtime.events(runId);
      },
      create: (start) => this.createManagedRun(start),
      send: (runId, message, access) => {
        assertRunRights(access, runId, "write", this.runAccess());
        return this.openSession(runId).sendAndWait(message, access.user ? { id: access.user.id, label: access.user.label } : undefined);
      },
      stop: (runId, access) => {
        if (access) assertRunRights(access, runId, "stop", this.runAccess());
        return this.openSession(runId).stop();
      },
      resetGlobal: (runId) => this.resetGlobalConversation(runId),
      scripts: (runId) => {
        const access = this.ownerAccess(runId);
        return this.openSession(runId).runScripts(this.plugins.startEntries.describe().filter((entry) => canStartEntry(access, entry.id)), access.user?.id ?? null);
      },
      startScript: (runId, entryId, input, startedBy) => {
        const access = this.ownerAccess(runId);
        if (!canStartEntry(access, entryId)) throw new DomainError("access-denied", `The run script ${entryId} is not enabled for the owner of this run.`, 403);
        return this.openSession(runId).startAndWait(entryId, input, access.user ? { id: access.user.id, label: access.user.label } : undefined, startedBy);
      },
    };
  }

  /** The owner's access as a user of this profile; the run's own actors start run scripts with it. */
  private ownerAccess(runId: string): AccessContext {
    this.ensureUsable(runId);
    const users = configuredUsers();
    const ownerUserId = this.requireEngine().journal.stateOf(runId)?.ownerUserId ?? null;
    return createAccessContext(ownerUserId === null
      ? { enabled: users !== undefined, user: users ? null : configuredAnonymousUser() ?? null }
      : { enabled: true, user: users?.find((user) => user.id === ownerUserId) ?? null });
  }

  private async createManagedRun(start: ManagedRunStart): Promise<string> {
    const local = start.kind === "package" ? runScriptFromDirectory(start.directory) : undefined;
    const id = randomUUID();
    const session = this.openSession(id, start.title);
    const user = start.user ?? undefined;
    for (const [optionId, value] of Object.entries(start.options ?? {})) await session.selectStartOption(optionId, value, start.user?.id ?? null);
    if (start.sharing) {
      if (!user || configuredUsers() === undefined) throw sharingUnavailable();
      session.shareBeforeStart(user.id, checkedProfileSharing(start.sharing, user.id, notShared(), this.shareableUsers()));
    }
    if (start.kind === "script") await session.startAndWait(start.entryId, start.input, user);
    else if (start.kind === "package") {
      if (!local) throw new Error("The run script package was not loaded");
      const { script, ...entry } = local;
      await session.startPackageAndWait({ ...script, entry: { ...entry, coordinator: script.coordinator, owner: start.owner } }, start.input, user);
    }
    else await session.sendAndWait(start.message, user);
    return id;
  }

  engineMethods(): readonly MethodContribution[] {
    return this.requireEngine().methods;
  }

  engineArtifactRoute(): HttpRouteContribution {
    return this.requireEngine().artifactRoute;
  }

  globalPolicy(): GlobalRunPolicy | undefined {
    return globalRunPolicyOf(this.plugins.optionalService(globalChatToken));
  }

  runOwner(id: string): string | null | undefined {
    return runOwnerOf(this.requireEngine().journal, id);
  }

  runOwnerOnly(id: string): boolean {
    return runOwnerOnly(this.requireEngine().journal, this.plugins.startOptions, id);
  }

  runSharing(id: string): RunSharing {
    return runSharingOf(this.requireEngine().journal, id);
  }

  runAccess(): RunAccessPolicy {
    return {
      global: this.globalPolicy(),
      ownerOf: (runId) => this.runOwner(runId),
      ownerOnly: (runId) => this.runOwnerOnly(runId),
      sharing: (runId) => this.runSharing(runId),
    };
  }

  /** The users of the profile by id and display name; without sign-in none. */
  private shareableUsers(): readonly ShareableUser[] {
    return (configuredUsers() ?? []).map((user) => ({ id: user.id, label: user.label }));
  }

  /** The sharing for a user who may change it; before the start the choice of this user, who will own the run. */
  sharing(id: string, userId: string): RunSharingResult {
    this.ensureUsable(id);
    const state = this.requireEngine().journal.stateOf(id);
    return state
      ? sharingResultOf(state.sharing, state.ownerUserId, this.shareableUsers())
      : sharingResultOf(this.openSession(id).sharingBeforeStart(userId), userId, this.shareableUsers());
  }

  /** Replaces the sharing for a user who may change it: before the start it waits in the run for its creation, afterwards it is a journal event of the owner. */
  share(id: string, sharing: RunSharing, userId: string): RunSharingResult {
    this.ensureUsable(id);
    const engine = this.requireEngine();
    const state = engine.journal.stateOf(id);
    if (!state) {
      const session = this.openSession(id);
      session.shareBeforeStart(userId, checkedProfileSharing(sharing, userId, session.sharingBeforeStart(userId), this.shareableUsers()));
      return this.sharing(id, userId);
    }
    const checked = checkedProfileSharing(sharing, state.ownerUserId, state.sharing, this.shareableUsers());
    engine.runtime.shareRun({ actorId: state.ownerId, commandId: `share:${id}:${randomUUID()}` }, id, { sharing: checked, changedBy: userId });
    return this.sharing(id, userId);
  }

  /** Whenever whom the run is shared with changes, and with it who may reach it. */
  watchRunAccess(id: string, listener: () => void): () => void {
    return this.requireEngine().journal.subscribe((events) => {
      if (events.some((event) => event.runId === id && event.type === "run.sharing-changed")) listener();
    });
  }

  runView(id: string, access: AccessContext = unrestrictedAccess): unknown {
    this.ensureUsable(id);
    return accessibleRunView(this.requireEngine().runtime.view(id), access, this.plugins.accessProjections);
  }

  hasRun(id: string): boolean {
    return this.requireEngine().journal.stateOf(id) !== null;
  }

  subscribeRun(id: string, listener: () => void): () => void {
    return this.requireEngine().journal.subscribe((events) => {
      if (events.some((event) => event.runId === id)) listener();
    });
  }

  settings(): Promise<SettingsResponse> {
    return settingsResponse(this.requireEngine(), this.plugins);
  }

  skill(id: string): Promise<SettingsSkillDetail | null> {
    return skillDetailResponse(this.plugins, id);
  }

  isPluginApiPath(pathname: string): boolean {
    return pathname === "/rpc" || pathname === "/rpc/stream" || pathname.startsWith("/files/") || this.plugins.isApiPath(pathname);
  }

  /** The access a delivery address carries itself, such as a grant in its path; it stands in for the sign-in of the request. */
  accessFromAddress(req: IncomingMessage, url: URL): AccessContext | undefined {
    return this.plugins.httpAccessFromAddress(req, url);
  }

  /** Delivery routes name their run in the path; another user's run is as unreachable there as in a method, and a writing request operates it. */
  async pluginRoutes(req: IncomingMessage, res: ServerResponse, url: URL, access?: AccessContext): Promise<boolean> {
    const named = runIdInPath(url.pathname);
    if (named !== undefined && access && !runReachable(access, named, this.runAccess())) {
      res.writeHead(404, { "Cache-Control": "no-store", "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Run ${named} does not exist.`, code: "run-not-found" }));
      return true;
    }
    if (named !== undefined && access && !["GET", "HEAD", "OPTIONS"].includes(req.method ?? "")) {
      try {
        assertRunOperable(access, named, this.runAccess());
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        res.writeHead(error.status, { "Cache-Control": "no-store", "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: error.message, code: error.code }));
        return true;
      }
    }
    return this.plugins.dispatchHttp(req, res, url, access);
  }

  private ensureUsable(id: string): void {
    if (!isRunId(id)) throw new DomainError("invalid-run", `Invalid run id: ${id}`, 400);
    this.ensureAvailable();
    if (this.globalResetsRequested.has(id)) {
      throw new DomainError("conversation-resetting", "The global conversation is being reset. Please wait a moment or repeat the reset after an error.", 409);
    }
    if (this.deleteRequested.has(id)) throw new DomainError("run-deleting", "The run is being deleted", 409);
    if (this.deleted.has(id)) throw new DomainError("run-deleted", "The run was deleted", 410);
    this.engine?.journal.assertRunAvailable(id);
  }

  private ensureAvailable(): void {
    if (this.shutdownPromise) throw new DomainError("server-stopping", "The server is shutting down", 503);
  }

  private sessionWorkspace(id: string, emitSystem: (text: string) => void): Promise<SessionWorkspace> {
    this.ensureUsable(id);
    const running = this.sessionWorkspaces.get(id);
    if (running) return running;
    const created = this.resolveWorkspace(id, emitSystem)
      .then((workspace) => {
        this.ensureUsable(id);
        this.workspaces.remember(id, workspace.cwd, workspace.description);
        return workspace;
      })
      .catch((error: unknown) => {
        this.sessionWorkspaces.delete(id);
        throw error;
      });
    this.sessionWorkspaces.set(id, created);
    return created;
  }

  private async prepareRun(id: string): Promise<void> {
    this.ensureUsable(id);
    if (!this.plugins.optionalService(globalChatToken)?.isCoordinator(id)) await this.plugins.lifecycle.prepareSession(id);
    this.ensureUsable(id);
  }

  private async startedRun(id: string, startEntry: SessionStartedContext["startEntry"]): Promise<void> {
    this.ensureUsable(id);
    if (!this.plugins.optionalService(globalChatToken)?.isCoordinator(id)) await this.plugins.lifecycle.sessionStarted(id, startEntry);
  }

  private async prepareWorkspace(id: string, emitSystem: (text: string) => void): Promise<void> {
    this.ensureUsable(id);
    await this.sessionWorkspace(id, emitSystem);
    this.ensureUsable(id);
  }

  delete(id: string): Promise<void> {
    if (this.plugins.optionalService(globalChatToken)?.isCoordinator(id)) {
      return Promise.reject(new DomainError("global-chat-protected", "The global coordinator cannot be deleted", 409));
    }
    if (!isRunId(id)) return Promise.reject(new Error(`Invalid run id: ${id}`));
    if (this.shutdownPromise) return Promise.reject(new Error("The server is shutting down"));
    return this.beginDelete(id).accepted;
  }

  deletion(id: string): Promise<void> | undefined {
    return this.deleting.get(id)?.done;
  }

  /** A stopped run as an archive: journal, payloads, the contents it refers to, and its plugin storage. */
  exportRun(id: string): Promise<RunTransferExport> {
    this.ensureUsable(id);
    if (this.plugins.optionalService(globalChatToken)?.isCoordinator(id)) {
      return Promise.reject(new DomainError("global-chat-protected", "The global coordinator does not move", 409));
    }
    return this.runTransfer(async () => {
      const engine = this.requireEngine();
      const state = engine.journal.stateOf(id);
      if (!state) throw new DomainError("run-not-found", `The run ${id} does not exist`, 404);
      assertRunStopped({
        runId: id,
        state,
        isRunning: (actorId) => engine.scheduler.isRunning(id, actorId),
        sessionRunning: this.sessions.get(id)?.running ?? false,
      });
      const manifest: RunTransferManifest = {
        formatVersion: RUN_TRANSFER_FORMAT_VERSION,
        runId: id,
        hostVersion: hostVersionOf(),
        executorVersion: WORKSPACE_EXECUTOR_VERSION,
        profile: config.productProfile,
        title: state.title,
        revision: state.revision,
        events: engine.journal.load(id).length,
        boundDirectory: this.workspaceTransfer().boundDirectory(id),
        exportedAt: new Date().toISOString(),
      };
      const archive = await packRunArchive({
        places: this.transferPlaces(),
        runId: id,
        manifest,
        contentHashes: contentHashesOf(engine.journal.load(id)),
      });
      return { manifest, archive: archive.toString("base64") };
    });
  }

  /** Accepts an archive, replays its journal and opens the run stopped; `workspacePath` replaces a binding to a project folder. */
  importRun(archive: Buffer, workspacePath: string | undefined): Promise<RunTransferImport> {
    this.ensureAvailable();
    return this.runTransfer(async () => {
      const places = this.transferPlaces();
      const staging = runTransferStagingDirectory(config.dataDir, "import");
      try {
        const unpacked = await unpackRunArchive({ places, archive, staging });
        const { manifest } = unpacked;
        this.assertRunIdAvailable(manifest.runId);
        const transfer = this.workspaceTransfer();
        assertWorkspaceReplacement(manifest, workspacePath);
        if (workspacePath !== undefined) transfer.assertDirectory(workspacePath);
        const sessionDirectory = await installSessionDirectory({ places, runId: manifest.runId, staging, mode: SESSION_MODE });
        await installContents({ places, staging });
        const engine = this.requireEngine();
        try {
          engine.journal.adopt(unpacked.records);
        } catch (error) {
          if (sessionDirectory) await rm(sessionDirectory, { recursive: true, force: true });
          throw error;
        }
        if (workspacePath !== undefined) transfer.rebind(manifest.runId, workspacePath);
        const workspace = await this.sessionWorkspace(manifest.runId, () => undefined);
        this.openSession(manifest.runId);
        this.notifyList();
        const events = engine.journal.load(manifest.runId);
        return {
          manifest,
          sequence: events.at(-1)?.sequence ?? 0,
          events: events.length,
          workspace: workspace.cwd,
          boundDirectory: transfer.boundDirectory(manifest.runId),
        };
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
    });
  }

  private transferPlaces(): RunTransferPlaces {
    return { dataDirectory: config.dataDir, hostVersion: hostVersionOf(), executorVersion: WORKSPACE_EXECUTOR_VERSION };
  }

  private workspaceTransfer(): WorkspaceTransfer {
    const transfer = this.plugins.service(workspaceRuntimeToken).transfer;
    if (!transfer) {
      throw new DomainError("run-transfer-unsupported", "This profile does not support moving runs: its workspace reports no binding.", 409);
    }
    return transfer;
  }

  private runTransfer<T>(work: () => Promise<T>): Promise<T> {
    if (this.transferring) return Promise.reject(new DomainError("run-transfer-busy", "Another run move is in progress on this server.", 409));
    this.transferring = true;
    return work().finally(() => { this.transferring = false; });
  }

  private assertRunIdAvailable(id: string): void {
    if (this.plugins.optionalService(globalChatToken)?.isCoordinator(id)) {
      throw new DomainError("run-transfer-exists", `The id ${id} is reserved for the top-level coordinators of this server.`, 409);
    }
    const engine = this.requireEngine();
    assertRunIdFree({
      runId: id,
      known: Boolean(engine.journal.stateOf(id) || engine.journal.failureOf(id)) || this.deleted.has(id) || this.deleteRequested.has(id),
      directories: [path.join(layout.runsDir, id), layout.sessionDir(id), layout.archiveSessionDir(id)],
    });
  }

  private resetGlobalConversation(id: string): Promise<void> {
    this.ensureAvailable();
    const running = this.globalResets.get(id);
    if (running) return running;
    const policy = this.plugins.optionalService(globalChatToken);
    if (!policy?.resetIntentDirectory) return Promise.reject(new DomainError("conversation-reset-unavailable", "This profile offers no conversation reset.", 404));
    if (!policy.isCoordinator(id)) return Promise.reject(new DomainError("conversation-reset-unavailable", `${id} is not a global coordinator.`, 404));
    const intentFile = path.join(policy.resetIntentDirectory, `${id}.json`);
    this.globalResetsRequested.add(id);
    const operation = this.resetGlobalInner(id, intentFile, policy).catch((error: unknown) => {
      if (!existsSync(intentFile)) this.globalResetsRequested.delete(id);
      throw error;
    }).finally(() => {
      if (this.globalResets.get(id) === operation) this.globalResets.delete(id);
    });
    this.globalResets.set(id, operation);
    return operation;
  }

  private async resetGlobalInner(id: string, intentFile: string, policy: GlobalChatPolicy): Promise<void> {
    if (!existsSync(intentFile)) {
      await mkdir(path.dirname(intentFile), { recursive: true });
      const temporary = `${intentFile}.tmp-${randomUUID()}`;
      try {
        const marker = await open(temporary, "wx", 0o600);
        try { await marker.writeFile(JSON.stringify({ version: 1, runId: id })); await marker.sync(); }
        finally { await marker.close(); }
        await rename(temporary, intentFile);
        await this.syncDirectory(path.dirname(intentFile));
      } finally { await rm(temporary, { force: true }); }
    }
    await this.validateGlobalResetIntent(intentFile, id);
    const session = this.sessions.get(id);
    await session?.settle();
    await this.sessionWorkspaces.get(id)?.catch(() => undefined);
    const engine = this.requireEngine();
    await engine.scheduler.haltRun(id, async (stopped, settled) => {
      await stopped;
      await settled;
      await this.plugins.optionalService(sandboxServicesToken)?.shutdown(id);
      await this.removeGlobalConversation(id, policy);
      engine.runtime.forgetRun(id);
      this.sessionWorkspaces.delete(id);
      this.workspaces.forget(id);
    });
    await rm(intentFile);
    await this.syncDirectory(path.dirname(intentFile));
    this.globalResetsRequested.delete(id);
    session?.resetHistory();
  }

  private async validateGlobalResetIntent(file: string, id: string): Promise<void> {
    const marker: unknown = JSON.parse(await readFile(file, "utf8"));
    if (!isRunId(id) || !marker || typeof marker !== "object" || !("version" in marker) || marker.version !== 1 || !("runId" in marker) || marker.runId !== id) {
      throw new Error("The conversation reset marker is invalid");
    }
  }

  private async removeGlobalConversation(id: string, policy = this.plugins.service(globalChatToken)): Promise<void> {
    const directories = [layout.sessionDir(id), path.join(layout.runsDir, id), layout.recoverySessionDir(id), policy.workspaceDirectory(id)];
    for (const directory of directories) await rm(directory, { recursive: true, force: true });
    for (const parent of new Set(directories.map((directory) => path.dirname(directory)))) {
      if (existsSync(parent)) await this.syncDirectory(parent);
    }
  }

  /** Who owns a coordinator: the user whose id it carries, without sign-in the one access; otherwise nobody. */
  private coordinatorUser(id: string): { userId: string | null } | undefined {
    const policy = this.plugins.optionalService(globalChatToken);
    if (!policy?.isCoordinator(id)) return undefined;
    const users = configuredUsers();
    if (!users) return policy.runIdFor(null) === id ? { userId: null } : undefined;
    const user = users.find((entry) => policy.runIdFor(entry.id) === id);
    return user ? { userId: user.id } : undefined;
  }

  private beginDelete(id: string): DeleteJob {
    const existing = this.deleting.get(id);
    if (existing) return existing;
    this.deleteRequested.add(id);
    this.runPreparations.get(id)?.controller.abort();
    const accepted = this.persistDeleteIntent(id)
      .then(() => this.notifyList())
      .catch((error: unknown) => {
        if (!existsSync(layout.deleteIntentFile(id))) this.deleteRequested.delete(id);
        throw error;
      });
    const done = accepted
      .then(() => this.deleteInner(id))
      .finally(() => {
        if (this.deleting.get(id) === job) this.deleting.delete(id);
        this.notifyList();
      });
    const job = { accepted, done };
    this.deleting.set(id, job);
    done.catch((error: unknown) => { if (this.deleteRequested.has(id)) console.warn(`Delete job for ${id} failed:`, error); });
    return job;
  }

  private notifyList(): void {
    for (const { listener } of this.listListeners) listener();
  }

  /** The first change reaches the user's listeners at once, further ones at most once per interval. */
  private noticeReadMarker(userId: string | null): void {
    if (this.readMarkerNotices.has(userId)) {
      this.readMarkerNotices.set(userId, true);
      return;
    }
    for (const entry of this.listListeners) if (entry.userId === userId) entry.listener();
    this.readMarkerNotices.set(userId, false);
    setTimeout(() => {
      const again = this.readMarkerNotices.get(userId) === true;
      this.readMarkerNotices.delete(userId);
      if (again) this.noticeReadMarker(userId);
    }, READ_MARKER_NOTICE_INTERVAL_MS).unref();
  }

  shutdown(): Promise<void> {
    this.shutdownPromise ??= this.shutdownInner();
    return this.shutdownPromise;
  }

  /** Releases the journal lock synchronously; for the exit hook, when no orderly shutdown runs anymore. */
  closeJournal(): void {
    this.engine?.journal.close();
  }

  private async shutdownInner(): Promise<void> {
    for (const preparation of this.runPreparations.values()) preparation.controller.abort();
    await Promise.allSettled([...this.runPreparations.values()].map((preparation) => preparation.done));
    await this.titleCompactor.shutdown();
    this.listListeners.clear();
    const resetResults = await Promise.allSettled([...this.globalResets.values()]);
    const sessions = [...this.sessions.entries()];
    for (const [, session] of sessions) session.dispose();
    const results = await Promise.allSettled([
      ...sessions.map(([, session]) => session.drain()),
      ...[...this.sessionWorkspaces.values()].map((workspace) => workspace.then(
        () => undefined,
        () => undefined,
      )),
    ]);
    results.push(...resetResults);
    results.push(...await Promise.allSettled([...this.deleteRequested].map((id) => this.beginDelete(id).done)));
    results.push(...await Promise.allSettled([
      this.engine ? this.engine.shutdown() : this.plugins.lifecycle.shutdown(),
      this.readMarkers?.flush(),
    ]));
    const failed = results
      .find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed) throw failed.reason;
  }

  private async deleteInner(id: string): Promise<void> {
    await Promise.allSettled([this.runPreparations.get(id)?.done]);
    await this.titleCompactor.cancel(id);
    const engine = this.requireEngine();
    const session = this.sessions.get(id);
    const workspace = this.sessionWorkspaces.get(id);
    session?.dispose();
    const stopped = await Promise.allSettled([
      session?.drain() ?? Promise.resolve(),
      engine.scheduler.stopRun(id),
      this.plugins.lifecycle.stopSession(id),
      workspace ?? Promise.resolve(),
    ]);
    const failures = stopped
      .slice(0, 3)
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);
    if (failures.length > 0) throw new AggregateError(failures, `Run ${id} could not be stopped`);
    await this.plugins.lifecycle.deleteSession(id);
    await this.archiveSession(id);
    this.engine?.runtime.forgetRun(id);
    this.sessions.delete(id);
    this.sessionWorkspaces.delete(id);
    this.workspaces.forget(id);
    await rm(layout.deleteIntentFile(id), { force: true });
    await this.syncDirectory(layout.deleteIntentsDir);
    this.deleteRequested.delete(id);
    this.deleted.add(id);
    this.requireReadMarkers().forgetRuns(new Set([id]));
  }

  private async loadDeleteIntents(): Promise<string[]> {
    const entries = await readdir(layout.deleteIntentsDir, { withFileTypes: true });
    const ids = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name.slice(0, -5));

    for (const id of ids) {
      if (!isRunId(id)) throw new Error(`Invalid delete intent: ${id}`);
      await this.validateDeleteIntent(id);
    }

    return ids;
  }

  private async loadArchivedRunIds(): Promise<string[]> {
    const entries = await readdir(layout.archiveDir, { withFileTypes: true });
    const ids: string[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!isRunId(entry.name)) throw new Error(`Invalid run archive: ${entry.name}`);
      ids.push(entry.name);
    }

    return ids;
  }

  private async persistDeleteIntent(id: string): Promise<void> {
    const target = layout.deleteIntentFile(id);
    if (!existsSync(target)) {
      const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
      try {
        const file = await open(temporary, "wx", 0o600);
        try {
          await file.writeFile(JSON.stringify({ version: 1, runId: id }), "utf8");
          await file.sync();
        } finally {
          await file.close();
        }
        await rename(temporary, target);
      } catch (error) {
        await rm(temporary, { force: true });
        throw error;
      }
    }
    await this.validateDeleteIntent(id);
    await this.syncDirectory(layout.deleteIntentsDir);
  }

  private async validateDeleteIntent(id: string): Promise<void> {
    const source = await readFile(layout.deleteIntentFile(id), "utf8");
    let marker: unknown;
    try {
      marker = JSON.parse(source);
    } catch {
      throw new Error(`Delete intent ${id} contains no valid JSON`);
    }
    if (!marker || typeof marker !== "object" || Array.isArray(marker)) {
      throw new Error(`Delete intent ${id} has an invalid format`);
    }
    const record = marker as { version?: unknown; runId?: unknown };
    if (record.version !== 1 || record.runId !== id) {
      throw new Error(`Delete intent ${id} does not match its file name`);
    }
  }

  private async syncDirectory(pathname: string): Promise<void> {
    if (process.platform === "win32") return;
    const directory = await open(pathname, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }

  private async resolveWorkspace(id: string, emitSystem: (text: string) => void): Promise<SessionWorkspace> {
    const globalChat = this.plugins.optionalService(globalChatToken);
    if (globalChat?.isCoordinator(id)) {
      const owner = this.coordinatorUser(id);
      if (!owner) throw new DomainError("coordinator-without-access", `The coordinator ${id} belongs to no access of this profile.`, 409);
      const directory = globalChat.workspaceDirectory(id);
      await mkdir(directory, { recursive: true, mode: ROOT_ONLY_MODE });
      const cwd = await realpath(directory);
      await globalChat.prepareWorkspace?.(cwd);
      const users = configuredUsers();
      return {
        cwd,
        // With users, the journal folder would contain other users' runs; the coordinator reads through its user's methods.
        hostSandbox: { home: cwd, readOnlyRoots: users ? [] : [{ directory: layout.runsDir, environmentVariable: "RAGENTS_JOURNAL_DIR" }] },
        extraEnv: {
          ...(this.apiBaseUrl ? { RAGENTS_API_BASE_URL: this.apiBaseUrl } : {}),
          ...(users || configuredAnonymousUser() ? { RAGENTS_API_TOKEN: coordinatorAccessToken(owner.userId) }
            : process.env.ACCESS_TOKEN ? { RAGENTS_API_TOKEN: process.env.ACCESS_TOKEN } : {}),
        },
        currentRoot: async () => cwd,
        runOperation: (operation) => operation(),
      };
    }
    return this.plugins.service(workspaceRuntimeToken).resolve(id, emitSystem);
  }

  private async archiveSession(id: string): Promise<void> {
    const target = layout.archiveSessionDir(id);
    await mkdir(target, { recursive: true, mode: ROOT_ONLY_MODE });
    // Journals before format 7 kept the model context under sessions/<id>/chat; it is preserved in the archive.
    const moves = [
      [path.join(layout.sessionDir(id), "chat"), "chat"],
      [path.join(layout.runsDir, id), "run"],
      [layout.recoverySessionDir(id), "recovery"],
    ] as const;
    for (const [from, name] of moves) {
      if (existsSync(from) && existsSync(path.join(target, name))) {
        throw new Error(`Archive ${id}/${name} already exists and is not overwritten`);
      }
    }
    for (const [from, name] of moves) {
      if (!existsSync(from)) continue;
      await rename(from, path.join(target, name));
    }
    await rm(layout.sessionDir(id), { recursive: true, force: true });
    await this.syncDirectory(target);
    await this.syncDirectory(layout.archiveDir);
    await this.syncDirectory(layout.recoveryDir);
    await this.syncDirectory(layout.sessionsDir);
    await this.syncDirectory(layout.runsDir);
  }
}

/** A locked run without plugin metadata and workspace; without loaded state, the journal file counts. */
const lockedSession = (failure: JournalLoadFailure, journal: Journal): ListedSession => {
  const state = journal.stateOf(failure.runId);
  const updatedAt = state ? Date.parse(journal.updatedAt(failure.runId) ?? state.createdAt) : statSync(failure.path, { throwIfNoEntry: false })?.mtimeMs ?? 0;
  return {
    id: failure.runId,
    title: state?.title ?? failure.runId,
    ...(state ? { createdAt: Date.parse(state.createdAt), revision: state.revision } : {}),
    updatedAt,
    running: false,
    state: "idle",
    pendingActions: 0,
    workspaceAccessible: false,
    operable: false,
    locked: failure.message,
  };
};

const sessionTitle = (text: string | undefined): string | undefined => {
  const lines = text?.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) ?? [];
  if (lines.length === 0) return undefined;
  const title = lines[0]?.startsWith("[Test:") && lines[1] ? `${lines[0]} ${lines[1]}` : lines[0] ?? "";
  return title.length > MAX_TITLE_CHARS ? `${title.slice(0, MAX_TITLE_CHARS - 3)}...` : title;
};
