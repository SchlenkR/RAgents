import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { lstatSync, readFileSync, renameSync } from "node:fs";
import path from "node:path";
import { Type, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { actorByHandle, actorDescriptionMaxLength, agentTools, assertJsonValue, canonicalHash, defineRunFunction, defineToolAvailability, emptyUsage, handleKey, runCapabilityContractHash, scriptInputOf, schemaComplaints, type Actor, type ActorProgramExecutor, type RunFunction, type CommandContext, type ExecutableActor, type JsonValue, type Orchestration, type PluginContext, type RunCapabilityDescriptor, type RunView, type TurnRequest, type TurnResult, } from "@ragents/engine";
import { ACTOR_PROGRAMS_STATE_ID, ACTOR_INVOCATIONS_STATE_ID, ACTOR_SCRIPT_STATE_ID, ACTOR_STATE_ID, resolveActorView, type ActorDataState, type ActorFunctionDefinition, type ActorFunctionInvocation, type ActorProgramDefinition, type ActorProgramState, type ActorScriptState, type ActorViewListing, } from "@ragents/host/plugin-support/actor-programs/contract.js";
import type { ActorProgramSource, ActorProgramsService } from "@ragents/host/plugin-support/actor-programs/service.js";
import { jsonValue, jsonBytes, MAX_INVOCATIONS_STATE_BYTES } from "./limits.js";
import { agentCapabilityBinding, operatorCapabilityBinding } from "./capability-resolver.js";
import type { ActorOperationPort } from "./operations.js";
import { compileClientProject, installClientSdk } from "@ragents/host/plugin-support/actor-programs/client-compiler.js";
import { compileAppBackend, installServerSdk, prepareAppProject, prepareAppWorkspace, projectSourceFiles, readAppPackage, typecheckServerProject, type AppContract } from "@ragents/host/plugin-support/actor-programs/app-project.js";
import { syncWorkspaceOwnership } from "@ragents/host/plugin-support/workspace-ownership.js";
import { runManagedProcess, sandboxedLaunch, type WorkspaceProcessContext } from "@ragents/workspace-executor";
import { runModuleTemplates, templateById, templateFiles } from "./templates.js";
import { createTestReport, testReporterArgument } from "./test-report.js";
import { FRAME_BODY_CLASS, FRAME_DOCUMENT_CLASS, FRAME_ROOT_CLASS } from "@ragents/host/plugin-support/actor-programs/client-runtime.js";
import { buildTailwind } from "@ragents/host/plugin-support/actor-programs/tailwind.js";
import type { AskService } from "@ragents/plugins/ragents.ask/server/contract.js";
const NAME = /^[a-z][a-z0-9-]{0,63}$/;
const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);
const complaints = (lines: readonly string[], fallback: string): string =>
    lines.map((line) => line.trim()).filter((line) => line !== "").join("\n") || fallback;
const actorDescriptionOf = (text: string | undefined): string | undefined => {
    const line = (text ?? "").replace(/\s+/g, " ").trim();
    return line.length <= actorDescriptionMaxLength ? line || undefined : `${line.slice(0, actorDescriptionMaxLength - 3).trimEnd()}...`;
};
const exposed = defineToolAvailability({ availability: "conditional", availabilityDetail: "Veröffentlichte Funktion eines aktiven Actors im Run." }, () => true);
const objectSchema = { type: "object", additionalProperties: true };
const checked = (schema: object, value: unknown, label: string): JsonValue => {
    const result = jsonValue(value, label);
    if (!Value.Check(schema as TSchema, result))
        throw new Error(`${label}: ${schemaComplaints(schema as TSchema, result)}`);
    return result;
};
const safePath = (name: string): string => {
    if (!name || path.isAbsolute(name) || name.includes("\\") || name.includes("\0") || name.split("/").some((part) => !part || part === "." || part === ".."))
        throw new Error(`Ungültiger Paketpfad ${name}.`);
    return name;
};
const inside = async (directory: string, relative: string): Promise<string> => {
    const root = await realpath(directory);
    const file = await realpath(path.join(root, safePath(relative)));
    if (!file.startsWith(`${root}${path.sep}`))
        throw new Error(`Paketpfad ${relative} liegt außerhalb des Pakets.`);
    const stat = await lstat(file);
    if (!stat.isFile() || stat.size > 2000000)
        throw new Error(`Ungültige oder zu große Paketdatei ${relative}.`);
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
const packageExists = (name: string): Error => new Error(`Das Paket ${name} existiert bereits.`);
// Prüfung und rename synchron hintereinander, weil rename einen leeren Zielordner still ersetzt.
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
    /** Programme, Tests und Builds laufen auf dem Server, auch bei einem Arbeitsbereich auf einem Arbeitsplatz. */
    serverProcessContextFor: (runId: string) => Promise<WorkspaceProcessContext>;
    operations: ActorOperationPort;
    directoryFor: (runId: string) => string;
    scriptSources: (entryId: string, name: string) => readonly ActorProgramSource[] | undefined;
}
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
            throw new Error("Der Actor ist nicht aktiv.");
        if (this.#removing.has(`${runId}\0${actorId}`))
            throw new Error("Das Actor-Paket wird entfernt.");
        return actor;
    }
    resolveActor(runId: string, callerId: string, reference: string): ExecutableActor {
        const actors = this.view(runId).actors;
        const found = reference === "self" ? actors.find((candidate) => candidate.id === callerId) : actorByHandle(actors, reference);
        if (!found)
            throw new Error(`Actor ${reference} ist unbekannt.`);
        return this.actor(runId, found.id);
    }
    data(runId: string, actorId: string): ActorDataState {
        const view = this.view(runId);
        const entry = view.pluginStates.find((item) => item.pluginId === ACTOR_STATE_ID && item.scope.kind === "actor" && item.scope.actorId === actorId);
        const revision = this.runtime().events(runId).filter((event) => (event.type === "plugin.state-replaced" || event.type === "plugin.state-patched") && event.payload.pluginId === ACTOR_STATE_ID && event.payload.scope.kind === "actor" && event.payload.scope.actorId === actorId).at(-1)?.sequence ?? 0;
        return { version: 1, revision, values: (entry?.state ?? {}) as Record<string, unknown> };
    }
    #writeProgram(context: CommandContext, runId: string, actorId: string, program: ActorProgramDefinition | null): void {
        this.runtime().replacePluginState(this.operatorContext(runId), runId, { pluginId: ACTOR_PROGRAMS_STATE_ID, scope: { kind: "actor", actorId }, state: jsonValue({ version: 1, program }, "Actor-Programm") });
    }
    #script(runId: string): ActorScriptState | undefined {
        return this.view(runId).pluginStates.find((entry) => entry.pluginId === ACTOR_SCRIPT_STATE_ID && entry.scope.kind === "run")?.state as unknown as ActorScriptState | undefined;
    }
    async #writeSources(directory: string, files: readonly ActorProgramSource[]): Promise<void> {
        for (const source of files) {
            const file = path.join(directory, safePath(source.path));
            if (source.path.split("/").includes("node_modules"))
                throw new Error("Paketquellen dürfen keine Abhängigkeiten überschreiben.");
            await mkdir(path.dirname(file), { recursive: true });
            await writeFile(file, source.content, { flag: "wx" });
        }
    }
    async #refresh(runId: string, program: ActorProgramDefinition, signal: AbortSignal): Promise<void> {
        const script = this.#script(runId);
        const files = script ? this.#options.scriptSources(script.entryId, program.name) : undefined;
        if (files) {
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
            throw new Error(`Der Capability-Vertrag von ${program.name} hat sich geändert und die Neuaktivierung scheiterte: ${errorText(error)}`);
        }
    }
    async #bound<T extends CapabilityContract>(runId: string, actorId: string, revision: string | undefined, signal: AbortSignal, contractOf: (program: ActorProgramDefinition) => T, descriptorsFor: BackendBinding["descriptorsFor"]): Promise<{ program: ActorProgramDefinition; contract: T; descriptors: readonly RunCapabilityDescriptor[] }> {
        const current = () => {
            const program = this.programs(runId).find((entry) => entry.actorId === actorId);
            if (!program)
                throw new Error("Der Actor besitzt kein aktives Programm.");
            return program;
        };
        const bind = (program: ActorProgramDefinition) => {
            const contract = contractOf(program);
            const descriptors = descriptorsFor(contract.capabilityIds);
            return { program, contract, descriptors, drifted: runCapabilityContractHash(descriptors) !== contract.capabilityContractHash };
        };
        const program = current();
        if (revision !== undefined && program.revision !== revision)
            throw new Error("Das Actor-Paket wurde ersetzt.");
        const bound = bind(program);
        if (!bound.drifted)
            return bound;
        await this.#refresh(runId, program, signal);
        const refreshed = bind(current());
        if (refreshed.drifted)
            throw new Error(`Der Capability-Vertrag von ${program.name} weicht auch nach der Neuaktivierung ab.`);
        return refreshed;
    }
    async workspaceDirectory(runId: string): Promise<string> { this.#knownRuns.add(runId); return prepareAppWorkspace(path.join(this.#options.directoryFor(runId), "actor-workspace")); }
    templates() { return runModuleTemplates.map(({ id, title, description }) => ({ id, title, description })); }
    async #create<T>(runId: string, name: string, build: (directory: string) => Promise<T>): Promise<{ directory: string; built: T }> {
        this.#assertName(name);
        const actors = await this.workspaceDirectory(runId);
        const directory = path.join(actors, name);
        const key = `${runId}\0${name}`;
        if (this.#creating.has(key))
            throw new Error(`Das Paket ${name} wird gerade angelegt.`);
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
    async scaffold(runId: string, name: string, templateId: string) {
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
    async importPackage(context: CommandContext, runId: string, name: string, files: readonly ActorProgramSource[], signal?: AbortSignal, scriptEntryId?: string) {
        const { directory } = await this.#create(runId, name, (staged) => this.#writeSources(staged, files));
        try {
            if (scriptEntryId)
                this.runtime().replacePluginState(this.operatorContext(runId), runId, { pluginId: ACTOR_SCRIPT_STATE_ID, scope: { kind: "run" }, state: { version: 1, entryId: scriptEntryId } });
            await this.activate(context, runId, name, signal);
            const program = this.programs(runId).find((entry) => entry.name === name)!;
            return { name, actorId: program.actorId, actorHandle: program.actorHandle, views: program.views.length };
        }
        catch (error) {
            await rm(directory, { recursive: true, force: true });
            throw error;
        }
    }
    async check(runId: string, name: string, callerId: string, signal?: AbortSignal, reference?: string): Promise<CompiledProgram> {
        this.#assertName(name);
        const directory = path.join(await this.workspaceDirectory(runId), name);
        if ((await lstat(directory)).isSymbolicLink())
            throw new Error("Actor-Pakete dürfen keine Symlinks sein.");
        await prepareAppProject(directory);
        const pkg = await readAppPackage(directory);
        const previous = this.programs(runId).find((program) => program.name === name);
        const owner = reference ? this.resolveActor(runId, callerId, reference) : previous ? this.actor(runId, previous.actorId) : !pkg.backend ? this.actor(runId, callerId) : undefined;
        if (previous && owner?.id !== previous.actorId)
            throw new Error("Ein aktiviertes Paket kann nicht zu einem anderen Actor wechseln.");
        const caller = this.view(runId).actors.find((candidate) => candidate.id === callerId);
        if (!caller)
            throw new Error("Aufrufender Actor fehlt.");
        const provisional: ExecutableActor = owner ?? {
            id: "pending", handle: name, displayName: pkg.title, kind: "script", grants: caller.grants.filter((grant) => grant.delegable),
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
            throw new Error("Ein LLM-Actor verarbeitet Eingaben mit seinem Agententreiber; onInput ist nur für TypeScript-Actors erlaubt.");
        if (contract.state.type !== "object")
            throw new Error("Actor-Zustand muss ein Object-Schema sein.");
        const state = owner ? this.data(runId, owner.id).values : {};
        checked(contract.state, state, "Actor-Zustand");
        const actorId = owner?.id ?? "pending";
        const actorHandle = owner?.handle ?? name;
        const functions: ActorFunctionDefinition[] = Object.entries(contract.functions).map(([id, fn]) => {
            if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(id))
                throw new Error(`Ungültiger Funktionsname ${id}.`);
            if (fn.tool && !/^[a-z][a-z0-9_]{0,63}$/.test(fn.tool.name))
                throw new Error(`Ungültiger Werkzeugname ${fn.tool.name}.`);
            const capabilities = fn.capabilities ?? [];
            const selected = capabilities.map((name) => {
                const entry = available.find((item) => item.id === name);
                if (!entry)
                    throw new Error(`Capability ${name} ist nicht verfügbar.`);
                return entry;
            });
            return { id, label: fn.label, description: fn.description ?? fn.label, inputSchema: fn.input, resultSchema: fn.output, capabilityIds: capabilities, capabilityContractHash: runCapabilityContractHash(selected), confirmation: fn.confirmation ?? null,
                ...(fn.tool ? { tool: { name: fn.tool.name, targets: fn.tool.targets ? fn.tool.targets.map((target) => target === "self" ? actorId : this.resolveActor(runId, callerId, target).id) : null, card: fn.tool.card ?? true } } : {}) };
        });
        const inputCapabilities = contract.input?.capabilities ?? [];
        const inputDescriptors = inputCapabilities.map((id) => {
            const found = available.find((entry) => entry.id === id);
            if (!found)
                throw new Error(`Eingabe-Capability ${id} ist nicht verfügbar.`);
            return found;
        });
        await installClientSdk(directory, { stateSchema: contract.state, actions: functions.map((fn) => ({ id: fn.id, inputSchema: fn.inputSchema, resultSchema: fn.resultSchema })) });
        const hasServerFiles = pkg.backend || (await projectSourceFiles(directory)).some((file) => /^tests\/.*\.tsx?$/.test(file.path));
        const serverErrors = hasServerFiles ? typecheckServerProject(directory, pkg.backend) : [];
        if (serverErrors.length)
            throw new Error(complaints(serverErrors, `Die Typprüfung von ${name} schlug ohne Meldung fehl.`));
        const clients: CompiledProgram["clients"] = [];
        const views: ActorProgramDefinition["views"] = [];
        for (const view of pkg.views ?? []) {
            const client = await compileClientProject({ directory, entryPoint: view.client, stateSchema: contract.state, actions: functions.map((fn) => ({ id: fn.id, inputSchema: fn.inputSchema, resultSchema: fn.resultSchema })) });
            if (!client.valid)
                throw new Error(complaints(client.diagnostics.map((item) => `${item.fileName} ${item.message}`),
                    `Der Client-Build von ${view.client} schlug ohne Meldung fehl.`));
            const styles = view.styles ? await inside(directory, view.styles) : "";
            if (/@import\b|url\s*\(\s*["']?\s*(?:https?:|\/\/)/i.test(styles))
                throw new Error("Ansichts-CSS darf keine externen Ressourcen laden.");
            const clientFile = `view-${view.id}.mjs`;
            clients.push({ file: clientFile, javaScript: client.javaScript });
            views.push({ id: `${name}--${view.id}`, key: view.id, title: view.title ?? pkg.title, visible: previous?.views.find((item) => item.key === view.id)?.visible ?? true,
                placements: [{ kind: "canvas", anchorActorId: actorId }], html: `<!doctype html><html class="${FRAME_DOCUMENT_CLASS}"><head><meta charset="utf-8"></head><body class="${FRAME_BODY_CLASS}"><div id="root" class="${FRAME_ROOT_CLASS}"></div></body></html>`, styles, clientFile });
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
        return this.#activate(context, runId, name, true, signal, reference);
    }
    async #activate(context: CommandContext, runId: string, name: string, idle: boolean, signal?: AbortSignal, reference?: string) {
        const key = `${runId}\0${name}`;
        if (this.#installing.has(key))
            throw new Error(`Paket ${name} wird bereits aktiviert.`);
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
                throw new Error("Paketdateien wurden während der Prüfung geändert; erneut aktivieren.");
            if (epoch !== this.invocationPermit(runId))
                throw new Error("Der Run wurde während der Aktivierung gestoppt.");
            if (this.programs(runId).find((item) => item.name === name)?.revision !== original?.revision)
                throw new Error("Das Paket wurde zwischenzeitlich geändert.");
            if (idle)
                this.#assertIdle(runId, definition.actorId);
            const names = new Set([...agentTools.map((tool) => tool.name), ...this.#options.reservedToolNames(), ...this.programs(runId).filter((program) => program.name !== name).flatMap((program) => program.functions.flatMap((fn) => fn.tool ? [fn.tool.name] : []))]);
            for (const fn of definition.functions)
                if (fn.tool) {
                    if (names.has(fn.tool.name))
                        throw new Error(`Werkzeugname ${fn.tool.name} ist bereits vergeben.`);
                    names.add(fn.tool.name);
                }
            const occupied = this.programs(runId).find((program) => program.actorId === definition.actorId && program.name !== name);
            if (occupied)
                throw new Error(`Actor @${definition.actorHandle} besitzt bereits das Paket ${occupied.name}. Ergänze darin Funktionen oder Ansichten.`);
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
                throw new Error("Der Run wurde während der Aktivierung gestoppt.");
            if (this.programs(runId).find((item) => item.name === name)?.revision !== original?.revision)
                throw new Error("Das Paket wurde zwischenzeitlich geändert.");
            if (!compiled.createActor) {
                this.actor(runId, definition.actorId);
                if (idle)
                    this.#assertIdle(runId, definition.actorId);
                checked(definition.stateSchema, this.data(runId, definition.actorId).values, "Actor-Zustand");
                if (this.programs(runId).some((item) => item.actorId === definition.actorId && item.name !== name))
                    throw new Error("Der Actor besitzt inzwischen ein anderes Paket.");
            }
            const currentNames = new Set([...agentTools.map((tool) => tool.name), ...this.#options.reservedToolNames(), ...this.programs(runId).filter((program) => program.name !== name).flatMap((program) => program.functions.flatMap((fn) => fn.tool ? [fn.tool.name] : []))]);
            for (const fn of definition.functions)
                if (fn.tool) {
                    if (currentNames.has(fn.tool.name))
                        throw new Error(`Werkzeugname ${fn.tool.name} ist inzwischen vergeben.`);
                    currentNames.add(fn.tool.name);
                }
            jsonValue({ version: 1, program: definition }, "Actor-Programm");
            if (compiled.createActor) {
                const actors = this.view(runId).actors;
                const caller = actors.find((actor) => actor.id === context.actorId)!;
                const holder = actors.find((actor) => actor.handle === name);
                if (holder?.kind === "script" && holder.lifecycle.kind === "stopped") {
                    checked(definition.stateSchema, this.data(runId, holder.id).values, "Actor-Zustand");
                    this.runtime().restartActor(context, runId, holder.id, "Actor-Paket erneut aktiviert");
                }
                else if (holder)
                    throw new Error(`Handle @${name} gehört bereits dem ${holder.kind !== "human" && holder.lifecycle.kind === "stopped" ? "gestoppten" : "aktiven"} Actor ${holder.displayName}; nur ein gestoppter TypeScript-Actor wird beim Aktivieren neu gestartet. Wähle einen anderen Paketnamen.`);
                else
                    this.runtime().createScriptActor(context, runId, { handle: name, displayName: definition.title, description: actorDescriptionOf(definition.description), grants: caller.grants.filter((grant) => grant.delegable), toolNames: null });
                const actor = this.resolveActor(runId, context.actorId, `@${name}`);
                definition.actorId = actor.id;
                definition.actorHandle = actor.handle;
                for (const view of definition.views)
                    for (const placement of view.placements)
                        placement.anchorActorId = actor.id;
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
        const program = this.#program(runId, name);
        this.#assertIdle(runId, program.actorId);
        if (this.#installing.has(`${runId}\0${name}`))
            throw new Error("Das Paket wird gerade aktiviert.");
        const actor = this.actor(runId, program.actorId);
        const key = `${runId}\0${program.actorId}`;
        this.#removing.add(key);
        try {
            await this.stopActor(runId, program.actorId);
            this.#writeProgram(context, runId, program.actorId, null);
            if (actor.kind === "script")
                this.runtime().stopActor(context, runId, program.actorId, "Actor-Paket entfernt");
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
            actions: program.functions.map(({ id, label, description, confirmation }) => ({ id, label, description, confirmation })), placements: view.placements, visible: view.visible, state: this.data(runId, program.actorId), invocations: this.#invocations(runId).invocations.filter((invocation) => invocation.actorId === program.actorId && invocation.revision === program.revision) })));
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
            throw new Error("Die Ansicht wurde ersetzt oder entfernt.");
        if (!program.stylesFile)
            throw new Error("Das Programm stammt aus einer älteren Aktivierung ohne Stylesheet-Datei. Bitte erneut aktivieren.");
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
            throw new Error("Der Run wurde vor dem Funktionsstart gestoppt."); this.actor(runId, actorId); return execute(); });
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
            throw new Error("Der Actor besitzt kein TypeScript-Backend.");
        const current = this.#program(runId, program.name);
        if (current.revision !== program.revision)
            throw new Error("Das Actor-Paket wurde ersetzt.");
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
                    throw new Error(`Capability ${name} ist nicht deklariert.`);
                if (++calls > 64)
                    throw new Error("Ein Aufruf darf höchstens 64 Capabilities ausführen.");
                if (program.functions.some((fn) => fn.tool?.name === name))
                    throw new Error("Eine Actor-Funktion darf sich nicht über ein Werkzeug selbst aufrufen; verwende eine gemeinsame TypeScript-Funktion.");
                checked(capability.schema, value, `Eingabe ${name}`);
                const output = await binding.call(name, value, calls);
                return checked(capability.resultSchema, output, `Ergebnis ${name}`);
            } });
        signal.throwIfAborted();
        this.actor(runId, program.actorId);
        const state = checked(program.stateSchema, result.state, "Actor-Zustand");
        return { result: result.result, logs, state, initial };
    }
    #commitState(runId: string, actorId: string, state: JsonValue, initial: ActorDataState): void {
        if (canonicalHash(state) === canonicalHash(initial.values))
            return;
        if (this.data(runId, actorId).revision !== initial.revision)
            throw new Error("Der Actor-Zustand wurde während des Aufrufs geändert. Erneut aufrufen.");
        this.runtime().replaceActorState(this.operatorContext(runId), runId, actorId, state);
    }
    #executeFunction(runId: string, bound: ActorProgramDefinition, declared: ActorFunctionDefinition, input: unknown, binding: BackendBinding, signal: AbortSignal): Promise<JsonValue> {
        const functionOf = (program: ActorProgramDefinition): ActorFunctionDefinition => {
            const fn = program.functions.find((entry) => entry.id === declared.id);
            if (!fn)
                throw new Error("Die Funktion ist nicht deklariert.");
            return fn;
        };
        return this.#serial(runId, bound.actorId, signal, async () => {
            const { program, contract: fn, descriptors } = await this.#bound(runId, bound.actorId, bound.revision, signal, functionOf, binding.descriptorsFor);
            const value = checked(fn.inputSchema, input, `Eingabe ${fn.id}`);
            const result = await this.#backend(runId, program, { kind: "function", functionId: fn.id, input: value }, binding, descriptors, signal);
            const output = checked(fn.resultSchema, result.result, `Ergebnis ${fn.id}`);
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
                    throw new Error("Dieser TypeScript-Actor besitzt keinen onInput-Handler.");
                return program.input;
            };
            const descriptorsFor = (capabilityIds: readonly string[]) => agentCapabilityBinding(this.actor(request.runId, request.agentId), request.tools, capabilityIds, new Set()).descriptors;
            await this.#serial(request.runId, request.agentId, signal, async () => {
                const { program, descriptors } = await this.#bound(request.runId, request.agentId, undefined, signal, inputOf, descriptorsFor);
                const binding: BackendBinding = { id: request.turnId, kind: "input", principal: { id: request.agentId, kind: "script" }, descriptorsFor, call: (name, input, index) => request.invoke(`${request.turnId}:capability:${index}`, name, input) };
                const result = await this.#backend(request.runId, program, { kind: "input", input: scriptInputOf(request.input) }, binding, descriptors, signal);
                this.#commitState(request.runId, request.agentId, result.state, result.initial);
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
        throw new Error("Der Run wird gestoppt."); return this.#epochs.get(runId) ?? 0; }
    startInvocation(runId: string, viewId: string, revision: string, functionId: string, requestId: string, input: unknown, permit = this.invocationPermit(runId)) {
        const program = this.#program(runId, viewId);
        if (!program.views.some((view) => view.id === viewId))
            throw new Error("Die Ansicht ist unbekannt.");
        return this.#start(runId, program, viewId, revision, functionId, requestId, input, permit);
    }
    startFunctionInvocation(runId: string, actorHandle: string, revision: string, functionId: string, requestId: string, input: unknown, permit = this.invocationPermit(runId)) {
        const program = this.programs(runId).find((entry) => entry.actorHandle === handleKey(actorHandle));
        if (!program)
            throw new Error("Der Actor veröffentlicht kein Programm.");
        return this.#start(runId, program, program.name, revision, functionId, requestId, input, permit);
    }
    #start(runId: string, program: ActorProgramDefinition, viewId: string, revision: string, functionId: string, requestId: string, input: unknown, permit: number): ActorFunctionInvocation {
        this.#knownRuns.add(runId);
        if (permit !== this.invocationPermit(runId))
            throw new Error("Der Run wurde inzwischen gestoppt.");
        if (program.revision !== revision)
            throw new Error("Das Actor-Paket wurde ersetzt. Ansicht aktualisieren.");
        const fn = program.functions.find((entry) => entry.id === functionId);
        if (!fn)
            throw new Error("Die Funktion ist nicht deklariert.");
        const state = this.#invocations(runId);
        const prior = state.invocations.find((entry) => entry.requestId === requestId);
        if (prior) {
            if (prior.actorId !== program.actorId || prior.actionId !== functionId || prior.revision !== revision || canonicalHash(prior.input) !== canonicalHash(input))
                throw new Error("Die Request-ID wurde bereits für einen anderen Aufruf verwendet.");
            return prior;
        }
        if (!requestId || requestId.length > 200 || state.requestIds.includes(requestId))
            throw new Error("Ungültige oder bereits verarbeitete Request-ID.");
        if (state.requestIds.length >= 10000)
            throw new Error("Der Run hat seine Aufrufgrenze erreicht.");
        if ([...this.#active.values()].filter((entry) => entry.runId === runId).length >= 8)
            throw new Error("Es laufen bereits acht Actor-Funktionen.");
        checked(fn.inputSchema, input, "Funktionseingabe");
        const invocation: ActorFunctionInvocation = { id: randomUUID(), requestId, actorId: program.actorId, actorHandle: program.actorHandle, appId: viewId, revision, actionId: functionId, input, output: [], createdAt: new Date().toISOString(), status: "queued" };
        this.#replaceInvocation(runId, invocation, true);
        const controller = new AbortController();
        const completed = Promise.resolve().then(async () => {
            const started = { ...invocation, status: "running" as const, startedAt: new Date().toISOString() };
            this.#replaceInvocation(runId, started);
            try {
                if (fn.confirmation && !await this.#confirm(runId, invocation, fn.confirmation, controller.signal))
                    throw new Error("Die Funktion wurde nicht bestätigt.");
                const descriptorsFor = (capabilityIds: readonly string[]) => operatorCapabilityBinding(this.ownerId(runId), this.#options.operations.list(), capabilityIds).descriptors;
                const output: string[] = [];
                const result = await this.#executeFunction(runId, program, fn, input, { output, id: invocation.id, kind: "app-action", principal: { id: this.ownerId(runId), kind: "operator" }, descriptorsFor, call: async (name, value, index) => {
                        const operation = this.#options.operations.operation(name)!;
                        const id = `${invocation.id}:capability:${index}`;
                        const confirmation = operation.operator === "confirm" ? await this.#confirm(runId, invocation, `${operation.label} ausführen?`, controller.signal, value) : true;
                        if (!confirmation)
                            throw new Error("Die Aktion wurde nicht bestätigt.");
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
            throw new Error("Der Funktionsaufruf ist unbekannt.");
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
        assertJsonValue(state, "Actor-Aufrufe");
        this.runtime().replacePluginState(this.operatorContext(runId), runId, { pluginId: ACTOR_INVOCATIONS_STATE_ID, scope: { kind: "run" }, state });
    }
    async #confirm(runId: string, invocation: ActorFunctionInvocation, question: string, signal: AbortSignal, input = invocation.input): Promise<boolean> {
        const answer = await this.#options.askService().ask({ runId, agentId: this.ownerId(runId), turnId: null, commandId: `actor-confirm:${randomUUID()}` }, { question: `${question}\nEingabe: ${JSON.stringify(input).slice(0, 500)}`, options: ["Ausführen", "Abbrechen"], multi: false, description: `Funktion ${invocation.actionId} von @${invocation.actorHandle}`, parameters: { source: ACTOR_PROGRAMS_STATE_ID, invocationId: invocation.id } }, signal);
        return answer === "Ausführen";
    }
    #program(runId: string, reference: string): ActorProgramDefinition {
        const program = this.programs(runId).find((entry) => entry.name === reference || entry.views.some((view) => view.id === reference));
        if (!program)
            throw new Error(`Actor-Paket ${reference} ist nicht aktiv.`);
        return program;
    }
    #instance(program: ActorProgramDefinition): string { return `actor:${program.actorId}:${program.revision}`; }
    #assertName(name: string): void { if (!NAME.test(name))
        throw new Error("Paketnamen beginnen mit einem Kleinbuchstaben und enthalten höchstens 64 Kleinbuchstaben, Ziffern oder Bindestriche."); }
    #assertIdle(runId: string, actorId: string): void { if (this.#queues.has(`${runId}\0${actorId}`) || [...this.#active.values()].some((entry) => entry.runId === runId && entry.actorId === actorId))
        throw new Error("Der Actor hat noch laufende Funktionen oder Eingaben."); }
    async stopActor(runId: string, actorId: string): Promise<void> {
        const active = [...this.#active.values()].filter((entry) => entry.runId === runId && entry.actorId === actorId);
        active.forEach((entry) => entry.controller.abort(new Error("Actor gestoppt.")));
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
            active.forEach((entry) => entry.controller.abort(new Error("Run gestoppt.")));
            await this.runtime().nativeTypeScriptExecutor.stopRun(runId);
            await Promise.allSettled([...active.map((entry) => entry.completed), ...[...this.#queues].filter(([key]) => key.startsWith(`${runId}\0`)).map(([, queue]) => queue)]);
        }
        finally {
            this.#stopping.delete(runId);
        }
    }
    waitForRunSettlement(runId: string): Promise<void> { return Promise.allSettled([...this.#active.values()].filter((entry) => entry.runId === runId).map((entry) => entry.completed).concat([...this.#queues].filter(([key]) => key.startsWith(`${runId}\0`)).map(([, queue]) => queue))).then(() => undefined); }
    async prepareSession(runId: string): Promise<void> { this.#knownRuns.add(runId); if (!this.runtime().listRuns().some(run => run.id === runId))
        return; for (const invocation of this.#invocations(runId).invocations)
        if (invocation.status === "queued" || invocation.status === "running")
            this.#replaceInvocation(runId, { ...invocation, status: "cancelled", error: "Der Server wurde während des Aufrufs beendet.", finishedAt: new Date().toISOString() }); }
    async stopSession(runId: string, _signal?: AbortSignal): Promise<void> { await this.stopRun(runId); }
    async disposeRun(runId: string): Promise<void> { await this.stopRun(runId); }
    async deleteSession(runId: string): Promise<void> { await this.stopRun(runId); await rm(this.#options.directoryFor(runId), { recursive: true, force: true }); }
    async shutdown(): Promise<void> { this.#shuttingDown = true; await Promise.allSettled([...this.#knownRuns].map((runId) => this.stopRun(runId))); }
}
