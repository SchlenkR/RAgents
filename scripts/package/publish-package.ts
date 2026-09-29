import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compareVersions, readVersion, releaseVersion, versionLine, writeHostPackageVersion, writeVersion } from "../publish-version.ts";
import { buildPackage, PACKAGE_FOLDER, PACKAGE_NAME } from "./build-package.ts";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const usage = `Usage: pnpm publish:package [--dry-run]
Builds the package ${PACKAGE_NAME} and publishes it on npm. The token comes from the
environment variable npm_key. --dry-run passes the dry run through to npm and publishes nothing.
The version is in the root package.json; before building, the script raises the last place
above the last published version, in a dry run only in the output.`;

const REGISTRY_TOKEN_KEY = "npm_config_//registry.npmjs.org/:_authToken";

export interface NpmResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type NpmRunner = (args: readonly string[], options: { cwd: string; token?: string }) => NpmResult;

/** The token goes only as configuration into the child process's environment, never onto the command line. */
export const publishEnvironment = (token: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv =>
  ({ ...base, [REGISTRY_TOKEN_KEY]: token });

/** Everything that comes from npm goes through this mask so that the token does not show up even in an error message. */
export const redacting = (token: string) => (text: string): string => token ? text.split(token).join("<npm_key>") : text;

/** An error message is one line; npm's output is therefore moved onto one. */
export const oneLine = (text: string): string => text.split("\n").map((line) => line.trim()).filter(Boolean).join("; ");

const runNpm: NpmRunner = (args, options) => {
  const result = spawnSync("npm", [...args], {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.token ? publishEnvironment(options.token) : process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw new Error(`npm ${args[0]} could not be started: ${result.error.message}`);
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};

/** The versions already on npm; a package unknown there is the empty list, not an error. */
export const publishedVersions = (name: string, npm: NpmRunner): readonly string[] => {
  const result = npm(["view", name, "versions", "--json"], { cwd: repositoryRoot });
  if (result.status !== 0) {
    if (/E404|404 Not Found/.test(`${result.stdout}\n${result.stderr}`)) return [];
    throw new Error(`npm view ${name} versions ended with code ${result.status}: ${oneLine(result.stderr)}`);
  }
  const parsed = JSON.parse(result.stdout.trim() || "[]") as string | readonly string[];
  return typeof parsed === "string" ? [parsed] : parsed;
};

/** The highest version on npm; a package unknown there has none. */
export const latestPublishedVersion = (npm: NpmRunner = runNpm, name = PACKAGE_NAME): string | undefined =>
  [...publishedVersions(name, npm)].sort(compareVersions).at(-1);

export interface PublishPlan {
  readonly name: string;
  readonly version: string;
  readonly hostVersion: string;
}

/** What must be right before a publish: the built manifest and a version that does not yet exist on npm. */
export const publishPlan = (manifest: Record<string, unknown>, published: readonly string[], version: string): PublishPlan => {
  const { name } = manifest as { name?: unknown };
  const access = (manifest.publishConfig as { access?: unknown } | undefined)?.access;
  const hostVersion = (manifest.ragents as { hostVersion?: unknown } | undefined)?.hostVersion;
  if (name !== PACKAGE_NAME) throw new Error(`The built package is named ${String(name)}, but ${PACKAGE_NAME} is published`);
  if (access !== "public") throw new Error(`${PACKAGE_NAME} has a scope and needs publishConfig.access "public", not ${JSON.stringify(access)}`);
  if (!/^\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?$/.test(version)) {
    throw new Error(`The version ${JSON.stringify(version)} is not a version; it is the version in the root package.json`);
  }
  if (typeof hostVersion !== "string" || !/^[0-9a-f]{40}$/.test(hostVersion)) {
    throw new Error("The package lacks ragents.hostVersion as a full Git commit; it is built only from a checkout");
  }
  if (published.includes(version)) {
    throw new Error(`${PACKAGE_NAME}@${version} is already on npm (there: ${published.join(", ")}); `
      + "raise version in the root package.json and rebuild");
  }
  return { name: PACKAGE_NAME, version, hostVersion };
};

export interface PublishOptions {
  readonly directory: string;
  readonly version: string;
  readonly token: string;
  readonly dryRun: boolean;
  readonly npm: NpmRunner;
  readonly log: (line: string) => void;
}

/** npm reports a missing organization as 404; without the hint you look for the error in the package. */
const scopeAdvice = (output: string): string => /Scope not found/i.test(output)
  ? ` The organization ${PACKAGE_NAME.split("/")[0]} does not exist on npm or the token may not use it: `
    + "create it on npmjs.com or grant the token access to the scope."
  : "";

/** Publishes the built folder; exit 0 of npm publish is the confirmation. */
export const publishDirectory = (options: PublishOptions): void => {
  const hide = redacting(options.token);
  const published = options.npm(["publish", "--access", "public", ...options.dryRun ? ["--dry-run"] : []], { cwd: options.directory, token: options.token });
  const output = `${published.stdout}${published.stderr}`;
  for (const line of output.split("\n")) if (line.trim()) options.log(hide(line));
  if (published.status !== 0) throw new Error(`npm publish ended with code ${published.status}.${scopeAdvice(output)}`);
  if (options.dryRun) {
    options.log("== Dry run: nothing published");
    return;
  }
  options.log(`== Published: ${PACKAGE_NAME}@${options.version}`);
};

const main = async (): Promise<void> => {
  const dryRun = process.argv.includes("--dry-run");
  const unknown = process.argv.slice(2).filter((argument) => argument !== "--dry-run");
  if (unknown.length) throw new Error(`Unknown argument: ${unknown.join(" ")}\n${usage}`);
  const token = process.env.npm_key;
  if (!token) throw new Error(`npm_key is missing: the npm token with write access to ${PACKAGE_NAME}.\n${usage}`);
  const manifestFile = path.join(repositoryRoot, "package.json");
  const published = publishedVersions(PACKAGE_NAME, runNpm);
  const extensionManifestFile = path.join(repositoryRoot, "apps", "vscode", "package.json");
  const next = releaseVersion([readVersion(manifestFile), readVersion(extensionManifestFile)], published);
  console.log(versionLine(next));
  if (!dryRun) {
    writeVersion(manifestFile, next.version);
    writeVersion(extensionManifestFile, next.version);
    writeHostPackageVersion(extensionManifestFile, next.version);
  }
  const built = await buildPackage(path.join(repositoryRoot, "dist", PACKAGE_FOLDER));
  const plan = publishPlan(built.manifest, published, next.version);
  console.log(`== ${plan.name}@${plan.version} from host ${plan.hostVersion.slice(0, 12)}, ${built.fileCount} files, ${(built.byteSize / 1024 / 1024).toFixed(1)} MB`);
  publishDirectory({ directory: built.directory, version: plan.version, token, dryRun, npm: runNpm, log: (line) => console.log(line) });
};

const moduleUrl: string | undefined = import.meta.url;
if (moduleUrl && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(moduleUrl)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
