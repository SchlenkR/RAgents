import { spawn } from "node:child_process";
import path from "node:path";
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  getShellConfig,
  type BashOperations,
  type ShellConfig,
} from "@ragents/agent";
import type { WorkspaceProcessContext } from "./context.js";
import { processGroupExists, stopProcessTree } from "./managed-process.js";
import type { WorkspaceModuleFactory, WorkspaceOperation } from "./module.js";
import { stopUidProcesses } from "./session-ident.js";
import { allowedWorkspacePath, expandWorkspaceAlias } from "./paths.js";

export interface ToolUpdate {
  content?: ReadonlyArray<{ type: string; text?: string }>;
}

type ToolExecute = (
  toolCallId: string,
  input: unknown,
  signal: AbortSignal | undefined,
  onUpdate: ((update: ToolUpdate) => void) | undefined,
  context: unknown,
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

export const DEFAULT_BASH_TIMEOUT_SECONDS = (() => {
  const value = Number(process.env.RAGENTS_BASH_TIMEOUT_SECONDS);
  return Number.isFinite(value) && value > 0 ? value : 600;
})();

type ToolResult = { content?: Array<{ type: string; text?: string }> };

export const withAnnotation = (result: unknown, note: string | undefined): unknown => {
  if (!note || typeof result !== "object" || result === null) return result;
  const typed = result as ToolResult;
  if (!Array.isArray(typed.content)) return result;
  return { ...typed, content: [...typed.content, { type: "text", text: note }] };
};

/** Löst `$RAGENTS_..._DIR` und `${...}` am Anfang eines Pfads gegen die Variablen des Kontexts auf. */
const expandPathVariables = (value: unknown, variables: Readonly<Record<string, string>>): unknown => {
  if (typeof value !== "string") return value;
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

  /** Kein stiller Ausweg auf `sh`: das Werkzeug heißt bash und der Prompt beschreibt bash. */
  const resolvedShell = (): ShellConfig => {
    const shell = getShellConfig();
    if (!/bash(\.exe)?$/i.test(shell.shell)) throw new Error(`Auf diesem Rechner gibt es keine Bash; ${shell.shell} ist kein Ersatz`);
    return shell;
  };

  const killProcessGroup = async (pid: number): Promise<void> => {
    if (onWindows) {
      stopProcessTree(pid);
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
      if (Date.now() >= deadline) throw new Error(`Bash-Prozessgruppe ${pid} konnte nicht beendet werden`);
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

  const concurrent = (execute: ToolExecute): ToolExecute => (toolCallId, input, signal, onUpdate, context) => {
    if (shuttingDown) throw new Error("Die Werkzeuge werden killed");
    if (signal?.aborted) throw new Error("Abgebrochen");
    const run = () => execute(toolCallId, input, signal, onUpdate, context);
    return initial.runOperation ? initial.runOperation(run) : run();
  };

  const serial = (execute: ToolExecute): ToolExecute => {
    const inner = concurrent(execute);
    return (toolCallId, input, signal, onUpdate, context) => {
      const call = () => inner(toolCallId, input, signal, onUpdate, context);
      const result = toolOperation.then(call, call);
      toolOperation = result.then(() => undefined, () => undefined);
      return result;
    };
  };

  const guarded = (execute: ToolExecute, writing: boolean): ToolExecute => {
    const checked: ToolExecute = async (toolCallId, input, signal, onUpdate, ctx) => {
      const params = input as { path?: unknown } | undefined;
      const context = await contextFor();
      if (params && typeof params.path === "string") {
        params.path = expandPathVariables(expandWorkspaceAlias(params.path, context.workspaceAliases ?? {}), context.pathVariables ?? {});
      }
      const writable = [context.root, ...context.additionalRoots ?? []];
      await assertInsideRoots(params?.path, writing ? writable : [...writable, ...context.readOnlyRoots ?? []]);
      const result = await execute(toolCallId, input, signal, onUpdate, ctx);
      if (!writing || !annotate || typeof params?.path !== "string") return result;
      return withAnnotation(result, await annotate(path.resolve(cwd, params.path)));
    };
    return writing ? serial(checked) : concurrent(checked);
  };

  const startBash: BashOperations["exec"] = async (command, commandCwd, options) => {
      if (shuttingDown) throw new Error("Die Werkzeuge werden killed");
      const context = await contextFor();
      if (shuttingDown) throw new Error("Die Werkzeuge werden killed");
      options.signal?.throwIfAborted();
      const shell = resolvedShell();
      const fromStdin = shell.commandTransport === "stdin";
      return new Promise((resolve, reject) => {
        const child = spawn(shell.shell, fromStdin ? shell.args : [...shell.args, command], {
          cwd: commandCwd,
          detached: !onWindows,
          stdio: [fromStdin ? "pipe" : "ignore", "pipe", "pipe"],
          env: context.env,
          uid: context.uid,
          gid: context.gid,
          windowsHide: true,
        });
        if (fromStdin) {
          child.stdin?.on("error", () => undefined);
          child.stdin?.end(command);
        }
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
        child.on("close", (code) => {
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
            .then(() => context.uid === undefined ? undefined : stopUidProcesses(context.uid))
            .then(finish)
            .catch(reject);
        });
      });
  };

  const bashOperations: BashOperations = {
    exec: (command, commandCwd, options) => {
      if (shuttingDown) throw new Error("Die Werkzeuge werden killed");
      if (options.signal?.aborted) throw new Error("Abgebrochen");
      return startBash(command, commandCwd, options);
    },
  };

  const executeOf = (definition: { execute: unknown }): ToolExecute => definition.execute as ToolExecute;
  const wrapped: ReadonlyArray<readonly [string, ToolExecute]> = [
    ["read", guarded(executeOf(createReadToolDefinition(cwd)), false)],
    ["edit", guarded(executeOf(createEditToolDefinition(cwd)), true)],
    ["write", guarded(executeOf(createWriteToolDefinition(cwd)), true)],
    ["bash", serial(executeOf(createBashToolDefinition(cwd, { operations: bashOperations })))],
  ];
  return {
    tools: new Map(wrapped.map(([name, execute]) =>
      [name, (input: unknown, call: SandboxToolCall) => execute(call.toolCallId, input, call.signal, call.onUpdate, undefined)])),
    shutdown,
  };
};

/** Die Operationen des Moduls heißen wie die Werkzeuge, die das Modell sieht. */
export const SANDBOX_TOOL_NAMES = ["read", "edit", "write", "bash"] as const;

const textOf = (update: ToolUpdate): string =>
  (update.content ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");

/** Die vier Sandbox-Werkzeuge als Operationen; die Sandbox eines Runs entsteht beim ersten Aufruf, Bash meldet ihre Ausgabe als `{ text }`. */
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
    if (!run) throw new Error(`Die Sandbox kennt das Werkzeug ${name} nicht`);
    return run(input, {
      toolCallId: toolCallId ?? name,
      ...(signal ? { signal } : {}),
      ...(progress ? { onUpdate: (update: ToolUpdate) => progress({ text: textOf(update) }) } : {}),
    });
  };
  return {
    operations: Object.fromEntries(SANDBOX_TOOL_NAMES.map((name) => [name, operation(name)])),
    stopRun,
    shutdown: async () => {
      const results = await Promise.allSettled([...sandboxes.keys()].map(stopRun));
      const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failed) throw failed.reason;
    },
  };
};
