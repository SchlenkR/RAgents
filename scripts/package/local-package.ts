import { spawnSync } from "node:child_process";
import { WORKSPACE_TOOL_TARGETS, workspaceToolsPackageName } from "../../packages/workspace-executor/src/bundled-tools.ts";
import { packageManagerInvocation } from "./package-manager.ts";

export const localPackageVersion = (version: string, commit: string): string => {
  const base = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[\da-zA-Z.-]+)?(?:\+[\da-zA-Z.-]+)?$/.exec(version);
  if (!base) throw new Error(`Invalid package version for a local build: ${version}`);
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("A local build requires a full Git commit");
  return `${base[1]}.${base[2]}.${base[3]}-local.${commit}`;
};

export const assertCleanCheckout = (root: string): void => {
  const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root, encoding: "utf8" });
  if (status.status !== 0) throw new Error(`Cannot check the local build checkout: ${status.stderr.trim() || status.error?.message}`);
  if (status.stdout.trim()) throw new Error("A local package build requires a clean checkout, including untracked files");
};

export const newestPublishedToolVersion = (versions: unknown, name: string): string => {
  const stable = (Array.isArray(versions) ? versions : [versions]).filter((value): value is string =>
    typeof value === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value));
  stable.sort((left, right) => {
    const a = left.split(".").map(Number);
    const b = right.split(".").map(Number);
    return a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;
  });
  const version = stable.at(-1);
  if (!version) throw new Error(`No published stable workstation tool package is available for ${name}`);
  return version;
};

export const publishedToolDependencies = (root: string): Record<string, string> => Object.fromEntries(WORKSPACE_TOOL_TARGETS.map((target) => {
  const name = workspaceToolsPackageName(target);
  const invocation = packageManagerInvocation("npm", ["view", name, "versions", "--json"]);
  const result = spawnSync(invocation.command, invocation.args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Cannot resolve published workstation tools ${name}: ${result.stderr.trim() || result.error?.message}`);
  return [name, newestPublishedToolVersion(JSON.parse(result.stdout) as unknown, name)];
}));
