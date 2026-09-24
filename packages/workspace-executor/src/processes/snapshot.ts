import path from "node:path";
import { processIdOf, type ProcessRecord, type WorkspaceProcessPort } from "./process-table.js";

export type WorkspaceProcessOrigin = "tool-call" | "background";

export interface WorkspaceProcess {
  id: string;
  pid: number;
  label: string;
  command: string;
  origin: WorkspaceProcessOrigin;
  ports: WorkspaceProcessPort[];
  seenSince: string;
}

const INTERPRETERS = new Set(["node", "nodejs", "bun", "deno", "tsx", "python", "python3", "dotnet", "ruby", "perl", "java"]);
const INLINE_SCRIPT_FLAGS = new Set(["-e", "--eval", "-p", "--print", "-c"]);
const LABEL_LIMIT = 40;

const scriptOf = (parts: readonly string[]): string | undefined => {
  const index = parts.findIndex((part, position) => position > 0 && !part.startsWith("-"));
  if (index < 0 || INLINE_SCRIPT_FLAGS.has(parts[index - 1])) return undefined;
  return path.basename(parts[index]);
};

export const labelOf = (command: string): string => {
  const parts = command.trim().split(/\s+/);
  const name = path.basename(parts[0] ?? "");
  const script = INTERPRETERS.has(name) ? scriptOf(parts) : undefined;
  const label = script ? `${name} ${script}` : name;
  return label.length > LABEL_LIMIT ? `${label.slice(0, LABEL_LIMIT - 1)}…` : label;
};

export interface ObservationInput {
  runId: string;
  /** Der Prozess dieses Executors; seine direkten Kinder sind laufende Werkzeugaufrufe. */
  executorPid: number;
  records: readonly ProcessRecord[];
  markerOf: (record: ProcessRecord) => string | undefined;
  ports: ReadonlyMap<number, readonly WorkspaceProcessPort[]>;
  firstSeen: (record: ProcessRecord) => string;
}

const wildcardFirst = (port: WorkspaceProcessPort): number => port.address === "*" ? 0 : 1;

const byPort = (left: WorkspaceProcessPort, right: WorkspaceProcessPort): number =>
  left.port - right.port || wildcardFirst(left) - wildcardFirst(right) || left.address.localeCompare(right.address);

const byAppearance = (left: WorkspaceProcess, right: WorkspaceProcess): number =>
  left.seenSince.localeCompare(right.seenSince) || left.pid - right.pid;

/** Prozesse des Runs: Hintergrundprozesse immer, Kinder eines laufenden Werkzeugaufrufs nur mit offenem Port. */
export const runProcessesFrom = (input: ObservationInput): WorkspaceProcess[] => {
  const toolCallGroups = new Set(
    input.records.filter((record) => record.ppid === input.executorPid).map((record) => record.pgid),
  );
  return input.records
    .filter((record) => input.markerOf(record) === input.runId)
    .filter((record) => record.pid !== input.executorPid)
    .flatMap((record) => {
      const ports = [...(input.ports.get(record.pid) ?? [])].sort(byPort);
      const origin = toolCallGroups.has(record.pgid) ? "tool-call" as const : "background" as const;
      if (origin === "tool-call" && ports.length === 0) return [];
      return [{
        id: processIdOf(record),
        pid: record.pid,
        label: labelOf(record.command),
        command: record.command,
        origin,
        ports,
        seenSince: input.firstSeen(record),
      }];
    })
    .sort(byAppearance);
};
