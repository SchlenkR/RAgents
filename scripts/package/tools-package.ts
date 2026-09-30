import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPackageVersion } from "../../apps/server/src/host-version.ts";
import { WORKSPACE_TOOL_TARGETS, workspaceToolsPackageName } from "../../packages/workspace-executor/src/bundled-tools.ts";
import { bundleBash, type BashTarget, type BundleOptions } from "../vscode/bundle-bash.ts";
import { bundleRipgrep, type RipgrepTarget } from "../vscode/bundle-rg.ts";
import { PACKAGE_AUTHOR, REPOSITORY_URL } from "./build-package.ts";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

type ToolTarget = typeof WORKSPACE_TOOL_TARGETS[number];

interface ToolsBuilders {
  readonly ripgrep: (target: RipgrepTarget, options: BundleOptions) => Promise<unknown>;
  readonly bash: (target: BashTarget, options: BundleOptions) => Promise<unknown>;
}

export interface BuiltToolsPackage {
  readonly directory: string;
  readonly name: string;
  readonly version: string;
}

export const buildToolsPackage = async (
  target: ToolTarget,
  version: string,
  directory: string,
  log: (line: string) => void = () => undefined,
  builders: ToolsBuilders = { ripgrep: bundleRipgrep, bash: bundleBash },
): Promise<BuiltToolsPackage> => {
  const [os, cpu] = target.split("-");
  const name = workspaceToolsPackageName(target);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  await builders.ripgrep(target, { output: path.join(directory, "dist", "rg", target), log });
  if (target === "win32-x64" || target === "win32-arm64") {
    await builders.bash(target, { output: path.join(directory, "dist", "bash", target), log });
  }
  const manifest = {
    name,
    version,
    description: `Bundled workstation tools for RAgents on ${target}`,
    os: [os],
    cpu: [cpu],
    license: "SEE LICENSE IN LICENSE",
    author: PACKAGE_AUTHOR,
    repository: { type: "git", url: `git+${REPOSITORY_URL}.git` },
    files: ["dist"],
    publishConfig: { access: "public" },
  };
  const licenses = `This package redistributes unmodified third-party tools.\n\n`
    + `ripgrep: see dist/rg/${target}/NOTICE.txt and dist/rg/${target}/licenses/ for its source and license texts.\n`
    + (os === "win32" ? `Bash and utilities: see dist/bash/${target}/NOTICE.txt and dist/bash/${target}/licenses/ for the component licenses and corresponding sources.\n` : "");
  await writeFile(path.join(directory, "LICENSE"), licenses);
  await writeFile(path.join(directory, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { directory, name, version };
};

export const buildToolsPackages = async (
  version: string,
  output = path.join(repositoryRoot, "dist", "workspace-tools"),
  targets: readonly ToolTarget[] = WORKSPACE_TOOL_TARGETS,
  log: (line: string) => void = () => undefined,
): Promise<readonly BuiltToolsPackage[]> => {
  const built: BuiltToolsPackage[] = [];
  for (const target of targets) built.push(await buildToolsPackage(target, version, path.join(output, target), log));
  return built;
};

const main = async (): Promise<void> => {
  const requested = process.argv.slice(2);
  const unknown = requested.filter((target) => !(WORKSPACE_TOOL_TARGETS as readonly string[]).includes(target));
  if (unknown.length > 0) throw new Error(`Unknown platform: ${unknown.join(" ")}; expected ${WORKSPACE_TOOL_TARGETS.join(", ")}`);
  const targets = requested.length > 0 ? requested as ToolTarget[] : WORKSPACE_TOOL_TARGETS;
  await buildToolsPackages(readPackageVersion(repositoryRoot), undefined, targets, (line) => console.log(line));
};

const moduleUrl: string | undefined = import.meta.url;
if (moduleUrl && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(moduleUrl)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
