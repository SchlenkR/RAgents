import type { UnreportedBackgroundTask } from "./background-tasks.js";
import type { BrowserNetworkPolicy, WorkspaceProcessContext } from "./context.js";
import { WorkspaceOperationError } from "./errors.js";
import type { WorkspaceExecutorModule, WorkspaceModuleFactory, WorkspaceOperation } from "./module.js";
import { NO_ROOTS, type OperationFootprint } from "./paths.js";

/** The version of the executor; server and workspace must carry the same one. */
export const WORKSPACE_EXECUTOR_VERSION = "14";

export interface WorkspaceExecuteOptions {
  browserNetwork?: BrowserNetworkPolicy;
  toolCallId?: string;
  signal?: AbortSignal;
  /** Receives the progress of the operation as a JSON value. */
  onProgress?: (value: unknown) => void;
  /** How long the operation itself may run; a remote executor waits this long in addition to its safety margin. */
  durationMs?: number;
  /** The operation runs until it is aborted through `signal`, such as a watch; no timeout applies. */
  untilAborted?: boolean;
  /** Execute only if the executor is reachable and answers in time; otherwise the result is `null`. For cleanup that `stopRun` catches up on. */
  whenReachable?: boolean;
}

/** Executes the operations of a run on a machine; knows neither engine nor run contract nor plugins. */
export interface WorkspaceExecutor {
  readonly version: string;
  execute: (runId: string, operation: string, input: unknown, options?: WorkspaceExecuteOptions) => Promise<unknown>;
  /** Releases what the executor holds for the run; a remote executor catches up on this if it is currently unreachable. */
  stopRun: (runId: string) => Promise<void>;
  /** Ends the executor for good; whoever needs one again afterwards builds a new one. */
  shutdown: () => Promise<void>;
}

export interface WorkspaceOperationExecutorOptions {
  contextFor: (runId: string) => Promise<WorkspaceProcessContext>;
  modules: readonly WorkspaceModuleFactory[];
}

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

const settledAll = async (operations: readonly Promise<void>[]): Promise<void> => {
  const results = await Promise.allSettled(operations);
  const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failed) throw failed.reason;
};

/** An executor made of modules: every operation belongs to exactly one module, the executor itself knows none. */
export class WorkspaceOperationExecutor implements WorkspaceExecutor {
  readonly version = WORKSPACE_EXECUTOR_VERSION;
  readonly #modules: readonly WorkspaceExecutorModule[];
  readonly #operations: ReadonlyMap<string, WorkspaceOperation>;
  readonly #footprints: ReadonlyMap<string, (input: unknown) => OperationFootprint>;

  constructor(options: WorkspaceOperationExecutorOptions) {
    const host = {
      contextFor: options.contextFor,
      annotate: (runId: string, absolutePath: string) => this.#annotate(runId, absolutePath),
      backgroundGroups: () => new Set(this.#modules.flatMap((module) => module.backgroundGroups?.() ?? [])),
      execute: (runId: string, operation: string, input: unknown, executeOptions?: WorkspaceExecuteOptions) => this.execute(runId, operation, input, executeOptions),
    };
    this.#modules = options.modules.map((create) => create(host));
    const operations = new Map<string, WorkspaceOperation>();
    for (const module of this.#modules) {
      for (const [name, operation] of Object.entries(module.operations)) {
        if (operations.has(name)) throw new Error(`The operation ${name} is registered twice in the executor`);
        operations.set(name, operation);
      }
    }
    this.#operations = operations;
    this.#footprints = new Map(this.#modules.flatMap((module) => Object.entries(module.footprints ?? {}).map(([name, footprint]) => {
      if (!Object.hasOwn(module.operations, name)) throw new Error(`A module declares a footprint for ${name}, an operation it does not have`);
      return [name, footprint] as const;
    })));
  }

  /** The footprint of an input according to the declaration of the module the operation belongs to; this tells a caller which machine it belongs on. */
  footprintOf(operation: string, input: unknown): OperationFootprint {
    return this.#footprints.get(operation)?.(input) ?? { roots: NO_ROOTS };
  }

  async execute(runId: string, operation: string, input: unknown, options: WorkspaceExecuteOptions = {}): Promise<unknown> {
    const run = this.#operations.get(operation);
    if (!run) throw new WorkspaceOperationError("workspace-operation-unknown", `The executor does not know the operation ${operation}`, 400);
    if (options.untilAborted && !options.signal) throw new Error(`The operation ${operation} runs until it is aborted and needs an abort signal for that`);
    return run({ runId, input, toolCallId: options.toolCallId, signal: options.signal, progress: options.onProgress });
  }

  /** A workstation names them at its sign-in, so that a restarted server observes their ends again. */
  unreportedBackgroundTasks(): readonly UnreportedBackgroundTask[] {
    return this.#modules.flatMap((module) => module.unreportedBackgroundTasks?.() ?? []);
  }

  stopRun(runId: string): Promise<void> {
    return settledAll(this.#modules.flatMap((module) => module.stopRun ? [module.stopRun(runId)] : []));
  }

  shutdown(): Promise<void> {
    return settledAll(this.#modules.flatMap((module) => module.shutdown ? [module.shutdown()] : []));
  }

  async #annotate(runId: string, absolutePath: string): Promise<string | undefined> {
    const notes = await Promise.all(this.#modules.flatMap((module) => module.annotate
      ? [module.annotate(runId, absolutePath).catch((error: unknown) => `Annotation failed: ${messageOf(error)}`)]
      : []));
    const text = notes.filter((note): note is string => Boolean(note)).join("\n");
    return text || undefined;
  }
}
