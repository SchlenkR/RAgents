import { execFile, spawn, type ChildProcess } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import type { Writable } from "node:stream";
import { killProcessTree } from "@ragents/agent";

const PROCESS_GROUP_JOIN_TIMEOUT_MS = 5_000;
const PROCESS_GROUP_POLL_MS = 25;

const onWindows = (): boolean => process.platform === "win32";

export interface ManagedSpawnOptions {
  command: string;
  args: string[];
  cwd?: string;
  env: NodeJS.ProcessEnv;
  uid?: number;
  gid?: number;
  label: string;
  stdin?: "pipe";
  onStdout?: (chunk: Buffer) => void;
  onStderr?: (chunk: Buffer) => void;
  ipc?: boolean;
  onMessage?: (message: unknown) => void;
}

export interface ManagedProcessOptions extends ManagedSpawnOptions {
  signal?: AbortSignal;
  timeoutMs: number;
  terminationGraceMs?: number;
}

export interface ManagedProcessResult {
  code: number | null;
  timedOut: boolean;
}

export interface ManagedServiceOptions extends ManagedSpawnOptions {
  onError?: (error: Error) => void;
  onExit?: (code: number | null) => void;
}

export interface ManagedService {
  pid: number | undefined;
  stdin: Writable | undefined;
  kill: (signal: NodeJS.Signals) => void;
  finished: Promise<void>;
  exited: () => boolean;
  send: (message: unknown) => Promise<void>;
}

export class ProcessGroupJoinError extends Error {}

export const processGroupSignalExists = (pid: number): boolean => {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
};

export const processExists = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    throw error;
  }
};

/** Windows kennt keine Prozessgruppe und kein SIGKILL: der Baum geht über taskkill /T /F, und zwar ohne Wartezusage. */
export const stopProcessTree = (pid: number): void => {
  if (processExists(pid)) killProcessTree(pid);
};

const darwinProcessGroupExists = (pid: number): Promise<boolean> =>
  new Promise((resolve, reject) => {
    execFile("/bin/ps", ["-axo", "pgid=,stat="], { timeout: 5_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      const rows = stdout.split("\n").map((line) => /^\s*(\d+)\s*(\S*)\s*$/.exec(line)).filter((row) => row !== null);
      if (rows.length === 0) {
        reject(new Error(`macOS-Prozessgruppe ${pid}: ungültige Prozessliste: ${stdout.slice(0, 200)}`));
        return;
      }
      resolve(rows.some((row) => Number(row[1]) === pid && !row[2].startsWith("Z")));
    });
  });

export const processGroupExists = async (pid: number): Promise<boolean> => {
  if (onWindows()) return false;
  if (process.platform !== "linux") {
    try {
      return processGroupSignalExists(pid);
    } catch (error) {
      if (process.platform !== "darwin" || (error as NodeJS.ErrnoException).code !== "EPERM") throw error;
      return darwinProcessGroupExists(pid);
    }
  }
  const entries = await readdir("/proc", { withFileTypes: true }).catch(() => undefined);
  if (!entries) return processGroupSignalExists(pid);
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    const processStat = await readFile(`/proc/${entry.name}/stat`, "utf8").catch(() => "");
    const nameEnd = processStat.lastIndexOf(")");
    if (nameEnd < 0) continue;
    const fields = processStat.slice(nameEnd + 2).split(" ");
    if (Number(fields[2]) === pid && fields[0] !== "Z") return true;
  }
  return false;
};

const spawnDetached = (options: ManagedSpawnOptions): ChildProcess =>
  spawn(options.command, options.args, {
    cwd: options.cwd,
    detached: !onWindows(),
    env: options.env,
    uid: options.uid,
    gid: options.gid,
    stdio: options.ipc ? [options.stdin ?? "ignore", "pipe", "pipe", "ipc"] : [options.stdin ?? "ignore", "pipe", "pipe"],
    windowsHide: true,
    ...(onWindows() && /\.(cmd|bat)$/i.test(options.command) ? { shell: true } : {}),
  });

const sendGroupSignal = (
  child: ChildProcess,
  pid: number | undefined,
  processSignal: NodeJS.Signals,
  onError: (error: unknown) => void,
): void => {
  try {
    if (pid === undefined) child.kill(processSignal);
    else if (onWindows()) stopProcessTree(pid);
    else process.kill(-pid, processSignal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
    onError(error);
    try {
      child.kill(processSignal);
    } catch (fallbackError) {
      onError(fallbackError);
    }
  }
};

const joinProcessGroup = async (
  child: ChildProcess,
  pid: number | undefined,
  label: string,
  terminationDeadline: number | undefined,
  onSignalError: (error: unknown) => void,
): Promise<void> => {
  if (pid === undefined || onWindows()) return;
  try {
    if (!await processGroupExists(pid)) return;
    sendGroupSignal(child, pid, "SIGKILL", onSignalError);
    const deadline = terminationDeadline ?? Date.now() + PROCESS_GROUP_JOIN_TIMEOUT_MS;
    while (await processGroupExists(pid)) {
      if (Date.now() >= deadline) {
        throw new ProcessGroupJoinError(
          `${label}: Prozessgruppe ${pid} konnte nicht beendet werden`,
        );
      }
      await new Promise<void>((finish) => setTimeout(finish, PROCESS_GROUP_POLL_MS));
    }
  } catch (error) {
    if (error instanceof ProcessGroupJoinError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new ProcessGroupJoinError(
      `${label}: Prozessgruppe ${pid} konnte nicht geprüft werden: ${detail}`,
    );
  }
};

export const runManagedProcess = (options: ManagedProcessOptions): Promise<ManagedProcessResult> =>
  new Promise((resolve, reject) => {
    const abortError = (): Error => {
      const reason = options.signal?.reason;
      return reason instanceof Error
        ? reason
        : new Error(`${options.label} wurde abgebrochen`);
    };
    if (options.signal?.aborted) {
      reject(abortError());
      return;
    }
    const child = spawnDetached(options);
    const pid = child.pid;
    let timedOut = false;
    let aborted = false;
    let stopping = false;
    let settled = false;
    let processError: unknown;
    let forceTimer: NodeJS.Timeout | undefined;
    let terminationTimer: NodeJS.Timeout | undefined;
    let terminationDeadline: number | undefined;
    const recordError = (error: unknown): void => {
      processError ??= error;
    };
    const sendSignal = (processSignal: NodeJS.Signals): void =>
      sendGroupSignal(child, pid, processSignal, recordError);
    const stop = (): void => {
      if (stopping) return;
      stopping = true;
      const grace = options.terminationGraceMs ?? 0;
      terminationDeadline = Date.now() + grace + PROCESS_GROUP_JOIN_TIMEOUT_MS;
      if (grace > 0) {
        sendSignal("SIGTERM");
        forceTimer = setTimeout(() => sendSignal("SIGKILL"), grace);
      } else {
        sendSignal("SIGKILL");
      }
      terminationTimer = setTimeout(() => {
        sendSignal("SIGKILL");
        processError ??= new ProcessGroupJoinError(
          `${options.label}: Prozessgruppe ${pid ?? "unbekannt"} hat die Beendigungsfrist überschritten`,
        );
        child.stdout?.destroy();
        child.stderr?.destroy();
        child.unref();
        complete(null);
      }, grace + PROCESS_GROUP_JOIN_TIMEOUT_MS);
    };
    const onAbort = (): void => {
      aborted = true;
      stop();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, options.timeoutMs);
    const cleanup = (): void => {
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      if (terminationTimer) clearTimeout(terminationTimer);
      options.signal?.removeEventListener("abort", onAbort);
    };
    const complete = (code: number | null): void => {
      if (settled) return;
      settled = true;
      cleanup();
      void joinProcessGroup(child, pid, options.label, terminationDeadline, recordError).then(() => {
        if (processError) reject(processError);
        else if (aborted) reject(abortError());
        else resolve({ code, timedOut });
      }, reject);
    };
    const onOutput = (callback: ((chunk: Buffer) => void) | undefined) => (chunk: Buffer): void => {
      try {
        callback?.(chunk);
      } catch (error) {
        processError ??= error;
        stop();
      }
    };
    const onStreamError = (error: Error): void => {
      processError ??= error;
      stop();
    };
    child.stdout?.on("data", onOutput(options.onStdout));
    child.stderr?.on("data", onOutput(options.onStderr));
    child.stdout?.on("error", onStreamError);
    child.stderr?.on("error", onStreamError);
    child.once("error", (error) => {
      processError ??= error;
      if (pid === undefined) complete(null);
      else stop();
    });
    child.once("close", complete);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
  });

export const startManagedService = (options: ManagedServiceOptions): ManagedService => {
  const child = spawnDetached(options);
  const pid = child.pid;
  let exited = false;
  const swallowSignalError = (): void => undefined;
  const onOutput = (callback: ((chunk: Buffer) => void) | undefined) => (chunk: Buffer): void => {
    try {
      callback?.(chunk);
    } catch (error) {
      options.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  };
  const onStreamError = (error: Error): void => {
    options.onError?.(error);
  };
  const finished = new Promise<void>((resolve, reject) => {
    child.once("close", () => {
      void joinProcessGroup(child, pid, options.label, undefined, swallowSignalError)
        .then(resolve, reject);
    });
    child.once("error", (error) => {
      exited = true;
      options.onError?.(error);
      if (pid === undefined) resolve();
    });
  });
  child.stdout?.on("data", onOutput(options.onStdout));
  child.stderr?.on("data", onOutput(options.onStderr));
  child.on("message", (message) => options.onMessage?.(message));
  child.stdout?.on("error", onStreamError);
  child.stderr?.on("error", onStreamError);
  child.once("exit", (code) => {
    exited = true;
    options.onExit?.(code);
  });
  return {
    pid,
    stdin: child.stdin ?? undefined,
    kill: (processSignal) => {
      if (exited) return;
      sendGroupSignal(child, pid, processSignal, swallowSignalError);
    },
    finished,
    exited: () => exited,
    send: (message) => new Promise<void>((resolve, reject) => {
      if (!child.connected) return reject(new Error(`${options.label}: IPC-Verbindung ist geschlossen`));
      child.send(message as import("node:child_process").Serializable, (error) => error ? reject(error) : resolve());
    }),
  };
};
