import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readHostVersion, readPackageVersion } from "../../apps/server/src/host-version.ts";
import { hostWebDirectory, hostWebProblem, isCheckout } from "../../apps/server/src/host-web.ts";
import { runtimeLibraries } from "../../apps/server/src/plugin-support/actor-programs/runtime-libraries.ts";
import { assertBundleStand, readBundleManifest, sourceStandOf } from "../../apps/server/src/profile/bundle-manifest.ts";
import { builtInPluginFolders } from "../plugin/build-builtin-plugins.ts";

export const PACKAGE_NAME = "@schlenkr/ragents";
/** The folder under dist/; the package name has a scope, the folder name stays plain. */
export const PACKAGE_FOLDER = "ragents";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const SKIPPED_FOLDERS = new Set(["node_modules", "dist", ".git"]);
const SKIPPED_FILES = new Set([".DS_Store"]);

/** The subcommands' tests run in the checkout; in the package only their test material would be visible. */
const SKIPPED_IN_PACKAGE = /^scripts\/.*\.test\.tsx?$/;

const packagePath = (packageRoot: string, file: string): string => path.relative(packageRoot, file).split(path.sep).join("/");

/** The repository's neutral profiles; ragents start runs them from the package as from the checkout. */
export const PACKAGED_PROFILES = ["core", "developer", "showcase"] as const;

export const PACKAGE_LICENSE = "PolyForm-Shield-1.0.0";
export const PACKAGE_AUTHOR = "Ronald Schlenker";
export const REPOSITORY_URL = "https://github.com/SchlenkR/RAgents";
export const PACKAGE_KEYWORDS = ["agents", "llm", "actors", "typescript", "csharp", "fsharp", "vscode"] as const;

/** License and listing README are at the root of the package, their sources elsewhere in the repository. */
export const PACKAGE_ROOT_FILES: readonly (readonly [string, string])[] = [
  ["LICENSE", "LICENSE"],
  ["scripts/package/README.md", "README.md"],
];

const ROOT_FILE_SOURCES = new Set(PACKAGE_ROOT_FILES.map(([source]) => source));

const skippedInPackage = (relative: string): boolean => SKIPPED_IN_PACKAGE.test(relative) || ROOT_FILE_SOURCES.has(relative);

/** What the host loads at runtime: server, engine, the built web, the built-in bundles, plugin sources for contracts and the build tool, profiles and the scripts behind the subcommands; plus the types from declarationFolders. */
export const packageContents = (root = repositoryRoot): readonly string[] => [
  "apps/server/package.json",
  "apps/server/tsconfig.json",
  "apps/server/tsconfig.plugin.json",
  "apps/server/src",
  "apps/web/package.json",
  "apps/web/tsconfig.json",
  "apps/web/tsconfig.plugin.json",
  "apps/web/src",
  "apps/web/dist",
  ...readdirSync(path.join(root, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => [`packages/${entry.name}/package.json`, `packages/${entry.name}/src`]),
  "bundles",
  "plugins",
  ...PACKAGED_PROFILES.map((profile) => `ragents.config.${profile}.ts`),
  "scripts/agent",
  "scripts/package",
  "scripts/plugin",
  "scripts/provision",
  "scripts/remote",
  "scripts/workspace-client",
];

/** The forked agent runtime runs from its sources, its types exist only built; the build tool checks third-party plugins against them. */
export const declarationFolders = (root = repositoryRoot): readonly string[] =>
  readdirSync(path.join(root, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => {
      const manifest = path.join(root, "packages", entry.name, "package.json");
      const types = statSync(manifest, { throwIfNoEntry: false })?.isFile() ? (JSON.parse(readFileSync(manifest, "utf8")) as { types?: unknown }).types : undefined;
      return typeof types === "string" && types.startsWith("./dist/");
    })
    .map((entry) => `packages/${entry.name}/dist`);

/** What the host executes, bundles into a mini-app or reads when building a plugin. */
const SCANNED = ["apps/server/src", "apps/web", "packages", "plugins", "scripts"];
const PACKAGE_NAME_PATTERN = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const SCAN_SKIPPED = new Set(["node_modules", "dist"]);
const SCANNED_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".mjs", ".js", ".css"]);
const IMPORT_PATTERN = /\b(?:from|import|require(?:\.resolve)?)\s*\(?\s*["']([^"'\n]+)["']/g;
/** An executor contribution resolves packages from the host at runtime; the package must carry them too. */
const HOST_PACKAGE_PATTERN = /\bhostPackageFile\([^,()]*,\s*["']([^"'\n]+)["']/g;

const files = async (folder: string, skippedFolders: ReadonlySet<string> = SKIPPED_FOLDERS): Promise<readonly string[]> => {
  const found: string[] = [];
  for (const entry of (await readdir(folder, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name, "en"))) {
    if (entry.isDirectory()) {
      if (!skippedFolders.has(entry.name)) found.push(...await files(path.join(folder, entry.name), skippedFolders));
    } else if (entry.isFile() && !SKIPPED_FILES.has(entry.name)) {
      found.push(path.join(folder, entry.name));
    }
  }
  return found;
};

const copyTo = async (source: string, target: string, packageRoot: string, skippedFolders?: ReadonlySet<string>): Promise<readonly string[]> => {
  if (statSync(source).isFile()) {
    if (skippedInPackage(packagePath(packageRoot, target))) return [];
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
    return [target];
  }
  const copied: string[] = [];
  for (const file of await files(source, skippedFolders)) {
    const destination = path.join(target, path.relative(source, file));
    if (skippedInPackage(packagePath(packageRoot, destination))) continue;
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(file, destination);
    copied.push(destination);
  }
  return copied;
};

const scanRoots = (root: string): readonly string[] => SCANNED.map((entry) => path.join(root, entry));

const scannedFiles = (folder: string): readonly string[] => {
  if (!statSync(folder, { throwIfNoEntry: false })?.isDirectory()) return [];
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(folder, entry.name);
    if (entry.isDirectory()) return SCAN_SKIPPED.has(entry.name) ? [] : scannedFiles(absolute);
    return entry.isFile() && SCANNED_EXTENSIONS.has(path.extname(entry.name)) ? [absolute] : [];
  });
};

const packageNameOf = (specifier: string): string | undefined => {
  if (/^(\.{1,2}\/|\/|node:|data:|@ragents\/|virtual:)/.test(specifier) || specifier === "vscode") return undefined;
  const parts = specifier.split("/");
  const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
  if (builtinModules.includes(name)) return undefined;
  return PACKAGE_NAME_PATTERN.test(name) ? name : undefined;
};

const declaredWebDependencies = (packageDirectory: string): readonly string[] => {
  const file = path.join(packageDirectory, "apps/web/package.json");
  const declared = (JSON.parse(readFileSync(file, "utf8")) as { dependencies?: Record<string, string> }).dependencies ?? {};
  return Object.keys(declared);
};

/** The packages that the executed part of the package actually imports, plus the libraries linked at runtime
 * and those that the host's web offers to the web halves of third-party plugins. */
export const requiredPackages = (packageDirectory: string): ReadonlyMap<string, string> => {
  const sources = new Map<string, string>();
  for (const name of runtimeLibraries) sources.set(name, "plugins/ragents.actor-programs (linked at runtime)");
  for (const name of declaredWebDependencies(packageDirectory)) sources.set(name, "apps/web/package.json (for the web halves of the plugins)");
  for (const folder of scanRoots(packageDirectory)) {
    for (const file of scannedFiles(folder)) {
      const content = readFileSync(file, "utf8");
      for (const match of [...content.matchAll(IMPORT_PATTERN), ...content.matchAll(HOST_PACKAGE_PATTERN)]) {
        const name = packageNameOf(match[1]!);
        if (name && !sources.has(name)) sources.set(name, path.relative(packageDirectory, file));
      }
    }
  }
  return new Map([...sources].sort(([left], [right]) => left.localeCompare(right, "en")));
};

const compareVersions = (left: string, right: string): number => {
  const parts = (value: string) => value.split(/[.+-]/).map((part) => Number.isInteger(Number(part)) ? Number(part) : part);
  const [first, second] = [parts(left), parts(right)];
  for (let index = 0; index < Math.max(first.length, second.length); index += 1) {
    const [one, other] = [first[index] ?? 0, second[index] ?? 0];
    if (one === other) continue;
    return typeof one === "number" && typeof other === "number" ? one - other : String(one).localeCompare(String(other), "en");
  }
  return 0;
};

const anchors = (root: string): readonly string[] => [
  path.join(root, "package.json"),
  ...["apps", "packages"].flatMap((group) => readdirSync(path.join(root, group), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, group, entry.name, "package.json"))
    .filter((file) => statSync(file, { throwIfNoEntry: false })?.isFile() === true)),
];

/** The versions this checkout has installed for a package; the newest goes into the package. */
export const installedVersions = (name: string, root = repositoryRoot): readonly string[] => {
  const found = new Set<string>();
  for (const anchor of anchors(root)) {
    for (let directory = path.dirname(anchor); ; directory = path.dirname(directory)) {
      const file = path.join(directory, "node_modules", ...name.split("/"), "package.json");
      if (statSync(file, { throwIfNoEntry: false })?.isFile()) {
        found.add((JSON.parse(readFileSync(file, "utf8")) as { version: string }).version);
        break;
      }
      if (path.dirname(directory) === directory) break;
    }
  }
  const versions = [...found].sort(compareVersions);
  if (versions.length === 0) throw new Error(`The package ${name} is not installed in this checkout; without a version it cannot go into the package`);
  return versions;
};

export interface BuiltPackage {
  readonly directory: string;
  readonly manifest: Record<string, unknown>;
  readonly fileCount: number;
  readonly byteSize: number;
  readonly flattened: readonly string[];
}

/** The package ships the web prebuilt; it must be built and match its sources. */
const assertHostWeb = (root: string): void => {
  const problem = hostWebProblem(hostWebDirectory(root), root, isCheckout(root));
  if (problem) throw new Error(`${problem}; run pnpm build:web first`);
};

/** Every built-in plugin must exist as a bundle and match its sources, otherwise the package starts no profile. */
const assertBuiltInBundles = (root: string): void => {
  for (const folder of builtInPluginFolders(path.join(root, "plugins"))) {
    const bundle = path.join(root, "bundles", path.basename(folder));
    if (!statSync(bundle, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`The bundle ${bundle} is missing; run pnpm build:plugins first`);
    if (readBundleManifest(bundle).sourceStand !== sourceStandOf(folder)) throw new Error(`The bundle ${bundle} no longer matches ${folder}; run pnpm build:plugins first`);
  }
};

const copyDeclarations = async (root: string, target: string): Promise<readonly string[]> => {
  const copied: string[] = [];
  for (const folder of declarationFolders(root)) {
    if (!statSync(path.join(root, folder), { throwIfNoEntry: false })?.isDirectory()) throw new Error(`${folder} is missing; run pnpm build:agent first`);
    for (const file of (await files(path.join(root, folder))).filter((name) => name.endsWith(".d.ts"))) {
      const destination = path.join(target, path.relative(root, file));
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(file, destination);
      copied.push(destination);
    }
  }
  return copied;
};

export const buildPackage = async (target: string, root = repositoryRoot): Promise<BuiltPackage> => {
  assertBuiltInBundles(root);
  assertHostWeb(root);
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  let fileCount = 0;
  let byteSize = 0;
  for (const entry of packageContents(root)) {
    // A bundle is fully built and goes into the package completely, including an asset folder named dist.
    const copied = await copyTo(path.join(root, entry), path.join(target, entry), target, entry === "bundles" ? new Set() : undefined);
    fileCount += copied.length;
    for (const file of copied) byteSize += statSync(file).size;
  }
  for (const folder of builtInPluginFolders(path.join(root, "plugins"))) {
    const bundle = path.join(target, "bundles", path.basename(folder));
    assertBundleStand(bundle, readBundleManifest(bundle));
  }
  for (const file of await copyDeclarations(root, target)) {
    fileCount += 1;
    byteSize += statSync(file).size;
  }
  for (const [source, packaged] of PACKAGE_ROOT_FILES) {
    const destination = path.join(target, packaged);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(root, source), destination);
    fileCount += 1;
    byteSize += statSync(destination).size;
  }
  const flattened: string[] = [];
  const dependencies: Record<string, string> = {};
  for (const [name] of requiredPackages(target)) {
    const versions = installedVersions(name, root);
    if (versions.length > 1) flattened.push(`${name}: ${versions.join(", ")} -> ${versions.at(-1)!}`);
    dependencies[name] = versions.at(-1)!;
  }
  const manifest = {
    name: PACKAGE_NAME,
    version: readPackageVersion(root),
    description: "RAgents host: server, engine, plugins and tools without a source checkout",
    keywords: [...PACKAGE_KEYWORDS],
    homepage: "https://schlenkr.github.io/RAgents/",
    bugs: { url: `${REPOSITORY_URL}/issues` },
    license: PACKAGE_LICENSE,
    author: PACKAGE_AUTHOR,
    repository: { type: "git", url: `git+${REPOSITORY_URL}.git` },
    type: "module",
    bin: { ragents: "scripts/package/ragents.mjs" },
    engines: { node: ">=22.19.0" },
    publishConfig: { access: "public" },
    dependencies,
    ragents: { hostVersion: readHostVersion(root) },
  };
  const manifestFile = path.join(target, "package.json");
  await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  fileCount += 1;
  byteSize += statSync(manifestFile).size;
  return { directory: target, manifest, fileCount, byteSize, flattened };
};

const main = async (): Promise<void> => {
  const pack = process.argv.includes("--pack");
  const unknown = process.argv.slice(2).filter((argument) => argument !== "--pack");
  if (unknown.length) throw new Error(`Unknown argument: ${unknown.join(" ")} (allowed: --pack)`);
  const target = path.join(repositoryRoot, "dist", PACKAGE_FOLDER);
  const built = await buildPackage(target);
  console.log(`== Package ${PACKAGE_NAME}@${built.manifest.version as string} in ${built.directory}`);
  console.log(`== Host version ${(built.manifest.ragents as { hostVersion: string }).hostVersion}`);
  console.log(`== ${built.fileCount} files, ${(built.byteSize / 1024 / 1024).toFixed(1)} MB, ${Object.keys(built.manifest.dependencies as object).length} dependencies`);
  for (const [name, version] of Object.entries(built.manifest.dependencies as Record<string, string>)) console.log(`   ${name}@${version}`);
  for (const entry of built.flattened) console.log(`== Multiple versions flattened: ${entry}`);
  if (!pack) return;
  const packed = spawnSync("npm", ["pack", "--pack-destination", path.dirname(built.directory)], { cwd: built.directory, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  if (packed.status !== 0) throw new Error(`npm pack ended with code ${packed.status}`);
  console.log(`== Archive ${path.join(path.dirname(built.directory), packed.stdout.trim().split("\n").at(-1) ?? "")}`);
};

const moduleUrl: string | undefined = import.meta.url;
if (moduleUrl && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(moduleUrl)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
