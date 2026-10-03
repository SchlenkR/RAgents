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

const headerPairs = Type.Array(Type.Tuple([Type.String({ minLength: 1 }), Type.String()]), { description: "Header names and values in order; a name may repeat" });

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
  forward: defineOperation({
    id: "ragents.processes.forward",
    description: "Forward one HTTP request to a port of the run's own processes on the machine the run works on, and return the response as it is; "
      + "redirects are not followed, bodies are Base64 and at most 16 MiB. Without a request it only checks that a process of the run listens on the port. "
      + "Rights: runs.read, runs.inspect and ragents.processes.read.",
    rights: ["runs.read", "runs.inspect", "ragents.processes.read"],
    input: Type.Object({
      runId,
      port: Type.Integer({ minimum: 1, maximum: 65535, description: "Port from the process snapshot" }),
      request: Type.Union([Type.Object({
        method: Type.String({ minLength: 1, maxLength: 32 }),
        path: Type.String({ pattern: "^/", maxLength: 16384, description: "Path with query, as the service sees it" }),
        headers: headerPairs,
        body: Type.String({ description: "Body in Base64" }),
      }, { additionalProperties: false }), Type.Null()]),
    }, { additionalProperties: false }),
    result: Type.Union([Type.Object({
      status: Type.Integer({ minimum: 100, maximum: 999 }),
      headers: headerPairs,
      body: Type.String({ description: "Body in Base64" }),
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
