import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Message } from "esbuild";
import ts from "typescript";
import { canonicalTypeScriptBuildContract, typeScriptTypeFromSchema, type VirtualTypeScriptDiagnostic } from "@ragents/engine";
import { installWorkflowSdk } from "./app-project.js";
import { readClientUiContractFiles } from "./client-contracts.js";

export interface ClientActionContract {
  id: string;
  inputSchema: object;
  resultSchema: object;
}

export interface ClientContracts {
  stateSchema: object;
  actions: readonly ClientActionContract[];
}

export interface ClientProjectRequest extends ClientContracts {
  directory: string;
  entryPoint: string;
}

const webRequire = createRequire(new URL("../../../../web/package.json", import.meta.url));
const packageRoot = (id: string): string => path.dirname(webRequire.resolve(`${id}/package.json`));
const uiSource = fileURLToPath(new URL("../../../../web/src/actor-programs/client-ui/index.tsx", import.meta.url));

const actionMap = (actions: readonly ClientActionContract[]): string => {
  const seen = new Set<string>();
  const fields = [...actions]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((action) => {
      if (seen.has(action.id)) throw new Error(`App-Aktion ${action.id} ist doppelt deklariert.`);
      seen.add(action.id);
      return [
        `  readonly ${JSON.stringify(action.id)}: {`,
        `    readonly input: ${typeScriptTypeFromSchema(action.inputSchema)};`,
        `    readonly output: ${typeScriptTypeFromSchema(action.resultSchema)};`,
        "  };",
      ].join("\n");
    });
  return fields.length > 0 ? `{\n${fields.join("\n")}\n}` : "{}";
};

const clientTypeDeclarations = (stateType: string, actionsType: string): string => `
import type { ChatConnection } from "./ui";
export type AppState = ${stateType};
export type AppActions = ${actionsType};
export interface AppCapabilities<Actions> {
  list(): ReadonlyArray<keyof Actions & string>;
  call<Name extends keyof Actions & string>(
    name: Name,
    input: Actions[Name] extends { readonly input: infer Input } ? Input : never,
  ): Promise<Actions[Name] extends { readonly output: infer Output } ? Output : never>;
}
export interface AppStateView<State> {
  read(): Readonly<State>;
  subscribe(listener: (state: Readonly<State>) => void): () => void;
}
export interface AppContext<State, Actions> {
  readonly ready: Promise<void>;
  readonly run: { readonly id: string };
  readonly actor: { readonly id: string; readonly handle: string };
  readonly principal: { readonly id: string; readonly kind: "operator" };
  readonly state: AppStateView<State>;
  readonly chat: ChatConnection;
  readonly capabilities: AppCapabilities<Actions>;
}
export declare const context: AppContext<AppState, AppActions>;
export declare function useAppState(): Readonly<AppState>;
`.trimStart();

export const clientDeclarations = (request: ClientContracts): string =>
  clientTypeDeclarations(typeScriptTypeFromSchema(request.stateSchema), actionMap(request.actions));

export const clientApiDeclarations = (): string => clientTypeDeclarations("Record<string, unknown>", "{}");

export const clientSdkSource = `import { useSyncExternalStore } from "react";
export const context = globalThis.__ragentsAppContext;
if (!context) throw new Error("Die Host-Bridge der Actor-Ansicht fehlt.");
export const useAppState = () => useSyncExternalStore(context.state.subscribe, context.state.read, context.state.read);
`;

export const clientCompilerConfig = {
  compilerOptions: {
    target: "ES2022", module: "ESNext", moduleResolution: "Bundler", jsx: "react-jsx",
    lib: ["ES2022", "DOM", "DOM.Iterable"], strict: true, skipLibCheck: true,
    esModuleInterop: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, types: [], noEmit: true,
  },
};

export const installClientSdk = async (directory: string, contracts: ClientContracts): Promise<void> => {
  await installWorkflowSdk(directory);
  const target = path.join(directory, "node_modules/@ragents/client");
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ name: "@ragents/client", version: "0.0.0", type: "module",
      exports: { ".": { types: "./index.d.ts", default: "./index.js" }, "./ui": { types: "./ui.d.ts", default: "./ui.js" } } }, null, 2),
    "tsconfig.json": JSON.stringify(clientCompilerConfig, null, 2),
    "index.d.ts": clientDeclarations(contracts),
    "index.js": clientSdkSource,
    "ui.d.ts": 'export * from "./contracts/apps/web/src/actor-programs/client-ui/contracts";\n',
    "ui.js": `export * from ${JSON.stringify(uiSource)};\n`,
    ...Object.fromEntries(Object.entries(readClientUiContractFiles()).map(([name, text]) => [`contracts/${name}`, text])),
  };
  await Promise.all(Object.entries(files).map(async ([name, text]) => {
    const filename = path.join(target, name);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, text);
  }));
};

const diagnosticFrom = (diagnostic: ts.Diagnostic, directory: string): VirtualTypeScriptDiagnostic => {
  const result: VirtualTypeScriptDiagnostic = {
    code: diagnostic.code,
    category: diagnostic.category === ts.DiagnosticCategory.Error ? "error" : diagnostic.category === ts.DiagnosticCategory.Warning ? "warning" : "message",
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    ...(diagnostic.file ? { fileName: path.relative(directory, diagnostic.file.fileName).replaceAll(path.sep, "/") } : {}),
  };
  if (!diagnostic.file || diagnostic.start === undefined) return result;
  const start = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  const end = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start + (diagnostic.length ?? 0));
  return { ...result, start: { line: start.line + 1, column: start.character + 1 }, end: { line: end.line + 1, column: end.character + 1 } };
};

const buildDiagnostic = (message: Message): VirtualTypeScriptDiagnostic => ({
  code: 0, category: "error", message: message.text,
  ...(message.location ? { fileName: message.location.file, start: { line: message.location.line, column: message.location.column + 1 } } : {}),
});

export const compileClientProject = async (request: ClientProjectRequest, signal?: AbortSignal) => {
  signal?.throwIfAborted();
  const directory = await realpath(request.directory);
  const declarations = clientDeclarations(request);
  const installed = await readFile(path.join(directory, "node_modules/@ragents/client/index.d.ts"), "utf8");
  if (installed !== declarations) throw new Error("Die Client-SDK-Typen sind nicht aktuell. Das Actor-Projekt muss neu vorbereitet werden.");
  const configPath = path.join(directory, "tsconfig.client.json");
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
  const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, directory, {}, configPath);
  const program = ts.createProgram({ rootNames: [...new Set([path.resolve(directory, request.entryPoint), ...config.fileNames])], options: config.options });
  const diagnostics = [...config.errors, ...ts.getPreEmitDiagnostics(program)]
    .map((diagnostic) => diagnosticFrom(diagnostic, directory));
  signal?.throwIfAborted();
  let javaScript = "";
  if (!diagnostics.some((diagnostic) => diagnostic.category === "error")) {
    try {
      const result = await build({
        absWorkingDir: directory, entryPoints: [request.entryPoint], bundle: true, write: false,
        platform: "browser", format: "esm", target: "es2022", jsx: "automatic", tsconfig: configPath,
        alias: { react: packageRoot("react"), "react-dom": packageRoot("react-dom") },
        define: { "process.env.NODE_ENV": '"production"' }, legalComments: "none", logLevel: "silent",
        minify: true,
      });
      const output = result.outputFiles.find((file) => file.path.endsWith(".js") || file.path === "<stdout>");
      if (!output) throw new Error("Der Client-Build hat kein JavaScript erzeugt.");
      javaScript = output.text;
    } catch (cause) {
      if (cause && typeof cause === "object" && "errors" in cause && Array.isArray(cause.errors)) {
        diagnostics.push(...(cause.errors as Message[]).map(buildDiagnostic));
      } else throw cause;
    }
  }
  signal?.throwIfAborted();
  const compilationHash = createHash("sha256").update(canonicalTypeScriptBuildContract({
    stateSchema: request.stateSchema, actions: request.actions, declarations, javaScript,
    typescript: ts.version, config: { ...config.options, configFilePath: undefined },
    sources: program.getSourceFiles().map((file) => ({ path: path.relative(directory, file.fileName), text: file.text })),
  })).digest("hex");
  return { valid: !diagnostics.some((diagnostic) => diagnostic.category === "error"), diagnostics, declarations, javaScript, compilationHash };
};
