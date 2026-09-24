import { spawn, type ChildProcess } from "node:child_process";
import { openSync, closeSync, readFileSync } from "node:fs";
import path from "node:path";

/** Variablen einer umgebenden VS-Code-Instanz dürfen Kindprozesse nicht erben, sonst hängen sie sich an den Aufrufer. */
export const childEnvironment = (extra: Readonly<Record<string, string>>, dropped: readonly string[] = []): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(VSCODE_|ELECTRON_)/.test(name) && !dropped.includes(name))),
  ...extra,
});

export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CommandOptions {
  readonly input?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly cwd?: string;
  readonly timeoutMs?: number;
}

/** Führt einen Befehl asynchron aus, damit das Skriptmodell im selben Prozess weiter antworten kann. */
export const runCommand = (command: string, args: readonly string[], options: CommandOptions = {}): Promise<CommandResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: options.env ?? childEnvironment({}), cwd: options.cwd, stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    const timer = options.timeoutMs === undefined ? undefined : setTimeout(() => child.kill("SIGKILL"), options.timeoutMs);
    child.once("error", (error) => {
      if (timer) clearTimeout(timer);
      reject(new Error(`${command} lässt sich nicht starten: ${error.message}`));
    });
    child.once("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      resolve({
        code: code ?? (signal ? 128 : 1),
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8") + (signal ? `\n(beendet durch ${signal})` : ""),
      });
    });
    child.stdin.end(options.input ?? "");
  });

const tail = (text: string, lines = 15): string => text.trim().split("\n").slice(-lines).join("\n");

export const mustRun = async (command: string, args: readonly string[], options: CommandOptions = {}): Promise<string> => {
  const result = await runCommand(command, args, options);
  if (result.code !== 0) throw new Error(`${command} ${args.slice(0, 3).join(" ")} endete mit ${result.code}: ${tail(result.stderr || result.stdout)}`);
  return result.stdout;
};

export const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

export const hasExited = (child: ChildProcess): boolean => child.exitCode !== null || child.signalCode !== null;

const exitOf = (child: ChildProcess, timeoutMs: number): Promise<boolean> => hasExited(child)
  ? Promise.resolve(true)
  : new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", done);
      resolve(false);
    }, timeoutMs);
    const done = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("exit", done);
  });

/** SIGTERM an die eigene PID, nach der Frist SIGKILL; die Gruppe nur, solange ihr Anführer lebt und ihre Kennung damit sicher nicht vergeben ist. */
export const stopOwnProcess = async (child: ChildProcess, graceMs: number, group: boolean): Promise<string> => {
  if (hasExited(child) || child.pid === undefined) return "lief nicht mehr";
  child.kill("SIGTERM");
  if (await exitOf(child, graceMs)) return "beendet";
  if (group) process.kill(-child.pid, "SIGKILL");
  else child.kill("SIGKILL");
  if (await exitOf(child, 5_000)) return "erzwungen beendet";
  throw new Error(`Prozess ${child.pid} lebt nach SIGKILL noch`);
};

export interface HostServer {
  readonly child: ChildProcess;
  /** Die Adresse aus der Ansage {"ragents":{url}} auf stdout; scheitert, wenn der Server vorher endet oder schweigt. */
  readonly announced: Promise<string>;
}

/** Die Adresse aus den vollständigen Zeilen der Ausgabe; eine angefangene Zeile wartet auf ihr Ende. */
export const announcedUrl = (output: string): string | undefined => {
  const line = output.split("\n").slice(0, -1).find((entry) => entry.startsWith("{\"ragents\""));
  if (line === undefined) return undefined;
  const url = (JSON.parse(line) as { ragents?: { url?: unknown } }).ragents?.url;
  if (typeof url !== "string") throw new Error(`Die Ansage des Servers nennt keine Adresse: ${line}`);
  return url;
};

/** Startet den Server mit --port 0 in eigener Prozessgruppe; der Prozess gehört dem Aufrufer schon, bevor er sich meldet. */
export const spawnHostServer = (root: string, environment: NodeJS.ProcessEnv, logFile: string, timeoutMs: number): HostServer => {
  const log = openSync(logFile, "a");
  const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts", "--port", "0"], {
    cwd: path.join(root, "apps/server"),
    env: environment,
    detached: true,
    stdio: ["ignore", "pipe", log],
  });
  closeSync(log);
  const announced = new Promise<string>((resolve, reject) => {
    let buffered = "";
    const logTail = (): string => tail(readFileSync(logFile, "utf8"), 20);
    const timer = setTimeout(() => {
      finish();
      reject(new Error(`Der Server meldet sich nach ${timeoutMs / 1000} s nicht; Ende des Protokolls:\n${logTail()}`));
    }, timeoutMs);
    const onData = (chunk: Buffer): void => {
      buffered += chunk.toString("utf8");
      try {
        const url = announcedUrl(buffered);
        if (url === undefined) return;
        finish();
        resolve(url);
      } catch (error) {
        finish();
        reject(new Error(`Die Ansage des Servers ist ungültig: ${error instanceof Error ? error.message : String(error)}`));
      }
    };
    const onExit = (code: number | null): void => {
      finish();
      reject(new Error(`Der Server endete beim Start mit ${code}; Ende des Protokolls:\n${logTail()}`));
    };
    const onError = (error: Error): void => {
      finish();
      reject(new Error(`Der Server lässt sich nicht starten: ${error.message}`));
    };
    const finish = (): void => {
      clearTimeout(timer);
      child.stdout!.off("data", onData);
      child.off("exit", onExit);
      child.off("error", onError);
      child.stdout!.resume();
    };
    child.stdout!.on("data", onData);
    child.once("exit", onExit);
    child.once("error", onError);
  });
  return { child, announced };
};

export interface MarkedProcess {
  readonly pid: number;
  readonly command: string;
}

/** Prozesse dieses Rechners, deren Umgebung eine der Markierungen trägt, etwa RAGENTS_RUN_ID=<run>; nur macOS zeigt sie mit ps -E. */
export const markedProcesses = async (markers: readonly string[]): Promise<readonly MarkedProcess[]> => {
  if (markers.length === 0) return [];
  const listing = await mustRun("/bin/ps", ["-axww", "-E", "-o", "pid=,command="]);
  return listing.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!match) return [];
    const pid = Number(match[1]);
    const text = match[2]!;
    if (pid === process.pid || !markers.some((marker) => text.includes(` ${marker}`))) return [];
    return [{ pid, command: text.split(" ").slice(0, 4).join(" ") }];
  });
};

/** Prozesse früherer Prüfläufe: ihre Markierung name=<Läufer-PID>-<Sitzung> nennt einen Läufer, der nicht mehr lebt. */
export const orphanedProcesses = async (name: string): Promise<readonly (MarkedProcess & { readonly marker: string })[]> => {
  const listing = await mustRun("/bin/ps", ["-axww", "-E", "-o", "pid=,command="]);
  const pattern = new RegExp(` (${name}=(\\d+)-[0-9a-f]+)(?: |$)`);
  return listing.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    const marked = match ? pattern.exec(match[2]!) : null;
    if (!match || !marked) return [];
    const runner = Number(marked[2]);
    if (runner === process.pid || alive(runner)) return [];
    return [{ pid: Number(match[1]), command: match[2]!.split(" ").slice(0, 4).join(" "), marker: marked[1]! }];
  });
};

/** Beendet einen markierten Prozess über seine PID, nachdem die Markierung unmittelbar davor erneut bestätigt ist. */
export const stopMarkedProcess = async (pid: number, markers: readonly string[]): Promise<void> => {
  for (const signal of ["SIGTERM", "SIGKILL"] as const) {
    const current = await markedProcesses(markers);
    if (!current.some((entry) => entry.pid === pid)) return;
    process.kill(pid, signal);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  if ((await markedProcesses(markers)).some((entry) => entry.pid === pid)) throw new Error(`Prozess ${pid} lebt nach SIGKILL noch`);
};
