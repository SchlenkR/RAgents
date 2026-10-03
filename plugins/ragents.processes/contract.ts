import { Type } from "typebox";
import { defineChannel, defineOperation } from "@ragents/engine/src/rpc/contract";
import { openJson } from "@ragents/engine/src/http/contracts";

export const PROCESSES_PLUGIN_ID = "ragents.processes";

export interface RunProcessPort {
  port: number;
  address: string;
}

export type RunProcessOrigin = "tool-call" | "background";

export interface RunProcess {
  id: string;
  pid: number;
  label: string;
  command: string;
  origin: RunProcessOrigin;
  ports: RunProcessPort[];
  seenSince: string;
}

/** Where the run's processes run: on the server or on the workstation the run is bound to, with its ID and current label. */
export type RunProcessMachine = "server" | { client: string; label: string };

export interface RunProcessSnapshot {
  runId: string;
  observedAt: string;
  machine: RunProcessMachine;
  processes: RunProcess[];
}

export type RunProcessMessage =
  | { kind: "snapshot"; snapshot: RunProcessSnapshot }
  | { kind: "error"; error: string };

const runId = Type.String({ minLength: 1, maxLength: 64, description: "Run id" });

/** Where both legs of a tunnel stream open their WebSocket; the query names the one-time secret of the leg. */
export const PROCESS_TUNNEL_PATH = "/api/plugins/ragents.processes/tunnel";

export const processesContracts = {
  snapshot: defineOperation({
    id: "ragents.processes.snapshot",
    description: "The observed processes of a run with their open ports. Rights: runs.read and ragents.processes.read.",
    rights: ["runs.read", "ragents.processes.read"],
    input: Type.Object({ runId }, { additionalProperties: false }),
    result: openJson<RunProcessSnapshot>("RunProcessSnapshot"),
  }),
  stop: defineOperation({
    id: "ragents.processes.stop",
    description: "End a process of the run. Rights: runs.read, runs.write and runs.inspect.",
    rights: ["runs.read", "runs.write", "runs.inspect"],
    input: Type.Object({
      runId,
      processId: Type.String({ pattern: "^[1-9][0-9]*-[a-f0-9]{64}$", description: "Process id from the snapshot" }),
    }, { additionalProperties: false }),
    result: Type.Null(),
  }),
  tunnel: defineOperation({
    id: "ragents.processes.tunnel",
    description: "Open a byte stream to a port of the run's own processes on the machine the run works on: that machine connects to the port and dials back, "
      + "and the result names the path with query on this server where the caller opens its WebSocket leg, once and within 15 seconds. "
      + "With connect false it only checks that a process of the run listens on the port. Rights: runs.read, runs.inspect and ragents.processes.read.",
    rights: ["runs.read", "runs.inspect", "ragents.processes.read"],
    input: Type.Object({
      runId,
      port: Type.Integer({ minimum: 1, maximum: 65535, description: "Port from the process snapshot" }),
      connect: Type.Boolean({ description: "false only checks the port" }),
    }, { additionalProperties: false }),
    result: Type.Union([Type.Object({
      path: Type.String({ pattern: "^/", description: "Path with query on this server where the caller opens its WebSocket leg" }),
    }, { additionalProperties: false }), Type.Null()]),
  }),
  live: defineChannel({
    id: "ragents.processes",
    description: "The live state of a run's process monitoring. Rights: runs.read and ragents.processes.read.",
    rights: ["runs.read", "ragents.processes.read"],
    params: Type.Object({ runId }, { additionalProperties: false }),
    message: openJson<RunProcessMessage>("RunProcessMessage"),
  }),
};
