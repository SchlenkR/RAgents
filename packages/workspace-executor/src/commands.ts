import type { WorkspaceProcessContext } from "./context.js";
import { WorkspaceOperationError } from "./errors.js";
import { workspaceDirectory } from "./files.js";
import { runManagedProcess } from "./managed-process.js";
import type { WorkspaceModuleFactory, WorkspaceOperation } from "./module.js";
import type { OperationFootprint } from "./paths.js";
import { sandboxedLaunch } from "./process-sandbox.js";

export const COMMAND_OPERATIONS = {
  run: "commands.run",
} as const;

/** The largest output per stream that a call returns; whatever goes beyond it is discarded and the truncation is reported. */
export const COMMAND_OUTPUT_LIMIT = 2 * 1024 * 1024;

export interface CommandRunInput {
  /** A name from the PATH of the executor or the path of a program; it runs without a shell. */
  program: string;
  args?: readonly string[];
  /** The working folder relative to the root of the run; without a value the root itself. */
  cwd?: string;
  timeoutMs: number;
  /** At most this many bytes per stream; without a value `COMMAND_OUTPUT_LIMIT`. */
  maxOutputBytes?: number;
}

export interface CommandResult {
  /** `null` if the process ended through a signal. */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

interface CheckedCommand {
  readonly program: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

interface RunningCommand {
  readonly controller: AbortController;
  readonly finished: Promise<unknown>;
}

const invalid = (message: string): WorkspaceOperationError => new WorkspaceOperationError("command-invalid", message, 400);

const textWithoutNul = (value: unknown): value is string => typeof value === "string" && !value.includes("\0");

const checkedCommand = (input: unknown, platform: NodeJS.Platform): CheckedCommand => {
  const value = (input ?? {}) as Partial<Record<keyof CommandRunInput, unknown>>;
  const { program, args = [], cwd = "", timeoutMs, maxOutputBytes = COMMAND_OUTPUT_LIMIT } = value;
  if (!textWithoutNul(program) || program === "") throw invalid("The command needs a program as text");
  if (platform === "win32" && /\.(cmd|bat)$/i.test(program)) throw invalid(`${program} needs a shell on Windows; a command runs without one`);
  if (!Array.isArray(args) || !args.every(textWithoutNul)) throw invalid("The arguments must be texts without null characters");
  if (typeof cwd !== "string") throw invalid("The working folder must be a text");
  if (typeof timeoutMs !== "number" || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw invalid("The timeout must be a positive integer in milliseconds");
  }
  if (typeof maxOutputBytes !== "number" || !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 0 || maxOutputBytes > COMMAND_OUTPUT_LIMIT) {
    throw invalid(`The output limit is between 0 and ${COMMAND_OUTPUT_LIMIT} bytes`);
  }
  return { program, args, cwd, timeoutMs, maxOutputBytes };
};

/** Collects a stream up to the limit; the rest is discarded, the process keeps running. */
const boundedOutput = (limit: number) => {
  const chunks: Buffer[] = [];
  let size = 0;
  let truncated = false;
  return {
    add: (chunk: Buffer): void => {
      const kept = chunk.subarray(0, Math.max(0, limit - size));
      if (kept.length < chunk.length) truncated = true;
      if (kept.length === 0) return;
      chunks.push(kept);
      size += kept.length;
    },
    text: (): string => Buffer.concat(chunks, size).toString("utf8"),
    truncated: (): boolean => truncated,
  };
};

const unavailable = (program: string, error: unknown): WorkspaceOperationError | undefined => {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ENOENT") return new WorkspaceOperationError("command-unavailable", `The program ${program} does not exist on this machine`, 409);
  if (code === "EACCES") return new WorkspaceOperationError("command-unavailable", `The program ${program} is not executable on this machine`, 409);
  return undefined;
};

const runCommand = async (context: WorkspaceProcessContext, command: CheckedCommand, signal: AbortSignal): Promise<CommandResult> => {
  const cwd = await workspaceDirectory(context.root, command.cwd);
  const stdout = boundedOutput(command.maxOutputBytes);
  const stderr = boundedOutput(command.maxOutputBytes);
  const launch = await sandboxedLaunch(context, { command: command.program, args: command.args });
  signal.throwIfAborted();
  const result = await runManagedProcess({
    command: launch.command,
    args: [...launch.args],
    cwd,
    env: context.env,
    uid: context.uid,
    gid: context.gid,
    label: command.program,
    signal,
    timeoutMs: command.timeoutMs,
    onStdout: stdout.add,
    onStderr: stderr.add,
  }).catch((error: unknown) => {
    throw unavailable(command.program, error) ?? error;
  });
  if (result.timedOut) {
    throw new WorkspaceOperationError("command-timeout", `${command.program} exceeded the timeout of ${command.timeoutMs} ms`, 504);
  }
  return {
    exitCode: result.code,
    stdout: stdout.text(),
    stderr: stderr.text(),
    stdoutTruncated: stdout.truncated(),
    stderrTruncated: stderr.truncated(),
  };
};

/** A command runs in the root of the run, an alias does not apply there; its timeout extends how long a remote executor may wait for it. */
const commandFootprint = (input: unknown): OperationFootprint => {
  const timeoutMs = typeof input === "object" && input !== null ? (input as { timeoutMs?: unknown }).timeoutMs : undefined;
  return { roots: { aliases: [], runRoot: true }, ...(typeof timeoutMs === "number" && timeoutMs > 0 ? { durationMs: timeoutMs } : {}) };
};

/** Commands in the workspace of the run: a program with arguments, without a shell, in a folder under the root, with the environment of this executor. */
export const commandModule = (platform: NodeJS.Platform = process.platform): WorkspaceModuleFactory => (host) => {
  const running = new Map<string, Set<RunningCommand>>();
  const stopAll = async (commands: readonly RunningCommand[]): Promise<void> => {
    for (const command of commands) command.controller.abort(new Error("The command was ended with its run"));
    await Promise.allSettled(commands.map((command) => command.finished));
  };
  const run: WorkspaceOperation = async ({ runId, input, signal }) => {
    const command = checkedCommand(input, platform);
    const controller = new AbortController();
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const finished = (async (): Promise<CommandResult> => {
      const context = await host.contextFor(runId);
      combined.throwIfAborted();
      const execute = (): Promise<CommandResult> => runCommand(context, command, combined);
      return context.runOperation ? context.runOperation(execute) : execute();
    })();
    const entry: RunningCommand = { controller, finished };
    const commands = running.get(runId) ?? new Set<RunningCommand>();
    running.set(runId, commands.add(entry));
    try {
      return await finished;
    } finally {
      commands.delete(entry);
      if (commands.size === 0) running.delete(runId);
    }
  };
  return {
    operations: {
      [COMMAND_OPERATIONS.run]: run,
    },
    footprints: {
      [COMMAND_OPERATIONS.run]: commandFootprint,
    },
    stopRun: (runId) => stopAll([...running.get(runId) ?? []]),
    shutdown: () => stopAll([...running.values()].flatMap((commands) => [...commands])),
  };
};
