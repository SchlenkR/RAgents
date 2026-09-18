import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, open, readFile, readdir, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { ChatSessionLike, ChatSessionProvider, SessionInfo } from "./chat-handler.js";
import { EventHub } from "./event-hub.js";
import { DomainError, isRunId, unrestrictedAccess, type AccessContext, type PluginHost, type ServiceToken } from "@aicontainer/ragents";
import { configuredAnonymousUser, configuredUsers } from "./config-file.js";
import { accessibleRunView } from "./access-projection.js";
import { accessServiceToken } from "./access-service.js";
import { config } from "./config.js";
import { layout, ROOT_ONLY_MODE, SESSIONS_MODE } from "./layout.js";
import type { StartOptionState } from "./plugin-support/start-options-contract.js";
import { runScriptFromDirectory } from "./plugin-support/run-scripts.js";
import { createEngine, SessionWorkspaces, type Engine } from "./ragents/engine.js";
import type { ProductProfileFactory } from "./ragents/host-services.js";
import { actorProgramsToken } from "./plugin-support/actor-programs/service.js";
import { documentStoreToken } from "./ragents/document-store.js";
import { productRuntimeToken } from "./ragents/product-runtime.js";
import { RunChatSession } from "./ragents/session.js";
import { globalChatToken, type ManagedRunStart, type SessionManagement } from "./ragents/global-chat.js";
import { workspaceRuntimeToken, type SessionWorkspace } from "./ragents/workspace-runtime.js";
import { settingsResponse, skillDetailResponse, type SettingsResponse, type SettingsSkillDetail } from "./settings.js";
import { createTitleCompactor } from "./title-compactor.js";
import { ModelRuntime } from "@aicontainer/agent";
import { TitleSettingsStore } from "./title-settings.js";
import { sandboxServicesToken } from "./plugin-support/workspace-sandbox-host.js";
import { parseRunPreparationRequest, prepareRunMessage } from "./run-preparation.js";
import type { RunPreparationResponse } from "./run-preparation-contract.js";

/** accepted: the delete intent is durable and the run is hidden; done: the cleanup job has finished. */
interface DeleteJob { accepted: Promise<void>; done: Promise<void> }

export class RunSessionProvider implements ChatSessionProvider {
  private readonly sessions = new Map<string, RunChatSession>();
  private readonly deleting = new Map<string, DeleteJob>();
  private readonly deleteRequested = new Set<string>();
  private readonly deleted = new Set<string>();
  private readonly workspaces = new SessionWorkspaces();
  private readonly sessionWorkspaces = new Map<string, Promise<SessionWorkspace>>();
  private modelRuntime: Promise<ModelRuntime> | undefined;
  private readonly runPreparations = new Map<string, { controller: AbortController; done: Promise<RunPreparationResponse> }>();
  private titleSettings: TitleSettingsStore | undefined;
  private readonly listListeners = new Set<() => void>();
  private readonly titleCompactor = createTitleCompactor({
    selection: () => this.requireTitleSettings().selection(),
    agentHomeDir: config.agentHomeDir,
    sessionsDir: layout.sessionsDir,
    modelRuntime: this.getModelRuntime(),
    onTitle: () => this.notifyList(),
    onError: (error) => console.warn("Titel-Kompaktierung fehlgeschlagen:", error),
  });
  readonly plugins: PluginHost;
  readonly eventHub = new EventHub();
  private shutdownPromise: Promise<void> | undefined;
  private engine: Engine | undefined;
  private globalReset: Promise<void> | undefined;
  private globalResetRequested = false;

  constructor(profileFactory: ProductProfileFactory) {
    this.plugins = profileFactory({
      ensureSession: (runId) => this.ensureUsable(runId),
      runtime: () => this.requireEngine().runtime,
      sessionWorkspaceFor: (runId) => this.sessionWorkspace(runId, () => {}),
      sessions: () => this.sessionManagement(),
      eventHub: this.eventHub,
    });
  }

  private requireContract(token: ServiceToken<unknown>): void {
    if (this.plugins.optionalService(token) !== undefined) return;
    throw new Error(
      `Das Produktprofil stellt den Pflichtvertrag ${token.id} nicht bereit. `
      + "Ein Produkt-Plugin muss ihn mit host.provide(...) registrieren.",
    );
  }

  async init(): Promise<void> {
    this.titleSettings = await TitleSettingsStore.create(path.join(config.dataDir, "title-settings.json"), await this.getModelRuntime(),
      config.compactionModel ? { provider: config.compactionProvider, model: config.compactionModel } : null, config.compactionProvider);
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
        if (!entry || entry.action !== "script") throw new Error(`Benutzer ${user.id}: ${id} ist kein registriertes Run-Setup`);
      }
    }
    this.requireContract(productRuntimeToken);
    this.requireContract(workspaceRuntimeToken);
    const globalChat = this.plugins.optionalService(globalChatToken);
    if (globalChat?.resetIntentFile && existsSync(globalChat.resetIntentFile)) {
      await this.validateGlobalResetIntent(globalChat.resetIntentFile, globalChat.runId);
      await this.removeGlobalConversation();
      await rm(globalChat.resetIntentFile);
      await this.syncDirectory(path.dirname(globalChat.resetIntentFile));
    }
    this.engine = await createEngine({
      plugins: this.plugins,
      workspaces: this.workspaces,
      assertAvailable: () => this.ensureAvailable(),
      assertRunUsable: (runId) => this.ensureUsable(runId),
      onChatSessionPersisted: () => undefined,
    });
    for (const id of this.deleted) {
      if (this.deleteRequested.has(id)) continue;
      if (this.engine.journal.stateOf(id) || existsSync(layout.sessionDir(id))) {
        throw new Error(`Archivierte Unterhaltung ${id} besitzt erneut aktive Daten`);
      }
    }
    for (const id of pendingDeletes) await this.beginDelete(id).done;
    const runIds = this.engine.journal.runIds();
    await Promise.all(runIds.map((runId) => this.sessionWorkspace(runId, () => {})));
    for (const runId of runIds) this.openSession(runId);
    this.engine.start();
  }

  private requireEngine(): Engine {
    if (!this.engine) throw new Error("Die Engine ist noch nicht gestartet");
    return this.engine;
  }

  private getModelRuntime(): Promise<ModelRuntime> {
    return this.modelRuntime ??= ModelRuntime.create({ authPath: path.join(config.agentHomeDir, "auth.json"), modelsPath: path.join(config.agentHomeDir, "models.json") });
  }

  private requireTitleSettings(): TitleSettingsStore {
    if (!this.titleSettings) throw new Error("Die Titelmodelleinstellungen sind noch nicht geladen.");
    return this.titleSettings;
  }

  titleModelSettings() { return this.requireTitleSettings().get(); }

  saveTitleModelSettings(value: unknown) { return this.requireTitleSettings().save(value); }

  subscribeList(listener: () => void): () => void {
    this.listListeners.add(listener);
    return () => this.listListeners.delete(listener);
  }

  async get(id: string): Promise<ChatSessionLike> {
    this.ensureUsable(id);
    return this.openSession(id);
  }

  private openSession(id: string, initialTitle?: string): RunChatSession {
    this.ensureUsable(id);
    const vorhanden = this.sessions.get(id);
    if (vorhanden) return vorhanden;
    const engine = this.requireEngine();
    const productRuntime = this.plugins.service(productRuntimeToken);
    const globalChat = this.plugins.optionalService(globalChatToken);
    const globalPolicy = id === globalChat?.runId ? globalChat : undefined;
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
          throw new DomainError("global-tools-changed", "Die Werkzeuge des übergeordneten Koordinators haben sich geändert. Setze sein Gespräch zurück, um die aktuellen Werkzeuge zu verwenden.", 409);
        }
      },
      prepare: (runId) => this.prepareRun(runId),
      prepareWorkspace: (runId, emitSystem) => this.prepareWorkspace(runId, emitSystem),
      scriptEntryFor: (entryId) => globalPolicy ? undefined : this.plugins.startEntries.scriptPackage(entryId),
      actorPrograms: {
        runInput: (...args) => this.plugins.service(actorProgramsToken).runInput(...args),
        workspaceDirectory: (runId) => this.plugins.service(actorProgramsToken).workspaceDirectory(runId),
        importPackage: (...args) => this.plugins.service(actorProgramsToken).importPackage(...args),
      },
    });
    this.sessions.set(id, session);
    session.attach();
    return session;
  }

  startOptions(id: string): readonly StartOptionState[] {
    return this.openSession(id).startOptions();
  }

  selectStartOption(id: string, optionId: string, value: unknown): StartOptionState {
    return this.openSession(id).selectStartOption(optionId, value);
  }

  async prepareRunMessage(id: string, value: unknown, signal: AbortSignal): Promise<RunPreparationResponse> {
    this.ensureUsable(id);
    if (this.runPreparations.has(id)) throw new DomainError("preparation-busy", "Eine Antwort für diese Vorbereitung wird bereits erstellt.", 409);
    const request = parseRunPreparationRequest(value);
    const session = this.openSession(id);
    const selection = session.preparationSelection();
    const prompt = this.plugins.optionalService(globalChatToken)?.preparationPrompt;
    if (!prompt) throw new DomainError("preparation-unavailable", "Das Profil stellt keinen Vorbereitungskoordinator bereit.", 409);
    const controller = new AbortController();
    const combined = AbortSignal.any([signal, controller.signal]);
    const done = this.getModelRuntime().then(async (runtime) => {
      this.ensureUsable(id);
      session.preparationSelection();
      const result = await prepareRunMessage({ runtime, selection, request, prompt, agentDir: config.agentHomeDir, signal: combined });
      this.ensureUsable(id);
      session.preparationSelection();
      return result;
    }).finally(() => this.runPreparations.delete(id));
    this.runPreparations.set(id, { controller, done });
    return done;
  }

  async list(): Promise<SessionInfo[]> {
    const engine = this.requireEngine();
    const productRuntime = this.plugins.service(productRuntimeToken);
    const infos: Array<SessionInfo & { running: boolean; metadata?: Readonly<Record<string, unknown>> }> = [];
    for (const runId of engine.journal.runIds()) {
      if (runId === this.plugins.optionalService(globalChatToken)?.runId) continue;
      if (this.deleteRequested.has(runId) || this.deleted.has(runId)) continue;
      const state = engine.journal.stateOf(runId);
      if (!state) continue;
      const firstInput = [...state.inputs.values()]
        .sort((left, right) => left.sequence - right.sequence)
        .find((input) => input.enqueuedBy === state.ownerId);
      // A title set on purpose (run script, run_configure) beats the first-message heuristic.
      const chosenTitle = state.title !== productRuntime.coordinator.runTitle ? state.title : undefined;
      const compactTitle = chosenTitle ?? await this.titleCompactor.titleFor(runId, firstInput?.content);
      infos.push({
        id: runId,
        title: compactTitle ?? sessionTitle(firstInput?.content) ?? productRuntime.coordinator.runTitle,
        createdAt: Date.parse(state.createdAt),
        updatedAt: Date.parse(engine.journal.updatedAt(runId) ?? state.createdAt),
        revision: state.revision,
        running: [...state.actors.values()].some((actor) => actor.kind !== "human" && engine.scheduler.isRunning(runId, actor.id))
          || (this.sessions.get(runId)?.running ?? false),
        metadata: await this.plugins.sessionMetadata.describe(runId),
      });
    }
    for (const [id, session] of this.sessions) {
      if (id === this.plugins.optionalService(globalChatToken)?.runId) continue;
      if (this.deleteRequested.has(id) || this.deleted.has(id)) continue;
      if (!session.started || infos.some((info) => info.id === id)) continue;
      infos.push({
        id,
        title: productRuntime.coordinator.runTitle,
        updatedAt: Date.now(),
        running: session.running,
      });
    }
    return infos.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private sessionManagement(): SessionManagement {
    return {
      list: () => this.list(),
      view: (runId) => {
        this.ensureUsable(runId);
        return this.requireEngine().runtime.view(runId);
      },
      events: (runId) => {
        this.ensureUsable(runId);
        return this.requireEngine().runtime.events(runId);
      },
      create: (start) => this.createManagedRun(start),
      send: (runId, message) => this.openSession(runId).sendAndWait(message),
      stop: (runId) => this.openSession(runId).stop(),
      resetGlobal: () => this.resetGlobalConversation(),
    };
  }

  private async createManagedRun(start: ManagedRunStart): Promise<string> {
    const local = start.kind === "package" ? runScriptFromDirectory(start.directory) : undefined;
    const id = randomUUID();
    const session = this.openSession(id, start.title);
    for (const [optionId, value] of Object.entries(start.options ?? {})) session.selectStartOption(optionId, value);
    if (start.kind === "script") await session.startAndWait(start.entryId, start.input);
    else if (start.kind === "package") {
      if (!local) throw new Error("Das Run-Script-Paket wurde nicht geladen");
      const { script, ...entry } = local;
      await session.startPackageAndWait({ ...script, entry: { ...entry, coordinator: script.coordinator, owner: "ragents.overseer" } }, start.input);
    }
    else await session.sendAndWait(start.message);
    return id;
  }

  runtimeRoutes(req: IncomingMessage, res: ServerResponse, prefix: string, access: AccessContext = unrestrictedAccess): Promise<boolean> {
    return this.requireEngine().routes(req, res, prefix, (view) => accessibleRunView(view, access));
  }

  runView(id: string, access: AccessContext = unrestrictedAccess): unknown {
    this.ensureUsable(id);
    return accessibleRunView(this.requireEngine().runtime.view(id), access);
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
    return pathname.startsWith("/ragents/api/")
      || pathname === "/api/settings"
      || pathname.startsWith("/api/settings/")
      || this.plugins.isApiPath(pathname);
  }

  pluginRoutes(req: IncomingMessage, res: ServerResponse, url: URL, access?: AccessContext): Promise<boolean> {
    return this.plugins.dispatchHttp(req, res, url, access);
  }

  private ensureUsable(id: string): void {
    if (!isRunId(id)) throw new DomainError("invalid-run", `Ungültige Session-Id: ${id}`, 400);
    this.ensureAvailable();
    if (this.globalResetRequested && id === this.plugins.optionalService(globalChatToken)?.runId) {
      throw new DomainError("conversation-resetting", "Das globale Gespräch wird zurückgesetzt. Bitte warte kurz oder wiederhole den Reset nach einem Fehler.", 409);
    }
    if (this.deleteRequested.has(id)) throw new DomainError("run-deleting", "Die Unterhaltung wird gelöscht", 409);
    if (this.deleted.has(id)) throw new DomainError("run-deleted", "Die Unterhaltung wurde gelöscht", 410);
    this.engine?.journal.assertRunAvailable(id);
  }

  private ensureAvailable(): void {
    if (this.shutdownPromise) throw new DomainError("server-stopping", "Der Server wird beendet", 503);
  }

  private sessionWorkspace(id: string, emitSystem: (text: string) => void): Promise<SessionWorkspace> {
    this.ensureUsable(id);
    const running = this.sessionWorkspaces.get(id);
    if (running) return running;
    const created = this.resolveWorkspace(id, emitSystem)
      .then((workspace) => {
        this.ensureUsable(id);
        this.workspaces.remember(id, workspace.cwd);
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
    if (id !== this.plugins.optionalService(globalChatToken)?.runId) await this.plugins.lifecycle.prepareSession(id);
    this.ensureUsable(id);
    await mkdir(layout.chatDir(id), { recursive: true, mode: ROOT_ONLY_MODE });
    this.ensureUsable(id);
    await chmod(layout.chatDir(id), ROOT_ONLY_MODE);
    this.ensureUsable(id);
  }

  private async prepareWorkspace(id: string, emitSystem: (text: string) => void): Promise<void> {
    this.ensureUsable(id);
    await this.sessionWorkspace(id, emitSystem);
    this.ensureUsable(id);
  }

  delete(id: string): Promise<void> {
    if (id === this.plugins.optionalService(globalChatToken)?.runId) {
      return Promise.reject(new DomainError("global-chat-protected", "Der übergeordnete Koordinator kann nicht gelöscht werden", 409));
    }
    if (!isRunId(id)) return Promise.reject(new Error(`Ungültige Session-Id: ${id}`));
    if (this.shutdownPromise) return Promise.reject(new Error("Der Server wird beendet"));
    return this.beginDelete(id).accepted;
  }

  deletion(id: string): Promise<void> | undefined {
    return this.deleting.get(id)?.done;
  }

  private resetGlobalConversation(): Promise<void> {
    this.ensureAvailable();
    if (this.globalReset) return this.globalReset;
    const policy = this.plugins.optionalService(globalChatToken);
    if (!policy?.resetIntentFile) return Promise.reject(new DomainError("conversation-reset-unavailable", "Dieses Profil bietet keinen Gesprächsreset an.", 404));
    this.globalResetRequested = true;
    const operation = this.resetGlobalInner(policy.runId, policy.resetIntentFile).catch((error: unknown) => {
      if (!existsSync(policy.resetIntentFile!)) this.globalResetRequested = false;
      throw error;
    }).finally(() => {
      if (this.globalReset === operation) this.globalReset = undefined;
    });
    this.globalReset = operation;
    return operation;
  }

  private async resetGlobalInner(id: string, intentFile: string): Promise<void> {
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
      await this.removeGlobalConversation();
      engine.journal.forget(id);
      this.sessionWorkspaces.delete(id);
      this.workspaces.forget(id);
    });
    await rm(intentFile);
    await this.syncDirectory(path.dirname(intentFile));
    this.globalResetRequested = false;
    session?.resetHistory();
  }

  private async validateGlobalResetIntent(file: string, id: string): Promise<void> {
    const marker: unknown = JSON.parse(await readFile(file, "utf8"));
    if (!marker || typeof marker !== "object" || !("version" in marker) || marker.version !== 1 || !("runId" in marker) || marker.runId !== id) {
      throw new Error("Der Gesprächsreset-Marker ist ungültig");
    }
  }

  private async removeGlobalConversation(): Promise<void> {
    const policy = this.plugins.service(globalChatToken);
    const directories = [layout.sessionDir(policy.runId), path.join(layout.runsDir, policy.runId), layout.recoverySessionDir(policy.runId), policy.workspaceDirectory];
    for (const directory of directories) await rm(directory, { recursive: true, force: true });
    for (const parent of new Set(directories.map((directory) => path.dirname(directory)))) {
      if (existsSync(parent)) await this.syncDirectory(parent);
    }
  }

  private beginDelete(id: string): DeleteJob {
    const vorhanden = this.deleting.get(id);
    if (vorhanden) return vorhanden;
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
    done.catch((error: unknown) => { if (this.deleteRequested.has(id)) console.warn(`Löschjob für ${id} fehlgeschlagen:`, error); });
    return job;
  }

  private notifyList(): void {
    for (const listener of this.listListeners) listener();
  }

  shutdown(): Promise<void> {
    this.eventHub?.close();
    this.shutdownPromise ??= this.shutdownInner();
    return this.shutdownPromise;
  }

  /** Gibt das Journal-Lock synchron frei; für den exit-Hook, wenn kein geordneter Shutdown mehr läuft. */
  closeJournal(): void {
    this.engine?.journal.close();
  }

  private async shutdownInner(): Promise<void> {
    for (const preparation of this.runPreparations.values()) preparation.controller.abort();
    await Promise.allSettled([...this.runPreparations.values()].map((preparation) => preparation.done));
    await this.titleCompactor.shutdown();
    this.listListeners.clear();
    const resetResults = await Promise.allSettled(this.globalReset ? [this.globalReset] : []);
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
    if (failures.length > 0) throw new AggregateError(failures, `Unterhaltung ${id} konnte nicht gestoppt werden`);
    await this.plugins.lifecycle.deleteSession(id);
    await this.archiveSession(id);
    this.engine?.journal.forget(id);
    this.sessions.delete(id);
    this.sessionWorkspaces.delete(id);
    this.workspaces.forget(id);
    await rm(layout.deleteIntentFile(id), { force: true });
    await this.syncDirectory(layout.deleteIntentsDir);
    this.deleteRequested.delete(id);
    this.deleted.add(id);
  }

  private async loadDeleteIntents(): Promise<string[]> {
    const entries = await readdir(layout.deleteIntentsDir, { withFileTypes: true });
    const ids = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name.slice(0, -5));

    for (const id of ids) {
      if (!isRunId(id)) throw new Error(`Ungültiger Delete-Intent: ${id}`);
      await this.validateDeleteIntent(id);
    }

    return ids;
  }

  private async loadArchivedRunIds(): Promise<string[]> {
    const entries = await readdir(layout.archiveDir, { withFileTypes: true });
    const ids: string[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === "ohne-session") continue;
      if (!isRunId(entry.name)) throw new Error(`Ungültiges Run-Archiv: ${entry.name}`);
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
      throw new Error(`Delete-Intent ${id} enthält kein gültiges JSON`);
    }
    if (!marker || typeof marker !== "object" || Array.isArray(marker)) {
      throw new Error(`Delete-Intent ${id} hat ein ungültiges Format`);
    }
    const record = marker as { version?: unknown; runId?: unknown };
    if (record.version !== 1 || record.runId !== id) {
      throw new Error(`Delete-Intent ${id} passt nicht zu seinem Dateinamen`);
    }
  }

  private async syncDirectory(pathname: string): Promise<void> {
    const directory = await open(pathname, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }

  private async resolveWorkspace(id: string, emitSystem: (text: string) => void): Promise<SessionWorkspace> {
    const globalChat = this.plugins.optionalService(globalChatToken);
    if (id === globalChat?.runId) {
      await mkdir(globalChat.workspaceDirectory, { recursive: true, mode: ROOT_ONLY_MODE });
      const cwd = await realpath(globalChat.workspaceDirectory);
      await globalChat.prepareWorkspace?.(cwd);
      const filesDirectory = await this.plugins.optionalService(documentStoreToken)?.directoryFor(id);
      return {
        cwd,
        hostSandbox: { home: cwd, readOnlyDirectories: [layout.runsDir], filesDirectory },
        extraEnv: {
          RAGENTS_JOURNAL_DIR: layout.runsDir,
          RAGENTS_API_BASE_URL: `http://127.0.0.1:${config.port}`,
          ...(configuredUsers() || configuredAnonymousUser() ? { RAGENTS_API_TOKEN: accessServiceToken() }
            : process.env.ACCESS_TOKEN ? { RAGENTS_API_TOKEN: process.env.ACCESS_TOKEN } : {}),
        },
        currentRoot: async () => cwd,
        ensureWritable: async () => cwd,
        runOperation: (operation) => operation(),
      };
    }
    return this.plugins.service(workspaceRuntimeToken).resolve(id, emitSystem);
  }

  private async archiveSession(id: string): Promise<void> {
    const target = layout.archiveSessionDir(id);
    await mkdir(target, { recursive: true, mode: ROOT_ONLY_MODE });
    const moves = [
      [path.join(layout.sessionDir(id), "chat"), "chat"],
      [path.join(layout.runsDir, id), "run"],
      [layout.recoverySessionDir(id), "recovery"],
    ] as const;
    for (const [from, name] of moves) {
      if (existsSync(from) && existsSync(path.join(target, name))) {
        throw new Error(`Archiv ${id}/${name} existiert bereits und wird nicht überschrieben`);
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

const sessionTitle = (text: string | undefined): string | undefined => {
  const lines = text?.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) ?? [];
  if (lines.length === 0) return undefined;
  return lines[0]?.startsWith("[Test:") && lines[1] ? `${lines[0]} ${lines[1]}` : lines[0];
};
