import type { WorkspaceProcessContext } from "./context.js";

/** Ein Aufruf einer Operation: der Run, die Eingabe und was der Aufrufer mitgibt. */
export interface WorkspaceOperationCall {
  readonly runId: string;
  readonly input: unknown;
  readonly toolCallId: string | undefined;
  readonly signal: AbortSignal | undefined;
  /** Meldet einen JSON-Wert als Fortschritt; fehlt, wenn der Aufrufer keinen Fortschritt will. */
  readonly progress: ((value: unknown) => void) | undefined;
}

export type WorkspaceOperation = (call: WorkspaceOperationCall) => Promise<unknown>;

/** Ein Baustein des Executors: benannte Operationen und sein Anteil am Aufräumen. */
export interface WorkspaceExecutorModule {
  readonly operations: Readonly<Record<string, WorkspaceOperation>>;
  /** Eine Anmerkung zu einer gerade geschriebenen Datei, etwa die Diagnostik eines Sprachservers. */
  readonly annotate?: (runId: string, absolutePath: string) => Promise<string | undefined>;
  /** Gibt frei, was das Modul für einen Run hält. */
  readonly stopRun?: (runId: string) => Promise<void>;
  /** Gibt alles frei; danach ruft niemand das Modul mehr auf, es darf spätere Aufrufe mit Ursache ablehnen. */
  readonly shutdown?: () => Promise<void>;
}

/** Was ein Modul vom Executor bekommt: den Kontext eines Runs auf dieser Maschine und die Anmerkungen aller Module. */
export interface WorkspaceModuleHost {
  readonly contextFor: (runId: string) => Promise<WorkspaceProcessContext>;
  readonly annotate: (runId: string, absolutePath: string) => Promise<string | undefined>;
}

export type WorkspaceModuleFactory = (host: WorkspaceModuleHost) => WorkspaceExecutorModule;
