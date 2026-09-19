import { Type } from "typebox";
import { defineOperation } from "@aicontainer/ragents/src/rpc/contract";
import { openJson } from "@aicontainer/ragents/src/http/contracts";

export type LanguageServerState = "closed" | "opening" | "ready" | "failed" | "suspended";

export type LanguageServerSeverity = "error" | "warning" | "information" | "hint";

export interface LanguageServerDiagnostic {
  line: number;
  character: number;
  severity: LanguageServerSeverity;
  code?: string;
  message: string;
}

export interface LanguageServerFileDiagnostics {
  path: string;
  diagnostics: readonly LanguageServerDiagnostic[];
}

export interface LanguageServerSnapshot {
  state: LanguageServerState;
  root: string | null;
  summary: string | null;
  files: readonly LanguageServerFileDiagnostics[];
}

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
