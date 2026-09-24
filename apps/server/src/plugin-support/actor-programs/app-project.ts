import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, realpath, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import ts from "typescript";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { canonicalHash, typeScriptTypesFromSchema, type NativeTypeScriptExecutor, type RunCapabilityDescriptor, scriptStdDeclarations } from "@ragents/engine";
import { runtimeLibraries, webRuntimeLibraries } from "./runtime-libraries.js";

const webRequire = createRequire(new URL("../../../../web/package.json", import.meta.url));
const rootRequire = createRequire(new URL("../../../../../package.json", import.meta.url));
const serverRequire = createRequire(new URL("../../../package.json", import.meta.url));
const serverTypeRoot = fileURLToPath(new URL("../../../node_modules/@types", import.meta.url));
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
    throw new Error(`Das installierte Paket ${name} besitzt keine Paketmetadaten.`);
  }
};
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const link = async (source: string, target: string): Promise<void> => {
  await mkdir(path.dirname(target), { recursive: true });
  await symlink(source, target).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
    if (await realpath(target) !== await realpath(source)) throw new Error(`Die vorbereitete Bibliothek ${target} hat einen anderen Ursprung.`);
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
}, { additionalProperties: false });
export const appContractSchema = Type.Object({
  state: schema, functions: Type.Record(Type.String(), actionSchema),
  input: Type.Optional(Type.Object({ capabilities: Type.Optional(Type.Array(Type.String(), { uniqueItems: true })) }, { additionalProperties: false })),
}, { additionalProperties: false });
export type AppContract = Static<typeof appContractSchema>;
export const appPackageSchema = Type.Object({
  title: Type.String({ minLength: 1 }), description: Type.Optional(Type.String()), backend: Type.Optional(Type.String({ minLength: 1 })),
  views: Type.Optional(Type.Array(Type.Object({
    id: Type.String({ pattern: "^[a-z][a-z0-9-]{0,63}$" }), title: Type.Optional(Type.String({ minLength: 1 })),
    client: Type.String({ minLength: 1 }), styles: Type.Optional(Type.String()),
  }, { additionalProperties: false }))),
}, { additionalProperties: false });
export type AppPackage = Static<typeof appPackageSchema>;

const sdkRuntime = `export const defineActor = (contract, implementation) => ({ contract, ...implementation });\n`;
let testingBundle: Promise<string> | undefined;
const testingRuntime = (): Promise<string> => testingBundle ??= build({
  stdin: {contents: `
import {createRunContext} from ${JSON.stringify(fileURLToPath(new URL("../../../../../packages/ragents/src/typescript/run-context.ts",import.meta.url)))};
import {assertJsonValue} from ${JSON.stringify(fileURLToPath(new URL("../../../../../packages/ragents/src/domain/json.ts",import.meta.url)))};
import {createScriptStd} from ${JSON.stringify(fileURLToPath(new URL("../../../../../packages/ragents/src/script/std.ts",import.meta.url)))};
import {Value} from "typebox/value";
export function createTestContextWithContracts(options, contracts) {
  let state = structuredClone(options.state);
  const controller = new AbortController();
  const statePort = {read:()=>structuredClone(state),replace:value=>{state=structuredClone(value);}};
  const declared = new Map(contracts.map(contract=>[contract.id,contract]));
  for (const name of Object.keys(options.functions ?? {})) if (!declared.has(name)) throw new Error("Unbekannte Testfunktion "+name);
  const capabilities = {descriptors:()=>contracts,call:async(name,input)=>{
    const contract=declared.get(name);
    const call=options.functions?.[name];
    if(!call)throw new Error("Im Test fehlt die Funktion "+name);
    if(!Value.Check(contract.schema,input))throw new Error("Testeingabe verletzt den Vertrag von "+name);
    const result=await call(input);
    assertJsonValue(result,"Testantwort von "+name);
    if(!Value.Check(contract.resultSchema,result))throw new Error("Testantwort verletzt den Vertrag von "+name);
    return result;
  }};
  return {...createRunContext({runId:"test",invocationId:"test",invocationKind:"tool",principal:{id:"test",kind:"service"},state:statePort,capabilities,log:()=>{},signal:controller.signal}),
    actor:{id:"test-actor",handle:"test"},std:createScriptStd({turnStartedAt:"2026-01-01T00:00:00.000Z",idPrefix:"test",state:statePort,capabilities})};
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
}
${scriptStdDeclarations}
export interface ActorInput {
  readonly id: string; readonly content: string; readonly artifactIds: readonly string[];
  readonly sourceEventIds: readonly string[]; readonly subscriptionId: string | null;
  readonly event: { readonly type: string; readonly eventId: string; readonly sequence: number; readonly occurredAt: string;
    readonly sourceActorId: string | null; readonly sourceActorHandle: string | null; readonly payload: {readonly text?:string; readonly [key:string]:unknown} } | null;
}
export interface ActorFunction { label: string; description?: string; input: TSchema; output: TSchema; capabilities?: readonly string[]; confirmation?: string; tool?: { name: string; targets?: readonly string[]; card?: boolean } }
export interface ActorContract { state: TSchema; functions: Readonly<Record<string, ActorFunction>>; input?: {capabilities?: readonly string[]} }
export type ActorFunctions<C extends ActorContract> = { [K in keyof C['functions']]: (input: Static<C['functions'][K]['input']>, context: RunContext<Static<C['state']>>) => Static<C['functions'][K]['output']> | Promise<Static<C['functions'][K]['output']>> };
export type ActorImplementation<C extends ActorContract> = {functions: ActorFunctions<C>} & (C extends {input: unknown} ? {onInput: (input: ActorInput, context: RunContext<Static<C['state']>>) => void | Promise<void>} : {onInput?: never});
export declare function defineActor<const C extends ActorContract>(contract: C, implementation: ActorImplementation<C>): {contract:C} & ActorImplementation<C>;
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
  if (emitted.emitSkipped || !declarations) throw new Error("Workflow-SDK-Deklarationen konnten nicht erzeugt werden.");
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
  await writeFile(path.join(target, "prompts.js"), `import { createPromptReader } from "./prompt-reader.js";\nexport const readPrompt = createPromptReader(${JSON.stringify(directory)});\n`);
};

export const installServerSdk = async (directory: string, capabilities: readonly RunCapabilityDescriptor[] = []): Promise<void> => {
  await installWorkflowSdk(directory);
  const sdk = path.join(directory, "node_modules/@ragents/server");
  await mkdir(sdk, { recursive: true });
  const declarations = serverApiDeclarations(capabilities);
  await writeFile(path.join(sdk, "package.json"), json({ name: "@ragents/server", private: true, type: "module", exports: {
    ".": { types: "./index.d.ts", default: "./index.js" }, "./testing": { types: "./testing.d.ts", default: "./testing.js" },
  } }));
  await writeFile(path.join(sdk, "index.js"), sdkRuntime);
  await writeFile(path.join(sdk, "index.d.ts"), declarations);
  await writeFile(path.join(sdk, "testing.js"), (await testingRuntime()) + `\nexport function createTestContext(options) { return createTestContextWithContracts(options, ${JSON.stringify(capabilities)}); }\n`);
  await writeFile(path.join(sdk, "testing.d.ts"), "import type { RunContext, CapabilityContracts } from './index.js';\ntype Mocks = {[Name in keyof CapabilityContracts]?: (input: CapabilityContracts[Name]['input']) => CapabilityContracts[Name]['output'] | Promise<CapabilityContracts[Name]['output']>};\nexport declare function createTestContext<State>(options: {state: State; functions?: Mocks}): RunContext<State>;\n");
};

export const prepareAppProject = async (directory: string): Promise<void> => {
  await prepareAppDependencies(directory);
  await installServerSdk(directory);
  const pkg = await readAppPackage(directory);
  const writeConfig = async (name: string, value: unknown): Promise<void> => {
    await writeFile(path.join(directory, name), json(value), { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
  };
  await writeConfig("tsconfig.client.json", { extends: "./node_modules/@ragents/client/tsconfig.json", include: (pkg.views ?? []).map(view => view.client) });
  await writeConfig("tsconfig.server.json", { compilerOptions: {
    target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, noEmit: true,
    skipLibCheck: true, types: ["node"], lib: ["ES2022"], allowImportingTsExtensions: true,
  }, include: [...(pkg.backend ? [pkg.backend] : []), "tests/**/*.ts"] });
  await writeConfig("tsconfig.json", { files: [], references: [{ path: "./tsconfig.client.json" }, { path: "./tsconfig.server.json" }] });
};

export const readAppPackage = async (directory: string): Promise<AppPackage> => {
  const pkg = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8")) as Record<string, unknown>;
  if (!Value.Check(appPackageSchema, pkg.ragents)) throw new Error("package.json.ragents braucht title und gültige backend/views-Angaben.");
  if (!pkg.ragents.backend && !pkg.ragents.views?.length) throw new Error("Ein Actor-Paket braucht ein Backend oder mindestens eine Ansicht.");
  const views = pkg.ragents.views ?? [];
  if (new Set(views.map((view) => view.id)).size !== views.length) throw new Error("Ansichtsnamen müssen eindeutig sein.");
  return pkg.ragents;
};

export const projectSourceFiles = async (directory: string): Promise<{ path: string; content: string }[]> => {
  const files: { path: string; content: string }[] = [];
  const walk = async (relative: string): Promise<void> => {
    for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
      if (["node_modules", ".build", "dist", ".git"].includes(entry.name)) continue;
      const name = path.join(relative, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`App-Quelldateien dürfen keine Symlinks enthalten: ${name}`);
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
  return [...(config.error ? [config.error] : []), ...configErrors, ...ts.getPreEmitDiagnostics(program)].map((diagnostic) => {
    const start = diagnostic.file && diagnostic.start !== undefined ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start) : undefined;
    return `${diagnostic.file ? path.relative(directory, diagnostic.file.fileName) : "tsconfig.server.json"}${start ? `:${start.line + 1}:${start.character + 1}` : ""} TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`;
  });
};

export const compileAppBackend = async (options: {
  directory: string; backend: string; runId: string; executor: NativeTypeScriptExecutor; signal?: AbortSignal;
}): Promise<{ contract: AppContract; javaScript: string; hash: string }> => {
  const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(15_000)]);
  const entry = path.resolve(options.directory, options.backend);
  if (!entry.startsWith(`${options.directory}${path.sep}`)) throw new Error("Der Backend-Einstieg liegt außerhalb der App.");
  const result = await build({
    stdin: { contents: `import actor from ${JSON.stringify(`./${options.backend}`)};
export const describe = () => {
  for (const name of Object.keys(actor.contract.functions ?? {})) if (typeof actor.functions?.[name] !== 'function') throw new Error('Fehlende Funktion ' + name);
  if (Boolean(actor.contract.input) !== (typeof actor.onInput === 'function')) throw new Error('input und onInput müssen gemeinsam vorhanden sein.');
  return JSON.parse(JSON.stringify(actor.contract));
};
export const handle = (request, context) => {
  if (request.kind === 'input') { if (!actor.onInput) throw new Error('Dieser Actor verarbeitet keine Eingaben.'); return actor.onInput(request.input, context); }
  const handler = actor.functions[request.functionId];
  if (typeof handler !== 'function') throw new Error('Unbekannte Actor-Funktion ' + request.functionId);
  return handler(request.input, context);
};`, resolveDir: options.directory, sourcefile: "actor-entry.ts", loader: "ts" },
    absWorkingDir: options.directory, platform: "node", format: "esm", target: "node22", bundle: true, packages: "external", write: false,
  });
  options.signal?.throwIfAborted();
  const javaScript = result.outputFiles![0]!.text;
  const described = await options.executor.execute({
    program: { entry: "server.mjs", files: [{ fileName: "server.mjs", text: javaScript }], exportName: "describe" },
    input: {}, state: {}, cwd: options.directory,
    context: { runId: options.runId, invocationId: "app-contract", invocationKind: "tool", principal: { id: "app-build", kind: "service" }, capabilities: [] },
  }, { signal, call: async () => { throw new Error("Beim Laden des App-Vertrags sind Run-Aufrufe nicht verfügbar."); }, log: () => undefined });
  if (!Value.Check(appContractSchema, described.result)) throw new Error("Der Backend-Export braucht defineActor({state, functions, input?}, {functions, onInput?}) mit gültigen Aktionsverträgen.");
  return { contract: described.result, javaScript, hash: canonicalHash({ javaScript }) };
};
