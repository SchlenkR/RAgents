import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access as fsAccess, mkdir as fsMkdir, readFile as fsReadFile, realpath, writeFile as fsWriteFile } from "node:fs/promises";
import path from "node:path";
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type BashOperations,
  type EditOperations,
  type ReadOperations,
  type WriteOperations,
} from "@aicontainer/agent";
import { processGroupExists } from "./managed-process.js";
import { stopUidProcesses, type SessionIdent } from "./session-ident.js";
import type { SessionWorkspace } from "../ragents/workspace-runtime.js";
import { safeProcessEnvironment } from "./safe-environment.js";
import { withGitConfigPairs, type GitConfigPairs } from "./git-config-environment.js";
import { RUN_MARKER_ENV } from "./run-marker.js";
import { allowedWorkspacePath, containsWorkspacePath, expandWorkspaceAlias, type ResolvedWorkspaceRoot } from "./workspace-paths.js";

type Definition = {
  execute: (...args: never[]) => Promise<unknown>;
} & Record<string, unknown>;

export type SandboxTools = unknown[] & {
  shutdown: () => Promise<void>;
};

export interface SandboxHomeEnvironment {
  home: string;
  nugetPackages?: string;
}

export interface SandboxEnvironmentOptions {
  runId: string;
  workspace: Pick<SessionWorkspace, "cwd" | "gitEnv" | "gitConfig" | "extraEnv">;
  ident?: { name: string };
  home?: SandboxHomeEnvironment;
  filesDirectory?: string;
}

const SANDBOX_GIT_CONFIG: GitConfigPairs = [
  ["branch.autoSetupMerge", "false"],
  ["core.hooksPath", "/dev/null"],
  ["core.sharedRepository", "0"],
];

export const sanitizedEnv = (
  source: NodeJS.ProcessEnv,
  { runId, workspace, ident, home, filesDirectory }: SandboxEnvironmentOptions,
): NodeJS.ProcessEnv => ({
  ...withGitConfigPairs(
    { ...safeProcessEnvironment(source), ...workspace.extraEnv },
    [...SANDBOX_GIT_CONFIG, ...(workspace.gitConfig ?? [])],
  ),
  GIT_OPTIONAL_LOCKS: "0",
  HOME: home?.home ?? workspace.cwd,
  USER: ident?.name ?? "root",
  LOGNAME: ident?.name ?? "root",
  CI: "true",
  [RUN_MARKER_ENV]: runId,
  ...(home?.nugetPackages ? { NUGET_PACKAGES: home.nugetPackages } : {}),
  ...(filesDirectory ? { RAGENTS_FILES_DIR: filesDirectory } : {}),
  ...workspace.gitEnv,
});

const DEFAULT_BASH_TIMEOUT_SECONDS = (() => {
  const value = Number(process.env.RAGENTS_BASH_TIMEOUT_SECONDS);
  return Number.isFinite(value) && value > 0 ? value : 600;
})();

const IMAGE_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};

/** Die Umgebung, die ein Arbeitsplatz zu seiner eigenen hinzunimmt: Run-Marker, Git-Regeln und die Zusätze des Arbeitsbereichs. */
export const remoteEnvAdditions = (
  runId: string,
  workspace: Pick<SessionWorkspace, "gitEnv" | "gitConfig" | "extraEnv">,
): Record<string, string> => {
  const env: NodeJS.ProcessEnv = {
    ...withGitConfigPairs({ ...workspace.extraEnv }, [...SANDBOX_GIT_CONFIG, ...(workspace.gitConfig ?? [])]),
    GIT_OPTIONAL_LOCKS: "0",
    CI: "true",
    [RUN_MARKER_ENV]: runId,
    ...workspace.gitEnv,
  };
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
};

type ToolResult = { content?: Array<{ type: string; text?: string }> };

export const withAnnotation = (result: unknown, note: string | undefined): unknown => {
  if (!note || typeof result !== "object" || result === null) return result;
  const typed = result as ToolResult;
  if (!Array.isArray(typed.content)) return result;
  return { ...typed, content: [...typed.content, { type: "text", text: note }] };
};

export const createSandboxTools = async (
  runId: string,
  workspace: SessionWorkspace,
  extraLesePfade: string[],
  ident: SessionIdent | undefined,
  homeEnvironment?: SandboxHomeEnvironment,
  filesDirectory?: string,
  annotate?: (absolutePath: string) => Promise<string | undefined>,
  additionalRoots?: () => Promise<readonly ResolvedWorkspaceRoot[]>,
): Promise<SandboxTools> => {
  let toolOperation: Promise<void> = Promise.resolve();
  let shuttingDown = false;
  const processGroups = new Set<number>();
  const filesRoot = filesDirectory ? await realpath(filesDirectory) : undefined;
  const extraRoots: string[] = [];
  for (const candidatePath of extraLesePfade) {
    try {
      extraRoots.push(await realpath(candidatePath));
    } catch (error) {
      if (workspace.hostSandbox) throw error;
      continue;
    }
  }

  const killProcessGroup = async (pid: number): Promise<void> => {
    if (!await processGroupExists(pid)) {
      processGroups.delete(pid);
      return;
    }
    try {
      process.kill(-pid, "SIGKILL");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ESRCH" || (process.platform === "darwin" && code === "EPERM" && !await processGroupExists(pid))) processGroups.delete(pid);
      else throw error;
    }
  };

  const stopProcessGroup = async (pid: number): Promise<void> => {
    await killProcessGroup(pid);
    const deadline = Date.now() + 5_000;
    while (await processGroupExists(pid)) {
      if (Date.now() >= deadline) throw new Error(`Bash-Prozessgruppe ${pid} konnte nicht beendet werden`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    processGroups.delete(pid);
  };

  const shutdown = async (): Promise<void> => {
    shuttingDown = true;
    for (const controller of remoteControllers) controller.abort();
    await Promise.all([...processGroups].map(killProcessGroup));
    for (;;) {
      const operation = toolOperation;
      await operation.catch(() => {});
      if (operation === toolOperation) break;
    }
    await Promise.all([...processGroups].map(stopProcessGroup));
  };

  const remote = workspace.remote;
  const remoteControllers = new Set<AbortController>();
  const onRemote = (absolutePath: string): boolean =>
    remote !== undefined && containsWorkspacePath(workspace.cwd, path.resolve(absolutePath));

  const assertInsideRoots = async (raw: unknown, roots: readonly string[]): Promise<void> => {
    if (raw === undefined || raw === null || raw === "") return;
    const absolute = path.resolve(workspace.cwd, String(raw));
    if (onRemote(absolute)) return;
    await allowedWorkspacePath(absolute, roots);
  };

  const readOperations: ReadOperations | undefined = remote && {
    readFile: (file) => onRemote(file) ? remote.readFile(file) : fsReadFile(file),
    access: (file) => onRemote(file) ? remote.access(file, "read") : fsAccess(file, constants.R_OK),
    detectImageMimeType: async (file) => IMAGE_MIME_BY_EXTENSION[path.extname(file).toLowerCase()] ?? null,
  };
  const writeOperations: WriteOperations | undefined = remote && {
    writeFile: (file, content) => onRemote(file) ? remote.writeFile(file, content) : fsWriteFile(file, content, "utf-8"),
    mkdir: (directory) => onRemote(directory) ? remote.mkdir(directory) : fsMkdir(directory, { recursive: true }).then(() => undefined),
  };
  const editOperations: EditOperations | undefined = remote && {
    readFile: (file) => onRemote(file) ? remote.readFile(file) : fsReadFile(file),
    writeFile: (file, content) => onRemote(file) ? remote.writeFile(file, content) : fsWriteFile(file, content, "utf-8"),
    access: (file) => onRemote(file) ? remote.access(file, "write") : fsAccess(file, constants.R_OK | constants.W_OK),
  };

  const concurrent = <T extends Definition>(definition: T): T => ({
    ...definition,
    execute: (...args: never[]) => {
      if (shuttingDown) throw new Error("Die Werkzeuge werden killed");
      const signal = args[2] as AbortSignal | undefined;
      if (signal?.aborted) throw new Error("Abgebrochen");
      return workspace.runOperation(() => definition.execute(...args));
    },
  });

  const serial = <T extends Definition>(definition: T): T => {
    const inner = concurrent(definition);
    return {
      ...definition,
      execute: (...args: never[]) => {
        const execute = () => inner.execute(...args);
        const result = toolOperation.then(
          execute,
          execute,
        );
        toolOperation = result.then(() => undefined, () => undefined);
        return result;
      },
    };
  };

  const expandFilesPath = (value: unknown): unknown => {
    if (typeof value !== "string") return value;
    const roots = { RAGENTS_FILES_DIR: filesRoot, RAGENTS_JOURNAL_DIR: workspace.hostSandbox ? workspace.extraEnv?.RAGENTS_JOURNAL_DIR : undefined };
    for (const [name, root] of Object.entries(roots)) {
      if (!root) continue;
      for (const prefix of [`$${name}`, `\${${name}}`]) {
        const relative = value.startsWith("./") ? value.slice(2) : value;
        if (relative === prefix || relative.startsWith(prefix + "/")) return root + relative.slice(prefix.length);
      }
    }
    return value;
  };

  const guarded = <T extends Definition>(definition: T, writing: boolean): T => {
    const checked = {
      ...definition,
      execute: async (...args: never[]) => {
        const params = args[1] as { path?: unknown } | undefined;
        const registeredRoots = await additionalRoots?.() ?? [];
        const aliases = Object.fromEntries(registeredRoots.filter((entry) => entry.alias).map((entry) => [entry.alias!, entry.directory]));
        if (params && typeof params.path === "string") params.path = expandFilesPath(expandWorkspaceAlias(params.path, aliases));
        const root = await workspace.currentRoot();
        const files = [...(remote ? [] : [root]), ...(filesRoot ? [filesRoot] : []), ...registeredRoots.map((entry) => entry.directory)];
        await assertInsideRoots(params?.path, writing ? files : [...files, ...extraRoots]);
        const result = await (definition.execute as (...a: never[]) => Promise<unknown>)(...args);
        if (!writing || !annotate || typeof params?.path !== "string" || onRemote(path.resolve(workspace.cwd, params.path))) return result;
        return withAnnotation(result, await annotate(path.resolve(workspace.cwd, params.path)));
      },
    } as T;
    return writing ? serial(checked) : concurrent(checked);
  };

  const bashOperations: BashOperations = {
    exec: (command, cwd, options) => {
      if (shuttingDown) throw new Error("Die Werkzeuge werden killed");
      if (options.signal?.aborted) throw new Error("Abgebrochen");
      return remote ? startRemoteBash(remote, command, cwd, options) : startBash(command, cwd, options);
    },
  };

  const startRemoteBash = async (
    target: NonNullable<SessionWorkspace["remote"]>,
    command: string,
    cwd: string,
    options: Parameters<BashOperations["exec"]>[2],
  ): Promise<{ exitCode: number | null }> => {
    const controller = new AbortController();
    const forward = () => controller.abort();
    options.signal?.addEventListener("abort", forward);
    remoteControllers.add(controller);
    try {
      return await target.exec(command, cwd, {
        onData: options.onData,
        signal: controller.signal,
        timeoutSeconds: options.timeout ?? DEFAULT_BASH_TIMEOUT_SECONDS,
        env: remoteEnvAdditions(runId, workspace),
      });
    } finally {
      remoteControllers.delete(controller);
      options.signal?.removeEventListener("abort", forward);
    }
  };

  const startBash: BashOperations["exec"] = async (command, cwd, options) => {
      if (shuttingDown) throw new Error("Die Werkzeuge werden killed");
      const roots = await additionalRoots?.() ?? [];
      const extraEnv = Object.fromEntries(roots.filter((root) => root.environmentVariable).map((root) => [root.environmentVariable!, root.directory]));
      if (shuttingDown) throw new Error("Die Werkzeuge werden killed");
      options.signal?.throwIfAborted();
      return new Promise((resolve, reject) => {
        const child = spawn("/bin/bash", ["-c", command], {
          cwd,
          detached: true,
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...sanitizedEnv(options.env ?? process.env, {
            runId,
            workspace,
            ident,
            home: homeEnvironment,
            filesDirectory: filesRoot,
          }), ...extraEnv },
          uid: ident?.uid,
          gid: ident?.gid,
        });
        if (child.pid) processGroups.add(child.pid);
        child.stdout?.on("data", options.onData);
        child.stderr?.on("data", options.onData);
        let killed = false;
        let timedOut = false;
        let stopping: Promise<void> | undefined;
        let processError: unknown;
        const kill = () => {
          killed = true;
          if (!child.pid || stopping) return;
          stopping = killProcessGroup(child.pid).catch((error) => {
            processError = error;
            try {
              child.kill("SIGKILL");
            } catch (failure) {
              cleanup();
              reject(new AggregateError([error, failure], "Bash-Prozess konnte nicht beendet werden"));
            }
          });
        };
        const timeoutSeconds = options.timeout ?? DEFAULT_BASH_TIMEOUT_SECONDS;
        const timer = setTimeout(() => {
          timedOut = true;
          kill();
        }, timeoutSeconds * 1000);
        options.signal?.addEventListener("abort", kill);
        const cleanup = () => {
          if (timer) clearTimeout(timer);
          options.signal?.removeEventListener("abort", kill);
        };
        child.on("error", (failure) => {
          cleanup();
          reject(failure);
        });
        child.on("exit", (code) => {
          cleanup();
          const finish = () => processError
            ? reject(processError)
            : timedOut
              ? reject(new Error(`timeout:${timeoutSeconds}`))
              : resolve({ exitCode: killed ? null : code });
          if (!child.pid) {
            finish();
            return;
          }
          void (stopping ?? Promise.resolve())
            .then(() => stopProcessGroup(child.pid!))
            .then(() => ident ? stopUidProcesses(ident.uid) : undefined)
            .then(finish)
            .catch(reject);
        });
      });
  };

  const tools = [
    guarded(createReadToolDefinition(workspace.cwd, { operations: readOperations }) as unknown as Definition, false),
    guarded(createEditToolDefinition(workspace.cwd, { operations: editOperations }) as unknown as Definition, true),
    guarded(createWriteToolDefinition(workspace.cwd, { operations: writeOperations }) as unknown as Definition, true),
    serial(createBashToolDefinition(workspace.cwd, { operations: bashOperations }) as unknown as Definition),
  ] as SandboxTools;
  Object.defineProperty(tools, "shutdown", { value: shutdown });
  return tools;
};
