import type { WorkspaceProcessContext } from "./context.js";
import { WorkspaceOperationError } from "./errors.js";
import type { WorkspaceExecutorModule, WorkspaceModuleFactory, WorkspaceOperation } from "./module.js";
import { NO_ROOTS, type OperationFootprint } from "./paths.js";

/** Der Stand des Executors; Server und Arbeitsplatz müssen denselben tragen. */
export const WORKSPACE_EXECUTOR_VERSION = "5";

export interface WorkspaceExecuteOptions {
  toolCallId?: string;
  signal?: AbortSignal;
  /** Nimmt den Fortschritt der Operation als JSON-Wert entgegen. */
  onProgress?: (value: unknown) => void;
  /** Wie lange die Operation selbst laufen darf; ein entfernter Executor wartet so lange zusätzlich zu seiner Sicherheitsgrenze. */
  durationMs?: number;
  /** Die Operation läuft bis zum Abbruch über `signal`, etwa eine Beobachtung; keine Zeitgrenze greift. */
  untilAborted?: boolean;
  /** Nur ausführen, wenn der Executor erreichbar ist und rechtzeitig antwortet; sonst ist das Ergebnis `null`. Für Aufräumen, das `stopRun` nachholt. */
  whenReachable?: boolean;
}

/** Führt die Operationen eines Runs auf einer Maschine aus; kennt weder Engine noch Run-Vertrag noch Plugins. */
export interface WorkspaceExecutor {
  readonly version: string;
  execute: (runId: string, operation: string, input: unknown, options?: WorkspaceExecuteOptions) => Promise<unknown>;
  /** Gibt frei, was der Executor für den Run hält; ein entfernter Executor holt das nach, wenn er gerade nicht erreichbar ist. */
  stopRun: (runId: string) => Promise<void>;
  /** Beendet den Executor endgültig; wer danach wieder einen braucht, baut einen neuen. */
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

/** Ein Executor aus Modulen: jede Operation gehört genau einem Modul, der Executor selbst kennt keine. */
export class WorkspaceOperationExecutor implements WorkspaceExecutor {
  readonly version = WORKSPACE_EXECUTOR_VERSION;
  readonly #modules: readonly WorkspaceExecutorModule[];
  readonly #operations: ReadonlyMap<string, WorkspaceOperation>;
  readonly #footprints: ReadonlyMap<string, (input: unknown) => OperationFootprint>;

  constructor(options: WorkspaceOperationExecutorOptions) {
    const host = {
      contextFor: options.contextFor,
      annotate: (runId: string, absolutePath: string) => this.#annotate(runId, absolutePath),
    };
    this.#modules = options.modules.map((create) => create(host));
    const operations = new Map<string, WorkspaceOperation>();
    for (const module of this.#modules) {
      for (const [name, operation] of Object.entries(module.operations)) {
        if (operations.has(name)) throw new Error(`Die Operation ${name} ist im Executor doppelt registriert`);
        operations.set(name, operation);
      }
    }
    this.#operations = operations;
    this.#footprints = new Map(this.#modules.flatMap((module) => Object.entries(module.footprints ?? {}).map(([name, footprint]) => {
      if (!Object.hasOwn(module.operations, name)) throw new Error(`Ein Modul erklärt einen Fußabdruck für ${name}, eine Operation, die es nicht hat`);
      return [name, footprint] as const;
    })));
  }

  /** Der Fußabdruck einer Eingabe nach der Erklärung des Moduls, dem die Operation gehört; so weiß ein Aufrufer, auf welche Maschine sie gehört. */
  footprintOf(operation: string, input: unknown): OperationFootprint {
    return this.#footprints.get(operation)?.(input) ?? { roots: NO_ROOTS };
  }

  async execute(runId: string, operation: string, input: unknown, options: WorkspaceExecuteOptions = {}): Promise<unknown> {
    const run = this.#operations.get(operation);
    if (!run) throw new WorkspaceOperationError("workspace-operation-unknown", `Der Executor kennt die Operation ${operation} nicht`, 400);
    if (options.untilAborted && !options.signal) throw new Error(`Die Operation ${operation} läuft bis zum Abbruch und braucht dafür ein Abbruchsignal`);
    return run({ runId, input, toolCallId: options.toolCallId, signal: options.signal, progress: options.onProgress });
  }

  stopRun(runId: string): Promise<void> {
    return settledAll(this.#modules.flatMap((module) => module.stopRun ? [module.stopRun(runId)] : []));
  }

  shutdown(): Promise<void> {
    return settledAll(this.#modules.flatMap((module) => module.shutdown ? [module.shutdown()] : []));
  }

  async #annotate(runId: string, absolutePath: string): Promise<string | undefined> {
    const notes = await Promise.all(this.#modules.flatMap((module) => module.annotate
      ? [module.annotate(runId, absolutePath).catch((error: unknown) => `Anmerkung fehlgeschlagen: ${messageOf(error)}`)]
      : []));
    const text = notes.filter((note): note is string => Boolean(note)).join("\n");
    return text || undefined;
  }
}
