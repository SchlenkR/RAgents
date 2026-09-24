import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, readlink } from "node:fs/promises";
import { promisify } from "node:util";
import { RUN_MARKER_ENV, runMarkerOf } from "../run-marker.js";

export interface WorkspaceProcessPort {
  port: number;
  address: string;
}

const execFileAsync = promisify(execFile);

export interface ProcessRecord {
  pid: number;
  ppid: number;
  pgid: number;
  uid: number;
  startKey: string;
  command: string;
}

export interface ProcessTable {
  list: () => Promise<ProcessRecord[]>;
  runMarkers: (pids: readonly number[]) => Promise<Map<number, string>>;
  listeningPorts: (pids: readonly number[]) => Promise<Map<number, WorkspaceProcessPort[]>>;
}

export const processIdOf = (record: Pick<ProcessRecord, "pid" | "startKey">): string =>
  `${record.pid}-${createHash("sha256").update(record.startKey).digest("hex")}`;

const PID_CHUNK = 400;
const WILDCARD = "*";

const chunked = (pids: readonly number[]): number[][] => {
  const chunks: number[][] = [];
  for (let start = 0; start < pids.length; start += PID_CHUNK) chunks.push(pids.slice(start, start + PID_CHUNK));
  return chunks;
};

const runCommand = async (file: string, args: string[], toleratedExitCodes: readonly number[]): Promise<string> => {
  try {
    const { stdout } = await execFileAsync(file, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 2_000 });
    return stdout;
  } catch (error) {
    const failure = error as Error & { code?: number | string; stdout?: string; stderr?: string };
    if (typeof failure.code === "number" && toleratedExitCodes.includes(failure.code)) return failure.stdout ?? "";
    if (failure.code === "ENOENT") throw new Error(`${file} ist nicht installiert; die Prozessüberwachung braucht es`);
    throw new Error(`${file} ${args[0]} ist fehlgeschlagen: ${(failure.stderr || failure.message).trim()}`);
  }
};

const addPort = (ports: WorkspaceProcessPort[], port: WorkspaceProcessPort): void => {
  if (!ports.some((known) => known.port === port.port && known.address === port.address)) ports.push(port);
};

const DARWIN_TABLE_LINE = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(-?\d+)\s+(\w{3} \w{3} [ \d]\d \d\d:\d\d:\d\d \d{4})\s*(.*)$/;
const MARKER_TOKEN = new RegExp(`(?:^|\\s)${RUN_MARKER_ENV}=(\\S+)`);

export class ProcessChangedError extends Error {
  constructor(readonly pid: number) {
    super(`Prozess ${pid} hat sich während der Umgebungsabfrage geändert`);
    this.name = "ProcessChangedError";
  }
}

export const parseDarwinProcessTable = (text: string): ProcessRecord[] =>
  text.split("\n").filter((line) => line.trim() !== "").map((line) => {
    const match = DARWIN_TABLE_LINE.exec(line);
    if (!match) throw new Error(`Unlesbare Prozesszeile von ps: ${line}`);
    return {
      pid: Number(match[1]),
      ppid: Number(match[2]),
      pgid: Number(match[3]),
      uid: Number(match[4]),
      startKey: match[5],
      command: match[6],
    };
  });

export const parseDarwinMarkers = (text: string, commands?: ReadonlyMap<number, string>): Map<number, string> => {
  const markers = new Map<number, string>();
  for (const line of text.split("\n")) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!match) continue;
    if (match[2].trim() === "<defunct>") continue;
    const pid = Number(match[1]);
    const command = commands?.get(pid);
    if (commands && command === undefined) continue;
    if (command !== undefined && (!match[2].startsWith(command)
      || (match[2].length > command.length && !/^\s/.test(match[2].slice(command.length)))))
      throw new ProcessChangedError(pid);
    const environment = command === undefined ? match[2] : match[2].slice(command.length);
    const marker = runMarkerOf(MARKER_TOKEN.exec(environment)?.[1]);
    if (marker) markers.set(Number(match[1]), marker);
  }
  return markers;
};

const portFromLsofName = (name: string): WorkspaceProcessPort | undefined => {
  const separator = name.lastIndexOf(":");
  if (separator < 0) return undefined;
  const port = Number(name.slice(separator + 1));
  if (!Number.isInteger(port) || port <= 0) return undefined;
  const host = name.slice(0, separator);
  const wildcard = host === "*" || host === "0.0.0.0" || host === "[::]";
  return { port, address: wildcard ? WILDCARD : host.replace(/^\[|\]$/g, "") };
};

export const parseLsofListeners = (text: string): Map<number, WorkspaceProcessPort[]> => {
  const listeners = new Map<number, WorkspaceProcessPort[]>();
  let current: WorkspaceProcessPort[] | undefined;
  for (const line of text.split("\n")) {
    if (line.startsWith("p")) {
      const pid = Number(line.slice(1));
      current = listeners.get(pid) ?? [];
      listeners.set(pid, current);
    } else if (line.startsWith("n") && current) {
      const port = portFromLsofName(line.slice(1));
      if (port) addPort(current, port);
    }
  }
  return listeners;
};

const darwinCommands = (text: string): Map<number, string> => new Map(text.split("\n")
  .filter((line) => line.trim() !== "").map((line) => {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!match) throw new Error("Unlesbare Befehlszeile von ps");
    return [Number(match[1]), match[2]];
  }));

export const darwinProcessTable = (command: typeof runCommand = runCommand): ProcessTable => ({
  list: async () =>
    parseDarwinProcessTable(await command("ps", ["-axww", "-o", "pid=,ppid=,pgid=,uid=,lstart=,args="], [])),
  runMarkers: async (pids) => {
    const markers = new Map<number, string>();
    for (const chunk of chunked(pids)) {
      let pending = chunk;
      for (let attempt = 0; pending.length > 0; attempt++) {
        const readCommands = async () => darwinCommands(await command("ps", ["-ww", "-o", "pid=,args=", "-p", pending.join(",")], [1]));
        const before = await readCommands();
        const output = darwinCommands(await command("ps", ["-ww", "-E", "-o", "pid=,args=", "-p", pending.join(",")], [1]));
        const after = await readCommands();
        const changed: number[] = [];
        for (const pid of pending) {
          const initial = before.get(pid);
          const current = after.get(pid);
          const environment = output.get(pid);
          if (initial === undefined || current === undefined || current.trim() === "<defunct>"
            || environment === undefined || environment.trim() === "<defunct>") continue;
          try {
            if (initial !== current) throw new ProcessChangedError(pid);
            const marker = parseDarwinMarkers(`${pid} ${environment}`, new Map([[pid, current]])).get(pid);
            if (marker) markers.set(pid, marker);
          } catch (error) {
            if (!(error instanceof ProcessChangedError) || attempt === 2) throw error;
            changed.push(error.pid);
          }
        }
        pending = changed;
      }
    }
    return markers;
  },
  listeningPorts: async (pids) => {
    const listeners = new Map<number, WorkspaceProcessPort[]>();
    for (const chunk of chunked(pids)) {
      const output = await command(
        "lsof",
        ["-nP", "-iTCP", "-sTCP:LISTEN", "-a", "-p", chunk.join(","), "-Fpn"],
        [1],
      );
      for (const [pid, ports] of parseLsofListeners(output)) listeners.set(pid, ports);
    }
    return listeners;
  },
});

const isGone = (error: unknown): boolean => {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ESRCH";
};

const isDenied = (error: unknown): boolean => {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EACCES" || code === "EPERM";
};

const explainAccess = (error: unknown, pid: number, what: string): Error => {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "EACCES" || code === "EPERM") {
    return new Error(
      `${what} von Prozess ${pid} ist nicht lesbar (${code}); als root braucht die Prozessüberwachung CAP_SYS_PTRACE`,
    );
  }
  return error instanceof Error ? error : new Error(String(error));
};

export interface LinuxStat {
  comm: string;
  state: string;
  ppid: number;
  pgid: number;
  startTime: string;
}

export const parseLinuxStat = (text: string): LinuxStat => {
  const open = text.indexOf("(");
  const close = text.lastIndexOf(")");
  const fields = open >= 0 && close > open ? text.slice(close + 2).trim().split(" ") : [];
  if (fields.length < 20) throw new Error(`Unlesbare stat-Zeile: ${text.trim()}`);
  return {
    comm: text.slice(open + 1, close),
    state: fields[0],
    ppid: Number(fields[1]),
    pgid: Number(fields[2]),
    startTime: fields[19],
  };
};

const formatIpv6 = (groups: readonly number[]): string => {
  let bestStart = -1;
  let bestLength = 0;
  for (let index = 0; index < groups.length;) {
    if (groups[index] !== 0) {
      index += 1;
      continue;
    }
    let end = index;
    while (end < groups.length && groups[end] === 0) end += 1;
    if (end - index > bestLength) {
      bestStart = index;
      bestLength = end - index;
    }
    index = end;
  }
  const hex = groups.map((group) => group.toString(16));
  if (bestLength < 2) return hex.join(":");
  const head = hex.slice(0, bestStart).join(":");
  const tail = hex.slice(bestStart + bestLength).join(":");
  return `${head}::${tail}`;
};

export const addressFromHex = (hex: string): string => {
  if (hex.length === 8) {
    const bytes = [3, 2, 1, 0].map((index) => parseInt(hex.slice(index * 2, index * 2 + 2), 16));
    const address = bytes.join(".");
    return address === "0.0.0.0" ? WILDCARD : address;
  }
  if (hex.length === 32) {
    const bytes: number[] = [];
    for (let word = 0; word < 4; word += 1) {
      for (const index of [3, 2, 1, 0]) {
        const offset = word * 8 + index * 2;
        bytes.push(parseInt(hex.slice(offset, offset + 2), 16));
      }
    }
    const groups = Array.from({ length: 8 }, (_, index) => (bytes[index * 2] << 8) | bytes[index * 2 + 1]);
    if (groups.every((group) => group === 0)) return WILDCARD;
    return formatIpv6(groups);
  }
  throw new Error(`Unbekannte Adressform in /proc/net/tcp: ${hex}`);
};

export interface LinuxListener {
  inode: string;
  port: WorkspaceProcessPort;
}

export const parseLinuxTcpTable = (text: string): LinuxListener[] =>
  text.split("\n").slice(1).filter((line) => line.trim() !== "").flatMap((line) => {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 10) throw new Error(`Unlesbare Zeile in /proc/net/tcp: ${line.trim()}`);
    if (fields[3] !== "0A") return [];
    const [hexAddress, hexPort] = fields[1].split(":");
    return [{ inode: fields[9], port: { port: parseInt(hexPort, 16), address: addressFromHex(hexAddress) } }];
  });

const numericEntries = async (directory: string): Promise<number[]> =>
  (await readdir(directory)).filter((name) => /^\d+$/.test(name)).map(Number);

const readLinuxRecord = async (proc: string, pid: number): Promise<ProcessRecord | undefined> => {
  let stat: string;
  let status: string;
  let cmdline: Buffer;
  try {
    [stat, status, cmdline] = await Promise.all([
      readFile(`${proc}/${pid}/stat`, "utf8"),
      readFile(`${proc}/${pid}/status`, "utf8"),
      readFile(`${proc}/${pid}/cmdline`),
    ]);
  } catch (error) {
    if (isGone(error)) return undefined;
    throw error;
  }
  const parsed = parseLinuxStat(stat);
  if (parsed.state === "Z") return undefined;
  const uid = Number(/^Uid:\s+(\d+)/m.exec(status)?.[1]);
  if (!Number.isInteger(uid)) throw new Error(`${proc}/${pid}/status nennt keine Uid`);
  const args = cmdline.toString("utf8").split("\0").filter((argument) => argument !== "");
  return {
    pid,
    ppid: parsed.ppid,
    pgid: parsed.pgid,
    uid,
    startKey: parsed.startTime,
    command: args.length > 0 ? args.join(" ") : `[${parsed.comm}]`,
  };
};

const readLinuxMarker = async (proc: string, pid: number, asRoot: boolean): Promise<string | undefined> => {
  let environ: Buffer;
  try {
    environ = await readFile(`${proc}/${pid}/environ`);
  } catch (error) {
    if (isGone(error) || (isDenied(error) && !asRoot)) return undefined;
    throw explainAccess(error, pid, "Die Umgebung");
  }
  const prefix = `${RUN_MARKER_ENV}=`;
  const entry = environ.toString("utf8").split("\0").find((candidate) => candidate.startsWith(prefix));
  return runMarkerOf(entry?.slice(prefix.length));
};

const linuxListeningInodes = async (proc: string): Promise<Map<string, WorkspaceProcessPort>> => {
  const inodes = new Map<string, WorkspaceProcessPort>();
  for (const table of ["tcp", "tcp6"]) {
    let text: string;
    try {
      text = await readFile(`${proc}/net/${table}`, "utf8");
    } catch (error) {
      if (isGone(error)) continue;
      throw error;
    }
    for (const listener of parseLinuxTcpTable(text)) inodes.set(listener.inode, listener.port);
  }
  return inodes;
};

const linuxSocketInodes = async (proc: string, pid: number, asRoot: boolean): Promise<string[]> => {
  const directory = `${proc}/${pid}/fd`;
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (isGone(error) || (isDenied(error) && !asRoot)) return [];
    throw explainAccess(error, pid, "Die Dateideskriptoren");
  }
  const inodes: string[] = [];
  for (const name of names) {
    let target: string;
    try {
      target = await readlink(`${directory}/${name}`);
    } catch (error) {
      if (isGone(error) || (isDenied(error) && !asRoot)) continue;
      throw explainAccess(error, pid, "Die Dateideskriptoren");
    }
    const match = /^socket:\[(\d+)\]$/.exec(target);
    if (match) inodes.push(match[1]);
  }
  return inodes;
};

export interface LinuxProcessTableOptions {
  /** Der Ordner der Prozessdateien; Tests nennen einen eigenen. */
  readonly proc?: string;
  /** Als root ist eine gesperrte Umgebung ein fehlendes Recht; sonst hat sich ein eigener Prozess unlesbar gemacht. */
  readonly asRoot?: boolean;
}

/** Ohne root liest die Tabelle nur eigene Prozesse; einer, der sich unlesbar gemacht hat (PR_SET_DUMPABLE, etwa ein Chrome-Helfer oder ssh-agent), trägt keinen erkennbaren Marker. */
export const linuxProcessTable = (options: LinuxProcessTableOptions = {}): ProcessTable => {
  const proc = options.proc ?? "/proc";
  const asRoot = options.asRoot ?? process.getuid?.() === 0;
  return {
    list: async () => {
      const records = await Promise.all((await numericEntries(proc)).map((pid) => readLinuxRecord(proc, pid)));
      return records.filter((record): record is ProcessRecord => record !== undefined);
    },
    runMarkers: async (pids) => {
      const markers = new Map<number, string>();
      for (const pid of pids) {
        const marker = await readLinuxMarker(proc, pid, asRoot);
        if (marker) markers.set(pid, marker);
      }
      return markers;
    },
    listeningPorts: async (pids) => {
      const listeners = new Map<number, WorkspaceProcessPort[]>();
      if (pids.length === 0) return listeners;
      const inodes = await linuxListeningInodes(proc);
      if (inodes.size === 0) return listeners;
      for (const pid of pids) {
        const ports: WorkspaceProcessPort[] = [];
        for (const inode of await linuxSocketInodes(proc, pid, asRoot)) {
          const port = inodes.get(inode);
          if (port) addPort(ports, port);
        }
        if (ports.length > 0) listeners.set(pid, ports);
      }
      return listeners;
    },
  };
};

/** Nur macOS und Linux haben eine Prozesstabelle, aus der sich Run-Marker lesen lassen. */
export const hasProcessTable = (platform: NodeJS.Platform = process.platform): boolean =>
  platform === "darwin" || platform === "linux";

export const processTableForPlatform = (platform: NodeJS.Platform = process.platform): ProcessTable => {
  if (platform === "darwin") return darwinProcessTable();
  if (platform === "linux") return linuxProcessTable();
  if (platform === "win32") {
    throw new Error("Unter Windows gibt es keine Prozesstabelle: für Runs, die auf diesem Rechner arbeiten, zeigt und beendet "
      + "die Prozessüberwachung nichts. Die Werkzeuge des Arbeitsbereichs brauchen sie nicht.");
  }
  throw new Error(`Die Prozessüberwachung kennt die Plattform ${platform} nicht (nur darwin und linux)`);
};
