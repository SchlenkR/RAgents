import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { lstatSync, readFileSync, renameSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { Type, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { actorByHandle, actorDescriptionMaxLength, agentTools, assertJsonValue, canonicalHash, defineRunFunction, defineToolAvailability, emptyUsage, handleKey, inheritedGrants, runCapabilityContractHash, scriptInputOf, schemaComplaints, type Actor, type ActorProgramExecutor, type RunFunction, type CommandContext, type ExecutableActor, type JsonValue, type Orchestration, type PluginContext, type RunCapabilityDescriptor, type RunView, type TurnRequest, type TurnResult, } from "@ragents/engine";
import { ACTOR_PROGRAMS_STATE_ID, ACTOR_INVOCATIONS_STATE_ID, ACTOR_SCRIPT_STATE_ID, ACTOR_STATE_ID, resolveActorView, type ActorDataState, type ActorFunctionDefinition, type ActorFunctionInvocation, type ActorPackageOrigin, type ActorProgramDefinition, type ActorProgramIdentity, type ActorProgramState, type ActorScriptDelivery, type ActorScriptPackage, type ActorScriptState, type ActorViewListing, } from "@ragents/host/plugin-support/actor-programs/contract.js";
import type { ActivatedActorProgram, ActorProgramSource, ActorProgramsService, RunScriptSources, RunScriptStartInput } from "@ragents/host/plugin-support/actor-programs/service.js";
import { jsonValue, jsonBytes, MAX_INVOCATIONS_STATE_BYTES } from "./limits.js";
import { agentResultText, finishesOf, MAX_OPEN_STARTS, scriptResultContent, scriptStateOf, type ScriptFinish } from "./script-state.js";
import { agentCapabilityBinding, operatorCapabilityBinding } from "./capability-resolver.js";
import type { ActorOperationPort } from "./operations.js";
import { compileClientProject, installClientSdk } from "@ragents/host/plugin-support/actor-programs/client-compiler.js";
import { compileAppBackend, installServerSdk, packageIdentity, prepareAppProject, prepareAppWorkspace, projectSourceFiles, readAppPackage, typecheckServerProject, type AppContract } from "@ragents/host/plugin-support/actor-programs/app-project.js";
import { syncWorkspaceOwnership } from "@ragents/host/plugin-support/workspace-ownership.js";
import { runManagedProcess, sandboxedLaunch, type WorkspaceProcessContext } from "@ragents/workspace-executor";
import { runModuleTemplates, templateById, templateFiles } from "./templates.js";
import { createTestReport, testReporterArgument } from "./test-report.js";
import { FRAME_BODY_CLASS, FRAME_DOCUMENT_CLASS, FRAME_ROOT_CLASS } from "@ragents/host/plugin-support/actor-programs/client-runtime.js";
import { buildTailwind } from "@ragents/host/plugin-support/actor-programs/tailwind.js";
import type { AskService } from "@ragents/plugins/ragents.ask/server/contract.js";
const NAME = /^[a-z][a-z0-9-]{0,63}$/;
const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);
const maxShownComplaints = 10;
const maxComplaintLength = 240;
/** A failed check names the count and the first complaints; `lines` keeps all of them for actor_program_diagnostics. */
const checkFailure = (title: string, lines: readonly string[], fallback: string): Error => {
    const all = [...new Set(lines.map((line) => line.trim()).filter((line) => line !== ""))];
    if (all.length === 0)
        return new Error(fallback);
    const shown = all.slice(0, maxShownComplaints).map((line) => line.length > maxComplaintLength ? `${line.slice(0, maxComplaintLength - 3)}...` : line);
    const omitted = all.length - shown.length;
    return Object.assign(new Error([
        `${title}: ${all.length} errors.`,
        ...shown,
        ...(omitted > 0 ? [`... and ${omitted} more; all with actor_program_diagnostics.`] : []),
    ].join("\n")), { lines: all });
};
const actorDescriptionOf = (text: string | undefined): string | undefined => {
    const line = (text ?? "").replace(/\s+/g, " ").trim();
    return line.length <= actorDescriptionMaxLength ? line || undefined : `${line.slice(0, actorDescriptionMaxLength - 3).trimEnd()}...`;
};
const exposed = defineToolAvailability({ availability: "conditional", availabilityDetail: "Published function of an active actor in the run." }, () => true);
const objectSchema = { type: "object", additionalProperties: true };
const checked = (schema: object, value: unknown, label: string): JsonValue => {
    const result = jsonValue(value, label);
    if (!Value.Check(schema as TSchema, result))
        throw new Error(`${label}: ${schemaComplaints(schema as TSchema, result)}`);
    return result;
};
const safePath = (name: string): string => {
    if (!name || path.isAbsolute(name) || name.includes("\\") || name.includes("\0") || name.split("/").some((part) => !part || part === "." || part === ".."))
        throw new Error(`Invalid package path ${name}.`);
    return name;
};
const inside = async (directory: string, relative: string): Promise<string> => {
    const root = await realpath(directory);
    const file = await realpath(path.join(root, safePath(relative)));
    if (!file.startsWith(`${root}${path.sep}`))
        throw new Error(`Package path ${relative} is outside the package.`);
    const stat = await lstat(file);
    if (!stat.isFile() || stat.size > 2000000)
        throw new Error(`Invalid or too large package file ${relative}.`);
    return readFile(file, "utf8");
};
const occupied = (file: string): boolean => {
    try {
        lstatSync(file);
        return true;
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
            return false;
        throw error;
    }
};
const packageExists = (name: string): Error => new Error(`The package ${name} already exists.`);
// Check and rename synchronously one after the other, because rename silently replaces an empty target folder.
const commitPackage = (staged: string, directory: string, name: string): void => {
    if (occupied(directory))
        throw packageExists(name);
    try {
        renameSync(staged, directory);
    }
    catch (error) {
        if (["EEXIST", "ENOTEMPTY", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? ""))
            throw packageExists(name);
        throw error;
    }
};
const sameSources = async (directory: string, files: readonly ActorProgramSource[]): Promise<boolean> =>
    packageIdentity(await projectSourceFiles(directory)) === packageIdentity(files);
const sameOrigin = (left: ActorPackageOrigin, right: ActorPackageOrigin): boolean =>
    left.kind === "script" ? right.kind === "script" && left.entryId === right.entryId : right.kind === "shared" && left.pluginId === right.pluginId;
const originText = (origin: ActorPackageOrigin | undefined): string =>
    !origin ? "that no run script installed" : origin.kind === "script" ? `from the run script ${origin.entryId}` : `shared by ${origin.pluginId}`;
/** A package the host installs for a run script, with the origin it records. */
interface OriginPackage { name: string; files: readonly ActorProgramSource[]; origin: ActorPackageOrigin }
/** What a claim wrote for a name and what it replaced; a release restores only a record nobody changed since. */
interface Claim { name: string; claimed: ActorScriptPackage; previous: ActorScriptPackage | undefined }
/** A name reserved by a shared package that the run holds for something else. */
const foreignShared = (name: string, pluginId: string, record: ActorScriptPackage | undefined): Error => {
    const holder = !record ? "that the host did not install" : sameOrigin(record.origin, { kind: "shared", pluginId }) ? "that was changed in the run" : originText(record.origin);
    return new Error(`${name} is the shared actor package of ${pluginId}, but this run has a package ${name} ${holder}; the host neither uses nor replaces it. Remove or rename that package.`);
};
const descriptor = (tool: RunFunction): RunCapabilityDescriptor => ({ id: tool.name, label: tool.label, description: tool.description, schema: tool.schema, resultSchema: tool.resultSchema });
interface BackendBinding {
    id: string;
    kind: "tool" | "app-action" | "input";
    principal: {
        id: string;
        kind: "agent" | "script" | "operator";
    };
    output?: string[];
    descriptorsFor: (capabilityIds: readonly string[]) => readonly RunCapabilityDescriptor[];
    call: (name: string, input: JsonValue, index: number) => Promise<JsonValue>;
}
interface CapabilityContract {
    capabilityIds: string[];
    capabilityContractHash: string;
}
interface InvocationState {
    version: 1;
    invocations: ActorFunctionInvocation[];
    requestIds: string[];
}
interface CompiledProgram {
    directory: string;
    files: ActorProgramSource[];
    definition: ActorProgramDefinition;
    backendJavaScript?: string;
    frameStyles: string;
    clients: {
        file: string;
        javaScript: string;
    }[];
    createActor: boolean;
}
export interface ActorProgramRuntimeOptions {
    runtime: () => Orchestration;
    agentToolsFor: (runId: string, actorId: string, provisional?: ExecutableActor) => Promise<readonly RunFunction[]>;
    askService: () => AskService;
    reservedToolNames: () => readonly string[];
    /** Programs, tests, and builds run on the server, even with a workspace on a workstation. */
    serverProcessContextFor: (runId: string) => Promise<WorkspaceProcessContext>;
    operations: ActorOperationPort;
    directoryFor: (runId: string) => string;
    scriptSources: (entryId: string, name: string) => readonly ActorProgramSource[] | undefined;
    /** A shared actor package of the profile, by name. */
    sharedPackage: (name: string) => { pluginId: string; files: readonly ActorProgramSource[] } | undefined;
}
type Recognized = { start: JsonValue } | { result: JsonValue };
export class ActorProgramRuntime implements ActorProgramsService, ActorProgramExecutor {
    readonly #options: ActorProgramRuntimeOptions;
    readonly #queues = new Map<string, Promise<void>>();
    readonly #active = new Map<string, {
        runId: string;
        actorId: string;
        controller: AbortController;
        completed: Promise<unknown>;
    }>();
    readonly #installing = new Set<string>();
    readonly #creating = new Set<string>();
    readonly #staged = new Set<string>();
    readonly #removing = new Set<string>();
    readonly #knownRuns = new Set<string>();
    readonly #recovered = new Set<string>();
    readonly #packageLocks = new Map<string, Promise<void>>();
    readonly #identities = new Map<string, string>();
    readonly #epochs = new Map<string, number>();
    readonly #stopping = new Set<string>();
    #shuttingDown = false;
    constructor(options: ActorProgramRuntimeOptions) { this.#options = options; }
    runtime(): Orchestration { return this.#options.runtime(); }
    view(runId: string): RunView { return this.runtime().view(runId); }
    ownerId(runId: string): string { return this.runtime().state(runId).ownerId; }
    operatorContext(runId: string, label = "operation"): CommandContext { return { actorId: this.ownerId(runId), commandId: `actor-program:${label}:${randomUUID()}` }; }
    programsOf(view: RunView): ActorProgramDefinition[] {
        return view.pluginStates.flatMap((entry) => {
            if (entry.pluginId !== ACTOR_PROGRAMS_STATE_ID || entry.scope.kind !== "actor")
                return [];
            const state = entry.state as unknown as ActorProgramState;
            const actorId = entry.scope.actorId;
            const actor = view.actors.find((candidate) => candidate.id === actorId);
            return state.program && actor && actor.kind !== "human" && actor.lifecycle.kind !== "stopped" ? [state.program] : [];
        });
    }
    programs(runId: string): ActorProgramDefinition[] { return this.runtime().listRuns().some(run => run.id === runId) ? this.programsOf(this.view(runId)) : []; }
    actor(runId: string, actorId: string): ExecutableActor {
        const actor = this.view(runId).actors.find((candidate) => candidate.id === actorId);
        if (!actor || actor.kind === "human" || actor.lifecycle.kind === "stopped")
            throw new Error("The actor is not active.");
        if (this.#removing.has(`${runId}\0${actorId}`))
            throw new Error("The actor package is being removed.");
        return actor;
    }
    resolveActor(runId: string, callerId: string, reference: string): ExecutableActor {
        const actors = this.view(runId).actors;
        const found = reference === "self" ? actors.find((candidate) => candidate.id === callerId) : actorByHandle(actors, reference);
        if (!found)
            throw new Error(`Actor ${reference} is unknown.`);
        return this.actor(runId, found.id);
    }
    data(runId: string, actorId: string): ActorDataState {
        const view = this.view(runId);
        const entry = view.pluginStates.find((item) => item.pluginId === ACTOR_STATE_ID && item.scope.kind === "actor" && item.scope.actorId === actorId);
        const revision = this.runtime().events(runId).filter((event) => (event.type === "plugin.state-replaced" || event.type === "plugin.state-patched") && event.payload.pluginId === ACTOR_STATE_ID && event.payload.scope.kind === "actor" && event.payload.scope.actorId === actorId).at(-1)?.sequence ?? 0;
        return { version: 1, revision, values: (entry?.state ?? {}) as Record<string, unknown> };
    }
    #writeProgram(context: CommandContext, runId: string, actorId: string, program: ActorProgramDefinition | null): void {
        this.runtime().replacePluginState(this.operatorContext(runId), runId, { pluginId: ACTOR_PROGRAMS_STATE_ID, scope: { kind: "actor", actorId }, state: jsonValue({ version: 1, program }, "Actor program") });
    }
    /** Which run script installed which package, and the inputs the host queued for programs to recognize. */
    #script(runId: string): ActorScriptState {
        return scriptStateOf(this.view(runId).pluginStates.find((entry) => entry.pluginId === ACTOR_SCRIPT_STATE_ID && entry.scope.kind === "run")?.state);
    }
    /** Keeps only deliveries whose input is still queued or being processed, and `keep`, whose input follows right after this write. */
    #writeScript(runId: string, state: ActorScriptState, keep?: string): void {
        const live = this.#liveCommands(runId, new Set(state.deliveries.map((delivery) => delivery.actorId)));
        const deliveries = state.deliveries.filter((delivery) => delivery.commandId === keep || live.has(delivery.commandId));
        this.runtime().replacePluginState(this.operatorContext(runId, "script"), runId, { pluginId: ACTOR_SCRIPT_STATE_ID, scope: { kind: "run" }, state: jsonValue({ ...state, deliveries }, "Run script state") });
    }
    /** The commands that queued inputs of these actors which are pending or belong to a running turn. */
    #liveCommands(runId: string, actorIds: ReadonlySet<string>): Set<string> {
        const view = this.view(runId);
        const running = new Set(view.turns.filter((turn) => turn.status === "running").map((turn) => turn.id));
        const sequences = new Set(view.inputs.filter((input) => actorIds.has(input.actorId)
            && (input.lifecycle.kind === "pending" || input.lifecycle.kind === "claimed" && running.has(input.lifecycle.turnId))).map((input) => input.sequence));
        const commands = new Set<string>();
        if (sequences.size === 0)
            return commands;
        const oldest = Math.min(...sequences);
        for (const event of this.runtime().recentEvents(runId)) {
            if (event.sequence < oldest)
                break;
            if (sequences.has(event.sequence))
                commands.add(event.commandId);
        }
        return commands;
    }
    #commandOf(runId: string, sequence: number): string | undefined {
        for (const event of this.runtime().recentEvents(runId)) {
            if (event.sequence === sequence)
                return event.commandId;
            if (event.sequence < sequence)
                return undefined;
        }
        return undefined;
    }
    async #writeSources(directory: string, files: readonly ActorProgramSource[]): Promise<void> {
        for (const source of files) {
            const file = path.join(directory, safePath(source.path));
            if (source.path.split("/").includes("node_modules"))
                throw new Error("Package sources must not overwrite dependencies.");
            await mkdir(path.dirname(file), { recursive: true });
            await writeFile(file, source.content, { flag: "wx" });
        }
    }
    #originSources(name: string, origin: ActorPackageOrigin): readonly ActorProgramSource[] | undefined {
        if (origin.kind === "script")
            return this.#options.scriptSources(origin.entryId, name);
        const shared = this.#options.sharedPackage(name);
        return shared?.pluginId === origin.pluginId ? shared.files : undefined;
    }
    /** The identity of the sources the program was built from; a build never changes, so it is read once. */
    #identityOf(program: ActorProgramDefinition): string {
        const known = this.#identities.get(program.directory);
        if (known !== undefined)
            return known;
        const identity = packageIdentity(JSON.parse(readFileSync(path.join(program.directory, "sources.json"), "utf8")) as ActorProgramSource[]);
        this.#identities.set(program.directory, identity);
        return identity;
    }
    /** A package still built from what its origin installed reloads from the origin's current sources; one changed in the run keeps its own. */
    #refresh(runId: string, program: ActorProgramDefinition, signal: AbortSignal): Promise<void> {
        return this.#withPackages(runId, [program.name], () => this.#reload(runId, program, signal));
    }
    async #reload(runId: string, program: ActorProgramDefinition, signal: AbortSignal): Promise<void> {
        const record = this.#script(runId).packages[program.name];
        const files = record && this.#identityOf(program) === record.identity ? this.#originSources(program.name, record.origin) : undefined;
        if (record && files) {
            const state = this.#script(runId);
            this.#writeScript(runId, { ...state, packages: { ...state.packages, [program.name]: { ...state.packages[program.name]!, identity: packageIdentity(files) } } });
            const directory = path.join(await this.workspaceDirectory(runId), program.name);
            for (const entry of await readdir(directory))
                if (entry !== "node_modules")
                    await rm(path.join(directory, entry), { recursive: true, force: true });
            await this.#writeSources(directory, files);
        }
        try {
            await this.#activate(this.operatorContext(runId, "refresh"), runId, program.name, false, signal);
        }
        catch (error) {
            throw new Error(`The capability contract of ${program.name} has changed and the reactivation failed: ${errorText(error)}`);
        }
    }
    async #bound<T extends CapabilityContract>(runId: string, actorId: string, revision: string | undefined, signal: AbortSignal, contractOf: (program: ActorProgramDefinition) => T, descriptorsFor: BackendBinding["descriptorsFor"]): Promise<{ program: ActorProgramDefinition; contract: T; descriptors: readonly RunCapabilityDescriptor[] }> {
        const current = () => {
            const program = this.programs(runId).find((entry) => entry.actorId === actorId);
            if (!program)
                throw new Error("The actor has no active program.");
            return program;
        };
        const bind = (program: ActorProgramDefinition) => {
            const contract = contractOf(program);
            const descriptors = descriptorsFor(contract.capabilityIds);
            return { program, contract, descriptors, drifted: runCapabilityContractHash(descriptors) !== contract.capabilityContractHash };
        };
        const program = current();
        if (revision !== undefined && program.revision !== revision)
            throw new Error("The actor package was replaced.");
        const bound = bind(program);
        if (!bound.drifted)
            return bound;
        await this.#refresh(runId, program, signal);
        const refreshed = bind(current());
        if (refreshed.drifted)
            throw new Error(`The capability contract of ${program.name} still differs after the reactivation.`);
        return refreshed;
    }
    async #acquire(key: string): Promise<() => void> {
        const previous = this.#packageLocks.get(key) ?? Promise.resolve();
        const released = Promise.withResolvers<void>();
        const held = previous.then(() => released.promise);
        this.#packageLocks.set(key, held);
        await previous;
        return () => {
            released.resolve();
            if (this.#packageLocks.get(key) === held)
                this.#packageLocks.delete(key);
        };
    }
    /** One exclusion per run and package name for creating, activating, installing and ensuring; callers wait instead of failing. */
    async #withPackages<T>(runId: string, names: readonly string[], work: () => Promise<T>): Promise<T> {
        const releases: (() => void)[] = [];
        try {
            for (const name of [...new Set(names)].sort())
                releases.push(await this.#acquire(`${runId}\0${name}`));
            return await work();
        }
        finally {
            for (const release of releases.reverse())
                release();
        }
    }
    async workspaceDirectory(runId: string): Promise<string> { this.#knownRuns.add(runId); return prepareAppWorkspace(path.join(this.#options.directoryFor(runId), "actor-workspace")); }
    templates() { return runModuleTemplates.map(({ id, title, description }) => ({ id, title, description })); }
    async #create<T>(runId: string, name: string, build: (directory: string) => Promise<T>): Promise<{ directory: string; built: T }> {
        this.#assertName(name);
        const actors = await this.workspaceDirectory(runId);
        const directory = path.join(actors, name);
        const key = `${runId}\0${name}`;
        if (this.#creating.has(key))
            throw new Error(`The package ${name} is being created.`);
        if (occupied(directory))
            throw packageExists(name);
        this.#creating.add(key);
        const staging = path.join(path.dirname(actors), ".staging");
        const staged = path.join(staging, `${name}-${randomUUID()}`);
        this.#staged.add(staged);
        try {
            await mkdir(staging, { recursive: true });
            for (const entry of await readdir(staging))
                if (!this.#staged.has(path.join(staging, entry)))
                    await rm(path.join(staging, entry), { recursive: true, force: true });
            await mkdir(staged);
            const built = await build(staged);
            commitPackage(staged, directory, name);
            return { directory, built };
        }
        finally {
            this.#creating.delete(key);
            this.#staged.delete(staged);
            await rm(staged, { recursive: true, force: true });
        }
    }
    scaffold(runId: string, name: string, templateId: string) {
        return this.#withPackages(runId, [name], () => this.#scaffold(runId, name, templateId));
    }
    async #scaffold(runId: string, name: string, templateId: string) {
        const sources = Object.entries(templateFiles(templateById(templateId), name)).map(([file, content]) => ({ path: file, content }));
        const { built: files } = await this.#create(runId, name, async (directory) => {
            await this.#writeSources(directory, sources);
            await prepareAppProject(directory);
            const pkg = await readAppPackage(directory);
            const backend = pkg.backend ? await compileAppBackend({ directory, backend: pkg.backend, runId, executor: this.runtime().nativeTypeScriptExecutor }) : undefined;
            await installClientSdk(directory, { stateSchema: backend?.contract.state ?? objectSchema, actions: Object.entries(backend?.contract.functions ?? {}).map(([id, fn]) => ({ id, inputSchema: fn.input, resultSchema: fn.output })) });
            return (await projectSourceFiles(directory)).map((file) => file.path);
        });
        return { name, directory: `@actors/${name}`, files };
    }
    importPackage(context: CommandContext, runId: string, name: string, files: readonly ActorProgramSource[], signal?: AbortSignal): Promise<ActivatedActorProgram> {
        return this.#withPackages(runId, [name], () => this.#import(context, runId, name, files, signal));
    }
    async #import(context: CommandContext, runId: string, name: string, files: readonly ActorProgramSource[], signal?: AbortSignal): Promise<ActivatedActorProgram> {
        const { directory } = await this.#create(runId, name, (staged) => this.#writeSources(staged, files));
        try {
            await this.#activate(context, runId, name, true, signal);
            return this.#activated(runId, name);
        }
        catch (error) {
            await rm(directory, { recursive: true, force: true });
            throw error;
        }
    }
    #activated(runId: string, name: string): ActivatedActorProgram {
        const program = this.#program(runId, name);
        return { name, actorId: program.actorId, actorHandle: program.actorHandle, views: program.views.length };
    }
    installScript(context: CommandContext, runId: string, script: RunScriptSources, signal?: AbortSignal): Promise<ActivatedActorProgram> {
        return this.#withPackages(runId, [script.handle, ...script.programs.map((program) => program.name), ...script.sharedPrograms], () => this.#install(context, runId, script, signal));
    }
    async #install(context: CommandContext, runId: string, script: RunScriptSources, signal?: AbortSignal): Promise<ActivatedActorProgram> {
        const root = await this.workspaceDirectory(runId);
        const before = this.#script(runId).packages;
        const own: ActorPackageOrigin = { kind: "script", entryId: script.entryId };
        const programs: OriginPackage[] = [
            ...script.programs.map((program) => ({ ...program, origin: own })),
            ...script.sharedPrograms.map((name) => {
                const shared = this.#options.sharedPackage(name);
                if (!shared)
                    throw new Error(`The run script ${script.entryId} needs the shared actor package ${name}, which no plugin of this profile provides.`);
                return { name, files: shared.files, origin: { kind: "shared", pluginId: shared.pluginId } as const };
            }),
        ];
        const present = await this.#presentPrograms(root, script.entryId, programs, before);
        const reuse = this.#reusesScript(runId, root, script, before);
        const missing = programs.filter((program) => !present.has(program.name));
        const claims = this.#claim(runId, [...missing, ...(reuse ? [] : [{ name: script.handle, files: script.files, origin: own }])]);
        const copied: string[] = [];
        try {
            for (const program of missing) {
                signal?.throwIfAborted();
                await this.#create(runId, program.name, (staged) => this.#writeSources(staged, program.files));
                copied.push(program.name);
            }
            return reuse ? await this.#restartScript(context, runId, script.handle, signal) : await this.#import(context, runId, script.handle, script.files, signal);
        }
        catch (error) {
            for (const name of copied)
                await rm(path.join(root, name), { recursive: true, force: true });
            try {
                this.#release(runId, claims);
            }
            catch (release) {
                throw new Error(`${errorText(error)} The ownership record could not be removed again (${errorText(release)}); it names no package and the next start replaces it.`);
            }
            throw error;
        }
    }
    /** Ownership is recorded before anything is created, so no package the host installs exists without its origin. */
    #claim(runId: string, packages: readonly OriginPackage[]): readonly Claim[] {
        const state = this.#script(runId);
        const claims = packages.map((entry): Claim => {
            const previous = state.packages[entry.name];
            return { name: entry.name, previous, claimed: { origin: entry.origin, identity: packageIdentity(entry.files), count: previous && sameOrigin(previous.origin, entry.origin) ? previous.count : 0, open: [] } };
        });
        if (claims.length > 0)
            this.#writeScript(runId, { ...state, packages: { ...state.packages, ...Object.fromEntries(claims.map((claim) => [claim.name, claim.claimed])) } });
        return claims;
    }
    /** Compare and swap: a record someone changed since the claim stays as it is. */
    #release(runId: string, claims: readonly Claim[]): void {
        const state = this.#script(runId);
        const released = claims.filter((claim) => isDeepStrictEqual(state.packages[claim.name], claim.claimed));
        if (released.length === 0)
            return;
        const names = new Set(released.map((claim) => claim.name));
        const kept = Object.entries(state.packages).filter(([name]) => !names.has(name));
        const restored = released.flatMap((claim) => claim.previous ? [[claim.name, claim.previous] as const] : []);
        this.#writeScript(runId, { ...state, packages: Object.fromEntries([...kept, ...restored]) });
    }
    /** Whether the host installed this shared package from this plugin and nobody changed it since. */
    #hostShared(record: ActorScriptPackage | undefined, pluginId: string, identity: string): boolean {
        return record !== undefined && sameOrigin(record.origin, { kind: "shared", pluginId }) && record.identity === identity;
    }
    /** The names already in the run that the start keeps; a different package, or one under a shared name the host did not install, is an error before anything is copied. */
    async #presentPrograms(root: string, entryId: string, programs: readonly OriginPackage[], packages: Readonly<Record<string, ActorScriptPackage>>): Promise<ReadonlySet<string>> {
        const present = await Promise.all(programs.map(async (program) => {
            const directory = path.join(root, program.name);
            if (!occupied(directory))
                return false;
            if (program.origin.kind === "shared") {
                if (this.#hostShared(packages[program.name], program.origin.pluginId, packageIdentity(await projectSourceFiles(directory))))
                    return true;
                throw foreignShared(program.name, program.origin.pluginId, packages[program.name]);
            }
            if (await sameSources(directory, program.files))
                return true;
            throw new Error(`The run script ${entryId} bundles the program ${program.name}, but this run already has a different package ${program.name} ${originText(packages[program.name]?.origin)}.`);
        }));
        return new Set(programs.filter((_, index) => present[index]).map((program) => program.name));
    }
    /** A recorded origin without actor and folder is left over from a failed start, whichever template it names, and counts as not installed. */
    #reusesScript(runId: string, root: string, script: RunScriptSources, packages: Readonly<Record<string, ActorScriptPackage>>): boolean {
        const holder = this.view(runId).actors.find((actor) => actor.handle === script.handle);
        const exists = occupied(path.join(root, script.handle));
        if (!holder && !exists)
            return false;
        const origin = packages[script.handle]?.origin;
        if (origin !== undefined && !sameOrigin(origin, { kind: "script", entryId: script.entryId }))
            throw new Error(`The package ${script.handle} in this run ${origin.kind === "script" ? `comes from the run script ${origin.entryId}` : `is the shared package of ${origin.pluginId}`}, not from the run script ${script.entryId}.`);
        if (origin !== undefined && exists && (!holder || holder.kind === "script"))
            return true;
        throw new Error(holder
            ? `Handle @${script.handle} already belongs to ${holder.displayName} in this run, not to the run script ${script.entryId}.`
            : `The package ${script.handle} already exists in this run and was not installed by the run script ${script.entryId}.`);
    }
    async #restartScript(context: CommandContext, runId: string, handle: string, signal?: AbortSignal): Promise<ActivatedActorProgram> {
        const view = this.view(runId);
        const holder = view.actors.find((actor) => actor.handle === handle);
        const state = holder && view.pluginStates.find((entry) => entry.pluginId === ACTOR_PROGRAMS_STATE_ID && entry.scope.kind === "actor" && entry.scope.actorId === holder.id)?.state as unknown as ActorProgramState | undefined;
        if (!holder || !state?.program)
            await this.#activate(context, runId, handle, true, signal);
        else if (holder.kind !== "human" && holder.lifecycle.kind === "stopped")
            this.runtime().restartActor(context, runId, holder.id, "Run script started again");
        return this.#activated(runId, handle);
    }
    enqueueStart(context: CommandContext, runId: string, handle: string, start: RunScriptStartInput): { count: number } {
        const program = this.#program(runId, handle);
        const recorded = this.#script(runId).packages[handle];
        if (!recorded)
            throw new Error(`The package ${handle} was not installed by a run script.`);
        const state = this.#script(runId);
        const record = state.packages[handle]!;
        const count = record.count + 1;
        const delivery: ActorScriptDelivery = { commandId: context.commandId, actorId: program.actorId, kind: "start", name: handle, count, embedded: start.embedded, startedBy: start.startedBy };
        this.#writeScript(runId, { ...state, packages: { ...state.packages, [handle]: { ...record, count } }, deliveries: [...state.deliveries, delivery] }, context.commandId);
        try {
            this.runtime().enqueueInput(context, runId, { actorId: program.actorId, content: start.content });
        }
        catch (error) {
            const current = this.#script(runId);
            this.#writeScript(runId, { ...current, packages: { ...current.packages, [handle]: { ...current.packages[handle]!, count: record.count } },
                deliveries: current.deliveries.filter((entry) => entry.commandId !== context.commandId) });
            throw error;
        }
        return { count };
    }
    /** A start or result the host queued for this actor, recognized by the command that queued the input; it is consumed here. */
    #recognize(runId: string, actorId: string, input: { sequence: number; content: string }): Recognized | undefined {
        const state = this.#script(runId);
        if (!state.deliveries.some((delivery) => delivery.actorId === actorId))
            return undefined;
        const commandId = this.#commandOf(runId, input.sequence);
        const delivery = state.deliveries.find((entry) => entry.commandId === commandId && entry.actorId === actorId);
        if (!delivery)
            return undefined;
        const deliveries = state.deliveries.filter((entry) => entry !== delivery);
        if (delivery.kind === "result") {
            this.#writeScript(runId, { ...state, deliveries });
            return { result: JSON.parse(input.content) as JsonValue };
        }
        const record = state.packages[delivery.name];
        const packages = record ? { ...state.packages, [delivery.name]: { ...record, open: [...record.open, { count: delivery.count, startedBy: delivery.startedBy }].slice(-MAX_OPEN_STARTS) } } : state.packages;
        this.#writeScript(runId, { ...state, packages, deliveries });
        const { input: value, options } = JSON.parse(input.content) as { input: JsonValue; options: Record<string, JsonValue> };
        return { start: { input: value, options, embedded: delivery.embedded, startedBy: delivery.startedBy, count: delivery.count } };
    }
    /** Checked before the state commits: every finish ends a different open start of this package. */
    #finishesOf(runId: string, program: ActorProgramDefinition, value: unknown): readonly ScriptFinish[] {
        const finishes = finishesOf(value);
        const open = new Set(this.#script(runId).packages[program.name]?.open.map((entry) => entry.count) ?? []);
        for (const [index, finish] of finishes.entries()) {
            if (!open.has(finish.start) || finishes.findIndex((other) => other.start === finish.start) !== index)
                throw new Error(`finish: start ${finish.start} of @${program.actorHandle} is not open; it was finished already, never reached the program, or is older than the last ${MAX_OPEN_STARTS} open starts.`);
        }
        return finishes;
    }
    #deliverResults(request: TurnRequest<"script">, program: ActorProgramDefinition, finishes: readonly ScriptFinish[]): void {
        if (finishes.length === 0)
            return;
        const state = this.#script(request.runId);
        const record = state.packages[program.name]!;
        const finished = new Set(finishes.map((finish) => finish.start));
        const starters = new Map(record.open.map((entry) => [entry.count, entry.startedBy]));
        this.#writeScript(request.runId, { ...state, packages: { ...state.packages, [program.name]: { ...record, open: record.open.filter((entry) => !finished.has(entry.count)) } } });
        for (const finish of finishes)
            this.#deliverResult(request, program, finish, starters.get(finish.start)!);
    }
    /** The owner reads the summary in the chat, an LLM gets a short message, a TypeScript actor a result it recognizes. */
    #deliverResult(request: TurnRequest<"script">, program: ActorProgramDefinition, finish: ScriptFinish, startedBy: string): void {
        const starter = this.view(request.runId).actors.find((actor) => actor.id === startedBy);
        if (!starter || starter.kind === "human") {
            request.emit({ kind: "runtime", text: finish.summary ?? `Start ${finish.start} finished.` });
            return;
        }
        const commandId = `run-script-result:${request.turnId}:${program.name}:${finish.start}`;
        try {
            if (starter.kind === "script") {
                const state = this.#script(request.runId);
                this.#writeScript(request.runId, { ...state, deliveries: [...state.deliveries, { commandId, actorId: starter.id, kind: "result" }] }, commandId);
            }
            this.runtime().enqueueInput({ actorId: this.ownerId(request.runId), commandId }, request.runId, {
                actorId: starter.id, presentation: "background",
                content: starter.kind === "agent" ? agentResultText(program.actorHandle, finish) : scriptResultContent(program.actorHandle, finish),
            });
        }
        catch (error) {
            request.emit({ kind: "runtime", text: `The result of start ${finish.start} did not reach @${starter.handle}: ${errorText(error)}` });
        }
    }
    isScriptActor(runId: string, actorId: string): boolean {
        return this.runtime().select(runId, (state) => {
            const actor = state.actors.get(actorId);
            if (!actor || actor.kind !== "script")
                return false;
            const script = [...state.pluginStates.values()].find((entry) => entry.pluginId === ACTOR_SCRIPT_STATE_ID && entry.scope.kind === "run");
            return Object.hasOwn(scriptStateOf(script?.state).packages, actor.handle);
        });
    }
    programOf(runId: string, actorId: string): ActorProgramIdentity | undefined {
        const program = this.programs(runId).find((entry) => entry.actorId === actorId);
        if (!program)
            return undefined;
        const record = this.#script(runId).packages[program.name];
        const origin = record && this.#identityOf(program) === record.identity ? record.origin : { kind: "run" as const, installedBy: program.installedBy };
        return { name: program.name, actorId, revision: program.revision, origin };
    }
    /** Makes a package active once, whatever state it is in; under a shared name only the package the host installed from that plugin, unchanged. */
    ensure(context: CommandContext, runId: string, name: string, signal?: AbortSignal): Promise<{ actorId: string; handle: string; status: "active" | "restarted" | "activated" | "installed" }> {
        this.#assertName(name);
        return this.#withPackages(runId, [name], () => this.#ensure(context, runId, name, signal));
    }
    async #ensure(context: CommandContext, runId: string, name: string, signal?: AbortSignal) {
        const outcome = (status: "active" | "restarted" | "activated" | "installed") => {
            const program = this.#program(runId, name);
            return { actorId: program.actorId, handle: program.actorHandle, status };
        };
        const shared = this.#options.sharedPackage(name);
        const record = this.#script(runId).packages[name];
        const assertShared = (identity: () => string): void => {
            if (shared && !this.#hostShared(record, shared.pluginId, identity()))
                throw foreignShared(name, shared.pluginId, record);
        };
        const active = this.programs(runId).find((program) => program.name === name);
        if (active) {
            assertShared(() => this.#identityOf(active));
            return outcome("active");
        }
        const view = this.view(runId);
        const stopped = view.pluginStates.flatMap((entry) => {
            const program = entry.pluginId === ACTOR_PROGRAMS_STATE_ID && entry.scope.kind === "actor" ? (entry.state as unknown as ActorProgramState).program : null;
            const actor = program?.name === name ? view.actors.find((candidate) => candidate.id === program.actorId) : undefined;
            return program && actor && actor.kind !== "human" && actor.lifecycle.kind === "stopped" ? [{ program, actor }] : [];
        })[0];
        if (stopped) {
            assertShared(() => this.#identityOf(stopped.program));
            this.runtime().restartActor(context, runId, stopped.actor.id, "Actor program ensured");
            return outcome("restarted");
        }
        const root = await this.workspaceDirectory(runId);
        if (occupied(path.join(root, name))) {
            const identity = packageIdentity(await projectSourceFiles(path.join(root, name)));
            assertShared(() => identity);
            await this.#activate(context, runId, name, true, signal);
            return outcome("activated");
        }
        if (!shared)
            throw new Error(`The package ${name} is neither in this run nor a shared actor package of this profile.`);
        const claims = this.#claim(runId, [{ name, files: shared.files, origin: { kind: "shared", pluginId: shared.pluginId } }]);
        try {
            await this.#import(context, runId, name, shared.files, signal);
        }
        catch (error) {
            this.#release(runId, claims);
            throw error;
        }
        return outcome("installed");
    }
    async check(runId: string, name: string, callerId: string, signal?: AbortSignal, reference?: string): Promise<CompiledProgram> {
        this.#assertName(name);
        const directory = path.join(await this.workspaceDirectory(runId), name);
        if ((await lstat(directory)).isSymbolicLink())
            throw new Error("Actor packages must not be symlinks.");
        await prepareAppProject(directory);
        const pkg = await readAppPackage(directory);
        const previous = this.programs(runId).find((program) => program.name === name);
        const owner = reference ? this.resolveActor(runId, callerId, reference) : previous ? this.actor(runId, previous.actorId) : !pkg.backend ? this.actor(runId, callerId) : undefined;
        if (previous && owner?.id !== previous.actorId)
            throw new Error("An activated package cannot move to another actor.");
        const caller = this.view(runId).actors.find((candidate) => candidate.id === callerId);
        if (!caller)
            throw new Error("Calling actor is missing.");
        const provisional: ExecutableActor = owner ?? {
            id: "pending", handle: name, displayName: pkg.title, kind: "script", grants: inheritedGrants(caller),
            createdAt: new Date().toISOString(), createdBy: callerId, description: actorDescriptionOf(pkg.description) ?? null, execution: { driver: { kind: "script", config: {} }, workspacePath: null, turnTimeoutMs: null }, lifecycle: { kind: "idle", since: new Date().toISOString() }, usage: emptyUsage(), toolNames: null, openedToolNames: [],
        };
        const available = (await this.#options.agentToolsFor(runId, provisional.id, owner ? undefined : provisional)).map(descriptor);
        for (const operation of this.#options.operations.list())
            if (operation.operator !== "unavailable" && !available.some((entry) => entry.id === operation.id))
                available.push(operation);
        await installServerSdk(directory, available);
        const backend = pkg.backend ? await compileAppBackend({ directory, backend: pkg.backend, runId, executor: this.runtime().nativeTypeScriptExecutor, signal }) : undefined;
        const contract: AppContract = backend?.contract ?? { state: objectSchema, functions: {} };
        if (contract.input && owner?.kind === "agent")
            throw new Error("An LLM actor processes inputs with its agent driver; onInput is only allowed for TypeScript actors.");
        if (contract.state.type !== "object")
            throw new Error("Actor state must be an object schema.");
        const state = owner ? this.data(runId, owner.id).values : {};
        checked(contract.state, state, "Actor state");
        const actorId = owner?.id ?? "pending";
        const actorHandle = owner?.handle ?? name;
        const functions: ActorFunctionDefinition[] = Object.entries(contract.functions).map(([id, fn]) => {
            if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(id))
                throw new Error(`Invalid function name ${id}.`);
            if (fn.tool && !/^[a-z][a-z0-9_]{0,63}$/.test(fn.tool.name))
                throw new Error(`Invalid tool name ${fn.tool.name}.`);
            const capabilities = fn.capabilities ?? [];
            const selected = capabilities.map((name) => {
                const entry = available.find((item) => item.id === name);
                if (!entry)
                    throw new Error(`Capability ${name} is not available.`);
                return entry;
            });
            return { id, label: fn.label, description: fn.description ?? fn.label, inputSchema: fn.input, resultSchema: fn.output, capabilityIds: capabilities, capabilityContractHash: runCapabilityContractHash(selected), confirmation: fn.confirmation ?? null,
                ...(fn.tool ? { tool: { name: fn.tool.name, targets: fn.tool.targets ? fn.tool.targets.map((target) => target === "self" ? actorId : this.resolveActor(runId, callerId, target).id) : null, card: fn.tool.card ?? true } } : {}) };
        });
        const inputCapabilities = contract.input?.capabilities ?? [];
        const inputDescriptors = inputCapabilities.map((id) => {
            const found = available.find((entry) => entry.id === id);
            if (!found)
                throw new Error(`Input capability ${id} is not available.`);
            return found;
        });
        await installClientSdk(directory, { stateSchema: contract.state, actions: functions.map((fn) => ({ id: fn.id, inputSchema: fn.inputSchema, resultSchema: fn.resultSchema })) });
        const hasServerFiles = pkg.backend || (await projectSourceFiles(directory)).some((file) => /^tests\/.*\.tsx?$/.test(file.path));
        const serverErrors = hasServerFiles ? typecheckServerProject(directory, pkg.backend) : [];
        if (serverErrors.length)
            throw checkFailure(`Typecheck of ${name}`, serverErrors, `The typecheck of ${name} failed without a message.`);
        const clients: CompiledProgram["clients"] = [];
        const views: ActorProgramDefinition["views"] = [];
        for (const view of pkg.views ?? []) {
            const client = await compileClientProject({ directory, entryPoint: view.client, stateSchema: contract.state, actions: functions.map((fn) => ({ id: fn.id, inputSchema: fn.inputSchema, resultSchema: fn.resultSchema })) });
            if (!client.valid)
                throw checkFailure(`Client build of ${view.client}`,
                    client.diagnostics.filter((item) => item.category === "error").map((item) =>
                        `${item.fileName ?? view.client}${item.start ? `:${item.start.line}:${item.start.column}` : ""} ${item.message.replace(/\s*\n\s*/g, " ")}`),
                    `The client build of ${view.client} failed without a message.`);
            const styles = view.styles ? await inside(directory, view.styles) : "";
            if (/@import\b|url\s*\(\s*["']?\s*(?:https?:|\/\/)/i.test(styles))
                throw new Error("View CSS must not load external resources.");
            const clientFile = `view-${view.id}.mjs`;
            clients.push({ file: clientFile, javaScript: client.javaScript });
            views.push({ id: `${name}--${view.id}`, key: view.id, title: view.title ?? pkg.title, visible: previous?.views.find((item) => item.key === view.id)?.visible ?? true,
                html: `<!doctype html><html class="${FRAME_DOCUMENT_CLASS}"><head><meta charset="utf-8"></head><body class="${FRAME_BODY_CLASS}"><div id="root" class="${FRAME_ROOT_CLASS}"></div></body></html>`, styles, clientFile });
        }
        const viewSources = [...new Set((pkg.views ?? []).map((view) => path.dirname(path.resolve(directory, view.client))))];
        const frameStyles = viewSources.length > 0 ? await buildTailwind(viewSources) : "";
        const files = await projectSourceFiles(directory);
        const revision = canonicalHash({ files, backend: backend?.javaScript ?? null, clients });
        const definition: ActorProgramDefinition = { name, title: pkg.title, description: pkg.description ?? "", actorId, actorHandle, revision, installedBy: previous?.installedBy ?? callerId,
            directory: path.join(this.#options.directoryFor(runId), "actor-builds", name, revision), sourceDirectory: directory,
            ...(backend ? { backendFile: "server.mjs" } : {}), stateSchema: contract.state, stylesFile: "frame.css", functions, views,
            ...(contract.input ? { input: { capabilityIds: inputCapabilities, capabilityContractHash: runCapabilityContractHash(inputDescriptors) } } : {}) };
        return { directory, files, definition, clients, frameStyles, createActor: !owner, ...(backend ? { backendJavaScript: backend.javaScript } : {}) };
    }
    activate(context: CommandContext, runId: string, name: string, signal?: AbortSignal, reference?: string) {
        return this.#withPackages(runId, [name], () => this.#activate(context, runId, name, true, signal, reference));
    }
    async #activate(context: CommandContext, runId: string, name: string, idle: boolean, signal?: AbortSignal, reference?: string) {
        const key = `${runId}\0${name}`;
        if (this.#installing.has(key))
            throw new Error(`Package ${name} is already being activated.`);
        const epoch = this.invocationPermit(runId);
        this.#installing.add(key);
        const original = this.programs(runId).find((item) => item.name === name);
        let compiled: CompiledProgram | undefined;
        let published = false;
        try {
            compiled = await this.check(runId, name, context.actorId, signal, reference);
            const definition = compiled.definition;
            const tests = compiled.files.filter((file) => /^tests\/.*\.test\.tsx?$/.test(file.path));
            if (tests.length) {
                const processContext = await this.#options.serverProcessContextFor(runId);
                const report = await createTestReport(compiled.directory);
                let stderr = "";
                const launch = await sandboxedLaunch(processContext, { command: process.execPath, args: ["--import", "tsx", "--test", testReporterArgument, ...tests.map((file) => file.path)] });
                const result = await runManagedProcess({ command: launch.command, args: [...launch.args], cwd: compiled.directory,
                    env: processContext.env, uid: processContext.uid, gid: processContext.gid, label: `Tests ${name}`, signal, timeoutMs: 60000,
                    onStdout: (chunk) => report.stdout(chunk.toString()), onStderr: (chunk) => { stderr = (stderr + chunk.toString()).slice(-12000); } });
                if (result.code !== 0 || result.timedOut)
                    throw new Error(report.report(name, { code: result.code, timedOut: result.timedOut, stderr }));
            }
            if (canonicalHash(compiled.files) !== canonicalHash(await projectSourceFiles(compiled.directory)))
                throw new Error("Package files were changed during the check; activate again.");
            if (epoch !== this.invocationPermit(runId))
                throw new Error("The run was stopped during the activation.");
            if (this.programs(runId).find((item) => item.name === name)?.revision !== original?.revision)
                throw new Error("The package was changed in the meantime.");
            if (idle)
                this.#assertIdle(runId, definition.actorId);
            const names = new Set([...agentTools.map((tool) => tool.name), ...this.#options.reservedToolNames(), ...this.programs(runId).filter((program) => program.name !== name).flatMap((program) => program.functions.flatMap((fn) => fn.tool ? [fn.tool.name] : []))]);
            for (const fn of definition.functions)
                if (fn.tool) {
                    if (names.has(fn.tool.name))
                        throw new Error(`Tool name ${fn.tool.name} is already taken.`);
                    names.add(fn.tool.name);
                }
            const occupied = this.programs(runId).find((program) => program.actorId === definition.actorId && program.name !== name);
            if (occupied)
                throw new Error(`Actor @${definition.actorHandle} already owns the package ${occupied.name}. Add functions or views there.`);
            await mkdir(definition.directory, { recursive: true });
            for (const source of compiled.files) {
                const file = path.join(definition.directory, safePath(source.path));
                await mkdir(path.dirname(file), { recursive: true });
                await writeFile(file, source.content);
            }
            await prepareAppProject(definition.directory);
            if (compiled.backendJavaScript !== undefined)
                await writeFile(path.join(definition.directory, "server.mjs"), compiled.backendJavaScript);
            for (const client of compiled.clients)
                await writeFile(path.join(definition.directory, client.file), client.javaScript);
            await writeFile(path.join(definition.directory, definition.stylesFile), compiled.frameStyles);
            await writeFile(path.join(definition.directory, "sources.json"), JSON.stringify(compiled.files));
            await syncWorkspaceOwnership(definition.directory, await this.#options.serverProcessContextFor(runId));
            signal?.throwIfAborted();
            if (epoch !== this.invocationPermit(runId))
                throw new Error("The run was stopped during the activation.");
            if (this.programs(runId).find((item) => item.name === name)?.revision !== original?.revision)
                throw new Error("The package was changed in the meantime.");
            if (!compiled.createActor) {
                this.actor(runId, definition.actorId);
                if (idle)
                    this.#assertIdle(runId, definition.actorId);
                checked(definition.stateSchema, this.data(runId, definition.actorId).values, "Actor state");
                if (this.programs(runId).some((item) => item.actorId === definition.actorId && item.name !== name))
                    throw new Error("The actor now owns another package.");
            }
            const currentNames = new Set([...agentTools.map((tool) => tool.name), ...this.#options.reservedToolNames(), ...this.programs(runId).filter((program) => program.name !== name).flatMap((program) => program.functions.flatMap((fn) => fn.tool ? [fn.tool.name] : []))]);
            for (const fn of definition.functions)
                if (fn.tool) {
                    if (currentNames.has(fn.tool.name))
                        throw new Error(`Tool name ${fn.tool.name} has been taken in the meantime.`);
                    currentNames.add(fn.tool.name);
                }
            jsonValue({ version: 1, program: definition }, "Actor program");
            if (compiled.createActor) {
                const actors = this.view(runId).actors;
                const caller = actors.find((actor) => actor.id === context.actorId)!;
                const holder = actors.find((actor) => actor.handle === name);
                if (holder?.kind === "script" && holder.lifecycle.kind === "stopped") {
                    checked(definition.stateSchema, this.data(runId, holder.id).values, "Actor state");
                    this.runtime().restartActor(context, runId, holder.id, "Actor package activated again");
                }
                else if (holder)
                    throw new Error(`Handle @${name} already belongs to the ${holder.kind !== "human" && holder.lifecycle.kind === "stopped" ? "stopped" : "active"} actor ${holder.displayName}; only a stopped TypeScript actor is restarted on activation. Choose another package name.`);
                else
                    this.runtime().createScriptActor(context, runId, { handle: name, displayName: definition.title, description: actorDescriptionOf(definition.description), grants: inheritedGrants(caller), toolNames: null });
                const actor = this.resolveActor(runId, context.actorId, `@${name}`);
                definition.actorId = actor.id;
                definition.actorHandle = actor.handle;
                for (const fn of definition.functions)
                    if (fn.tool?.targets)
                        fn.tool.targets = fn.tool.targets.map((target) => target === "pending" ? actor.id : target);
            }
            signal?.throwIfAborted();
            this.#writeProgram(context, runId, definition.actorId, definition);
            published = true;
            if (original && original.revision !== definition.revision)
                await this.runtime().nativeTypeScriptExecutor.stopInstance(runId, this.#instance(original));
            return { name, actor: `@${definition.actorHandle}`, views: definition.views.length, active: true as const };
        }
        finally {
            this.#installing.delete(key);
            if (!published && compiled && compiled.definition.revision !== original?.revision)
                await rm(compiled.definition.directory, { recursive: true, force: true });
        }
    }
    list(runId: string) { return this.programs(runId).map((program) => ({ name: program.name, actor: `@${program.actorHandle}`, functions: program.functions.map((fn) => fn.id), views: program.views.map((view) => ({ name: view.key, title: view.title, visible: view.visible })) })); }
    async remove(context: CommandContext, runId: string, name: string) {
        const packageName = this.#program(runId, name).name;
        return this.#withPackages(runId, [packageName], () => this.#remove(context, runId, packageName, name));
    }
    async #remove(context: CommandContext, runId: string, packageName: string, name: string) {
        const program = this.#program(runId, packageName);
        this.#assertIdle(runId, program.actorId);
        if (this.#installing.has(`${runId}\0${packageName}`))
            throw new Error("The package is being activated.");
        const actor = this.actor(runId, program.actorId);
        const key = `${runId}\0${program.actorId}`;
        this.#removing.add(key);
        try {
            await this.stopActor(runId, program.actorId);
            this.#writeProgram(context, runId, program.actorId, null);
            if (actor.kind === "script")
                this.runtime().stopActor(context, runId, program.actorId, "Actor package removed");
            await rm(program.directory, { recursive: true, force: true });
        }
        finally {
            this.#removing.delete(key);
        }
        return { removed: name };
    }
    setVisibility(context: CommandContext, runId: string, reference: string, visible: boolean) {
        const { program, view } = resolveActorView(this.programs(runId), reference);
        this.#writeProgram(context, runId, program.actorId, { ...program, views: program.views.map((item) => item.id === view.id ? { ...item, visible } : item) });
        return { view: `${program.name}/${view.key}`, visible };
    }
    apps(runId: string): ActorViewListing[] {
        return this.programs(runId).flatMap((program) => program.views.map((view) => ({ id: view.id, actorId: program.actorId, actorHandle: program.actorHandle, title: view.title, description: program.description, revision: program.revision,
            actions: program.functions.map(({ id, label, description, confirmation }) => ({ id, label, description, confirmation })), visible: view.visible, state: this.data(runId, program.actorId), invocations: this.#invocations(runId).invocations.filter((invocation) => invocation.actorId === program.actorId && invocation.revision === program.revision) })));
    }
    runLocalTools(runId: string) {
        if (!this.runtime().listRuns().some(run => run.id === runId))
            return [];
        const view = this.view(runId);
        return this.programs(runId).flatMap((program) => program.functions.flatMap((fn) => fn.tool ? [{ moduleId: program.name, name: fn.tool.name, description: fn.description, card: fn.tool.card, actorId: program.actorId, actorHandle: program.actorHandle, functionId: fn.id, revision: program.revision, sourceHash: program.revision, installedBy: program.installedBy,
                parameters: Object.entries((fn.inputSchema as {
                    properties?: Record<string, {
                        type?: string;
                        description?: string;
                    }>;
                }).properties ?? {}).map(([name, schema]) => ({ name, type: ["string", "number", "integer", "boolean"].includes(schema.type ?? "") ? schema.type ?? "json" : "json", description: schema.description ?? name, required: ((fn.inputSchema as {
                        required?: string[];
                    }).required ?? []).includes(name) })),
                targets: (fn.tool.targets ?? view.actors.filter((actor) => actor.kind !== "human" && actor.lifecycle.kind !== "stopped").map((actor) => actor.id)).map((actorId) => ({ actorId, handle: view.actors.find((actor) => actor.id === actorId)?.handle ?? null })) }] : []));
    }
    async moduleSource(runId: string, reference: string) { const program = this.#program(runId, reference); return { files: JSON.parse(await readFile(path.join(program.directory, "sources.json"), "utf8")) as ActorProgramSource[] }; }
    frame(runId: string, viewId: string, revision: string) {
        const program = this.#program(runId, viewId);
        const view = program.views.find((item) => item.id === viewId);
        if (!view || program.revision !== revision)
            throw new Error("The view was replaced or removed.");
        if (!program.stylesFile)
            throw new Error("The program comes from an older activation without a stylesheet file. Please activate again.");
        const frameStyles = readFileSync(path.join(program.directory, program.stylesFile), "utf8");
        return { ...view, styles: `${frameStyles}\n${view.styles}`, platformVersion: 2 as const, clientJavaScript: readFileSync(path.join(program.directory, view.clientFile), "utf8") };
    }
    installedTools(context: PluginContext): RunFunction[] {
        return this.programsOf(context.view).flatMap((program) => program.functions.flatMap((fn) => !fn.tool || (fn.tool.targets && !fn.tool.targets.includes(context.actorId)) ? [] : [defineRunFunction({
                name: fn.tool.name, label: fn.label, description: fn.description, schema: fn.inputSchema as TSchema, resultSchema: fn.resultSchema as TSchema, available: exposed, executionMode: "sequential",
                run: async (scope, id, input) => {
                    const descriptorsFor = (capabilityIds: readonly string[]) => agentCapabilityBinding(context.actor, scope.availableFunctions(), capabilityIds, new Set()).descriptors;
                    return this.#executeFunction(context.runId, program, fn, input, { id, kind: "tool", principal: { id: context.actorId, kind: context.actor.kind === "script" ? "script" : "agent" }, descriptorsFor, call: (name, value, index) => scope.invokeFunction(`${id}:capability:${index}`, name, value) }, scope.signal ?? new AbortController().signal);
                },
            })]));
    }
    async #serial<T>(runId: string, actorId: string, signal: AbortSignal, execute: () => Promise<T>): Promise<T> {
        const permit = this.invocationPermit(runId);
        const key = `${runId}\0${actorId}`;
        const previous = this.#queues.get(key) ?? Promise.resolve();
        const operation = previous.then(() => { signal.throwIfAborted(); if (permit !== this.invocationPermit(runId))
            throw new Error("The run was stopped before the function started."); this.actor(runId, actorId); return execute(); });
        const queued = operation.then(() => undefined, () => undefined);
        this.#queues.set(key, queued);
        try {
            return await operation;
        }
        finally {
            if (this.#queues.get(key) === queued)
                this.#queues.delete(key);
        }
    }
    async #backend(runId: string, program: ActorProgramDefinition, input: unknown, binding: BackendBinding, descriptors: readonly RunCapabilityDescriptor[], signal: AbortSignal): Promise<{
        result: unknown;
        logs: string[];
        state: JsonValue;
        initial: ActorDataState;
    }> {
        if (!program.backendFile)
            throw new Error("The actor has no TypeScript backend.");
        const current = this.#program(runId, program.name);
        if (current.revision !== program.revision)
            throw new Error("The actor package was replaced.");
        const logs: string[] = [];
        let calls = 0;
        const initial = this.data(runId, program.actorId);
        const result = await this.runtime().nativeTypeScriptExecutor.execute({
            program: { entry: program.backendFile, files: [{ fileName: program.backendFile, text: await readFile(path.join(program.directory, program.backendFile), "utf8") }], exportName: "handle" },
            instanceId: this.#instance(program), cwd: program.directory, input, state: initial.values,
            std: { now: new Date().toISOString(), idPrefix: binding.id }, context: { runId, actor: { id: program.actorId, handle: program.actorHandle }, invocationId: binding.id, invocationKind: binding.kind, principal: binding.principal, capabilities: descriptors },
        }, { signal, log: (value) => { if (logs.length < 100)
                logs.push((typeof value === "string" ? value : JSON.stringify(value)).slice(0, 2000)); }, call: async (name, value) => {
                const capability = descriptors.find((entry) => entry.id === name);
                if (!capability)
                    throw new Error(`Capability ${name} is not declared.`);
                if (++calls > 64)
                    throw new Error("A call may run at most 64 capabilities.");
                if (program.functions.some((fn) => fn.tool?.name === name))
                    throw new Error("An actor function must not call itself through a tool; use a shared TypeScript function.");
                checked(capability.schema, value, `Input ${name}`);
                const output = await binding.call(name, value, calls);
                return checked(capability.resultSchema, output, `Result ${name}`);
            } });
        signal.throwIfAborted();
        this.actor(runId, program.actorId);
        const state = checked(program.stateSchema, result.state, "Actor state");
        return { result: result.result, logs, state, initial };
    }
    #commitState(runId: string, actorId: string, state: JsonValue, initial: ActorDataState): void {
        if (canonicalHash(state) === canonicalHash(initial.values))
            return;
        if (this.data(runId, actorId).revision !== initial.revision)
            throw new Error("The actor state was changed during the call. Call again.");
        this.runtime().replaceActorState(this.operatorContext(runId), runId, actorId, state);
    }
    #executeFunction(runId: string, bound: ActorProgramDefinition, declared: ActorFunctionDefinition, input: unknown, binding: BackendBinding, signal: AbortSignal): Promise<JsonValue> {
        const functionOf = (program: ActorProgramDefinition): ActorFunctionDefinition => {
            const fn = program.functions.find((entry) => entry.id === declared.id);
            if (!fn)
                throw new Error("The function is not declared.");
            return fn;
        };
        return this.#serial(runId, bound.actorId, signal, async () => {
            const { program, contract: fn, descriptors } = await this.#bound(runId, bound.actorId, bound.revision, signal, functionOf, binding.descriptorsFor);
            const value = checked(fn.inputSchema, input, `Input ${fn.id}`);
            const result = await this.#backend(runId, program, { kind: "function", functionId: fn.id, input: value }, binding, descriptors, signal);
            const output = checked(fn.resultSchema, result.result, `Result ${fn.id}`);
            this.#commitState(runId, program.actorId, result.state, result.initial);
            binding.output?.push(...result.logs);
            return output;
        });
    }
    async runInput(request: TurnRequest<"script">, signal: AbortSignal): Promise<TurnResult> {
        this.#knownRuns.add(request.runId);
        try {
            const inputOf = (program: ActorProgramDefinition) => {
                if (!program.input)
                    throw new Error("This TypeScript actor has no onInput handler.");
                return program.input;
            };
            const descriptorsFor = (capabilityIds: readonly string[]) => agentCapabilityBinding(this.actor(request.runId, request.agentId), request.tools, capabilityIds, new Set()).descriptors;
            await this.#serial(request.runId, request.agentId, signal, async () => {
                const { program, descriptors } = await this.#bound(request.runId, request.agentId, undefined, signal, inputOf, descriptorsFor);
                const binding: BackendBinding = { id: request.turnId, kind: "input", principal: { id: request.agentId, kind: "script" }, descriptorsFor, call: (name, input, index) => request.invoke(`${request.turnId}:capability:${index}`, name, input) };
                const recognized = this.#recognize(request.runId, request.agentId, request.input);
                const result = await this.#backend(request.runId, program, { kind: "input", input: scriptInputOf(request.input), ...recognized }, binding, descriptors, signal);
                const finishes = this.#finishesOf(request.runId, program, result.result);
                this.#commitState(request.runId, request.agentId, result.state, result.initial);
                this.#deliverResults(request, program, finishes);
                for (const text of result.logs)
                    request.emit({ kind: "runtime", text });
            });
            return { failure: null, usage: emptyUsage() };
        }
        catch (error) {
            return { failure: errorText(error), usage: emptyUsage() };
        }
    }
    invocationPermit(runId: string): number { if (this.#shuttingDown || this.#stopping.has(runId))
        throw new Error("The run is being stopped."); return this.#epochs.get(runId) ?? 0; }
    startInvocation(runId: string, viewId: string, revision: string, functionId: string, requestId: string, input: unknown, permit = this.invocationPermit(runId)) {
        const program = this.#program(runId, viewId);
        if (!program.views.some((view) => view.id === viewId))
            throw new Error("The view is unknown.");
        return this.#start(runId, program, viewId, revision, functionId, requestId, input, permit);
    }
    startFunctionInvocation(runId: string, actorHandle: string, revision: string, functionId: string, requestId: string, input: unknown, permit = this.invocationPermit(runId)) {
        const program = this.programs(runId).find((entry) => entry.actorHandle === handleKey(actorHandle));
        if (!program)
            throw new Error("The actor publishes no program.");
        return this.#start(runId, program, program.name, revision, functionId, requestId, input, permit);
    }
    #start(runId: string, program: ActorProgramDefinition, viewId: string, revision: string, functionId: string, requestId: string, input: unknown, permit: number): ActorFunctionInvocation {
        this.#knownRuns.add(runId);
        if (permit !== this.invocationPermit(runId))
            throw new Error("The run has been stopped in the meantime.");
        if (program.revision !== revision)
            throw new Error("The actor package was replaced. Refresh the view.");
        const fn = program.functions.find((entry) => entry.id === functionId);
        if (!fn)
            throw new Error("The function is not declared.");
        const state = this.#invocations(runId);
        const prior = state.invocations.find((entry) => entry.requestId === requestId);
        if (prior) {
            if (prior.actorId !== program.actorId || prior.actionId !== functionId || prior.revision !== revision || canonicalHash(prior.input) !== canonicalHash(input))
                throw new Error("The request ID was already used for another call.");
            return prior;
        }
        if (!requestId || requestId.length > 200 || state.requestIds.includes(requestId))
            throw new Error("Invalid or already processed request ID.");
        if (state.requestIds.length >= 10000)
            throw new Error("The run has reached its call limit.");
        if ([...this.#active.values()].filter((entry) => entry.runId === runId).length >= 8)
            throw new Error("Eight actor functions are already running.");
        checked(fn.inputSchema, input, "Function input");
        const invocation: ActorFunctionInvocation = { id: randomUUID(), requestId, actorId: program.actorId, actorHandle: program.actorHandle, appId: viewId, revision, actionId: functionId, input, output: [], createdAt: new Date().toISOString(), status: "queued" };
        this.#replaceInvocation(runId, invocation, true);
        const controller = new AbortController();
        const completed = Promise.resolve().then(async () => {
            const started = { ...invocation, status: "running" as const, startedAt: new Date().toISOString() };
            this.#replaceInvocation(runId, started);
            try {
                if (fn.confirmation && !await this.#confirm(runId, invocation, fn.confirmation, controller.signal))
                    throw new Error("The function was not confirmed.");
                const descriptorsFor = (capabilityIds: readonly string[]) => operatorCapabilityBinding(this.ownerId(runId), this.#options.operations.list(), capabilityIds).descriptors;
                const output: string[] = [];
                const result = await this.#executeFunction(runId, program, fn, input, { output, id: invocation.id, kind: "app-action", principal: { id: this.ownerId(runId), kind: "operator" }, descriptorsFor, call: async (name, value, index) => {
                        const operation = this.#options.operations.operation(name)!;
                        const id = `${invocation.id}:capability:${index}`;
                        const confirmation = operation.operator === "confirm" ? await this.#confirm(runId, invocation, `Run ${operation.label}?`, controller.signal, value) : true;
                        if (!confirmation)
                            throw new Error("The action was not confirmed.");
                        return this.#options.operations.invoke(name, { runId, invocationId: id, principal: { kind: "operator", actorId: this.ownerId(runId) }, signal: controller.signal, ...(operation.operator === "confirm" ? { operatorConfirmation: { operationId: name, invocationId: id, inputHash: canonicalHash(value) } } : {}) }, value);
                    } }, controller.signal);
                this.#replaceInvocation(runId, { ...started, status: "succeeded", result, output, finishedAt: new Date().toISOString() });
            }
            catch (error) {
                this.#replaceInvocation(runId, { ...started, status: controller.signal.aborted ? "cancelled" : "failed", error: errorText(error).slice(0, 8000), finishedAt: new Date().toISOString() });
            }
        }).finally(() => this.#active.delete(invocation.id));
        this.#active.set(invocation.id, { runId, actorId: program.actorId, controller, completed });
        return invocation;
    }
    invocation(runId: string, reference: string, id: string): ActorFunctionInvocation {
        const invocation = this.#invocations(runId).invocations.find((entry) => entry.id === id && (entry.appId === reference || entry.actorHandle === reference));
        if (!invocation)
            throw new Error("The function call is unknown.");
        return invocation;
    }
    #invocations(runId: string): InvocationState { return (this.view(runId).pluginStates.find((entry) => entry.pluginId === ACTOR_INVOCATIONS_STATE_ID && entry.scope.kind === "run")?.state as unknown as InvocationState) ?? { version: 1, invocations: [], requestIds: [] }; }
    #replaceInvocation(runId: string, invocation: ActorFunctionInvocation, remember = false): void {
        const current = this.#invocations(runId);
        const entries = [...current.invocations.filter((entry) => entry.id !== invocation.id), invocation];
        const active = entries.filter((entry) => entry.status === "queued" || entry.status === "running");
        const finished = entries.filter((entry) => entry.status !== "queued" && entry.status !== "running").slice(-20);
        const state: InvocationState = { version: 1, invocations: [...active, ...finished], requestIds: remember ? [...current.requestIds, invocation.requestId] : current.requestIds };
        while (jsonBytes(state) > MAX_INVOCATIONS_STATE_BYTES && finished.length) {
            finished.shift();
            state.invocations = [...active, ...finished];
        }
        assertJsonValue(state, "Actor calls");
        this.runtime().replacePluginState(this.operatorContext(runId), runId, { pluginId: ACTOR_INVOCATIONS_STATE_ID, scope: { kind: "run" }, state });
    }
    async #confirm(runId: string, invocation: ActorFunctionInvocation, question: string, signal: AbortSignal, input = invocation.input): Promise<boolean> {
        const answer = await this.#options.askService().ask({ runId, agentId: this.ownerId(runId), turnId: null, commandId: `actor-confirm:${randomUUID()}` }, { question: `${question}\nInput: ${JSON.stringify(input).slice(0, 500)}`, options: ["Run", "Cancel"], multi: false, description: `Function ${invocation.actionId} of @${invocation.actorHandle}`, parameters: { source: ACTOR_PROGRAMS_STATE_ID, invocationId: invocation.id } }, signal);
        return answer === "Run";
    }
    #program(runId: string, reference: string): ActorProgramDefinition {
        const program = this.programs(runId).find((entry) => entry.name === reference || entry.views.some((view) => view.id === reference));
        if (!program)
            throw new Error(`Actor package ${reference} is not active.`);
        return program;
    }
    #instance(program: ActorProgramDefinition): string { return `actor:${program.actorId}:${program.revision}`; }
    #assertName(name: string): void { if (!NAME.test(name))
        throw new Error("Package names begin with a lowercase letter and contain at most 64 lowercase letters, digits, or hyphens."); }
    #assertIdle(runId: string, actorId: string): void { if (this.#queues.has(`${runId}\0${actorId}`) || [...this.#active.values()].some((entry) => entry.runId === runId && entry.actorId === actorId))
        throw new Error("The actor still has running functions or inputs."); }
    async stopActor(runId: string, actorId: string): Promise<void> {
        const active = [...this.#active.values()].filter((entry) => entry.runId === runId && entry.actorId === actorId);
        active.forEach((entry) => entry.controller.abort(new Error("Actor stopped.")));
        const state = this.view(runId).pluginStates.find((entry) => entry.pluginId === ACTOR_PROGRAMS_STATE_ID && entry.scope.kind === "actor" && entry.scope.actorId === actorId)?.state as unknown as ActorProgramState | undefined;
        if (state?.program)
            await this.runtime().nativeTypeScriptExecutor.stopInstance(runId, this.#instance(state.program));
        await Promise.allSettled(active.map((entry) => entry.completed));
    }
    async stopRun(runId: string): Promise<void> {
        this.#epochs.set(runId, (this.#epochs.get(runId) ?? 0) + 1);
        this.#stopping.add(runId);
        try {
            const active = [...this.#active.values()].filter((entry) => entry.runId === runId);
            active.forEach((entry) => entry.controller.abort(new Error("Run stopped.")));
            await this.runtime().nativeTypeScriptExecutor.stopRun(runId);
            await Promise.allSettled([...active.map((entry) => entry.completed), ...[...this.#queues].filter(([key]) => key.startsWith(`${runId}\0`)).map(([, queue]) => queue)]);
        }
        finally {
            this.#stopping.delete(runId);
        }
    }
    waitForRunSettlement(runId: string): Promise<void> { return Promise.allSettled([...this.#active.values()].filter((entry) => entry.runId === runId).map((entry) => entry.completed).concat([...this.#queues].filter(([key]) => key.startsWith(`${runId}\0`)).map(([, queue]) => queue))).then(() => undefined); }
    /** Once per run and server process: calls a previous process left open are cancelled, calls of this process keep running. */
    async prepareSession(runId: string): Promise<void> {
        this.#knownRuns.add(runId);
        if (this.#recovered.has(runId) || !this.runtime().listRuns().some(run => run.id === runId))
            return;
        this.#recovered.add(runId);
        for (const invocation of this.#invocations(runId).invocations)
            if ((invocation.status === "queued" || invocation.status === "running") && !this.#active.has(invocation.id))
                this.#replaceInvocation(runId, { ...invocation, status: "cancelled", error: "The server was stopped during the call.", finishedAt: new Date().toISOString() });
    }
    async stopSession(runId: string, _signal?: AbortSignal): Promise<void> { await this.stopRun(runId); }
    async disposeRun(runId: string): Promise<void> { await this.stopRun(runId); }
    async deleteSession(runId: string): Promise<void> {
        await this.stopRun(runId);
        this.#recovered.delete(runId);
        for (const directory of this.#identities.keys())
            if (directory.startsWith(`${this.#options.directoryFor(runId)}${path.sep}`))
                this.#identities.delete(directory);
        await rm(this.#options.directoryFor(runId), { recursive: true, force: true });
    }
    async shutdown(): Promise<void> { this.#shuttingDown = true; await Promise.allSettled([...this.#knownRuns].map((runId) => this.stopRun(runId))); }
}
