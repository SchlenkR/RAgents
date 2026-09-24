import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync, watch, type FSWatcher } from "node:fs";
import { mkdir, rm, writeFile, copyFile } from "node:fs/promises";
import { isBuiltin } from "node:module";
import path from "node:path";
import { Scanner } from "@tailwindcss/oxide";
import { build as esbuild, type Message, type Metafile, type OutputFile, type PartialMessage, type Plugin } from "esbuild";
import ts from "typescript";
import { installFolder, withLock } from "../folder-install.js";
import { HOST_API_VERSION, HOST_MODULES_GLOBAL, LIBRARY, hostApi, hostOnly, providedByHost, type HostApiHalf } from "../host-api.js";
import { checkedHostApiRecord, hostRoot, type HostApiRecord } from "../host-version.js";
import {
  BUNDLE_FORMAT,
  BUNDLE_MANIFEST_FILE,
  bundleStand,
  sourceStandOf,
  type BundleManifest,
  type HostNames,
} from "../profile/bundle-manifest.js";
import {
  exportOfFile,
  owningPluginFolder,
  pluginCatalog,
  readPluginSource,
  sourceFileOf,
  type PluginSource,
} from "./plugin-description.js";
import { typecheckPlugins } from "./typecheck.js";

export type PluginBuildOutcome =
  | { readonly kind: "built"; readonly id: string; readonly bundle: string; readonly manifest: BundleManifest; readonly milliseconds: number }
  | { readonly kind: "failed"; readonly id: string; readonly source: string; readonly problems: readonly string[] };

export interface PluginBuildOptions {
  readonly out: string;
  readonly typecheck: boolean;
  readonly root?: string;
  /** Leaves every bundle alone whose manifest still matches its sources, the host inputs and its own files. */
  readonly onlyOutdated?: boolean;
}

const DEFAULT_ASSET_FOLDERS = ["skills", "prompts", "run-scripts"] as const;
const SKIPPED_ASSET_FILES = new Set([".DS_Store"]);
const WEB_FILE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".avif", ".ico", ".woff", ".woff2", ".ttf", ".otf"];
const CODE_EXTENSION = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const LIBRARY_LOCATIONS: readonly (readonly [RegExp, string])[] = [
  [/\bimport\.meta\.url\b/, "import.meta.url"],
  [/\b__dirname\b/, "__dirname"],
  [/\b__filename\b/, "__filename"],
  [/\bcreateRequire\b/, "createRequire"],
  [/\brequire\.resolve\b/, "require.resolve"],
];
const PLATFORM_PACKAGE = /(^|[-/@.])(darwin|linux|win32|freebsd|openbsd|android|sunos|aix)([-/.]|$)/;
const ENTRY_NAMESPACE = "ragents-entry";
const HOST_NAMESPACE = "ragents-host";
const HOST_VALUE_NAMESPACE = "ragents-host-value";
const HOST_READ_NAMESPACE = "ragents-host-read";
const PASS = "ragentsPass";
/** Lets bundled CommonJS libraries load Node modules with require; ESM output has no require of its own. */
const SERVER_BANNER = `import { createRequire as __ragentsCreateRequire } from "node:module";\nconst require = __ragentsCreateRequire(import.meta.url);`;
const LOCK_FILE = ".build.lock";

/** Files a bundle carries besides its code: the convention folders, root templates and what the description adds. */
export const assetsOf = (source: PluginSource): readonly string[] => {
  const conventional = [
    ...DEFAULT_ASSET_FOLDERS.filter((name) => statSync(path.join(source.folder, name), { throwIfNoEntry: false })?.isDirectory()),
    ...readdirSync(source.folder).filter((name) => name.endsWith(".hbs")).sort(),
  ];
  return [...new Set([...conventional, ...source.description.assets])];
};

const coveredByAssets = (assets: readonly string[], name: string): boolean =>
  assets.some((asset) => name === asset || name.startsWith(`${asset}/`));

const exportOutput = (half: HostApiHalf, name: string): string => `${half}/exports/${name}.js`;

const identifier = /^[A-Za-z_$][\w$]*$/;

const valuePath = (specifier: string, name: string): string => `${specifier}#${name}`;

/** An ESM module with the fixed export list of a host module; each name comes from its own module, so esbuild keeps exactly the used ones. */
const hostModuleShim = (specifier: string, names: readonly string[]): string => names.map((name) =>
  `export { default as ${identifier.test(name) ? name : JSON.stringify(name)} } from ${JSON.stringify(`${HOST_VALUE_NAMESPACE}:${valuePath(specifier, name)}`)};`).join("\n");

/** Reads one value from the register of the host web; a missing module or name is an error with its cause, never undefined. */
const HOST_READ_SOURCE = [
  `export const read = (specifier, name) => {`,
  `  const module = globalThis[${JSON.stringify(HOST_MODULES_GLOBAL)}]?.[specifier];`,
  `  if (module === undefined) throw new Error(\`Der Host stellt \${specifier} nicht bereit\`);`,
  `  if (!(name in module)) throw new Error(\`Der Host stellt \${name} aus \${specifier} nicht bereit; das Bundle ist gegen einen neueren Host gebaut\`);`,
  `  return module[name];`,
  `};`,
].join("\n");

const hostValueSource = (specifier: string, name: string): string =>
  `import { read } from ${JSON.stringify(`${HOST_READ_NAMESPACE}:read`)};\nexport default read(${JSON.stringify(specifier)}, ${JSON.stringify(name)});\n`;

const isLibrary = (half: HostApiHalf, specifier: string): boolean => hostApi[half][normalizedSpecifier(specifier)] === LIBRARY;

const loaderOf = (file: string): "ts" | "tsx" | "js" | "jsx" =>
  file.endsWith(".tsx") ? "tsx" : file.endsWith(".jsx") ? "jsx" : /\.(ts|mts|cts)$/.test(file) ? "ts" : "js";

const normalizedSpecifier = (specifier: string): string => specifier.replace(/\.(js|ts|tsx)$/, "");

const isBare = (specifier: string): boolean => !/^(\.{1,2}(\/|$)|\/|[a-z][a-z0-9+.-]*:)/i.test(specifier);

const nodeLocation = (file: string, source: ts.SourceFile, node: ts.Node): PartialMessage["location"] => {
  const start = node.getStart(source);
  const { line, character } = source.getLineAndCharacterOfPosition(start);
  return { file, line: line + 1, column: character, length: node.getWidth(source), lineText: source.text.split("\n")[line] ?? "" };
};

/** What plugin code must not do in a bundle: locate itself, or name assets the bundle does not carry. */
export const pluginCodeProblems = (file: string, text: string, id: string, assets: readonly string[]): PartialMessage[] => {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const problems: PartialMessage[] = [];
  const report = (node: ts.Node, text: string): void => {
    problems.push({ text, location: nodeLocation(file, source, node) });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) {
      report(node, "import.meta ist im Bundle nicht erlaubt; Dateien des Plugins gehen über pluginAsset(id, name) oder pluginFolder(id)");
    } else if (ts.isIdentifier(node) && ["__dirname", "__filename", "createRequire"].includes(node.text)) {
      report(node, `${node.text} ist im Bundle nicht erlaubt; Dateien des Plugins gehen über pluginAsset(id, name) oder pluginFolder(id)`);
    } else if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require" && node.name.text === "resolve") {
      report(node, "require.resolve ist im Bundle nicht erlaubt; Dateien des Plugins gehen über pluginAsset(id, name) oder pluginFolder(id)");
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "pluginAsset") {
      const [owner, name] = node.arguments;
      if (owner && name && ts.isStringLiteralLike(owner) && ts.isStringLiteralLike(name) && owner.text === id && !coveredByAssets(assets, name.text)) {
        report(name, `pluginAsset nennt ${name.text}, das nicht ins Bundle kommt; unter assets in ragents-plugin.json nennen`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return problems;
};

const packageRootOf = (file: string): string | undefined => {
  let folder = path.dirname(file);
  while (folder !== path.dirname(folder)) {
    const parent = path.basename(path.dirname(folder));
    const grandparent = path.basename(path.dirname(path.dirname(folder)));
    if ((parent === "node_modules" || (parent.startsWith("@") && grandparent === "node_modules")) && existsSync(path.join(folder, "package.json"))) return folder;
    folder = path.dirname(folder);
  }
  return undefined;
};

/** A package bound to an operating system or processor cannot travel in a bundle. */
const platformProblem = (packageRoot: string): string | undefined => {
  const manifest = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
    name?: string; os?: unknown; cpu?: unknown; optionalDependencies?: Record<string, string>;
  };
  const name = manifest.name ?? path.basename(packageRoot);
  if (manifest.os !== undefined || manifest.cpu !== undefined) return `Das Paket ${name} ist an Betriebssystem oder Prozessor gebunden (os/cpu in package.json)`;
  const platformDependencies = Object.keys(manifest.optionalDependencies ?? {}).filter((dependency) => PLATFORM_PACKAGE.test(dependency));
  if (platformDependencies.length > 0) {
    return `Das Paket ${name} hat plattformabhängige optionale Abhängigkeiten (${platformDependencies.join(", ")}); Natives stellt der Host bereit oder die Provisionierung holt es`;
  }
  return undefined;
};

interface BuildEnvironment {
  readonly root: string;
  readonly record: HostApiRecord;
  readonly catalog: (id: string) => PluginSource | undefined;
  readonly out: string;
}

interface HalfState {
  readonly uses: Set<string>;
}

/** Keeps a half to the host API, its own folder and declared exports of other plugins; everything else is a build error with its cause. */
const boundaryPlugin = (source: PluginSource, half: HostApiHalf, environment: BuildEnvironment, state: HalfState, assets: readonly string[]): Plugin => ({
  name: "ragents-plugin-boundary",
  setup(build) {
    const id = source.description.id;
    const packageProblems = new Map<string, string | undefined>();

    const crossImport = (owner: string, name: string) => {
      state.uses.add(owner);
      return half === "server"
        ? { path: `@ragents/plugins/${owner}/${name}`, external: true }
        : { path: `/plugins/${owner}/web/exports/${name}.js`, external: true };
    };

    build.onResolve({ filter: /^ragents-entry:/ }, (args) => ({ path: args.path, namespace: ENTRY_NAMESPACE }));
    build.onResolve({ filter: new RegExp(`^${HOST_VALUE_NAMESPACE}:`) }, (args) =>
      ({ path: args.path.slice(HOST_VALUE_NAMESPACE.length + 1), namespace: HOST_VALUE_NAMESPACE, sideEffects: false }));
    build.onResolve({ filter: new RegExp(`^${HOST_READ_NAMESPACE}:`) }, () => ({ path: "read", namespace: HOST_READ_NAMESPACE, sideEffects: false }));
    build.onLoad({ filter: /.*/, namespace: ENTRY_NAMESPACE }, () => ({
      contents: `export * from "./server/index.ts";\nexport { provision } from "./provision.ts";\n`,
      resolveDir: source.folder,
      loader: "ts",
    }));

    build.onResolve({ filter: /\.node$/ }, (args) => ({
      errors: [{ text: `${args.path} ist eine plattformabhängige Binärdatei; Natives stellt der Host bereit oder die Provisionierung holt es nach <Datenordner>/tools/${id}/` }],
    }));

    build.onResolve({ filter: /.*/ }, async (args) => {
      if (args.pluginData?.[PASS] || args.kind === "entry-point") return undefined;
      const specifier = args.path;
      const fromPlugin = args.namespace === ENTRY_NAMESPACE || owningPluginFolder(args.importer) === source.folder;
      if (specifier.startsWith("node:") || isBuiltin(specifier)) {
        return half === "server"
          ? { path: specifier, external: true }
          : { errors: [{ text: `${specifier} ist ein Node-Modul und gibt es im Browser nicht` }] };
      }
      if (isBare(specifier)) {
        const cross = /^@ragents\/plugins\/([^/]+)\/(.+)$/.exec(specifier);
        if (cross) {
          const [, owner, rawName] = cross as unknown as [string, string, string];
          const name = normalizedSpecifier(rawName);
          if (owner === id) return { errors: [{ text: `${specifier} importiert das eigene Plugin über den Paketnamen; eigene Dateien relativ importieren` }] };
          const other = environment.catalog(owner);
          if (!other) return { errors: [{ text: `Das Plugin ${owner} aus ${specifier} liegt weder neben ${id} noch im Host` }] };
          if (!other.description.exports[half].includes(name)) {
            return { errors: [{ text: `${owner} exportiert ${name} für die ${half}-Hälfte nicht; der Export gehört in dessen ragents-plugin.json unter exports.${half}` }] };
          }
          return crossImport(owner, name);
        }
        if (providedByHost(half, specifier)) {
          if (args.kind === "dynamic-import" && (half === "web" || !isLibrary(half, specifier))) {
            return { errors: [{ text: `import() von ${specifier}: ein Modul des Hosts wird statisch importiert, damit der Bau jeden Namen gegen die Host-API prüft` }] };
          }
          if (args.kind === "require-call" && half === "server") {
            return { errors: [{ text: `require(${JSON.stringify(specifier)}): der Host liefert ${specifier} nur per import; im Bundle gäbe es sonst eine zweite Kopie oder keine` }] };
          }
          return half === "server"
            ? { path: specifier, external: true }
            : { path: normalizedSpecifier(specifier), namespace: HOST_NAMESPACE, sideEffects: false };
        }
        if (hostOnly(specifier)) {
          return { errors: [{ text: `${specifier} steht nicht in der ${half}-Liste der Host-API (apps/server/src/host-api.ts); ein Plugin bezieht vom Host nur, was dort steht` }] };
        }
        return undefined;
      }
      if (!fromPlugin) return undefined;
      const resolved = await build.resolve(specifier, { kind: args.kind, importer: args.importer, resolveDir: args.resolveDir, namespace: args.namespace, pluginData: { [PASS]: true } });
      if (resolved.errors.length > 0) return { errors: resolved.errors };
      const owner = owningPluginFolder(resolved.path);
      if (owner === source.folder) return { path: resolved.path, sideEffects: resolved.sideEffects };
      if (!owner) return { errors: [{ text: `${specifier} liegt außerhalb des Plugin-Ordners (${resolved.path}); ein Plugin importiert relativ nur eigene Dateien` }] };
      const other = readPluginSource(owner);
      const name = exportOfFile(other, half, resolved.path);
      if (!name) {
        const relative = path.relative(owner, resolved.path).split(path.sep).join("/").replace(/\.(ts|tsx)$/, "");
        return { errors: [{ text: `${other.description.id} exportiert ${relative} für die ${half}-Hälfte nicht; der Export gehört in dessen ragents-plugin.json unter exports.${half}` }] };
      }
      return crossImport(other.description.id, name);
    });

    build.onLoad({ filter: /.*/, namespace: HOST_NAMESPACE }, (args) => {
      const names = environment.record.web[args.path];
      if (!names) return { errors: [{ text: `host-api.json kennt ${args.path} nicht; pnpm update:host-api` }] };
      return { contents: hostModuleShim(args.path, names), loader: "js" };
    });
    build.onLoad({ filter: /.*/, namespace: HOST_VALUE_NAMESPACE }, (args) => {
      const separator = args.path.lastIndexOf("#");
      return { contents: hostValueSource(args.path.slice(0, separator), args.path.slice(separator + 1)), loader: "js" };
    });
    build.onLoad({ filter: /.*/, namespace: HOST_READ_NAMESPACE }, () => ({ contents: HOST_READ_SOURCE, loader: "js" }));

    build.onLoad({ filter: CODE_EXTENSION }, (args) => {
      const text = readFileSync(args.path, "utf8");
      const loader = loaderOf(args.path);
      if (owningPluginFolder(args.path) === source.folder) {
        const errors = pluginCodeProblems(args.path, text, id, assets);
        return errors.length > 0 ? { errors } : { contents: text, loader };
      }
      const packageRoot = packageRootOf(args.path);
      if (!packageRoot) return { contents: text, loader };
      if (!packageProblems.has(packageRoot)) packageProblems.set(packageRoot, platformProblem(packageRoot));
      const platform = packageProblems.get(packageRoot);
      const located = LIBRARY_LOCATIONS.filter(([pattern]) => pattern.test(text)).map(([, name]) => name);
      const errors = [
        ...(platform ? [{ text: platform }] : []),
        ...(located.length > 0 ? [{ text: `${path.relative(packageRoot, args.path)} in ${path.basename(packageRoot)} sucht Dateien über den eigenen Ort (${located.join(", ")}); im Bundle gibt es diesen Ort nicht` }] : []),
      ];
      return errors.length > 0 ? { errors } : { contents: text, loader };
    });
  },
});

interface ServerHostImports {
  /** Pairs of module and value name the file takes from the host API. */
  readonly names: readonly (readonly [string, string])[];
  readonly problems: readonly string[];
}

/** How a namespace binding is used: only property reads with a name count, anything else lets the whole namespace escape. */
const namespaceReads = (source: ts.SourceFile, binding: ts.Identifier): { readonly names: readonly string[]; readonly escapes: boolean } => {
  const names: string[] = [];
  let escapes = false;
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === binding.text && node !== binding) {
      const parent = node.parent;
      if (ts.isPropertyAccessExpression(parent) && parent.expression === node) names.push(parent.name.text);
      else escapes = true;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return { names, escapes };
};

/** Server bundles import host modules natively, so every name they take must be one the host API offers; the names go into the manifest. */
const serverHostImports = (file: string, text: string, record: HostApiRecord): ServerHostImports => {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const names: (readonly [string, string])[] = [];
  const problems: string[] = [];
  const take = (specifier: string, name: string, offered: readonly string[]): void => {
    if (offered.includes(name)) names.push([normalizedSpecifier(specifier), name]);
    else problems.push(`${file} importiert ${name} aus ${specifier}, das die Host-API nicht anbietet (host-api.json)`);
  };
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      const specifier = statement.moduleSpecifier.text;
      const offered = record.server[normalizedSpecifier(specifier)];
      if (!offered) continue;
      const clause = statement.exportClause;
      if (clause && ts.isNamedExports(clause)) for (const element of clause.elements) take(specifier, (element.propertyName ?? element.name).text, offered);
      else if (!isLibrary("server", specifier)) problems.push(`${file} reicht ${specifier} ganz weiter; aus einem Modul des Hosts nur einzelne Namen importieren`);
      continue;
    }
    if (!ts.isImportDeclaration(statement)) continue;
    const specifier = (statement.moduleSpecifier as ts.StringLiteral).text;
    const offered = record.server[normalizedSpecifier(specifier)];
    const clause = statement.importClause;
    if (!offered || !clause || clause.isTypeOnly) continue;
    if (clause.name) take(specifier, "default", offered);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) take(specifier, (element.propertyName ?? element.name).text, offered);
    } else if (bindings && ts.isNamespaceImport(bindings) && !isLibrary("server", specifier)) {
      const reads = namespaceReads(source, bindings.name);
      if (reads.escapes) problems.push(`${file} benutzt den Namensraum ${bindings.name.text} aus ${specifier} als Ganzes; aus einem Modul des Hosts nur einzelne Namen lesen, damit der Bau sie prüft`);
      for (const name of new Set(reads.names)) take(specifier, name, offered);
    }
  }
  return { names, problems };
};

/** The names of a host API half as the manifest keeps them: per module, sorted. */
const hostNamesOf = (pairs: readonly (readonly [string, string])[]): HostNames => {
  const grouped = new Map<string, Set<string>>();
  for (const [specifier, name] of pairs) grouped.set(specifier, (grouped.get(specifier) ?? new Set()).add(name));
  return Object.fromEntries([...grouped].sort(([left], [right]) => left.localeCompare(right, "en")).map(([specifier, set]) => [specifier, [...set].sort()]));
};

/** The host values the web half keeps: esbuild drops every value module nobody imports, the metafile names the rest. */
const webHostNames = (metafile: Metafile): readonly (readonly [string, string])[] =>
  Object.values(metafile.outputs).flatMap((output) => Object.entries(output.inputs)
    .filter(([input, { bytesInOutput }]) => input.startsWith(`${HOST_VALUE_NAMESPACE}:`) && bytesInOutput > 0)
    .map(([input]) => {
      const value = input.slice(HOST_VALUE_NAMESPACE.length + 1);
      const separator = value.lastIndexOf("#");
      return [value.slice(0, separator), value.slice(separator + 1)] as const;
    }));

const messageText = (message: Message, base: string): string => {
  const location = message.location;
  const where = location ? `${path.relative(base, path.resolve(base, location.file.replace(/^[a-z-]+:/, "")))}:${location.line}:${location.column + 1}: ` : "";
  const notes = message.notes.filter((note) => note.text).map((note) => `\n  ${note.text}`).join("");
  return `${where}${message.text}${notes}`;
};

/** Warnings that mean a value is silently undefined at run time; in a bundle they are errors. */
const FATAL_WARNINGS = new Set(["import-is-undefined"]);

interface HalfResult {
  readonly half: HostApiHalf;
  readonly files: readonly OutputFile[];
  readonly metafile: Metafile;
  readonly uses: readonly string[];
}

const nodePathsOf = (root: string, half: HostApiHalf): string[] =>
  [path.join(root, "node_modules"), path.join(root, half === "server" ? "apps/server/node_modules" : "apps/web/node_modules")]
    .filter((folder) => existsSync(folder));

const buildHalf = async (
  source: PluginSource,
  half: HostApiHalf,
  entries: readonly { readonly in: string; readonly out: string }[],
  environment: BuildEnvironment,
  assets: readonly string[],
): Promise<HalfResult | { readonly problems: readonly string[] }> => {
  const state: HalfState = { uses: new Set() };
  const id = source.description.id;
  const problemsOf = (messages: readonly Message[]): readonly string[] => messages.map((message) => `${half}: ${messageText(message, source.folder)}`);
  try {
    const result = await esbuild({
      absWorkingDir: source.folder,
      entryPoints: [...entries],
      outdir: path.join(environment.out, id, half),
      bundle: true,
      splitting: true,
      format: "esm",
      write: false,
      metafile: true,
      platform: half === "server" ? "node" : "browser",
      target: half === "server" ? "node22" : "es2022",
      sourcemap: "linked",
      minify: half === "web",
      jsx: "automatic",
      tsconfigRaw: {},
      nodePaths: nodePathsOf(environment.root, half),
      chunkNames: "chunks/[name]-[hash]",
      assetNames: "assets/[name]-[hash]",
      ...(half === "web" ? {
        publicPath: `/plugins/${id}/web`,
        loader: Object.fromEntries(WEB_FILE_EXTENSIONS.map((extension) => [extension, "file" as const])),
        define: { "process.env.NODE_ENV": JSON.stringify("production") },
      } : { banner: { js: SERVER_BANNER } }),
      logLevel: "silent",
      plugins: [boundaryPlugin(source, half, environment, state, assets)],
    });
    const fatal = result.warnings.filter((warning) => FATAL_WARNINGS.has(warning.id));
    if (fatal.length > 0) return { problems: problemsOf(fatal) };
    return { half, files: result.outputFiles, metafile: result.metafile, uses: [...state.uses] };
  } catch (error) {
    const errors = (error as { errors?: Message[] }).errors;
    if (!errors) throw error;
    return { problems: problemsOf(errors) };
  }
};

/** Tailwind candidates of the plugin's own bundled web sources; the host compiles one stylesheet from all lists. */
const tailwindCandidates = (source: PluginSource, metafile: Metafile): readonly string[] => {
  const files = Object.keys(metafile.inputs)
    .filter((input) => !/^[a-z-]+:/.test(input))
    .map((input) => path.resolve(source.folder, input))
    .filter((file) => owningPluginFolder(file) === source.folder);
  const scanner = new Scanner({ sources: [] });
  const candidates = scanner.scanFiles(files.map((file) => ({ content: readFileSync(file, "utf8"), extension: path.extname(file).slice(1) })));
  return [...new Set(candidates)].sort();
};

const copyAsset = async (from: string, to: string, name: string): Promise<void> => {
  const stats = lstatSync(from);
  if (stats.isSymbolicLink()) throw new Error(`Das Asset ${name} enthält eine Verknüpfung (${from}); ein Bundle enthält nur Dateien`);
  if (stats.isDirectory()) {
    if (path.basename(from) === "node_modules") throw new Error(`Das Asset ${name} enthält node_modules; ein Bundle bringt keine Abhängigkeiten mit`);
    await mkdir(to, { recursive: true });
    for (const entry of readdirSync(from).sort()) {
      if (!SKIPPED_ASSET_FILES.has(entry)) await copyAsset(path.join(from, entry), path.join(to, entry), name);
    }
    return;
  }
  await mkdir(path.dirname(to), { recursive: true });
  await copyFile(from, to);
};

/** Builds one plugin from its folder as it is now: description, entries, assets and the exports of its siblings are read afresh. */
const buildPlugin = async (folder: string, environment: BuildEnvironment, typeErrors: readonly string[] = []): Promise<PluginBuildOutcome> => {
  const started = Date.now();
  const failedAt = (id: string, problems: readonly string[]): PluginBuildOutcome => ({ kind: "failed", id, source: folder, problems });
  const source = ((): PluginSource | Error => {
    try {
      return readPluginSource(folder);
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  })();
  if (source instanceof Error) return failedAt(path.basename(folder), [source.message]);
  const id = source.description.id;
  const failed = (problems: readonly string[]): PluginBuildOutcome => failedAt(id, [...typeErrors, ...problems]);
  const assets = assetsOf(source);
  const serverEntry = sourceFileOf(path.join(source.folder, "server/index"));
  const webEntry = sourceFileOf(path.join(source.folder, "web/index"));
  const provision = sourceFileOf(path.join(source.folder, "provision"));
  const exportEntries = (half: HostApiHalf) => source.description.exports[half].map((name) => ({
    in: sourceFileOf(path.join(source.folder, name))!,
    out: `exports/${name}`,
  }));
  if (!serverEntry) return failed(["server/index.ts fehlt; jedes Plugin hat eine Server-Hälfte mit dem Modulvertrag"]);
  const hasWeb = webEntry !== undefined || source.description.exports.web.length > 0;
  const results = await Promise.all([
    buildHalf(source, "server", [{ in: provision ? "ragents-entry:server" : serverEntry, out: "index" }, ...exportEntries("server")], environment, assets),
    ...(hasWeb ? [buildHalf(source, "web", [...(webEntry ? [{ in: webEntry, out: "index" }] : []), ...exportEntries("web")], environment, assets)] : []),
  ]);
  const problems = results.flatMap((result) => "problems" in result ? result.problems : []);
  if (problems.length > 0) return failed(problems);
  const built = results as HalfResult[];
  const files = built.flatMap((result) => result.files);
  const target = path.join(environment.out, id);
  const relativeOf = (file: OutputFile): string => path.relative(target, file.path).split(path.sep).join("/");
  const strayCss = files.map(relativeOf).filter((name) => name.endsWith(".css") && name !== "web/index.css");
  if (strayCss.length > 0) return failed(strayCss.map((name) => `${name}: CSS gibt es nur über den Web-Einstieg (web/index.css)`));
  const serverImports = files.filter((file) => relativeOf(file).startsWith("server/") && file.path.endsWith(".js"))
    .map((file) => serverHostImports(relativeOf(file), file.text, environment.record));
  const importProblems = serverImports.flatMap((imports) => imports.problems);
  if (importProblems.length > 0) return failed(importProblems);
  if (typeErrors.length > 0) return failed([]);

  const web = built.find((result) => result.half === "web");
  const staging = path.join(environment.out, `.${id}.building-${process.pid}`);
  await rm(staging, { recursive: true, force: true });
  try {
    for (const file of files) {
      const destination = path.join(staging, relativeOf(file));
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, file.contents);
    }
    if (web && webEntry) await writeFile(path.join(staging, "web/classes.json"), `${JSON.stringify(tailwindCandidates(source, web.metafile))}\n`);
    for (const asset of assets) await copyAsset(path.join(source.folder, asset), path.join(staging, asset), asset);
    const manifest: BundleManifest = {
      format: BUNDLE_FORMAT,
      id,
      api: HOST_API_VERSION,
      hostNames: {
        server: hostNamesOf(serverImports.flatMap((imports) => imports.names)),
        web: hostNamesOf(web ? webHostNames(web.metafile) : []),
      },
      stand: bundleStand(staging),
      sourceStand: sourceStandOf(source.folder, [realpathSync.native(environment.out)], environment.root),
      server: "server/index.js",
      ...(webEntry ? {
        web: {
          entry: "web/index.js",
          ...(files.some((file) => relativeOf(file) === "web/index.css") ? { css: "web/index.css" } : {}),
          classes: "web/classes.json",
        },
      } : {}),
      exports: {
        server: Object.fromEntries(source.description.exports.server.map((name) => [name, exportOutput("server", name)])),
        web: Object.fromEntries(source.description.exports.web.map((name) => [name, exportOutput("web", name)])),
      },
      uses: [...new Set(built.flatMap((result) => result.uses))].sort(),
      assets,
    };
    await writeFile(path.join(staging, BUNDLE_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
    await installFolder(staging, target, [BUNDLE_MANIFEST_FILE]);
    return { kind: "built", id, bundle: target, manifest, milliseconds: Date.now() - started };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    return failed([error instanceof Error ? error.message : String(error)]);
  }
};

interface HostBuildContext {
  readonly root: string;
  readonly record: HostApiRecord;
  readonly out: string;
}

const hostContextFor = (folders: readonly string[], options: Pick<PluginBuildOptions, "out" | "root">): HostBuildContext => {
  const ids = folders.map((folder) => path.basename(path.resolve(folder)));
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate) throw new Error(`Das Plugin ${duplicate} ist mehrfach genannt`);
  const root = options.root ?? hostRoot();
  return { root, record: checkedHostApiRecord(root), out: path.resolve(options.out) };
};

/** Siblings are read at the moment of a build, so that a changed export of a neighbour counts at once. */
const environmentOf = (context: HostBuildContext, folders: readonly string[]): BuildEnvironment =>
  ({ ...context, catalog: pluginCatalog(folders, path.join(context.root, "plugins")) });

/** An installed bundle that this host would build the same way: same format, host API, sources and host inputs, and still its own files. */
const bundleIsCurrent = (folder: string, out: string, root = hostRoot()): boolean => {
  const bundle = path.join(out, path.basename(folder));
  const file = path.join(bundle, BUNDLE_MANIFEST_FILE);
  if (!existsSync(file)) return false;
  const manifest = JSON.parse(readFileSync(file, "utf8")) as Partial<BundleManifest>;
  return manifest.format === BUNDLE_FORMAT && manifest.api === HOST_API_VERSION
    && manifest.sourceStand === sourceStandOf(folder, [realpathSync.native(out)], root)
    && manifest.stand === bundleStand(bundle);
};

/** Builds each plugin folder into <out>/<id>; a failing plugin does not stop the others, and parallel builds into the same folder wait for each other. */
export const buildPlugins = async (folders: readonly string[], options: PluginBuildOptions): Promise<readonly PluginBuildOutcome[]> => {
  const sources = folders.map(readPluginSource);
  const context = hostContextFor(sources.map((source) => source.folder), options);
  await mkdir(context.out, { recursive: true });
  return withLock(path.join(context.out, LOCK_FILE), async () => {
    const chosen = options.onlyOutdated ? sources.filter((source) => !bundleIsCurrent(source.folder, context.out, context.root)) : sources;
    const typeProblems = options.typecheck ? typecheckPlugins(chosen, context.root) : new Map<string, readonly string[]>();
    const outcomes: PluginBuildOutcome[] = [];
    for (const source of chosen) {
      const typeErrors = (typeProblems.get(source.description.id) ?? []).map((problem) => `Typen: ${problem}`);
      outcomes.push(await buildPlugin(source.folder, environmentOf(context, folders), typeErrors));
    }
    return outcomes;
  });
};

export interface PluginWatch {
  readonly stop: () => Promise<void>;
}

const WATCH_DELAY_MS = 80;

/** Builds every plugin whose bundle is missing or outdated, then rebuilds it from scratch whenever something in its folder changes; types are the editor's job here. */
export const watchPlugins = async (
  folders: readonly string[],
  options: Omit<PluginBuildOptions, "typecheck" | "onlyOutdated">,
  report: (outcome: PluginBuildOutcome) => void,
): Promise<PluginWatch> => {
  const context = hostContextFor(folders, options);
  await mkdir(context.out, { recursive: true });
  const out = realpathSync.native(context.out);
  const lock = path.join(out, LOCK_FILE);
  const watchers: FSWatcher[] = [];
  const pending = new Set<Promise<void>>();
  let stopped = false;
  for (const folder of folders.map((entry) => realpathSync.native(path.resolve(entry)))) {
    let timer: NodeJS.Timeout | undefined;
    let running: Promise<void> | undefined;
    let again = false;
    const run = (onlyOutdated: boolean): void => {
      if (stopped) return;
      if (running) {
        again = true;
        return;
      }
      const current: Promise<void> = withLock(lock, async () => {
        if (!onlyOutdated || !bundleIsCurrent(folder, out, context.root)) report(await buildPlugin(folder, environmentOf(context, folders)));
      }).catch((error: unknown) => {
        report({ kind: "failed", id: path.basename(folder), source: folder, problems: [error instanceof Error ? error.message : String(error)] });
      }).finally(() => {
        pending.delete(current);
        running = undefined;
        if (again) {
          again = false;
          run(false);
        }
      });
      running = current;
      pending.add(current);
    };
    // Beim Start nur Veraltetes, damit ein Server, der gerade mit diesen Bundles startet, keine getauschten Dateien sieht.
    run(true);
    watchers.push(watch(folder, { recursive: true }, (_event, name) => {
      const changed = name ? path.join(folder, name.toString()) : folder;
      if (changed.split(path.sep).includes("node_modules") || changed.startsWith(out + path.sep)) return;
      clearTimeout(timer);
      timer = setTimeout(() => run(false), WATCH_DELAY_MS);
    }));
  }
  return {
    stop: async () => {
      stopped = true;
      for (const watcher of watchers) watcher.close();
      await Promise.all(pending);
    },
  };
};
