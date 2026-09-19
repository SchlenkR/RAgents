import type { AccessContext } from "@aicontainer/ragents";
import { assertRights } from "../rpc/dispatcher.js";
import type { RunRightsKind } from "@aicontainer/ragents/src/http/methods";

export interface GlobalRunPolicy {
  runId: string;
  read: string;
  write: string;
}

/** Rechte je Run: gewöhnliche Runs über runs.*, der globale Chat über die Rechte seines Plugins. */
export const runRights = (runId: string, kind: RunRightsKind, global: GlobalRunPolicy | undefined): readonly string[] => {
  if (global && runId === global.runId) {
    const technical = kind === "inspect" || kind === "write-inspect" ? ["runs.inspect"] : [];
    return kind === "read" || kind === "inspect" ? [global.read, ...technical] : [global.read, global.write, ...technical];
  }
  switch (kind) {
    case "read": return ["runs.read"];
    case "inspect": return ["runs.read", "runs.inspect"];
    case "write": return ["runs.read", "runs.write"];
    case "write-inspect": return ["runs.read", "runs.write", "runs.inspect"];
  }
};

export const assertRunRights = (access: AccessContext, runId: string, kind: RunRightsKind, global: GlobalRunPolicy | undefined): void =>
  assertRights(access, runRights(runId, kind, global));
