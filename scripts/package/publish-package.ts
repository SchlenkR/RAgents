import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compareVersions } from "../publish-version.ts";
import { packageManagerInvocation } from "../release/package-manager.ts";
import { PACKAGE_NAME } from "./build-package.ts";
import { type BuiltToolsPackage } from "./tools-package.ts";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

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

export const runNpm: NpmRunner = (args, options) => {
  const invocation = packageManagerInvocation("npm", args);
  const result = spawnSync(invocation.command, [...invocation.args], {
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
  if (manifest.version !== version) throw new Error(`The built package version ${String(manifest.version)} does not match the release ${version}`);
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
  readonly name?: string;
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
  options.log(`== Published: ${options.name ?? PACKAGE_NAME}@${options.version}`);
};

export const publishToolsPackages = (packages: readonly BuiltToolsPackage[], options: Omit<PublishOptions, "directory" | "name">): void => {
  for (const built of packages) {
    if (built.version !== options.version) throw new Error(`${built.name}@${built.version} does not match the release ${options.version}`);
    if (publishedVersions(built.name, options.npm).includes(built.version)) {
      options.log(`== Already published: ${built.name}@${built.version}`);
      continue;
    }
    publishDirectory({ ...options, name: built.name, directory: built.directory });
  }
};

const main = async (): Promise<void> => {
  const { main } = await import("../release/publish-release.ts");
  await main();
};

const moduleUrl: string | undefined = import.meta.url;
if (moduleUrl && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(moduleUrl)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
