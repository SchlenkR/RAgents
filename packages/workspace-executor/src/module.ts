import type { UnreportedBackgroundTask } from "./background-tasks.js";
import type { WorkspaceProcessContext } from "./context.js";
import type { OperationFootprint } from "./paths.js";
import type { WorkspaceExecuteOptions } from "./executor.js";

/** A call of an operation: the run, the input and what the caller passes along. */
export interface WorkspaceOperationCall {
  readonly runId: string;
  readonly input: unknown;
  readonly toolCallId: string | undefined;
  readonly signal: AbortSignal | undefined;
  /** Reports a JSON value as progress; missing if the caller wants no progress. */
  readonly progress: ((value: unknown) => void) | undefined;
}

export type WorkspaceOperation = (call: WorkspaceOperationCall) => Promise<unknown>;

/** A building block of the executor: named operations and its share of the cleanup. */
export interface WorkspaceExecutorModule {
  readonly operations: Readonly<Record<string, WorkspaceOperation>>;
  /** The footprint of an input per operation; without an entry it addresses no specific root. Never throws, not even for invalid input. */
  readonly footprints?: Readonly<Record<string, (input: unknown) => OperationFootprint>>;
  /** An annotation for a file just written, such as the diagnostics of a language server. */
  readonly annotate?: (runId: string, absolutePath: string) => Promise<string | undefined>;
  /** The process groups the module keeps running beyond a call, such as background commands of bash; the process display counts them as background. */
  readonly backgroundGroups?: () => readonly number[];
  /** The background commands of every run whose end no observation has returned yet. */
  readonly unreportedBackgroundTasks?: () => readonly UnreportedBackgroundTask[];
  /** Releases what the module holds for a run. */
  readonly stopRun?: (runId: string) => Promise<void>;
  /** Releases everything; afterwards nobody calls the module anymore, it may reject later calls with a cause. */
  readonly shutdown?: () => Promise<void>;
}

/** What a module gets from the executor: the context of a run on this machine, the annotations and the background process groups of all modules. */
export interface WorkspaceModuleHost {
  readonly contextFor: (runId: string) => Promise<WorkspaceProcessContext>;
  readonly annotate: (runId: string, absolutePath: string) => Promise<string | undefined>;
  readonly backgroundGroups: () => ReadonlySet<number>;
  readonly execute: (runId: string, operation: string, input: unknown, options?: WorkspaceExecuteOptions) => Promise<unknown>;
}

export type WorkspaceModuleFactory = (host: WorkspaceModuleHost) => WorkspaceExecutorModule;
