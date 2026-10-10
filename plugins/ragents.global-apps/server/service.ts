import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { DomainError, hasCapability, inheritedGrants, type AccessContext, type Actor, type ExecutableActor, type JsonValue, type Orchestration, type RunFunction, type RunView, type ToolCaller } from "@ragents/engine";
import { allowedWorkspacePath, containsWorkspacePath, resolvedWorkspacePath, watchDirectory } from "@ragents/workspace-executor";
import type { ActorProgramsService } from "@ragents/host/plugin-support/actor-programs/service.js";
import { ACTOR_STATE_ID } from "@ragents/host/plugin-support/actor-programs/contract.js";
import { GLOBAL_APPS_PLUGIN_ID, appLogSchema, appRegisterSchema, appResultSchema, appTriggerSchema, type GlobalAppDetails, type GlobalAppHttpRequest, type GlobalAppLog, type GlobalAppPermissions, type GlobalAppRegister, type GlobalAppResult, type GlobalAppSummary, type GlobalAppTrigger, type GlobalAppsSnapshot } from "../contract.js";

interface Occurrence extends GlobalAppTrigger {
  readonly number: number;
  readonly commandId: string;
}
interface StoredGlobalApp {
  readonly version: 1;
  readonly definition: GlobalAppRegister & { readonly timeoutSeconds: number };
  readonly actorId: string;
  readonly source: { readonly runId: string; readonly program: string };
  readonly sandbox: "process" | "disabled";
  readonly paused: boolean;
  readonly nextDueAt: string | null;
  readonly occurrence: number;
  readonly phase: { readonly kind: "idle" } | { readonly kind: "accepted"; readonly tick: Occurrence } | { readonly kind: "removed" };
  readonly lastRunAt: string | null;
  readonly lastResult: GlobalAppResult | null;
  readonly problem: string | null;
  readonly log: readonly GlobalAppLog[];
  readonly droppedLogLines: number;
  readonly filePending: boolean;
}
interface RegistrationFailure {
  readonly definition: GlobalAppRegister;
  readonly source: { readonly runId: string; readonly program: string };
  readonly at: string;
  readonly problem: string;
}

const nullableText = Type.Union([Type.String(), Type.Null()]);
const storedGlobalAppSchema = Type.Object({
  version: Type.Literal(1),
  definition: Type.Object({ ...appRegisterSchema.properties, timeoutSeconds: Type.Integer({ minimum: 1, maximum: 300 }) }, { additionalProperties: false }),
  actorId: Type.String(),
  source: Type.Object({
    runId: Type.String(),
    program: Type.String(),
  }, { additionalProperties: false }),
  sandbox: Type.Union([Type.Literal("process"), Type.Literal("disabled")]),
  paused: Type.Boolean(),
  nextDueAt: nullableText,
  occurrence: Type.Integer({ minimum: 0 }),
  phase: Type.Union([
    Type.Object({ kind: Type.Literal("idle") }, { additionalProperties: false }),
    Type.Object({
      kind: Type.Literal("accepted"),
      tick: Type.Object({
        ...appTriggerSchema.properties,
        number: Type.Integer({ minimum: 1 }),
        commandId: Type.String(),
      }, { additionalProperties: false }),
    }, { additionalProperties: false }),
    Type.Object({ kind: Type.Literal("removed") }, { additionalProperties: false }),
  ]),
  lastRunAt: nullableText,
  lastResult: Type.Union([appResultSchema, Type.Null()]),
  problem: nullableText,
  log: Type.Array(appLogSchema, { maxItems: 100 }),
  droppedLogLines: Type.Integer({ minimum: 0 }),
  filePending: Type.Boolean(),
}, { additionalProperties: false });
const executionTools = new Set(["bash", "typescript_eval", "agent_spawn", "actor_program_activate", "actor_program_import", "actor_program_ensure", "plugin_state_write"]);
const registrationFailureSchema = Type.Object({
  definition: appRegisterSchema,
  source: storedGlobalAppSchema.properties.source,
  at: Type.String(),
  problem: Type.String(),
}, { additionalProperties: false });
const registrationFailures = (view: RunView): RegistrationFailure[] => {
  const marker = view.pluginStates.find((entry) => entry.pluginId === GLOBAL_APPS_PLUGIN_ID && entry.scope.kind === "run")?.state;
  const recorded = marker && typeof marker === "object" && !Array.isArray(marker) ? marker.failedRegistrations : undefined;
  return Array.isArray(recorded) ? recorded.filter((entry): entry is JsonValue & RegistrationFailure => Value.Check(registrationFailureSchema, entry)) : [];
};

export interface GlobalAppsServiceOptions {
  readonly runtime: () => Orchestration;
  readonly programs: ActorProgramsService;
  readonly userAccess: (userId: string | null) => AccessContext;
  readonly ensureRun: (runId: string) => void;
  readonly prepareRun: (runId: string) => Promise<void>;
  readonly interrupt: (runId: string, actorId: string, reason: string) => Promise<void>;
  readonly sourceRoots: (runId: string) => Promise<{ read: readonly string[]; write: readonly string[] }>;
  readonly functionsFor: (runId: string, actor: Actor) => Promise<readonly RunFunction[]>;
  readonly sandboxFor: (runId: string) => Promise<boolean>;
  readonly watch?: typeof watchDirectory;
  readonly now?: () => number;
  readonly wake?: (callback: () => void, delay: number) => () => void;
}

const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);
const fail = (code: string, message: string, status = 409): never => { throw new DomainError(code, message, status); };
export const globalAppsRunId = (userId: string | null): string => `global-apps-${createHash("sha256").update(JSON.stringify(userId)).digest("hex").slice(0, 24)}`;
const ownerOf = (access: AccessContext): string | null => {
  if (access.enabled && !access.user) return fail("login-required", "Please sign in.", 401);
  return access.user?.id ?? null;
};
const rights = (access: AccessContext, ...required: readonly string[]): void => {
  for (const right of required) if (!access.can(right)) fail("access-denied", `Missing permission ${right}.`, 403);
};
const validApp = (state: unknown, actorId: string): state is StoredGlobalApp => {
  if (!Value.Check(storedGlobalAppSchema, state)) return false;
  const app = state as StoredGlobalApp;
  return app.actorId === actorId && [app.nextDueAt, app.lastRunAt, app.lastResult?.at, ...app.phase.kind === "accepted" ? [app.phase.tick.scheduledAt] : []]
    .every((at) => at === null || at === undefined || Number.isFinite(Date.parse(at)));
};
const globalAppsOf = (view: RunView): StoredGlobalApp[] => view.pluginStates.flatMap((entry) => {
  if (entry.pluginId !== GLOBAL_APPS_PLUGIN_ID || entry.scope.kind !== "actor") return [];
  return validApp(entry.state, entry.scope.actorId) ? [entry.state] : [];
});
const invalidApps = (view: RunView) => view.pluginStates.flatMap((entry) => {
  if (entry.pluginId !== GLOBAL_APPS_PLUGIN_ID || entry.scope.kind !== "actor" || entry.state === null || validApp(entry.state, entry.scope.actorId)) return [];
  const actorId = entry.scope.actorId;
  const name = (entry.state as unknown as StoredGlobalApp | null)?.definition?.name ?? view.actors.find((actor) => actor.id === actorId)?.handle;
  const knownName = typeof name === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(name) ? name : undefined;
  return [{ id: `invalid:${actorId}`, name: knownName ?? "Damaged app", actorId, problem: "The app definition is damaged. Register its package again to repair it." }];
});
const liveGlobalApps = (view: RunView): StoredGlobalApp[] => globalAppsOf(view).filter((app) => app.phase.kind !== "removed");
const missingApp = (view: RunView, name: string): never => {
  const damaged = invalidApps(view).find((app) => app.name === name);
  return fail(damaged ? "app-definition-damaged" : "app-not-found", damaged?.problem ?? `App ${name} does not exist.`, damaged ? 409 : 404);
};
const byName = (view: RunView, name: string): StoredGlobalApp => liveGlobalApps(view).find((app) => app.definition.name === name) ?? missingApp(view, name);
const inputFor = (runtime: Orchestration, runId: string, tick: Occurrence) => {
  const event = runtime.events(runId).find((entry) => entry.commandId === tick.commandId && entry.type === "actor.input.enqueued");
  return event?.type === "actor.input.enqueued" ? runtime.view(runId).inputs.find((input) => input.id === event.payload.inputId) : undefined;
};
const turnFor = (runtime: Orchestration, runId: string, tick: Occurrence) => {
  const input = inputFor(runtime, runId, tick);
  const lifecycle = input?.lifecycle;
  return lifecycle?.kind === "claimed" ? runtime.view(runId).turns.find((turn) => turn.id === lifecycle.turnId) : undefined;
};
const actorOf = (view: RunView, app: StoredGlobalApp) => view.actors.find((actor): actor is ExecutableActor => actor.id === app.actorId && actor.kind !== "human");
const problemOf = (view: RunView, app: StoredGlobalApp): string | null => app.problem ?? (view.pause ? "The global apps run is paused." : actorOf(view, app)?.lifecycle.kind === "stopped" ? "The app actor is stopped." : null);
const summaryOf = (runtime: Orchestration, view: RunView, app: StoredGlobalApp, programs: ActorProgramsService): GlobalAppSummary => {
  const turn = app.phase.kind === "accepted" ? turnFor(runtime, view.id, app.phase.tick) : undefined;
  const loaded = (() => {
    try {
      const views = programs.apps(view.id, app.actorId).map(({ id, title, revision }) => ({ id, title, revision }));
      if (views.some((entry) => [entry.id, entry.title, entry.revision].some((value) => typeof value !== "string" || !value.trim()))) throw new Error("The app view metadata is damaged.");
      return { views, problem: null };
    }
    catch (error) { return { views: [], problem: errorText(error) }; }
  })();
  const problem = problemOf(view, app) ?? loaded.problem;
  return {
    name: app.definition.name,
    description: app.definition.description,
    triggers: app.definition.triggers ?? {},
    views: loaded.views,
    paused: app.paused,
    status: problem ? "blocked" : app.phase.kind === "accepted" ? turn?.status === "running" ? "running" : "queued" : app.paused ? "paused" : "ready",
    lastRunAt: app.lastRunAt,
    nextRunAt: app.paused || problem || app.phase.kind === "accepted" ? null : app.nextDueAt,
    lastResult: app.lastResult,
    problem,
  };
};
const boundedLog = (app: StoredGlobalApp, lines: readonly GlobalAppLog[]) => {
  const log = [...app.log, ...lines];
  return { log: log.slice(-100), droppedLogLines: app.droppedLogLines + Math.max(0, log.length - 100) };
};

export class GlobalAppsService {
  readonly #options: GlobalAppsServiceOptions;
  readonly #runs = new Set<string>();
  readonly #stopped = new Set<string>();
  readonly #queues = new Map<string, Promise<void>>();
  readonly #listeners = new Set<(owner: string | null) => void>();
  readonly #failures = new Map<string, string>();
  readonly #watches = new Map<string, { signature: string; stop: () => void }>();
  #unsubscribe: (() => void) | undefined;
  #cancelWake: (() => void) | undefined;
  #closed = false;

  constructor(options: GlobalAppsServiceOptions) { this.#options = options; }
  #runtime(): Orchestration { return this.#options.runtime(); }
  #now(): number { return this.#options.now ? this.#options.now() : Date.parse(this.#runtime().now()); }
  #at(): string { return new Date(this.#now()).toISOString(); }
  #context(runId: string) { return { actorId: this.#runtime().state(runId).ownerId, commandId: `globalApps:${randomUUID()}` }; }

  async ready(): Promise<void> {
    this.#unsubscribe ??= this.#runtime().subscribe((events) => {
      for (const runId of new Set(events.filter((event) => this.#runs.has(event.runId)).map((event) => event.runId))) {
        this.#notify(runId);
        if (events.some((event) => event.runId === runId && ["turn.started", "turn.finished", "turn.interrupted", "actor.stopped", "run.paused", "run.resumed"].includes(event.type))) this.#queuePump(runId);
      }
    });
    for (const run of this.#runtime().listRuns()) {
      if (!run.id.startsWith("global-apps-")) continue;
      try {
        const view = this.#runtime().view(run.id);
        const marker = view.pluginStates.find((entry) => entry.pluginId === GLOBAL_APPS_PLUGIN_ID && entry.scope.kind === "run");
        if (!marker) continue;
        this.#assertGlobalAppsRun(run.id);
        this.#runs.add(run.id);
        await this.#options.prepareRun(run.id);
        await this.#serial(run.id, () => this.#pump(run.id));
      } catch (error) { this.#failures.set(run.id, errorText(error)); }
    }
    this.#arm();
  }

  #assertGlobalAppsRun(runId: string): void {
    this.#options.ensureRun(runId);
    const state = this.#runtime().state(runId);
    const marker = this.#runtime().view(runId).pluginStates.find((entry) => entry.pluginId === GLOBAL_APPS_PLUGIN_ID && entry.scope.kind === "run")?.state as { version?: number; ownerUserId?: string | null } | undefined;
    if (!marker || marker.version !== 1 || marker.ownerUserId !== state.ownerUserId || runId !== globalAppsRunId(state.ownerUserId)) fail("global-apps-run-invalid", "The global apps run does not match its owner.");
  }

  #run(access: AccessContext): string | undefined {
    const runId = globalAppsRunId(ownerOf(access));
    if (!this.#runtime().listRuns().some((run) => run.id === runId)) {
      if (this.#failures.has(runId)) fail("global-apps-run-unavailable", this.#failures.get(runId)!);
      return undefined;
    }
    this.#assertGlobalAppsRun(runId);
    return runId;
  }

  async #ensure(access: AccessContext): Promise<string> {
    const existing = this.#run(access);
    if (existing) return existing;
    rights(access, "runs.create");
    const owner = ownerOf(access);
    const runId = globalAppsRunId(owner);
    this.#runtime().createRun({ commandId: `global-apps-create:${runId}` }, {
      runId, title: "Global apps", ownerHandle: owner ?? "owner", ownerDisplayName: access.user?.label ?? "Owner",
      ...(owner === null ? {} : { ownerUserId: owner }),
      initialPluginStates: [{ pluginId: GLOBAL_APPS_PLUGIN_ID, state: { version: 1, ownerUserId: owner } }],
    });
    this.#runs.add(runId);
    await this.#options.prepareRun(runId);
    return runId;
  }

  async register(access: AccessContext, caller: ToolCaller, input: GlobalAppRegister, signal?: AbortSignal): Promise<{ registered: true; paused: true }> {
    rights(access, "ragents.global-apps.write", "runs.write");
    if (!Value.Check(appRegisterSchema, input)) fail("app-invalid", "Global app registration does not match the contract.", 400);
    const source = this.#runtime().state(caller.runId);
    if (source.ownerUserId !== ownerOf(access)) fail("app-source-denied", "The source package must belong to your user.", 403);
    this.#options.ensureRun(caller.runId);
    const actor = this.#runtime().view(caller.runId).actors.find((candidate) => candidate.id === caller.actorId);
    if (!actor || actor.kind === "human" || !hasCapability(actor, "agent.spawn", { kind: "run" }) || !hasCapability(actor, "plugin.state.write", { kind: "run" })) return fail("app-registration-denied", "Registration requires an actor with agent.spawn and plugin.state.write.", 403);
    const grants = inheritedGrants({ ...actor, grants: actor.grants.filter((grant) => grant.usable !== false && grant.delegable) });
    const delegated = { ...actor, grants, toolNames: null };
    const available = await this.#options.functionsFor(caller.runId, actor);
    const allowed = await this.#options.functionsFor(caller.runId, delegated);
    for (const name of input.permissions.functions ?? []) {
      if (name.startsWith("global_app_") || executionTools.has(name) || !available.some((fn) => fn.name === name) || !allowed.some((fn) => fn.name === name)) fail("app-function-denied", `Function ${name} is not available and delegable to this app.`, 403);
    }
    const permissions = await this.#permissions(access, caller.runId, actor, input.permissions);
    const watchedFolders = await Promise.all((input.triggers?.fileChange?.folders ?? []).map(async (folder) => {
      if (!path.isAbsolute(folder)) fail("app-watch-invalid", "Watched folders must be absolute server paths.", 400);
      const directory = await realpath(folder);
      if (!(await stat(directory)).isDirectory()) fail("app-watch-invalid", "A watched folder must exist.", 400);
      await allowedWorkspacePath(directory, [...permissions.files?.read ?? [], ...permissions.files?.write ?? []]);
      return directory;
    }));
    const triggers = { ...input.triggers, ...input.triggers?.fileChange ? { fileChange: { folders: watchedFolders } } : {} };
    const runId = await this.#ensure(access);
    return this.#serial(runId, async () => {
      signal?.throwIfAborted();
      const view = this.#runtime().view(runId);
      if (view.pause || this.#stopped.has(runId)) fail("global-apps-run-paused", "Resume the global apps run before registering a package.");
      const old = globalAppsOf(view).find((app) => app.definition.name === input.name);
      if (old && old.phase.kind !== "removed" && (!old.paused || old.phase.kind !== "idle")) fail("app-update-requires-pause", "Pause the app and wait for its current check before replacing it.");
      if ((!old || old.phase.kind === "removed") && liveGlobalApps(view).length >= 50) fail("app-limit", "A user may have at most 50 global apps.");
      const capabilities = ["global_app_trigger", ...permissions.files?.read?.length ? ["global_app_file_read"] : [], ...permissions.files?.write?.length ? ["global_app_file_write"] : [], ...permissions.http?.length ? ["global_app_http_request"] : [], ...permissions.functions ?? []];
      const actorGrants = old ? this.#runtime().view(runId).actors.find((candidate) => candidate.id === old.actorId)?.grants : grants;
      if (!actorGrants) return fail("app-actor-missing", "The app actor is missing.");
      const delegatedGrants = grants.filter((grant) => actorGrants.some((prior) => prior.capability === grant.capability && prior.usable !== false && (prior.scope.kind === "run" || JSON.stringify(prior.scope) === JSON.stringify(grant.scope))));
      const prepared = await (async () => {
        const sandbox = await this.#options.sandboxFor(runId) ? "process" as const : "disabled" as const;
        const activated = await this.#options.programs.copyPackage({ runId: caller.runId, actorId: caller.actorId, name: input.program }, {
          runId, name: input.name, capabilities, grants: delegatedGrants, requiredCapabilities: ["global_app_trigger"], inputOnly: false, isolated: true,
        }, signal);
        return { sandbox, activated };
      })().catch((error) => {
        this.#registrationFailure(runId, input.name, { definition: { ...input, triggers, permissions }, source: { runId: caller.runId, program: input.program }, at: this.#at(), problem: errorText(error).slice(0, 2000) });
        throw error;
      });
      const definition = { ...input, triggers, permissions, timeoutSeconds: input.timeoutSeconds ?? 30 };
      this.#write(runId, {
        version: 1, definition, actorId: prepared.activated.actorId, source: { runId: caller.runId, program: input.program }, sandbox: prepared.sandbox,
        paused: true, nextDueAt: null, occurrence: old?.occurrence ?? 0, phase: { kind: "idle" },
        lastRunAt: old?.lastRunAt ?? null, lastResult: old?.lastResult ?? null, problem: null,
        log: old?.log ?? [], droppedLogLines: old?.droppedLogLines ?? 0, filePending: false,
      });
      if (!this.#runtime().view(runId).primaryActorId) this.#runtime().selectPrimaryActor(this.#context(runId), runId, prepared.activated.actorId);
      this.#failures.delete(runId);
      this.#registrationFailure(runId, input.name);
      await this.#syncWatches(runId);
      this.#arm();
      return { registered: true, paused: true };
    });
  }

  async #permissions(access: AccessContext, sourceRunId: string, actor: Actor, input: GlobalAppPermissions): Promise<GlobalAppPermissions> {
    const roots = input.files?.read?.length || input.files?.write?.length ? await this.#options.sourceRoots(sourceRunId) : { read: [], write: [] };
    const folders = async (requested: readonly string[], mode: "read" | "write"): Promise<string[]> => Promise.all(requested.map(async (folder) => {
      rights(access, mode === "write" ? "runs.write" : "runs.read");
      if (!path.isAbsolute(folder) || folder.includes("\0")) fail("app-folder-invalid", "File permissions need absolute server folders.", 400);
      const directory = await realpath(folder);
      if (!(await stat(directory)).isDirectory()) fail("app-folder-invalid", "File permissions need existing folders.", 400);
      if (!hasCapability(actor, "workspace.use", { kind: "workspace", path: directory }) || !actor.grants.some((grant) => grant.capability === "workspace.use" && grant.usable !== false && grant.delegable && (grant.scope.kind === "run" || containsWorkspacePath(grant.scope.path, directory)))) fail("app-folder-denied", "The actor cannot delegate access to this folder.", 403);
      if (!access.can("*")) await allowedWorkspacePath(directory, roots[mode]);
      return directory;
    }));
    const read = [...new Set(await folders(input.files?.read ?? [], "read"))];
    const write = [...new Set(await folders(input.files?.write ?? [], "write"))];
    const http = (input.http ?? []).map((host) => {
      const url = new URL(`https://${host}`);
      const port = host.slice(url.hostname.length);
      if (host !== url.hostname + (port ? `:${Number(port.slice(1))}` : "") || (port && !/^:\d+$/.test(port)) || url.pathname !== "/" || url.username || url.password || url.search || url.hash || host.includes("*") || host.includes("/")) fail("app-host-invalid", "HTTP permissions need exact lowercase hosts, with an optional port.", 400);
      return host;
    });
    return { ...(read.length || write.length ? { files: { ...(read.length ? { read } : {}), ...(write.length ? { write } : {}) } } : {}), ...(http.length ? { http } : {}), ...(input.functions?.length ? { functions: [...input.functions] } : {}) };
  }

  list(access: AccessContext, limit = 20) {
    rights(access, "ragents.global-apps.read");
    const runId = this.#run(access);
    const view = runId ? this.#runtime().view(runId) : undefined;
    const globalApps = view ? liveGlobalApps(view).sort((a, b) => a.definition.name.localeCompare(b.definition.name)) : [];
    const failures = view ? registrationFailures(view) : [];
    return { apps: globalApps.slice(0, limit).map((app) => summaryOf(this.#runtime(), view!, app, this.#options.programs)),
      errors: [...view ? invalidApps(view).map(({ id, name, problem }) => ({ id, name, problem })) : [], ...failures.filter((failure) => !globalApps.some((app) => app.definition.name === failure.definition.name))
        .map((failure) => ({ id: failure.definition.name, name: failure.definition.name, problem: failure.problem }))], hasMore: globalApps.length > limit };
  }

  read(access: AccessContext, name: string, logLimit = 20): GlobalAppDetails & { state: JsonValue } {
    rights(access, "ragents.global-apps.read");
    const runId = this.#run(access) ?? fail("app-not-found", `App ${name} does not exist.`, 404);
    const view = this.#runtime().view(runId);
    const app = liveGlobalApps(view).find((entry) => entry.definition.name === name);
    const failure = registrationFailures(view).find((entry) => entry.definition.name === name);
    if (!app && failure) return {
      app: { name, description: failure.definition.description, triggers: failure.definition.triggers ?? {}, views: [], paused: true, status: "blocked", lastRunAt: null, nextRunAt: null, lastResult: null, problem: failure.problem },
      definition: structuredClone(failure.definition), timeoutSeconds: failure.definition.timeoutSeconds ?? 30, permissions: structuredClone(failure.definition.permissions), sandbox: "unavailable",
      source: { ...failure.source }, state: {}, log: [{ at: failure.at, occurrence: 0, level: "error", text: failure.problem }], droppedLogLines: 0,
    };
    if (!app) return missingApp(view, name);
    const state = view.pluginStates.find((entry) => entry.pluginId === ACTOR_STATE_ID && entry.scope.kind === "actor" && entry.scope.actorId === app.actorId)?.state;
    return { app: summaryOf(this.#runtime(), view, app, this.#options.programs), definition: structuredClone(app.definition), timeoutSeconds: app.definition.timeoutSeconds, permissions: structuredClone(app.definition.permissions), sandbox: app.sandbox,
      source: { ...app.source }, state: structuredClone(state ?? {}), log: app.log.slice(-logLimit), droppedLogLines: app.droppedLogLines + Math.max(0, app.log.length - logLimit) };
  }

  snapshot(access: AccessContext): GlobalAppsSnapshot {
    rights(access, "ragents.global-apps.read");
    try {
      const runId = this.#run(access);
      const listed = this.list(access, 50);
      return { runId: runId ?? null, revision: runId ? this.#runtime().view(runId).revision : 0, apps: listed.apps, errors: listed.errors, problem: runId ? this.#failures.get(runId) ?? null : null };
    } catch (error) { return { runId: globalAppsRunId(ownerOf(access)), revision: 0, apps: [], errors: [], problem: errorText(error) }; }
  }

  subscribe(access: AccessContext, receive: (snapshot: GlobalAppsSnapshot) => void): () => void {
    const owner = ownerOf(access);
    const listener = (changed: string | null) => {
      if (changed !== owner) return;
      const current = this.#options.userAccess(owner);
      receive(current.can("ragents.global-apps.read") ? this.snapshot(current) : { runId: null, revision: 0, apps: [], errors: [], problem: "Missing permission ragents.global-apps.read." });
    };
    this.#listeners.add(listener);
    receive(this.snapshot(access));
    return () => this.#listeners.delete(listener);
  }

  #notify(runId: string): void {
    const owner = this.#runtime().state(runId).ownerUserId;
    for (const listener of this.#listeners) listener(owner);
  }

  view(access: AccessContext, name: string, viewId: string) {
    rights(access, "ragents.global-apps.read", "runs.read");
    const runId = this.#run(access) ?? fail("app-not-found", "The global app does not exist.", 404);
    const app = byName(this.#runtime().view(runId), name);
    const view = this.#options.programs.apps(runId, app.actorId).find((view) => view.id === viewId) ?? fail("app-view-not-found", "This view does not belong to the global app.", 404);
    this.#options.programs.frame(runId, view.id, view.revision);
    return view;
  }

  async run(access: AccessContext, name: string): Promise<{ accepted: true }> {
    rights(access, "ragents.global-apps.write", "runs.write");
    const runId = this.#run(access) ?? fail("app-not-found", `App ${name} does not exist.`, 404);
    return this.#serial(runId, async () => {
      await this.#pump(runId);
      this.#accept(runId, byName(this.#runtime().view(runId), name), "manual");
      this.#arm();
      return { accepted: true };
    });
  }

  async pause(access: AccessContext, name: string, paused: boolean): Promise<{ changed: boolean }> {
    rights(access, "ragents.global-apps.write", "runs.write");
    const runId = this.#run(access) ?? fail("app-not-found", `App ${name} does not exist.`, 404);
    return this.#serial(runId, async () => {
      const app = byName(this.#runtime().view(runId), name);
      const changed = app.paused !== paused || app.problem !== null;
      const interval = app.definition.triggers?.interval;
      if (changed) this.#write(runId, { ...app, paused, problem: null, filePending: false, nextDueAt: paused || !interval ? null : new Date(this.#now() + interval.everySeconds * 1000).toISOString() });
      await this.#syncWatches(runId);
      this.#arm();
      return { changed };
    });
  }

  async remove(access: AccessContext, name: string): Promise<{ removed: true }> {
    rights(access, "ragents.global-apps.write", "runs.write");
    const runId = this.#run(access) ?? fail("app-not-found", `App ${name} does not exist.`, 404);
    return this.#serial(runId, async () => {
      const damaged = invalidApps(this.#runtime().view(runId)).find((app) => app.name === name);
      if (damaged) {
        await this.#options.interrupt(runId, damaged.actorId, "Damaged global app removed.");
        await this.#options.programs.remove(this.#context(runId), runId, name);
        this.#runtime().replacePluginState(this.#context(runId), runId, { pluginId: GLOBAL_APPS_PLUGIN_ID, scope: { kind: "actor", actorId: damaged.actorId }, state: null });
        this.#registrationFailure(runId, name);
        await this.#syncWatches(runId);
        this.#arm();
        return { removed: true };
      }
      if (!liveGlobalApps(this.#runtime().view(runId)).some((app) => app.definition.name === name) && registrationFailures(this.#runtime().view(runId)).some((failure) => failure.definition.name === name)) {
        this.#registrationFailure(runId, name);
        return { removed: true };
      }
      const app = byName(this.#runtime().view(runId), name);
      this.#write(runId, { ...app, paused: true, nextDueAt: null, problem: "Removing app." });
      try {
        await this.#options.interrupt(runId, app.actorId, "Global app removed.");
        if (this.#options.programs.programOf(runId, app.actorId)) await this.#options.programs.remove(this.#context(runId), runId, name);
        this.#write(runId, { ...app, paused: true, nextDueAt: null, problem: null, phase: { kind: "removed" } });
      } catch (error) {
        this.#write(runId, { ...app, paused: true, nextDueAt: null, problem: errorText(error) });
        throw error;
      }
      this.#arm();
      await this.#syncWatches(runId);
      return { removed: true };
    });
  }

  trigger(caller: ToolCaller): GlobalAppTrigger {
    const app = this.#runningGlobalApp(caller);
    if (app.phase.kind !== "accepted") return fail("app-tick-invalid", "This input has no accepted app occurrence.");
    return { key: app.phase.tick.key, scheduledAt: app.phase.tick.scheduledAt, reason: app.phase.tick.reason };
  }

  #runningGlobalApp(caller: ToolCaller): StoredGlobalApp {
    const app = liveGlobalApps(this.#runtime().view(caller.runId)).find((entry) => entry.actorId === caller.actorId);
    if (!app || app.phase.kind !== "accepted" || turnFor(this.#runtime(), caller.runId, app.phase.tick)?.id !== caller.turnId) return fail("app-tick-invalid", "This input is not an accepted app occurrence.");
    rights(this.#options.userAccess(this.#runtime().state(caller.runId).ownerUserId), "ragents.global-apps.write", "runs.write");
    return app;
  }

  async fileRead(caller: ToolCaller, filename: string): Promise<string> {
    const app = this.#runningGlobalApp(caller);
    const target = await this.#file(app, filename, "read");
    const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > 250000) fail("app-file-limit", "An app reads regular files of at most 250000 bytes.");
      const content = await file.readFile("utf8");
      if (Buffer.byteLength(content) > 250000) fail("app-file-limit", "An app reads at most 250000 bytes.");
      return content;
    } finally { await file.close(); }
  }

  async fileWrite(caller: ToolCaller, filename: string, content: string): Promise<{ written: true }> {
    const app = this.#runningGlobalApp(caller);
    if (Buffer.byteLength(content) > 250000) fail("app-file-limit", "An app writes at most 250000 bytes.");
    const target = await this.#file(app, filename, "write");
    const file = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    try {
      if (!(await file.stat()).isFile()) fail("app-file-limit", "An app writes only regular files.");
      await file.truncate(0);
      await file.writeFile(content, "utf8");
    } finally { await file.close(); }
    return { written: true };
  }

  async #file(app: StoredGlobalApp, filename: string, mode: "read" | "write"): Promise<string> {
    if (!path.isAbsolute(filename)) fail("app-file-invalid", "Global app file paths must be absolute.", 400);
    const roots = app.definition.permissions.files?.[mode] ?? [];
    if (roots.length === 0) fail("app-file-denied", `This app has no file ${mode} permission.`, 403);
    for (const root of roots) if (await realpath(root) !== root) fail("app-folder-changed", "A permitted folder changed its target.");
    return allowedWorkspacePath(await resolvedWorkspacePath(filename), roots);
  }

  async httpRequest(caller: ToolCaller, input: GlobalAppHttpRequest, signal?: AbortSignal): Promise<{ status: number; body: string }> {
    const app = this.#runningGlobalApp(caller);
    const url = new URL(input.url);
    const permitted = (app.definition.permissions.http ?? []).some((host) => {
      const target = new URL(`https://${host}`);
      const port = host.slice(target.hostname.length + 1);
      return target.hostname === url.hostname && (port ? Number(port) === Number(url.port || (url.protocol === "https:" ? 443 : 80)) : url.port === "");
    });
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !permitted) fail("app-http-denied", "This HTTP destination is not permitted.", 403);
    if (Object.keys(input.headers ?? {}).some((name) => name.toLowerCase() === "host")) fail("app-http-denied", "Global app HTTP requests cannot override the destination host.", 403);
    if (input.body && Buffer.byteLength(input.body) > 250000) fail("app-http-limit", "An app HTTP body may contain at most 250000 bytes.");
    const response = await fetch(url, { method: input.method ?? "GET", headers: input.headers, body: input.body, redirect: "manual", signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30000)]) });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      fail("app-http-redirect", "Global app HTTP requests do not follow redirects.");
    }
    const chunks: Uint8Array[] = [];
    const reader = response.body?.getReader();
    if (!reader) return { status: response.status, body: "" };
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (chunks.reduce((count, part) => count + part.byteLength, 0) + chunk.value.byteLength > 250000) fail("app-http-limit", "An app HTTP response may contain at most 250000 bytes.");
        chunks.push(chunk.value);
      }
      return { status: response.status, body: Buffer.concat(chunks).toString("utf8") };
    } finally { await reader.cancel(); }
  }

  #write(runId: string, app: StoredGlobalApp): void {
    this.#runtime().replacePluginState(this.#context(runId), runId, { pluginId: GLOBAL_APPS_PLUGIN_ID, scope: { kind: "actor", actorId: app.actorId }, state: app as unknown as JsonValue });
  }

  #registrationFailure(runId: string, name: string, failure?: RegistrationFailure): void {
    const view = this.#runtime().view(runId);
    const app = liveGlobalApps(view).find((entry) => entry.definition.name === name);
    if (app && failure) this.#write(runId, { ...app, problem: failure.problem });
    const marker = view.pluginStates.find((entry) => entry.pluginId === GLOBAL_APPS_PLUGIN_ID && entry.scope.kind === "run")!.state;
    const failures = registrationFailures(view).filter((entry) => entry.definition.name !== name);
    this.#runtime().replacePluginState(this.#context(runId), runId, {
      pluginId: GLOBAL_APPS_PLUGIN_ID,
      scope: { kind: "run" },
      state: { ...marker as Record<string, JsonValue>, failedRegistrations: [...failures, ...failure && !app ? [failure] : []].slice(-50) as unknown as JsonValue },
    });
  }

  #accept(runId: string, app: StoredGlobalApp, reason: GlobalAppTrigger["reason"]): void {
    const view = this.#runtime().view(runId);
    if (this.#closed || this.#stopped.has(runId) || problemOf(view, app)) fail("app-blocked", problemOf(view, app) ?? "The global apps run is stopped.");
    rights(this.#options.userAccess(this.#runtime().state(runId).ownerUserId), "ragents.global-apps.write", "runs.write");
    if (app.phase.kind !== "idle" || view.inputs.some((input) => input.actorId === app.actorId && input.lifecycle.kind === "pending") || actorOf(view, app)?.lifecycle.kind !== "idle") fail("app-busy", "The app already has accepted or running work.");
    if (liveGlobalApps(view).filter((entry) => entry.phase.kind === "accepted").length >= 4) fail("global-apps-busy", "Four global apps are already active for this user.");
    const number = app.occurrence + 1;
    const key = `${runId}:${app.definition.name}:${number}`;
    const tick = { number, key, commandId: `global-apps-input:${key}`, reason, scheduledAt: reason === "interval" ? app.nextDueAt! : this.#at() };
    const accepted: StoredGlobalApp = { ...app, occurrence: number, phase: { kind: "accepted", tick }, lastRunAt: this.#at(), nextDueAt: null, filePending: reason === "file-change" ? false : app.filePending };
    this.#write(runId, accepted);
    this.#enqueue(runId, accepted, tick);
  }

  #enqueue(runId: string, app: StoredGlobalApp, tick: Occurrence): void {
    if (inputFor(this.#runtime(), runId, tick)) return;
    this.#runtime().enqueueInput({ actorId: this.#runtime().state(runId).ownerId, commandId: tick.commandId }, runId, { actorId: app.actorId, presentation: "background", content: "Global app occurrence." });
  }

  async #pump(runId: string): Promise<void> {
    if (this.#closed || this.#stopped.has(runId)) return;
    const runtime = this.#runtime();
    for (const app of liveGlobalApps(runtime.view(runId))) {
      try {
      if (app.phase.kind !== "accepted") continue;
      if (app.problem && !inputFor(runtime, runId, app.phase.tick)) continue;
      this.#enqueue(runId, app, app.phase.tick);
      const turn = turnFor(runtime, runId, app.phase.tick);
      if (!turn) continue;
      if (turn.status === "running") {
        if (this.#now() >= Date.parse(turn.startedAt) + app.definition.timeoutSeconds * 1000) {
          try { await this.#options.interrupt(runId, app.actorId, "Global app deadline expired."); }
          catch (error) { this.#write(runId, { ...app, problem: errorText(error) }); }
        }
        if (turnFor(runtime, runId, app.phase.tick)?.status === "running") continue;
      }
      const finished = turnFor(runtime, runId, app.phase.tick)!;
      const output = runtime.events(runId).filter((event) => event.type === "runtime.output.recorded" && event.payload.turnId === finished.id);
      const lines: GlobalAppLog[] = output.flatMap((event) => event.type === "runtime.output.recorded" ? event.payload.text.split(/\r?\n/).map((text) => ({ at: event.occurredAt, occurrence: app.occurrence, level: "info" as const, text: text.slice(0, 1000) })) : []);
      const outcome = finished.reason === "Global app deadline expired." ? "timeout" : finished.status === "completed" ? "completed" : finished.status === "interrupted" ? "interrupted" : "failed";
      const result: GlobalAppResult = { outcome, at: finished.finishedAt ?? this.#at(), summary: (outcome === "completed" ? lines.at(-1)?.text ?? "Completed." : finished.reason ?? "The app failed.").slice(0, 1000) };
      const current = byName(runtime.view(runId), app.definition.name);
      this.#write(runId, { ...current, phase: { kind: "idle" }, lastResult: result,
        nextDueAt: current.paused || !app.definition.triggers?.interval ? null : new Date(Date.parse(result.at) + app.definition.triggers.interval.everySeconds * 1000).toISOString(),
        ...boundedLog(current, [...lines, ...outcome === "completed" ? [] : [{ at: result.at, occurrence: app.occurrence, level: "error" as const, text: result.summary }]]),
      });
      } catch (error) { this.#write(runId, { ...app, problem: errorText(error) }); }
    }
    const view = runtime.view(runId);
    if (view.pause) { await this.#syncWatches(runId); return; }
    const due = liveGlobalApps(view).filter((app) => !app.paused && app.phase.kind === "idle" && !app.problem && (app.filePending || app.nextDueAt !== null && Date.parse(app.nextDueAt) <= this.#now()))
      .sort((a, b) => (Date.parse(a.nextDueAt ?? this.#at()) - Date.parse(b.nextDueAt ?? this.#at())) || a.definition.name.localeCompare(b.definition.name));
    for (const app of due) {
      if (liveGlobalApps(runtime.view(runId)).filter((entry) => entry.phase.kind === "accepted").length >= 4) break;
      try { this.#accept(runId, app, app.filePending ? "file-change" : "interval"); }
      catch (error) { this.#write(runId, { ...app, problem: errorText(error) }); }
    }
    await this.#syncWatches(runId);
  }

  async #syncWatches(runId: string): Promise<void> {
    const view = this.#runtime().view(runId);
    const enabled = this.#closed || this.#stopped.has(runId) || view.pause ? [] : liveGlobalApps(view).filter((app) => !app.paused && !app.problem);
    const desired = enabled.flatMap((app) => (app.definition.triggers?.fileChange?.folders ?? []).map((folder) => ({ app, folder, key: `${runId}\0${app.actorId}\0${folder}` })));
    for (const [key, watch] of this.#watches) {
      if (!key.startsWith(`${runId}\0`) || desired.some((entry) => entry.key === key && entry.app.actorId === watch.signature)) continue;
      watch.stop();
      this.#watches.delete(key);
    }
    for (const { app, folder, key } of desired) {
      if (this.#watches.has(key) || byName(this.#runtime().view(runId), app.definition.name).problem) continue;
      const blocked = (error: Error) => {
        void this.#serial(runId, async () => {
          const current = liveGlobalApps(this.#runtime().view(runId)).find((entry) => entry.actorId === app.actorId);
          if (current) this.#write(runId, { ...current, problem: errorText(error) });
          await this.#syncWatches(runId);
        }).catch((cause) => { this.#failures.set(runId, errorText(cause)); this.#notify(runId); });
      };
      try {
        if (await realpath(folder) !== folder) throw new Error("The watched folder changed its target.");
        const stop = await (this.#options.watch ?? watchDirectory)(folder, {
          onChange: () => {
            void this.#serial(runId, async () => {
              const current = liveGlobalApps(this.#runtime().view(runId)).find((entry) => entry.actorId === app.actorId);
              if (this.#closed || this.#stopped.has(runId) || this.#runtime().view(runId).pause || !current || current.paused || current.problem) return;
              this.#write(runId, { ...current, filePending: true });
              await this.#pump(runId);
            }).catch((cause) => blocked(cause instanceof Error ? cause : new Error(errorText(cause)))).finally(() => this.#arm());
          },
          onError: blocked,
        });
        this.#watches.set(key, { signature: app.actorId, stop });
      } catch (error) {
        this.#write(runId, { ...byName(this.#runtime().view(runId), app.definition.name), problem: errorText(error) });
        for (const [ownedKey, watch] of this.#watches) if (ownedKey.startsWith(`${runId}\0${app.actorId}\0`)) { watch.stop(); this.#watches.delete(ownedKey); }
      }
    }
  }

  #serial<T>(runId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(runId) ?? Promise.resolve();
    const operation = previous.then(work);
    const settled = operation.then(() => undefined, () => undefined);
    this.#queues.set(runId, settled);
    void settled.then(() => { if (this.#queues.get(runId) === settled) this.#queues.delete(runId); });
    return operation;
  }

  #queuePump(runId: string): void {
    void this.#serial(runId, () => this.#pump(runId)).catch((error) => { this.#failures.set(runId, errorText(error)); this.#notify(runId); }).finally(() => this.#arm());
  }

  #arm(): void {
    this.#cancelWake?.();
    this.#cancelWake = undefined;
    if (this.#closed) return;
    const deadlines = [...this.#runs].flatMap((runId) => {
      if (this.#stopped.has(runId) || this.#failures.has(runId)) return [];
      try {
        const view = this.#runtime().view(runId);
        const globalApps = liveGlobalApps(view);
        const full = globalApps.filter((app) => app.phase.kind === "accepted").length >= 4;
        return globalApps.flatMap((app) => {
          if (app.phase.kind === "accepted") {
            const turn = turnFor(this.#runtime(), runId, app.phase.tick);
            return turn?.status === "running" && !app.problem ? [Date.parse(turn.startedAt) + app.definition.timeoutSeconds * 1000] : [];
          }
          return !full && !app.paused && !problemOf(view, app) && app.nextDueAt !== null ? [Date.parse(app.nextDueAt)] : [];
        });
      } catch (error) { this.#failures.set(runId, errorText(error)); return []; }
    });
    if (!deadlines.length) return;
    const delay = Math.min(30000, Math.max(10, Math.min(...deadlines) - this.#now()));
    const callback = () => { for (const runId of this.#runs) this.#queuePump(runId); };
    if (this.#options.wake) this.#cancelWake = this.#options.wake(callback, delay);
    else {
      const timer = setTimeout(callback, delay);
      timer.unref();
      this.#cancelWake = () => clearTimeout(timer);
    }
  }

  stop(runId: string): void {
    if (!this.#runs.has(runId)) return;
    this.#stopped.add(runId);
    for (const [key, watch] of this.#watches) if (key.startsWith(`${runId}\0`)) { watch.stop(); this.#watches.delete(key); }
    this.#arm();
  }
  forget(runId: string): void {
    const known = this.#runs.has(runId);
    this.stop(runId);
    this.#runs.delete(runId);
    this.#failures.delete(runId);
    if (known) this.#notify(runId);
  }
  async shutdown(): Promise<void> {
    this.#closed = true;
    this.#cancelWake?.();
    this.#unsubscribe?.();
    this.#listeners.clear();
    for (const watch of this.#watches.values()) watch.stop();
    this.#watches.clear();
    await Promise.all([...this.#queues.values()]);
  }
}
