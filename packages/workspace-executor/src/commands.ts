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

/** Die größte Ausgabe je Datenstrom, die ein Aufruf zurückgibt; was darüber hinausgeht, verwirft er und meldet die Kürzung. */
export const COMMAND_OUTPUT_LIMIT = 2 * 1024 * 1024;

export interface CommandRunInput {
  /** Ein Name aus dem PATH des Executors oder der Pfad eines Programms; es läuft ohne Shell. */
  program: string;
  args?: readonly string[];
  /** Der Arbeitsordner relativ zur Wurzel des Runs; ohne Angabe die Wurzel selbst. */
  cwd?: string;
  timeoutMs: number;
  /** Höchstens so viele Bytes je Datenstrom; ohne Angabe `COMMAND_OUTPUT_LIMIT`. */
  maxOutputBytes?: number;
}

export interface CommandResult {
  /** `null`, wenn der Prozess durch ein Signal endete. */
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
  if (!textWithoutNul(program) || program === "") throw invalid("Der Befehl braucht ein Programm als Text");
  if (platform === "win32" && /\.(cmd|bat)$/i.test(program)) throw invalid(`${program} braucht unter Windows eine Shell; ein Befehl läuft ohne`);
  if (!Array.isArray(args) || !args.every(textWithoutNul)) throw invalid("Die Argumente müssen Texte ohne Nullzeichen sein");
  if (typeof cwd !== "string") throw invalid("Der Arbeitsordner muss ein Text sein");
  if (typeof timeoutMs !== "number" || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw invalid("Die Zeitgrenze muss eine positive ganze Zahl in Millisekunden sein");
  }
  if (typeof maxOutputBytes !== "number" || !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 0 || maxOutputBytes > COMMAND_OUTPUT_LIMIT) {
    throw invalid(`Die Ausgabegrenze liegt zwischen 0 und ${COMMAND_OUTPUT_LIMIT} Bytes`);
  }
  return { program, args, cwd, timeoutMs, maxOutputBytes };
};

/** Sammelt einen Datenstrom bis zur Grenze; der Rest wird verworfen, der Prozess läuft weiter. */
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
  if (code === "ENOENT") return new WorkspaceOperationError("command-unavailable", `Das Programm ${program} gibt es auf diesem Rechner nicht`, 409);
  if (code === "EACCES") return new WorkspaceOperationError("command-unavailable", `Das Programm ${program} ist auf diesem Rechner nicht ausführbar`, 409);
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
    throw new WorkspaceOperationError("command-timeout", `${command.program} hat die Zeitgrenze von ${command.timeoutMs} ms überschritten`, 504);
  }
  return {
    exitCode: result.code,
    stdout: stdout.text(),
    stderr: stderr.text(),
    stdoutTruncated: stdout.truncated(),
    stderrTruncated: stderr.truncated(),
  };
};

/** Ein Befehl läuft in der Wurzel des Runs, ein Alias gilt dort nicht; seine Zeitgrenze verlängert, wie lange ein entfernter Executor auf ihn warten darf. */
const commandFootprint = (input: unknown): OperationFootprint => {
  const timeoutMs = typeof input === "object" && input !== null ? (input as { timeoutMs?: unknown }).timeoutMs : undefined;
  return { roots: { aliases: [], runRoot: true }, ...(typeof timeoutMs === "number" && timeoutMs > 0 ? { durationMs: timeoutMs } : {}) };
};

/** Befehle im Arbeitsbereich des Runs: ein Programm mit Argumenten, ohne Shell, in einem Ordner unter der Wurzel, mit der Umgebung dieses Executors. */
export const commandModule = (platform: NodeJS.Platform = process.platform): WorkspaceModuleFactory => (host) => {
  const running = new Map<string, Set<RunningCommand>>();
  const stopAll = async (commands: readonly RunningCommand[]): Promise<void> => {
    for (const command of commands) command.controller.abort(new Error("Der Befehl wurde mit seinem Run beendet"));
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
