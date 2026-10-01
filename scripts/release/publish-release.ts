import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WORKSPACE_TOOL_TARGETS, workspaceToolsPackageName } from "../../packages/workspace-executor/src/bundled-tools.ts";
import { PACKAGE_NAME } from "../package/build-package.ts";
import { publishedVersions as npmVersions, runNpm } from "../package/publish-package.ts";
import { readVersion, releaseVersion, writeHostPackageVersion, writeVersion } from "../publish-version.ts";
import { EXTENSION_ID, publishedVersions as marketplaceVersions, runVsce } from "../vscode/publish-extension.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
export const releasePattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const usage = `Usage: pnpm release [--dry-run] [--version X.Y.Z]
Builds every platform through GitHub Actions, then publishes all channels locally.
The checkout must be committed and pushed. This command never commits or pushes files.
--dry-run reads the public versions and prints the plan without changing files or starting CI.
--version resumes that exact release; otherwise one version above all channels is selected.
Publishing uses local npm_key, AZURE_DEVOPS_VSCE_RAGENTS_PAT and gh auth login.
GitHub Actions only builds and checks artifacts; it needs no publishing secrets.`;

export interface ReleaseOptions {
  readonly dryRun: boolean;
  readonly version?: string;
}

export const parseArguments = (args: readonly string[]): ReleaseOptions => {
  const versionIndex = args.indexOf("--version");
  const version = versionIndex < 0 ? undefined : args[versionIndex + 1];
  const remaining = args.filter((_, index) => index !== versionIndex && index !== versionIndex + 1 || versionIndex < 0);
  if (remaining.some((argument) => argument !== "--dry-run") || args.filter((argument) => argument === "--dry-run").length > 1) {
    throw new Error(usage);
  }
  if (versionIndex >= 0 && (!version || !releasePattern.test(version))) throw new Error(`Expected --version X.Y.Z.\n${usage}`);
  return { dryRun: args.includes("--dry-run"), ...(version ? { version } : {}) };
};

export const run = (command: string, args: readonly string[]): string => {
  const result = spawnSync(command, [...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args[0]} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
};

export const chooseVersion = (current: readonly string[], published: readonly string[], requested?: string): string => {
  const version = requested ?? releaseVersion(current, published).version;
  if (!releasePattern.test(version)) throw new Error(`All release channels require a stable X.Y.Z version, received ${version}`);
  return version;
};

const nextRelease = (): string => {
  const npm = [PACKAGE_NAME, ...WORKSPACE_TOOL_TARGETS.map(workspaceToolsPackageName)].flatMap((name) => npmVersions(name, runNpm));
  const tags = run("gh", ["api", "--paginate", "repos/{owner}/{repo}/tags", "--jq", ".[].name"])
    .split("\n").filter((tag) => tag.startsWith("v")).map((tag) => tag.slice(1));
  const reserved = run("gh", ["api", "--paginate", "repos/{owner}/{repo}/releases", "--jq", ".[].tag_name"])
    .split("\n").filter((tag) => tag.startsWith("v")).map((tag) => tag.slice(1));
  return chooseVersion(
    [readVersion(path.join(root, "package.json")), readVersion(path.join(root, "apps/vscode/package.json"))],
    [...npm, ...marketplaceVersions(EXTENSION_ID, runVsce), ...tags, ...reserved],
  );
};

export const setReleaseVersion = (version: string): void => {
  if (!releasePattern.test(version)) throw new Error(`Invalid release version: ${version}`);
  writeVersion(path.join(root, "package.json"), version);
  writeVersion(path.join(root, "apps/vscode/package.json"), version);
  writeHostPackageVersion(path.join(root, "apps/vscode/package.json"), version);
};

interface ReleaseActions {
  readonly preparedSource: (version: string) => string | undefined;
  readonly verifyAccess: () => void;
  readonly build: (version: string, source: string, directory: string) => Promise<void>;
  readonly publish: (directory: string | undefined, version: string, source: string) => void;
}

export const completeRelease = async (version: string, source: string, dirty: boolean, actions: ReleaseActions): Promise<void> => {
  const prepared = actions.preparedSource(version);
  if (prepared) {
    console.log(`== Resuming saved release ${version} from ${prepared}; no rebuild needed.`);
    actions.publish(undefined, version, prepared);
    return;
  }
  if (dirty) throw new Error("Commit and push the intended changes before building a new release. Use --dry-run to review the plan with a dirty checkout.");
  actions.verifyAccess();
  const directory = mkdtempSync(path.join(tmpdir(), "ragents-release-"));
  console.log(`== To resume a failed publication: pnpm release --version ${version}`);
  try {
    await actions.build(version, source, directory);
    actions.publish(directory, version, source);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

export const main = async (args = process.argv.slice(2)): Promise<void> => {
  if (args.includes("--help")) { console.log(usage); return; }
  const options = parseArguments(args);
  const source = run("git", ["rev-parse", "HEAD"]);
  const dirty = Boolean(run("git", ["status", "--porcelain"]));
  const version = options.version ?? nextRelease();
  console.log(`== Release ${version} from ${source}`);
  console.log("== Channels: npm host + six tools packages; Marketplace universal + six VSIX targets; six GitHub standalone archives + install scripts");
  if (options.dryRun) {
    console.log(`== Dry run: nothing changed or published${dirty ? "; uncommitted changes are not part of this commit" : ""}`);
    return;
  }
  const { preparedReleaseSource, publishArtifacts, verifyPublishAccess } = await import("./release-artifacts.ts");
  const { buildRelease } = await import("./build-release.ts");
  await completeRelease(version, source, dirty, { preparedSource: preparedReleaseSource, verifyAccess: verifyPublishAccess, build: buildRelease, publish: publishArtifacts });
};

const entry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (entry) {
  const action = process.argv[2] === "--ci-version" ? async () => {
    if (process.env.GITHUB_ACTIONS !== "true" || !process.env.GITHUB_OUTPUT) throw new Error("--ci-version is only for GitHub Actions");
    const version = process.env.RELEASE_VERSION || (process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME?.replace(/^v/, "") : undefined);
    if (!version || !releasePattern.test(version)) throw new Error("Release version must be X.Y.Z");
    setReleaseVersion(version);
    appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\nsource=${run("git", ["rev-parse", "HEAD"])}\n`);
    console.log(`== Release ${version}`);
  } : main;
  action().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
