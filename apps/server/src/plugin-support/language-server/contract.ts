import { Type } from "typebox";
import { defineOperation } from "@ragents/engine/src/rpc/contract";
import { openJson } from "@ragents/engine/src/http/contracts";
import type { LanguageServerSnapshot } from "@ragents/workspace-executor";

export type {
  LanguageServerInstanceSnapshot,
  LanguageServerSeverity,
  LanguageServerSnapshot,
  LanguageServerState,
} from "@ragents/workspace-executor";

/** Je Sprachserver-Plugin eine Methode; die Rechte tragen seine Kennung. */
export const languageServerSnapshotContract = (pluginId: string) =>
  defineOperation({
    id: `${pluginId}.snapshot`,
    description: `Zustand und Diagnosen des Sprachservers ${pluginId} in einem Lauf. Rechte: runs.read und ${pluginId}.read.`,
    rights: ["runs.read", `${pluginId}.read`],
    input: Type.Object({
      runId: Type.String({ minLength: 1, maxLength: 64, description: "Kennung des Runs" }),
    }, { additionalProperties: false }),
    result: openJson<LanguageServerSnapshot>("LanguageServerSnapshot"),
  });
