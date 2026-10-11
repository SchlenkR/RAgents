import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { lstat, mkdir, readFile, readdir, realpath, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import ts from "typescript";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { canonicalHash, schemaComplaints, typeScriptTypesFromSchema, type NativeTypeScriptExecutor, type RunCapabilityDescriptor, scriptStdDeclarations } from "@ragents/engine";
import { runtimeLibraries, webRuntimeLibraries } from "./runtime-libraries.js";
import { appPermissionsSchema, appTriggersSchema } from "./contract.js";
import { programGuardDiagnostics } from "./program-guards.js";

const webRequire = createRequire(new URL("../../../../web/package.json", import.meta.url));
const rootRequire = createRequire(new URL("../../../../../package.json", import.meta.url));
const serverRequire = createRequire(new URL("../../../package.json", import.meta.url));
const serverTypeRoot = path.dirname(path.dirname(serverRequire.resolve("@types/node/package.json")));
const libraryDirectory = (name: string): string => {
  const resolver = (webRuntimeLibraries as readonly string[]).includes(name) ? webRequire
    : name === "@types/node" || name === "tsx" ? serverRequire : rootRequire;
  try { return path.dirname(resolver.resolve(`${name}/package.json`)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error;
    let directory = path.dirname(resolver.resolve(name));
    while (directory !== path.dirname(directory)) {
      const file = path.join(directory, "package.json");
      if (existsSync(file) && (JSON.parse(readFileSync(file, "utf8")) as { name?: string }).name === name) return directory;
      directory = path.dirname(directory);
    }
    throw new Error(`The installed package ${name} has no package metadata.`);
  }
};
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const link = async (source: string, target: string): Promise<void> => {
  await mkdir(path.dirname(target), { recursive: true });
  await symlink(source, target).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
    if (await realpath(target).catch(() => undefined) === await realpath(source)) return;
    if (!(await lstat(target)).isSymbolicLink()) throw new Error(`The prepared library ${target} has a different origin.`);
    // A link of an earlier host version points to that version's library; the current host relinks it.
    await unlink(target);
    await symlink(source, target);
  });
};
export const prepareAppDependencies = async (directory: string): Promise<void> => {
  await mkdir(directory, { recursive: true });
  for (const name of runtimeLibraries) await link(libraryDirectory(name), path.join(directory, "node_modules", name));
  for (const [name, library, executable] of [["tsc", "typescript", "bin/tsc"], ["tsx", "tsx", "dist/cli.mjs"], ["esbuild", "esbuild", "bin/esbuild"]])
    await link(path.join(libraryDirectory(library!), executable!), path.join(directory, "node_modules/.bin", name!));
};

export const prepareAppWorkspace = async (directory: string): Promise<string> => {
  await prepareAppDependencies(directory);
  const dependencies = Object.fromEntries(runtimeLibraries.map((name) => [name, `link:${libraryDirectory(name)}`]));
  await writeFile(path.join(directory, "package.json"), json({ name: "run-actor-workspace", private: true, type: "module", dependencies }));
  await writeFile(path.join(directory, "pnpm-workspace.yaml"), "packages:\n  - actors/*\n");
  await mkdir(path.join(directory, "actors"), { recursive: true });
  const apps = await readdir(path.join(directory, "actors"), { withFileTypes: true });
  const importers = {
    ".": { dependencies: Object.fromEntries(Object.entries(dependencies).map(([name, specifier]) => [name, { specifier, version: specifier }])) },
    ...Object.fromEntries(apps.filter((entry) => entry.isDirectory()).map((entry) => [`actors/${entry.name}`, {}])),
  };
  await writeFile(path.join(directory, "pnpm-lock.yaml"), json({ lockfileVersion: "9.0", settings: { autoInstallPeers: true, excludeLinksFromLockfile: false }, importers }));
  await writeFile(path.join(directory, "tsconfig.json"), json({ files: [], references: [] }));
  return path.join(directory, "actors");
};

const schema = Type.Record(Type.String(), Type.Any());
const actionSchema = Type.Object({
  label: Type.String({ minLength: 1 }), description: Type.Optional(Type.String()),
  input: schema, output: schema,
  capabilities: Type.Optional(Type.Array(Type.String(), { uniqueItems: true })),
  confirmation: Type.Optional(Type.String()),
  tool: Type.Optional(Type.Object({ name: Type.String(), targets: Type.Optional(Type.Array(Type.String(), { minItems: 1 })), card: Type.Optional(Type.Boolean()) }, { additionalProperties: false })),
  message: Type.Optional(Type.Literal(true)),
}, { additionalProperties: false });
export const appContractSchema = Type.Object({
  state: schema, functions: Type.Record(Type.String(), actionSchema),
  input: Type.Optional(Type.Object({ capabilities: Type.Optional(Type.Array(Type.String(), { uniqueItems: true })) }, { additionalProperties: false })),
  program: Type.Optional(Type.Literal(true)),
}, { additionalProperties: false });
export type AppContract = Static<typeof appContractSchema>;
export const appPackageSchema = Type.Object({
  title: Type.String({ minLength: 1 }), description: Type.Optional(Type.String()), backend: Type.Optional(Type.String({ minLength: 1 })),
  views: Type.Optional(Type.Array(Type.Object({
    id: Type.String({ pattern: "^[a-z][a-z0-9-]{0,63}$" }), title: Type.Optional(Type.String({ minLength: 1 })),
    client: Type.String({ minLength: 1 }), styles: Type.Optional(Type.String()),
  }, { additionalProperties: false }))),
  triggers: Type.Optional(appTriggersSchema),
  permissions: Type.Optional(appPermissionsSchema),
}, { additionalProperties: false });
export type AppPackage = Static<typeof appPackageSchema>;

let serverBundle: Promise<string> | undefined;
const serverRuntime = (): Promise<string> => serverBundle ??= build({
  entryPoints: [fileURLToPath(new URL("./server-sdk.ts", import.meta.url))],
  bundle: true, platform: "node", format: "esm", target: "node22", write: false, logLevel: "silent",
}).then((result) => result.outputFiles[0]!.text);
let testingBundle: Promise<string> | undefined;
const testingRuntime = (): Promise<string> => testingBundle ??= build({
  stdin: {contents: `
import {createRunContext} from ${JSON.stringify(fileURLToPath(new URL("../../../../../packages/ragents/src/typescript/run-context.ts",import.meta.url)))};
import {assertJsonValue} from ${JSON.stringify(fileURLToPath(new URL("../../../../../packages/ragents/src/domain/json.ts",import.meta.url)))};
import {createScriptStd} from ${JSON.stringify(fileURLToPath(new URL("../../../../../packages/ragents/src/script/std.ts",import.meta.url)))};
import {schemaComplaints} from ${JSON.stringify(fileURLToPath(new URL("../../../../../packages/ragents/src/domain/schema-errors.ts",import.meta.url)))};
import {Value} from "typebox/value";
export function createTestContextWithContracts(options, contracts) {
  let state = structuredClone(options.state);
  const controller = new AbortController();
  const statePort = {read:()=>structuredClone(state),replace:value=>{state=structuredClone(value);}};
  const declared = new Map(contracts.map(contract=>[contract.id,contract]));
  for (const name of Object.keys(options.functions ?? {})) if (!declared.has(name)) throw new Error("Unknown test function "+name);
  const capabilities = {descriptors:()=>contracts,call:async(name,input)=>{
    const contract=declared.get(name);
    const call=options.functions?.[name];
    if(!call)throw new Error("The test is missing the function "+name);
    if(!Value.Check(contract.schema,input))throw new Error("Test input violates the contract of "+name+": "+schemaComplaints(contract.schema,input));
    const result=await call(input);
    assertJsonValue(result,"Test response of "+name);
    if(!Value.Check(contract.resultSchema,result))throw new Error("Test response violates the contract of "+name+": "+schemaComplaints(contract.resultSchema,result,"result"));
    return result;
  }};
  const finished = [];
  return {...createRunContext({runId:"test",invocationId:"test",invocationKind:"tool",principal:{id:"test",kind:"service"},state:statePort,capabilities,log:()=>{},signal:controller.signal}),
    actor:{id:"test-actor",handle:"test"},std:createScriptStd({turnStartedAt:"2026-01-01T00:00:00.000Z",idPrefix:"test",state:statePort,capabilities}),
    finished,finish:(result,options={})=>{assertJsonValue(result===undefined?null:result,"Test finish result");finished.push({result:result===undefined?null:result,...options});}};
}
export function createProgramTestWithContracts(program, options, contracts) {
  if (typeof program?.evaluate !== "function") throw new Error("createProgramTest needs the default export of defineProgram.");
  let state = {};
  let now = options.now ?? "2026-01-01T00:00:00.000Z";
  return {
    get state() { return structuredClone(state); },
    async evaluate(world = {}) {
      const context = createTestContextWithContracts({ state, functions: options.functions }, contracts);
      now = world.now ?? now;
      const files = Object.fromEntries(Object.entries(world.files ?? {}).map(([file, hash]) => [file, { hash }]));
      const outcome = await program.evaluate({ now, timeZone: options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone, revision: "test", message: world.message ?? null, files }, context);
      state = context.state.read();
      return { ...outcome, state: structuredClone(state) };
    },
  };
}`, resolveDir:process.cwd(),sourcefile:"actor-testing.ts",loader:"ts"},
  bundle:true,platform:"node",format:"esm",target:"node22",packages:"external",write:false,
}).then(result=>result.outputFiles![0]!.text);

export const serverApiDeclarations = (capabilities: readonly RunCapabilityDescriptor[] = []): string => {
  const declarations: string[] = [];
  const entries = capabilities.map((capability, index) => {
    const input = typeScriptTypesFromSchema(capability.schema, `RAgentsCapability${index}Input`);
    const output = typeScriptTypesFromSchema(capability.resultSchema, `RAgentsCapability${index}Output`);
    declarations.push(...input.declarations, ...output.declarations);
    return `${JSON.stringify(capability.id)}: { input: ${input.type}; output: ${output.type} };`;
  }).join("\n");
  return `import type { Static, TSchema } from 'typebox';
${declarations.length > 0 ? `${declarations.join("\n")}\n` : ""}export interface CapabilityContracts { ${entries} }
export interface RunContext<State> {
  readonly run: { readonly id: string };
  readonly actor: {readonly id: string; readonly handle: string};
  readonly std: RAgentsStd;
  readonly invocation: { readonly id: string; readonly kind: string };
  readonly principal: { readonly id: string; readonly kind: string };
  readonly signal: AbortSignal;
  readonly state: { read(): Readonly<State>; replace(value: State): void };
  readonly functions: {readonly [Name in keyof CapabilityContracts]: (...args: {} extends CapabilityContracts[Name]['input'] ? [input?: CapabilityContracts[Name]['input']] : [input: CapabilityContracts[Name]['input']]) => Promise<CapabilityContracts[Name]['output']>};
  log(value: unknown): void;
  throwIfAborted(): void;
  /** Ends a start of this run script with a JSON result; the host delivers it once to whoever started it. Only in onStart, onInput and onResult; outside onStart, name the start. */
  finish(result: unknown, options?: { readonly summary?: string; readonly start?: number }): void;
}
${scriptStdDeclarations}
/** Why the host queued an input for one of the program's triggers; key stays the same for one occurrence. */
export interface ActorTrigger {
  readonly reason: 'manual' | 'interval' | 'daily' | 'weekly' | 'file-change';
  readonly key: string; readonly scheduledAt: string; readonly timeZone: string;
}
export interface ActorInput {
  readonly id: string; readonly content: string; readonly artifactIds: readonly string[];
  readonly sourceEventIds: readonly string[]; readonly subscriptionId: string | null;
  readonly event: { readonly type: string; readonly eventId: string; readonly sequence: number; readonly occurredAt: string;
    readonly sourceActorId: string | null; readonly sourceActorHandle: string | null; readonly payload: {readonly text?:string; readonly [key:string]:unknown} } | null;
  readonly trigger?: ActorTrigger;
}
export interface ActorStart {
  readonly input: unknown; readonly options: Readonly<Record<string, unknown>>;
  readonly embedded: boolean; readonly startedBy: string; readonly count: number;
  /** The room this start opened, where the setup actor and everything it creates stand; null in the main room. */
  readonly room: string | null;
}
export interface ActorResult { readonly handle: string; readonly count: number; readonly result: unknown; readonly summary?: string }
export interface ActorFunction { label: string; description?: string; input: TSchema; output: TSchema; capabilities?: readonly string[]; confirmation?: string; tool?: { name: string; targets?: readonly string[]; card?: boolean } }
export interface ActorContract { state: TSchema; functions: Readonly<Record<string, ActorFunction>>; input?: {capabilities?: readonly string[]} }
export type ActorFunctions<C extends ActorContract> = { [K in keyof C['functions']]: (input: Static<C['functions'][K]['input']>, context: RunContext<Static<C['state']>>) => Static<C['functions'][K]['output']> | Promise<Static<C['functions'][K]['output']>> };
export type ActorImplementation<C extends ActorContract> = {functions: ActorFunctions<C>} & (C extends {input: unknown} ? {onInput: (input: ActorInput, context: RunContext<Static<C['state']>>) => void | Promise<void>; onStart?: (start: ActorStart, context: RunContext<Static<C['state']>>) => void | Promise<void>; onResult?: (result: ActorResult, context: RunContext<Static<C['state']>>) => void | Promise<void>} : {onInput?: never; onStart?: never; onResult?: never});
export declare function defineActor<const C extends ActorContract>(contract: C, implementation: ActorImplementation<C>): {contract:C} & ActorImplementation<C>;
export type ProgramWeekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
/** An absolute ISO time, a duration after the program first reached the wait, or the latest daily or weekday wall time since then. */
export type ProgramWait =
  | { readonly at: string }
  | { readonly afterMs: number }
  | { readonly daily: string; readonly timeZone?: string }
  | { readonly weekly: string; readonly days: readonly ProgramWeekday[]; readonly timeZone?: string };
/** A state cell: value is what this evaluation has assigned so far, set records the next assignment. */
export interface ProgramCell<T> { readonly value: T; set(value: T): void }
export interface ProgramElse { readonly else: 'preserve' | 'forget' }
/** A message the program receives; the host publishes it as a function that delivers its input to a waiting ctx.receive. */
export interface ProgramMessage { label: string; description?: string; input: TSchema; tool?: { name: string; targets?: readonly string[]; card?: boolean }; confirmation?: string }
export interface ProgramContract { capabilities?: readonly string[]; messages?: Readonly<Record<string, ProgramMessage>> }
type ProgramMessageName<C extends ProgramContract> = C extends { messages: infer M } ? keyof M & string : never;
type ProgramMessageValue<C extends ProgramContract, N> = C extends { messages: infer M } ? N extends keyof M ? M[N] extends { input: infer S extends TSchema } ? Static<S> : never : never : never;
export type ProgramReceived<T> = { readonly kind: 'message'; readonly value: T } | { readonly kind: 'timeout' };
export interface ProgramContext<C extends ProgramContract = ProgramContract> {
  readonly run: { readonly id: string };
  readonly actor: { readonly id: string; readonly handle: string };
  readonly signal: AbortSignal;
  /** The declared run functions; call them only inside ctx.step. */
  readonly functions: RunContext<{}>['functions'];
  log(value: unknown): void;
  throwIfAborted(): void;
  /** A cell at this position; name shows its current value under values in the actor state. */
  useState<T>(initial: T, name?: string): ProgramCell<T>;
  /** Like useState; create runs only when the cell is first reached. */
  useStateWith<T>(create: () => T, name?: string): ProgramCell<T>;
  /** Runs effect once; later evaluations return its stored JSON result. */
  step<T>(effect: () => T | Promise<T>): Promise<T>;
  waitUntil(wait: ProgramWait): Promise<{ readonly at: string }>;
  /** Waits for the message addressed to this receive; with timeoutMs it ends as timeout after that time. */
  receive<N extends ProgramMessageName<C>>(name: N): Promise<{ readonly kind: 'message'; readonly value: ProgramMessageValue<C, N> }>;
  receive<N extends ProgramMessageName<C>>(name: N, options: { readonly timeoutMs: number }): Promise<ProgramReceived<ProgramMessageValue<C, N>>>;
  /** Waits until the content hash of an absolute file within the read permissions differs from the one when the watch was first reached; null for a missing file. */
  watch(path: string): Promise<{ readonly hash: string | null }>;
  /** Runs body while condition holds; otherwise decides whether the branch keeps its state while the condition is false. */
  when<T>(condition: boolean, body: () => T | Promise<T>, otherwise: ProgramElse): Promise<Awaited<T> | undefined>;
  /** Runs body for every item, one after another; each key keeps its own state and a key that disappears forgets it. */
  forEach<I, T>(items: readonly I[], key: (item: I) => string, body: (item: I) => T | Promise<T>): Promise<Awaited<T>[]>;
  readonly elsePreserve: ProgramElse;
  readonly elseForget: ProgramElse;
}
export interface ProgramWaiting {
  readonly position: string; readonly kind: 'waitUntil' | 'receive' | 'watch';
  readonly message: string | null; readonly until: string | null; readonly file: { readonly path: string; readonly hash: string | null } | null;
}
/** The actor state of a state-aware program; root holds the slot tree. */
export interface ProgramState {
  readonly version?: 1; readonly revision?: string; readonly status?: 'waiting' | 'done' | 'failed' | 'blocked';
  readonly waiting?: ProgramWaiting | null; readonly wakeAt?: string | null; readonly error?: string | null;
  readonly result?: unknown; readonly values?: Readonly<Record<string, unknown>>; readonly root?: unknown; readonly next?: number;
}
export interface ProgramOutcome { readonly status: 'waiting' | 'done' | 'failed' | 'blocked'; readonly consumed: boolean; readonly needs: readonly string[]; readonly error: string | null }
export interface StateAwareProgram<C extends ProgramContract> { readonly contract: ActorContract; readonly messages?: C['messages']; evaluate(world: unknown, context: unknown): Promise<ProgramOutcome> }
/** A state-aware program: the host evaluates body completely on every wake against the state recorded per position. */
export declare function defineProgram<const C extends ProgramContract>(contract: C, body: (ctx: ProgramContext<C>) => unknown): StateAwareProgram<C>;
`;
};

let workflowSdk: Promise<{ javaScript: string; declarations: string; promptReader: string; promptDeclarations: string }> | undefined;
const workflowSource = fileURLToPath(new URL("./workflow/index.ts", import.meta.url));
const workflowSdkFiles = () => workflowSdk ??= (async () => {
  let declarations = "";
  let promptDeclarations = "";
  const promptSource = fileURLToPath(new URL("./workflow/prompt-reader.ts", import.meta.url));
  const program = ts.createProgram([workflowSource, promptSource], {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true, skipLibCheck: true, types: ["node"], typeRoots: [serverTypeRoot], declaration: true, emitDeclarationOnly: true,
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) throw new Error(diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).join("\n"));
  const emitted = program.emit(undefined, (name, content) => { if (name.endsWith("index.d.ts")) declarations = content; if (name.endsWith("prompt-reader.d.ts")) promptDeclarations = content; });
  if (emitted.emitSkipped || !declarations) throw new Error("Workflow SDK declarations could not be generated.");
  const runtime = await build({ entryPoints: [workflowSource], bundle: true, write: false, platform: "neutral", format: "esm", target: "es2022", logLevel: "silent" });
  const promptRuntime = await build({ entryPoints: [promptSource], bundle: true, write: false, platform: "node", format: "esm", target: "es2022", logLevel: "silent" });
  return { javaScript: runtime.outputFiles[0]!.text, declarations, promptReader: promptRuntime.outputFiles[0]!.text, promptDeclarations };
})();

export const installWorkflowSdk = async (directory: string): Promise<void> => {
  const target = path.join(directory, "node_modules/@ragents/workflow");
  const files = await workflowSdkFiles();
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, "package.json"), json({ name: "@ragents/workflow", private: true, type: "module", exports: { ".": { types: "./index.d.ts", default: "./index.js" }, "./prompts": { types: "./prompts.d.ts", default: "./prompts.js" } } }));
  await writeFile(path.join(target, "index.d.ts"), files.declarations);
  await writeFile(path.join(target, "index.js"), files.javaScript);
  await writeFile(path.join(target, "prompt-reader.d.ts"), files.promptDeclarations);
  await writeFile(path.join(target, "prompt-reader.js"), files.promptReader);
  await writeFile(path.join(target, "prompts.d.ts"), 'import { createPromptReader } from "./prompt-reader.js";\nexport declare const readPrompt: ReturnType<typeof createPromptReader>;\n');
  await writeFile(path.join(target, "prompts.js"), 'import { fileURLToPath } from "node:url";\nimport { createPromptReader } from "./prompt-reader.js";\nexport const readPrompt = createPromptReader(fileURLToPath(new URL("../../../", import.meta.url)));\n');
};

export const installServerSdk = async (directory: string, capabilities: readonly RunCapabilityDescriptor[] = []): Promise<void> => {
  await installWorkflowSdk(directory);
  const sdk = path.join(directory, "node_modules/@ragents/server");
  await mkdir(sdk, { recursive: true });
  const declarations = serverApiDeclarations(capabilities);
  await writeFile(path.join(sdk, "package.json"), json({ name: "@ragents/server", private: true, type: "module", exports: {
    ".": { types: "./index.d.ts", default: "./index.js" }, "./testing": { types: "./testing.d.ts", default: "./testing.js" },
  } }));
  await writeFile(path.join(sdk, "index.js"), await serverRuntime());
  await writeFile(path.join(sdk, "index.d.ts"), declarations);
  await writeFile(path.join(sdk, "testing.js"), `${await testingRuntime()}
export function createTestContext(options) { return createTestContextWithContracts(options, ${JSON.stringify(capabilities)}); }
export function createProgramTest(program, options = {}) { return createProgramTestWithContracts(program, options, ${JSON.stringify(capabilities)}); }
`);
  await writeFile(path.join(sdk, "testing.d.ts"), testingDeclarations);
};

const testingDeclarations = `import type { RunContext, CapabilityContracts, ProgramOutcome, ProgramState, StateAwareProgram } from './index.js';
type Mocks = {[Name in keyof CapabilityContracts]?: (input: CapabilityContracts[Name]['input']) => CapabilityContracts[Name]['output'] | Promise<CapabilityContracts[Name]['output']>};
type Finished = {readonly result: unknown; readonly summary?: string; readonly start?: number};
export declare function createTestContext<State>(options: {state: State; functions?: Mocks}): RunContext<State> & {readonly finished: readonly Finished[]};
/** One wake of a state-aware program: the time, an optional message for a waiting receive, and the content hashes of watched files (null for a missing file). */
export interface ProgramTestWorld { readonly now?: string; readonly message?: { readonly name: string; readonly value: unknown }; readonly files?: Readonly<Record<string, string | null>> }
export interface ProgramTest { readonly state: ProgramState; evaluate(world?: ProgramTestWorld): Promise<ProgramOutcome & { readonly state: ProgramState }> }
/** Evaluates a state-aware program like the host does, keeping its state between evaluations; now stays until a world names another. */
export declare function createProgramTest(program: StateAwareProgram<any>, options?: { functions?: Mocks; now?: string; timeZone?: string }): ProgramTest;
`;

/** The tsconfig files the host writes into a package that brings none of its own. */
const generatedConfigs = (pkg: Pick<AppPackage, "backend" | "views">): Readonly<Record<string, string>> => ({
  "tsconfig.client.json": json({ extends: "./node_modules/@ragents/client/tsconfig.json", include: (pkg.views ?? []).map(view => view.client) }),
  "tsconfig.server.json": json({ compilerOptions: {
    target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, noEmit: true,
    skipLibCheck: true, types: ["node"], lib: ["ES2022"], allowImportingTsExtensions: true,
  }, include: [...(pkg.backend ? [pkg.backend] : []), "tests/**/*.ts"] }),
  "tsconfig.json": json({ files: [], references: [{ path: "./tsconfig.client.json" }, { path: "./tsconfig.server.json" }] }),
});

export const prepareAppProject = async (directory: string): Promise<void> => {
  await prepareAppDependencies(directory);
  await installServerSdk(directory);
  const pkg = await readAppPackage(directory);
  for (const [name, content] of Object.entries(generatedConfigs(pkg))) {
    await writeFile(path.join(directory, name), content, { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
  }
};

/** What a package is, independent of the tsconfig files the host generated into it: two packages with the same identity have the same sources. */
export const packageIdentity = (files: readonly { path: string; content: string }[]): string => {
  const normalized = files.map((file) => ({ path: file.path.split(path.sep).join("/"), content: file.content }));
  const generated = generatedConfigsOf(normalized.find((file) => file.path === "package.json")?.content);
  return canonicalHash(normalized.filter((file) => generated[file.path] !== file.content).sort((left, right) => left.path.localeCompare(right.path)));
};

/** A package.json that does not parse has no generated configs; its activation reports the error. */
const generatedConfigsOf = (packageJson: string | undefined): Readonly<Record<string, string>> => {
  try {
    const pkg = (JSON.parse(packageJson ?? "{}") as { ragents?: Pick<AppPackage, "backend" | "views"> }).ragents;
    return pkg ? generatedConfigs(pkg) : {};
  } catch {
    return {};
  }
};

export const readAppPackage = async (directory: string): Promise<AppPackage> => {
  const pkg = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8")) as Record<string, unknown>;
  if (!Value.Check(appPackageSchema, pkg.ragents)) throw new Error(`package.json.ragents is invalid: ${schemaComplaints(appPackageSchema, pkg.ragents, "ragents")}`);
  if (!pkg.ragents.backend && !pkg.ragents.views?.length) throw new Error("An actor package needs a backend or at least one view.");
  const views = pkg.ragents.views ?? [];
  if (new Set(views.map((view) => view.id)).size !== views.length) throw new Error("View names must be unique.");
  return pkg.ragents;
};

export const projectSourceFiles = async (directory: string): Promise<{ path: string; content: string }[]> => {
  const files: { path: string; content: string }[] = [];
  const walk = async (relative: string): Promise<void> => {
    for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
      if (["node_modules", ".build", "dist", ".git"].includes(entry.name)) continue;
      const name = path.join(relative, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`App source files must not contain symlinks: ${name}`);
      if (entry.isDirectory()) await walk(name);
      else if (entry.isFile()) files.push({ path: name, content: await readFile(path.join(directory, name), "utf8") });
    }
  };
  await walk("");
  return files.sort((left, right) => left.path.localeCompare(right.path));
};

export const typecheckServerProject = (directory: string, backend?: string): string[] => {
  const configPath = path.join(directory, "tsconfig.server.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, directory, { noEmit: true }, configPath);
  const rootNames = [...new Set([...parsed.fileNames, ...(backend ? [path.resolve(directory, backend)] : [])])];
  const program = ts.createProgram(rootNames, parsed.options);
  const configErrors = parsed.errors.filter((diagnostic) => !(backend && diagnostic.code === 18003));
  return [...[...(config.error ? [config.error] : []), ...configErrors, ...ts.getPreEmitDiagnostics(program)].map((diagnostic) => {
    const start = diagnostic.file && diagnostic.start !== undefined ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start) : undefined;
    return `${diagnostic.file ? path.relative(directory, diagnostic.file.fileName) : "tsconfig.server.json"}${start ? `:${start.line + 1}:${start.character + 1}` : ""} TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`;
  }), ...programGuardDiagnostics(program, directory)];
};

export const compileAppBackend = async (options: {
  directory: string; backend: string; runId: string; executor: NativeTypeScriptExecutor; signal?: AbortSignal; isolated?: boolean;
}): Promise<{ contract: AppContract; javaScript: string; hash: string }> => {
  const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(15_000)]);
  const entry = path.resolve(options.directory, options.backend);
  if (!entry.startsWith(`${options.directory}${path.sep}`)) throw new Error("The backend entry lies outside the app.");
  const result = await build({
    stdin: { contents: `import actor from ${JSON.stringify(`./${options.backend}`)};
export const describe = () => {
  for (const name of Object.keys(actor.contract.functions ?? {})) if (typeof actor.functions?.[name] !== 'function') throw new Error('Missing function ' + name);
  if (Boolean(actor.contract.input) !== (typeof actor.onInput === 'function')) throw new Error('input and onInput must be present together.');
  for (const name of ['onStart', 'onResult']) if (actor[name] !== undefined && (typeof actor[name] !== 'function' || !actor.contract.input)) throw new Error(name + ' needs input and onInput.');
  return JSON.parse(JSON.stringify(actor.contract));
};
export const handle = async (request, context) => {
  if (request.kind === 'evaluate') {
    if (typeof actor.evaluate !== 'function') throw new Error('This actor is not a state-aware program.');
    return actor.evaluate(request.world, context);
  }
  if (request.kind !== 'input') {
    const handler = actor.functions[request.functionId];
    if (typeof handler !== 'function') throw new Error('Unknown actor function ' + request.functionId);
    return handler(request.input, { ...context, finish: () => { throw new Error('finish works only in onStart, onInput and onResult; a function passes the result as an input to its own actor.'); } });
  }
  if (!actor.onInput) throw new Error('This actor does not process input.');
  const finishes = [];
  const finish = (result, options = {}) => {
    const start = options.start ?? request.start?.count;
    if (!Number.isInteger(start)) throw new Error('finish needs options.start, the count of the start it ends, outside onStart.');
    finishes.push({ start, result: result === undefined ? null : result, ...(options.summary === undefined ? {} : { summary: options.summary }) });
  };
  const handlerContext = { ...context, finish };
  if (request.result && actor.onResult) await actor.onResult(request.result, handlerContext);
  else if (request.start && actor.onStart) await actor.onStart(request.start, handlerContext);
  else await actor.onInput(request.input, handlerContext);
  return { finishes };
};`, resolveDir: options.directory, sourcefile: "actor-entry.ts", loader: "ts" },
    absWorkingDir: options.directory, platform: "node", format: "esm", target: "node22", bundle: true, packages: "external", write: false, logLevel: "silent",
  });
  options.signal?.throwIfAborted();
  const javaScript = result.outputFiles![0]!.text;
  const described = await options.executor.execute({
    program: { entry: "server.mjs", files: [{ fileName: "server.mjs", text: javaScript }], exportName: "describe" },
    input: {}, state: {}, cwd: options.directory, ...(options.isolated ? { isolated: true } : {}),
    context: { runId: options.runId, invocationId: "app-contract", invocationKind: "tool", principal: { id: "app-build", kind: "service" }, capabilities: [] },
  }, { signal, call: async () => { throw new Error("Run calls are not available while loading the app contract."); }, log: () => undefined });
  if (!Value.Check(appContractSchema, described.result)) throw new Error(`The backend export needs defineActor({state, functions, input?}, {functions, onInput?}) with valid action contracts: ${schemaComplaints(appContractSchema, described.result, "contract")}`);
  return { contract: described.result, javaScript, hash: canonicalHash({ javaScript }) };
};
