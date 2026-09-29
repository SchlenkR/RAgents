export type LanguageServerState = "opening" | "ready" | "failed" | "suspended";

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

export interface LanguageServerInstanceSnapshot {
  state: LanguageServerState;
  root: string;
  summary: string | null;
  files: readonly LanguageServerFileDiagnostics[];
}

export interface LanguageServerSnapshot {
  instances: readonly LanguageServerInstanceSnapshot[];
}

export interface LanguageServerSolution {
  /** Relative to the root of the workspace, with forward slashes. */
  path: string;
  root: string;
  state: LanguageServerState | null;
}

export interface LanguageServerSolutions {
  source: "git" | "directory";
  solutions: readonly LanguageServerSolution[];
  /** Whether an instance of this language is already open or being opened in the run. */
  opened: boolean;
}
