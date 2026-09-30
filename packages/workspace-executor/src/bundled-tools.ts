import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

export const WORKSPACE_TOOL_TARGETS = ["win32-x64", "win32-arm64", "darwin-x64", "darwin-arm64", "linux-x64", "linux-arm64"] as const;
export type WorkspaceToolTarget = typeof WORKSPACE_TOOL_TARGETS[number];

export const workspaceToolsPackageName = (target: string): string => `@schlenkr/ragents-tools-${target}`;

export interface BundledToolsOptions {
  readonly root: string;
  readonly distribution: "extension" | "package";
  readonly platform?: NodeJS.Platform;
  readonly arch?: string;
  readonly paths?: typeof path;
  readonly exists?: (file: string) => boolean;
  readonly resolvePackage?: (specifier: string) => string;
}

export interface BundledTools {
  readonly bash: string | undefined;
  readonly rg: string | undefined;
}

export const resolveBundledTools = (options: BundledToolsOptions): BundledTools => {
  const platform = options.platform ?? process.platform;
  const target = `${platform}-${options.arch ?? process.arch}`;
  const paths = options.paths ?? path;
  const exists = options.exists ?? existsSync;
  const packageRoot = (): string => {
    if (!WORKSPACE_TOOL_TARGETS.includes(target as WorkspaceToolTarget)) throw new Error(`Unsupported workstation platform: ${target}`);
    const name = workspaceToolsPackageName(target);
    try {
      const resolve = options.resolvePackage ?? createRequire(paths.join(options.root, "package.json")).resolve;
      return paths.dirname(resolve(`${name}/package.json`));
    } catch {
      throw new Error(`The bundled workstation tools ${name} are missing. Reinstall @schlenkr/ragents with optional dependencies enabled.`);
    }
  };
  const root = options.distribution === "package" ? packageRoot() : options.root;
  const bash = platform === "win32" ? paths.join(root, "dist", "bash", target, "usr", "bin", "bash.exe") : undefined;
  const rg = paths.join(root, "dist", "rg", target, platform === "win32" ? "rg.exe" : "rg");
  if (options.distribution === "package") {
    for (const file of [rg, bash]) {
      if (file !== undefined && !exists(file)) throw new Error(`Bundled workstation tool is missing: ${file}. Reinstall @schlenkr/ragents with optional dependencies enabled.`);
    }
  }
  return { bash, rg: exists(rg) ? rg : undefined };
};
