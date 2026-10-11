import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { DomainError, freeRoomName, hasCapability, inheritedGrants, type AccessContext, type Orchestration, type RunView, type ToolCaller } from "@ragents/engine";
import type { ActorProgramsService, NamedApp } from "@ragents/host/plugin-support/actor-programs/service.js";
import { GLOBAL_APPS_PLUGIN_ID, appCreateSchema, type GlobalAppCreate, type GlobalAppSummary, type GlobalAppsSnapshot } from "../contract.js";

const MAX_APPS = 50;
/** An app is an actor program in its own room of the global run; this record names it and nothing else. */
const markerSchema = Type.Object({ app: Type.String({ pattern: "^[a-z][a-z0-9-]{0,63}$" }) }, { additionalProperties: false });

export interface GlobalAppsServiceOptions {
  readonly runtime: () => Orchestration;
  readonly programs: ActorProgramsService;
  readonly userAccess: (userId: string | null) => AccessContext;
  readonly ensureRun: (runId: string) => void;
  readonly globalRunIdFor: (userId: string | null) => string;
  readonly isGlobalRun: (runId: string) => boolean;
  readonly ensureGlobalRun: (access: AccessContext, signal?: AbortSignal) => Promise<string>;
  readonly interrupt: (runId: string, actorId: string, reason: string) => Promise<void>;
}

const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);
const fail = (code: string, message: string, status = 409): never => { throw new DomainError(code, message, status); };
const ownerOf = (access: AccessContext): string | null => {
  if (access.enabled && !access.user) return fail("login-required", "Please sign in.", 401);
  return access.user?.id ?? null;
};
const rights = (access: AccessContext, ...required: readonly string[]): void => {
  for (const right of required) if (!access.can(right)) fail("access-denied", `Missing permission ${right}.`, 403);
};
const markersOf = (view: RunView) => view.pluginStates.flatMap((entry) => {
  if (entry.pluginId !== GLOBAL_APPS_PLUGIN_ID || entry.scope.kind !== "actor" || entry.state === null) return [];
  const actorId = entry.scope.actorId;
  const valid = Value.Check(markerSchema, entry.state);
  const name = valid ? (entry.state as { app: string }).app : view.actors.find((actor) => actor.id === actorId)?.handle ?? "damaged-app";
  return [{ actorId, name, valid }];
}).sort((left, right) => left.name.localeCompare(right.name));

export class GlobalAppsService {
  readonly #options: GlobalAppsServiceOptions;
  readonly #queues = new Map<string, Promise<void>>();
  readonly #listeners = new Set<(owner: string | null) => void>();
  #unsubscribe: (() => void) | undefined;

  constructor(options: GlobalAppsServiceOptions) { this.#options = options; }
  #runtime(): Orchestration { return this.#options.runtime(); }
  #context(runId: string) { return { actorId: this.#runtime().state(runId).ownerId, commandId: `globalApps:${randomUUID()}` }; }

  ready(): void {
    this.#unsubscribe ??= this.#runtime().subscribe((events) => {
      for (const runId of new Set(events.filter((event) => this.#options.isGlobalRun(event.runId)).map((event) => event.runId))) this.#notify(runId);
    });
  }

  #assertGlobalRun(runId: string): void {
    this.#options.ensureRun(runId);
    if (!this.#options.isGlobalRun(runId) || runId !== this.#options.globalRunIdFor(this.#runtime().state(runId).ownerUserId)) fail("global-apps-run-invalid", "The global space does not match its owner.");
  }

  #run(access: AccessContext): string | undefined {
    const runId = this.#options.globalRunIdFor(ownerOf(access));
    if (!this.#runtime().listRuns().some((run) => run.id === runId)) return undefined;
    this.#assertGlobalRun(runId);
    return runId;
  }

  async create(access: AccessContext, caller: ToolCaller, input: GlobalAppCreate, signal?: AbortSignal): Promise<{ program: string }> {
    rights(access, "ragents.global-apps.write", "runs.write");
    if (!Value.Check(appCreateSchema, input)) fail("app-invalid", "The global app does not match the contract.", 400);
    if (this.#runtime().state(caller.runId).ownerUserId !== ownerOf(access)) fail("app-source-denied", "The source package must belong to your user.", 403);
    this.#options.ensureRun(caller.runId);
    const actor = this.#runtime().view(caller.runId).actors.find((candidate) => candidate.id === caller.actorId);
    if (!actor || actor.kind === "human" || !hasCapability(actor, "agent.spawn", { kind: "run" }) || !hasCapability(actor, "plugin.state.write", { kind: "run" })) return fail("app-creation-denied", "Creating an app requires an actor with agent.spawn and plugin.state.write.", 403);
    const grants = inheritedGrants({ ...actor, grants: actor.grants.filter((grant) => grant.usable !== false && grant.delegable) });
    const runId = await this.#options.ensureGlobalRun(access, signal);
    this.#assertGlobalRun(runId);
    return this.#serial(runId, async () => {
      signal?.throwIfAborted();
      const view = this.#runtime().view(runId);
      if (view.pause) fail("global-apps-run-paused", "Resume the global space before creating an app.");
      const markers = markersOf(view);
      const existing = markers.find((marker) => marker.name === input.name);
      if (!existing && markers.length >= MAX_APPS) fail("app-limit", `A user may have at most ${MAX_APPS} global apps.`);
      const root = await this.#options.programs.workspaceDirectory(runId);
      const room = (existing && view.actors.find((candidate) => candidate.id === existing.actorId)?.room)
        ?? freeRoomName(view, input.name, (candidate) => existsSync(path.join(root, `${candidate}.${input.name}`)));
      const activated = await this.#options.programs.copyPackage({ runId: caller.runId, actorId: caller.actorId, name: input.program }, {
        runId, name: input.name, room: { name: room, origin: null }, grants, isolated: true,
      }, signal);
      if (!existing?.valid) this.#runtime().replacePluginState(this.#context(runId), runId, { pluginId: GLOBAL_APPS_PLUGIN_ID, scope: { kind: "actor", actorId: activated.actorId }, state: { app: input.name } });
      return { program: activated.name };
    });
  }

  list(access: AccessContext, limit = 20): { apps: GlobalAppSummary[]; errors: { id: string; name: string; problem: string }[]; hasMore: boolean } {
    rights(access, "ragents.global-apps.read");
    const runId = this.#run(access);
    if (!runId) return { apps: [], errors: [], hasMore: false };
    const markers = markersOf(this.#runtime().view(runId));
    const programs = this.#options.programs.programs(runId);
    const apps = markers.flatMap((marker) => {
      const program = marker.valid ? programs.find((entry) => entry.actorId === marker.actorId) : undefined;
      return program ? [{
        name: marker.name, actorId: marker.actorId, program: program.name, description: program.description, input: Boolean(program.input), triggers: program.triggers ?? {},
        views: program.views.map(({ id, title }) => ({ id, title, revision: program.revision })), ...this.#options.programs.triggerProgress(runId, marker.actorId),
      }] : [];
    });
    const errors = markers.flatMap((marker) => !marker.valid ? [{ id: `invalid:${marker.actorId}`, name: marker.name, problem: "The app record is damaged. Remove the app and create it again." }]
      : programs.some((entry) => entry.actorId === marker.actorId) ? [] : [{ id: marker.name, name: marker.name, problem: "The app's program is not active. Create the app again or remove it." }]);
    return { apps: apps.slice(0, limit), errors, hasMore: apps.length > limit };
  }

  /** The access's apps by name for read-only displays in its runs; none without the read right or a user. */
  named(access: AccessContext): readonly NamedApp[] {
    if (!access.can("ragents.global-apps.read") || (access.enabled && !access.user)) return [];
    const runId = this.#run(access);
    return runId ? this.list(access, MAX_APPS).apps.map((app) => ({ name: app.name, runId, actorId: app.actorId })) : [];
  }

  snapshot(access: AccessContext): GlobalAppsSnapshot {
    rights(access, "ragents.global-apps.read");
    try {
      const runId = this.#run(access);
      const listed = this.list(access, MAX_APPS);
      return { runId: runId ?? null, revision: runId ? this.#runtime().view(runId).revision : 0, apps: listed.apps, errors: listed.errors, problem: null };
    } catch (error) { return { runId: this.#options.globalRunIdFor(ownerOf(access)), revision: 0, apps: [], errors: [], problem: errorText(error) }; }
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

  async remove(access: AccessContext, name: string): Promise<{ removed: true }> {
    rights(access, "ragents.global-apps.write", "runs.write");
    const runId = this.#run(access) ?? fail("app-not-found", `App ${name} does not exist.`, 404);
    return this.#serial(runId, async () => {
      const marker = markersOf(this.#runtime().view(runId)).find((entry) => entry.name === name) ?? fail("app-not-found", `App ${name} does not exist.`, 404);
      await this.#options.interrupt(runId, marker.actorId, "Global app removed.");
      const program = this.#options.programs.programOf(runId, marker.actorId);
      if (program) await this.#options.programs.remove(this.#context(runId), runId, program.name);
      this.#runtime().replacePluginState(this.#context(runId), runId, { pluginId: GLOBAL_APPS_PLUGIN_ID, scope: { kind: "actor", actorId: marker.actorId }, state: null });
      return { removed: true as const };
    });
  }

  #serial<T>(runId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(runId) ?? Promise.resolve();
    const operation = previous.then(work);
    const settled = operation.then(() => undefined, () => undefined);
    this.#queues.set(runId, settled);
    void settled.then(() => { if (this.#queues.get(runId) === settled) this.#queues.delete(runId); });
    return operation;
  }

  async shutdown(): Promise<void> {
    this.#unsubscribe?.();
    this.#listeners.clear();
    await Promise.all([...this.#queues.values()]);
  }
}
