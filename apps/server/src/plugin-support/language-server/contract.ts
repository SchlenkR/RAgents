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

const runIdSchema = Type.String({ minLength: 1, maxLength: 64, description: "Kennung des Runs" });

/** Je Sprachserver-Plugin eine Methode; die Rechte tragen seine Kennung. */
export const languageServerSnapshotContract = (pluginId: string) =>
  defineOperation({
    id: `${pluginId}.snapshot`,
    description: `Zustand und Diagnosen des Sprachservers ${pluginId} in einem Run. Rechte: runs.read und ${pluginId}.read.`,
    rights: ["runs.read", `${pluginId}.read`],
    input: Type.Object({
      runId: runIdSchema,
    }, { additionalProperties: false }),
    result: openJson<LanguageServerSnapshot>("LanguageServerSnapshot"),
  });

export const languageServerSolutionsContract = (pluginId: string) =>
  defineOperation({
    id: `${pluginId}.solutions`,
    description: `Die Solutions im Arbeitsbereich eines Runs und welche davon ${pluginId} geöffnet hat. Rechte: runs.read und ${pluginId}.read.`,
    rights: ["runs.read", `${pluginId}.read`],
    input: Type.Object({
      runId: runIdSchema,
    }, { additionalProperties: false }),
    result: openJson<LanguageServerSolutions>("LanguageServerSolutions"),
  });

export const languageServerSwitchContract = (pluginId: string) =>
  defineOperation({
    id: `${pluginId}.switch`,
    description: `Lädt eine Solution in ${pluginId} und beendet alle anderen Instanzen des Runs; null beendet alle. `
      + `Wartet nicht auf das Laden. Rechte: runs.read, runs.write, ${pluginId}.read und ${pluginId}.write.`,
    rights: ["runs.read", "runs.write", `${pluginId}.read`, `${pluginId}.write`],
    input: Type.Object({
      runId: runIdSchema,
      root: Type.Union([
        Type.String({ minLength: 1, maxLength: 1024, description: "Die Solution relativ zur Wurzel des Arbeitsbereichs" }),
        Type.Null(),
      ], { description: "null beendet alle Instanzen" }),
    }, { additionalProperties: false }),
    result: openJson<LanguageServerSolutions>("LanguageServerSolutions"),
  });
