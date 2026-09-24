import { isRecord } from "@ragents/web/lib/guards";
import type { RunProcess, RunProcessMessage, RunProcessPort, RunProcessSnapshot } from "../contract";

export const VISIBLE_PROCESSES = 4;

const ORIGINS = ["tool-call", "background"] as const;

const portFrom = (value: unknown): RunProcessPort => {
  if (!isRecord(value) || typeof value.port !== "number" || typeof value.address !== "string") {
    throw new Error("Ein Port-Eintrag der Prozessüberwachung ist unlesbar");
  }
  return { port: value.port, address: value.address };
};

const processFrom = (value: unknown): RunProcess => {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id || typeof value.pid !== "number" || typeof value.label !== "string"
    || typeof value.command !== "string" || typeof value.seenSince !== "string"
    || !ORIGINS.includes(value.origin as RunProcess["origin"]) || !Array.isArray(value.ports)) {
    throw new Error("Ein Prozess-Eintrag der Prozessüberwachung ist unlesbar");
  }
  return {
    id: value.id,
    pid: value.pid,
    label: value.label,
    command: value.command,
    origin: value.origin as RunProcess["origin"],
    ports: value.ports.map(portFrom),
    seenSince: value.seenSince,
  };
};

const snapshotFrom = (value: unknown): RunProcessSnapshot => {
  if (!isRecord(value) || typeof value.runId !== "string" || typeof value.observedAt !== "string"
    || !Array.isArray(value.processes)) {
    throw new Error("Der Stand der Prozessüberwachung ist unlesbar");
  }
  return { runId: value.runId, observedAt: value.observedAt, processes: value.processes.map(processFrom) };
};

export const messageFrom = (value: unknown): RunProcessMessage => {
  if (!isRecord(value)) throw new Error("Die Nachricht der Prozessüberwachung ist unlesbar");
  if (value.kind === "error" && typeof value.error === "string") return { kind: "error", error: value.error };
  if (value.kind === "snapshot") return { kind: "snapshot", snapshot: snapshotFrom(value.snapshot) };
  throw new Error("Die Nachricht der Prozessüberwachung hat eine unbekannte Art");
};

export const serviceUrl = (hostname: string, port: number): string =>
  `http://${hostname.includes(":") ? `[${hostname}]` : hostname}:${port}/`;

export const kindLabel = (process: RunProcess): string => process.ports.length > 0 ? "Dienst" : "Prozess";

const originText = (origin: RunProcess["origin"]): string =>
  origin === "background" ? "läuft im Hintergrund weiter" : "läuft in einem Werkzeugaufruf";

const timeText = (iso: string): string => {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleTimeString("de-DE");
};

export const titleOf = (process: RunProcess): string => {
  const ports = process.ports.length > 0
    ? `\nLauscht auf ${process.ports.map((port) => `${port.address}:${port.port}`).join(", ")}`
    : "";
  return `${process.command}\nPID ${process.pid}, ${originText(process.origin)}, beobachtet seit ${timeText(process.seenSince)}${ports}`;
};

export interface VisibleProcesses {
  shown: readonly RunProcess[];
  hidden: number;
}

export const visibleProcesses = (processes: readonly RunProcess[]): VisibleProcesses => ({
  shown: processes.slice(0, VISIBLE_PROCESSES),
  hidden: Math.max(0, processes.length - VISIBLE_PROCESSES),
});
