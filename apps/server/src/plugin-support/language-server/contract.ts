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

export const languageServerRoutePrefix = (pluginId: string): string => `/api/plugins/${pluginId}`;

export const languageServerSnapshotPath = (routePrefix: string, runId: string): string =>
  `${routePrefix}/runs/${encodeURIComponent(runId)}/language-server`;
