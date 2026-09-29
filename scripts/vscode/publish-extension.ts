import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPackageVersion } from "../../apps/server/src/host-version.ts";
import { latestPublishedVersion, type NpmRunner } from "../package/publish-package.ts";
import { compareVersions, nextVersion, readVersion, versionLine, writeVersion } from "../publish-version.ts";
import { BASH_TARGETS, bundleBash, type BashTarget } from "./bundle-bash.ts";
import { bundleRipgrep, type RipgrepTarget } from "./bundle-rg.ts";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const PUBLISHER = "purestate";
export const EXTENSION_NAME = "ragents-vscode";
export const EXTENSION_ID = `${PUBLISHER}.${EXTENSION_NAME}`;
export const VSCE_VERSION = "4.0.0";

const TOKEN_KEY = "AZURE_DEVOPS_VSCE_RAGENTS_PAT";
const extensionRoot = path.join(repositoryRoot, "apps", "vscode");
const manifestFile = path.join(extensionRoot, "package.json");
const ignoreFile = path.join(extensionRoot, ".vscodeignore");
const outputFolder = path.join(repositoryRoot, "dist");

/** One .vsix per platform with its rg, on Windows also with its Bash; the universal one without both for all others. */
export type VsixTarget = "universal" | RipgrepTarget;
export const VSIX_TARGETS: readonly VsixTarget[] = ["universal", "win32-x64", "win32-arm64", "darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"];

const isBashTarget = (target: VsixTarget): target is BashTarget => target in BASH_TARGETS;

/** What a platform carries in addition to the universal allowlist: its rg and on Windows its Bash. */
export const bundledFolders = (target: VsixTarget): readonly string[] => target === "universal"
  ? []
  : [...(isBashTarget(target) ? [`dist/bash/${target}`] : []), `dist/rg/${target}`];

/** The allowlist of the .vscodeignore, extended for a platform by its bundled folders. */
export const ignoreRules = (base: string, target: VsixTarget): string => {
  const folders = bundledFolders(target);
  return folders.length === 0 ? base : `${base.trimEnd()}\n${folders.map((folder) => `!${folder}/**`).join("\n")}\n`;
};

/** Named the way vsce names it: the platform before the version. */
export const vsixName = (version: string, target: VsixTarget): string =>
  target === "universal" ? `${EXTENSION_NAME}-${version}.vsix` : `${EXTENSION_NAME}-${target}-${version}.vsix`;

/** The arguments of vsce package per platform; the ignore file carries this platform's allowlist. */
export const packageArguments = (vsix: string, target: VsixTarget, ignore: string): readonly string[] => [
  "package", "--no-dependencies", "--ignoreFile", ignore, "--out", vsix, ...(target === "universal" ? [] : ["--target", target]),
];

const usage = `Usage: pnpm publish:vscode [--dry-run]
Builds the extension ${EXTENSION_ID}, packages it into dist/ - universal and per platform
(${VSIX_TARGETS.filter((target) => target !== "universal").join(", ")}) with bundled rg
(pnpm bundle:rg), on Windows also with Bash (pnpm bundle:bash, needs 7-Zip) - and
publishes all of them on the Visual Studio Marketplace. The token comes from the environment variable ${TOKEN_KEY}. --dry-run does everything
except the publish and shows the content of the .vsix. The version is in apps/vscode/package.json;
before packaging, the script raises the last place above the last published version, in a
dry run only in the output.`;

export interface VsceResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type VsceRunner = (args: readonly string[], options: { cwd: string; token?: string }) => VsceResult;

/** The token goes only as VSCE_PAT into the child process's environment, never onto the command line. */
export const publishEnvironment = (token: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv =>
  ({ ...base, VSCE_PAT: token });

/** Everything that comes from vsce goes through this mask so that the token does not show up even in an error message. */
export const redacting = (token: string) => (text: string): string => token ? text.split(token).join(`<${TOKEN_KEY}>`) : text;

/** An error message is one line; vsce's output is therefore moved onto one. */
export const oneLine = (text: string): string => text.split("\n").map((line) => line.trim()).filter(Boolean).join("; ");

const runVsce: VsceRunner = (args, options) => {
  const result = spawnSync("pnpm", ["dlx", `@vscode/vsce@${VSCE_VERSION}`, ...args], {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.token ? publishEnvironment(options.token) : process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw new Error(`vsce ${args[0]} could not be started: ${result.error.message}`);
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};

/** The Marketplace reports a publisher that does not exist as a missing permission; without the hint you look for the error in the token. */
export const publisherAdvice = (publisher: string, output: string): string => /Access Denied/i.test(output)
  ? ` Either the publisher ${publisher} does not exist in the Marketplace yet - then create it on `
    + "https://marketplace.visualstudio.com/manage with the same account -, or the token has no "
    + "Marketplace scope for all organizations."
  : "";

/** Checks before anything else that the token may write for the publisher. */
export const verifyToken = (publisher: string, token: string, vsce: VsceRunner): void => {
  const result = vsce(["verify-pat", publisher], { cwd: repositoryRoot, token });
  if (result.status !== 0) {
    const output = `${result.stdout}\n${result.stderr}`;
    throw new Error(`vsce verify-pat ${publisher} ended with code ${result.status}: `
      + `${redacting(token)(oneLine(output))}.${publisherAdvice(publisher, output)}`);
  }
};

/** The versions already in the Marketplace; an extension unknown there is the empty list, not an error. */
export const publishedVersions = (extensionId: string, vsce: VsceRunner): readonly string[] => {
  const result = vsce(["show", extensionId, "--json"], { cwd: repositoryRoot });
  const output = `${result.stdout}\n${result.stderr}`;
  if (result.status !== 0) {
    if (/not found/i.test(output)) return [];
    throw new Error(`vsce show ${extensionId} ended with code ${result.status}: ${oneLine(result.stderr)}`);
  }
  const text = result.stdout.trim();
  if (!text || text === "undefined") return [];
  const listed = (JSON.parse(text) as { versions?: readonly { version?: unknown }[] }).versions ?? [];
  return [...new Set(listed.map((entry) => entry.version).filter((version): version is string => typeof version === "string"))];
};

/** The version a user of the extension would get from npm: the last published one, otherwise the one this
 * checkout publishes next - after a package publish it counts while the registry is still catching up. */
export const expectedHostPackageVersion = (npm?: NpmRunner): string =>
  [latestPublishedVersion(npm), readPackageVersion(repositoryRoot)].filter((version): version is string => version !== undefined)
    .sort(compareVersions).at(-1)!;

/** Extension and host package belong together: without a checkout the extension fetches exactly this version from npm. */
export const assertHostPackageVersion = (manifest: Record<string, unknown>, expected: string): void => {
  const version = (manifest.ragents as { packageVersion?: unknown } | undefined)?.packageVersion;
  if (version === expected) return;
  throw new Error(`apps/vscode/package.json names ${JSON.stringify(version)} under ragents.packageVersion, `
    + `the package is at ${expected}; set the field to ${expected}`);
};

export interface PublishPlan {
  readonly extensionId: string;
  readonly version: string;
}

/** What must be right before a publish: a manifest the Marketplace accepts and a version unknown there. */
export const publishPlan = (manifest: Record<string, unknown>, published: readonly string[], version: string): PublishPlan => {
  const { name, publisher } = manifest as { name?: unknown; publisher?: unknown };
  if (name !== EXTENSION_NAME) throw new Error(`The extension is named ${String(name)}, but ${EXTENSION_NAME} is published`);
  if (publisher !== PUBLISHER) throw new Error(`The publisher is ${JSON.stringify(publisher)}, but it is published under ${PUBLISHER}`);
  if (manifest.private) throw new Error("The manifest is private; the Marketplace accepts only an extension without this field");
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`The version ${JSON.stringify(version)} is not a version; it is the version in apps/vscode/package.json`);
  }
  const filled: readonly (readonly [string, boolean])[] = [
    ...(["displayName", "description", "license", "icon"] as const).map((field) => [field, typeof manifest[field] === "string" && Boolean(manifest[field])] as const),
    ["repository", typeof (manifest.repository as { url?: unknown } | undefined)?.url === "string"],
    ["engines.vscode", typeof (manifest.engines as { vscode?: unknown } | undefined)?.vscode === "string"],
    ...(["categories", "keywords"] as const).map((field) => [field, Array.isArray(manifest[field]) && (manifest[field] as unknown[]).length > 0] as const),
  ];
  const missing = filled.filter(([, present]) => !present).map(([field]) => field);
  if (missing.length) throw new Error(`The manifest lacks fields for the Marketplace: ${missing.join(", ")}`);
  if (published.includes(version)) {
    throw new Error(`${EXTENSION_ID}@${version} is already in the Marketplace (there: ${published.join(", ")}); `
      + "raise version in apps/vscode/package.json by hand");
  }
  return { extensionId: EXTENSION_ID, version };
};

export interface PublishOptions {
  readonly vsix: readonly string[];
  readonly version: string;
  readonly token: string;
  readonly vsce: VsceRunner;
  readonly log: (line: string) => void;
}

/** Publishes the packaged files in one call; exit 0 of vsce publish is the confirmation. */
export const publishVsix = (options: PublishOptions): void => {
  const hide = redacting(options.token);
  const published = options.vsce(["publish", "--packagePath", ...options.vsix], { cwd: extensionRoot, token: options.token });
  const output = `${published.stdout}${published.stderr}`;
  for (const line of output.split("\n")) if (line.trim()) options.log(hide(line));
  if (published.status !== 0) throw new Error(`vsce publish ended with code ${published.status}.`);
  options.log(`== Published: ${EXTENSION_ID}@${options.version}`);
};

const run = (command: string, args: readonly string[], cwd: string): void => {
  const result = spawnSync(command, [...args], { cwd, encoding: "utf8", stdio: "inherit" });
  if (result.error) throw new Error(`${command} ${args[0]} could not be started: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} ended with code ${result.status ?? 1}`);
};

/** vsce takes README and license only from the extension's folder; there they are copies for the duration of the run. */
const withMarketplaceFiles = <T>(action: () => T): T => {
  const copies = ["README.md", "LICENSE"].map((name) => ({
    source: path.join(repositoryRoot, name),
    target: path.join(extensionRoot, name),
  }));
  for (const copy of copies) copyFileSync(copy.source, copy.target);
  try {
    return action();
  } finally {
    for (const copy of copies) rmSync(copy.target, { force: true });
  }
};

/** One ignore file per platform alongside the run; the .vscodeignore in the repo stays the universal one. */
const withIgnoreFiles = <T>(action: (ignoreOf: (target: VsixTarget) => string) => T): T => {
  const folder = mkdtempSync(path.join(tmpdir(), "ragents-vscodeignore-"));
  const base = readFileSync(ignoreFile, "utf8");
  const files = new Map(VSIX_TARGETS.map((target) => {
    const file = path.join(folder, `${target}.vscodeignore`);
    writeFileSync(file, ignoreRules(base, target));
    return [target, file] as const;
  }));
  try {
    return action((target) => files.get(target)!);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
};

const packageExtension = async (log: (line: string) => void): Promise<readonly string[]> => {
  run("pnpm", ["--filter", EXTENSION_NAME, "build"], repositoryRoot);
  for (const target of VSIX_TARGETS) {
    if (target === "universal") continue;
    if (isBashTarget(target)) await bundleBash(target, { log });
    await bundleRipgrep(target, { log });
  }
  mkdirSync(outputFolder, { recursive: true });
  const version = readVersion(manifestFile);
  return withIgnoreFiles((ignoreOf) => withMarketplaceFiles(() => VSIX_TARGETS.map((target) => {
    const vsix = path.join(outputFolder, vsixName(version, target));
    run("pnpm", ["dlx", `@vscode/vsce@${VSCE_VERSION}`, ...packageArguments(vsix, target, ignoreOf(target))], extensionRoot);
    log(`== Packaged: ${path.relative(repositoryRoot, vsix)}`);
    return vsix;
  })));
};

const listContents = (log: (line: string) => void): void => withIgnoreFiles((ignoreOf) => withMarketplaceFiles(() => {
  for (const target of VSIX_TARGETS) {
    const listed = runVsce(["ls", "--no-dependencies", "--ignoreFile", ignoreOf(target)], { cwd: extensionRoot });
    if (listed.status !== 0) throw new Error(`vsce ls ended with code ${listed.status}: ${oneLine(listed.stderr)}`);
    const lines = listed.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
    const folders = bundledFolders(target);
    const bundled = folders.map((folder) => [folder, lines.filter((line) => line.startsWith(`${folder}/`)).length] as const);
    const empty = bundled.filter(([, count]) => count === 0).map(([folder]) => folder);
    if (empty.length > 0) throw new Error(`The .vsix for ${target} carries nothing under ${empty.join(", ")}`);
    const isBundle = (line: string) => line.startsWith("dist/bash/") || line.startsWith("dist/rg/");
    const foreign = lines.filter((line) => isBundle(line) && !folders.some((folder) => line.startsWith(`${folder}/`)));
    if (foreign.length > 0) throw new Error(`The .vsix for ${target} carries files of other platforms: ${foreign.slice(0, 3).join(", ")}`);
    log(`== Content ${target}: ${lines.length} files${bundled.map(([folder, count]) => `, ${count} of them under ${folder}`).join("")}`);
    // Without the bundled folders the content of all platforms is the same; it is shown once.
    if (target === "universal") for (const line of lines) log(line);
  }
}));

const main = async (): Promise<void> => {
  const packageOnly = process.argv.includes("--package-only");
  const dryRun = process.argv.includes("--dry-run");
  const unknown = process.argv.slice(2).filter((argument) => argument !== "--dry-run" && argument !== "--package-only");
  if (unknown.length) throw new Error(`Unknown argument: ${unknown.join(" ")}\n${usage}`);
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as Record<string, unknown>;
  assertHostPackageVersion(manifest, expectedHostPackageVersion());
  const token = packageOnly ? "" : process.env[TOKEN_KEY] ?? "";
  if (!packageOnly && !token) throw new Error(`${TOKEN_KEY} is missing: the Marketplace token with write access for ${PUBLISHER}.\n${usage}`);
  if (token) verifyToken(PUBLISHER, token, runVsce);
  const published = packageOnly ? [] : publishedVersions(EXTENSION_ID, runVsce);
  const next = nextVersion(readVersion(manifestFile), published);
  if (!packageOnly) console.log(versionLine(next));
  const packageVersion = readVersion(path.join(repositoryRoot, "package.json"));
  if (!packageOnly && next.version !== packageVersion) {
    throw new Error(`npm package and VS Code extension share one version: the extension would be ${next.version}, the npm package is ${packageVersion}; publish both together (pnpm publish:all)`);
  }
  if (!packageOnly && !dryRun) writeVersion(manifestFile, next.version);
  const plan = publishPlan(manifest, published, next.version);
  console.log(`== ${plan.extensionId}@${plan.version}, VS Code ${(manifest.engines as { vscode: string }).vscode}`);
  const vsix = await packageExtension((line) => console.log(line));
  if (packageOnly) return;
  if (dryRun) {
    listContents((line) => console.log(line));
    console.log("== Dry run: nothing published");
    return;
  }
  publishVsix({ vsix, version: plan.version, token, vsce: runVsce, log: (line) => console.log(line) });
};

const moduleUrl: string | undefined = import.meta.url;
if (moduleUrl && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(moduleUrl)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
