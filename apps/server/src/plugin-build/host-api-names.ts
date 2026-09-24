import { execFileSync } from "node:child_process";
import path from "node:path";
import vm from "node:vm";
import { build } from "esbuild";
import ts from "typescript";
import { HOST_API_VERSION, LIBRARY, hostApi, hostApiModules, type HostApiHalf } from "../host-api.js";
import { HOST_API_RECORD_FILE, hostRoot, type HostApiRecord } from "../host-version.js";

export { readHostApiRecord, type HostApiRecord } from "../host-version.js";

export const hostApiRecordFile = (root = hostRoot()): string => path.join(root, HOST_API_RECORD_FILE);

/** Where the host itself resolves a module of each half: its tsconfig and an importer inside the host. */
export const HALF_PLACES: Readonly<Record<HostApiHalf, { readonly app: string; readonly config: string; readonly importer: string }>> = {
  server: { app: "apps/server", config: "apps/server/tsconfig.json", importer: "apps/server/src/main.ts" },
  web: { app: "apps/web", config: "apps/web/tsconfig.json", importer: "apps/web/src/main.tsx" },
};

const parsedConfig = (file: string): ts.ParsedCommandLine => {
  const parsed = ts.getParsedCommandLineOfConfigFile(file, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, " "));
    },
  });
  if (!parsed) throw new Error(`${file} ist keine gültige tsconfig`);
  return parsed;
};

interface TypeView {
  readonly names: readonly string[];
  /** Resolved through node_modules, so the implementation may be JavaScript whose types promise more than it has. */
  readonly library: boolean;
}

/** Value exports as TypeScript sees them; a module with export= also has a default import, a host declaration file has no values at all. */
export const typeViews = (half: HostApiHalf, root = hostRoot()): ReadonlyMap<string, TypeView> => {
  const place = HALF_PLACES[half];
  const options = parsedConfig(path.join(root, place.config)).options;
  const importer = path.join(root, place.importer);
  const resolved = hostApiModules(half).map((specifier) => {
    const module = ts.resolveModuleName(specifier, importer, options, ts.sys).resolvedModule;
    if (!module) throw new Error(`${specifier} ist für die ${half}-Hälfte nicht auflösbar`);
    return { specifier, module };
  });
  const probe = path.join(path.dirname(importer), "__host-api-probe__.ts");
  const probeText = resolved.map(({ specifier }, index) => `import * as module${index} from ${JSON.stringify(specifier)};`).join("\n");
  const compilerOptions = { ...options, noEmit: true };
  const host = ts.createCompilerHost(compilerOptions);
  const readSource = host.getSourceFile.bind(host);
  host.getSourceFile = (file, language, onError, create) =>
    path.resolve(file) === probe ? ts.createSourceFile(file, probeText, language, true) : readSource(file, language, onError, create);
  const program = ts.createProgram({ rootNames: [probe], options: compilerOptions, host });
  const checker = program.getTypeChecker();
  const imports = program.getSourceFile(probe)!.statements.filter(ts.isImportDeclaration);
  return new Map(resolved.map(({ specifier, module }, index) => {
    const symbol = checker.getSymbolAtLocation(imports[index]!.moduleSpecifier);
    if (!symbol) throw new Error(`${specifier}: ${module.resolvedFileName} hat kein Modulsymbol`);
    const values = checker.getExportsOfModule(symbol).filter((exported) => {
      const target = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      return (target.flags & ts.SymbolFlags.Value) !== 0;
    }).map((exported) => exported.name);
    const names = symbol.exports?.has(ts.InternalSymbolName.ExportEquals) ? [...values, "default"] : values;
    const library = module.isExternalLibraryImport === true;
    const declarationOnly = !library && /\.d\.[cm]?ts$/.test(module.resolvedFileName);
    return [specifier, { names: declarationOnly ? [] : [...new Set(names)].sort(), library }];
  }));
};

const RUNTIME_SCRIPT = `
const [mode, list] = process.argv.slice(1);
const found = {};
for (const specifier of JSON.parse(list)) {
  const location = import.meta.resolve(specifier);
  if (/\\.(ts|tsx|mts|cts)$/.test(location)) continue;
  found[specifier] = mode === "import" ? Object.keys(await import(specifier)) : [];
}
process.stdout.write(JSON.stringify(found));
`;

/** Library modules whose implementation is JavaScript, resolved from the host app of the half; with import, their names as Node sees them. */
const javaScriptModules = (half: HostApiHalf, specifiers: readonly string[], mode: "import" | "resolve", root: string): Readonly<Record<string, readonly string[]>> =>
  JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", RUNTIME_SCRIPT, mode, JSON.stringify(specifiers)], {
    cwd: path.join(root, HALF_PLACES[half].app),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  })) as Record<string, readonly string[]>;

/** The register of the web half: every listed module as a namespace, keyed by its specifier. */
export const webRegisterSource = (specifiers: readonly string[] = hostApiModules("web")): string => [
  ...specifiers.map((specifier, index) => `import * as module${index} from ${JSON.stringify(specifier)};`),
  `export const hostModules = {`,
  ...specifiers.map((specifier, index) => `  ${JSON.stringify(specifier)}: module${index},`),
  `};`,
].join("\n");

/** Bundles the register the way a production browser build does, with the host's own resolution. */
export const bundleWebRegister = async (specifiers: readonly string[], format: "cjs" | "iife", root = hostRoot()): Promise<string> => {
  const result = await build({
    stdin: { contents: webRegisterSource(specifiers), resolveDir: path.join(root, "apps/web/src"), loader: "ts", sourcefile: "host-modules.ts" },
    bundle: true,
    write: false,
    platform: "browser",
    format,
    globalName: format === "iife" ? "__ragentsRegister" : undefined,
    target: "es2022",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": JSON.stringify("production"), "import.meta.hot": "undefined" },
    loader: { ".css": "empty", ".svg": "empty", ".png": "empty", ".woff2": "empty" },
    logLevel: "silent",
  });
  return result.outputFiles[0]!.text;
};

/** Names of library modules as a browser bundle sees them, evaluated without a page. */
const webRuntimeNames = async (specifiers: readonly string[], root: string): Promise<Readonly<Record<string, readonly string[]>>> => {
  const code = await bundleWebRegister(specifiers, "cjs", root);
  const module = { exports: {} as { hostModules?: Record<string, object> } };
  vm.runInNewContext(code, { module, exports: module.exports, console, setTimeout, clearTimeout, queueMicrotask, TextEncoder, TextDecoder, URL });
  const modules = module.exports.hostModules;
  if (!modules) throw new Error("Das Register der Web-Hälfte liefert keine Module");
  return Object.fromEntries(Object.entries(modules).map(([specifier, namespace]) => [specifier, Object.keys(namespace)]));
};

/** A host module names exactly what it offers, each name a value it exports; a library counts whole. */
const listedNames = (half: HostApiHalf, specifier: string, view: TypeView): readonly string[] | typeof LIBRARY => {
  const listed = hostApi[half][specifier]!;
  const hostCode = specifier.startsWith("@ragents/");
  if (listed === LIBRARY) {
    if (hostCode) throw new Error(`${specifier} ist Code des Hosts, keine Bibliothek; host-api.ts nennt seine Namen einzeln`);
    return LIBRARY;
  }
  if (!hostCode) throw new Error(`${specifier} ist eine Bibliothek; host-api.ts gibt sie ganz frei`);
  const missing = listed.filter((name) => !view.names.includes(name));
  if (missing.length > 0) throw new Error(`host-api.ts nennt für ${specifier} ${missing.join(", ")}, das Modul exportiert es nicht als Wert`);
  return [...listed].sort();
};

/** The value names per module: the list of a host module, for a library its types narrowed to what it really has at runtime. */
export const hostApiNames = async (root = hostRoot()): Promise<HostApiRecord> => {
  const half = async (which: HostApiHalf): Promise<Record<string, readonly string[]>> => {
    const views = typeViews(which, root);
    const candidates = [...views].filter(([, view]) => view.library).map(([specifier]) => specifier);
    const runtime = which === "server"
      ? javaScriptModules("server", candidates, "import", root)
      : await webRuntimeNames(Object.keys(javaScriptModules("web", candidates, "resolve", root)), root);
    return Object.fromEntries([...views].map(([specifier, view]) => {
      const listed = listedNames(which, specifier, view);
      if (listed !== LIBRARY) return [specifier, listed];
      const present = runtime[specifier];
      return [specifier, present ? view.names.filter((name) => present.includes(name)) : view.names];
    }));
  };
  return { version: HOST_API_VERSION, server: await half("server"), web: await half("web") };
};

export const hostApiRecordText = (record: HostApiRecord): string => `${JSON.stringify(record, null, 2)}\n`;

export interface HostApiChange {
  readonly half: HostApiHalf;
  readonly specifier: string;
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

/** What differs between two records, per module; a module that disappeared lists all its names as removed. */
export const hostApiChanges = (stored: HostApiRecord, current: HostApiRecord): readonly HostApiChange[] =>
  (["server", "web"] as const).flatMap((half) => {
    const specifiers = [...new Set([...Object.keys(stored[half]), ...Object.keys(current[half])])].sort();
    return specifiers.flatMap((specifier) => {
      const before = stored[half][specifier] ?? [];
      const after = current[half][specifier] ?? [];
      const added = after.filter((name) => !before.includes(name));
      const removed = before.filter((name) => !after.includes(name));
      return added.length > 0 || removed.length > 0 ? [{ half, specifier, added, removed }] : [];
    });
  });

export const describeHostApiChange = (change: HostApiChange): string =>
  `${change.half} ${change.specifier}: ${[
    ...change.added.map((name) => `+${name}`),
    ...change.removed.map((name) => `-${name}`),
  ].join(" ")}`;
