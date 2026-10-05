import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createReadToolDefinition,
  createTaskOutputToolDefinition,
  createTaskStopToolDefinition,
  createWriteToolDefinition,
  editApplies,
  resolveReadPathAsync,
  resolveToCwd,
  type BackgroundTaskOperations,
  type BashOperations,
} from "@ragents/agent";
import { BACKGROUND_TASK_OPERATIONS, backgroundTasks, type UnreportedBackgroundTask } from "./background-tasks.js";
import { bashLaunch } from "./bash-launch.js";
import { BYTE_OPERATIONS, fileBytesOf, pathInRoots, readFileBytes, writeFileBytes } from "./bytes.js";
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
  /** The process groups of the background commands still running; the process display counts them as background. */
  readonly backgroundGroups: () => ReadonlySet<number>;
  /** The background commands of the run whose end no observation has returned yet. */
  readonly unreportedTasks: () => readonly UnreportedBackgroundTask[];
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
  readonly file_path?: unknown;
  readonly offset?: number;
  readonly limit?: number;
  readonly content?: string;
  readonly old_string?: unknown;
  readonly new_string?: unknown;
  readonly replace_all?: unknown;
  readonly seen?: SeenFile | null;
};

type FileToolName = "read" | "edit" | "write";

/** The input of bash: what the model passes, and for a background command whom the server tells about its end. */
type BashInput = { readonly startedBy?: unknown; readonly [field: string]: unknown };

const starterMissing = (): WorkspaceOperationError => new WorkspaceOperationError("background-task-starter-missing",
  "run_in_background needs startedBy in the input of the operation bash: whom the server tells about the end of the command", 400);

const unchangedNotice = "File unchanged since last read. The content from the earlier read result in this conversation is still current - refer to that instead of re-reading.";

const unreadMessage = "File has not been read yet. Read it first before writing to it.";

const changedMessage = "File has been modified since read, either by the user or by a linter. Read it again before attempting to write it.";

const staleEditNote = "(note: the file had been modified on disk since you last read it - the edit applied cleanly, but the file contains other changes not in your context. Read it before edits that depend on surrounding content.)";

/** What the seen state decides before a direct call of the model: an answer without execution, or for an edit on a changed file the state that stays seen. */
type SeenCheck = { readonly answer?: ToolResult; readonly stale?: SeenFile };

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

  /** A group of this run gets the signal as a whole; Windows has no groups and ends the tree. */
  const signalProcessGroup = async (pid: number, signal: NodeJS.Signals): Promise<void> => {
    if (onWindows) return killProcessGroup(pid);
    try {
      process.kill(-pid, signal);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ESRCH" || (process.platform === "darwin" && code === "EPERM" && !await processGroupExists(pid))) return;
      throw error;
    }
  };

  const background = backgroundTasks(contextFor, {
    track: (pid, windows) => {
      processGroups.add(pid);
      if (windows) msysCalls.set(pid, windows);
    },
    stop: stopProcessGroup,
    signal: signalProcessGroup,
  });

  const shutdown = async (): Promise<void> => {
    shuttingDown = true;
    await Promise.all([...processGroups].map(killProcessGroup));
    for (;;) {
      const operation = toolOperation;
      await operation.catch(() => {});
      if (operation === toolOperation) break;
    }
    await Promise.all([...processGroups].map(stopProcessGroup));
    await background.dispose();
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

  /** On a direct call of the model a write checks the seen state, an edit on a changed file applies only if old_string still selects its target, and a repeated read of an unchanged section answers briefly. */
  const checkedAgainstSeen = async (name: FileToolName, file: string, input: FileToolInput, seen: SeenFile | null): Promise<SeenCheck> => {
    if (name === "read") {
      const sameView = seen?.read !== undefined && seen.file === file && seen.read.offset === input.offset && seen.read.limit === input.limit;
      return sameView && await currentHash(file) === seen.hash ? { answer: { content: [{ type: "text", text: unchangedNotice }], details: { seen } } } : {};
    }
    if (name === "edit" && (input.old_string === "" || input.old_string === input.new_string)) return {};
    const current = await currentHash(file);
    if (current === undefined) return {};
    if (seen === null || seen.file !== file) throw new WorkspaceOperationError("workspace-file-unread", unreadMessage, 409);
    if (seen.hash === current) return {};
    const applies = name === "edit" && typeof input.old_string === "string"
      && editApplies(await readFile(file, "utf8"), input.old_string, input.replace_all === true);
    if (!applies) throw new WorkspaceOperationError("workspace-file-changed", changedMessage, 409);
    return { stale: seen };
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
      const shown = typeof params.file_path === "string" ? params.file_path : undefined;
      const requested = shown === undefined
        ? undefined
        : expandPathVariables(expandWorkspaceAlias(shown, context.workspaceAliases ?? {}), context.pathVariables ?? {});
      const resolved = requested === undefined ? undefined
        : name === "read" ? await resolveReadPathAsync(requested, cwd) : resolveToCwd(requested, cwd);
      try {
        const writable = [context.root, ...context.additionalRoots ?? []];
        const file = resolved === undefined ? undefined
          : await allowedWorkspacePath(resolved, writing ? writable : [...writable, ...context.readOnlyRoots ?? []]);
        const tracked = seen !== undefined && file !== undefined;
        const { answer, stale } = tracked ? await checkedAgainstSeen(name, file, params, seen) : {};
        if (answer) return answer;
        const result = await execute(toolCallId, file === undefined ? params : { ...params, file_path: file }, signal, onUpdate);
        const recorded = tracked ? { ...result as ToolResult, details: { ...(result as ToolResult).details as object, seen: stale ?? seenAfter(name, file, params, result) } } : result;
        const noted = withAnnotation(recorded, stale && staleEditNote);
        const annotated = writing && annotate && file !== undefined ? withAnnotation(noted, await annotate(file)) : noted;
        return file === undefined || shown === undefined ? annotated : withShownPath(annotated, file, shown);
      } catch (error) {
        throw resolved === undefined || shown === undefined ? error : errorWithShownPath(error, resolved, shown);
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

  /** A path of the byte operations resolves like one of the file tools; messages name it as the caller named it. */
  const resolvedIn = async (shown: unknown, writing: boolean): Promise<{ file: string; shown: string; writable: readonly string[] }> => {
    if (typeof shown !== "string" || shown.trim() === "" || shown.includes("\0")) {
      throw new WorkspaceOperationError("workspace-path-invalid", `Invalid path: ${String(shown)}`, 400);
    }
    const context = await contextFor();
    const writable = [context.root, ...context.additionalRoots ?? []];
    const requested = path.resolve(cwd, expandPathVariables(expandWorkspaceAlias(shown, context.workspaceAliases ?? {}), context.pathVariables ?? {}));
    return { file: await pathInRoots(requested, shown, writing ? writable : [...writable, ...context.readOnlyRoots ?? []]), shown, writable };
  };

  const readBytes: ToolExecute = async (_toolCallId, input) => {
    const params = (input ?? {}) as { path?: unknown; recursive?: unknown };
    const { file, shown } = await resolvedIn(params.path, false);
    return readFileBytes(file, shown, params.recursive === true);
  };

  const writeBytes: ToolExecute = async (_toolCallId, input) => {
    const params = (input ?? {}) as { path?: unknown; content?: unknown };
    const content = fileBytesOf(params.content);
    const { file, shown, writable } = await resolvedIn(params.path, true);
    await writeFileBytes(file, shown, content, writable);
    return null;
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
        }, options.timeoutMs);
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
              ? reject(new Error(`timeout:${options.timeoutMs}`))
              : resolve({ exitCode: killed ? null : code });
          if (!child.pid) {
            finish();
            return;
          }
          void (stopping ?? Promise.resolve())
            .then(() => stopProcessGroup(child.pid!))
            .then(() => context.uid === undefined ? undefined : stopUidProcesses(context.uid, background.running()))
            .then(finish)
            .catch(reject);
        });
      });
  };

  const bashOperationsFor = (startedBy: unknown): BashOperations => ({
    exec: (command, commandCwd, options) => {
      if (shuttingDown) throw new Error("The tools are being killed");
      if (options.signal?.aborted) throw new Error("Cancelled");
      return startBash(command, commandCwd, options);
    },
    background: (command, commandCwd, options) => {
      if (shuttingDown) throw new Error("The tools are being killed");
      if (typeof startedBy !== "string" || startedBy === "") throw starterMissing();
      return background.start(command, commandCwd, startedBy, options.signal);
    },
  });

  const taskOperations: BackgroundTaskOperations = {
    output: (id, { maxBytes }) => background.output(id, maxBytes),
    stop: (id) => background.stop(id),
  };

  /** The observation runs outside the frame of the workspace, which it does not touch, for as long as the command runs. */
  const waitForTask: ToolExecute = async (_toolCallId, input, signal) =>
    background.wait((input as { task_id?: unknown } | null)?.task_id, signal);

  const executeOf = (definition: { execute: unknown }): ToolExecute => definition.execute as ToolExecute;

  /** The bash definition per call, because a background start carries whom the server tells about its end. */
  const runBash: ToolExecute = (toolCallId, input, signal, onUpdate) => {
    const { startedBy, ...params } = (input ?? {}) as BashInput;
    return executeOf(createBashToolDefinition(cwd, { operations: bashOperationsFor(startedBy) }))(toolCallId, params, signal, onUpdate);
  };

  const wrapped: ReadonlyArray<readonly [string, ToolExecute]> = [
    ["read", guarded("read", executeOf(createReadToolDefinition(cwd, { resolvePath: (file) => file })))],
    ["edit", guarded("edit", executeOf(createEditToolDefinition(cwd, { resolvePath: (file) => file })))],
    ["write", guarded("write", executeOf(createWriteToolDefinition(cwd, { resolvePath: (file) => file })))],
    ["bash", serial(inFolder(runBash))],
    [BACKGROUND_TASK_OPERATIONS.output, concurrent(executeOf(createTaskOutputToolDefinition(taskOperations)))],
    [BACKGROUND_TASK_OPERATIONS.stop, concurrent(executeOf(createTaskStopToolDefinition(taskOperations)))],
    [BACKGROUND_TASK_OPERATIONS.wait, waitForTask],
    [BYTE_OPERATIONS.read, concurrent(readBytes)],
    [BYTE_OPERATIONS.write, serial(writeBytes)],
  ];
  return {
    tools: new Map(wrapped.map(([name, execute]) =>
      [name, (input: unknown, call: SandboxToolCall) => execute(call.toolCallId, input, call.signal, call.onUpdate)])),
    backgroundGroups: background.running,
    unreportedTasks: () => background.unreported().map((task) => ({ runId, ...task })),
    shutdown,
  };
};

/** The operations of the module are named like the tools the model sees. */
export const SANDBOX_TOOL_NAMES = ["read", "edit", "write", "bash", BACKGROUND_TASK_OPERATIONS.output, BACKGROUND_TASK_OPERATIONS.stop] as const;

/** The byte operations belong to this module because writing shares the lock of the file tools, the observation of a background command because the module holds it. */
const SANDBOX_OPERATIONS = [...SANDBOX_TOOL_NAMES, BACKGROUND_TASK_OPERATIONS.wait, BYTE_OPERATIONS.read, BYTE_OPERATIONS.write] as const;

/** An explicitly requested timeout in milliseconds extends how long a remote executor may wait for the bash. */
const bashDuration = (input: unknown): { durationMs?: number } => {
  const timeout = typeof input === "object" && input !== null ? (input as { timeout?: unknown }).timeout : undefined;
  return typeof timeout === "number" && timeout > 0 ? { durationMs: timeout } : {};
};

/** The file tools and the byte operations address the root of their path, bash the root of its folder and without a folder no specific one; a background command is found by its ID. */
const sandboxToolFootprints: Readonly<Partial<Record<(typeof SANDBOX_OPERATIONS)[number], (input: unknown) => OperationFootprint>>> = {
  read: (input) => ({ roots: rootsOfFields(input, "file_path") }),
  edit: (input) => ({ roots: rootsOfFields(input, "file_path") }),
  write: (input) => ({ roots: rootsOfFields(input, "file_path") }),
  bash: (input) => ({ roots: rootsOfFields(input, "cwd"), ...bashDuration(input) }),
  [BYTE_OPERATIONS.read]: (input) => ({ roots: rootsOfFields(input, "path") }),
  [BYTE_OPERATIONS.write]: (input) => ({ roots: rootsOfFields(input, "path") }),
};

const textOf = (update: ToolUpdate): string =>
  (update.content ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");

/** The four sandbox tools, the background commands of bash and the byte operations; the sandbox of a run is created on the first call, bash reports its output as `{ text }`. */
export const sandboxToolsModule: WorkspaceModuleFactory = (host) => {
  const sandboxes = new Map<string, Promise<SandboxTools>>();
  /** The sandboxes already created, for the process display, which asks synchronously. */
  const created = new Map<string, SandboxTools>();
  const sandboxOf = (runId: string): Promise<SandboxTools> => {
    const running = sandboxes.get(runId);
    if (running) return running;
    const creating = createSandboxTools(
      runId,
      () => host.contextFor(runId),
      (absolutePath) => host.annotate(runId, absolutePath),
    ).then((tools) => {
      if (sandboxes.get(runId) === creating) created.set(runId, tools);
      return tools;
    }, (error: unknown) => {
      sandboxes.delete(runId);
      throw error;
    });
    sandboxes.set(runId, creating);
    return creating;
  };
  const stopRun = async (runId: string): Promise<void> => {
    const sandbox = sandboxes.get(runId);
    sandboxes.delete(runId);
    if (!sandbox) return;
    const tools = await sandbox;
    try {
      await tools.shutdown();
    } finally {
      if (created.get(runId) === tools) created.delete(runId);
    }
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
    operations: Object.fromEntries(SANDBOX_OPERATIONS.map((name) => [name, operation(name)])),
    footprints: sandboxToolFootprints,
    backgroundGroups: () => [...created.values()].flatMap((tools) => [...tools.backgroundGroups()]),
    unreportedBackgroundTasks: () => [...created.values()].flatMap((tools) => tools.unreportedTasks()),
    stopRun,
    shutdown: async () => {
      const results = await Promise.allSettled([...sandboxes.keys()].map(stopRun));
      const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failed) throw failed.reason;
    },
  };
};
