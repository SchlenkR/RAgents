import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type BashOperations,
} from "@ragents/agent";
import { bashLaunch } from "./bash-launch.js";
import type { WorkspaceProcessContext } from "./context.js";
import { WorkspaceOperationError } from "./errors.js";
import { MSYS_CALL_ENV, processGroupExists, stopMsysCall, stopProcessTree } from "./managed-process.js";
import type { WorkspaceModuleFactory, WorkspaceOperation } from "./module.js";
import { sandboxedLaunch } from "./process-sandbox.js";
import { stopUidProcesses } from "./session-ident.js";
import { allowedWorkspacePath, expandWorkspaceAlias, rootsOfFields, type OperationFootprint } from "./paths.js";

export interface ToolUpdate {
  content?: ReadonlyArray<{ type: string; text?: string }>;
}

type ToolExecute = (
  toolCallId: string,
  input: unknown,
  signal: AbortSignal | undefined,
  onUpdate: ((update: ToolUpdate) => void) | undefined,
) => Promise<unknown>;

export interface SandboxToolCall {
  toolCallId: string;
  signal?: AbortSignal;
  onUpdate?: (update: ToolUpdate) => void;
}

export interface SandboxTools {
  readonly tools: ReadonlyMap<string, (input: unknown, call: SandboxToolCall) => Promise<unknown>>;
  shutdown: () => Promise<void>;
}

type ToolResult = { content?: Array<{ type: string; text?: string }>; details?: unknown };

/** The state of a file that the model saw last; the host keeps it per actor and passes it along, the model never names it. */
export interface SeenFile {
  readonly file: string;
  readonly hash: string;
  /** Only after a read: the section that was read. */
  readonly read?: { readonly offset?: number; readonly limit?: number };
}

/** The input of the file tools: what the model passes, and only on its direct call the state it has seen (`null`: none). */
type FileToolInput = {
  readonly path?: unknown;
  readonly offset?: number;
  readonly limit?: number;
  readonly content?: string;
  readonly seen?: SeenFile | null;
};

type FileToolName = "read" | "edit" | "write";

const unchangedNotice = "Unchanged since the last read in this conversation; the earlier content still applies.";

const sha256 = (content: Buffer | string): string => createHash("sha256").update(content).digest("hex");

/** The content hash of a file; a missing file has none. */
const currentHash = async (file: string): Promise<string | undefined> => {
  try {
    return sha256(await readFile(file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
};

const detailHash = (result: unknown, name: FileToolName): string => {
  const hash = (result as { details?: { contentHash?: unknown } }).details?.contentHash;
  if (typeof hash !== "string") throw new Error(`The tool ${name} reports no content hash`);
  return hash;
};

/** A result and an error name the path as the model passed it, not the resolved one. */
const withShownPath = (result: unknown, resolved: string, shown: string): unknown => {
  const typed = result as ToolResult;
  if (resolved === shown || !Array.isArray(typed.content)) return result;
  return { ...typed, content: typed.content.map((part) => typeof part.text === "string" ? { ...part, text: part.text.replaceAll(resolved, shown) } : part) };
};

const errorWithShownPath = (error: unknown, resolved: string, shown: string): unknown => {
  if (resolved === shown || !(error instanceof Error) || !error.message.includes(resolved)) return error;
  const message = error.message.replaceAll(resolved, shown);
  return error instanceof WorkspaceOperationError
    ? new WorkspaceOperationError(error.code, message, error.status)
    : new Error(message, { cause: error });
};

export const withAnnotation = (result: unknown, note: string | undefined): unknown => {
  if (!note || typeof result !== "object" || result === null) return result;
  const typed = result as ToolResult;
  if (!Array.isArray(typed.content)) return result;
  return { ...typed, content: [...typed.content, { type: "text", text: note }] };
};

/** Resolves `$RAGENTS_..._DIR` and `${...}` at the start of a path against the variables of the context. */
const expandPathVariables = (value: string, variables: Readonly<Record<string, string>>): string => {
  for (const [name, root] of Object.entries(variables)) {
    for (const prefix of [`$${name}`, `\${${name}}`]) {
      const relative = value.startsWith("./") ? value.slice(2) : value;
      if (relative === prefix || relative.startsWith(prefix + "/")) return path.join(root, relative.slice(prefix.length));
    }
  }
  return value;
};

export const createSandboxTools = async (
  runId: string,
  contextFor: () => Promise<WorkspaceProcessContext>,
  annotate?: (absolutePath: string) => Promise<string | undefined>,
): Promise<SandboxTools> => {
  const initial = await contextFor();
  const cwd = initial.cwd;
  const onWindows = process.platform === "win32";
  let toolOperation: Promise<void> = Promise.resolve();
  let shuttingDown = false;
  const processGroups = new Set<number>();
  const msysCalls = new Map<number, { readonly bash: string; readonly env: NodeJS.ProcessEnv; readonly marker: string }>();

  const killProcessGroup = async (pid: number): Promise<void> => {
    if (onWindows) {
      stopProcessTree(pid);
      const call = msysCalls.get(pid);
      msysCalls.delete(pid);
      if (call) await stopMsysCall(call.bash, call.env, call.marker);
      processGroups.delete(pid);
      return;
    }
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
      if (Date.now() >= deadline) throw new Error(`Bash process group ${pid} could not be ended`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    processGroups.delete(pid);
  };

  const shutdown = async (): Promise<void> => {
    shuttingDown = true;
    await Promise.all([...processGroups].map(killProcessGroup));
    for (;;) {
      const operation = toolOperation;
      await operation.catch(() => {});
      if (operation === toolOperation) break;
    }
    await Promise.all([...processGroups].map(stopProcessGroup));
  };

  const assertInsideRoots = async (raw: unknown, roots: readonly string[]): Promise<void> => {
    if (raw === undefined || raw === null || raw === "") return;
    await allowedWorkspacePath(path.resolve(cwd, String(raw)), roots);
  };

  const concurrent = (execute: ToolExecute): ToolExecute => (toolCallId, input, signal, onUpdate) => {
    if (shuttingDown) throw new Error("The tools are being killed");
    if (signal?.aborted) throw new Error("Cancelled");
    const run = () => execute(toolCallId, input, signal, onUpdate);
    return initial.runOperation ? initial.runOperation(run) : run();
  };

  const serial = (execute: ToolExecute): ToolExecute => {
    const inner = concurrent(execute);
    return (toolCallId, input, signal, onUpdate) => {
      const call = () => inner(toolCallId, input, signal, onUpdate);
      const result = toolOperation.then(call, call);
      toolOperation = result.then(() => undefined, () => undefined);
      return result;
    };
  };

  /** On a direct call of the model a write checks the seen state, and a repeated read of an unchanged section answers briefly. */
  const checkedAgainstSeen = async (name: FileToolName, file: string, shown: string, input: FileToolInput, seen: SeenFile | null): Promise<ToolResult | undefined> => {
    if (name === "read") {
      const sameView = seen?.read !== undefined && seen.file === file && seen.read.offset === input.offset && seen.read.limit === input.limit;
      return sameView && await currentHash(file) === seen.hash ? { content: [{ type: "text", text: unchangedNotice }], details: { seen } } : undefined;
    }
    const current = await currentHash(file);
    if (current === undefined) return undefined;
    if (seen === null || seen.file !== file) throw new WorkspaceOperationError("workspace-file-unread", `${shown}: read the file with read first.`, 409);
    if (seen.hash !== current) {
      throw new WorkspaceOperationError("workspace-file-changed",
        `${shown}: the file was changed since it was read (by the user, a formatter or another actor); read it again.`, 409);
    }
    return undefined;
  };

  const seenAfter = (name: FileToolName, file: string, input: FileToolInput, result: unknown): SeenFile => {
    if (name === "write") return { file, hash: sha256(input.content ?? "") };
    if (name === "edit") return { file, hash: detailHash(result, name) };
    return {
      file,
      hash: detailHash(result, name),
      read: { ...input.offset === undefined ? {} : { offset: input.offset }, ...input.limit === undefined ? {} : { limit: input.limit } },
    };
  };

  const guarded = (name: FileToolName, execute: ToolExecute): ToolExecute => {
    const writing = name !== "read";
    const checked: ToolExecute = async (toolCallId, input, signal, onUpdate) => {
      const { seen, ...params } = (input ?? {}) as FileToolInput;
      const context = await contextFor();
      const shown = typeof params.path === "string" ? params.path : undefined;
      const requested = shown === undefined
        ? undefined
        : expandPathVariables(expandWorkspaceAlias(shown, context.workspaceAliases ?? {}), context.pathVariables ?? {});
      try {
        const writable = [context.root, ...context.additionalRoots ?? []];
        await assertInsideRoots(requested ?? params.path, writing ? writable : [...writable, ...context.readOnlyRoots ?? []]);
        const file = requested === undefined ? undefined : path.resolve(cwd, requested);
        const tracked = seen !== undefined && file !== undefined && shown !== undefined;
        const early = tracked ? await checkedAgainstSeen(name, file, shown, params, seen) : undefined;
        if (early) return early;
        const result = await execute(toolCallId, requested === undefined ? params : { ...params, path: requested }, signal, onUpdate);
        const recorded = tracked ? { ...result as ToolResult, details: { ...(result as ToolResult).details as object, seen: seenAfter(name, file, params, result) } } : result;
        const annotated = writing && annotate && file !== undefined ? withAnnotation(recorded, await annotate(file)) : recorded;
        return requested === undefined || shown === undefined ? annotated : withShownPath(annotated, requested, shown);
      } catch (error) {
        throw requested === undefined || shown === undefined ? error : errorWithShownPath(error, requested, shown);
      }
    };
    return writing ? serial(checked) : concurrent(checked);
  };

  /** The folder of a bash call: relative to the working directory or with an alias, the same on every machine, therefore never absolute, and always in a root of the run. */
  const inFolder = (execute: ToolExecute): ToolExecute => async (toolCallId, input, signal, onUpdate) => {
    const params = input as { cwd?: unknown } | undefined;
    if (params?.cwd === undefined) return execute(toolCallId, input, signal, onUpdate);
    const requested = params.cwd;
    if (typeof requested !== "string" || requested === "" || path.isAbsolute(requested)) {
      throw new WorkspaceOperationError("workspace-path-invalid",
        `cwd names a folder relative to the working directory or starts with an alias like @actors; ${JSON.stringify(requested)} is neither`, 400);
    }
    const context = await contextFor();
    const directory = await allowedWorkspacePath(path.resolve(cwd, expandWorkspaceAlias(requested, context.workspaceAliases ?? {})),
      [context.root, ...context.additionalRoots ?? [], ...context.readOnlyRoots ?? []]);
    if (!(await stat(directory).catch(() => undefined))?.isDirectory()) {
      throw new WorkspaceOperationError("workspace-path-not-found", `The folder ${requested} does not exist`, 404);
    }
    return execute(toolCallId, { ...params, cwd: directory }, signal, onUpdate);
  };

  const startBash: BashOperations["exec"] = async (command, commandCwd, options) => {
      if (shuttingDown) throw new Error("The tools are being killed");
      const context = await contextFor();
      if (shuttingDown) throw new Error("The tools are being killed");
      options.signal?.throwIfAborted();
      const bash = bashLaunch({ bash: context.bash, rg: context.rg }, command, context.env);
      const launch = await sandboxedLaunch(context, bash);
      if (shuttingDown) throw new Error("The tools are being killed");
      options.signal?.throwIfAborted();
      const marker = onWindows ? randomUUID() : undefined;
      return new Promise((resolve, reject) => {
        const child = spawn(launch.command, [...launch.args], {
          cwd: commandCwd,
          detached: !onWindows,
          stdio: ["ignore", "pipe", "pipe"],
          env: marker === undefined ? bash.env : { ...bash.env, [MSYS_CALL_ENV]: marker },
          uid: context.uid,
          gid: context.gid,
          windowsHide: true,
        });
        if (child.pid) processGroups.add(child.pid);
        if (child.pid && marker !== undefined && context.bash !== undefined) msysCalls.set(child.pid, { bash: context.bash, env: context.env, marker });
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
              reject(new AggregateError([error, failure], "Bash process could not be ended"));
            }
          });
        };
        const timer = setTimeout(() => {
          timedOut = true;
          kill();
        }, options.timeout * 1000);
        options.signal?.addEventListener("abort", kill);
        const cleanup = () => {
          if (timer) clearTimeout(timer);
          options.signal?.removeEventListener("abort", kill);
        };
        child.on("error", (failure) => {
          cleanup();
          reject(failure);
        });
        child.on("close", (code) => {
          cleanup();
          const finish = () => processError
            ? reject(processError)
            : timedOut
              ? reject(new Error(`timeout:${options.timeout}`))
              : resolve({ exitCode: killed ? null : code });
          if (!child.pid) {
            finish();
            return;
          }
          void (stopping ?? Promise.resolve())
            .then(() => stopProcessGroup(child.pid!))
            .then(() => context.uid === undefined ? undefined : stopUidProcesses(context.uid))
            .then(finish)
            .catch(reject);
        });
      });
  };

  const bashOperations: BashOperations = {
    exec: (command, commandCwd, options) => {
      if (shuttingDown) throw new Error("The tools are being killed");
      if (options.signal?.aborted) throw new Error("Cancelled");
      return startBash(command, commandCwd, options);
    },
  };

  const executeOf = (definition: { execute: unknown }): ToolExecute => definition.execute as ToolExecute;
  const wrapped: ReadonlyArray<readonly [string, ToolExecute]> = [
    ["read", guarded("read", executeOf(createReadToolDefinition(cwd)))],
    ["edit", guarded("edit", executeOf(createEditToolDefinition(cwd)))],
    ["write", guarded("write", executeOf(createWriteToolDefinition(cwd)))],
    ["bash", serial(inFolder(executeOf(createBashToolDefinition(cwd, { operations: bashOperations }))))],
  ];
  return {
    tools: new Map(wrapped.map(([name, execute]) =>
      [name, (input: unknown, call: SandboxToolCall) => execute(call.toolCallId, input, call.signal, call.onUpdate)])),
    shutdown,
  };
};

/** The operations of the module are named like the tools the model sees. */
export const SANDBOX_TOOL_NAMES = ["read", "edit", "write", "bash"] as const;

/** An explicitly requested timeout in seconds extends how long a remote executor may wait for the bash. */
const bashDuration = (input: unknown): { durationMs?: number } => {
  const seconds = typeof input === "object" && input !== null ? (input as { timeout?: unknown }).timeout : undefined;
  return typeof seconds === "number" && seconds > 0 ? { durationMs: seconds * 1000 } : {};
};

/** The file tools address the root of their path, bash the root of its folder and without a folder no specific one. */
const sandboxToolFootprints: Readonly<Record<(typeof SANDBOX_TOOL_NAMES)[number], (input: unknown) => OperationFootprint>> = {
  read: (input) => ({ roots: rootsOfFields(input, "path") }),
  edit: (input) => ({ roots: rootsOfFields(input, "path") }),
  write: (input) => ({ roots: rootsOfFields(input, "path") }),
  bash: (input) => ({ roots: rootsOfFields(input, "cwd"), ...bashDuration(input) }),
};

const textOf = (update: ToolUpdate): string =>
  (update.content ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");

/** The four sandbox tools as operations; the sandbox of a run is created on the first call, bash reports its output as `{ text }`. */
export const sandboxToolsModule: WorkspaceModuleFactory = (host) => {
  const sandboxes = new Map<string, Promise<SandboxTools>>();
  const sandboxOf = (runId: string): Promise<SandboxTools> => {
    const running = sandboxes.get(runId);
    if (running) return running;
    const created = createSandboxTools(
      runId,
      () => host.contextFor(runId),
      (absolutePath) => host.annotate(runId, absolutePath),
    ).catch((error: unknown) => {
      sandboxes.delete(runId);
      throw error;
    });
    sandboxes.set(runId, created);
    return created;
  };
  const stopRun = async (runId: string): Promise<void> => {
    const sandbox = sandboxes.get(runId);
    sandboxes.delete(runId);
    await sandbox?.then((tools) => tools.shutdown());
  };
  const operation = (name: string): WorkspaceOperation => async ({ runId, input, toolCallId, signal, progress }) => {
    const { tools } = await sandboxOf(runId);
    const run = tools.get(name);
    if (!run) throw new Error(`The sandbox does not know the tool ${name}`);
    return run(input, {
      toolCallId: toolCallId ?? name,
      ...(signal ? { signal } : {}),
      ...(progress ? { onUpdate: (update: ToolUpdate) => progress({ text: textOf(update) }) } : {}),
    });
  };
  return {
    operations: Object.fromEntries(SANDBOX_TOOL_NAMES.map((name) => [name, operation(name)])),
    footprints: sandboxToolFootprints,
    stopRun,
    shutdown: async () => {
      const results = await Promise.allSettled([...sandboxes.keys()].map(stopRun));
      const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failed) throw failed.reason;
    },
  };
};
