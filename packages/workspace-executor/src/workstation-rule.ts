import { existsSync, readdirSync } from "node:fs";
import { chmod, lstat, mkdir, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { PROCESS_RESOURCE_PATHS, type WorkspaceAccessRule } from "./access-rule.js";
import type { WorkspaceGrant } from "./grants.js";
import { canonicalSandboxPath, sandboxHomeRoots, sandboxSharedWritable, sandboxToolchainDirectories, sandboxWriteProtectedNames } from "./os-process-sandbox.js";
import { containsWorkspacePath } from "./paths.js";

export interface WorkstationRuleOptions {
  readonly root: string;
  readonly offered: readonly string[];
  readonly storage: string;
  readonly runFolder?: string;
  readonly data: readonly string[];
  readonly grants: readonly WorkspaceGrant[];
  readonly environment: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
  readonly home?: string;
  readonly temporary?: string;
  readonly readable?: readonly string[];
}

const beside = (entry: string, blocked: readonly string[]): readonly string[] => {
  if (blocked.some((root) => containsWorkspacePath(root, entry))) return [];
  if (!blocked.some((root) => containsWorkspacePath(entry, root))) return [entry];
  return readdirSync(entry).flatMap((name) => beside(path.join(entry, name), blocked));
};

export const workstationAccessRule = async (options: WorkstationRuleOptions): Promise<WorkspaceAccessRule> => {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();
  const literal = [options.root, options.storage, home, ...options.offered, ...options.data, ...options.readable ?? []];
  const canonical = (entries: readonly string[]): readonly string[] => [...new Set(entries.map(canonicalSandboxPath))];
  const data = canonical(options.data);
  const root = canonicalSandboxPath(options.root);
  const runFolder = options.runFolder === undefined ? undefined : canonicalSandboxPath(options.runFolder);
  if (data.some((entry) => containsWorkspacePath(root, entry)
    || containsWorkspacePath(entry, root) && !(runFolder && containsWorkspacePath(runFolder, root)))) {
    throw new Error("The isolated working folder must be separate from workstation data and other run storage. Move the workstation data and runs folders outside the project, choose another working folder, or switch the run to Full access.");
  }
  const blocked = canonical([
    home, ...platform === "win32" ? [path.dirname(home)] : sandboxHomeRoots(platform), options.temporary ?? tmpdir(), "/tmp", "/var/tmp", ...data,
    ...platform === "darwin" ? ["/var/folders"] : [],
    ...platform === "linux" ? ["/run/user", "/var/run/docker.sock", "/run/docker.sock"].filter(existsSync) : [],
  ]);
  const storage = canonicalSandboxPath(options.storage);
  const caches = [options.environment.NUGET_PACKAGES ?? path.join(home, ".nuget", "packages"),
    path.join(home, "Library", "Caches", "ms-playwright"), path.join(home, ".cache", "ms-playwright"),
    ...options.environment.PLAYWRIGHT_BROWSERS_PATH && options.environment.PLAYWRIGHT_BROWSERS_PATH !== "0" ? [options.environment.PLAYWRIGHT_BROWSERS_PATH] : []].filter(existsSync);
  const allowed = (entries: readonly string[]): readonly string[] => canonical(entries)
    .flatMap((entry) => beside(entry, data.filter((root) => !containsWorkspacePath(root, entry))));
  const toolchains = sandboxToolchainDirectories(options.environment, blocked);
  if (canonical([...literal, ...caches, ...toolchains]).some((entry) => /[*?\[\]\r\n]/.test(entry))) {
    throw new Error("The isolated workstation needs folder paths without pattern characters or line breaks. Rename the folder or switch the run to Full access.");
  }
  const grants = await Promise.all(options.grants.map(async (grant) => ({
    ...grant,
    directory: await stat(grant.path).then((info) => info.isDirectory(), (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
      throw error;
    }),
  })));
  return {
    blocked,
    processNamespaces: PROCESS_RESOURCE_PATHS,
    readable: [...canonical(options.offered).flatMap((entry) => beside(entry, data)),
      ...allowed([options.root, storage, ...caches, ...options.readable ?? [], ...toolchains])],
    writable: allowed([options.root, path.join(storage, "home"), path.join(storage, "tmp"), ...sandboxSharedWritable(platform)]),
    grants,
    readOnly: canonical([...caches, ...options.readable ?? [], ...toolchains,
      path.dirname(path.dirname(process.execPath)), ...(options.environment.PATH ?? "").split(path.delimiter).filter((entry) => path.isAbsolute(entry))]),
    writeProtected: [{ root: canonicalSandboxPath(process.cwd()), names: sandboxWriteProtectedNames }],
  };
};

export const prepareWorkstationFolders = async (storage: string): Promise<{ readonly home: string; readonly temporary: string }> => {
  const home = path.join(storage, "home");
  const temporary = path.join(storage, "tmp");
  const parent = path.dirname(storage);
  for (const directory of [parent, storage, home, temporary]) {
    await mkdir(directory, { recursive: directory === parent, mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    if (!(await lstat(directory)).isDirectory() || directory !== parent && !containsWorkspacePath(canonicalSandboxPath(storage), canonicalSandboxPath(directory))) {
      throw new Error("The run's workstation storage must contain real home and temp directories. Remove the redirected directory before retrying isolated access.");
    }
    await chmod(directory, 0o700);
  }
  return { home: canonicalSandboxPath(home), temporary: canonicalSandboxPath(temporary) };
};

export const workstationCacheEnvironment = (home: string, temporary: string, source: NodeJS.ProcessEnv): Readonly<Record<string, string>> => {
  const packages = source.NUGET_PACKAGES ?? path.join(homedir(), ".nuget", "packages");
  return {
    HOME: home,
    USERPROFILE: home,
    TMPDIR: temporary,
    TMP: temporary,
    TEMP: temporary,
    CLAUDE_CODE_TMPDIR: temporary,
    XDG_CACHE_HOME: path.join(home, ".cache"),
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_DATA_HOME: path.join(home, ".local", "share"),
    XDG_RUNTIME_DIR: temporary,
    DOTNET_CLI_HOME: home,
    DOTNET_BUNDLE_EXTRACT_BASE_DIR: path.join(temporary, "dotnet-bundles"),
    NUGET_PACKAGES: path.join(home, ".nuget", "packages"),
    NUGET_HTTP_CACHE_PATH: path.join(home, ".cache", "nuget"),
    ...existsSync(packages) ? { NUGET_FALLBACK_PACKAGES: packages } : {},
    npm_config_cache: path.join(home, ".npm"),
    ...process.platform !== "win32" ? { npm_config_script_shell: "/bin/sh" } : {},
    PNPM_HOME: path.join(home, ".local", "share", "pnpm"),
    COREPACK_HOME: path.join(home, ".cache", "corepack"),
    COREPACK_ENV_FILE: "0",
    MSBUILDDISABLENODEREUSE: "1",
    DOTNET_CLI_USE_MSBUILD_SERVER: "0",
    UseSharedCompilation: "false",
    ...source.DOTNET_ROOT ? { DOTNET_ROOT: source.DOTNET_ROOT } : {},
  };
};
