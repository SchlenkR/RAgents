import { randomBytes, randomUUID } from "node:crypto";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { DomainError, defineRunFunction, defineToolAvailability, holdsUsable, implement, implementChannel, schemaComplaints, type AccessContext, type AccessProjectionContribution, type ChannelContribution, type JournalEvent, type MethodContribution, type Orchestration, type RunFunction, type ToolContributor } from "@ragents/engine";
import type { ActorProgramDefinition, ActorViewDefinition } from "@ragents/host/plugin-support/actor-programs/contract.js";
import type { NamedApp } from "@ragents/host/plugin-support/actor-programs/service.js";
import { toolDescriptorFrom } from "@ragents/host/plugin-support/agent-tool.js";
import { APP_DISPLAYS_STATE_ID, MAX_APP_DISPLAYS, appDisplayContracts, appDisplayElementId, appDisplayStateSchema, type AppDisplay, type AppDisplayGroup, type AppDisplaySnapshot } from "../contract.js";
import { jsonValue } from "./limits.js";
import type { ActorProgramRuntime } from "./runtime.js";

const MAX_SOURCE_GROUPS = 50;
const MAX_LABEL = 200;
/** The events after which a display's app or the viewer's access to its run can look different. */
const relevantEvents = new Set(["plugin.state-replaced", "plugin.state-patched", "actor.stopped", "actor.restarted", "script.created", "run.sharing-changed"]);
const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);
const short = (text: string): string => text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 3)}...` : text;
const sameSource = (left: AppDisplay["source"], right: AppDisplay["source"]): boolean =>
  left.runId === right.runId && left.actorId === right.actorId && left.view === right.view;
type Named = NamedApp & { readonly label: string };

export interface AppDisplaysOptions {
  readonly runtime: () => Orchestration;
  readonly programs: Pick<ActorProgramRuntime, "programs" | "apps" | "namedAppSources">;
  /** Throws unless the access may read the run, as runReadGuardToken does. */
  readonly readable: (access: AccessContext, runId: string) => void;
  /** The runs the access sees, newest first. */
  readonly runs: (access: AccessContext) => Promise<readonly { readonly id: string; readonly title: string; readonly locked?: string }[]>;
  readonly ownerAccess: (runId: string) => AccessContext;
}

/** A refusal of the guard: a foreign run fails like a missing one, so both read as not available to this viewer. */
const refused = (error: unknown, display: AppDisplay): AppDisplaySnapshot => {
  const code = error instanceof DomainError ? error.code : undefined;
  if (code === "run-not-found" || code === "access-denied") return { status: "denied", title: display.title, from: null, message: "This app is not available to you." };
  if (code === "run-deleting" || code === "run-deleted") return { status: "removed", title: display.title, from: null, message: "The app's run was deleted." };
  return { status: "failed", title: display.title, from: null, message: `The app cannot be loaded: ${errorText(error)}` };
};

interface Listener { readonly runs: ReadonlySet<string>; readonly refresh: () => void }

/** Read-only displays of apps that live in other runs: pinned in the displaying run's journal, read live from the source run with the viewer's access. */
export class AppDisplays {
  readonly #options: AppDisplaysOptions;
  readonly #listeners = new Set<Listener>();
  #unsubscribe: (() => void) | undefined;

  constructor(options: AppDisplaysOptions) { this.#options = options; }

  displays(runId: string): readonly AppDisplay[] {
    const entry = this.#options.runtime().view(runId).pluginStates.find((item) => item.pluginId === APP_DISPLAYS_STATE_ID && item.scope.kind === "run");
    if (!entry) return [];
    if (!Value.Check(appDisplayStateSchema, entry.state)) throw new Error(`The app displays of this run are damaged: ${schemaComplaints(appDisplayStateSchema, entry.state)}`);
    return entry.state.displays;
  }

  #write(runId: string, displays: readonly AppDisplay[]): void {
    const state = { version: 1, displays: [...displays] };
    if (!Value.Check(appDisplayStateSchema, state)) throw new Error(`The app displays do not match their contract: ${schemaComplaints(appDisplayStateSchema, state)}`);
    const runtime = this.#options.runtime();
    runtime.replacePluginState({ actorId: runtime.state(runId).ownerId, commandId: `app-display:${randomUUID()}` }, runId, { pluginId: APP_DISPLAYS_STATE_ID, scope: { kind: "run" }, state: jsonValue(state, "App displays") });
  }

  #named(access: AccessContext): readonly Named[] {
    return this.#options.programs.namedAppSources().flatMap((source) => source.apps(access).map((app) => ({ ...app, label: source.label })));
  }

  #readable(access: AccessContext, runId: string): boolean {
    try {
      this.#options.readable(access, runId);
      return true;
    } catch (error) {
      if (error instanceof DomainError) return false;
      throw error;
    }
  }

  async sources(access: AccessContext, runId: string): Promise<{ groups: AppDisplayGroup[] }> {
    const runs = await this.#options.runs(access);
    const shown = this.displays(runId);
    const programs = new Map<string, readonly ActorProgramDefinition[]>();
    const programsFor = (sourceRunId: string) => {
      const found = programs.get(sourceRunId);
      if (found) return found;
      const entries = this.#options.programs.programs(sourceRunId);
      programs.set(sourceRunId, entries);
      return entries;
    };
    const choices = (sourceRunId: string, programs: readonly ActorProgramDefinition[], detail: (program: ActorProgramDefinition, view: ActorViewDefinition) => string | null) =>
      programs.flatMap((program) => program.views.filter((view) => view.visible).map((view) => ({
        title: short(view.title), detail: detail(program, view), runId: sourceRunId, view: view.id,
        shown: shown.some((display) => sameSource(display.source, { runId: sourceRunId, actorId: program.actorId, view: view.key })),
      })));
    const named = this.#options.programs.namedAppSources().map((source) => ({
      label: source.label,
      apps: source.apps(access).filter((app) => app.runId !== runId && this.#readable(access, app.runId))
        .flatMap((app) => choices(app.runId, programsFor(app.runId).filter((program) => program.actorId === app.actorId), () => app.name)),
    }));
    const others = runs.filter((run) => run.id !== runId && !run.locked).map((run) => ({
      label: short(run.title),
      apps: choices(run.id, programsFor(run.id), (program, view) => program.title !== view.title ? short(program.title) : null),
    }));
    return { groups: [...named, ...others].filter((group) => group.apps.length > 0).slice(0, MAX_SOURCE_GROUPS) };
  }

  #pin(runId: string, entry: Omit<AppDisplay, "id">): { elementId: string } {
    const displays = this.displays(runId);
    const existing = displays.find((display) => sameSource(display.source, entry.source));
    if (existing) return { elementId: appDisplayElementId(existing.id) };
    if (displays.length >= MAX_APP_DISPLAYS) throw new DomainError("app-display-limit", `A run shows at most ${MAX_APP_DISPLAYS} apps of other runs. Remove a display first.`, 409);
    const id = randomBytes(6).toString("hex");
    this.#write(runId, [...displays, { id, ...entry }]);
    return { elementId: appDisplayElementId(id) };
  }

  async add(access: AccessContext, runId: string, source: { readonly runId: string; readonly view: string }): Promise<{ elementId: string }> {
    if (source.runId === runId) throw new DomainError("app-display-own-run", "This app belongs to this run; open it directly.", 409);
    this.#options.readable(access, source.runId);
    const program = this.#options.programs.programs(source.runId).find((entry) => entry.views.some((view) => view.id === source.view));
    const view = program?.views.find((entry) => entry.id === source.view);
    if (!program || !view) throw new DomainError("app-not-found", "The app view is not active in its run.", 404);
    const named = this.#named(access).find((app) => app.runId === source.runId && app.actorId === program.actorId);
    const run = named ? undefined : (await this.#options.runs(access)).find((entry) => entry.id === source.runId && !entry.locked);
    if (!named && !run) throw new DomainError("app-not-found", "Only named apps such as global apps and apps of your runs can be shown.", 404);
    return this.#pin(runId, {
      title: short(view.title), from: named ? short(`${named.label}: ${named.name}`) : short(`Run "${run!.title}"`),
      source: { runId: source.runId, actorId: program.actorId, view: view.key }, ...named ? { name: named.name } : {},
    });
  }

  remove(runId: string, id: string): Record<string, never> {
    const displays = this.displays(runId);
    if (!displays.some((display) => display.id === id)) throw new DomainError("app-display-not-found", "This run has no such display.", 404);
    this.#write(runId, displays.filter((display) => display.id !== id));
    return {};
  }

  #namedApp(access: AccessContext, name: string): Named {
    const all = this.#named(access);
    const wanted = name.trim().toLowerCase();
    const matches = all.filter((app) => app.name.toLowerCase() === wanted);
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) throw new Error(`${name} is ambiguous: ${matches.map((app) => `${app.label}: ${app.name}`).join(", ")}.`);
    throw new Error(`${name} is no named app. Named apps: ${all.slice(0, 20).map((app) => app.name).join(", ") || "none"}.`);
  }

  addNamed(runId: string, name: string, reference?: string): null {
    const access = this.#options.ownerAccess(runId);
    const app = this.#namedApp(access, name);
    if (app.runId === runId) throw new Error(`${app.name} belongs to this run; its views are this run's own apps.`);
    this.#options.readable(access, app.runId);
    const program = this.#options.programs.programs(app.runId).find((entry) => entry.actorId === app.actorId);
    if (!program) throw new Error(`${app.name} has no active program.`);
    const views = program.views;
    const wanted = reference?.trim().toLowerCase();
    const matching = wanted === undefined ? views : views.filter((view) => view.key === wanted || view.title.toLowerCase() === wanted);
    if (matching.length !== 1) {
      throw new Error(views.length === 0 ? `${app.name} has no view to show.` : `Name one view of ${app.name}: ${views.map((view) => view.key).join(", ")}.`);
    }
    this.#pin(runId, { title: short(matching[0]!.title), from: short(`${app.label}: ${app.name}`), source: { runId: app.runId, actorId: app.actorId, view: matching[0]!.key }, name: app.name });
    return null;
  }

  removeNamed(runId: string, name: string, reference?: string): null {
    const displays = this.displays(runId);
    const wanted = name.trim().toLowerCase();
    const view = reference?.trim().toLowerCase();
    const matching = displays.filter((display) => display.name === wanted && (view === undefined || display.source.view === view || display.title.toLowerCase() === view));
    if (matching.length === 0) {
      const shown = [...new Set(displays.flatMap((display) => display.name ? [display.name] : []))].join(", ") || "none";
      throw new Error(`This run shows no display of ${name}${reference ? ` with the view ${reference}` : ""}. Named apps shown: ${shown}.`);
    }
    this.#write(runId, displays.filter((display) => !matching.includes(display)));
    return null;
  }

  /** What the viewer sees of a display now; checks the viewer's access to the source run every time and never throws. */
  snapshot(access: AccessContext, runId: string, id: string): AppDisplaySnapshot {
    let display: AppDisplay | undefined;
    try {
      display = this.displays(runId).find((entry) => entry.id === id);
    } catch (error) {
      return { status: "failed", title: "App display", from: null, message: errorText(error) };
    }
    if (!display) return { status: "removed", title: "App display", from: null, message: "This display was removed from the run." };
    try {
      this.#options.readable(access, display.source.runId);
    } catch (error) {
      return refused(error, display);
    }
    const { source } = display;
    const gone = (message: string): AppDisplaySnapshot => ({ status: "removed", title: display.title, from: display.from, message });
    try {
      if (!this.#options.runtime().hasRun(source.runId)) return gone("The app's run no longer exists.");
      const program = this.#options.programs.programs(source.runId).find((entry) => entry.actorId === source.actorId);
      if (!program) return gone("The app was removed from its run.");
      const view = program.views.find((entry) => entry.key === source.view);
      const listing = view && this.#options.programs.apps(source.runId, source.actorId).find((entry) => entry.id === view.id);
      if (!view || !listing) return gone("The app no longer has this view.");
      return { status: "ready", title: short(view.title), from: display.from, runId: source.runId, app: { ...listing, actions: [], invocations: [] } };
    } catch (error) {
      return { status: "failed", title: display.title, from: display.from, message: `The app cannot be loaded: ${errorText(error)}` };
    }
  }

  /** Sends the snapshot now and again whenever the displaying or the source run changes in a way that can alter it. */
  subscribe(access: AccessContext, runId: string, id: string, emit: (snapshot: AppDisplaySnapshot) => void): () => void {
    const source = (() => {
      try { return this.displays(runId).find((entry) => entry.id === id)?.source.runId; } catch { return undefined; }
    })();
    let sent: string | undefined;
    const listener: Listener = {
      runs: new Set([runId, ...source ? [source] : []]),
      refresh: () => {
        const next = this.snapshot(access, runId, id);
        const signature = JSON.stringify(next);
        if (signature === sent) return;
        sent = signature;
        emit(next);
      },
    };
    this.#listeners.add(listener);
    this.#unsubscribe ??= this.#options.runtime().subscribe((events) => this.#changed(events));
    listener.refresh();
    return () => { this.#listeners.delete(listener); };
  }

  #changed(events: readonly JournalEvent[]): void {
    const runs = new Set(events.filter((event) => relevantEvents.has(event.type)).map((event) => event.runId));
    if (runs.size === 0) return;
    for (const listener of this.#listeners) if ([...listener.runs].some((runId) => runs.has(runId))) listener.refresh();
  }

  /** A deleted run produces no event; its displays and the displays of its apps learn of it here. */
  deleted(runId: string): void {
    for (const listener of this.#listeners) if (listener.runs.has(runId)) listener.refresh();
  }

  shutdown(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#listeners.clear();
  }
}

/** The message layer checks the displaying run; every snapshot checks the viewer's access to the app's run. */
export const createAppDisplayMethods = (displays: AppDisplays): MethodContribution[] => [
  implement(appDisplayContracts.sources, ({ runId }, { access }) => displays.sources(access, runId)),
  implement(appDisplayContracts.add, ({ runId, source }, { access }) => displays.add(access, runId, source)),
  implement(appDisplayContracts.remove, ({ runId, display }) => displays.remove(runId, display)),
];

export const createAppDisplayChannel = (displays: AppDisplays): ChannelContribution =>
  implementChannel(appDisplayContracts.display, ({ runId, display }, emit, { access }) => displays.subscribe(access, runId, display, emit));

/** Without runs.inspect a viewer sees only each display's ID and title, not where its app lives. */
export const appDisplaysProjection: AccessProjectionContribution = {
  id: APP_DISPLAYS_STATE_ID,
  state: (entry) => Value.Check(appDisplayStateSchema, entry.state)
    ? { version: 1, displays: entry.state.displays.map(({ id, title }) => ({ id, title })) }
    : entry.state,
  chatEvent: () => undefined,
};

export const appDisplayToolNames = ["app_display_add", "app_display_remove"] as const;

export const createAppDisplayTools = (displays: AppDisplays, offered: () => boolean): ToolContributor => {
  const available = defineToolAvailability({ availability: "conditional", availabilityDetail: "For executable actors with plugin.state.write while a plugin offers named apps, such as global apps." },
    (actor) => actor.kind !== "human" && holdsUsable(actor, "plugin.state.write") && offered());
  const schema = Type.Object({
    app: Type.String({ minLength: 1, maxLength: 64, description: "The app's name, for a global app as global_app_list shows it" }),
    view: Type.Optional(Type.String({ minLength: 1, maxLength: 200, description: "View key or title; only needed when the app has several views" })),
  }, { additionalProperties: false });
  const metadata = [
    { name: appDisplayToolNames[0], label: "Show App Read-only", description: "Show a named app, such as a global app, read-only as a window of this run.",
      longDescription: "The window always shows the app's current state; it calls no functions and starts nothing. Showing the same view again changes nothing. The user shows apps of other runs through Show app..." },
    { name: appDisplayToolNames[1], label: "Remove App Display", description: "Remove this run's read-only display of a named app; the app itself stays as it is.",
      longDescription: "Without view, every shown view of the app is removed." },
  ] as const;
  const functions: RunFunction[] = [
    defineRunFunction({ ...metadata[0], schema, resultSchema: Type.Null({ description: "Shown; an error throws." }), available, executionMode: "sequential",
      run: (scope, _id, input) => displays.addNamed(scope.caller.runId, input.app, input.view) }),
    defineRunFunction({ ...metadata[1], schema, resultSchema: Type.Null({ description: "Removed; an error throws." }), available, executionMode: "sequential",
      run: (scope, _id, input) => displays.removeNamed(scope.caller.runId, input.app, input.view) }),
  ];
  return { name: "ragents.actor-programs.displays", descriptors: metadata.map((item) => toolDescriptorFrom(item, available)), tools: () => functions };
};
