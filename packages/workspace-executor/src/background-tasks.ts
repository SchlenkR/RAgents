import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, open, rm, stat } from "node:fs/promises";
import path from "node:path";
import { finished } from "node:stream/promises";
import type { BackgroundTaskOutput, BackgroundTaskStatus } from "@ragents/agent";
import { bashLaunch } from "./bash-launch.js";
import type { WorkspaceProcessContext } from "./context.js";
import { WorkspaceOperationError } from "./errors.js";
import { MSYS_CALL_ENV } from "./managed-process.js";
import { sandboxedLaunch } from "./process-sandbox.js";

/** The tools that read and stop a background command by its ID, named like the tools the model sees, and the observation of its end. */
export const BACKGROUND_TASK_OPERATIONS = {
  output: "task_output",
  stop: "task_stop",
  wait: "tasks.wait",
} as const;

/** How long task_stop waits after SIGTERM before it kills the process group. */
const STOP_GRACE_MS = 2_000;

/** How long the output of an ended command may still arrive once its process group is gone. */
const OUTPUT_GRACE_MS = 1_000;

/** The folder below the run's log folder on this machine that holds the output files. */
const OUTPUT_FOLDER = "background";

/** The MSYS marker of a command on Windows, so that the cleanup reaches the processes taskkill does not see. */
export interface WindowsCall {
  readonly bash: string;
  readonly env: NodeJS.ProcessEnv;
  readonly marker: string;
}

/** What the sandbox tools of a run lend the background commands: their process groups belong to the run's cleanup. */
export interface BackgroundProcessGroups {
  readonly track: (pid: number, windows: WindowsCall | undefined) => void;
  /** Ends the group and waits until it is gone. */
  readonly stop: (pid: number) => Promise<void>;
  /** Signals the group; Windows knows no signals and ends the tree. */
  readonly signal: (pid: number, signal: NodeJS.Signals) => Promise<void>;
}

export interface BackgroundTasks {
  readonly start: (command: string, cwd: string, signal: AbortSignal | undefined) => Promise<{ id: string }>;
  readonly output: (id: unknown, maxBytes: number) => Promise<BackgroundTaskOutput>;
  readonly stop: (id: unknown) => Promise<BackgroundTaskStatus>;
  /** The end of a command; an abort ends only the observation, never the command. */
  readonly wait: (id: unknown, signal: AbortSignal | undefined) => Promise<BackgroundTaskStatus>;
  /** The process groups of the commands still running. */
  readonly running: () => ReadonlySet<number>;
  /** After the cleanup of the run has ended every group: waits for the ends and removes the output files. */
  readonly dispose: () => Promise<void>;
}

interface BackgroundCommand {
  readonly pid: number;
  readonly file: string;
  readonly ended: Promise<BackgroundTaskStatus>;
  readonly status: BackgroundTaskStatus;
  /** How many bytes of the output file task_output has returned or left out. */
  readonly read: number;
  readonly stopRequested: boolean;
  readonly failure: string | undefined;
}

const delay = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds).unref());

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** A read that left out earlier bytes starts at the next line, or at least at the next character. */
const fromLineStart = (bytes: Buffer): Buffer => {
  const newline = bytes.indexOf(0x0a);
  if (newline >= 0) return bytes.subarray(newline + 1);
  const first = bytes.findIndex((byte) => (byte & 0xc0) !== 0x80);
  return first < 0 ? bytes.subarray(bytes.length) : bytes.subarray(first);
};

/** Without a character that is still being written: its bytes stay for the next read. */
const completeCharacters = (bytes: Buffer): Buffer => {
  for (let back = 1; back <= Math.min(4, bytes.length); back++) {
    const byte = bytes[bytes.length - back]!;
    if ((byte & 0xc0) === 0x80) continue;
    const length = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
    return length > back ? bytes.subarray(0, bytes.length - back) : bytes;
  }
  return bytes;
};

const readRange = async (file: string, from: number, to: number): Promise<Buffer> => {
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(to - from);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, from);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
};

const abortError = (signal: AbortSignal): Error =>
  signal.reason instanceof Error ? signal.reason : new Error("The observation of the background command was cancelled");

/** The background commands of one run on this machine: a command runs detached in its own process group and writes stdout and stderr into a file of the run. */
export const backgroundTasks = (
  contextFor: () => Promise<WorkspaceProcessContext>,
  groups: BackgroundProcessGroups,
): BackgroundTasks => {
  const onWindows = process.platform === "win32";
  const commands = new Map<string, BackgroundCommand>();
  let reads: Promise<unknown> = Promise.resolve();

  const taskId = (id: unknown): string => {
    if (typeof id !== "string" || id === "") throw new WorkspaceOperationError("background-task-invalid", "task_id names a background command", 400);
    return id;
  };

  const known = (id: string): BackgroundCommand => {
    const command = commands.get(id);
    if (!command) {
      throw new WorkspaceOperationError("background-task-unknown",
        `There is no background command with ID ${id} in this run; bash with run_in_background returns the ID.`, 404);
    }
    return command;
  };

  const update = (id: string, change: Partial<BackgroundCommand>): void => {
    const current = commands.get(id);
    if (current) commands.set(id, { ...current, ...change });
  };

  const newId = (): string => {
    const id = `b${randomBytes(3).toString("hex")}`;
    return commands.has(id) ? newId() : id;
  };

  /** After the command itself has exited: what is left of its process group ends with it, as with every bash call, then the output is complete. */
  const settle = async (id: string, pid: number, child: ChildProcess, output: WriteStream, closed: Promise<void>,
    exitCode: number | null, signal: NodeJS.Signals | null): Promise<BackgroundTaskStatus> => {
    const leftover = await groups.stop(pid).then(() => undefined, (error: unknown) => messageOf(error));
    await Promise.race([closed, delay(OUTPUT_GRACE_MS)]);
    child.stdout?.destroy();
    child.stderr?.destroy();
    if (leftover !== undefined && output.writable) output.write(`\n[The processes the command left behind could not be ended: ${leftover}]\n`);
    output.end();
    await finished(output).catch(() => undefined);
    const status: BackgroundTaskStatus = {
      state: "exited", exitCode, signal, stopped: commands.get(id)?.stopRequested ?? false,
    };
    update(id, { status });
    return status;
  };

  const start = async (command: string, cwd: string, abort: AbortSignal | undefined): Promise<{ id: string }> => {
    const context = await contextFor();
    abort?.throwIfAborted();
    const bash = bashLaunch({ bash: context.bash, rg: context.rg }, command, context.env);
    const launch = await sandboxedLaunch(context, bash);
    abort?.throwIfAborted();
    const id = newId();
    const folder = path.join(context.logDirectory, OUTPUT_FOLDER);
    await mkdir(folder, { recursive: true });
    const file = path.join(folder, `${id}.log`);
    const output = createWriteStream(file, { flags: "wx" });
    await once(output, "open");
    const marker = onWindows ? randomUUID() : undefined;
    const discard = async (error: unknown): Promise<never> => {
      output.destroy();
      await rm(file, { force: true });
      throw error;
    };
    const child = (() => {
      try {
        return spawn(launch.command, [...launch.args], {
          cwd,
          detached: !onWindows,
          stdio: ["ignore", "pipe", "pipe"],
          env: marker === undefined ? bash.env : { ...bash.env, [MSYS_CALL_ENV]: marker },
          uid: context.uid,
          gid: context.gid,
          windowsHide: true,
        });
      } catch (error) {
        return error instanceof Error ? error : new Error(String(error));
      }
    })();
    if (child instanceof Error) return discard(child);
    const pid = child.pid;
    if (pid === undefined) {
      const [failure] = await once(child, "error") as [Error];
      return discard(failure);
    }
    groups.track(pid, marker === undefined || context.bash === undefined ? undefined : { bash: context.bash, env: context.env, marker });
    output.on("error", (error) => {
      update(id, { failure: `The output file of background command ${id} could not be written: ${error.message}` });
      child.stdout?.resume();
      child.stderr?.resume();
    });
    child.on("error", (error) => update(id, { failure: `Background command ${id} failed: ${error.message}` }));
    child.stdout?.pipe(output, { end: false });
    child.stderr?.pipe(output, { end: false });
    const closed = once(child, "close").then(() => undefined, () => undefined);
    const ended = new Promise<BackgroundTaskStatus>((resolve) => {
      child.once("exit", (exitCode, signal) => {
        void settle(id, pid, child, output, closed, exitCode, signal).then(resolve);
      });
    });
    commands.set(id, { pid, file, ended, status: { state: "running" }, read: 0, stopRequested: false, failure: undefined });
    return { id };
  };

  /** The status comes first: once a command has ended, its file holds everything it wrote. */
  const readNew = async (id: string, maxBytes: number): Promise<BackgroundTaskOutput> => {
    const command = known(id);
    if (command.failure !== undefined) throw new WorkspaceOperationError("background-task-failed", command.failure, 500);
    const { status, read } = command;
    const { size } = await stat(command.file);
    const from = Math.max(read, size - maxBytes);
    const bytes = await readRange(command.file, from, size);
    const aligned = from > read ? fromLineStart(bytes) : bytes;
    const complete = completeCharacters(aligned);
    update(id, { read: from + bytes.length - (aligned.length - complete.length) });
    return { text: complete.toString("utf8"), skippedBytes: from - read + bytes.length - aligned.length, status };
  };

  const output = (id: unknown, maxBytes: number): Promise<BackgroundTaskOutput> => {
    const result = reads.then(() => readNew(taskId(id), maxBytes));
    reads = result.catch(() => undefined);
    return result;
  };

  const stop = async (id: unknown): Promise<BackgroundTaskStatus> => {
    const task = taskId(id);
    const command = known(task);
    if (command.status.state === "exited") return command.status;
    update(task, { stopRequested: true });
    await groups.signal(command.pid, "SIGTERM");
    const ended = await Promise.race([command.ended, delay(STOP_GRACE_MS).then(() => undefined)]);
    if (ended) return ended;
    await groups.stop(command.pid);
    return command.ended;
  };

  const wait = (id: unknown, abort: AbortSignal | undefined): Promise<BackgroundTaskStatus> => {
    const command = known(taskId(id));
    if (!abort) return command.ended;
    if (abort.aborted) return Promise.reject(abortError(abort));
    return new Promise((resolve, reject) => {
      const onAbort = (): void => reject(abortError(abort));
      abort.addEventListener("abort", onAbort, { once: true });
      void command.ended.then((status) => {
        abort.removeEventListener("abort", onAbort);
        resolve(status);
      });
    });
  };

  const running = (): ReadonlySet<number> =>
    new Set([...commands.values()].filter((command) => command.status.state === "running").map((command) => command.pid));

  const dispose = async (): Promise<void> => {
    const all = [...commands.values()];
    await Promise.all(all.map((command) => command.ended));
    await Promise.all(all.map((command) => rm(command.file, { force: true })));
  };

  return { start, output, stop, wait, running, dispose };
};
