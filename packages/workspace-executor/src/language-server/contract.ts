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
  /** Relativ zur Wurzel des Arbeitsbereichs, mit Schrägstrichen. */
  path: string;
  root: string;
  state: LanguageServerState | null;
}

export interface LanguageServerSolutions {
  source: "git" | "directory";
  solutions: readonly LanguageServerSolution[];
  /** Ob im Run schon eine Instanz dieser Sprache offen ist oder gerade geöffnet wird. */
  opened: boolean;
}
