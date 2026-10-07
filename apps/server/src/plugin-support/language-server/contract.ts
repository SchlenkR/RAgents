import { Type } from "typebox";
import { defineOperation } from "@ragents/engine/src/rpc/contract";
import { openJson } from "@ragents/engine/src/http/contracts";
import type { LanguageServerSnapshot, LanguageServerSolutions } from "@ragents/workspace-executor";

export type {
  LanguageServerInstanceSnapshot,
  LanguageServerSeverity,
  LanguageServerSnapshot,
  LanguageServerSolution,
  LanguageServerSolutions,
  LanguageServerState,
} from "@ragents/workspace-executor";

const runIdSchema = Type.String({ minLength: 1, maxLength: 64, description: "Identifier of the run" });

/** One method per language server plugin; the rights carry its identifier. */
export const languageServerSnapshotContract = (pluginId: string) =>
  defineOperation({
    id: `${pluginId}.snapshot`,
    description: `State and diagnostics of the language server ${pluginId} in a run. Rights: runs.read and ${pluginId}.read.`,
    rights: ["runs.read", `${pluginId}.read`],
    input: Type.Object({
      runId: runIdSchema,
    }, { additionalProperties: false }),
    result: openJson<LanguageServerSnapshot>("LanguageServerSnapshot"),
  });

export const languageServerSolutionsContract = (pluginId: string) =>
  defineOperation({
    id: `${pluginId}.solutions`,
    description: `The solutions in the workspace of a run and which of them ${pluginId} has opened. Rights: runs.read and ${pluginId}.read.`,
    rights: ["runs.read", `${pluginId}.read`],
    input: Type.Object({
      runId: runIdSchema,
    }, { additionalProperties: false }),
    result: openJson<LanguageServerSolutions>("LanguageServerSolutions"),
  });

export const languageServerSwitchContract = (pluginId: string) =>
  defineOperation({
    id: `${pluginId}.switch`,
    timeoutMs: 15 * 60_000 + 5_000,
    description: `Loads a solution in ${pluginId} and ends all other instances of the run; null ends all of them. `
      + `Does not wait for the load. Rights: runs.read, runs.write, ${pluginId}.read and ${pluginId}.write.`,
    rights: ["runs.read", "runs.write", `${pluginId}.read`, `${pluginId}.write`],
    input: Type.Object({
      runId: runIdSchema,
      root: Type.Union([
        Type.String({ minLength: 1, maxLength: 1024, description: "The solution relative to the workspace root" }),
        Type.Null(),
      ], { description: "null ends all instances" }),
    }, { additionalProperties: false }),
    result: openJson<LanguageServerSolutions>("LanguageServerSolutions"),
  });
