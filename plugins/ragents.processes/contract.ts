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

export interface RunProcessSnapshot {
  runId: string;
  observedAt: string;
  processes: RunProcess[];
}

export type RunProcessMessage =
  | { kind: "snapshot"; snapshot: RunProcessSnapshot }
  | { kind: "error"; error: string };

const runId = Type.String({ minLength: 1, maxLength: 64, description: "Kennung des Runs" });

export const processesContracts = {
  snapshot: defineOperation({
    id: "ragents.processes.snapshot",
    description: "Die beobachteten Prozesse eines Laufs mit ihren offenen Ports. Rechte: runs.read und ragents.processes.read.",
    rights: ["runs.read", "ragents.processes.read"],
    input: Type.Object({ runId }, { additionalProperties: false }),
    result: openJson<RunProcessSnapshot>("RunProcessSnapshot"),
  }),
  stop: defineOperation({
    id: "ragents.processes.stop",
    description: "Einen Prozess des Laufs beenden. Rechte: runs.read, runs.write und runs.inspect.",
    rights: ["runs.read", "runs.write", "runs.inspect"],
    input: Type.Object({
      runId,
      processId: Type.String({ pattern: "^[1-9][0-9]*-[a-f0-9]{64}$", description: "Kennung des Prozesses aus dem Stand" }),
    }, { additionalProperties: false }),
    result: Type.Null(),
  }),
  live: defineChannel({
    id: "ragents.processes",
    description: "Der laufende Stand der Prozessüberwachung eines Laufs. Rechte: runs.read und ragents.processes.read.",
    rights: ["runs.read", "ragents.processes.read"],
    params: Type.Object({ runId }, { additionalProperties: false }),
    message: openJson<RunProcessMessage>("RunProcessMessage"),
  }),
};
